/**
 * E2E tests for the Inspector split-view multi-file feature.
 *
 * Verifies that the split toggle button works, two code viewers appear
 * side-by-side, each has its own file selector, and toggling off returns
 * to single-file view.
 *
 * @see https://github.com/oscharko-dev/workspace-dev/issues/437
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

const splitViewport = { width: 1920, height: 1080 } as const;

test.describe("inspector split view", () => {
  test.describe.configure({ mode: "serial", timeout: 180_000 });

  test.beforeEach(async ({ page }) => {
    await setupDeterministicSubmitRoute(page);
    await openWorkspaceUi(page, splitViewport);
    await triggerDeterministicGeneration(page);
    await waitForCompletedSubmitStatus(page);
  });

  test.afterEach(async ({ page }) => {
    await cleanupDeterministicSubmitRoute(page);
    await resetBrowserStorage(page);
  });

  test("split toggle button is visible in the code pane toolbar", async ({ page }) => {
    const { inspectorPanel } = getInspectorLocators(page);
    await expect(inspectorPanel).toBeVisible();

    const splitToggle = page.getByTestId("inspector-split-toggle");
    await expect(splitToggle).toBeVisible({ timeout: 10_000 });
  });

  test("activating split shows two code panes with a divider", async ({ page }) => {
    const splitToggle = page.getByTestId("inspector-split-toggle");
    await expect(splitToggle).toBeVisible({ timeout: 10_000 });
    await splitToggle.click();

    const splitView = page.getByTestId("inspector-split-view");
    await expect(splitView).toBeVisible({ timeout: 5_000 });

    // Left and right panes should be visible
    await expect(page.getByTestId("inspector-split-left")).toBeVisible();
    await expect(page.getByTestId("inspector-split-right")).toBeVisible();

    // Divider should be present
    await expect(page.getByTestId("inspector-split-divider")).toBeVisible();
  });

  test("right pane has its own file selector", async ({ page }) => {
    const splitToggle = page.getByTestId("inspector-split-toggle");
    await expect(splitToggle).toBeVisible({ timeout: 10_000 });
    await splitToggle.click();

    await expect(page.getByTestId("inspector-split-view")).toBeVisible({ timeout: 5_000 });

    // Right pane file selector should be visible
    const splitSelector = page.getByTestId("inspector-split-file-selector");
    await expect(splitSelector).toBeVisible();

    // Should have multiple options
    const optionCount = await splitSelector.getByRole("option").count();
    expect(optionCount, "Expected at least one file option in split selector").toBeGreaterThan(0);
  });

  test("toggling split off returns to single code viewer", async ({ page }) => {
    const splitToggle = page.getByTestId("inspector-split-toggle");
    await expect(splitToggle).toBeVisible({ timeout: 10_000 });

    // Enable split
    await splitToggle.click();
    await expect(page.getByTestId("inspector-split-view")).toBeVisible({ timeout: 5_000 });

    // Disable split
    await splitToggle.click();

    // Split view should be gone, normal code viewer should be back
    await expect(page.getByTestId("inspector-split-view")).not.toBeVisible();
    await expect(page.getByTestId("code-viewer")).toBeVisible({ timeout: 5_000 });
  });

  test("left pane still shows highlighted code from the primary file", async ({ page }) => {
    // Select a node first to get a file loaded
    const { componentTree } = getInspectorLocators(page);
    const firstNode = componentTree.getByTestId(/^tree-node-/).first();
    await expect(firstNode).toBeVisible();
    await firstNode.click();

    // Enable split
    const splitToggle = page.getByTestId("inspector-split-toggle");
    await splitToggle.click();

    await expect(page.getByTestId("inspector-split-view")).toBeVisible({ timeout: 5_000 });

    // Left pane should contain a code-viewer
    const leftPane = page.getByTestId("inspector-split-left");
    await expect(leftPane.getByTestId("code-viewer")).toBeVisible();
  });

  test("split toggle shows Split: On label when active", async ({ page }) => {
    const splitToggle = page.getByTestId("inspector-split-toggle");
    await expect(splitToggle).toBeVisible({ timeout: 10_000 });

    await expect(splitToggle).toHaveText("Split");
    await splitToggle.click();

    await expect(splitToggle).toHaveText("Split: On");
  });
});
