import { expect, test } from "@playwright/test"
import { readFileSync } from "node:fs"

const packetFixture = JSON.parse(readFileSync(new URL("../api/fixtures/packet-v1.json", import.meta.url), "utf8"))

async function chooseStage(page: import("@playwright/test").Page, stageId: string) {
  await page.getByRole("combobox", { name: "Stage" }).click()
  await page.getByRole("option", { name: stageId, exact: true }).click()
}

async function chooseLayer(page: import("@playwright/test").Page, label: string) {
  await page.getByRole("combobox", { name: "Static marker layer" }).click()
  await page.getByRole("option", { name: label, exact: true }).click()
}

test("stage selection loads its own fixed markers and resets the camera", async ({ page }) => {
  await page.goto("/?source=demo")
  await page.getByRole("tab", { name: /3D Map/ }).click()
  await expect(page.getByRole("combobox", { name: "Stage" })).toContainText("Cop_Shakedent")
  await page.getByRole("button", { name: "View from +Y" }).click()

  await chooseStage(page, "Cop_Carousel")
  await expect(page.getByRole("combobox", { name: "Stage" })).toContainText("Cop_Carousel")
  await expect(page.getByText("38/116 ROMFS MARKERS · All")).toBeVisible()
  await expect(page.getByRole("button", { name: "3D orbit view" })).toHaveAttribute("aria-pressed", "true")

  await chooseStage(page, "Cop_Tutorial")
  await expect(page.getByRole("combobox", { name: "Stage" })).toContainText("Cop_Tutorial")
  await expect(page.getByText("43/111 ROMFS MARKERS · All")).toBeVisible()
  await expect(page.getByText("MESH: Cop_Shakespiral")).toBeVisible()
})

test("fixed tide preview uses the selected layer height and omits an unknown height", async ({ page }) => {
  await page.goto("/?source=demo")
  await page.getByRole("tab", { name: /3D Map/ }).click()
  await chooseLayer(page, "High tide")
  await expect(page.getByText("TIDE HIGH · Y 7.00")).toBeVisible()
  await chooseLayer(page, "All layers")
  await expect(page.getByText(/TIDE HIGH · Y/)).toHaveCount(0)

  await chooseStage(page, "Cop_Manbou00")
  await chooseLayer(page, "Low tide")
  await expect(page.getByText("WATER —")).toBeVisible()
})

test("a missing stage catalog stops loading indicators", async ({ page }) => {
  await page.route("**/maps/stages.json", (route) => route.fulfill({ status: 500, body: "" }))
  await page.goto("/?source=demo")
  await page.getByRole("tab", { name: /3D Map/ }).click()
  await expect(page.getByText("STAGE CATALOG UNAVAILABLE")).toBeVisible()
  await expect(page.getByText("STATIC MARKERS UNAVAILABLE")).toBeVisible()
  await expect(page.getByText("COORDINATE GRID")).toBeVisible()
  await expect(page.getByText("LOADING STATIC MARKERS")).toHaveCount(0)
})

test("layer selection waits for the stage catalog", async ({ page }) => {
  let releaseCatalog!: () => void
  const gate = new Promise<void>((resolve) => { releaseCatalog = resolve })
  await page.route("**/maps/stages.json", async (route) => {
    await gate
    await route.continue()
  })
  await page.goto("/?source=demo")
  await page.getByRole("tab", { name: /3D Map/ }).click()
  const layer = page.getByRole("combobox", { name: "Static marker layer" })
  try {
    await expect(layer).toBeDisabled()
  } finally {
    releaseCatalog()
  }
  await expect(layer).toBeEnabled()
})

test("3D canvas fills the main view with accessible floating controls", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto("/?source=demo")
  await page.getByRole("tab", { name: /3D Map/ }).click()
  await expect(page.locator("canvas")).toBeVisible()
  await expect.poll(() => page.locator("canvas").evaluate((canvas) => canvas.getBoundingClientRect().width)).toBeGreaterThan(1000)
  const desktop = await page.evaluate(() => {
    const main = document.querySelector("main")!.getBoundingClientRect()
    const canvas = document.querySelector("canvas")!.getBoundingClientRect()
    const stage = document.querySelector('[aria-label="Stage"]')!.getBoundingClientRect()
    return { main, canvas, stage }
  })
  expect(desktop.canvas.width).toBeGreaterThan(desktop.main.width - 8)
  expect(desktop.canvas.height).toBeGreaterThan(desktop.main.height - 8)
  expect(desktop.stage.left).toBeGreaterThanOrEqual(desktop.canvas.left)
  expect(desktop.stage.bottom).toBeLessThan(desktop.canvas.bottom)

  await page.setViewportSize({ width: 375, height: 800 })
  await expect(page.getByRole("combobox", { name: "Stage" })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
})

test("live map shows static stage exploration without demo player positions", async ({ page }) => {
  await page.routeWebSocket("**/api/live", (socket) => {
    socket.send(JSON.stringify({ version: 1, type: "hello", mode: "memory" }))
    socket.send(JSON.stringify({ version: 1, type: "snapshot", events: [] }))
  })
  await page.goto("/?source=live")
  await page.getByRole("tab", { name: /3D Map/ }).click()

  await expect(page.getByRole("combobox", { name: "Stage" })).toContainText("Cop_Shakedent")
  await expect(page.getByRole("region", { name: "Map character" }).getByText("XYZ —")).toBeVisible()
  await expect(page.getByRole("region", { name: "Map character" }).getByRole("combobox", { name: "Character" })).toHaveCount(0)
  await expect(page.getByText("MANUAL STAGE", { exact: true })).toBeVisible()

  await page.getByRole("button", { name: "View from +Y" }).click()
  await expect(page.getByRole("button", { name: "View from +Y" })).toHaveAttribute("aria-pressed", "true")
  await chooseStage(page, "Cop_Carousel")
  await expect(page.getByText("38/116 ROMFS MARKERS · All")).toBeVisible()
  await expect(page.getByText("MANUAL STAGE", { exact: true })).toBeVisible()
})

test("authenticated stage and tide select a known RomFS map but manual exploration stays distinct", async ({ page }) => {
  const event = { ...packetFixture, rows: [{
    kind: "PrivateSetting", status: "authenticated", fields: [
      { name: "StageId", value: "Cop_Carousel" }, { name: "Tide", value: "High" },
    ],
  }] }
  await page.routeWebSocket("**/api/live", (socket) => {
    socket.send(JSON.stringify({ version: 1, type: "hello", mode: "memory" }))
    socket.send(JSON.stringify({ version: 1, type: "snapshot", events: [event] }))
  })

  await page.goto("/?source=live")
  await page.getByRole("tab", { name: /3D Map/ }).click()
  await expect(page.getByRole("combobox", { name: "Stage" })).toContainText("Cop_Carousel")
  await expect(page.getByText("OBSERVED STAGE", { exact: true })).toBeVisible()
  await expect(page.getByText("OBSERVED TIDE HIGH", { exact: true })).toBeVisible()
  await expect(page.getByRole("combobox", { name: "Static marker layer" })).toContainText("High tide")

  await chooseStage(page, "Cop_Shakedent")
  await expect(page.getByText("MANUAL STAGE", { exact: true })).toBeVisible()
  await expect(page.getByText("OBSERVED Cop_Carousel", { exact: true })).toBeVisible()
  await expect(page.getByRole("combobox", { name: "Static marker layer" })).toContainText("All layers")
  await chooseStage(page, "Cop_Carousel")
  await expect(page.getByText("MANUAL STAGE", { exact: true })).toBeVisible()
})

test("unknown observed StageId leaves the static map explicitly manual", async ({ page }) => {
  const event = { ...packetFixture, rows: [{
    kind: "PrivateSetting", status: "authenticated", fields: [{ name: "StageId", value: "Cop_UnknownNewStage" }],
  }] }
  await page.routeWebSocket("**/api/live", (socket) => {
    socket.send(JSON.stringify({ version: 1, type: "hello", mode: "memory" }))
    socket.send(JSON.stringify({ version: 1, type: "snapshot", events: [event] }))
  })

  await page.goto("/?source=live")
  await page.getByRole("tab", { name: /3D Map/ }).click()
  await expect(page.getByRole("combobox", { name: "Stage" })).toContainText("Cop_Shakedent")
  await expect(page.getByText("MANUAL STAGE", { exact: true })).toBeVisible()
  await expect(page.getByText("OBSERVED Cop_UnknownNewStage · NO ROMFS MAP", { exact: true })).toBeVisible()
})

test("an observed stage cleared by a later packet remains labeled as a previous selection", async ({ page }) => {
  const stage = { ...packetFixture, rows: [{ kind: "PrivateSetting", status: "authenticated", fields: [{ name: "StageId", value: "Cop_Carousel" }] }] }
  let sendPacket: (message: string) => void = () => {}
  await page.routeWebSocket("**/api/live", (socket) => {
    sendPacket = (message) => socket.send(message)
    socket.send(JSON.stringify({ version: 1, type: "hello", mode: "memory" }))
    socket.send(JSON.stringify({ version: 1, type: "snapshot", events: [stage] }))
  })

  await page.goto("/?source=live")
  await page.getByRole("tab", { name: /3D Map/ }).click()
  await expect(page.getByText("OBSERVED STAGE", { exact: true })).toBeVisible()
  sendPacket(JSON.stringify({ version: 1, type: "packet", event: {
    ...stage, record: "2", rows: [{ kind: "PrivateSetting", status: "authenticated", fields: [{ name: "StageId", value: "" }] }],
  } }))
  await expect(page.getByText("PREVIOUS STAGE", { exact: true })).toBeVisible()
  await expect(page.getByText("OBSERVED Unknown", { exact: true })).toBeVisible()
  await expect(page.getByRole("combobox", { name: "Stage" })).toContainText("Cop_Carousel")
})
