import { expect, test } from "@playwright/test"

test("persistent status, navigation, and typography", async ({ page }) => {
  await page.goto("/?source=demo")
  await expect(page.getByText("Captured packets")).toBeVisible()
  await expect(page.getByText(/Live session/)).toHaveCount(0)
  await expect(page.getByRole("region", { name: "Session status" })).toContainText("Cop_Shakedent")
  await expect(page.getByRole("region", { name: "Session status" })).toContainText("WAVE 02/03")

  const typography = await page.evaluate(async () => {
    await document.fonts.ready
    const body = getComputedStyle(document.body)
    const code = getComputedStyle(document.querySelector("code")!)
    const nav = document.querySelector('aside[aria-label="Views"]')!
    return {
      bodyFont: body.fontFamily,
      codeFont: code.fontFamily,
      navFits: nav.scrollHeight <= nav.clientHeight,
      background: getComputedStyle(document.documentElement).getPropertyValue("--background").trim(),
      navWidth: nav.getBoundingClientRect().width,
      statusWidth: document.querySelector('section[aria-label="Session status"]')!.getBoundingClientRect().width,
      statusFits: (() => { const status = document.querySelector('section[aria-label="Session status"]')!; return status.scrollHeight <= status.clientHeight })(),
      iconOffsets: Array.from(nav.querySelectorAll('[data-slot="tabs-trigger"]')).map((tab) => {
        const button = tab.getBoundingClientRect()
        const icon = tab.querySelector("svg")!.getBoundingClientRect()
        return Math.abs(button.left + button.width / 2 - (icon.left + icon.width / 2))
      }),
      selectedColor: getComputedStyle(nav.querySelector('[data-state="active"]')!).color,
    }
  })
  expect(typography.bodyFont).toContain("M PLUS 1 Code Variable")
  expect(typography.codeFont).toContain("M PLUS 1 Code Variable")
  expect(typography.navFits).toBe(true)
  expect(typography.background).toBe("#292e35")
  expect(typography.navWidth).toBe(64)
  expect(typography.statusWidth).toBe(280)
  expect(typography.statusFits).toBe(true)
  expect(Math.max(...typography.iconOffsets)).toBeLessThan(1)
  expect(typography.selectedColor).toBe("rgb(225, 253, 75)")
  await expect(page.locator('[data-slot="card"] [data-slot="card"]')).toHaveCount(0)
  await page.screenshot({ path: "test-results/overview.png", fullPage: true })

  await page.getByRole("tab", { name: /Debug/ }).click()
  await expect(page.getByRole("heading", { name: "Decoded packet view" })).toBeVisible()
  const controlHeights = await page.evaluate(() => {
    const input = document.querySelector('input[aria-label="Search packets"]')!
    const select = input.closest("div.flex.flex-wrap")!.querySelector('button[data-slot="select-trigger"]')!
    const button = Array.from(document.querySelectorAll("button")).find((item) => item.textContent?.includes("Pause demo"))
    return [input, select, button].map((element) => element!.getBoundingClientRect().height)
  })
  expect(controlHeights).toEqual([32, 32, 32])

  await page.keyboard.press("3")
  await expect(page.getByRole("heading", { name: "Raw packet view" })).toBeVisible()
  await expect(page.locator("pre")).toContainText("0000")
  await page.getByRole("tab", { name: /Replay/ }).click()
  await expect(page.getByRole("heading", { name: "Session replay" })).toBeVisible()
  await page.screenshot({ path: "test-results/replay.png", fullPage: true })
})

test("status moves above content on narrower screens", async ({ page }) => {
  for (const width of [1024, 375]) {
    await page.setViewportSize({ width, height: 800 })
    await page.goto("/?source=demo")
    const layout = await page.evaluate(() => {
      const nav = document.querySelector('aside[aria-label="Views"]')!.getBoundingClientRect()
      const status = document.querySelector('section[aria-label="Session status"]')!.getBoundingClientRect()
      const main = document.querySelector("main")!.getBoundingClientRect()
      return {
        navAboveStatus: nav.bottom <= status.top,
        statusAboveMain: status.bottom <= main.top,
        noHorizontalOverflow: document.documentElement.scrollWidth <= window.innerWidth,
      }
    })
    expect(layout).toEqual({ navAboveStatus: true, statusAboveMain: true, noHorizontalOverflow: true })
    if (width === 375) {
      const iconsInViewport = await page.getByRole("tab").evaluateAll((tabs) => tabs.every((tab) => {
        const box = tab.getBoundingClientRect()
        return box.left >= 0 && box.right <= window.innerWidth
      }))
      expect(iconsInViewport).toBe(true)
      await page.getByRole("tab", { name: "Overview" }).focus()
      await page.keyboard.press("ArrowRight")
      await expect(page.getByRole("tab", { name: "Debug" })).toBeFocused()
      await expect(page.getByRole("tab", { name: "Debug" })).toHaveAttribute("aria-selected", "true")
    }
    await page.screenshot({ path: `test-results/overview-${width}.png`, fullPage: true })
  }
})

test("WAVE selection updates status and OBS overlay", async ({ page }) => {
  await page.goto("/?source=demo")
  await page.getByRole("button", { name: /01 Low tide/ }).click()
  await expect(page.getByRole("region", { name: "Session status" })).toContainText("WAVE 01/03")
  await expect(page.getByRole("region", { name: "Session status" })).toContainText("QUOTA 21")
  await page.getByRole("tab", { name: /OBS/ }).click()
  await expect(page.getByRole("heading", { name: "OBS Browser Source" })).toBeVisible()
  await expect(page.getByText("http://localhost:10252/?view=overlay&source=demo&wave=1")).toBeVisible()
  const overlay = page.frameLocator('iframe[title="OBS overlay preview"]')
  await expect(overlay.getByText("WAVE 01 / 03")).toBeVisible()
  await expect(overlay.getByText("Quota 21")).toBeVisible()
  await expect(overlay.getByText("DEMO HEX")).toHaveCount(0)
  await page.screenshot({ path: "test-results/obs.png", fullPage: true })
})

test("3D map camera and RomFS marker layer controls", async ({ page }) => {
  const localTerrain = await page.request.head("/maps/local/cop-shakedent.glb")
  await page.goto("/?source=demo")
  await page.getByRole("tab", { name: /3D Map/ }).click()
  await expect(page.getByRole("heading", { name: "Map & position" })).toBeVisible()
  await expect(page.getByText("39/115 ROMFS MARKERS · All")).toBeVisible()
  await expect(page.locator('[data-slot="card"] [data-slot="card"]')).toHaveCount(0)
  if (localTerrain.ok() && !localTerrain.headers()["content-type"]?.toLowerCase().includes("text/html")) {
    await expect(page.getByText("LOCAL STAGE MESH")).toBeVisible({ timeout: 30_000 })
  } else {
    await expect(page.getByText("COORDINATE GRID")).toBeVisible()
  }

  const xView = page.getByRole("button", { name: "View from +X" })
  if (await xView.isEnabled()) {
    await page.getByRole("button", { name: "Pause demo" }).click()
    await xView.click()
    await expect(xView).toHaveAttribute("aria-pressed", "true")
    await expect(page.locator("canvas")).toBeVisible()
    await page.waitForTimeout(150)
    const beforeTurn = await page.locator("canvas").screenshot()
    await page.getByRole("button", { name: "Rotate right 90 degrees" }).click()
    await expect(xView).toHaveAttribute("aria-pressed", "false")
    await page.waitForTimeout(150)
    const afterTurn = await page.locator("canvas").screenshot()
    expect(beforeTurn.equals(afterTurn)).toBe(false)
    await page.getByRole("button", { name: "View from +Y" }).click()
    await page.waitForTimeout(150)
    const beforeTopTurn = await page.locator("canvas").screenshot()
    await page.getByRole("button", { name: "Rotate right 90 degrees" }).click()
    await page.waitForTimeout(150)
    const afterTopTurn = await page.locator("canvas").screenshot()
    expect(beforeTopTurn.equals(afterTopTurn)).toBe(false)
    await page.getByRole("button", { name: "Character POV" }).click()
    await expect(page.getByRole("button", { name: "Character POV" })).toHaveAttribute("aria-pressed", "true")
    await page.getByRole("button", { name: "Free camera" }).click()
    await expect(page.getByRole("button", { name: "Character POV" })).toHaveAttribute("aria-pressed", "false")
  }

  await page.getByText(/^SHOW MARKERS/).click()
  for (const [name, visible] of [["Geyser", 47], ["Tower arrival", 74], ["Artillery gun", 80], ["Jump route", 115]] as const) {
    const toggle = page.getByRole("checkbox", { name: `Show ${name}` })
    await toggle.check()
    await expect(toggle).toBeChecked()
    await expect(page.getByText(`${visible}/115 ROMFS MARKERS · All`)).toBeVisible()
  }
  await page.getByRole("checkbox", { name: "Show Geyser" }).uncheck()
  await expect(page.getByText("107/115 ROMFS MARKERS · All")).toBeVisible()
  await page.getByRole("checkbox", { name: "Show Geyser" }).check()
  await expect(page.getByText("115/115 ROMFS MARKERS · All")).toBeVisible()
  await page.getByRole("combobox", { name: "Static marker layer" }).click()
  await page.getByRole("option", { name: "High tide" }).click()
  await expect(page.getByText(/ROMFS MARKERS · High/)).toBeVisible()
  await page.screenshot({ path: "test-results/map.png", fullPage: true })
})

test("a broken terrain file leaves the coordinate viewer available", async ({ page }) => {
  await page.route("**/maps/local/cop-shakedent.glb", async (route) => {
    await route.fulfill({ status: 200, contentType: "model/gltf-binary", body: route.request().method() === "HEAD" ? "" : "not a GLB" })
  })
  await page.goto("/?source=demo")
  await page.getByRole("tab", { name: /3D Map/ }).click()
  await expect(page.getByText("TERRAIN UNAVAILABLE · GRID")).toBeVisible()
  await expect(page.getByRole("img", { name: /3D stage coordinate viewer/ })).toBeVisible()
  await expect(page.getByText("39/115 ROMFS MARKERS · All")).toBeVisible()
})
