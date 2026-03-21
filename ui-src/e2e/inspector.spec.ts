import { expect, test } from "@playwright/test";
import {
  cleanupDeterministicSubmitRoute,
  collectPreviewNodeIds,
  findFirstSyncedNodeId,
  getInspectorLocators,
  installClipboardMock,
  openWorkspaceUi,
  resetBrowserStorage,
  selectSecondInspectorFile,
  setupDeterministicSubmitRoute,
  triggerDeterministicGeneration,
  waitForCompletedSubmitStatus
} from "./helpers";

const inspectorViewport = { width: 1920, height: 1080 } as const;

test.describe("inspector deterministic flow", () => {
  test.describe.configure({ mode: "serial", timeout: 180_000 });

  test.beforeEach(async ({ page }) => {
    await installClipboardMock(page);
    await setupDeterministicSubmitRoute(page);
    await openWorkspaceUi(page, inspectorViewport);
    await triggerDeterministicGeneration(page);
    await waitForCompletedSubmitStatus(page);
  });

  test.afterEach(async ({ page }) => {
    await cleanupDeterministicSubmitRoute(page);
    await resetBrowserStorage(page);
  });

  test("shows inspector pane with preview and generated source files", async ({ page }) => {
    const { inspectorPanel, componentTree, previewIframe, codeViewer, fileSelector } = getInspectorLocators(page);

    await expect(inspectorPanel).toBeVisible();
    await expect(componentTree).toBeVisible();
    await expect(previewIframe).toBeVisible();
    await expect(codeViewer).toBeVisible();
    await expect(fileSelector).toBeVisible();

    const optionCount = await fileSelector.getByRole("option").count();
    expect(optionCount, "Expected at least one generated file option in the inspector selector").toBeGreaterThan(0);

    const selectedSecondFile = await selectSecondInspectorFile(fileSelector);
    if (selectedSecondFile) {
      await expect(page.getByTestId("code-viewer-filepath")).toHaveText(selectedSecondFile);
    }
  });

  test("supports component tree expand and collapse with source line highlighting", async ({ page }) => {
    const { componentTree } = getInspectorLocators(page);
    const firstScreen = componentTree.getByTestId(/^tree-screen-/).first();

    await expect(firstScreen).toBeVisible();

    const collapseButton = firstScreen.getByRole("button", { name: "Collapse" });
    await collapseButton.click();
    await expect(firstScreen.getByRole("button", { name: "Expand" })).toBeVisible();

    await firstScreen.getByRole("button", { name: "Expand" }).click();
    await expect(firstScreen.getByRole("button", { name: "Collapse" })).toBeVisible();

    const firstComponentNode = componentTree.getByTestId(/^tree-node-/).first();
    await expect(firstComponentNode).toBeVisible();
    await firstComponentNode.click();

    await expect(firstComponentNode).toHaveAttribute("aria-selected", "true");
    await expect(page.getByTestId("highlighted-line").first()).toBeVisible();
  });

  test("syncs inspect mode preview clicks to component tree selection", async ({ page }) => {
    const { previewFrame } = getInspectorLocators(page);
    const inspectToggle = page.getByTestId("inspect-toggle");

    await expect(inspectToggle).toBeVisible();
    await inspectToggle.click();
    await expect(inspectToggle).toHaveAttribute("aria-pressed", "true");

    const previewNodeIds = await collectPreviewNodeIds(previewFrame);
    expect(previewNodeIds.length, "Expected preview to expose inspectable nodes").toBeGreaterThan(0);

    const syncedNodeId = await findFirstSyncedNodeId(page, previewNodeIds);
    expect(syncedNodeId, "Expected at least one preview node to map to a component tree node").toBeTruthy();

    await previewFrame.locator(`[data-ir-id='${syncedNodeId!}']`).first().click({ force: true });

    const syncedTreeNode = page.getByTestId(`tree-node-${syncedNodeId!}`);
    await expect(syncedTreeNode).toHaveAttribute("aria-selected", "true");
    await expect(page.getByTestId("code-content")).toBeVisible();
  });

  test("copies highlighted source text from inspector code viewer", async ({ page }) => {
    const { componentTree } = getInspectorLocators(page);
    const firstComponentNode = componentTree.getByTestId(/^tree-node-/).first();

    await expect(firstComponentNode).toBeVisible();
    await firstComponentNode.click();
    await expect(page.getByTestId("highlighted-line").first()).toBeVisible();

    const copyButton = page.getByTestId("inspector-copy-button");
    await expect(copyButton).toBeVisible();
    await copyButton.click();
    await expect(copyButton).toHaveText("Copied!");
  });
});
