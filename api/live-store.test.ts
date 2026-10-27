import { describe, expect, it } from "bun:test"
import { LiveStore } from "./live-store"
import { samplePacket } from "./test-fixture"

describe("live event store", () => {
  it("accepts monotonic records and reports a gap without replaying duplicates", async () => {
    const store = new LiveStore({ maxEvents: 2, maxBytes: 1_000_000 })
    const outbound: unknown[] = []
    store.subscribe("live", (message) => { outbound.push(message); return true })

    expect((await store.ingest(samplePacket("1"))).result).toBe("accepted")
    expect((await store.ingest(samplePacket("1"))).result).toBe("duplicate")
    const gap = await store.ingest(samplePacket("3"))
    expect(gap).toEqual({ result: "accepted", gap: { session_id: samplePacket().session_id, expected_record: "2", actual_record: "3" }, persistence: "memory" })
    expect((await store.ingest(samplePacket("2"))).result).toBe("stale")
    expect(outbound.map((item) => (item as { type: string }).type)).toEqual(["packet", "gap", "packet"])
    expect(store.snapshot().map((event) => event.record)).toEqual(["1", "3"])
  })

  it("bounds memory by encoded bytes and removes a slow reader", async () => {
    const first = samplePacket("1")
    const bytes = new TextEncoder().encode(JSON.stringify(first)).byteLength
    const store = new LiveStore({ maxEvents: 10, maxBytes: bytes + 1 })
    let attemptedSends = 0
    store.subscribe("live", () => { attemptedSends++; return false })
    await store.ingest(first)
    await store.ingest(samplePacket("2"))
    expect(store.snapshot().map((event) => event.record)).toEqual(["2"])
    expect(attemptedSends).toBe(1)
    expect(store.listenerCount).toBe(0)
  })
})
