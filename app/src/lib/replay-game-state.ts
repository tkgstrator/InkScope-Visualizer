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
  }>((state, event) => {
    const { timeline } = state
    const previous = timeline.snapshots.at(-1) ?? emptySnapshot
    const observed = event.rows.reduce(applyObservedRow, previous)
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
    const next = {
      ...game,
      host: observation.host,
      clients: observation.clients,
      source: observation.source,
      destination: observation.destination,
      pairDelay: observation.pairDelay,
    }
    timeline.snapshots.push(next)
    timeline.spawns.push(...spawns)
    return { timeline, observation }
  }, { timeline: { snapshots: [], spawns: [] }, observation: emptySessionObservation() }).timeline
}

export function replayGameSnapshotAt(timeline: ReplayGameTimeline, index: number): ReplayGameSnapshot {
  if (index < 0 || timeline.snapshots.length === 0) return emptySnapshot
  return timeline.snapshots[Math.min(Math.floor(index), timeline.snapshots.length - 1)] ?? emptySnapshot
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
