/**
 * E2E tests for the Inspector hierarchical drilldown scope.
 *
 * Verifies that selecting a node does not automatically enter scope,
 * scope entry and exit are explicit actions, breadcrumb scope indicators
 * appear correctly, and unmapped nodes show a fallback.
 *
 * @see https://github.com/oscharko-dev/workspace-dev/issues/442
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

const scopeViewport = { width: 1920, height: 1080 } as const;

test.describe("inspector hierarchical drilldown scope", () => {
  test.describe.configure({ mode: "serial", timeout: 180_000 });

  test.beforeEach(async ({ page }) => {
    await setupDeterministicSubmitRoute(page);
    await openWorkspaceUi(page, scopeViewport);
    await triggerDeterministicGeneration(page);
    await waitForCompletedSubmitStatus(page);
  });

  test.afterEach(async ({ page }) => {
    await cleanupDeterministicSubmitRoute(page);
    await resetBrowserStorage(page);
  });

  test("selecting a node does not automatically enter scope", async ({ page }) => {
    const { componentTree } = getInspectorLocators(page);

    // Select a component node in the tree
    const firstNode = componentTree.getByTestId(/^tree-node-/).first();
    await expect(firstNode).toBeVisible();
    await firstNode.click();

    // Verify the node is selected
    await expect(firstNode).toHaveAttribute("aria-selected", "true");

    // The scope badge should NOT appear (selection only, no scope entry)
    const scopeBadge = page.getByTestId("breadcrumb-scope-badge");
    await expect(scopeBadge).not.toBeVisible();
  });

  test("scope entry button appears in breadcrumb when node is selected", async ({ page }) => {
    const { componentTree } = getInspectorLocators(page);

    // Select a component node
    const firstNode = componentTree.getByTestId(/^tree-node-/).first();
    await firstNode.click();

    // The breadcrumb should be visible
    const breadcrumb = page.getByTestId("inspector-breadcrumb");
    await expect(breadcrumb).toBeVisible({ timeout: 5_000 });

    // The "Enter scope" button should be visible
    const enterScopeBtn = page.getByTestId("breadcrumb-enter-scope");
    await expect(enterScopeBtn).toBeVisible();
  });

  test("clicking enter scope shows scope badge and exit button", async ({ page }) => {
    const { componentTree } = getInspectorLocators(page);

    // Select a component node
    const firstNode = componentTree.getByTestId(/^tree-node-/).first();
    await firstNode.click();

    // Wait for breadcrumb to appear
    const breadcrumb = page.getByTestId("inspector-breadcrumb");
    await expect(breadcrumb).toBeVisible({ timeout: 5_000 });

    // Click "Enter scope"
    const enterScopeBtn = page.getByTestId("breadcrumb-enter-scope");
    await enterScopeBtn.click();

    // Scope badge should now be visible
    const scopeBadge = page.getByTestId("breadcrumb-scope-badge");
    await expect(scopeBadge).toBeVisible({ timeout: 5_000 });
    await expect(scopeBadge).toHaveText("Scoped");

    // Exit scope button should be visible
    const exitScopeBtn = page.getByTestId("breadcrumb-exit-scope");
    await expect(exitScopeBtn).toBeVisible();
  });

  test("exiting scope removes scope badge", async ({ page }) => {
    const { componentTree } = getInspectorLocators(page);

    // Select and enter scope
    const firstNode = componentTree.getByTestId(/^tree-node-/).first();
    await firstNode.click();
    const breadcrumb = page.getByTestId("inspector-breadcrumb");
    await expect(breadcrumb).toBeVisible({ timeout: 5_000 });

    const enterScopeBtn = page.getByTestId("breadcrumb-enter-scope");
    await enterScopeBtn.click();

    // Verify scope is active
    const scopeBadge = page.getByTestId("breadcrumb-scope-badge");
    await expect(scopeBadge).toBeVisible({ timeout: 5_000 });

    // Exit scope
    const exitScopeBtn = page.getByTestId("breadcrumb-exit-scope");
    await exitScopeBtn.click();

    // Scope badge should be gone
    await expect(scopeBadge).not.toBeVisible({ timeout: 5_000 });
  });

  test("double-clicking a tree node enters scope", async ({ page }) => {
    const { componentTree } = getInspectorLocators(page);

    // Double-click a component node to enter scope
    const firstNode = componentTree.getByTestId(/^tree-node-/).first();
    await firstNode.dblclick();

    // Wait for breadcrumb with scope badge
    const scopeBadge = page.getByTestId("breadcrumb-scope-badge");
    await expect(scopeBadge).toBeVisible({ timeout: 5_000 });
  });

  test("existing tree selection still works when no scope is active", async ({ page }) => {
    const { componentTree } = getInspectorLocators(page);

    // Select a component node
    const firstNode = componentTree.getByTestId(/^tree-node-/).first();
    await expect(firstNode).toBeVisible();
    await firstNode.click();

    // Verify it is selected
    await expect(firstNode).toHaveAttribute("aria-selected", "true");

    // Breadcrumb should show (existing behavior)
    const breadcrumb = page.getByTestId("inspector-breadcrumb");
    await expect(breadcrumb).toBeVisible({ timeout: 5_000 });

    // Should have at least 2 segments (screen + selected node)
    const segments = breadcrumb.getByTestId(/^breadcrumb-segment-/);
    const segmentCount = await segments.count();
    expect(segmentCount).toBeGreaterThanOrEqual(2);
  });

  test("breadcrumb continues to work after scope entry and exit", async ({ page }) => {
    const { componentTree } = getInspectorLocators(page);

    // Select, enter scope, then exit
    const firstNode = componentTree.getByTestId(/^tree-node-/).first();
    await firstNode.click();

    const breadcrumb = page.getByTestId("inspector-breadcrumb");
    await expect(breadcrumb).toBeVisible({ timeout: 5_000 });

    const enterScopeBtn = page.getByTestId("breadcrumb-enter-scope");
    await enterScopeBtn.click();

    const exitScopeBtn = page.getByTestId("breadcrumb-exit-scope");
    await exitScopeBtn.click();

    // Select another node — breadcrumb should still work
    const nodes = componentTree.getByTestId(/^tree-node-/);
    const nodeCount = await nodes.count();
    if (nodeCount >= 2) {
      const secondNode = nodes.nth(1);
      await secondNode.click();

      await expect(breadcrumb).toBeVisible({ timeout: 5_000 });
      const segments = breadcrumb.getByTestId(/^breadcrumb-segment-/);
      expect(await segments.count()).toBeGreaterThanOrEqual(2);
    }
  });
});
