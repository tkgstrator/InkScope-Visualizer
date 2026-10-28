import { expect, test, type Page } from "@playwright/test"
import { readFileSync } from "node:fs"

const packet = JSON.parse(readFileSync(new URL("../api/fixtures/packet-v1.json", import.meta.url), "utf8"))
const sessionId = packet.session_id as string
const recordedEvents = [
  { ...packet, record: "1", rows: [{ kind: "OnlineCoopSetting", status: "authenticated", fields: [
    { name: "StageResource", value: "Cop_Shakedent" }, { name: "Difficulty", value: "150" },
  ] }] },
  { ...packet, record: "2", rows: [{ kind: "CoopSequenceNetState", status: "authenticated", fields: [
    { name: "Sequence", value: "0" }, { name: "Quota", value: "4" },
  ] }] },
  { ...packet, record: "3", rows: [{ kind: "RTTProtocol", status: "authenticated", fields: [
    { name: "Type", value: "1" }, { name: "CaptureResponseDelayMs", value: "31.250" },
  ] }] },
]

async function selectReplaySession(page: Page, sessionId: string): Promise<void> {
  await page.getByRole("combobox", { name: "Replay session" }).click()
  await page.getByRole("option", { name: new RegExp(sessionId.slice(0, 8)) }).click()
}

test("recorded sample is the default and never inherits synthetic gameplay", async ({ page }) => {
  await page.route("**/api/sample", (route) => route.fulfill({ json: {
    version: 1, state: "ready", session_id: sessionId, after_record: "0", start_index: 0, events: recordedEvents,
  } }))
  await page.goto("/")
  await expect(page.getByText("RECORDED #1–#3")).toBeVisible()
  const status = page.getByRole("region", { name: "Session status" })
  await expect(status).toContainText("Cop_Shakedent")
  await expect(status).toContainText("150")
  await expect(status).toContainText(/Quota\s*4/)
  await expect(status).toContainText(/WAVE\s*—/)
  await expect(status).not.toContainText("1665")
  await expect(status).not.toContainText("DEMO HEX")

  await page.getByRole("tab", { name: "Debug" }).click()
  await expect(page.getByRole("heading", { name: "Decoded packet view" })).toBeVisible()
  await expect(page.getByText("CoopSequenceNetState").first()).toBeVisible()
  await page.getByRole("tab", { name: /Raw/ }).click()
  await expect(page.getByRole("heading", { name: "Raw packet view" })).toBeVisible()
  await expect(page.getByText("RECORDED BYTES")).toBeVisible()
  await page.getByRole("tab", { name: "3D Map" }).click()
  await expect(page.getByRole("button", { name: "Character POV" })).toHaveCount(0)
  await page.getByRole("tab", { name: "OBS" }).click()
  const overlay = page.frameLocator('iframe[title="OBS overlay preview"]')
  await expect(overlay.getByText("RECORDED")).toBeVisible()
  await expect(overlay.getByText("Cop_Shakedent")).toBeVisible()
  await expect(overlay.getByText("WAVE 02 / 03")).toHaveCount(0)
})

test("missing sample visibly falls back to synthetic demo", async ({ page }) => {
  await page.route("**/api/sample", (route) => route.fulfill({ json: { version: 1, state: "unavailable" } }))
  await page.goto("/")
  await expect(page.getByText("SYNTHETIC · NO SAMPLE")).toBeVisible()
  await expect(page.getByText("Captured packets")).toBeVisible()
})

test("sample read failure stays visible instead of showing fake packets", async ({ page }) => {
  await page.route("**/api/sample", (route) => route.fulfill({ status: 503, json: { error: "read failed" } }))
  await page.goto("/")
  await expect(page.getByRole("alert")).toContainText("RECORDED SAMPLE ERROR · HTTP 503")
  await expect(page.getByText("Captured packets")).toHaveCount(0)
})

test("Debug can page through the entire recorded sample window", async ({ page }) => {
  const events = Array.from({ length: 81 }, (_, index) => ({
    ...packet,
    record: String(index + 1),
    rows: [{ kind: index === 0 ? "OnlineCoopSetting" : "CoopSequenceNetState", status: "authenticated", fields: [] }],
  }))
  await page.route("**/api/sample", (route) => route.fulfill({ json: {
    version: 1, state: "ready", session_id: sessionId, after_record: "0", start_index: 0, events,
  } }))
  await page.goto("/")
  await page.getByRole("tab", { name: "Debug" }).click()
  await expect(page.getByText("RECORDED #1–#81")).toBeVisible()
  await expect(page.getByRole("button", { name: "Older recorded packets" })).toBeVisible()
  await expect(page.getByText("OnlineCoopSetting")).toHaveCount(0)
  await page.getByRole("button", { name: "Older recorded packets" }).click()
  await expect(page.getByText("OnlineCoopSetting").first()).toBeVisible()
  await expect(page.getByText("RECORDS #1–#1")).toBeVisible()
  await page.getByRole("button", { name: "Newer recorded packets" }).click()
  await expect(page.getByText("RECORDS #2–#81")).toBeVisible()
})

test("recorded Replay starts at the configured OnlineCoopSetting window", async ({ page }) => {
  const newerSession = "a61c1c49-4dae-4c6f-aa41-4f7f2a44411e"
  const events = Array.from({ length: 100 }, (_, index) => ({
    ...packet, record: String(101 + index),
    rows: index === 0 ? recordedEvents[0]!.rows : packet.rows,
  }))
  await page.route("**/api/sample", (route) => route.fulfill({ json: {
    version: 1, state: "ready", session_id: sessionId, after_record: "100", start_index: 100, events,
  } }))
  await page.route("**/api/sessions**", (route) => route.fulfill({ json: { version: 1, sessions: [
    { session_id: newerSession, events: "1", first_timestamp_ns: packet.timestamp_ns, last_timestamp_ns: packet.timestamp_ns },
    { session_id: sessionId, events: "200", first_timestamp_ns: packet.timestamp_ns, last_timestamp_ns: packet.timestamp_ns },
  ] } }))
  await page.route(/\/api\/sessions\/[^/]+\/events\?/, (route) => {
    const url = new URL(route.request().url())
    const fromStart = Array.from({ length: 100 }, (_, index) => ({ ...packet, record: String(index + 1) }))
    return route.fulfill({ json: {
      version: 1, session_id: sessionId,
      events: url.pathname.includes(sessionId) ? url.searchParams.get("after_record") === "100" ? events : fromStart : [],
      next_record: "200",
    } })
  })
  await page.goto("/")
  await expect(page.getByRole("tab", { name: "Overview" })).toHaveAttribute("aria-selected", "true")
  await page.getByRole("tab", { name: "Replay" }).click()
  await expect(page.getByRole("combobox", { name: "Replay session" })).toContainText(sessionId.slice(0, 8))
  await expect(page.getByRole("region", { name: "Replay transport" }).getByText("100 / 100", { exact: true })).toBeVisible()
  await expect(page.getByText("RECORDS #101–#200")).toBeVisible()
  await page.locator("summary").filter({ hasText: "EVENTS" }).click()
  await expect(page.getByText("OnlineCoopSetting").first()).toBeVisible()
  await expect(page.getByRole("button", { name: /Next page|Previous page|Session start/ })).toHaveCount(0)
  await page.getByRole("button", { name: "Restart replay" }).click()
  await expect(page.getByText("#101 / #200")).toHaveCount(2)
  await page.locator("summary").filter({ hasText: "EVENTS" }).click()
  await page.setViewportSize({ width: 320, height: 700 })
  const transport = page.getByRole("region", { name: "Replay transport" })
  const sessionBox = await transport.getByRole("combobox", { name: "Replay session" }).boundingBox()
  const countBox = await transport.getByText("100 / 100", { exact: true }).boundingBox()
  expect(sessionBox).not.toBeNull()
  expect(countBox).not.toBeNull()
  expect(sessionBox!.x + sessionBox!.width).toBeLessThan(countBox!.x)
})

test("recorded Replay loads one timeline and plays on the capture clock", async ({ page }) => {
  const baseTime = BigInt(packet.timestamp_ns)
  const eventAt = (record: number) => ({
    ...recordedEvents[(record - 3) % recordedEvents.length],
    record: String(record),
    timestamp_ns: String(baseTime + BigInt(record - 3) * 1_000_000n),
  })
  const firstBatch = Array.from({ length: 500 }, (_, index) => eventAt(index + 3))
  const tail = [eventAt(503), eventAt(504)]
  const secondPageGate = { release: () => {} }
  const waiting = new Promise<void>((resolve) => { secondPageGate.release = resolve })
  const requested = { resolve: () => {} }
  const secondRequest = new Promise<void>((resolve) => { requested.resolve = resolve })
  const cursors: string[] = []
  await page.route("**/api/sample", (route) => route.fulfill({ json: {
    version: 1, state: "ready", session_id: sessionId, after_record: "2", start_index: 2, events: [firstBatch[0]],
  } }))
  await page.route("**/api/sessions**", (route) => route.fulfill({ json: { version: 1, sessions: [
    { session_id: sessionId, events: "504", first_timestamp_ns: firstBatch[0]!.timestamp_ns, last_timestamp_ns: tail[1]!.timestamp_ns },
  ] } }))
  await page.route(/\/api\/sessions\/[^/]+\/events\?/, async (route) => {
    const cursor = new URL(route.request().url()).searchParams.get("after_record") ?? ""
    cursors.push(cursor)
    if (cursor === "502") {
      requested.resolve()
      await waiting
    }
    await route.fulfill({ json: { version: 1, session_id: sessionId, events: cursor === "2" ? firstBatch : tail } })
  })

  await page.goto("/")
  await expect(page.getByRole("tab", { name: "Overview" })).toHaveAttribute("aria-selected", "true")
  await page.getByRole("tab", { name: "Replay" }).click()
  await secondRequest
  await expect(page.getByText("LOADING 500 / 502").first()).toBeVisible()
  secondPageGate.release()
  await expect(page.getByText("RECORDS #3–#504")).toBeVisible()
  await expect(page.getByRole("region", { name: "Replay transport" }).getByText("502 / 502", { exact: true })).toBeVisible()
  await page.locator("summary").filter({ hasText: "EVENTS" }).click()
  await expect(page.getByText("OnlineCoopSetting").first()).toBeVisible()
  await expect(page.getByRole("button", { name: /Next page|Previous page|Session start/ })).toHaveCount(0)
  const slider = page.getByRole("slider", { name: "Replay time" })
  await expect(slider).toHaveAttribute("aria-valuenow", "0")
  await page.getByRole("button", { name: "Play replay" }).click()
  await expect.poll(async () => Number(await slider.getAttribute("aria-valuenow"))).toBeGreaterThan(0)
  await expect(page.getByText("SESSION END")).toBeVisible()
  await expect(page.getByText("#504 / #504")).toHaveCount(2)
  expect(cursors).toEqual(["2", "502"])
})

test("a manual Replay selection wins over a pending preferred-session refresh", async ({ page }) => {
  const otherSession = "a61c1c49-4dae-4c6f-aa41-4f7f2a44411e"
  const control = { holdNext: false, markHeld: () => {}, release: () => {} }
  const held = new Promise<void>((resolve) => { control.markHeld = resolve })
  const gate = new Promise<void>((resolve) => { control.release = resolve })
  await page.route("**/api/sample", (route) => route.fulfill({ json: {
    version: 1, state: "ready", session_id: sessionId, after_record: "0", start_index: 0, events: recordedEvents,
  } }))
  await page.route("**/api/sessions**", async (route) => {
    if (control.holdNext) { control.holdNext = false; control.markHeld(); await gate }
    try { await route.fulfill({ json: { version: 1, sessions: [
      { session_id: sessionId, events: "3", first_timestamp_ns: packet.timestamp_ns, last_timestamp_ns: packet.timestamp_ns },
      { session_id: otherSession, events: "1", first_timestamp_ns: packet.timestamp_ns, last_timestamp_ns: packet.timestamp_ns },
    ] } }) } catch { /* The browser may cancel a held request. */ }
  })
  await page.route(/\/api\/sessions\/[^/]+\/events\?/, (route) => route.fulfill({ json: {
    version: 1, events: [route.request().url().includes(otherSession) ? { ...packet, session_id: otherSession, record: "1" } : recordedEvents[0]],
  } }))
  await page.goto("/")
  await page.getByRole("tab", { name: "Replay" }).click()
  await expect(page.getByRole("combobox", { name: "Replay session" })).toContainText(sessionId.slice(0, 8))
  await selectReplaySession(page, otherSession)
  await expect(page.getByRole("combobox", { name: "Replay session" })).toContainText(otherSession.slice(0, 8))
  await page.getByRole("tab", { name: "Debug" }).click()
  control.holdNext = true
  await page.getByRole("tab", { name: "Replay" }).click()
  await held
  await selectReplaySession(page, otherSession)
  control.release()
  await expect(page.getByRole("combobox", { name: "Replay session" })).toContainText(otherSession.slice(0, 8))
})

test("Retry keeps a manually selected session", async ({ page }) => {
  const otherSession = "a61c1c49-4dae-4c6f-aa41-4f7f2a44411e"
  const control = { failOther: true }
  await page.route("**/api/sample", (route) => route.fulfill({ json: {
    version: 1, state: "ready", session_id: sessionId, after_record: "0", start_index: 0, events: recordedEvents,
  } }))
  await page.route("**/api/sessions**", (route) => route.fulfill({ json: { version: 1, sessions: [
    { session_id: sessionId, events: "3", first_timestamp_ns: packet.timestamp_ns, last_timestamp_ns: packet.timestamp_ns },
    { session_id: otherSession, events: "1", first_timestamp_ns: packet.timestamp_ns, last_timestamp_ns: packet.timestamp_ns },
  ] } }))
  await page.route(/\/api\/sessions\/[^/]+\/events\?/, (route) => {
    const other = route.request().url().includes(otherSession)
    if (other && control.failOther) {
      control.failOther = false
      return route.fulfill({ status: 503, json: { error: "temporary" } })
    }
    return route.fulfill({ json: { version: 1, events: other
      ? [{ ...packet, session_id: otherSession, record: "7" }] : recordedEvents } })
  })

  await page.goto("/")
  await page.getByRole("tab", { name: "Replay" }).click()
  await selectReplaySession(page, otherSession)
  await expect(page.getByRole("alert")).toContainText("HTTP 503")
  await page.getByRole("button", { name: "Retry" }).click()
  await expect(page.getByRole("combobox", { name: "Replay session" })).toContainText(otherSession.slice(0, 8))
  await expect(page.getByText("RECORDS #7–#7")).toBeVisible()
})
