import { expect, test } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"
import { samplePacket } from "../../../api/test-fixture"
import { replayGameSnapshotAt } from "@/lib/replay-game-state"
import { ReplayView } from "./replay-view"

test("saved replay shows a continuous captured-time timeline without page controls", () => {
  const first = { ...samplePacket("101"), timestamp_ns: "1793059200000000000" }
  const last = { ...samplePacket("102"), timestamp_ns: "1793059201123456789" }
  const html = renderToStaticMarkup(
    <ReplayView
      source="recorded"
      persistence="postgres"
      sessions={[{ session_id: first.session_id, events: "250", first_timestamp_ns: first.timestamp_ns, last_timestamp_ns: last.timestamp_ns }]}
      selectedSessionId={first.session_id}
      selectedEvents={[first, last]}
      loading={false}
      error={null}
      pageStartIndex={100}
      onSelectSession={() => {}}
      position={1}
      elapsedMs={1123}
      durationMs={1123}
      playing={false}
      onPositionChange={() => {}}
      onElapsedChange={() => {}}
      onPlayingChange={() => {}}
      onRestart={() => {}}
      hud={{ ...replayGameSnapshotAt({ snapshots: [], spawns: [] }, -1), stageId: "Cop_Shakedent", sessionStageId: "Cop_Shakedent", difficulty: "150", quota: "4", enemySpawnCount: 1 }}
      activeSpawns={[]}
      keyStatus="—"
    />,
  )

  expect(html).toContain("#102")
  expect(html).toContain("2026/10/27 09:00:01.123")
  expect(html).toContain("00:01.1 / 00:01.1")
  expect(html).toContain('aria-label="Replay time"')
  expect(html).toContain('aria-label="Replay HUD"')
  expect(html).toContain("Cop_Shakedent")
  expect(html).toContain("DIFFICULTY")
  expect(html).toContain("ENEMY SPAWN")
  expect(html).toContain('aria-label="Replay session"')
  expect(html).not.toContain("PAGE ")
  expect(html).not.toContain("Previous page")
  expect(html).not.toContain("Next page")
  expect(html).not.toContain("Session start")
  expect(html).not.toContain("MOCK RECORDING")
})
