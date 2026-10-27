import { defineConfig } from "@playwright/test"

export default defineConfig({
  testDir: "./tests",
  outputDir: "test-results",
  reporter: "list",
  use: {
    baseURL: "http://localhost:10252",
    browserName: "chromium",
    channel: "chrome",
    headless: true,
    viewport: { width: 1280, height: 800 },
    trace: "retain-on-failure",
  },
  webServer: {
    command: "bun run start",
    url: "http://localhost:10252/",
    reuseExistingServer: true,
    timeout: 30_000,
  },
})
