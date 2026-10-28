import { describe, expect, it } from "bun:test"
import { replayIndexAtMs, replayOffsetsMs } from "./replay-clock"

describe("capture clock replay", () => {
  it("keeps nanosecond precision relative to the first event and preserves event order", () => {
    const base = 1_782_600_000_000_000_000n
    const offsets = [0n, 0n, 250_500_000n, 200_000_000n, 1_000_000_000n]
    expect(replayOffsetsMs(offsets.map((offset) => ({ timestamp_ns: String(base + offset) }))))
      .toEqual([0, 0, 250.5, 250.5, 1000])
  })

  it("seeks to the last event at a capture time, including equal timestamps", () => {
    const offsets = [0, 0, 250.5, 250.5, 1000]
    expect(replayIndexAtMs(offsets, -1)).toBe(0)
    expect(replayIndexAtMs(offsets, 0)).toBe(1)
    expect(replayIndexAtMs(offsets, 250)).toBe(1)
    expect(replayIndexAtMs(offsets, 250.5)).toBe(3)
    expect(replayIndexAtMs(offsets, 2000)).toBe(4)
    expect(replayIndexAtMs([], 500)).toBe(0)
  })
})
