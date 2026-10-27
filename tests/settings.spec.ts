import { expect, test } from "@playwright/test"

test("Settings connects to loopback control and clears the GameKey input", async ({ page }) => {
  const key = "fedcba9876543210fedcba9876543210"
  let connected = false
  let disconnects = 0
  await page.route("**/api/control/status", async (route) => {
    await route.fulfill({ json: connected
      ? { version: 1, state: "reachable", target: { host: "127.0.0.1", port: 10254 }, capture: "running", key_state: disconnects ? "absent" : "applied", key_epoch: 1, publisher: { enabled: true, connection: "connected" } }
      : { version: 1, state: "unconfigured", target: null } })
  })
  await page.route("**/api/control/connect", async (route) => {
    expect(route.request().method()).toBe("POST")
    expect(route.request().postDataJSON()).toEqual({ host: "127.0.0.1", port: 10254, game_key: key })
    connected = true
    await route.fulfill({ status: 202, json: { version: 1, state: "reachable", target: { host: "127.0.0.1", port: 10254 }, key_state: "pending", key_epoch: 1 } })
  })
  await page.route("**/api/control/disconnect", async (route) => {
    expect(route.request().postDataJSON()).toEqual({})
    disconnects += 1
    await route.fulfill({ status: 202, json: { version: 1, state: "reachable", target: { host: "127.0.0.1", port: 10254 }, key_state: "pending", key_epoch: 2 } })
  })

  await page.goto("/")
  await page.getByRole("tab", { name: "Settings" }).click()
  await expect(page.getByRole("heading", { name: "InkScope settings" })).toBeVisible()
  await expect(page.getByLabel("InkScope IP")).toHaveValue("127.0.0.1")
  await expect(page.getByLabel("Port")).toHaveValue("10254")
  const input = page.getByLabel("GameKey")
  await expect(input).toHaveAttribute("type", "password")
  await expect(page.getByRole("button", { name: "Connect", exact: true })).toBeEnabled()
  await input.fill("a")
  await expect(page.getByRole("button", { name: "Connect", exact: true })).toBeDisabled()
  await input.fill(key)
  await page.getByRole("button", { name: "Connect", exact: true }).click()
  await expect(input).toHaveValue("")
  await expect(page.getByRole("region", { name: "Session status" })).toContainText(key)
  await expect(page.getByLabel("Key status")).toHaveText("APPLIED")
  await expect(page.getByLabel("Publisher status")).toHaveText("CONNECTED")
  const whileConnectedStorage = await page.evaluate(() => `${JSON.stringify(localStorage)} ${JSON.stringify(sessionStorage)} ${location.href}`)
  expect(whileConnectedStorage).not.toContain(key)

  await page.reload()
  await page.getByRole("button", { name: "Switch to live feed" }).click()
  const sidebar = page.getByRole("region", { name: "Session status" })
  await expect(sidebar).toContainText("CONFIGURED")
  await expect(sidebar).not.toContainText(key)
  await page.getByRole("tab", { name: "Settings" }).click()
  await expect(page.getByLabel("GameKey")).toHaveValue("")
  await page.getByRole("button", { name: "Disconnect" }).click()
  await expect(page.getByLabel("Key status")).toHaveText("ABSENT")
  await expect(sidebar).not.toContainText(key)
  expect(disconnects).toBe(1)
  const storage = await page.evaluate(() => `${JSON.stringify(localStorage)} ${JSON.stringify(sessionStorage)} ${location.href}`)
  expect(storage).not.toContain(key)
  await page.screenshot({ path: "test-results/settings.png", fullPage: true })
})

test("an older status response cannot replace a completed connection", async ({ page }) => {
  const key = "fedcba9876543210fedcba9876543210"
  let staleReply: (() => Promise<void>) | null = null
  let statusRequests = 0
  const connectedStatus = { version: 1, state: "reachable", target: { host: "127.0.0.1", port: 10254 }, key_state: "applied", key_locked: false }
  await page.route("**/api/control/status", async (route) => {
    statusRequests++
    if (statusRequests === 1) {
      staleReply = () => route.fulfill({ json: { version: 1, state: "unconfigured", target: null } })
      return
    }
    await route.fulfill({ json: connectedStatus })
  })
  await page.route("**/api/control/connect", (route) => route.fulfill({ status: 202, json: connectedStatus }))
  await page.goto("/")
  await page.getByRole("tab", { name: "Settings" }).click()
  await page.getByLabel("GameKey").fill(key)
  await page.getByRole("button", { name: "Connect", exact: true }).click()
  await expect(page.getByLabel("Key status")).toHaveText("APPLIED")
  expect(staleReply).not.toBeNull()
  await staleReply!()
  await expect(page.getByLabel("Key status")).toHaveText("APPLIED")
  await expect(page.getByRole("region", { name: "Session status" })).toContainText(key)
})

test("keyless Connect discovers a locked startup key and Check target can switch ports", async ({ page }) => {
  let targetPort: number | null = null
  const statusFor = (port: number | null) => port === null
    ? { version: 1, state: "unconfigured", target: null }
    : { version: 1, service: "inkscope-control", state: "reachable", target: { host: "127.0.0.1", port },
      capture: "running", key_state: port === 10254 ? "applied" : "absent", key_locked: port === 10254,
      key_source: port === 10254 ? "file" : "none", key_epoch: 1,
      publisher: { enabled: true, connection: "connected" } }
  await page.route("**/api/control/status", (route) => route.fulfill({ json: statusFor(targetPort) }))
  await page.route("**/api/control/connect", async (route) => {
    const body = route.request().postDataJSON() as { host: string; port: number; game_key?: string }
    expect(body.host).toBe("127.0.0.1")
    expect(body.game_key).toBeUndefined()
    targetPort = body.port
    await route.fulfill({ json: statusFor(targetPort) })
  })

  await page.goto("/")
  await page.getByRole("tab", { name: "Settings" }).click()
  await expect(page.getByRole("button", { name: "Connect", exact: true })).toBeEnabled()
  await page.getByRole("button", { name: "Connect", exact: true }).click()
  await expect(page.getByLabel("GameKey")).toHaveValue("********************************")
  await expect(page.getByLabel("GameKey")).toBeDisabled()
  await expect(page.getByRole("region", { name: "Session status" })).toContainText("********************************")
  await expect(page.getByRole("button", { name: "Connect", exact: true })).toBeDisabled()

  await page.getByLabel("Port").fill("10255")
  await page.getByRole("button", { name: "Check target" }).click()
  await expect(page.getByLabel("GameKey")).toBeEnabled()
  await expect(page.getByLabel("GameKey")).toHaveValue("")
  await expect(page.getByRole("button", { name: "Connect", exact: true })).toBeEnabled()
  expect(targetPort).toBe(10255)
})

test("control configured key is shown as status without invented HEX", async ({ page }) => {
  await page.route("**/api/control/status", (route) => route.fulfill({ json: {
    version: 1, state: "reachable", target: { host: "127.0.0.1", port: 10254 },
    capture: "running", key_state: "applied", key_locked: false, key_source: "control", key_epoch: 1,
    publisher: { enabled: true, connection: "connected" },
  } }))
  await page.goto("/?source=live")
  const sidebar = page.getByRole("region", { name: "Session status" })
  await expect(sidebar).toContainText("CONFIGURED")
  await expect(sidebar).not.toContainText("fedcba9876543210fedcba9876543210")
})

test("startup key stays masked and locked in Settings and sidebar", async ({ page }) => {
  let writes = 0
  await page.route("**/api/control/status", (route) => route.fulfill({ json: {
    version: 1, state: "reachable", target: { host: "127.0.0.1", port: 10254 },
    capture: "running", key_state: "applied", key_locked: true, key_source: "file", key_epoch: 1,
    publisher: { enabled: true, connection: "connected" },
  } }))
  await page.route("**/api/control/connect", (route) => { writes++; return route.fulfill({ status: 409 }) })
  await page.route("**/api/control/disconnect", (route) => { writes++; return route.fulfill({ status: 409 }) })
  await page.goto("/?source=live")
  const sidebar = page.getByRole("region", { name: "Session status" })
  await expect(sidebar).toContainText("********************************")
  await expect(sidebar).toContainText("LOCKED")
  await page.getByRole("tab", { name: "Settings" }).click()
  const input = page.getByLabel("GameKey")
  await expect(input).toHaveValue("********************************")
  await expect(input).toBeDisabled()
  await expect(input).toHaveAttribute("readonly", "")
  await expect(page.getByRole("button", { name: "Connect", exact: true })).toBeDisabled()
  await expect(page.getByRole("button", { name: "Disconnect" })).toBeDisabled()
  expect(writes).toBe(0)
  await page.screenshot({ path: "test-results/settings-locked.png", fullPage: true })
})

test("seven navigation icons fit at phone width without a selected border", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 })
  await page.route("**/api/control/status", (route) => route.fulfill({ json: { version: 1, state: "unconfigured", target: null } }))
  await page.goto("/")
  await page.getByRole("tab", { name: "Settings" }).click()
  const layout = await page.evaluate(() => {
    const tabs = [...document.querySelectorAll<HTMLElement>('aside[aria-label="Views"] [role="tab"]')]
    const active = tabs.find((tab) => tab.getAttribute("aria-selected") === "true")!
    return {
      count: tabs.length,
      fit: tabs.every((tab) => { const box = tab.getBoundingClientRect(); return box.left >= 0 && box.right <= innerWidth }),
      underline: getComputedStyle(active, "::after").display,
      overflow: document.documentElement.scrollWidth > innerWidth,
    }
  })
  expect(layout).toEqual({ count: 7, fit: true, underline: "none", overflow: false })
})
