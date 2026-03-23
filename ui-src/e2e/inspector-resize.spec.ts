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
const deterministicSubmitTimeoutMs = 120_000;

async function getWidth(locator: Locator): Promise<number> {
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  return box?.width ?? 0;
}

async function dispatchPointerDrag({
  separator,
  deltaX,
  endEvent = "pointerup",
  pointerId = 1
}: {
  separator: Locator;
  deltaX: number;
  endEvent?: "lostpointercapture" | "pointerup";
  pointerId?: number;
}): Promise<void> {
  const box = await separator.boundingBox();
  expect(box).not.toBeNull();
  if (!box) {
    throw new Error("splitter bounding box is null");
  }

  const startX = box.x + box.width / 2;
  const startY = box.y + box.height / 2;
  const endX = startX + deltaX;

  await separator.dispatchEvent("pointerdown", {
    pointerId,
    clientX: startX,
    clientY: startY,
    pointerType: "mouse",
    isPrimary: true,
    buttons: 1
  });
  await separator.dispatchEvent("pointermove", {
    pointerId,
    clientX: endX,
    clientY: startY,
    pointerType: "mouse",
    isPrimary: true,
    buttons: 1
  });
  await separator.dispatchEvent(endEvent, {
    pointerId,
    clientX: endEvent === "lostpointercapture" ? 0 : endX,
    clientY: startY,
    pointerType: "mouse",
    isPrimary: true,
    buttons: endEvent === "pointerup" ? 0 : 1
  });
}

function parseJobIdFromPreviewUrl(previewUrl: string): string {
  const match = previewUrl.match(/\/workspace\/repros\/([^/]+)\//);
  if (!match?.[1]) {
    throw new Error(`Could not parse job id from preview url: ${previewUrl}`);
  }
  return decodeURIComponent(match[1]);
}

async function openPreparedInspector({
  page,
  viewport,
  inspectorUrl
}: {
  page: Parameters<typeof openWorkspaceUi>[0];
  viewport: typeof desktopViewport | typeof mobileViewport;
  inspectorUrl: string;
}): Promise<void> {
  expect(inspectorUrl, "Expected inspector setup URL to be available").toBeTruthy();
  await openWorkspaceUi(page, viewport);
  const inspectorRoute = new URL(inspectorUrl).pathname + new URL(inspectorUrl).search;
  await page.evaluate((route) => {
    window.history.pushState({}, "", route);
    window.dispatchEvent(new PopStateEvent("popstate"));
  }, inspectorRoute);
  await expect(getInspectorLocators(page).inspectorPanel).toBeVisible();
}

test.describe("inspector resize deterministic flow", () => {
  test.describe.configure({ mode: "serial" });
  let inspectorUrl = "";

  test.beforeAll(async ({ browser }) => {
    const page = await browser.newPage({ viewport: desktopViewport });

    try {
      await setupDeterministicSubmitRoute(page);
      await openWorkspaceUi(page, desktopViewport);
      await triggerDeterministicGeneration(page);
      await waitForCompletedSubmitStatus(page, { timeoutMs: deterministicSubmitTimeoutMs });

      const openInspectorButton = page.getByRole("button", { name: "Open Inspector" });
      await expect(openInspectorButton).toBeVisible({ timeout: 15_000 });
      await openInspectorButton.click();
      await expect(page).toHaveURL(/\/workspace\/ui\/inspector\?/);
      inspectorUrl = page.url();
    } finally {
      await cleanupDeterministicSubmitRoute(page);
      await page.close();
    }
  });

  test.describe("desktop", () => {
    test.describe.configure({ mode: "serial", timeout: 120_000 });

    test.beforeEach(async ({ page }) => {
      await openPreparedInspector({ page, viewport: desktopViewport, inspectorUrl });
    });

    test.afterEach(async ({ page }) => {
      await resetBrowserStorage(page);
    });

    test("supports drag + keyboard resizing and stores pane layout", async ({ page }) => {
      const { previewIframe } = getInspectorLocators(page);

      const treePane = page.getByTestId("inspector-pane-tree");
      const previewPane = page.getByTestId("inspector-pane-preview");
      const codePane = page.getByTestId("inspector-pane-code");
      const splitterTreePreview = page.getByTestId("inspector-splitter-tree-preview");
      const splitterPreviewCode = page.getByTestId("inspector-splitter-preview-code");
      const treeCollapseButton = page.getByTestId("tree-collapse-button");
      const treeExpandButton = page.getByTestId("tree-expand-button");

      await expect(previewIframe).toBeVisible();
      await expect(splitterTreePreview).toBeVisible();
      await expect(splitterPreviewCode).toBeVisible();

      const treeBefore = await getWidth(treePane);
      const previewBefore = await getWidth(previewPane);
      const codeBefore = await getWidth(codePane);
      expect(Math.abs(treeBefore - previewBefore)).toBeLessThanOrEqual(24);
      expect(Math.abs(previewBefore - codeBefore)).toBeLessThanOrEqual(24);

      await dispatchPointerDrag({
        separator: splitterTreePreview,
        deltaX: -120,
        pointerId: 11
      });

      const treeAfterFirstDrag = await getWidth(treePane);
      const previewAfterFirstDrag = await getWidth(previewPane);
      expect(treeAfterFirstDrag).toBeLessThan(treeBefore - 20);
      expect(previewAfterFirstDrag).toBeGreaterThan(previewBefore + 4);
      const treeAriaAfterDrag = Number(await splitterTreePreview.getAttribute("aria-valuenow"));

      await treeCollapseButton.click();
      await expect(treeCollapseButton).toHaveCount(0);
      await expect(treeExpandButton).toBeVisible();
      await expect(splitterTreePreview).toHaveCount(0);

      await treeExpandButton.click();
      await expect(splitterTreePreview).toBeVisible();
      const treeAfterReExpand = await getWidth(treePane);
      expect(Math.abs(treeAfterReExpand - treeAfterFirstDrag)).toBeLessThanOrEqual(4);
      expect(Number(await splitterTreePreview.getAttribute("aria-valuenow"))).toBe(treeAriaAfterDrag);

      await dispatchPointerDrag({
        separator: splitterPreviewCode,
        deltaX: 140,
        endEvent: "lostpointercapture",
        pointerId: 12
      });

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

  test.describe("mobile", () => {
    test.describe.configure({ mode: "serial", timeout: 60_000 });

    test.beforeEach(async ({ page }) => {
      await openPreparedInspector({ page, viewport: mobileViewport, inspectorUrl });
    });

    test.afterEach(async ({ page }) => {
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
});
