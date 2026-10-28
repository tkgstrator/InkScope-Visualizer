import { expect, test } from "@playwright/test"
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
  const events = Array.from({ length: 100 }, (_, index) => ({ ...packet, record: String(101 + index) }))
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
  await page.getByRole("tab", { name: "Replay" }).click()
  await expect(page.getByRole("button", { name: `Session ${sessionId}` })).toHaveAttribute("aria-pressed", "true")
  await expect(page.getByText("101–200 / 200")).toBeVisible()
  await expect(page.getByText("RECORDS #101–#200")).toBeVisible()
  await page.getByRole("button", { name: "Session start" }).click()
  await expect(page.getByText("1–100 / 200")).toBeVisible()
})

test("recorded Replay plays past the first page and stops at the session end", async ({ page }) => {
  const firstPage = Array.from({ length: 100 }, (_, index) => ({
    ...recordedEvents[index % recordedEvents.length], record: String(index + 3),
  }))
  const secondPage = [
    { ...recordedEvents[1], record: "103" },
    { ...recordedEvents[2], record: "104" },
  ]
  let releaseSecondPage: () => void = () => {}
  const secondPageGate = new Promise<void>((resolve) => { releaseSecondPage = resolve })
  let secondPageRequested: () => void = () => {}
  const secondPageRequest = new Promise<void>((resolve) => { secondPageRequested = resolve })
  const cursors: string[] = []
  await page.route("**/api/sample", (route) => route.fulfill({ json: {
    version: 1, state: "ready", session_id: sessionId, after_record: "2", start_index: 2, events: [...firstPage, ...secondPage],
  } }))
  await page.route("**/api/sessions**", (route) => route.fulfill({ json: { version: 1, sessions: [
    { session_id: sessionId, events: "104", first_timestamp_ns: packet.timestamp_ns, last_timestamp_ns: packet.timestamp_ns },
  ] } }))
  await page.route(/\/api\/sessions\/[^/]+\/events\?/, async (route) => {
    const cursor = new URL(route.request().url()).searchParams.get("after_record") ?? ""
    cursors.push(cursor)
    if (cursor === "102") {
      secondPageRequested()
      await secondPageGate
    }
    await route.fulfill({ json: { version: 1, session_id: sessionId, events: cursor === "2" ? [...firstPage, secondPage[0]] : secondPage } })
  })

  await page.goto("/")
  await expect(page.getByRole("tab", { name: "Overview" })).toHaveAttribute("aria-selected", "true")
  await page.getByRole("tab", { name: "Replay" }).click()
  await expect(page.getByText("RECORDS #3–#102")).toBeVisible()
  await expect(page.getByText("OnlineCoopSetting").first()).toBeVisible()
  const slider = page.locator('[data-slot="slider-thumb"]').first()
  await slider.focus()
  await slider.press("End")
  await page.getByRole("button", { name: "Play replay" }).click()
  await secondPageRequest
  await expect(page.getByRole("button", { name: "Pause replay" })).toBeEnabled()
  releaseSecondPage()
  await expect(page.getByText("RECORDS #103–#104")).toBeVisible()
  await expect(page.getByText("SESSION END")).toBeVisible()
  await expect(page.getByRole("button", { name: "Play replay" })).toBeVisible()
  expect(cursors).toEqual(["2", "102"])
})

test("a manual Replay selection wins over a pending preferred-session refresh", async ({ page }) => {
  const otherSession = "a61c1c49-4dae-4c6f-aa41-4f7f2a44411e"
  let holdNext = false
  let markHeld: () => void = () => {}
  let release: () => void = () => {}
  const held = new Promise<void>((resolve) => { markHeld = resolve })
  const gate = new Promise<void>((resolve) => { release = resolve })
  await page.route("**/api/sample", (route) => route.fulfill({ json: {
    version: 1, state: "ready", session_id: sessionId, after_record: "0", start_index: 0, events: recordedEvents,
  } }))
  await page.route("**/api/sessions**", async (route) => {
    if (holdNext) { holdNext = false; markHeld(); await gate }
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
  await expect(page.getByRole("button", { name: `Session ${sessionId}` })).toHaveAttribute("aria-pressed", "true")
  await page.getByRole("button", { name: `Session ${otherSession}` }).click()
  await expect(page.getByRole("button", { name: `Session ${otherSession}` })).toHaveAttribute("aria-pressed", "true")
  await page.getByRole("tab", { name: "Debug" }).click()
  holdNext = true
  await page.getByRole("tab", { name: "Replay" }).click()
  await held
  await page.getByRole("button", { name: `Session ${otherSession}` }).click()
  release()
  await expect(page.getByRole("button", { name: `Session ${otherSession}` })).toHaveAttribute("aria-pressed", "true")
})
