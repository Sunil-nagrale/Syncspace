import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: "list",
  timeout: 120000,
  expect: {
    timeout: 30000,
  },
  use: {
    baseURL: process.env.PLAYWRIGHT_TEST_BASE_URL || "http://localhost:3000",
    trace: "on-first-retry",
    video: "off",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        launchOptions: {
          executablePath:
            process.env.CHROMIUM_PATH ||
            "C:\\Users\\sunil\\AppData\\Local\\ms-playwright\\chromium-1248\\chrome-win64\\chrome.exe",
        },
      },
    },
  ],
  webServer: {
    command: "npm.cmd run start",
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
    timeout: 120 * 1000,
    env: {
      // Explicit test-only opt-in flags allowing Playwright to test against a local production build
      // without requiring live AWS S3 or failing closed when optional local test services are mocked.
      SYNCSPACE_TEST_LOCAL_MODE: "true",
      ALLOW_LOCAL_STORAGE_IN_TEST: "true",
    },
  },
});
