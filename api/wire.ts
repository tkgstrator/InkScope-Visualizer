export type WireField = {
  name: string
  value: string
  bits?: [number, number]
}

export type WavePreview = {
  status: string
  source: string
  assumptions: string[]
  reason?: string
  scenarios: Array<{
    is_big_run: boolean
    global_word_class: string
    waves: Array<{
      wave_index: number
      event_id: number
      tide_id: number
      nominal_rare_ticks?: number[]
    }>
  }>
}

export type WireRow = {
  direction?: string
  kind: string
  status: string
  layout?: string
  protocol?: number
  port?: number
  chunk?: number
  fields: WireField[]
  wave_preview?: WavePreview
}

export type PacketEnvelope = {
  version: 1
  type: "packet"
  session_id: string
  record: string
  timestamp_ns: string
  packet: {
    source_ip: string
    source_port: number
    source_mac: string
    destination_ip: string
    destination_port: number
    destination_mac: string
    payload_hex: string
  }
  rows: WireRow[]
}

export type OverlayPacket = {
  session_id: string
  record: string
  timestamp_ns: string
  kind: string
  status: string
}

export const maxWireBytes = 512 * 1024
export const maxU64 = 18_446_744_073_709_551_615n

export class WireValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "WireValidationError"
  }
}

function fail(path: string): never {
  throw new WireValidationError(`Invalid packet envelope: ${path}`)
}

function object(value: unknown, path: string, required: string[], optional: string[] = []): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return fail(path)
  const source = value as Record<string, unknown>
  const allowed = new Set([...required, ...optional])
  if (required.some((key) => !(key in source)) || Object.keys(source).some((key) => !allowed.has(key))) return fail(path)
  return source
}

function string(value: unknown, path: string, max = 128): string {
  if (typeof value !== "string" || value.length === 0 || value.length > max) return fail(path)
  return value
}

function optionalString(value: unknown, path: string, max = 128): string | undefined {
  return value === undefined ? undefined : string(value, path, max)
}

function integer(value: unknown, path: string, max: number): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0 || value > max) return fail(path)
  return value
}

function array(value: unknown, path: string, max: number): unknown[] {
  if (!Array.isArray(value) || value.length > max) return fail(path)
  return value
}

function decimalU64(value: unknown, path: string): string {
  if (typeof value !== "string" || !/^(0|[1-9][0-9]{0,19})$/.test(value) || BigInt(value) > maxU64) return fail(path)
  return value
}

function ipv4(value: unknown, path: string): string {
  const address = string(value, path, 15)
  const octets = address.split(".")
  if (octets.length !== 4 || octets.some((octet) => !/^(0|[1-9][0-9]{0,2})$/.test(octet) || Number(octet) > 255)) return fail(path)
  return address
}

function mac(value: unknown, path: string): string {
  const address = string(value, path, 17)
  if (!/^[0-9a-f]{2}(?::[0-9a-f]{2}){5}$/.test(address)) return fail(path)
  return address
}

function hex(value: unknown, path: string, maxBytes: number): string {
  if (typeof value !== "string" || value.length > maxBytes * 2 || !/^(?:[0-9a-f]{2})*$/.test(value)) return fail(path)
  return value
}

function preview(value: unknown): WavePreview {
  const source = object(value, "rows.wave_preview", ["status", "source", "assumptions", "scenarios"], ["reason"])
  return {
    status: string(source.status, "rows.wave_preview.status"),
    source: string(source.source, "rows.wave_preview.source"),
    assumptions: array(source.assumptions, "rows.wave_preview.assumptions", 32).map((item) => string(item, "rows.wave_preview.assumption", 512)),
    ...(source.reason === undefined ? {} : { reason: string(source.reason, "rows.wave_preview.reason", 512) }),
    scenarios: array(source.scenarios, "rows.wave_preview.scenarios", 16).map((item) => {
      const scenario = object(item, "rows.wave_preview.scenario", ["is_big_run", "global_word_class", "waves"])
      if (typeof scenario.is_big_run !== "boolean") return fail("rows.wave_preview.is_big_run")
      return {
        is_big_run: scenario.is_big_run,
        global_word_class: string(scenario.global_word_class, "rows.wave_preview.global_word_class"),
        waves: array(scenario.waves, "rows.wave_preview.waves", 8).map((waveItem) => {
          const wave = object(waveItem, "rows.wave_preview.wave", ["wave_index", "event_id", "tide_id"], ["nominal_rare_ticks"])
          return {
            wave_index: integer(wave.wave_index, "rows.wave_preview.wave_index", 255),
            event_id: integer(wave.event_id, "rows.wave_preview.event_id", 255),
            tide_id: integer(wave.tide_id, "rows.wave_preview.tide_id", 255),
            ...(wave.nominal_rare_ticks === undefined ? {} : {
              nominal_rare_ticks: array(wave.nominal_rare_ticks, "rows.wave_preview.nominal_rare_ticks", 256)
                .map((tick) => integer(tick, "rows.wave_preview.tick", 4_294_967_295)),
            }),
          }
        }),
      }
    }),
  }
}

function row(value: unknown): WireRow {
  const source = object(value, "rows.item", ["kind", "status", "fields"], ["direction", "layout", "protocol", "port", "chunk", "wave_preview"])
  return {
    kind: string(source.kind, "rows.kind"),
    status: string(source.status, "rows.status"),
    fields: array(source.fields, "rows.fields", 128).map((fieldItem) => {
      const field = object(fieldItem, "rows.field", ["name", "value"], ["bits"])
      const name = string(field.name, "rows.field.name")
      if (/(?:gamekey|piakey|randomtable|secret)/i.test(name)) return fail("rows.field.name")
      const bits = field.bits === undefined ? undefined : array(field.bits, "rows.field.bits", 2)
      if (bits && bits.length !== 2) return fail("rows.field.bits")
      const parsedBits = bits?.map((bit) => integer(bit, "rows.field.bits", 1_000_000_000)) as [number, number] | undefined
      if (parsedBits && parsedBits[0] > parsedBits[1]) return fail("rows.field.bits")
      if (typeof field.value !== "string" || field.value.length > 4_096) return fail("rows.field.value")
      return {
        name,
        value: field.value,
        ...(parsedBits === undefined ? {} : { bits: parsedBits }),
      }
    }),
    ...(source.direction === undefined ? {} : { direction: string(source.direction, "rows.direction", 16) }),
    ...(source.layout === undefined ? {} : { layout: string(source.layout, "rows.layout") }),
    ...(source.protocol === undefined ? {} : { protocol: integer(source.protocol, "rows.protocol", 255) }),
    ...(source.port === undefined ? {} : { port: integer(source.port, "rows.port", 255) }),
    ...(source.chunk === undefined ? {} : { chunk: integer(source.chunk, "rows.chunk", 65_535) }),
    ...(source.wave_preview === undefined ? {} : { wave_preview: preview(source.wave_preview) }),
  }
}

export function parsePacketEnvelope(raw: string): PacketEnvelope {
  if (new TextEncoder().encode(raw).byteLength > maxWireBytes) return fail("size")
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return fail("JSON")
  }
  const source = object(parsed, "root", ["version", "type", "session_id", "record", "timestamp_ns", "packet", "rows"])
  if (source.version !== 1 || source.type !== "packet") return fail("version/type")
  const sessionId = string(source.session_id, "session_id", 36)
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(sessionId)) return fail("session_id")
  const packet = object(source.packet, "packet", ["source_ip", "source_port", "source_mac", "destination_ip", "destination_port", "destination_mac", "payload_hex"])
  return {
    version: 1,
    type: "packet",
    session_id: sessionId,
    record: decimalU64(source.record, "record"),
    timestamp_ns: decimalU64(source.timestamp_ns, "timestamp_ns"),
    packet: {
      source_ip: ipv4(packet.source_ip, "packet.source_ip"),
      source_port: integer(packet.source_port, "packet.source_port", 65_535),
      source_mac: mac(packet.source_mac, "packet.source_mac"),
      destination_ip: ipv4(packet.destination_ip, "packet.destination_ip"),
      destination_port: integer(packet.destination_port, "packet.destination_port", 65_535),
      destination_mac: mac(packet.destination_mac, "packet.destination_mac"),
      payload_hex: hex(packet.payload_hex, "packet.payload_hex", 65_507),
    },
    rows: array(source.rows, "rows", 128).map(row),
  }
}

export function overlayPacket(event: PacketEnvelope): OverlayPacket {
  return {
    session_id: event.session_id,
    record: event.record,
    timestamp_ns: event.timestamp_ns,
    kind: event.rows[0]?.kind ?? "UDP",
    status: event.rows[0]?.status ?? "unparsed",
  }
}
