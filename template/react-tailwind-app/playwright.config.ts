import { defineConfig, devices } from "@playwright/test";

const configuredPort = Number.parseInt(
  process.env.FIGMAPIPE_TAILWIND_PLAYWRIGHT_PORT?.trim() ?? "",
  10,
);
const port =
  Number.isFinite(configuredPort) && configuredPort > 0 ? configuredPort : 4174;
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
  // Issue #1665 (audit-2026-05): the webServer command previously chained
  // `pnpm run build &&` which re-ran the full Vite production build on every
  // Playwright invocation. The default-pipeline orchestrator already
  // produces `dist/` upstream (`template:tailwind:build` runs before
  // `template:tailwind:validate:playwright`), so paying for the build a
  // second time per Playwright launch was the root cause of the 30-minute
  // CI timeout that drove the four PR-#1640..#1645 timeout bumps. We now
  // expect the caller to ensure `dist/` is current and only launch the
  // preview server here.
  webServer: {
    command: `pnpm exec vite preview --host 127.0.0.1 --port ${String(port)} --strictPort`,
    url: baseURL,
    timeout: 120_000,
    reuseExistingServer,
  },
  projects: [
    {
      name: "desktop-chromium",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1365, height: 768 },
      },
    },
    {
      name: "tablet-chromium",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 768, height: 1024 },
      },
    },
    {
      name: "mobile-chromium",
      use: {
        ...devices["Pixel 7"],
      },
    },
  ],
});
