import { describe, expect, it } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"
import { StageMap } from "./stage-map"

describe("StageMap data source", () => {
  it("keeps demo position controls only in demo mode", () => {
    const demo = renderToStaticMarkup(<StageMap tick={0} source="demo" />)
    const replay = renderToStaticMarkup(<StageMap tick={0} source="replay" />)
    const recorded = renderToStaticMarkup(<StageMap tick={0} source="recorded" />)

    expect(demo).toContain("Character POV")
    expect(demo).toContain("· DEMO")
    expect(replay).not.toContain("Character POV")
    expect(replay).not.toContain("· DEMO")
    expect(replay).toContain("MANUAL STAGE")
    expect(replay).toContain("OBSERVED Unknown")
    expect(recorded).not.toContain("Character POV")
    expect(recorded).not.toContain("· DEMO")
    expect(recorded).toContain("OBSERVED Unknown")
  })

  it("shows a raw unknown observed stage without representing it as a loaded map", () => {
    const markup = renderToStaticMarkup(<StageMap tick={0} source="replay" observedStageId="Cop_UnknownNewStage" />)

    expect(markup).toContain("OBSERVED Cop_UnknownNewStage · NO ROMFS MAP")
    expect(markup).not.toContain("OBSERVED STAGE")
  })

  it("uses compact replay chrome and exposes only observed spawn locations", () => {
    const markup = renderToStaticMarkup(<StageMap tick={0} source="replay" presentation="replay" observedStageId="Cop_Shakedent"
      replaySpawns={[{ record: "29726", stageId: "Cop_Shakedent", kind: "enemy", actor: "SakeCopter", position: [2.227, 27.7, -19.246], timestampNs: "1" }]} />)

    expect(markup).toContain('aria-label="Replay map Cop_Shakedent"')
    expect(markup).toContain("ENEMY SPAWN 1")
    expect(markup).toContain("Enemy spawn #29726 SakeCopter XYZ 2.227 / 27.7 / -19.246")
    expect(markup).not.toContain("Map &amp; position")
    expect(markup).not.toContain("SHOW MARKERS")
    expect(markup).not.toContain("Character POV")
  })

  it("keeps an unknown replay stage neutral instead of selecting the default stage", () => {
    const markup = renderToStaticMarkup(<StageMap tick={0} source="replay" presentation="replay" observedStageId="Cop_UnknownNewStage" />)
    expect(markup).toContain('aria-label="Replay map Cop_UnknownNewStage"')
    expect(markup).not.toContain("Cop_Shakedent")
  })
})
