import { defineConfig, devices } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const e2ePort = 19831;
const runtimeBaseUrl = `http://127.0.0.1:${String(e2ePort)}`;

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI
    ? [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]]
    : "list",
  expect: {
    timeout: 10_000
  },
  use: {
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure"
  },
  webServer: {
    command: `node --import tsx ./src/cli.ts start --host 127.0.0.1 --port ${String(e2ePort)} --preview true`,
    cwd: repoRoot,
    url: `${runtimeBaseUrl}/healthz`,
    timeout: 120_000,
    reuseExistingServer: false
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"]
      }
    },
    {
      name: "firefox",
      use: {
        ...devices["Desktop Firefox"]
      }
    },
    {
      name: "webkit",
      use: {
        ...devices["Desktop Safari"]
      }
    },
    {
      name: "mobile-chrome",
      use: {
        ...devices["Pixel 7"]
      }
    }
  ]
});
