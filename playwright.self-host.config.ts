import { defineConfig, devices } from "@playwright/test"

export default defineConfig({
  testDir: "./e2e/self-host",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? "github" : "html",
  timeout: 180_000,
  use: {
    baseURL: "http://127.0.0.1:3001",
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
    command: "bash scripts/self-host-e2e-server.sh",
    url: "http://127.0.0.1:3001",
    reuseExistingServer: false,
    timeout: 600_000,
    env: {
      ...process.env,
      CLAWS_PROFILE: "self-host",
      E2E_TEST_MODE: "true",
      RUNTIME_IMAGE_TAG: "2026.9.4-5",
      CLAWS_DOCKER_NETWORK: "claws",
      CLAWS_DOCKER_PUBLISH: "host",
    },
  },
})
