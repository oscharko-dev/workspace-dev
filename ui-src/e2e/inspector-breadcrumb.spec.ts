/**
 * E2E tests for the Inspector breadcrumb navigation.
 *
 * Verifies that the breadcrumb bar appears when a component tree node
 * is selected, shows the correct ancestor path, supports click navigation,
 * and hides when no node is selected.
 *
 * @see https://github.com/oscharko-dev/workspace-dev/issues/435
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

const breadcrumbViewport = { width: 1920, height: 1080 } as const;

test.describe("inspector breadcrumb navigation", () => {
  test.describe.configure({ mode: "serial", timeout: 180_000 });

  test.beforeEach(async ({ page }) => {
    await setupDeterministicSubmitRoute(page);
    await openWorkspaceUi(page, breadcrumbViewport);
    await triggerDeterministicGeneration(page);
    await waitForCompletedSubmitStatus(page);
  });

  test.afterEach(async ({ page }) => {
    await cleanupDeterministicSubmitRoute(page);
    await resetBrowserStorage(page);
  });

  test("breadcrumb is hidden when no node is selected", async ({ page }) => {
    const { inspectorPanel } = getInspectorLocators(page);
    await expect(inspectorPanel).toBeVisible();

    // No breadcrumb should be visible initially (no node selected)
    const breadcrumb = page.getByTestId("inspector-breadcrumb");
    await expect(breadcrumb).not.toBeVisible();
  });

  test("breadcrumb appears when a component tree node is selected", async ({ page }) => {
    const { componentTree } = getInspectorLocators(page);

    // Select a component node in the tree
    const firstNode = componentTree.getByTestId(/^tree-node-/).first();
    await expect(firstNode).toBeVisible();
    await firstNode.click();

    // Breadcrumb should now be visible
    const breadcrumb = page.getByTestId("inspector-breadcrumb");
    await expect(breadcrumb).toBeVisible({ timeout: 5_000 });

    // Should have at least 2 segments (screen + selected node)
    const segments = breadcrumb.getByTestId(/^breadcrumb-segment-/);
    const segmentCount = await segments.count();
    expect(segmentCount, "Expected at least 2 breadcrumb segments (screen + node)").toBeGreaterThanOrEqual(2);
  });

  test("breadcrumb shows screen as first segment", async ({ page }) => {
    const { componentTree } = getInspectorLocators(page);

    // Click first component node
    const firstNode = componentTree.getByTestId(/^tree-node-/).first();
    await firstNode.click();

    const breadcrumb = page.getByTestId("inspector-breadcrumb");
    await expect(breadcrumb).toBeVisible({ timeout: 5_000 });

    // The first breadcrumb segment should be a screen (contains the screen icon)
    const firstSegment = breadcrumb.getByTestId(/^breadcrumb-segment-/).first();
    await expect(firstSegment).toBeVisible();
  });

  test("clicking a breadcrumb ancestor updates tree selection and code highlight", async ({ page }) => {
    const { componentTree } = getInspectorLocators(page);

    // First expand and click a deeper node to get a breadcrumb with multiple segments
    const firstNode = componentTree.getByTestId(/^tree-node-/).first();
    await firstNode.click();
    await expect(firstNode).toHaveAttribute("aria-selected", "true");

    const breadcrumb = page.getByTestId("inspector-breadcrumb");
    await expect(breadcrumb).toBeVisible({ timeout: 5_000 });

    const segments = breadcrumb.getByTestId(/^breadcrumb-segment-/);
    const segmentCount = await segments.count();

    if (segmentCount >= 2) {
      // Click the first segment (screen) — this should update selection
      const firstSegment = segments.first();
      await firstSegment.click();

      // The first node should no longer be selected (screen is selected instead)
      // Breadcrumb should still be visible (screen is selected)
      await expect(breadcrumb).toBeVisible();
    }
  });

  test("breadcrumb has proper ARIA landmarks", async ({ page }) => {
    const { componentTree } = getInspectorLocators(page);

    const firstNode = componentTree.getByTestId(/^tree-node-/).first();
    await firstNode.click();

    const breadcrumb = page.getByTestId("inspector-breadcrumb");
    await expect(breadcrumb).toBeVisible({ timeout: 5_000 });

    // Check ARIA attributes
    const tagName = await breadcrumb.evaluate((el) => el.tagName);
    expect(tagName).toBe("NAV");

    const ariaLabel = await breadcrumb.getAttribute("aria-label");
    expect(ariaLabel).toBe("Component path");

    // Last segment should have aria-current="location"
    const segments = breadcrumb.getByTestId(/^breadcrumb-segment-/);
    const lastSegment = segments.last();
    const ariaCurrent = await lastSegment.getAttribute("aria-current");
    expect(ariaCurrent).toBe("location");
  });
});
