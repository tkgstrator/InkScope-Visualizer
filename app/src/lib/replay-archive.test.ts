import { describe, expect, test } from "bun:test"
import { samplePacket } from "../../../api/test-fixture"
import { parseReplayBatch, replayBatchSize } from "./replay-archive"

describe("continuous replay batches", () => {
  const session = samplePacket().session_id

  test("uses the largest event batch accepted by the replay API", () => {
    expect(replayBatchSize).toBe(500)
  })

  test("starts after the exclusive cursor and permits record gaps", () => {
    const events = parseReplayBatch([samplePacket("28833"), samplePacket("28835")], session, "28832")
    expect(events.map((event) => event.record)).toEqual(["28833", "28835"])
    expect(parseReplayBatch([], session, "28835")).toEqual([])
  })

  test("rejects duplicates, backward records, and a crossed session", () => {
    expect(() => parseReplayBatch([samplePacket("28832")], session, "28832")).toThrow("Invalid replay event order")
    expect(() => parseReplayBatch([samplePacket("28834"), samplePacket("28833")], session, "28832"))
      .toThrow("Invalid replay event order")
    expect(() => parseReplayBatch([samplePacket("28833", "a61c1c49-4dae-4c6f-aa41-4f7f2a44411e")], session, "28832"))
      .toThrow("Invalid replay event order")
  })

  test("rejects malformed batch responses", () => {
    expect(() => parseReplayBatch(null, session, null)).toThrow("Invalid replay events")
    expect(() => parseReplayBatch({ events: [] }, session, null)).toThrow("Invalid replay events")
  })
})
