import { expect, test } from "@playwright/test"
import { readFileSync } from "node:fs"

const fixture = JSON.parse(readFileSync(new URL("../api/fixtures/packet-v1.json", import.meta.url), "utf8"))

test("saved session events appear in live Replay without demo values", async ({ page }) => {
  const first = { ...fixture, record: "18446744073709551614" }
  const second = { ...fixture, record: "18446744073709551615", rows: [{ kind: "PrivateSetting", status: "authenticated", fields: [{ name: "StageResource", value: "Cop_Shakedent" }] }] }
  await page.routeWebSocket("**/api/live", (socket) => {
    socket.send(JSON.stringify({ version: 1, type: "hello", mode: "postgres" }))
    socket.send(JSON.stringify({ version: 1, type: "snapshot", events: [] }))
  })
  await page.route("**/api/sessions", (route) => route.fulfill({ json: {
    version: 1, sessions: [{ session_id: fixture.session_id, events: "2", first_timestamp_ns: fixture.timestamp_ns, last_timestamp_ns: fixture.timestamp_ns }],
  } }))
  await page.route(/\/api\/sessions\/[^/]+\/events\?/, (route) => route.fulfill({ json: {
    version: 1, session_id: fixture.session_id, events: [first, second], next_record: second.record,
  } }))

  await page.goto("/")
  await page.getByRole("button", { name: "Switch to live feed" }).click()
  await page.getByRole("tab", { name: "Replay" }).click()
  await expect(page.getByRole("button", { name: `Session ${fixture.session_id}` })).toBeVisible()
  await expect(page.getByText("1/2")).toBeVisible()
  await expect(page.getByText(`#${first.record}`).first()).toBeVisible()
  await page.getByRole("button", { name: new RegExp(`#${second.record}`) }).click()
  await expect(page.getByText("Cop_Shakedent")).toBeVisible()
  await expect(page.getByText("2/2")).toBeVisible()
  await expect(page.getByText("Demo recording · #A82F")).toHaveCount(0)
})

test("exact-multiple replay page stops without a phantom next page", async ({ page }) => {
  const events = Array.from({ length: 100 }, (_, index) => ({ ...fixture, record: String(index + 1) }))
  await page.routeWebSocket("**/api/live", (socket) => {
    socket.send(JSON.stringify({ version: 1, type: "hello", mode: "postgres" }))
    socket.send(JSON.stringify({ version: 1, type: "snapshot", events: [] }))
  })
  await page.route("**/api/sessions", (route) => route.fulfill({ json: {
    version: 1, sessions: [{ session_id: fixture.session_id, events: "100", first_timestamp_ns: fixture.timestamp_ns, last_timestamp_ns: fixture.timestamp_ns }],
  } }))
  await page.route(/\/api\/sessions\/[^/]+\/events\?/, (route) => route.fulfill({ json: {
    version: 1, session_id: fixture.session_id, events, next_record: "100",
  } }))

  await page.goto("/")
  await page.getByRole("button", { name: "Switch to live feed" }).click()
  await page.getByRole("tab", { name: "Replay" }).click()
  await expect(page.getByText("1–100 / 100")).toBeVisible()
  await expect(page.getByText("RECORDS #1–#100")).toBeVisible()
  await expect(page.getByRole("button", { name: "Next page" })).toHaveCount(0)
})

test("replay replaces pages and ignores a pending old-session response", async ({ page }) => {
  const otherSessionId = "a61c1c49-4dae-4c6f-aa41-4f7f2a44411e"
  const firstPage = Array.from({ length: 100 }, (_, index) => ({ ...fixture, record: String(index + 1) }))
  let releaseOldPage: () => void = () => {}
  let markOldPageRequested: () => void = () => {}
  const oldPageGate = new Promise<void>((resolve) => { releaseOldPage = resolve })
  const oldPageRequested = new Promise<void>((resolve) => { markOldPageRequested = resolve })
  let held = false
  await page.routeWebSocket("**/api/live", (socket) => {
    socket.send(JSON.stringify({ version: 1, type: "hello", mode: "postgres" }))
    socket.send(JSON.stringify({ version: 1, type: "snapshot", events: [] }))
  })
  await page.route("**/api/sessions", (route) => route.fulfill({ json: {
    version: 1, sessions: [
      { session_id: fixture.session_id, events: "101", first_timestamp_ns: fixture.timestamp_ns, last_timestamp_ns: fixture.timestamp_ns },
      { session_id: otherSessionId, events: "1", first_timestamp_ns: fixture.timestamp_ns, last_timestamp_ns: fixture.timestamp_ns },
    ],
  } }))
  await page.route(/\/api\/sessions\/[^/]+\/events\?/, async (route) => {
    const url = new URL(route.request().url())
    const other = url.pathname.includes(otherSessionId)
    const afterRecord = url.searchParams.get("after_record")
    if (!other && afterRecord && !held) {
      held = true
      markOldPageRequested()
      await oldPageGate
    }
    const events = other ? [{ ...fixture, session_id: otherSessionId, record: "7" }]
      : afterRecord ? [{ ...fixture, record: "101" }] : firstPage
    try {
      await route.fulfill({ json: { version: 1, session_id: other ? otherSessionId : fixture.session_id, events, next_record: events.at(-1)?.record } })
    } catch {
      // The browser may cancel the old request before its route is released.
    }
  })

  await page.goto("/")
  await page.getByRole("button", { name: "Switch to live feed" }).click()
  await page.getByRole("tab", { name: "Replay" }).click()
  await expect(page.getByText("1–100 / 101")).toBeVisible()
  await page.getByRole("button", { name: "Next page" }).click()
  await oldPageRequested
  await page.getByRole("button", { name: `Session ${otherSessionId}` }).click()
  releaseOldPage()
  await expect(page.getByText("RECORDS #7–#7")).toBeVisible()
  await expect(page.getByText("1 / 1")).toBeVisible()
  await page.getByRole("button", { name: `Session ${fixture.session_id}` }).click()
  await expect(page.getByText("1–100 / 101")).toBeVisible()
  await page.getByRole("button", { name: "Next page" }).click()
  await expect(page.getByText("101–101 / 101")).toBeVisible()
  await expect(page.getByRole("button", { name: "Previous page" })).toBeVisible()
  await page.getByRole("button", { name: "Previous page" }).click()
  await expect(page.getByText("1–100 / 101")).toBeVisible()
})

test("an open replay discovers packets appended after the initial session list", async ({ page }) => {
  const firstPage = Array.from({ length: 100 }, (_, index) => ({ ...fixture, record: String(index + 1) }))
  let sessionReads = 0
  await page.routeWebSocket("**/api/live", (socket) => {
    socket.send(JSON.stringify({ version: 1, type: "hello", mode: "postgres" }))
    socket.send(JSON.stringify({ version: 1, type: "snapshot", events: [] }))
  })
  await page.route("**/api/sessions", (route) => {
    sessionReads++
    return route.fulfill({ json: {
      version: 1,
      sessions: [{ session_id: fixture.session_id, events: sessionReads === 1 ? "100" : "101", first_timestamp_ns: fixture.timestamp_ns, last_timestamp_ns: fixture.timestamp_ns }],
    } })
  })
  await page.route(/\/api\/sessions\/[^/]+\/events\?/, (route) => {
    const after = new URL(route.request().url()).searchParams.has("after_record")
    const events = after ? [{ ...fixture, record: "101" }] : firstPage
    return route.fulfill({ json: { version: 1, session_id: fixture.session_id, events, next_record: events.at(-1)?.record } })
  })

  await page.goto("/?source=live")
  await page.getByRole("tab", { name: "Replay" }).click()
  await expect(page.getByText("1–100 / 100")).toBeVisible()
  await expect(page.getByRole("button", { name: "Next page" })).toHaveCount(0)
  await expect.poll(() => sessionReads, { timeout: 8_000 }).toBeGreaterThan(1)
  await expect(page.getByRole("button", { name: "Next page" })).toBeVisible({ timeout: 8_000 })
  await page.getByRole("button", { name: "Next page" }).click()
  await expect(page.getByText("101–101 / 101")).toBeVisible()
})

test("a malformed saved packet shows an error instead of crashing replay", async ({ page }) => {
  await page.routeWebSocket("**/api/live", (socket) => {
    socket.send(JSON.stringify({ version: 1, type: "hello", mode: "postgres" }))
    socket.send(JSON.stringify({ version: 1, type: "snapshot", events: [] }))
  })
  await page.route("**/api/sessions", (route) => route.fulfill({ json: {
    version: 1, sessions: [{ session_id: fixture.session_id, events: "1", first_timestamp_ns: fixture.timestamp_ns, last_timestamp_ns: fixture.timestamp_ns }],
  } }))
  await page.route(/\/api\/sessions\/[^/]+\/events\?/, (route) => route.fulfill({ json: {
    version: 1, session_id: fixture.session_id, events: [{ ...fixture, timestamp_ns: "bad" }], next_record: fixture.record,
  } }))

  await page.goto("/?source=live")
  await page.getByRole("tab", { name: "Replay" }).click()
  await expect(page.getByRole("alert")).toContainText("Invalid packet envelope")
  await expect(page.getByRole("button", { name: "Play replay" })).toBeDisabled()
})
