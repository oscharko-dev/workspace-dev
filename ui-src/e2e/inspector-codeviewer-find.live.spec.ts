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

function parseCountText(value: string): { current: number; total: number } {
  const match = /^(\d+)\s+of\s+(\d+)$/.exec(value.trim());
  if (!match?.[1] || !match[2]) {
    throw new Error(`Unexpected find count text: '${value}'`);
  }
  return {
    current: Number.parseInt(match[1], 10),
    total: Number.parseInt(match[2], 10)
  };
}

test.describe("inspector codeviewer find + line jump live figma flow", () => {
  test.describe.configure({ mode: "serial", timeout: 420_000 });

  test.afterEach(async ({ page }) => {
    await resetBrowserStorage(page);
  });

  test("supports find navigation and :line jump after real figma submit", async ({ page }) => {
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

    const { codeViewer, componentTree } = getInspectorLocators(page);
    await expect(codeViewer).toBeVisible();

    const firstComponentNode = componentTree.getByTestId(/^tree-node-/).first();
    await expect(firstComponentNode).toBeVisible();
    await firstComponentNode.click();
    await expect(page.getByTestId("highlighted-line").first()).toBeVisible();

    const findInput = page.getByTestId("code-viewer-find-input");
    const findCount = page.getByTestId("code-viewer-find-count");

    await page.keyboard.press("Control+f");
    await expect(findInput).toBeFocused();

    await findInput.fill("e");
    await expect(findCount).toHaveText(/\d+ of \d+/);
    const beforeText = (await findCount.textContent())?.trim() ?? "";
    const before = parseCountText(beforeText);
    expect(before.total).toBeGreaterThan(0);

    await page.keyboard.press("Enter");
    const afterNextText = (await findCount.textContent())?.trim() ?? "";
    const afterNext = parseCountText(afterNextText);
    const expectedNext = before.current === before.total ? 1 : before.current + 1;
    expect(afterNext.current).toBe(expectedNext);

    const lineCount = await page.getByTestId("line-number").count();
    expect(lineCount).toBeGreaterThan(0);
    await findInput.fill(":99999");
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("code-viewer-jump-target-line")).toContainText(String(lineCount));
    await expect(page.getByTestId("highlighted-line").first()).toBeVisible();
  });
});
