import { expect, test, type Locator } from "@playwright/test";
import {
  cleanupDeterministicSubmitRoute,
  getInspectorLocators,
  openWorkspaceUi,
  resetBrowserStorage,
  setupDeterministicSubmitRoute,
  triggerDeterministicGeneration,
  waitForCompletedSubmitStatus
} from "./helpers";

const desktopViewport = { width: 1920, height: 1080 } as const;
const mobileViewport = { width: 390, height: 844 } as const;

async function getWidth(locator: Locator): Promise<number> {
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  return box?.width ?? 0;
}

function parseJobIdFromPreviewUrl(previewUrl: string): string {
  const match = previewUrl.match(/\/workspace\/repros\/([^/]+)\//);
  if (!match?.[1]) {
    throw new Error(`Could not parse job id from preview url: ${previewUrl}`);
  }
  return decodeURIComponent(match[1]);
}

test.describe("inspector resize deterministic flow (desktop)", () => {
  test.describe.configure({ mode: "serial", timeout: 180_000 });

  test.beforeEach(async ({ page }) => {
    await setupDeterministicSubmitRoute(page);
    await openWorkspaceUi(page, desktopViewport);
    await triggerDeterministicGeneration(page);
    await waitForCompletedSubmitStatus(page);
  });

  test.afterEach(async ({ page }) => {
    await cleanupDeterministicSubmitRoute(page);
    await resetBrowserStorage(page);
  });

  test("supports drag + keyboard resizing and stores pane layout", async ({ page }) => {
    const { previewIframe } = getInspectorLocators(page);

    const treePane = page.getByTestId("inspector-pane-tree");
    const previewPane = page.getByTestId("inspector-pane-preview");
    const splitterTreePreview = page.getByTestId("inspector-splitter-tree-preview");
    const splitterPreviewCode = page.getByTestId("inspector-splitter-preview-code");

    await expect(previewIframe).toBeVisible();
    await expect(splitterTreePreview).toBeVisible();
    await expect(splitterPreviewCode).toBeVisible();

    const treeBefore = await getWidth(treePane);
    const previewBefore = await getWidth(previewPane);

    const treeSplitterBox = await splitterTreePreview.boundingBox();
    expect(treeSplitterBox).not.toBeNull();
    if (!treeSplitterBox) {
      throw new Error("tree-preview splitter box is null");
    }

    await page.mouse.move(treeSplitterBox.x + treeSplitterBox.width / 2, treeSplitterBox.y + treeSplitterBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(treeSplitterBox.x + treeSplitterBox.width / 2 - 120, treeSplitterBox.y + treeSplitterBox.height / 2, {
      steps: 6
    });
    await page.mouse.up();

    const treeAfterFirstDrag = await getWidth(treePane);
    const previewAfterFirstDrag = await getWidth(previewPane);
    expect(treeAfterFirstDrag).toBeLessThan(treeBefore - 20);
    expect(previewAfterFirstDrag).toBeGreaterThan(previewBefore + 4);

    const previewSplitterBox = await splitterPreviewCode.boundingBox();
    expect(previewSplitterBox).not.toBeNull();
    if (!previewSplitterBox) {
      throw new Error("preview-code splitter box is null");
    }

    await page.mouse.move(previewSplitterBox.x + previewSplitterBox.width / 2, previewSplitterBox.y + previewSplitterBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(previewSplitterBox.x + previewSplitterBox.width / 2 + 140, previewSplitterBox.y + previewSplitterBox.height / 2, {
      steps: 6
    });
    await page.mouse.up();

    const previewAfterSecondDrag = await getWidth(previewPane);
    expect(previewAfterSecondDrag).toBeGreaterThan(previewAfterFirstDrag + 4);

    const ariaBefore = Number(await splitterPreviewCode.getAttribute("aria-valuenow"));
    await splitterPreviewCode.focus();
    await page.keyboard.press("ArrowRight");
    const ariaAfterRight = Number(await splitterPreviewCode.getAttribute("aria-valuenow"));
    if (ariaAfterRight === ariaBefore) {
      await page.keyboard.press("ArrowLeft");
      const ariaAfterLeft = Number(await splitterPreviewCode.getAttribute("aria-valuenow"));
      expect(ariaAfterLeft).toBeLessThan(ariaBefore);
    } else {
      expect(ariaAfterRight).toBeGreaterThan(ariaBefore);
    }

    const previewSrc = await previewIframe.getAttribute("src");
    expect(previewSrc).toBeTruthy();
    if (!previewSrc) {
      throw new Error("preview iframe src is empty");
    }
    const jobId = parseJobIdFromPreviewUrl(previewSrc);
    const storageKey = `workspace-dev:inspector-layout:v1:${jobId}`;

    const rawLayout = await page.evaluate((key) => window.localStorage.getItem(key), storageKey);
    expect(rawLayout).toBeTruthy();
    const parsed = JSON.parse(rawLayout ?? "{}") as { tree?: number; preview?: number; code?: number };

    expect(typeof parsed.tree).toBe("number");
    expect(typeof parsed.preview).toBe("number");
    expect(typeof parsed.code).toBe("number");
    expect((parsed.tree ?? 0) + (parsed.preview ?? 0) + (parsed.code ?? 0)).toBeCloseTo(1, 2);
  });
});

test.describe("inspector resize deterministic flow (mobile)", () => {
  test.describe.configure({ mode: "serial", timeout: 180_000 });

  test.beforeEach(async ({ page }) => {
    await setupDeterministicSubmitRoute(page);
    await openWorkspaceUi(page, mobileViewport);
    await triggerDeterministicGeneration(page);
    await waitForCompletedSubmitStatus(page);
  });

  test.afterEach(async ({ page }) => {
    await cleanupDeterministicSubmitRoute(page);
    await resetBrowserStorage(page);
  });

  test("keeps stacked layout and hidden splitters", async ({ page }) => {
    const previewPane = page.getByTestId("inspector-pane-preview");
    const codePane = page.getByTestId("inspector-pane-code");
    const splitterTreePreview = page.getByTestId("inspector-splitter-tree-preview");
    const splitterPreviewCode = page.getByTestId("inspector-splitter-preview-code");

    await expect(previewPane).toBeVisible();
    await expect(codePane).toBeVisible();
    await expect(splitterTreePreview).toBeHidden();
    await expect(splitterPreviewCode).toBeHidden();

    const previewBox = await previewPane.boundingBox();
    const codeBox = await codePane.boundingBox();
    expect(previewBox).not.toBeNull();
    expect(codeBox).not.toBeNull();
    if (!previewBox || !codeBox) {
      throw new Error("pane boxes are missing");
    }

    expect(previewBox.y).toBeLessThan(codeBox.y);
  });
});
