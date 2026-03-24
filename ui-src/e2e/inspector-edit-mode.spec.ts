/**
 * E2E tests for the Inspector edit mode foundation and capability detection.
 *
 * Verifies edit mode entry/exit, capability badge behavior, and disabled-state
 * reason messaging against the current Inspector toolbar UI.
 *
 * @see https://github.com/oscharko-dev/workspace-dev/issues/451
 */
import { expect, test, type Locator, type Page } from "@playwright/test";
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

const editModeViewport = { width: 1920, height: 1080 } as const;

function isEditableCapabilityText(value: string | null): boolean {
  return Boolean(value?.startsWith("Edit: "));
}

async function getCapabilityBadge(page: Page): Promise<Locator> {
  const capabilityBadge = page.getByTestId("inspector-edit-capability");
  await expect(capabilityBadge).toBeVisible({ timeout: 5_000 });
  return capabilityBadge;
}

async function selectFirstEditableNode(page: Page): Promise<string> {
  const { componentTree } = getInspectorLocators(page);
  const nodes = componentTree.getByTestId(/^tree-node-/);
  const nodeCount = await nodes.count();

  for (let index = 0; index < nodeCount; index += 1) {
    const node = nodes.nth(index);
    await node.click();

    const capabilityBadge = await getCapabilityBadge(page);
    const capabilityText = await capabilityBadge.textContent();
    if (!isEditableCapabilityText(capabilityText)) {
      continue;
    }

    const nodeId = await node.getAttribute("data-node-id");
    if (typeof nodeId === "string" && nodeId.length > 0) {
      await expect(page.getByTestId("inspector-enter-edit-mode")).toBeEnabled();
      return nodeId;
    }
  }

  throw new Error("No editable node was found in the deterministic inspector tree.");
}

async function selectDifferentNode(page: Page, currentNodeId: string): Promise<void> {
  const { componentTree } = getInspectorLocators(page);
  const nodes = componentTree.getByTestId(/^tree-node-/);
  const nodeCount = await nodes.count();

  for (let index = 0; index < nodeCount; index += 1) {
    const node = nodes.nth(index);
    const nodeId = await node.getAttribute("data-node-id");
    if (!nodeId || nodeId === currentNodeId) {
      continue;
    }

    await node.click();
    return;
  }

  throw new Error("Could not find a second inspector node to verify edit mode exit behavior.");
}

test.describe("inspector edit mode foundation", () => {
  test.describe.configure({ mode: "serial", timeout: 180_000 });

  test.beforeEach(async ({ page }) => {
    await setupDeterministicSubmitRoute(page);
    await openWorkspaceUi(page, editModeViewport);
    await triggerDeterministicGeneration(page);
    await waitForCompletedSubmitStatus(page);
    await openInspector(page);
  });

  test.afterEach(async ({ page }) => {
    await cleanupDeterministicSubmitRoute(page);
    await resetBrowserStorage(page);
  });

  test("edit mode button is visible before edit mode starts", async ({ page }) => {
    const editModeButton = page.getByTestId("inspector-enter-edit-mode");
    await expect(editModeButton).toBeVisible();
    await expect(page.getByTestId("inspector-edit-studio-panel")).toHaveCount(0);

    const capabilityBadge = page.getByTestId("inspector-edit-capability");
    if (await capabilityBadge.count()) {
      const capabilityText = await capabilityBadge.textContent();
      if (isEditableCapabilityText(capabilityText)) {
        await expect(editModeButton).toBeEnabled();
      } else {
        await expect(editModeButton).toBeDisabled();
      }
      const title = await editModeButton.getAttribute("title");
      expect(title).toBeTruthy();
    }
  });

  test("selecting a mapped node shows the capability badge", async ({ page }) => {
    const { componentTree } = getInspectorLocators(page);
    const firstNode = componentTree.getByTestId(/^tree-node-/).first();
    await expect(firstNode).toBeVisible();
    await firstNode.click();

    const capabilityBadge = await getCapabilityBadge(page);
    await expect(capabilityBadge).toHaveText(/^(Edit: \d+ fields|Not editable)$/);
  });

  test("editable node enables the edit mode button", async ({ page }) => {
    await selectFirstEditableNode(page);

    const capabilityBadge = await getCapabilityBadge(page);
    await expect(capabilityBadge).toHaveText(/^Edit: \d+ fields$/);
    await expect(page.getByTestId("inspector-enter-edit-mode")).toBeEnabled();
    await expect(page.getByTestId("inspector-exit-edit-mode")).toHaveCount(0);
  });

  test("entering and exiting edit mode toggles the toolbar controls", async ({ page }) => {
    await selectFirstEditableNode(page);

    const enterEditModeButton = page.getByTestId("inspector-enter-edit-mode");
    await enterEditModeButton.click();

    const exitEditModeButton = page.getByTestId("inspector-exit-edit-mode");
    await expect(exitEditModeButton).toBeVisible();
    await expect(enterEditModeButton).toHaveCount(0);
    await expect(page.getByTestId("inspector-edit-studio-panel")).toBeVisible();

    await exitEditModeButton.click();

    await expect(page.getByTestId("inspector-enter-edit-mode")).toBeVisible();
    await expect(page.getByTestId("inspector-enter-edit-mode")).toBeEnabled();
    await expect(page.getByTestId("inspector-exit-edit-mode")).toHaveCount(0);
    await expect(page.getByTestId("inspector-edit-studio-panel")).toHaveCount(0);
  });

  test("edit mode exits when selecting a different node", async ({ page }) => {
    const selectedNodeId = await selectFirstEditableNode(page);

    await page.getByTestId("inspector-enter-edit-mode").click();
    await expect(page.getByTestId("inspector-exit-edit-mode")).toBeVisible();
    await expect(page.getByTestId("inspector-edit-studio-panel")).toBeVisible();

    await selectDifferentNode(page, selectedNodeId);

    await expect(page.getByTestId("inspector-enter-edit-mode")).toBeVisible({ timeout: 5_000 });
    await expect(page.getByTestId("inspector-exit-edit-mode")).toHaveCount(0);
    await expect(page.getByTestId("inspector-edit-studio-panel")).toHaveCount(0);
  });

  test("non-editable nodes keep the button disabled and expose a concrete reason", async ({ page }) => {
    const { componentTree } = getInspectorLocators(page);
    const screenNode = componentTree.getByTestId(/^tree-screen-/).first();
    await expect(screenNode).toBeVisible();
    await screenNode.click();

    const capabilityBadge = await getCapabilityBadge(page);
    await expect(capabilityBadge).toHaveText("Not editable");

    const enterEditModeButton = page.getByTestId("inspector-enter-edit-mode");
    await expect(enterEditModeButton).toBeDisabled();

    const title = await enterEditModeButton.getAttribute("title");
    expect(title).toBeTruthy();
    expect(title).not.toBe("Select a node to check edit capability");
  });

  test("editable nodes show a positive field count in the capability badge", async ({ page }) => {
    await selectFirstEditableNode(page);

    const capabilityText = await (await getCapabilityBadge(page)).textContent();
    const fieldCountMatch = capabilityText?.match(/^Edit: (\d+) fields$/);
    expect(fieldCountMatch, `Expected editable capability text, got: ${capabilityText}`).toBeTruthy();
    expect(Number(fieldCountMatch?.[1] ?? "0")).toBeGreaterThan(0);
  });
});
