import { expect, test } from "@playwright/test";
import {
  getInspectorLocators,
  openWorkspaceUi,
  resetBrowserStorage,
  waitForSubmitTerminalStatus
} from "./helpers";

const liveViewport = { width: 1920, height: 1080 } as const;
const FIGMA_FILE_KEY = process.env["FIGMA_FILE_KEY"] ?? "";
const FIGMA_ACCESS_TOKEN = process.env["FIGMA_ACCESS_TOKEN"] ?? "";
const ENABLE_LIVE_INSPECTOR_E2E = process.env["INSPECTOR_LIVE_E2E"] === "1";
const LIVE_SUBMIT_MAX_ATTEMPTS = 3;
const LIVE_RATE_LIMIT_RETRY_WAIT_MS = 20_000;

test.describe("inspector data states live figma flow", () => {
  test.describe.configure({ mode: "serial", timeout: 420_000 });

  test.afterEach(async ({ page }) => {
    await page.unroute("**/workspace/jobs/**");
    await resetBrowserStorage(page);
  });

  test("recovers from transient manifest failure using retry", async ({ page }) => {
    test.skip(
      !ENABLE_LIVE_INSPECTOR_E2E || FIGMA_FILE_KEY.length === 0 || FIGMA_ACCESS_TOKEN.length === 0,
      "Set INSPECTOR_LIVE_E2E=1, FIGMA_FILE_KEY, and FIGMA_ACCESS_TOKEN to run live inspector e2e."
    );

    let injectManifestFailure = true;
    await page.route("**/workspace/jobs/*/component-manifest*", async (route) => {
      if (injectManifestFailure) {
        await route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({
            error: "INJECTED_FAILURE",
            message: "Injected live test failure for manifest endpoint"
          })
        });
        return;
      }
      await route.continue();
    });

    await openWorkspaceUi(page, liveViewport);
    await page.getByLabel("Figma file key").fill(FIGMA_FILE_KEY);
    await page.getByLabel("Figma access token").fill(FIGMA_ACCESS_TOKEN);

    let completed = false;
    let exhaustedRateLimit = false;
    let lastError: unknown = null;
    for (let attempt = 1; attempt <= LIVE_SUBMIT_MAX_ATTEMPTS; attempt += 1) {
      const submitResponsePromise = page.waitForResponse((response) => {
        return response.request().method() === "POST" && response.url().endsWith("/workspace/submit");
      });

      await page.getByRole("banner").getByRole("button", { name: "Generate" }).click();
      const submitResponse = await submitResponsePromise;
      expect(submitResponse.ok()).toBeTruthy();

      const terminalStatus = await waitForSubmitTerminalStatus(page, { timeoutMs: 240_000 });
      if (terminalStatus === "COMPLETED") {
        completed = true;
        break;
      }

      const jobPayload = (await page.getByTestId("job-payload").textContent()) ?? "";
      const isRateLimited =
        jobPayload.includes("E_FIGMA_RATE_LIMIT") ||
        jobPayload.toLowerCase().includes("rate limit exceeded");
      if (!isRateLimited) {
        throw new Error(
          `Live submit ended with status ${terminalStatus}. Job payload excerpt: ${jobPayload.slice(0, 280)}`
        );
      }

      lastError = `attempt ${String(attempt)} failed with rate limit`;
      if (attempt === LIVE_SUBMIT_MAX_ATTEMPTS) {
        exhaustedRateLimit = true;
        break;
      }
      await page.waitForTimeout(LIVE_RATE_LIMIT_RETRY_WAIT_MS);
    }

    if (!completed && exhaustedRateLimit) {
      test.skip(
        true,
        `Skipping live inspector lane after ${String(LIVE_SUBMIT_MAX_ATTEMPTS)} attempts due to persistent Figma API rate limits.`
      );
    }

    expect(completed, `Live Figma generation did not complete. Last error: ${String(lastError)}`).toBeTruthy();

    const { componentTree, fileSelector } = getInspectorLocators(page);
    await expect(page.getByTestId("inspector-error-component-manifest")).toBeVisible();
    await expect(page.getByTestId("inspector-source-component-manifest-error")).toBeVisible();
    await expect(componentTree).toBeVisible();
    await expect(fileSelector).toBeVisible();

    injectManifestFailure = false;
    await page.getByTestId("inspector-banner-retry-component-manifest").click();
    await expect(page.getByTestId("inspector-error-component-manifest")).toHaveCount(0);
    await expect(page.getByTestId("inspector-source-component-manifest-ready")).toBeVisible();
  });
});
