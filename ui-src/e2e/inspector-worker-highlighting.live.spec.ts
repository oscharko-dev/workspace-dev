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

test.describe("inspector worker highlighting live figma flow", () => {
  test.describe.configure({ mode: "serial", timeout: 420_000 });

  test.afterEach(async ({ page }) => {
    await resetBrowserStorage(page);
  });

  test("keeps code viewer interactive during rapid file switches after real figma submit", async ({ page }) => {
    test.skip(
      !ENABLE_LIVE_INSPECTOR_E2E || FIGMA_FILE_KEY.length === 0 || FIGMA_ACCESS_TOKEN.length === 0,
      "Set INSPECTOR_LIVE_E2E=1, FIGMA_FILE_KEY, and FIGMA_ACCESS_TOKEN to run live inspector e2e."
    );

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

    const { codeViewer, fileSelector, componentTree } = getInspectorLocators(page);
    await expect(codeViewer).toBeVisible();
    await expect(fileSelector).toBeVisible();

    const fileOptions = await fileSelector.locator("option").evaluateAll((options) => {
      return options
        .map((option) => (option as HTMLOptionElement).value)
        .filter((value): value is string => typeof value === "string" && value.length > 0);
    });
    expect(fileOptions.length).toBeGreaterThan(1);

    const firstFile = fileOptions[0];
    const secondFile = fileOptions[1];
    expect(firstFile).toBeTruthy();
    expect(secondFile).toBeTruthy();

    for (let iteration = 0; iteration < 8; iteration += 1) {
      await fileSelector.selectOption(iteration % 2 === 0 ? firstFile! : secondFile!);
    }

    await expect(page.getByTestId("code-viewer-filepath")).toHaveText(secondFile!);
    await expect
      .poll(async () => {
        return await page.getByTestId("code-content").getByText("Highlighting…").count();
      })
      .toBe(0);
    expect(await page.getByTestId("line-number").count()).toBeGreaterThan(0);

    const firstComponentNode = componentTree.getByTestId(/^tree-node-/).first();
    await expect(firstComponentNode).toBeVisible();
    await firstComponentNode.click();
    await expect(page.getByTestId("highlighted-line").first()).toBeVisible();
  });
});
