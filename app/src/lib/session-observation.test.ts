import { describe, expect, it } from "bun:test"
import type { PacketEnvelope } from "../../../api/wire"
import { emptySessionObservation, foldObservation, foldObservationSnapshot } from "./session-observation"

const session = "d61c1c49-4dae-4c6f-aa41-4f7f2a44411e"
const otherSession = "45d87777-2eb3-426a-8c43-5d52ee84976e"

function packet(record: string, kind: string, fields: Array<{ name: string; value: string }> = [], options: {
  sessionId?: string; status?: string; source?: string; destination?: string; preview?: boolean
} = {}): PacketEnvelope {
  return {
    version: 1, type: "packet", session_id: options.sessionId ?? session, record,
    timestamp_ns: "1793059200123456789",
    packet: { source_ip: options.source ?? "192.0.2.10", source_port: 49152, source_mac: "02:00:00:00:00:10", destination_ip: options.destination ?? "192.0.2.11", destination_port: 49153, destination_mac: "02:00:00:00:00:11", payload_hex: "00" },
    rows: [{ kind, status: options.status ?? "authenticated", fields, ...(options.preview ? {
      wave_preview: { status: "conditional", source: "setting", assumptions: [], scenarios: [{ is_big_run: false, global_word_class: "x", waves: [{ wave_index: 1, event_id: 1, tide_id: 2 }] }] },
    } : {}) }],
  }
}

describe("cumulative session observation", () => {
  it("keeps early verified host and fields after the visible 512 event window", () => {
    const first = packet("1", "BrowseReply", [{ name: "HostIPv4", value: "192.0.2.10" }], { status: "proof_verified" })
    let observed = foldObservationSnapshot(emptySessionObservation(), [first,
      packet("2", "PrivateSetting", [{ name: "StageId", value: "Cop_Shakeup" }, { name: "Difficulty", value: "775" }]),
    ])
    for (let record = 3; record <= 515; record++) observed = foldObservation(observed, packet(String(record), "Net 0x32", [], { status: "observed_unverified" }))
    expect(observed.host).toBe("192.0.2.10")
    expect(observed.stageId).toBe("Cop_Shakeup")
    expect(observed.difficulty).toBe("775")
    expect(observed.observedRecords).toBe(515)
  })

  it("deduplicates snapshot overlap and orders u64 records with BigInt", () => {
    const high = packet("18446744073709551614", "PrivateSetting", [{ name: "StageId", value: "Cop_High" }])
    const max = packet("18446744073709551615", "PrivateSetting", [{ name: "StageId", value: "Cop_Max" }])
    let observed = foldObservationSnapshot(emptySessionObservation(), [max, high])
    observed = foldObservationSnapshot(observed, [high, max])
    observed = foldObservation(observed, high)
    expect(observed.record).toBe(max.record)
    expect(observed.stageId).toBe("Cop_Max")
    expect(observed.observedRecords).toBe(2)
    expect(observed.authenticatedRecords).toBe(2)
  })

  it("preserves a same-session reconnect and resets for a new session or verified host", () => {
    let observed = foldObservationSnapshot(emptySessionObservation(), [
      packet("1", "BrowseReply", [{ name: "HostIPv4", value: "192.0.2.10" }], { status: "proof_verified" }),
      packet("2", "RTTProtocol", [{ name: "Type", value: "1" }, { name: "CaptureResponseDelayMs", value: "38.2" }]),
    ])
    observed = foldObservationSnapshot(observed, [packet("2", "RTTProtocol", [{ name: "Type", value: "1" }, { name: "CaptureResponseDelayMs", value: "38.2" }]), packet("3", "Net 0x32", [], { status: "observed_unverified" })])
    expect(observed.host).toBe("192.0.2.10")
    expect(observed.clients).toEqual([{ ip: "192.0.2.11", delay: "38.2" }])
    expect(observed.observedRecords).toBe(3)
    expect(observed.authenticatedRecords).toBe(2)

    observed = foldObservation(observed, packet("4", "BrowseReply", [{ name: "HostIPv4", value: "192.0.2.20" }], { status: "proof_verified", source: "192.0.2.20", destination: "192.0.2.21" }))
    expect(observed.host).toBe("192.0.2.20")
    expect(observed.clients).toEqual([{ ip: "192.0.2.21", delay: null }])
    expect(observed.observedRecords).toBe(1)
    expect(observed.authenticatedRecords).toBe(1)

    observed = foldObservation(observed, packet("1", "Net 0x32", [], { sessionId: otherSession }))
    expect(observed.sessionId).toBe(otherSession)
    expect(observed.host).toBeNull()
    expect(observed.observedRecords).toBe(1)
  })

  it("uses only authenticated explicit settings and keeps preview separate from observed wave and tide", () => {
    let observed = foldObservationSnapshot(emptySessionObservation(), [
      packet("1", "OnlineCoopSetting", [{ name: "StageResource", value: "Cop_Old" }, { name: "Difficulty", value: "25" }]),
      packet("2", "PrivateSetting", [{ name: "StageId", value: "Cop_Trusted" }, { name: "Difficulty", value: "775" }, { name: "JobType", value: "1" }], { preview: true }),
      packet("3", "CoopSequenceNetState", [{ name: "Quota", value: "24" }, { name: "Sequence", value: "1" }, { name: "Wave", value: "2" }, { name: "Tide", value: "High" }]),
      packet("4", "PrivateSetting", [{ name: "StageId", value: "Cop_False" }, { name: "Wave", value: "3" }, { name: "Tide", value: "Low" }], { status: "malformed" }),
    ])
    expect(observed.stageId).toBe("Cop_Trusted")
    expect(observed.difficulty).toBe("775")
    expect(observed.jobType).toBe("1")
    expect(observed.quota).toBe("24")
    expect(observed.sequence).toBe("1")
    expect(observed.wave).toBe("2")
    expect(observed.tide).toBe("High")
    expect(observed.wavePreview?.status).toBe("conditional")
    observed = foldObservation(observed, packet("5", "PrivateSetting", [{ name: "StageId", value: "" }]))
    expect(observed.stageId).toBeNull()
  })

  it("rejects unverified host, invalid delay, and malformed record without changing counts", () => {
    let observed = foldObservation(emptySessionObservation(), packet("1", "BrowseReply", [{ name: "HostIPv4", value: "192.0.2.10" }], { status: "proof_verified", source: "192.0.2.12" }))
    observed = foldObservation(observed, packet("2", "RTTProtocol", [{ name: "Type", value: "1" }, { name: "CaptureResponseDelayMs", value: "0" }]))
    observed = foldObservation(observed, packet("bad", "PrivateSetting", [{ name: "StageId", value: "Fake" }]))
    expect(observed.host).toBeNull()
    expect(observed.pairDelay).toBeNull()
    expect(observed.stageId).toBeNull()
    expect(observed.observedRecords).toBe(2)
  })
})
