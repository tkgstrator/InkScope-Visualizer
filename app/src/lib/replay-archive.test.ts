import { describe, expect, test } from "bun:test"
import { samplePacket } from "../../../api/test-fixture"
import { hasNextReplayPage, replayDelayMs } from "./replay-archive"

describe("replay page boundaries", () => {
  test("uses the session count even when a page has exactly 100 records", () => {
    expect(hasNextReplayPage("100", 0, 100)).toBe(false)
    expect(hasNextReplayPage("250", 100, 100)).toBe(true)
    expect(hasNextReplayPage("250", 200, 50)).toBe(false)
  })
})

describe("capture time playback", () => {
  const packetAt = (record: string, timestamp_ns: string) => ({ ...samplePacket(record), timestamp_ns })

  test("uses nanosecond deltas in record order", () => {
    const page = [packetAt("1", "1000000000"), packetAt("2", "1250000000")]
    expect(replayDelayMs(page, 0)).toBe(250)
    expect(replayDelayMs(page, 1)).toBeNull()
  })

  test("clamps equal, backward, and long capture gaps", () => {
    expect(replayDelayMs([packetAt("1", "10"), packetAt("2", "10")], 0)).toBe(50)
    expect(replayDelayMs([packetAt("1", "11"), packetAt("2", "10")], 0)).toBe(50)
    expect(replayDelayMs([packetAt("1", "10"), packetAt("2", "100000000000")], 0)).toBe(2000)
  })
})
