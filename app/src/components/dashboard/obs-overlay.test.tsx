import { expect, test } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"
import { samplePacket } from "../../../../api/test-fixture"
import { emptySessionObservation } from "@/lib/session-observation"
import { Overlay } from "./obs-overlay"

test("recorded overlay renders only captured fields", () => {
  const observation = {
    ...emptySessionObservation(),
    host: "192.0.2.10",
    clients: [{ ip: "192.0.2.11", delay: "31.250" }],
    stageId: "Cop_Shakeup",
    difficulty: "150",
    quota: "4",
    sequence: "1",
  }
  const event = { ...samplePacket("2"), rows: [{ kind: "CoopSequenceNetState", status: "authenticated", fields: [] }] }
  const html = renderToStaticMarkup(<Overlay source="recorded" recordedObservation={observation} recordedEvent={event}
    serverRtt="99" clientRtt="88" wave={2} quota={24} />)

  expect(html).toContain("RECORDED")
  expect(html).toContain("192.0.2.10")
  expect(html).toContain("192.0.2.11")
  expect(html).toContain("31.250")
  expect(html).toContain("Cop_Shakeup")
  expect(html).toContain("DIFFICULTY</span><span>150</span>")
  expect(html).toContain("QUOTA</span><span>4</span>")
  expect(html).toContain("CoopSequenceNetState")
  expect(html).not.toContain("WAVE 02")
  expect(html).not.toContain("Quota 24")
  expect(html).not.toContain("Cop_Shakedent")
  expect(html).not.toContain("88ms")
  expect(html).not.toContain("STREAM")
})
