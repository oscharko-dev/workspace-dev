import { defineConfig, devices } from "@playwright/test";

const configuredPort = Number.parseInt(
  process.env.FIGMAPIPE_TAILWIND_PLAYWRIGHT_PORT?.trim() ?? "",
  10,
);
const port =
  Number.isFinite(configuredPort) && configuredPort > 0
    ? configuredPort
    : 4174;
const baseURL =
  process.env.FIGMAPIPE_TAILWIND_PLAYWRIGHT_BASE_URL?.trim() ??
  `http://127.0.0.1:${String(port)}`;
const reuseExistingServer =
  process.env.FIGMAPIPE_TAILWIND_PLAYWRIGHT_REUSE_SERVER === "1" ||
  Boolean(process.env.FIGMAPIPE_TAILWIND_PLAYWRIGHT_BASE_URL?.trim());

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI
    ? [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]]
    : "list",
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: `pnpm run build && pnpm exec vite preview --host 127.0.0.1 --port ${String(port)} --strictPort`,
    url: baseURL,
    timeout: 120_000,
    reuseExistingServer,
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
      },
    },
    {
      name: "mobile-chrome",
      use: {
        ...devices["Pixel 7"],
      },
    },
  ],
});
