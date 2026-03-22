import { expect, test, type Page } from "@playwright/test";
import {
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

async function runLiveGenerationWithRetry(page: Page): Promise<void> {
  let completed = false;
  let exhaustedTransientFailure = false;
  let lastError: string | null = null;

  for (let attempt = 1; attempt <= LIVE_SUBMIT_MAX_ATTEMPTS; attempt += 1) {
    const submitResponsePromise = page.waitForResponse((response) => {
      return response.request().method() === "POST" && response.url().endsWith("/workspace/submit");
    });

    await page.getByRole("banner").getByRole("button", { name: "Generate" }).click();
    const submitResponse = await submitResponsePromise;
    expect(submitResponse.ok()).toBeTruthy();

    let terminalStatus: string;
    try {
      terminalStatus = await waitForSubmitTerminalStatus(page, { timeoutMs: 240_000 });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const isSubmitTimeout = errorMessage.includes("Timed out waiting for terminal submit status");
      if (!isSubmitTimeout) {
        throw error;
      }

      lastError = `attempt ${String(attempt)} timed out waiting for submit completion`;
      if (attempt === LIVE_SUBMIT_MAX_ATTEMPTS) {
        exhaustedTransientFailure = true;
        break;
      }

      const cancelButton = page.getByRole("banner").getByRole("button", { name: "Cancel Job" });
      if ((await cancelButton.count()) > 0 && (await cancelButton.isEnabled())) {
        await cancelButton.click();
      }
      await page.waitForTimeout(LIVE_RATE_LIMIT_RETRY_WAIT_MS);
      continue;
    }

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
      exhaustedTransientFailure = true;
      break;
    }
    await page.waitForTimeout(LIVE_RATE_LIMIT_RETRY_WAIT_MS);
  }

  if (!completed && exhaustedTransientFailure) {
    test.skip(
      true,
      `Skipping live inspector lane after ${String(LIVE_SUBMIT_MAX_ATTEMPTS)} attempts due to persistent Figma API rate limits/timeouts.`
    );
  }

  expect(completed, `Live Figma generation did not complete. Last error: ${String(lastError)}`).toBeTruthy();
}

test.describe("inspector inspectability summary live figma flow", () => {
  test.describe.configure({ mode: "serial", timeout: 420_000 });

  test.afterEach(async ({ page }) => {
    await page.unroute("**/workspace/jobs/**");
    await resetBrowserStorage(page);
  });

  test("renders aggregate inspectability summary for live figma generation", async ({ page }) => {
    test.skip(
      !ENABLE_LIVE_INSPECTOR_E2E || FIGMA_FILE_KEY.length === 0 || FIGMA_ACCESS_TOKEN.length === 0,
      "Set INSPECTOR_LIVE_E2E=1, FIGMA_FILE_KEY, and FIGMA_ACCESS_TOKEN to run live inspector e2e."
    );

    await openWorkspaceUi(page, liveViewport);
    await page.getByLabel("Figma file key").fill(FIGMA_FILE_KEY);
    await page.getByLabel("Figma access token").fill(FIGMA_ACCESS_TOKEN);

    await runLiveGenerationWithRetry(page);

    await expect(page.getByTestId("inspector-inspectability-summary")).toBeVisible();
    await expect(page.getByTestId("inspector-summary-manifest-coverage")).toContainText("Manifest coverage");
    await expect(page.getByTestId("inspector-summary-design-ir-omissions")).toContainText(
      "Design IR cleanup/omission counters"
    );
    await expect(page.getByTestId("inspector-summary-aggregate-note")).toContainText("Aggregate-only summary");
  });
});
