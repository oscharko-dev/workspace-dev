/**
 * E2E tests for the Inspector code diff viewer.
 *
 * Verifies the diff toggle button, diff view rendering, and interaction
 * when comparing code between two generation runs.
 *
 * @see https://github.com/oscharko-dev/workspace-dev/issues/434
 */
import { expect, test } from "@playwright/test";
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

const diffTestViewport = { width: 1920, height: 1080 } as const;

test.describe("inspector diff viewer", () => {
  test.describe.configure({ mode: "serial", timeout: 240_000 });

  test.beforeEach(async ({ page }) => {
    await setupDeterministicSubmitRoute(page);
    await openWorkspaceUi(page, diffTestViewport);
  });

  test.afterEach(async ({ page }) => {
    await cleanupDeterministicSubmitRoute(page);
    await resetBrowserStorage(page);
  });

  test("diff toggle button is visible after first completed job", async ({ page }) => {
    await triggerDeterministicGeneration(page);
    await waitForCompletedSubmitStatus(page);
    await openInspector(page);

    const { inspectorPanel } = getInspectorLocators(page);
    await expect(inspectorPanel).toBeVisible();

    const diffToggle = page.getByTestId("inspector-diff-toggle");
    await expect(diffToggle).toBeVisible({ timeout: 10_000 });
    // The toggle is present — its enabled/disabled state depends on whether a
    // previous generation snapshot already exists on disk from earlier runs.
  });

  test("diff toggle activates after second generation with previous job", async ({ page }) => {
    // First generation
    await triggerDeterministicGeneration(page);
    await waitForCompletedSubmitStatus(page);

    // Second generation — this creates a previousJobId in generationDiff
    await triggerDeterministicGeneration(page);
    await waitForCompletedSubmitStatus(page);
    await openInspector(page);

    const { inspectorPanel } = getInspectorLocators(page);
    // Wait for inspector to re-render with new job data
    await expect(inspectorPanel).toBeVisible();

    const diffToggle = page.getByTestId("inspector-diff-toggle");
    await expect(diffToggle).toBeVisible({ timeout: 10_000 });

    // The diff toggle should now be enabled because a previous job exists
    await expect(diffToggle).toBeEnabled({ timeout: 15_000 });
  });

  test("activating diff mode shows the diff viewer with colored lines", async ({ page }) => {
    // First generation
    await triggerDeterministicGeneration(page);
    await waitForCompletedSubmitStatus(page);

    // Second generation
    await triggerDeterministicGeneration(page);
    await waitForCompletedSubmitStatus(page);
    await openInspector(page);

    const { inspectorPanel } = getInspectorLocators(page);
    await expect(inspectorPanel).toBeVisible();

    const diffToggle = page.getByTestId("inspector-diff-toggle");
    await expect(diffToggle).toBeEnabled({ timeout: 15_000 });
    await diffToggle.click();

    // Diff viewer should appear
    const diffViewer = page.getByTestId("diff-viewer");
    await expect(diffViewer).toBeVisible({ timeout: 10_000 });

    // Summary bar should be visible
    const summary = page.getByTestId("diff-viewer-summary");
    await expect(summary).toBeVisible();

    // Should show either "identical" or diff stats — deterministic re-runs produce identical output
    const summaryText = await summary.textContent();
    expect(
      summaryText?.includes("identical") || summaryText?.includes("added") || summaryText?.includes("removed"),
      `Expected diff summary to contain status, got: ${summaryText}`
    ).toBeTruthy();
  });

  test("toggling diff off returns to normal code viewer", async ({ page }) => {
    // Two generations
    await triggerDeterministicGeneration(page);
    await waitForCompletedSubmitStatus(page);
    await triggerDeterministicGeneration(page);
    await waitForCompletedSubmitStatus(page);
    await openInspector(page);

    const diffToggle = page.getByTestId("inspector-diff-toggle");
    await expect(diffToggle).toBeEnabled({ timeout: 15_000 });

    // Enable diff
    await diffToggle.click();
    await expect(page.getByTestId("diff-viewer")).toBeVisible({ timeout: 10_000 });

    // Disable diff
    await diffToggle.click();

    // Normal code viewer should be back
    await expect(page.getByTestId("code-viewer")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId("diff-viewer")).not.toBeVisible();
  });

  test("diff viewer has find-in-diff functionality", async ({ page }) => {
    // Two generations
    await triggerDeterministicGeneration(page);
    await waitForCompletedSubmitStatus(page);
    await triggerDeterministicGeneration(page);
    await waitForCompletedSubmitStatus(page);
    await openInspector(page);

    const diffToggle = page.getByTestId("inspector-diff-toggle");
    await expect(diffToggle).toBeEnabled({ timeout: 15_000 });
    await diffToggle.click();

    await expect(page.getByTestId("diff-viewer")).toBeVisible({ timeout: 10_000 });

    // Find input should be present
    const findInput = page.getByTestId("diff-viewer-find-input");
    await expect(findInput).toBeVisible();

    // Prev/Next buttons should be present
    await expect(page.getByTestId("diff-viewer-find-prev")).toBeVisible();
    await expect(page.getByTestId("diff-viewer-find-next")).toBeVisible();

    // Match count should be visible
    await expect(page.getByTestId("diff-viewer-find-count")).toBeVisible();
  });
});
