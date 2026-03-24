import { expect, test } from "@playwright/test";
import {
  cleanupDeterministicSubmitRoute,
  getInspectorLocators,
  openInspector,
  openWorkspaceUi,
  resetBrowserStorage,
  setupDeterministicSubmitRoute,
  triggerDeterministicGeneration,
  waitForCompletedSubmitStatus
} from "./helpers";

const inspectorViewport = { width: 1920, height: 1080 } as const;

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

test.describe("inspector codeviewer find + line jump deterministic flow", () => {
  test.describe.configure({ mode: "serial", timeout: 180_000 });

  test.beforeEach(async ({ page }) => {
    await setupDeterministicSubmitRoute(page);
    await openWorkspaceUi(page, inspectorViewport);
    await triggerDeterministicGeneration(page);
    await waitForCompletedSubmitStatus(page);
    await openInspector(page);
  });

  test.afterEach(async ({ page }) => {
    await cleanupDeterministicSubmitRoute(page);
    await resetBrowserStorage(page);
  });

  test("supports find navigation and :line jump while preserving IR highlight range", async ({ page }) => {
    const { codeViewer, componentTree } = getInspectorLocators(page);
    await expect(codeViewer).toBeVisible();

    const firstComponentNode = componentTree.getByTestId(/^tree-node-/).first();
    await expect(firstComponentNode).toBeVisible();
    await firstComponentNode.click();
    await expect(page.getByTestId("highlighted-line").first()).toBeVisible();

    const findInput = page.getByTestId("code-viewer-find-input");
    const findCount = page.getByTestId("code-viewer-find-count");
    await expect(findInput).toBeVisible();
    await expect(page.getByTestId("code-viewer-find-prev")).toBeVisible();
    await expect(page.getByTestId("code-viewer-find-next")).toBeVisible();

    await page.keyboard.press("Control+f");
    await expect(findInput).toBeFocused();

    await findInput.fill("e");
    await expect(findCount).toHaveText(/\d+ of \d+/);
    const beforeText = (await findCount.textContent())?.trim() ?? "";
    const before = parseCountText(beforeText);
    expect(before.total).toBeGreaterThan(0);

    await page.keyboard.press("Enter");
    await expect(findCount).toHaveText(/\d+ of \d+/);
    const afterNextText = (await findCount.textContent())?.trim() ?? "";
    const afterNext = parseCountText(afterNextText);
    const expectedNext = before.current === before.total ? 1 : before.current + 1;
    expect(afterNext.current).toBe(expectedNext);

    await page.keyboard.down("Shift");
    await page.keyboard.press("Enter");
    await page.keyboard.up("Shift");
    await expect(findCount).toHaveText(/\d+ of \d+/);
    const afterPrevText = (await findCount.textContent())?.trim() ?? "";
    const afterPrev = parseCountText(afterPrevText);
    expect(afterPrev.current).toBe(before.current);

    const lineCount = await page.getByTestId("line-number").count();
    expect(lineCount).toBeGreaterThan(0);

    await findInput.fill(":99999");
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("code-viewer-jump-target-line")).toContainText(String(lineCount));
    await expect(page.getByTestId("highlighted-line").first()).toBeVisible();
  });
});
