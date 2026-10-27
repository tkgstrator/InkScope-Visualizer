import { expect, test } from "bun:test"
import type { PacketEnvelope } from "../../../api/wire"
import { applyLivePacket, applyLiveSnapshot, emptyLiveFeed } from "./live-feed"

const session = "d61c1c49-4dae-4c6f-aa41-4f7f2a44411e"
const nextSession = "45d87777-2eb3-426a-8c43-5d52ee84976e"

function event(record: string, sessionId = session, hostProof = false): PacketEnvelope {
  return {
    version: 1, type: "packet", session_id: sessionId, record, timestamp_ns: "1793059200123456789",
    packet: { source_ip: "192.0.2.10", source_port: 49152, source_mac: "02:00:00:00:00:10", destination_ip: "192.0.2.11", destination_port: 49153, destination_mac: "02:00:00:00:00:11", payload_hex: "00" },
    rows: hostProof ? [{ kind: "BrowseReply", status: "proof_verified", fields: [{ name: "HostIPv4", value: "192.0.2.10" }] }] : [],
  }
}

test("live feed retains cumulative proof across a 512-event window and reconnect snapshot", () => {
  let feed = applyLivePacket(emptyLiveFeed(), event("1", session, true))
  for (let record = 2; record <= 515; record++) feed = applyLivePacket(feed, event(String(record)))
  expect(feed.events).toHaveLength(512)
  expect(feed.events[0]?.record).toBe("4")
  expect(feed.observation.host).toBe("192.0.2.10")
  feed = applyLivePacket(feed, event("1", session, true))
  expect(feed.events[0]?.record).toBe("4")
  expect(feed.observation.observedRecords).toBe(515)
  feed = applyLiveSnapshot(feed, Array.from({ length: 512 }, (_, index) => event(String(index + 4))))
  expect(feed.observation.observedRecords).toBe(515)
  expect(feed.observation.host).toBe("192.0.2.10")
  feed = applyLivePacket(feed, event("516"))
  expect(feed.observation.observedRecords).toBe(516)
})

test("live feed ignores older records outside the window and sorts u64 snapshot records", () => {
  const high = event("18446744073709551614")
  const max = event("18446744073709551615")
  let feed = applyLiveSnapshot(emptyLiveFeed(), [max, high])
  feed = applyLivePacket(feed, high)
  expect(feed.events.map((item) => item.record)).toEqual([high.record, max.record])
  expect(feed.observation.observedRecords).toBe(2)
})

test("live feed clears old session events when a new session arrives", () => {
  let feed = applyLiveSnapshot(emptyLiveFeed(), [event("1", session, true), event("2")])
  feed = applyLivePacket(feed, event("1", nextSession))
  expect(feed.events.map((item) => item.session_id)).toEqual([nextSession])
  expect(feed.observation.host).toBeNull()
  expect(feed.observation.observedRecords).toBe(1)
})

test("reconnect snapshot clears visible packets when a proven host changes", () => {
  const newHost = {
    ...event("2"),
    packet: { ...event("2").packet, source_ip: "192.0.2.12" },
    rows: [{ kind: "BrowseReply", status: "proof_verified", fields: [{ name: "HostIPv4", value: "192.0.2.12" }] }],
  } satisfies PacketEnvelope
  let feed = applyLivePacket(emptyLiveFeed(), event("1", session, true))
  feed = applyLiveSnapshot(feed, [event("1", session, true), newHost, event("3")])
  expect(feed.events.map((item) => item.record)).toEqual(["2", "3"])
  expect(feed.observation.host).toBe("192.0.2.12")
  expect(feed.observation.observedRecords).toBe(2)
})
