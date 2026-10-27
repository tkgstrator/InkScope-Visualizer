import { expect, test } from "@playwright/test"

test("map opens in an orbit view and can return there from the top view", async ({ page }) => {
  await page.goto("/")
  await page.getByRole("tab", { name: /3D Map/ }).click()
  await expect(page.locator("canvas")).toBeVisible()

  const top = page.getByRole("button", { name: "View from +Y" })
  const orbit = page.getByRole("button", { name: "3D orbit view" })
  await expect(top).toHaveAttribute("aria-pressed", "false")
  await expect(orbit).toHaveAttribute("aria-pressed", "true")

  await top.click()
  await expect(top).toHaveAttribute("aria-pressed", "true")
  await orbit.click()
  await expect(orbit).toHaveAttribute("aria-pressed", "true")
  await expect(top).toHaveAttribute("aria-pressed", "false")
})
