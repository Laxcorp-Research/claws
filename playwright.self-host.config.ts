import { defineConfig, devices } from "@playwright/test"

export default defineConfig({
  testDir: "./e2e/self-host",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? "github" : "html",
  timeout: 60_000,
  use: {
    baseURL: "http://localhost:3001",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: "npx next dev --port 3001",
    url: "http://localhost:3001",
    reuseExistingServer: false,
    timeout: 180_000,
    env: {
      ...process.env,
      CLAWS_PROFILE: "self-host",
    },
  },
})
