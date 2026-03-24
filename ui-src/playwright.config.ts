import { defineConfig, devices } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const configuredUiUrl = process.env.WORKSPACE_DEV_UI_URL?.trim();
const configuredPort = Number.parseInt(process.env.WORKSPACE_DEV_E2E_PORT?.trim() ?? "", 10);
const configuredWorkers = Number.parseInt(process.env.WORKSPACE_DEV_E2E_WORKERS?.trim() ?? "", 10);
const defaultPort = Number.isFinite(configuredPort) && configuredPort > 0 ? configuredPort : 19831;
const workerCount = Number.isFinite(configuredWorkers) && configuredWorkers > 0 ? configuredWorkers : 2;
const configuredRuntimeBaseUrl =
  process.env.WORKSPACE_DEV_RUNTIME_BASE_URL?.trim() ||
  (configuredUiUrl ? new URL(configuredUiUrl).origin : undefined);
const runtimeBaseUrl = configuredRuntimeBaseUrl ?? `http://127.0.0.1:${String(defaultPort)}`;
const runtimePort = Number.parseInt(new URL(runtimeBaseUrl).port, 10) || defaultPort;
const reuseExistingServer =
  process.env.WORKSPACE_DEV_E2E_REUSE_SERVER === "1" || Boolean(configuredRuntimeBaseUrl);

export default defineConfig({
  testDir: "./e2e",
  testIgnore: process.env.WORKSPACE_DEV_E2E_INCLUDE_LIVE === "1" ? [] : ["**/*.live.spec.ts", "**/live-submit-smoke.spec.ts"],
  timeout: 30_000,
  fullyParallel: true,
  workers: workerCount,
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
    command: `node --import tsx ./src/cli.ts start --host 127.0.0.1 --port ${String(runtimePort)} --preview true`,
    cwd: repoRoot,
    url: `${runtimeBaseUrl}/healthz`,
    timeout: 120_000,
    reuseExistingServer
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
