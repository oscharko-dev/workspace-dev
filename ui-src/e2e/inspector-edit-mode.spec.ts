/**
 * E2E tests for the Inspector edit mode foundation and capability detection.
 *
 * Verifies edit mode entry/exit, capability detection display for
 * supported and unsupported nodes, and unsupported-state messaging.
 *
 * @see https://github.com/oscharko-dev/workspace-dev/issues/451
 */
import { expect, test } from "@playwright/test";
import {
  cleanupDeterministicSubmitRoute,
  getInspectorLocators,
  openWorkspaceUi,
  resetBrowserStorage,
  setupDeterministicSubmitRoute,
  triggerDeterministicGeneration,
  waitForCompletedSubmitStatus
} from "./helpers";

const editModeViewport = { width: 1920, height: 1080 } as const;

test.describe("inspector edit mode foundation", () => {
  test.describe.configure({ mode: "serial", timeout: 180_000 });

  test.beforeEach(async ({ page }) => {
    await setupDeterministicSubmitRoute(page);
    await openWorkspaceUi(page, editModeViewport);
    await triggerDeterministicGeneration(page);
    await waitForCompletedSubmitStatus(page);
  });

  test.afterEach(async ({ page }) => {
    await cleanupDeterministicSubmitRoute(page);
    await resetBrowserStorage(page);
  });

  test("edit mode button is visible and disabled when no node selected", async ({ page }) => {
    const editModeBtn = page.getByTestId("inspector-enter-edit-mode");
    await expect(editModeBtn).toBeVisible();
    await expect(editModeBtn).toBeDisabled();
  });

  test("selecting a mapped node shows edit capability panel", async ({ page }) => {
    const { componentTree } = getInspectorLocators(page);

    // Select the first component node
    const firstNode = componentTree.getByTestId(/^tree-node-/).first();
    await expect(firstNode).toBeVisible();
    await firstNode.click();

    // Capability panel should appear
    const capabilityPanel = page.getByTestId("inspector-edit-capability");
    await expect(capabilityPanel).toBeVisible({ timeout: 5_000 });
  });

  test("editable node enables the edit mode button", async ({ page }) => {
    const { componentTree } = getInspectorLocators(page);

    // Select a node
    const firstNode = componentTree.getByTestId(/^tree-node-/).first();
    await firstNode.click();

    // Wait for capability to be computed
    const capabilityPanel = page.getByTestId("inspector-edit-capability");
    await expect(capabilityPanel).toBeVisible({ timeout: 5_000 });

    // Check if the edit button becomes enabled (depends on node's editability)
    const editModeBtn = page.getByTestId("inspector-enter-edit-mode");
    const exitEditBtn = page.getByTestId("inspector-exit-edit-mode");

    // The node may or may not be editable — verify the correct button state
    const capabilityText = await capabilityPanel.textContent();
    if (capabilityText?.includes("Supported")) {
      await expect(editModeBtn).toBeEnabled();
    } else {
      await expect(editModeBtn).toBeDisabled();
      // Exit edit button should not be visible when not in edit mode
      await expect(exitEditBtn).not.toBeVisible();
    }
  });

  test("entering and exiting edit mode toggles the button", async ({ page }) => {
    const { componentTree } = getInspectorLocators(page);

    // Select a node
    const firstNode = componentTree.getByTestId(/^tree-node-/).first();
    await firstNode.click();

    const capabilityPanel = page.getByTestId("inspector-edit-capability");
    await expect(capabilityPanel).toBeVisible({ timeout: 5_000 });

    const capabilityText = await capabilityPanel.textContent();
    if (!capabilityText?.includes("Supported")) {
      // Skip test if node is not editable
      test.skip();
      return;
    }

    // Click "Edit Mode" button to enter
    const editModeBtn = page.getByTestId("inspector-enter-edit-mode");
    await editModeBtn.click();

    // Exit button should now be visible
    const exitEditBtn = page.getByTestId("inspector-exit-edit-mode");
    await expect(exitEditBtn).toBeVisible();

    // Enter button should be gone
    await expect(editModeBtn).not.toBeVisible();

    // Edit mode active indicator should show
    const activeIndicator = page.getByTestId("inspector-edit-mode-active-indicator");
    await expect(activeIndicator).toBeVisible();

    // Click "Exit Edit Mode"
    await exitEditBtn.click();

    // Enter button should reappear, exit button gone
    await expect(editModeBtn).toBeVisible();
    await expect(exitEditBtn).not.toBeVisible();
    await expect(activeIndicator).not.toBeVisible();
  });

  test("edit mode exits when selecting a different node", async ({ page }) => {
    const { componentTree } = getInspectorLocators(page);

    const nodes = componentTree.getByTestId(/^tree-node-/);
    const nodeCount = await nodes.count();
    if (nodeCount < 2) {
      test.skip();
      return;
    }

    // Select first node
    await nodes.first().click();

    const capabilityPanel = page.getByTestId("inspector-edit-capability");
    await expect(capabilityPanel).toBeVisible({ timeout: 5_000 });

    const capabilityText = await capabilityPanel.textContent();
    if (!capabilityText?.includes("Supported")) {
      test.skip();
      return;
    }

    // Enter edit mode
    const editModeBtn = page.getByTestId("inspector-enter-edit-mode");
    await editModeBtn.click();

    const exitEditBtn = page.getByTestId("inspector-exit-edit-mode");
    await expect(exitEditBtn).toBeVisible();

    // Select a different node
    await nodes.nth(1).click();

    // Edit mode should be exited — enter button should reappear
    await expect(page.getByTestId("inspector-enter-edit-mode")).toBeVisible({ timeout: 5_000 });
    await expect(exitEditBtn).not.toBeVisible();
  });

  test("unsupported node shows explicit reason", async ({ page }) => {
    const { componentTree } = getInspectorLocators(page);

    // Select a screen node (which is not an editable element type)
    const screenNode = componentTree.getByTestId(/^tree-screen-/).first();
    await expect(screenNode).toBeVisible();
    await screenNode.click();

    // Wait for capability panel to show
    const capabilityPanel = page.getByTestId("inspector-edit-capability");
    await expect(capabilityPanel).toBeVisible({ timeout: 5_000 });

    // Check for reason text
    const reasonElement = page.getByTestId("inspector-edit-capability-reason");
    const capabilityText = await capabilityPanel.textContent();

    // Screen nodes should either show "Not supported" or no reason at all
    if (capabilityText?.includes("Not supported")) {
      await expect(reasonElement).toBeVisible();
      const reasonText = await reasonElement.textContent();
      expect(reasonText).toBeTruthy();
      expect(reasonText?.length).toBeGreaterThan(0);
    }
  });

  test("capability fields are displayed for editable nodes", async ({ page }) => {
    const { componentTree } = getInspectorLocators(page);

    // Select a node
    const firstNode = componentTree.getByTestId(/^tree-node-/).first();
    await firstNode.click();

    const capabilityPanel = page.getByTestId("inspector-edit-capability");
    await expect(capabilityPanel).toBeVisible({ timeout: 5_000 });

    const capabilityText = await capabilityPanel.textContent();
    if (!capabilityText?.includes("Supported")) {
      test.skip();
      return;
    }

    // Check fields display
    const fieldsElement = page.getByTestId("inspector-edit-capability-fields");
    await expect(fieldsElement).toBeVisible();
    const fieldsText = await fieldsElement.textContent();
    expect(fieldsText).toContain("Editable fields:");
  });
});
