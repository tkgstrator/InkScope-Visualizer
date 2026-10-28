import { describe, expect, it } from "bun:test"
import fixture from "../../../api/fixtures/packet-v1.json"
import { parseRecordedSampleResponse } from "./recorded-sample"

const sessionId = fixture.session_id

describe("recorded sample response", () => {
  it("keeps unavailable and empty states distinct", () => {
    expect(parseRecordedSampleResponse({ version: 1, state: "unavailable" })).toMatchObject({ status: "unavailable", events: [] })
    expect(parseRecordedSampleResponse({ version: 1, state: "empty", session_id: sessionId, after_record: "0" }))
      .toMatchObject({ status: "empty", sessionId, afterRecord: "0", events: [] })
  })

  it("validates and orders a bounded set of recorded envelopes", () => {
    const events = [fixture, { ...fixture, record: "2" }]
    expect(parseRecordedSampleResponse({ version: 1, state: "ready", session_id: sessionId, after_record: "0", start_index: 14, events }))
      .toMatchObject({ status: "ready", sessionId, afterRecord: "0", startIndex: 14, events })
  })

  it("rejects malformed, mismatched, or repeated records", () => {
    const valid = { version: 1, state: "ready", session_id: sessionId, after_record: "0", start_index: 0, events: [fixture] }
    for (const response of [
      { ...valid, start_index: undefined },
      { ...valid, start_index: -1 },
      { ...valid, start_index: 1.5 },
      { ...valid, start_index: "1" },
      { ...valid, start_index: Number.MAX_SAFE_INTEGER + 1 },
      { ...valid, events: [] },
      { ...valid, after_record: "1" },
      { ...valid, events: [fixture, fixture] },
      { ...valid, events: [fixture, { ...fixture, record: "3" }] },
      { ...valid, session_id: "other" },
      { ...valid, events: [{ ...fixture, timestamp_ns: "invalid" }] },
      { ...valid, events: [{ ...fixture, rows: [{ kind: "RTTProtocol", status: "authenticated", fields: [{ name: "GameKey", value: "x" }] }] }] },
      { ...valid, events: Array.from({ length: 1201 }, (_, index) => ({ ...fixture, record: String(index + 1) })) },
    ]) expect(() => parseRecordedSampleResponse(response)).toThrow("Invalid recorded sample response")
  })
})
