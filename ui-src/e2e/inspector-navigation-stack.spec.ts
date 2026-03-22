/**
 * E2E tests for Inspector drilldown navigation stack controls.
 *
 * Verifies back/forward traversal, one-level-up behavior, and forward
 * truncation when branching from an older committed snapshot.
 *
 * @see https://github.com/oscharko-dev/workspace-dev/issues/445
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

const navigationViewport = { width: 1920, height: 1080 } as const;

test.describe("inspector drilldown navigation stack", () => {
  test.describe.configure({ mode: "serial", timeout: 180_000 });

  test.beforeEach(async ({ page }) => {
    await setupDeterministicSubmitRoute(page);
    await openWorkspaceUi(page, navigationViewport);
    await triggerDeterministicGeneration(page);
    await waitForCompletedSubmitStatus(page);
  });

  test.afterEach(async ({ page }) => {
    await cleanupDeterministicSubmitRoute(page);
    await resetBrowserStorage(page);
  });

  test("back and forward move through committed drilldown states", async ({ page }) => {
    const { componentTree } = getInspectorLocators(page);
    const nodes = componentTree.getByTestId(/^tree-node-/);
    const nodeCount = await nodes.count();
    test.skip(nodeCount < 2, "Need at least two non-screen component nodes.");

    const firstNode = nodes.first();
    const secondNode = nodes.nth(1);
    const firstNodeId = await firstNode.getAttribute("data-node-id");
    const secondNodeId = await secondNode.getAttribute("data-node-id");
    if (!firstNodeId || !secondNodeId) {
      test.skip(true, "Expected tree nodes to expose data-node-id attributes.");
    }

    const backButton = page.getByTestId("inspector-nav-back");
    const forwardButton = page.getByTestId("inspector-nav-forward");
    await expect(backButton).toBeDisabled();
    await expect(forwardButton).toBeDisabled();

    await firstNode.click();
    await expect(firstNode).toHaveAttribute("aria-selected", "true");
    await secondNode.click();
    await expect(secondNode).toHaveAttribute("aria-selected", "true");

    await expect(backButton).toBeEnabled();
    await expect(forwardButton).toBeDisabled();
    await backButton.click();
    await expect(firstNode).toHaveAttribute("aria-selected", "true");
    await expect(page.getByTestId(`breadcrumb-segment-${firstNodeId}`)).toHaveAttribute("aria-current", "location");

    await expect(forwardButton).toBeEnabled();
    await forwardButton.click();
    await expect(secondNode).toHaveAttribute("aria-selected", "true");
    await expect(page.getByTestId(`breadcrumb-segment-${secondNodeId}`)).toHaveAttribute("aria-current", "location");
  });

  test("level up pops exactly one scope level at a time", async ({ page }) => {
    const { componentTree } = getInspectorLocators(page);
    const nodes = componentTree.getByTestId(/^tree-node-/);
    const nodeCount = await nodes.count();
    test.skip(nodeCount < 2, "Need at least two non-screen component nodes.");

    const firstNode = nodes.first();
    const secondNode = nodes.nth(1);
    const firstNodeId = await firstNode.getAttribute("data-node-id");
    if (!firstNodeId) {
      test.skip(true, "Expected first tree node to expose data-node-id.");
    }

    await firstNode.click();
    await expect(page.getByTestId("inspector-breadcrumb")).toBeVisible();
    await page.getByTestId("breadcrumb-enter-scope").click();

    await secondNode.click();
    await page.getByTestId("breadcrumb-enter-scope").click();
    await expect(page.getByTestId("breadcrumb-scope-badge")).toBeVisible();

    const levelUpButton = page.getByTestId("breadcrumb-exit-scope");
    await expect(levelUpButton).toHaveText("Level up");
    await levelUpButton.click();

    await expect(page.getByTestId("breadcrumb-scope-badge")).toBeVisible();
    await expect(page.getByTestId(`tree-node-${firstNodeId}`)).toHaveAttribute("aria-selected", "true");

    await levelUpButton.click();
    await expect(page.getByTestId("breadcrumb-scope-badge")).not.toBeVisible();
  });

  test("new committed navigation from a back state truncates forward history", async ({ page }) => {
    const { componentTree } = getInspectorLocators(page);
    const nodes = componentTree.getByTestId(/^tree-node-/);
    const nodeCount = await nodes.count();
    test.skip(nodeCount < 3, "Need at least three non-screen component nodes.");

    const firstNode = nodes.nth(0);
    const secondNode = nodes.nth(1);
    const thirdNode = nodes.nth(2);
    const thirdNodeId = await thirdNode.getAttribute("data-node-id");
    if (!thirdNodeId) {
      test.skip(true, "Expected third tree node to expose data-node-id.");
    }

    const backButton = page.getByTestId("inspector-nav-back");
    const forwardButton = page.getByTestId("inspector-nav-forward");

    await firstNode.click();
    await secondNode.click();
    await expect(backButton).toBeEnabled();

    await backButton.click();
    await expect(forwardButton).toBeEnabled();

    await thirdNode.click();
    await expect(page.getByTestId(`tree-node-${thirdNodeId}`)).toHaveAttribute("aria-selected", "true");
    await expect(forwardButton).toBeDisabled();
  });
});
