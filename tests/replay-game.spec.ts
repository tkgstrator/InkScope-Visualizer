import { expect, test } from "@playwright/test"
import { readFileSync } from "node:fs"

const packet = JSON.parse(readFileSync(new URL("../api/fixtures/packet-v1.json", import.meta.url), "utf8"))
const baseTime = BigInt(packet.timestamp_ns)
const event = (record: number, seconds: number, kind: string, fields: Array<{ name: string, value: string }>) => ({
  ...packet,
  record: String(record),
  timestamp_ns: String(baseTime + BigInt(seconds) * 1_000_000_000n),
  rows: [{ kind, status: "authenticated", fields }],
})
const events = [
  event(1, 0, "OnlineCoopSetting", [
    { name: "StageResource", value: "Cop_Shakedent" },
    { name: "StageName", value: "Gone Fission Hydroplant" },
    { name: "Difficulty", value: "150" },
  ]),
  event(2, 1, "CoopSequenceNetState", [
    { name: "Sequence", value: "1" },
    { name: "Quota", value: "4" },
  ]),
  event(3, 2, "CoopEnemySpawnNetEvent", [
    { name: "SalmonType", value: "SakeCopter" },
    { name: "SpawnX", value: "2.227" },
    { name: "SpawnY", value: "27.700" },
    { name: "SpawnZ", value: "-19.246" },
  ]),
  event(4, 3, "CoopSequenceNetState", [{ name: "Sequence", value: "1" }]),
  event(5, 4, "PrivateSetting", [{ name: "StageId", value: "Cop_Unknown" }]),
  event(6, 5, "PrivateSetting", [{ name: "StageId", value: "" }]),
]

test("Replay HUD and 3D map follow the capture clock when seeking", async ({ page }) => {
  await page.route("**/api/sample", (route) => route.fulfill({ json: {
    version: 1, state: "ready", session_id: packet.session_id, after_record: "0", start_index: 0, events,
  } }))
  await page.route("**/api/sessions**", (route) => route.fulfill({ json: { version: 1, sessions: [
    { session_id: packet.session_id, events: "6", first_timestamp_ns: events[0]!.timestamp_ns, last_timestamp_ns: events[5]!.timestamp_ns },
  ] } }))
  await page.route(/\/api\/sessions\/[^/]+\/events\?/, (route) => route.fulfill({ json: {
    version: 1, session_id: packet.session_id, events,
  } }))

  await page.goto("/")
  await page.getByRole("tab", { name: "Replay" }).click()
  await expect(page.getByRole("region", { name: "Replay HUD" })).toContainText("Cop_Shakedent")
  await expect(page.getByRole("region", { name: "Replay HUD" })).toContainText("DIFFICULTY 150")
  await expect(page.getByRole("region", { name: "Replay map Cop_Shakedent" })).toBeVisible()
  await expect(page.locator("canvas")).toBeVisible()
  await expect(page.getByRole("region", { name: "Replay HUD" })).toContainText("Wave —")
  await expect(page.getByRole("region", { name: "Replay HUD" }).locator('[aria-label="Golden eggs delivered unknown; target unknown"]')).toHaveText("—/—")
  await expect(page.getByRole("region", { name: "Replay HUD" }).locator('[aria-label="Player slot 1; participant and weapon unknown"]')).toBeVisible()
  await expect(page.getByRole("list", { name: "Replay spawn locations" })).toHaveCount(0)

  await page.locator("summary").filter({ hasText: "EVENTS" }).click()
  await page.getByRole("button", { name: /#3.*CoopEnemySpawnNetEvent/ }).click()
  await expect(page.getByRole("region", { name: "Replay HUD" }).locator('[aria-label="Golden eggs delivered unknown; target unknown"]')).toHaveText("—/—")
  await page.locator('summary[aria-label="Replay network details"]').click()
  await expect(page.getByRole("region", { name: "Replay HUD" }).getByText("RAW QUOTA 4")).toBeVisible()
  await expect(page.getByRole("region", { name: "Replay HUD" }).getByText("ENEMY SPAWN 1")).toBeVisible()
  await page.locator('summary[aria-label="Replay network details"]').click()
  await expect(page.getByRole("list", { name: "Replay spawn locations" })).toContainText("SakeCopter XYZ 2.227 / 27.7 / -19.246")
  await expect(page.getByText("00:02.0 / 00:05.0")).toBeVisible()
  await page.getByRole("button", { name: "View from +X" }).click()
  await expect(page.getByRole("button", { name: "View from +X" })).toHaveAttribute("aria-pressed", "true")
  await page.getByRole("button", { name: /#1.*OnlineCoopSetting/ }).click()
  await expect(page.getByRole("region", { name: "Replay HUD" })).toContainText("KEY")
  await expect(page.getByRole("list", { name: "Replay spawn locations" })).toHaveCount(0)
  await expect(page.getByRole("button", { name: "3D orbit view" })).toHaveAttribute("aria-pressed", "true")

  await page.getByRole("button", { name: /#3.*CoopEnemySpawnNetEvent/ }).click()
  await page.getByRole("button", { name: "View from +X" }).click()
  await page.getByRole("slider", { name: "Replay time" }).press("Home")
  await expect(page.getByRole("button", { name: "3D orbit view" })).toHaveAttribute("aria-pressed", "true")
  await page.getByRole("button", { name: /#3.*CoopEnemySpawnNetEvent/ }).click()
  await page.getByRole("button", { name: "View from +X" }).click()
  const thumb = await page.getByRole("slider", { name: "Replay time" }).boundingBox()
  const track = await page.getByRole("slider", { name: "Replay time" }).locator("../..").boundingBox()
  expect(thumb).not.toBeNull()
  expect(track).not.toBeNull()
  await page.mouse.move(thumb!.x + thumb!.width / 2, thumb!.y + thumb!.height / 2)
  await page.mouse.down()
  await page.mouse.move(track!.x, track!.y + track!.height / 2, { steps: 4 })
  await page.mouse.up()
  await expect(page.getByRole("slider", { name: "Replay time" })).toHaveAttribute("aria-valuenow", "0")
  await expect(page.getByRole("button", { name: "3D orbit view" })).toHaveAttribute("aria-pressed", "true")
  await page.getByRole("button", { name: "View from +X" }).click()
  await page.getByRole("button", { name: "Restart replay" }).click()
  await expect(page.getByRole("button", { name: "3D orbit view" })).toHaveAttribute("aria-pressed", "true")

  await page.getByRole("button", { name: /#5.*PrivateSetting/ }).click()
  await expect(page.getByRole("region", { name: "Replay HUD" })).toContainText("Cop_Unknown")
  await expect(page.getByRole("region", { name: "Replay map Cop_Unknown" })).toBeVisible()
  await expect(page.getByRole("region", { name: "Replay HUD" })).not.toContainText("Gone Fission Hydroplant")
  await expect(page.getByRole("list", { name: "Replay spawn locations" })).toHaveCount(0)
  await page.getByRole("button", { name: /#6.*PrivateSetting/ }).click()
  await expect(page.getByRole("region", { name: "Replay map Cop_Unknown" })).toBeVisible()
})

test("Replay HUD countdown advances between GameFrame packets and clears on restart", async ({ page }) => {
  const frameEvents = [
    event(1, 0, "OnlineCoopSetting", [{ name: "StageResource", value: "Cop_Shakedent" }]),
    event(2, 1, "CoopSequenceNetState", [{ name: "Sequence", value: "0" }]),
    event(3, 2, "CoopEnemySpawnNetEvent", [{ name: "GameFrame", value: "1358" }]),
    event(4, 12, "CoopSequenceNetState", [{ name: "Sequence", value: "0" }]),
  ]
  await page.route("**/api/sample", (route) => route.fulfill({ json: {
    version: 1, state: "ready", session_id: packet.session_id, after_record: "0", start_index: 0, events: frameEvents,
  } }))
  await page.route("**/api/sessions**", (route) => route.fulfill({ json: { version: 1, sessions: [
    { session_id: packet.session_id, events: "4", first_timestamp_ns: frameEvents[0]!.timestamp_ns, last_timestamp_ns: frameEvents[3]!.timestamp_ns },
  ] } }))
  await page.route(/\/api\/sessions\/[^/]+\/events\?/, (route) => route.fulfill({ json: {
    version: 1, session_id: packet.session_id, events: frameEvents,
  } }))

  await page.goto("/")
  await page.getByRole("tab", { name: "Replay" }).click()
  const remaining = page.getByRole("region", { name: "Replay HUD" }).locator(".replay-hud-display").first()
  await expect(remaining).toHaveAttribute("aria-label", "Remaining time unavailable")
  await page.locator("summary").filter({ hasText: "EVENTS" }).click()
  await page.getByRole("button", { name: /#3.*CoopEnemySpawnNetEvent/ }).click()
  await expect(remaining).toHaveAttribute("aria-label", "Estimated remaining time 100 seconds")
  await page.getByRole("button", { name: "Play replay" }).click()
  await expect(remaining).toHaveAttribute("aria-label", "Estimated remaining time 99 seconds", { timeout: 4_000 })
  await page.getByRole("button", { name: "Restart replay" }).click()
  await expect(remaining).toHaveAttribute("aria-label", "Remaining time unavailable")
})
