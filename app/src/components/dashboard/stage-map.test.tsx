import { describe, expect, it } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"
import { StageMap } from "./stage-map"

describe("StageMap data source", () => {
  it("keeps demo position controls only in demo mode", () => {
    const demo = renderToStaticMarkup(<StageMap tick={0} source="demo" />)
    const replay = renderToStaticMarkup(<StageMap tick={0} source="replay" />)

    expect(demo).toContain("Character POV")
    expect(demo).toContain("· DEMO")
    expect(replay).not.toContain("Character POV")
    expect(replay).not.toContain("· DEMO")
    expect(replay).toContain("MANUAL STAGE")
    expect(replay).toContain("OBSERVED Unknown")
  })

  it("shows a raw unknown observed stage without representing it as a loaded map", () => {
    const markup = renderToStaticMarkup(<StageMap tick={0} source="replay" observedStageId="Cop_UnknownNewStage" />)

    expect(markup).toContain("OBSERVED Cop_UnknownNewStage · NO ROMFS MAP")
    expect(markup).not.toContain("OBSERVED STAGE")
  })
})
