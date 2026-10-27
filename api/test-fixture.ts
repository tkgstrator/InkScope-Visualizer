import { parsePacketEnvelope, type PacketEnvelope } from "./wire"

export function samplePacket(record = "1", session_id = "d61c1c49-4dae-4c6f-aa41-4f7f2a44411e"): PacketEnvelope {
  return parsePacketEnvelope(JSON.stringify({
    version: 1,
    type: "packet",
    session_id,
    record,
    timestamp_ns: "1793059200123456789",
    packet: {
      source_ip: "192.168.10.157",
      source_port: 49152,
      source_mac: "6c:6e:07:43:8c:cb",
      destination_ip: "192.168.10.180",
      destination_port: 49153,
      destination_mac: "bc:5c:4c:ce:57:13",
      payload_hex: "0032abcd",
    },
    rows: [{ kind: "RTTProtocol", status: "authenticated", protocol: 3, fields: [{ name: "CaptureResponseDelayMs", value: "42.6" }] }],
  }))
}
