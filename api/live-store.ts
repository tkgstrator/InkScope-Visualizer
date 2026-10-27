import { overlayPacket, type OverlayPacket, type PacketEnvelope } from "./wire"

export type PersistenceMode = "memory" | "postgres"
export type GapMessage = {
  version: 1
  type: "gap"
  session_id: string
  expected_record: string
  actual_record: string
}
export type LiveMessage =
  | { version: 1; type: "hello"; mode: PersistenceMode }
  | { version: 1; type: "snapshot"; events: PacketEnvelope[] }
  | { version: 1; type: "packet"; event: PacketEnvelope }
  | GapMessage
export type OverlayMessage =
  | { version: 1; type: "hello"; mode: PersistenceMode }
  | { version: 1; type: "snapshot"; events: OverlayPacket[] }
  | { version: 1; type: "summary"; event: OverlayPacket }
  | GapMessage

export interface PacketPersistence {
  lastRecord(sessionId: string): Promise<string | null>
  save(event: PacketEnvelope): Promise<boolean>
}

type Listener = {
  kind: "live" | "overlay"
  send: (message: LiveMessage | OverlayMessage) => boolean
}

export class IngressBusyError extends Error {
  constructor() {
    super("InkScope ingress queue is full")
    this.name = "IngressBusyError"
  }
}

export class LiveStore {
  readonly mode: PersistenceMode
  private readonly maxEvents: number
  private readonly maxBytes: number
  private readonly persistence?: PacketPersistence
  private readonly recent: Array<{ event: PacketEnvelope; bytes: number }> = []
  private readonly lastBySession = new Map<string, bigint>()
  private readonly listeners = new Set<Listener>()
  private recentBytes = 0
  private pending = 0
  private serial: Promise<void> = Promise.resolve()

  constructor(options: { maxEvents?: number; maxBytes?: number; persistence?: PacketPersistence } = {}) {
    this.maxEvents = options.maxEvents ?? 512
    this.maxBytes = options.maxBytes ?? 8 * 1024 * 1024
    if (!Number.isSafeInteger(this.maxEvents) || this.maxEvents < 1 || !Number.isSafeInteger(this.maxBytes) || this.maxBytes < 1) {
      throw new Error("Invalid live store limits")
    }
    this.persistence = options.persistence
    this.mode = options.persistence ? "postgres" : "memory"
  }

  snapshot(): PacketEnvelope[] {
    return this.recent.map(({ event }) => event)
  }

  overlaySnapshot(): OverlayPacket[] {
    return this.recent.map(({ event }) => overlayPacket(event))
  }

  hydrate(events: PacketEnvelope[]): void {
    for (const event of events) {
      const record = BigInt(event.record)
      const previous = this.lastBySession.get(event.session_id)
      if (previous === undefined || record > previous) this.lastBySession.set(event.session_id, record)
      this.remember(event)
    }
  }

  subscribe(kind: Listener["kind"], send: Listener["send"]): () => void {
    const listener = { kind, send }
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  get listenerCount(): number {
    return this.listeners.size
  }

  async ingest(event: PacketEnvelope): Promise<{
    result: "accepted" | "duplicate" | "stale"
    gap?: Omit<GapMessage, "version" | "type">
    persistence: PersistenceMode
  }> {
    if (this.pending >= 128) throw new IngressBusyError()
    this.pending++
    const result = this.serial.then(() => this.commit(event))
    this.serial = result.then(() => undefined, () => undefined)
    try {
      return await result
    } finally {
      this.pending--
    }
  }

  private async commit(event: PacketEnvelope) {
    const bytes = new TextEncoder().encode(JSON.stringify(event)).byteLength
    if (bytes > this.maxBytes) throw new IngressBusyError()
    const current = BigInt(event.record)
    let last = this.lastBySession.get(event.session_id)
    if (last === undefined && this.persistence) {
      const persisted = await this.persistence.lastRecord(event.session_id)
      if (persisted !== null) last = BigInt(persisted)
    }
    if (last !== undefined && current <= last) {
      return { result: current === last ? "duplicate" : "stale", persistence: this.mode } as const
    }
    if (this.persistence && !(await this.persistence.save(event))) {
      return { result: "duplicate", persistence: this.mode } as const
    }

    const gap = last !== undefined && current > last + 1n ? {
      session_id: event.session_id,
      expected_record: String(last + 1n),
      actual_record: event.record,
    } : undefined
    this.lastBySession.delete(event.session_id)
    this.lastBySession.set(event.session_id, current)
    if (this.lastBySession.size > 1_024) this.lastBySession.delete(this.lastBySession.keys().next().value!)
    this.remember(event, bytes)

    if (gap) this.broadcast({ version: 1, type: "gap", ...gap })
    this.broadcast({ version: 1, type: "packet", event })
    return { result: "accepted", ...(gap ? { gap } : {}), persistence: this.mode } as const
  }

  private remember(event: PacketEnvelope, knownBytes?: number): void {
    const bytes = knownBytes ?? new TextEncoder().encode(JSON.stringify(event)).byteLength
    if (bytes > this.maxBytes) return
    this.recent.push({ event, bytes })
    this.recentBytes += bytes
    while (this.recent.length > this.maxEvents || this.recentBytes > this.maxBytes) {
      this.recentBytes -= this.recent.shift()!.bytes
    }
  }

  private broadcast(message: GapMessage | { version: 1; type: "packet"; event: PacketEnvelope }) {
    for (const listener of this.listeners) {
      const outbound = message.type === "packet" && listener.kind === "overlay"
        ? { version: 1 as const, type: "summary" as const, event: overlayPacket(message.event) }
        : message
      try {
        if (!listener.send(outbound)) this.listeners.delete(listener)
      } catch {
        this.listeners.delete(listener)
      }
    }
  }
}
