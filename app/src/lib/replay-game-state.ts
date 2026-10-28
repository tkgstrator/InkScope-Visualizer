import type { PacketEnvelope, WireRow } from "../../../api/wire"
import { emptySessionObservation, foldObservation } from "./session-observation"

export type ReplaySpawn = {
  record: string
  stageId: string | null
  kind: "enemy" | "item"
  actor: string
  position: [number, number, number]
  timestampNs: string
}

export type ReplayGameSnapshot = {
  stageId: string | null
  sessionStageId: string | null
  stageName: string | null
  difficulty: string | null
  jobType: string | null
  quota: string | null
  sequence: string | null
  wave: string | null
  remainingSeconds: number | null
  remainingSecondsEstimated: boolean
  tide: "Low" | "Mid" | "High" | null
  enemySpawnCount: number
  itemSpawnCount: number
  latestSpawn: ReplaySpawn | null
  host: string | null
  clients: Array<{ ip: string; delay: string | null }>
  source: string | null
  destination: string | null
  pairDelay: string | null
}

export type ReplayGameTimeline = {
  snapshots: ReplayGameSnapshot[]
  spawns: ReplaySpawn[]
  gameFrameAnchors: Array<{ frame: number; timestampNs: string } | null>
}

const emptySnapshot: ReplayGameSnapshot = {
  stageId: null,
  sessionStageId: null,
  stageName: null,
  difficulty: null,
  jobType: null,
  quota: null,
  sequence: null,
  wave: null,
  remainingSeconds: null,
  remainingSecondsEstimated: false,
  tide: null,
  enemySpawnCount: 0,
  itemSpawnCount: 0,
  latestSpawn: null,
  host: null,
  clients: [],
  source: null,
  destination: null,
  pairDelay: null,
}

function field(row: WireRow, name: string): string | undefined {
  return row.fields.find((entry) => entry.name === name)?.value
}

type GameFrameAnchor = NonNullable<ReplayGameTimeline["gameFrameAnchors"][number]>

// Capture-derived estimate: 100 seconds at 60 fps, with 20 seconds between waves.
const firstWaveStartFrame = 1300
const waveFrameStride = 7200
const waveDurationFrames = 6000
const framesPerSecond = 60

function gameplayFrame(row: WireRow): number | null {
  if (row.status !== "authenticated" || !/^Coop.*Event$/.test(row.kind)) return null
  const value = field(row, "GameFrame")
  if (value === undefined || !/^(?:0|[1-9][0-9]*)$/.test(value)) return null
  const frame = Number(value)
  return Number.isSafeInteger(frame) && frame < 2 ** 23 ? frame : null
}

function estimatedRemainingSeconds(anchor: GameFrameAnchor | null, sequence: string | null, timestampNs: string): number | null {
  if (anchor === null || sequence === null || !/^[0-2]$/.test(sequence)) return null
  try {
    const elapsedNs = BigInt(timestampNs) - BigInt(anchor.timestampNs)
    if (elapsedNs < 0n) return null
    const frame = anchor.frame + Number(elapsedNs) / 1_000_000_000 * framesPerSecond
    const start = firstWaveStartFrame + Number(sequence) * waveFrameStride
    const end = start + waveDurationFrames
    if (!Number.isFinite(frame) || frame < start || frame > end + framesPerSecond) return null
    return Math.max(0, Math.min(100, Math.ceil((end - frame) / framesPerSecond)))
  } catch {
    return null
  }
}

function explicitTide(row: WireRow): ReplayGameSnapshot["tide"] | undefined {
  const value = field(row, "Tide")
  return value === "Low" || value === "Mid" || value === "High" ? value : undefined
}

function applyObservedRow(current: ReplayGameSnapshot, row: WireRow): ReplayGameSnapshot {
  if (row.status !== "authenticated") return current
  if (row.kind === "PrivateSetting") {
    const stage = field(row, "StageId")
    const difficulty = field(row, "Difficulty")
    if (stage === undefined && difficulty === undefined) return current
    const stageChanged = Boolean(stage) && stage !== current.stageId
    return {
      ...current,
      stageId: stage === undefined ? current.stageId : stage || null,
      sessionStageId: stage ? stage : current.sessionStageId,
      stageName: stageChanged ? null : current.stageName,
      difficulty: difficulty ?? current.difficulty,
    }
  }
  if (row.kind === "OnlineCoopSetting") {
    const stage = field(row, "StageResource")
    const stageName = field(row, "StageName")
    const difficulty = field(row, "Difficulty")
    const jobType = field(row, "JobType")
    const wave = field(row, "Wave")
    const tide = explicitTide(row)
    if ([stage, stageName, difficulty, jobType, wave, tide].every((value) => value === undefined)) return current
    return {
      ...current,
      stageId: stage === undefined ? current.stageId : stage || null,
      sessionStageId: stage ? stage : current.sessionStageId,
      stageName: stageName ?? (stage && stage !== current.stageId ? null : current.stageName),
      difficulty: difficulty ?? current.difficulty,
      jobType: jobType ?? current.jobType,
      wave: wave ?? current.wave,
      tide: tide ?? current.tide,
    }
  }
  if (row.kind === "CoopSequenceNetState") {
    const quota = field(row, "Quota")
    const sequence = field(row, "Sequence")
    const wave = field(row, "Wave")
    const tide = explicitTide(row)
    if ([quota, sequence, wave, tide].every((value) => value === undefined)) return current
    if (quota === current.quota && sequence === current.sequence && wave === undefined && tide === undefined) return current
    return {
      ...current,
      quota: quota ?? current.quota,
      sequence: sequence ?? current.sequence,
      wave: wave ?? current.wave,
      tide: tide ?? current.tide,
    }
  }
  return current
}

function coordinate(value: string | undefined): number | null {
  if (value === undefined || !/^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/.test(value)) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function observedSpawn(event: PacketEnvelope, row: WireRow, stageId: string | null): ReplaySpawn | null {
  if (row.status !== "authenticated" ||
      row.kind !== "CoopEnemySpawnNetEvent" && row.kind !== "CoopItemSpawnEvent") return null
  const x = coordinate(field(row, "SpawnX"))
  const y = coordinate(field(row, "SpawnY"))
  const z = coordinate(field(row, "SpawnZ"))
  if (x === null || y === null || z === null) return null
  const kind = row.kind === "CoopEnemySpawnNetEvent" ? "enemy" : "item"
  return {
    record: event.record,
    stageId,
    kind,
    actor: kind === "enemy" ? field(row, "SalmonType") ?? "Enemy spawn" : "Item spawn",
    position: [x, y, z],
    timestampNs: event.timestamp_ns,
  }
}

/** Build compact playhead snapshots once, then seek by event index in constant time. */
export function buildReplayGameTimeline(events: readonly PacketEnvelope[]): ReplayGameTimeline {
  return events.reduce<{
    timeline: ReplayGameTimeline
    observation: ReturnType<typeof emptySessionObservation>
    frameAnchor: GameFrameAnchor | null
  }>((state, event) => {
    const { timeline } = state
    const previous = timeline.snapshots.at(-1) ?? emptySnapshot
    const observed = event.rows.reduce(applyObservedRow, previous)
    const frameReset = observed.sequence !== previous.sequence || observed.stageId !== previous.stageId ||
      event.rows.some((row) => row.status === "authenticated" && row.kind === "OnlineCoopSetting")
    const eventFrame = event.rows.reduce<number | null>((latest, row) => {
      const frame = gameplayFrame(row)
      return frame === null ? latest : Math.max(latest ?? frame, frame)
    }, null)
    const validEventFrame = eventFrame !== null &&
      estimatedRemainingSeconds({ frame: eventFrame, timestampNs: event.timestamp_ns }, observed.sequence, event.timestamp_ns) !== null
      ? eventFrame : null
    const previousFrameAnchor = frameReset ? null : state.frameAnchor
    const frameAnchor = validEventFrame === null || previousFrameAnchor !== null && validEventFrame <= previousFrameAnchor.frame
      ? previousFrameAnchor
      : { frame: validEventFrame, timestampNs: event.timestamp_ns }
    const observation = foldObservation(state.observation, event)
    const spawns = event.rows
      .map((row) => observedSpawn(event, row, observed.stageId ?? observed.sessionStageId))
      .filter((spawn): spawn is ReplaySpawn => spawn !== null)
    const game = spawns.length === 0 ? observed : {
      ...observed,
      enemySpawnCount: observed.enemySpawnCount + spawns.filter((spawn) => spawn.kind === "enemy").length,
      itemSpawnCount: observed.itemSpawnCount + spawns.filter((spawn) => spawn.kind === "item").length,
      latestSpawn: spawns.at(-1) ?? observed.latestSpawn,
    }
    const remainingSeconds = estimatedRemainingSeconds(frameAnchor, game.sequence, event.timestamp_ns)
    const next = {
      ...game,
      remainingSeconds,
      remainingSecondsEstimated: remainingSeconds !== null,
      host: observation.host,
      clients: observation.clients,
      source: observation.source,
      destination: observation.destination,
      pairDelay: observation.pairDelay,
    }
    timeline.snapshots.push(next)
    timeline.gameFrameAnchors.push(frameAnchor)
    timeline.spawns.push(...spawns)
    return { timeline, observation, frameAnchor }
  }, { timeline: { snapshots: [], spawns: [], gameFrameAnchors: [] }, observation: emptySessionObservation(), frameAnchor: null }).timeline
}

export function replayGameSnapshotAt(timeline: ReplayGameTimeline, index: number): ReplayGameSnapshot {
  if (index < 0 || timeline.snapshots.length === 0) return emptySnapshot
  return timeline.snapshots[Math.min(Math.floor(index), timeline.snapshots.length - 1)] ?? emptySnapshot
}

/** Estimate the countdown between gameplay packets at the capture playhead. */
export function replayRemainingSecondsAt(timeline: ReplayGameTimeline, index: number, playheadTimestampNs: string): number | null {
  if (index < 0 || timeline.snapshots.length === 0) return null
  const position = Math.min(Math.floor(index), timeline.snapshots.length - 1)
  const sequence = timeline.snapshots[position]?.sequence ?? null
  return estimatedRemainingSeconds(timeline.gameFrameAnchors[position] ?? null, sequence, playheadTimestampNs)
}

/** Recent observed spawn coordinates at the capture clock; no entity tracking is inferred. */
export function replayActiveSpawns(
  timeline: ReplayGameTimeline,
  playheadTimestampNs: string,
  windowMs = 8_000,
  stageId?: string | null,
): ReplaySpawn[] {
  if (!Number.isFinite(windowMs) || windowMs < 0) return []
  try {
    const playhead = BigInt(playheadTimestampNs)
    const windowNs = BigInt(Math.round(windowMs * 1_000_000))
    return timeline.spawns.filter((spawn) => {
      if (stageId !== undefined && spawn.stageId !== stageId) return false
      const delta = playhead - BigInt(spawn.timestampNs)
      return delta >= 0n && delta <= windowNs
    })
  } catch {
    return []
  }
}
