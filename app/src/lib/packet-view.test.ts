import { expect, test } from "bun:test"
import { samplePacket } from "../../../api/test-fixture"
import { livePacketRows } from "./packet-view"

test("live packet view preserves a u64 record and keeps decoded rows distinct", () => {
  const event = samplePacket("18446744073709551615")
  const packets = livePacketRows([{ ...event, rows: [event.rows[0]!, { kind: "UDP", status: "unparsed", fields: [] }] }])
  expect(packets).toHaveLength(2)
  expect(packets[0]!.id).toContain("18446744073709551615.1")
  expect(packets[1]!.id).toContain("18446744073709551615.0")
  expect(packets[1]!.rawHex).toBe("0032abcd")
  expect(packets[1]!.status).toBe("authenticated")
})
