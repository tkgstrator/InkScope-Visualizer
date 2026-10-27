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
