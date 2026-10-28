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

  await page.goto("/?source=demo")
  await page.getByRole("button", { name: "Switch to live feed" }).click()
  await page.getByRole("tab", { name: "Replay" }).click()
  await expect(page.getByRole("button", { name: `Session ${fixture.session_id}` })).toBeVisible()
  await expect(page.getByText("2 EVENTS", { exact: true })).toBeVisible()
  await expect(page.getByText(`#${first.record}`).first()).toBeVisible()
  await page.getByRole("button", { name: new RegExp(`#${second.record}`) }).click()
  await expect(page.getByText("Cop_Shakedent")).toBeVisible()
  await expect(page.getByText(`#${second.record} / #${second.record}`)).toBeVisible()
  await expect(page.getByText("Demo recording · #A82F")).toHaveCount(0)
})

test("an exact 500-record archive loads as one timeline", async ({ page }) => {
  const events = Array.from({ length: 500 }, (_, index) => ({ ...fixture, record: String(index + 1) }))
  const requests: string[] = []
  await page.routeWebSocket("**/api/live", (socket) => {
    socket.send(JSON.stringify({ version: 1, type: "hello", mode: "postgres" }))
    socket.send(JSON.stringify({ version: 1, type: "snapshot", events: [] }))
  })
  await page.route("**/api/sessions", (route) => route.fulfill({ json: {
    version: 1, sessions: [{ session_id: fixture.session_id, events: "500", first_timestamp_ns: fixture.timestamp_ns, last_timestamp_ns: fixture.timestamp_ns }],
  } }))
  await page.route(/\/api\/sessions\/[^/]+\/events\?/, (route) => {
    requests.push(new URL(route.request().url()).searchParams.get("after_record") ?? "")
    return route.fulfill({ json: { version: 1, session_id: fixture.session_id, events } })
  })

  await page.goto("/?source=demo")
  await page.getByRole("button", { name: "Switch to live feed" }).click()
  await page.getByRole("tab", { name: "Replay" }).click()
  await expect(page.getByText("500 EVENTS", { exact: true })).toBeVisible()
  await expect(page.getByText("RECORDS #1–#500")).toBeVisible()
  await expect(page.getByRole("button", { name: /Next page|Previous page|Session start/ })).toHaveCount(0)
  expect(requests).toEqual([""])
})

test("replay ignores a pending old-session batch after selection changes", async ({ page }) => {
  const otherSessionId = "a61c1c49-4dae-4c6f-aa41-4f7f2a44411e"
  const firstBatch = Array.from({ length: 500 }, (_, index) => ({ ...fixture, record: String(index + 1) }))
  const gate = { release: () => {}, requested: () => {}, held: false }
  const oldBatchGate = new Promise<void>((resolve) => { gate.release = resolve })
  const oldBatchRequested = new Promise<void>((resolve) => { gate.requested = resolve })
  await page.routeWebSocket("**/api/live", (socket) => {
    socket.send(JSON.stringify({ version: 1, type: "hello", mode: "postgres" }))
    socket.send(JSON.stringify({ version: 1, type: "snapshot", events: [] }))
  })
  await page.route("**/api/sessions", (route) => route.fulfill({ json: {
    version: 1, sessions: [
      { session_id: fixture.session_id, events: "501", first_timestamp_ns: fixture.timestamp_ns, last_timestamp_ns: fixture.timestamp_ns },
      { session_id: otherSessionId, events: "1", first_timestamp_ns: fixture.timestamp_ns, last_timestamp_ns: fixture.timestamp_ns },
    ],
  } }))
  await page.route(/\/api\/sessions\/[^/]+\/events\?/, async (route) => {
    const url = new URL(route.request().url())
    const other = url.pathname.includes(otherSessionId)
    const afterRecord = url.searchParams.get("after_record")
    if (!other && afterRecord && !gate.held) {
      gate.held = true
      gate.requested()
      await oldBatchGate
    }
    const events = other ? [{ ...fixture, session_id: otherSessionId, record: "7" }]
      : afterRecord ? [{ ...fixture, record: "501" }] : firstBatch
    try {
      await route.fulfill({ json: { version: 1, session_id: other ? otherSessionId : fixture.session_id, events, next_record: events.at(-1)?.record } })
    } catch {
      // The browser may cancel the old request before its route is released.
    }
  })

  await page.goto("/?source=demo")
  await page.getByRole("button", { name: "Switch to live feed" }).click()
  await page.getByRole("tab", { name: "Replay" }).click()
  await oldBatchRequested
  await expect(page.getByText("LOADING 500 / 501").first()).toBeVisible()
  await page.getByRole("button", { name: `Session ${otherSessionId}` }).click()
  gate.release()
  await expect(page.getByText("RECORDS #7–#7")).toBeVisible()
  await expect(page.getByText("1 EVENTS", { exact: true })).toBeVisible()
  await page.getByRole("button", { name: `Session ${fixture.session_id}` }).click()
  await expect(page.getByText("501 EVENTS", { exact: true })).toBeVisible()
  await expect(page.getByText("RECORDS #1–#501")).toBeVisible()
  await expect(page.getByRole("button", { name: /Next page|Previous page|Session start/ })).toHaveCount(0)
})

test("an open replay discovers packets appended after the initial session list", async ({ page }) => {
  const firstPage = Array.from({ length: 100 }, (_, index) => ({ ...fixture, record: String(index + 1) }))
  const sessionReads = { count: 0 }
  await page.routeWebSocket("**/api/live", (socket) => {
    socket.send(JSON.stringify({ version: 1, type: "hello", mode: "postgres" }))
    socket.send(JSON.stringify({ version: 1, type: "snapshot", events: [] }))
  })
  await page.route("**/api/sessions", (route) => {
    sessionReads.count++
    return route.fulfill({ json: {
      version: 1,
      sessions: [{ session_id: fixture.session_id, events: sessionReads.count === 1 ? "100" : "101", first_timestamp_ns: fixture.timestamp_ns, last_timestamp_ns: fixture.timestamp_ns }],
    } })
  })
  await page.route(/\/api\/sessions\/[^/]+\/events\?/, (route) => {
    const after = new URL(route.request().url()).searchParams.has("after_record")
    const events = after ? [{ ...fixture, record: "101" }] : firstPage
    return route.fulfill({ json: { version: 1, session_id: fixture.session_id, events, next_record: events.at(-1)?.record } })
  })

  await page.goto("/?source=live")
  await page.getByRole("tab", { name: "Replay" }).click()
  await expect(page.getByText("100 EVENTS", { exact: true })).toBeVisible()
  await expect.poll(() => sessionReads.count, { timeout: 8_000 }).toBeGreaterThan(1)
  await expect(page.getByText("101 EVENTS", { exact: true })).toBeVisible({ timeout: 8_000 })
  await expect(page.getByText("RECORDS #1–#101")).toBeVisible()
})

test("a partial archive error pauses replay until Retry completes", async ({ page }) => {
  const baseTime = BigInt(fixture.timestamp_ns)
  const firstBatch = Array.from({ length: 500 }, (_, index) => ({
    ...fixture, record: String(index + 1), timestamp_ns: String(baseTime + BigInt(index) * 1_000_000n),
  }))
  const finalEvent = { ...fixture, record: "501", timestamp_ns: String(baseTime + 500_000_000n) }
  const control = { failNext: true }
  await page.routeWebSocket("**/api/live", (socket) => {
    socket.send(JSON.stringify({ version: 1, type: "hello", mode: "postgres" }))
    socket.send(JSON.stringify({ version: 1, type: "snapshot", events: [] }))
  })
  await page.route("**/api/sessions", (route) => route.fulfill({ json: {
    version: 1, sessions: [{ session_id: fixture.session_id, events: "501", first_timestamp_ns: fixture.timestamp_ns, last_timestamp_ns: finalEvent.timestamp_ns }],
  } }))
  await page.route(/\/api\/sessions\/[^/]+\/events\?/, (route) => {
    const after = new URL(route.request().url()).searchParams.get("after_record")
    if (after === "500" && control.failNext) {
      control.failNext = false
      return route.fulfill({ status: 503, json: { error: "temporary" } })
    }
    return route.fulfill({ json: { version: 1, session_id: fixture.session_id, events: after ? [finalEvent] : firstBatch } })
  })

  await page.goto("/?source=live")
  await page.getByRole("tab", { name: "Replay" }).click()
  await expect(page.getByRole("alert")).toContainText("HTTP 503")
  await expect(page.getByText("RECORDS #1–#500")).toBeVisible()
  await expect(page.getByRole("button", { name: "Play replay" })).toBeDisabled()
  await expect(page.getByRole("slider", { name: "Replay time" })).toBeDisabled()
  await page.getByRole("button", { name: "Retry" }).click()
  await expect(page.getByText("501 EVENTS", { exact: true })).toBeVisible()
  await expect(page.getByRole("button", { name: "Play replay" })).toBeEnabled()
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
