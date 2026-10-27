import { describe, expect, test } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"
import { OverviewView } from "./overview-view"

describe("Overview data source", () => {
  test("live mode does not render demo activity or invented values", () => {
    const html = renderToStaticMarkup(
      <OverviewView
        source="live"
        total={null}
        authenticated={null}
        clientRtt={null}
        wave={null}
        waves={[]}
        onWaveChange={() => {}}
        activities={[]}
      />,
    )

    expect(html).toContain("LIVE")
    expect(html).toContain("Observed packets")
    expect(html).toContain("—")
    expect(html).not.toContain("Cop_Shakedent")
    expect(html).not.toContain("192.168.10.157")
    expect(html).not.toContain("RTT response paired")
    expect(html).not.toContain("Event 5")
  })

  test("demo mode keeps selectable wave labels and observed card titles", () => {
    const html = renderToStaticMarkup(
      <OverviewView
        source="demo"
        total={8}
        authenticated={7}
        clientRtt="42.6"
        wave={2}
        waves={[
          { wave: 1, tide: "Low tide", event: "Normal", quota: 21, state: "COMPLETE" },
          { wave: 2, tide: "Normal tide", event: "Event 5", quota: 24, state: "IN PROGRESS" },
        ]}
        onWaveChange={() => {}}
        serverIp="192.168.10.157"
      />,
    )

    expect(html).toContain("WAVE overview")
    expect(html).toContain("Response delay")
    expect(html).toContain("Low tide")
    expect(html).toContain("Quota 24")
  })
})
