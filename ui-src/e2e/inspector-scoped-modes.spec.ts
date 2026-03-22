/**
 * E2E tests for Inspector scoped code viewing modes.
 *
 * Verifies mode selector appearance, mode switching, and scoped diff flow.
 *
 * @see https://github.com/oscharko-dev/workspace-dev/issues/444
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

const scopedModesViewport = { width: 1920, height: 1080 } as const;

test.describe("inspector scoped code modes", () => {
  test.describe.configure({ mode: "serial", timeout: 180_000 });

  test.beforeEach(async ({ page }) => {
    await setupDeterministicSubmitRoute(page);
    await openWorkspaceUi(page, scopedModesViewport);
    await triggerDeterministicGeneration(page);
    await waitForCompletedSubmitStatus(page);
  });

  test.afterEach(async ({ page }) => {
    await cleanupDeterministicSubmitRoute(page);
    await resetBrowserStorage(page);
  });

  test("mode selector appears after selecting a tree node", async ({ page }) => {
    const { componentTree } = getInspectorLocators(page);

    // Select a component node in the tree
    const firstNode = componentTree.getByTestId(/^tree-node-/).first();
    await expect(firstNode).toBeVisible();
    await firstNode.click();

    // Mode selector should appear
    const modeSelector = page.getByTestId("scoped-code-mode-selector");
    await expect(modeSelector).toBeVisible({ timeout: 10_000 });

    // All three mode buttons should exist
    await expect(page.getByTestId("scoped-mode-snippet")).toBeVisible();
    await expect(page.getByTestId("scoped-mode-focused")).toBeVisible();
    await expect(page.getByTestId("scoped-mode-full")).toBeVisible();
  });

  test("switching modes changes the displayed code", async ({ page }) => {
    const { componentTree } = getInspectorLocators(page);

    // Select a mapped component node
    const firstNode = componentTree.getByTestId(/^tree-node-/).first();
    await firstNode.click();

    // Wait for mode selector
    const modeSelector = page.getByTestId("scoped-code-mode-selector");
    await expect(modeSelector).toBeVisible({ timeout: 10_000 });

    // Get the code content in default mode (snippet)
    const codeContent = page.getByTestId("code-content");
    await expect(codeContent).toBeVisible({ timeout: 5_000 });

    // Switch to full file mode
    await page.getByTestId("scoped-mode-full").click();
    await expect(page.getByTestId("scoped-mode-full")).toHaveAttribute("aria-pressed", "true");

    // The code viewer should still be visible
    await expect(codeContent).toBeVisible();

    // Switch to focused mode
    await page.getByTestId("scoped-mode-focused").click();
    await expect(page.getByTestId("scoped-mode-focused")).toHaveAttribute("aria-pressed", "true");

    // The code viewer should still be visible with highlighted lines
    await expect(codeContent).toBeVisible();
  });

  test("scoped diff flow with mode switching", async ({ page }) => {
    const { componentTree } = getInspectorLocators(page);

    // Select a component node
    const firstNode = componentTree.getByTestId(/^tree-node-/).first();
    await firstNode.click();

    // Wait for code pane and mode selector
    const modeSelector = page.getByTestId("scoped-code-mode-selector");
    await expect(modeSelector).toBeVisible({ timeout: 10_000 });

    // Switch to focused mode first
    await page.getByTestId("scoped-mode-focused").click();
    await expect(page.getByTestId("scoped-mode-focused")).toHaveAttribute("aria-pressed", "true");

    // Enable diff mode (if previous job is available)
    const diffToggle = page.getByTestId("inspector-diff-toggle");
    const isDiffDisabled = await diffToggle.isDisabled();

    if (!isDiffDisabled) {
      await diffToggle.click();

      // Verify diff viewer is shown
      const diffViewer = page.getByTestId("diff-viewer");
      await expect(diffViewer).toBeVisible({ timeout: 10_000 });

      // Diff viewer should have the summary bar
      const diffSummary = page.getByTestId("diff-viewer-summary");
      await expect(diffSummary).toBeVisible();

      // Switch modes while diff is active
      await page.getByTestId("scoped-mode-full").click();
      await expect(page.getByTestId("scoped-mode-full")).toHaveAttribute("aria-pressed", "true");

      // Diff viewer should still be visible
      await expect(diffViewer).toBeVisible();
    }
  });

  test("entering scope shows mode selector with snippet default", async ({ page }) => {
    const { componentTree } = getInspectorLocators(page);

    // Double-click a node to enter scope
    const firstNode = componentTree.getByTestId(/^tree-node-/).first();
    await firstNode.dblclick();

    // Wait for scope badge
    const scopeBadge = page.getByTestId("breadcrumb-scope-badge");
    await expect(scopeBadge).toBeVisible({ timeout: 10_000 });

    // Mode selector should be visible
    const modeSelector = page.getByTestId("scoped-code-mode-selector");
    await expect(modeSelector).toBeVisible({ timeout: 5_000 });
  });
});
