import { describe, expect, it } from "bun:test"
import { parsePacketEnvelope } from "./wire"

const example = {
  version: 1,
  type: "packet",
  session_id: "d61c1c49-4dae-4c6f-aa41-4f7f2a44411e",
  record: "18446744073709551615",
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
  rows: [{
    kind: "RTTProtocol",
    status: "authenticated",
    protocol: 3,
    fields: [{ name: "CaptureResponseDelayMs", value: "42.6", bits: [8, 16] }],
  }],
}

describe("packet wire envelope", () => {
  it("preserves exact u64 record and timestamp strings", () => {
    const event = parsePacketEnvelope(JSON.stringify(example))
    expect(event.record).toBe("18446744073709551615")
    expect(event.timestamp_ns).toBe("1793059200123456789")
    expect(event.packet.payload_hex).toBe("0032abcd")
    expect(event.rows[0]?.fields[0]?.bits).toEqual([8, 16])
  })

  it("rejects lossy timestamps, unsafe metadata, and malformed payloads", () => {
    for (const changed of [
      { ...example, timestamp_ns: 1793059200123456789 },
      { ...example, record: "18446744073709551616" },
      { ...example, packet: { ...example.packet, payload_hex: "abc" } },
      { ...example, packet: { ...example.packet, source_ip: "192.168.001.1" } },
      { ...example, rows: [{ ...example.rows[0], fields: [{ name: "PiaKey", value: "secret" }] }] },
      { ...example, game_key: "secret" },
    ]) {
      expect(() => parsePacketEnvelope(JSON.stringify(changed))).toThrow()
    }
  })

  it("bounds the WebSocket message before parsing JSON", () => {
    expect(() => parsePacketEnvelope("x".repeat(512 * 1024 + 1))).toThrow(/size/)
  })

  it("accepts the shared non-sensitive Rust publisher fixture", async () => {
    const event = parsePacketEnvelope(await Bun.file(new URL("./fixtures/packet-v1.json", import.meta.url)).text())
    expect(event.record).toBe("1")
    expect(event.packet.source_ip).toBe("192.0.2.10")
  })

  it("retains an empty decoded string value without inventing a value", () => {
    const changed = { ...example, rows: [{ ...example.rows[0], fields: [{ name: "StageResource", value: "" }] }] }
    expect(parsePacketEnvelope(JSON.stringify(changed)).rows[0]?.fields[0]?.value).toBe("")
  })
})
