import type { PacketEnvelope, WavePreview, WireRow } from "../../../api/wire"

export type ObservedTide = "Low" | "Mid" | "High"

export type SessionObservation = {
  sessionId: string | null
  record: string | null
  observedRecords: number
  authenticatedRecords: number
  host: string | null
  clients: Array<{ ip: string; delay: string | null }>
  source: string | null
  destination: string | null
  pairDelay: string | null
  stageId: string | null
  difficulty: string | null
  jobType: string | null
  quota: string | null
  sequence: string | null
  wave: string | null
  tide: ObservedTide | null
  wavePreview: WavePreview | null
  /** Keeps authenticated pair delays when the latest endpoints change. */
  pairDelays: Record<string, string>
  /** A PrivateSetting StageId, including an empty one, supersedes StageResource. */
  stageFromPrivate: boolean
  difficultyFromPrivate: boolean
}

export function emptySessionObservation(): SessionObservation {
  return {
    sessionId: null, record: null, observedRecords: 0, authenticatedRecords: 0,
    host: null, clients: [], source: null, destination: null, pairDelay: null,
    stageId: null, difficulty: null, jobType: null, quota: null, sequence: null,
    wave: null, tide: null, wavePreview: null, pairDelays: {},
    stageFromPrivate: false, difficultyFromPrivate: false,
  }
}

function recordNumber(record: string): bigint | null {
  if (typeof record !== "string" || !/^(0|[1-9][0-9]{0,19})$/.test(record)) return null
  const number = BigInt(record)
  return number <= 18_446_744_073_709_551_615n ? number : null
}

function field(row: WireRow, name: string): string | undefined {
  if (!Array.isArray(row.fields)) return undefined
  const value = row.fields.find((item) => item?.name === name)?.value
  return typeof value === "string" ? value : undefined
}

function rows(event: PacketEnvelope): WireRow[] {
  return Array.isArray(event.rows) ? event.rows.filter((row): row is WireRow =>
    Boolean(row && typeof row.kind === "string" && typeof row.status === "string" && Array.isArray(row.fields))) : []
}

function verifiedHost(event: PacketEnvelope): string | null {
  const host = rows(event)
    .filter((row) => row.kind === "BrowseReply" && row.status === "proof_verified")
    .map((row) => field(row, "HostIPv4"))
    .find((value) => value !== undefined)
  return host && host === event.packet?.source_ip ? host : null
}

function isUnicast(ip: string): boolean {
  const octets = ip.split(".").map(Number)
  return octets.length === 4 && octets.every((octet) => Number.isInteger(octet) && octet >= 0 && octet <= 255) &&
    octets[0] !== 0 && octets[0]! < 224 && octets[3] !== 255
}

function delayFor(event: PacketEnvelope): string | null {
  for (const row of rows(event)) {
    if (row.kind !== "RTTProtocol" || row.status !== "authenticated" || field(row, "Type") !== "1") continue
    const delay = field(row, "CaptureResponseDelayMs")
    if (delay && /^(?:0|[1-9][0-9]*)(?:\.[0-9]{1,3})?$/.test(delay) && Number.isFinite(Number(delay)) && Number(delay) > 0) return delay
  }
  return null
}

function pairKey(first: string, second: string): string {
  return [first, second].sort().join("|")
}

function setObservedFields(next: SessionObservation, eventRows: WireRow[]): void {
  for (const row of eventRows) {
    if (row.status !== "authenticated") continue
    const privateSetting = row.kind === "PrivateSetting"
    const stage = field(row, privateSetting ? "StageId" : "StageResource")
    if (stage !== undefined && (privateSetting || !next.stageFromPrivate)) {
      next.stageId = stage || null
      if (privateSetting) next.stageFromPrivate = true
    }
    const difficulty = field(row, "Difficulty")
    if (difficulty !== undefined && (privateSetting || !next.difficultyFromPrivate)) {
      next.difficulty = difficulty
      if (privateSetting) next.difficultyFromPrivate = true
    }
    next.jobType = field(row, "JobType") ?? next.jobType
    next.quota = field(row, "Quota") ?? next.quota
    next.sequence = field(row, "Sequence") ?? next.sequence
    next.wave = field(row, "Wave") ?? next.wave
    const tide = field(row, "Tide")
    if (tide === "Low" || tide === "Mid" || tide === "High") next.tide = tide
    if (row.wave_preview) next.wavePreview = row.wave_preview
  }
}

/** Fold a single validated packet in record order. Older or repeated records do nothing. */
export function foldObservation(current: SessionObservation, event: PacketEnvelope): SessionObservation {
  const incoming = recordNumber(event.record)
  if (incoming === null || typeof event.session_id !== "string" || !event.packet ||
      typeof event.packet.source_ip !== "string" || typeof event.packet.destination_ip !== "string") return current
  const sameSession = current.sessionId === event.session_id
  if (sameSession && current.record !== null && incoming <= BigInt(current.record)) return current
  const proofHost = verifiedHost(event)
  const reset = !sameSession || proofHost !== null && current.host !== null && proofHost !== current.host
  const base = reset ? emptySessionObservation() : current
  const eventRows = rows(event)
  const authenticated = eventRows.some((row) => row.status === "authenticated" || row.status === "proof_verified")
  const source = event.packet.source_ip
  const destination = event.packet.destination_ip
  const next: SessionObservation = {
    ...base,
    sessionId: event.session_id,
    record: event.record,
    observedRecords: base.observedRecords + 1,
    authenticatedRecords: base.authenticatedRecords + (authenticated ? 1 : 0),
    clients: base.clients.map((client) => ({ ...client })),
    pairDelays: { ...base.pairDelays },
  }

  const delay = delayFor(event)
  const key = pairKey(source, destination)
  if (delay !== null) next.pairDelays[key] = delay

  if (proofHost !== null) next.host = proofHost
  if (next.host !== null) {
    next.source = null
    next.destination = null
    next.pairDelay = null
    const peer = source === next.host ? destination : destination === next.host ? source : null
    if (peer !== null && peer !== next.host && isUnicast(peer) && (proofHost !== null || eventRows.some((row) => row.status === "authenticated"))) {
      const existing = next.clients.find((client) => client.ip === peer)
      if (existing) {
        if (delay !== null) existing.delay = delay
      } else next.clients.push({ ip: peer, delay })
      next.clients.sort((left, right) => left.ip.localeCompare(right.ip, undefined, { numeric: true }))
    }
  } else {
    next.source = source
    next.destination = destination
    next.pairDelay = next.pairDelays[key] ?? null
  }

  setObservedFields(next, eventRows)
  return next
}

/** Fold the server's bounded snapshot without losing earlier same-session observations. */
export function foldObservationSnapshot(current: SessionObservation, events: PacketEnvelope[]): SessionObservation {
  const lastSession = events.findLast((event) => recordNumber(event.record) !== null)?.session_id
  if (!lastSession) return current
  return events
    .filter((event) => event.session_id === lastSession && recordNumber(event.record) !== null)
    .sort((left, right) => {
      const a = BigInt(left.record)
      const b = BigInt(right.record)
      return a < b ? -1 : a > b ? 1 : 0
    })
    .reduce(foldObservation, current)
}
