import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  testMatch: "**/*browser.spec.ts",
  fullyParallel: !!process.env.CI,
  workers: process.env.CI ? 4 : 1,
  maxFailures: process.env.CI ? 1 : undefined,
  retries: 0,
  use: {
    baseURL: "http://127.0.0.1:4174",
    viewport: { width: 1440, height: 1000 },
    trace: process.env.CI
      ? {
          mode: "retain-on-failure",
          screenshots: false,
          snapshots: false,
          sources: false,
        }
      : "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "node scripts/dev-host.mjs",
    url: "http://127.0.0.1:4174",
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
