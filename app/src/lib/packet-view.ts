import type { PacketEnvelope, WireRow } from "../../../api/wire"
import type { Packet } from "@/demo-data"

function captureTime(timestampNs: string): string {
  try {
    const millis = BigInt(timestampNs) / 1_000_000n
    if (millis > BigInt(Number.MAX_SAFE_INTEGER)) return "—"
    return new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Tokyo", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
    }).format(new Date(Number(millis)))
  } catch {
    return "—"
  }
}

function packetRow(event: PacketEnvelope, row: WireRow, index: number): Packet {
  const type = row.fields.find((field) => field.name === "Type")?.value
  return {
    id: `${event.session_id.slice(0, 8)}/${event.record}${event.rows.length > 1 ? `.${index}` : ""}`,
    time: captureTime(event.timestamp_ns),
    flow: row.direction ?? "—",
    source: `${event.packet.source_ip}:${event.packet.source_port}`,
    destination: `${event.packet.destination_ip}:${event.packet.destination_port}`,
    protocol: row.kind,
    kind: type === undefined ? row.layout ?? "UDP record" : `Type ${type}`,
    status: row.status,
    rawHex: event.packet.payload_hex,
    fields: row.fields.map((field) => [field.name, field.value]),
  }
}

export function packetRowsForEvents(events: PacketEnvelope[]): Packet[] {
  return events.flatMap((event) => {
    const rows: WireRow[] = event.rows.length === 0 ? [{ kind: "UDP", status: "unparsed", fields: [] }] : event.rows
    return rows.map((row, index) => packetRow(event, row, index))
  }).reverse()
}

export function livePacketRows(events: PacketEnvelope[]): Packet[] {
  return packetRowsForEvents(events.slice(-80)).slice(0, 80)
}
