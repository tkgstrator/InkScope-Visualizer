import { describe, expect, it } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"
import { SessionStatus } from "./session-status"
import type { PacketEnvelope } from "../../../../api/wire"
import { emptySessionObservation, foldObservationSnapshot } from "../../lib/session-observation"

function event(record: string, kind: string, fields: Array<{ name: string; value: string }>, options: {
  status?: string
  source?: string
  destination?: string
  session?: string
} = {}): PacketEnvelope {
  return {
    version: 1, type: "packet", session_id: options.session ?? "d61c1c49-4dae-4c6f-aa41-4f7f2a44411e",
    record, timestamp_ns: "1793059200123456789",
    packet: { source_ip: options.source ?? "192.0.2.10", source_port: 49152, source_mac: "02:00:00:00:00:10", destination_ip: options.destination ?? "192.0.2.11", destination_port: 49153, destination_mac: "02:00:00:00:00:11", payload_hex: "00" },
    rows: [{ kind, status: options.status ?? "authenticated", fields }],
  }
}

function html(events: PacketEnvelope[]): string {
  return renderToStaticMarkup(<SessionStatus source="live" connection="connected" observation={foldObservationSnapshot(emptySessionObservation(), events)} serverRtt="0" clientRtt="0" wave={1} quota={0} />)
}

describe("observed PrivateSetting status", () => {
  it("renders cumulative observation even when the visible event window has another stage", () => {
    const observation = foldObservationSnapshot(emptySessionObservation(), [
      event("1", "PrivateSetting", [{ name: "StageId", value: "Cop_Trusted" }, { name: "Wave", value: "2" }, { name: "Tide", value: "High" }]),
      ...Array.from({ length: 513 }, (_, index) => event(String(index + 2), "Net 0x32", [], { status: "observed_unverified" })),
    ])
    const markup = renderToStaticMarkup(<SessionStatus source="live" observation={observation} serverRtt="0" clientRtt="0" wave={1} quota={0} />)
    expect(markup).toContain("Cop_Trusted")
    expect(markup).toContain("High")
    expect(markup).toContain("WAVE</span><b>2</b>")
  })

  it("prefers authenticated PrivateSetting over older stage and difficulty fields", () => {
    const markup = html([
      event("1", "OnlineCoopSetting", [{ name: "StageResource", value: "Cop_Old" }, { name: "Difficulty", value: "25" }]),
      event("2", "PrivateSetting", [{ name: "StageId", value: "Cop_Shakeup" }, { name: "Difficulty", value: "775" }]),
    ])
    expect(markup).toContain("Cop_Shakeup")
    expect(markup).toContain("775")
    expect(markup).not.toContain("Cop_Old")
  })

  it("clears an explicitly empty PrivateSetting stage without reviving a stale value", () => {
    const markup = html([
      event("1", "OnlineCoopSetting", [{ name: "StageResource", value: "Cop_Old" }]),
      event("2", "PrivateSetting", [{ name: "StageId", value: "" }]),
    ])
    expect(markup).toContain("StageId</span><b class=\"truncate\">—</b>")
    expect(markup).not.toContain("Cop_Old")
  })
})

describe("observed peer roles and delay", () => {
  it("uses verified BrowseReply host and shows delay for each matching client pair", () => {
    const markup = html([
      event("1", "BrowseReply", [{ name: "HostIPv4", value: "192.0.2.10" }], { status: "proof_verified" }),
      event("2", "RTTProtocol", [{ name: "Type", value: "1" }, { name: "CaptureResponseDelayMs", value: "38.2" }]),
      event("3", "BrowseReply", [{ name: "HostIPv4", value: "192.0.2.10" }], { status: "proof_verified", destination: "192.0.2.12" }),
      event("4", "RTTProtocol", [{ name: "Type", value: "1" }, { name: "CaptureResponseDelayMs", value: "46.7" }], { source: "192.0.2.12", destination: "192.0.2.10" }),
      event("5", "RTTProtocol", [{ name: "Type", value: "1" }, { name: "CaptureResponseDelayMs", value: "999" }], { source: "192.0.2.13", destination: "192.0.2.14" }),
      event("6", "RTTProtocol", [{ name: "Type", value: "1" }, { name: "CaptureResponseDelayMs", value: "39.2" }], { source: "192.0.2.11", destination: "192.0.2.10" }),
      event("7", "RTTProtocol", [{ name: "Type", value: "0" }, { name: "CaptureResponseDelayMs", value: "88.8" }], { source: "192.0.2.10", destination: "192.0.2.11" }),
      event("8", "Net 0x32", [], { status: "observed_unverified", source: "192.0.2.10", destination: "192.0.2.22" }),
      event("9", "Net 0x32", [], { status: "observed_unverified", source: "192.0.2.10", destination: "255.255.255.255" }),
    ])
    expect(markup).toContain("SERVER")
    expect(markup).toContain("192.0.2.10")
    expect(markup).toContain("CLIENT")
    expect(markup).toContain("192.0.2.11")
    expect(markup).toContain("192.0.2.12")
    expect(markup).toContain("39.2 ms")
    expect(markup).toContain("46.7 ms")
    expect(markup).not.toContain("38.2 ms")
    expect(markup).not.toContain("88.8 ms")
    expect(markup).not.toContain("999 ms")
    expect(markup).not.toContain("192.0.2.22")
    expect(markup).not.toContain("255.255.255.255")
    expect(markup).toContain("DELAY")
  })

  it("does not reuse delay from a prior verified host or a prior session", () => {
    const markup = html([
      event("1", "BrowseReply", [{ name: "HostIPv4", value: "192.0.2.10" }], { status: "proof_verified" }),
      event("2", "RTTProtocol", [{ name: "Type", value: "1" }, { name: "CaptureResponseDelayMs", value: "38.2" }]),
      event("3", "BrowseReply", [{ name: "HostIPv4", value: "192.0.2.20" }], { status: "proof_verified", source: "192.0.2.20", destination: "192.0.2.21" }),
      event("4", "RTTProtocol", [{ name: "Type", value: "1" }, { name: "CaptureResponseDelayMs", value: "50.1" }], { source: "192.0.2.20", destination: "192.0.2.21", session: "45d87777-2eb3-426a-8c43-5d52ee84976e" }),
      event("5", "BrowseReply", [{ name: "HostIPv4", value: "192.0.2.20" }], { status: "proof_verified", source: "192.0.2.20", destination: "192.0.2.21" }),
    ])
    expect(markup).toContain("192.0.2.20")
    expect(markup).toContain("192.0.2.21")
    expect(markup).not.toContain("38.2 ms")
    expect(markup).not.toContain("50.1 ms")
  })

  it("keeps endpoint labels when no host proof exists and uses only the same pair delay", () => {
    const markup = html([
      event("1", "RTTProtocol", [{ name: "Type", value: "1" }, { name: "CaptureResponseDelayMs", value: "99" }], { source: "192.0.2.40", destination: "192.0.2.41" }),
      event("2", "RTTProtocol", [{ name: "Type", value: "1" }, { name: "CaptureResponseDelayMs", value: "12.5" }], { source: "192.0.2.31", destination: "192.0.2.30" }),
      event("3", "Net 0x32", [], { source: "192.0.2.30", destination: "192.0.2.31" }),
    ])
    expect(markup).toContain("SOURCE")
    expect(markup).toContain("DEST")
    expect(markup).not.toContain("SERVER")
    expect(markup).not.toContain("CLIENT")
    expect(markup).toContain("12.5 ms")
    expect(markup).not.toContain("99 ms")

    const unmatched = html([
      event("1", "RTTProtocol", [{ name: "Type", value: "1" }, { name: "CaptureResponseDelayMs", value: "99" }], { source: "192.0.2.40", destination: "192.0.2.41" }),
      event("2", "Net 0x32", [], { source: "192.0.2.30", destination: "192.0.2.31" }),
    ])
    expect(unmatched).toContain("DELAY —")
    expect(unmatched).not.toContain("99 ms")
  })
})

describe("recorded sample status", () => {
  it("shows only recorded observations and does not inherit live or synthetic values", () => {
    const observation = foldObservationSnapshot(emptySessionObservation(), [
      event("1", "OnlineCoopSetting", [{ name: "StageResource", value: "Cop_Shakeup" }, { name: "Difficulty", value: "150" }]),
      event("2", "CoopSequenceNetState", [{ name: "Quota", value: "4" }, { name: "Sequence", value: "1" }]),
    ])
    const markup = renderToStaticMarkup(<SessionStatus source="recorded" observation={observation} connection="connected" localGameKey="00112233445566778899aabbccddeeff" serverRtt="99" clientRtt="88" wave={2} quota={24} />)

    expect(markup).toContain("RECORDED")
    expect(markup).toContain("Cop_Shakeup")
    expect(markup).toContain("150")
    expect(markup).toContain("Quota</span><b>4</b>")
    expect(markup).toContain("Sequence</span><b>1</b>")
    expect(markup).toContain("WAVE</span><b>—</b>")
    expect(markup).toContain("Tide</span><b>—</b>")
    expect(markup).not.toContain("CONNECTED")
    expect(markup).not.toContain("DEMO HEX")
    expect(markup).not.toContain("00112233445566778899aabbccddeeff")
    expect(markup).not.toContain("1665")
    expect(markup).not.toContain("24</b>")
  })
})
