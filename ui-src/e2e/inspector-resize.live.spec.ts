import { expect, test, type Locator } from "@playwright/test";
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

async function getWidth(locator: Locator): Promise<number> {
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  return box?.width ?? 0;
}

test.describe("inspector resize live figma flow", () => {
  test.describe.configure({ mode: "serial", timeout: 300_000 });

  test.afterEach(async ({ page }) => {
    await resetBrowserStorage(page);
  });

  test("resizes panes with real figma submit", async ({ page }) => {
    test.skip(
      !ENABLE_LIVE_INSPECTOR_E2E || FIGMA_FILE_KEY.length === 0 || FIGMA_ACCESS_TOKEN.length === 0,
      "Set INSPECTOR_LIVE_E2E=1, FIGMA_FILE_KEY, and FIGMA_ACCESS_TOKEN to run live inspector e2e."
    );

    await openWorkspaceUi(page, liveViewport);

    await page.getByLabel("Figma file key").fill(FIGMA_FILE_KEY);
    await page.getByLabel("Figma access token").fill(FIGMA_ACCESS_TOKEN);

    let completed = false;
    let lastError: unknown = null;
    let exhaustedRateLimit = false;
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

    const treePane = page.getByTestId("inspector-pane-tree");
    const previewPane = page.getByTestId("inspector-pane-preview");
    const splitterTreePreview = page.getByTestId("inspector-splitter-tree-preview");

    await expect(splitterTreePreview).toBeVisible();

    const treeBefore = await getWidth(treePane);
    const previewBefore = await getWidth(previewPane);

    const splitterBox = await splitterTreePreview.boundingBox();
    expect(splitterBox).not.toBeNull();
    if (!splitterBox) {
      throw new Error("splitter bounding box missing");
    }

    await page.mouse.move(splitterBox.x + splitterBox.width / 2, splitterBox.y + splitterBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(splitterBox.x + splitterBox.width / 2 + 100, splitterBox.y + splitterBox.height / 2, {
      steps: 5
    });
    await page.mouse.up();

    const treeAfter = await getWidth(treePane);
    const previewAfter = await getWidth(previewPane);
    expect(treeAfter).toBeGreaterThan(treeBefore + 20);
    expect(previewAfter).toBeLessThan(previewBefore - 20);
  });
});
