import { expect, test } from "@playwright/test";
import {
  cleanupDeterministicSubmitRoute,
  openWorkspaceUi,
  resetBrowserStorage,
  setupDeterministicSubmitRoute,
  triggerDeterministicGeneration,
  waitForCompletedSubmitStatus
} from "./helpers";

const diffTestViewport = { width: 1920, height: 1080 } as const;

test.describe("generation diff report", () => {
  test.describe.configure({ mode: "serial", timeout: 180_000 });

  test.beforeEach(async ({ page }) => {
    await setupDeterministicSubmitRoute(page);
    await openWorkspaceUi(page, diffTestViewport);
  });

  test.afterEach(async ({ page }) => {
    await cleanupDeterministicSubmitRoute(page);
    await resetBrowserStorage(page);
  });

  test("displays generation diff summary after first completed job", async ({ page }) => {
    await triggerDeterministicGeneration(page);
    await waitForCompletedSubmitStatus(page);

    const diffSummary = page.getByTestId("generation-diff-summary");
    await expect(diffSummary).toBeVisible({ timeout: 10_000 });
    await expect(diffSummary).toContainText("Generation Diff");

    // First run shows "added", subsequent runs may show "unchanged" if snapshot already exists
    const summaryText = await diffSummary.textContent();
    expect(
      summaryText?.includes("added") || summaryText?.includes("unchanged") || summaryText?.includes("modified"),
      `Expected diff summary to contain file count information, got: ${summaryText}`
    ).toBeTruthy();
  });

  test("includes generationDiff in job status API response", async ({ page }) => {
    await triggerDeterministicGeneration(page);
    await waitForCompletedSubmitStatus(page);

    const jobPayloadPre = page.getByTestId("job-payload");
    await expect(jobPayloadPre).toBeVisible();

    const jobPayloadText = await jobPayloadPre.textContent();
    expect(jobPayloadText).toBeTruthy();

    const parsed = JSON.parse(jobPayloadText!) as Record<string, unknown>;
    expect(parsed).toHaveProperty("generationDiff");

    const diff = parsed.generationDiff as {
      summary: string;
      added: string[];
      unchanged: string[];
      boardKey: string;
    };
    expect(diff.summary).toBeTruthy();
    expect(diff.boardKey).toBeTruthy();
    expect(Array.isArray(diff.added)).toBe(true);
    // First run shows added files, subsequent runs may show all unchanged
    const totalFiles = diff.added.length + (diff.unchanged?.length ?? 0);
    expect(totalFiles).toBeGreaterThan(0);
  });

  test("shows diff badge counts in the UI", async ({ page }) => {
    await triggerDeterministicGeneration(page);
    await waitForCompletedSubmitStatus(page);

    const diffSummary = page.getByTestId("generation-diff-summary");
    await expect(diffSummary).toBeVisible({ timeout: 10_000 });

    // Should show at least one badge with file counts (added, modified, or unchanged)
    const badgeLocator = diffSummary.locator("span");
    const badgeCount = await badgeLocator.count();
    expect(badgeCount, "Expected at least one diff badge").toBeGreaterThan(0);
  });

  test("generation diff report contains board key and file entries", async ({ page }) => {
    await triggerDeterministicGeneration(page);
    await waitForCompletedSubmitStatus(page);

    // Verify the job payload contains full generationDiff structure
    const jobPayloadPre = page.getByTestId("job-payload");
    await expect(jobPayloadPre).toBeVisible();

    const jobText = await jobPayloadPre.textContent();
    expect(jobText).toBeTruthy();

    const parsed = JSON.parse(jobText!) as {
      generationDiff?: {
        boardKey: string;
        currentJobId: string;
        previousJobId: string | null;
        generatedAt: string;
        added: string[];
        modified: { file: string }[];
        removed: string[];
        unchanged: string[];
        summary: string;
      };
    };

    expect(parsed.generationDiff).toBeTruthy();
    const diff = parsed.generationDiff!;
    expect(diff.boardKey).toBeTruthy();
    expect(diff.currentJobId).toBeTruthy();
    expect(diff.generatedAt).toBeTruthy();
    expect(Array.isArray(diff.added)).toBe(true);
    expect(Array.isArray(diff.modified)).toBe(true);
    expect(Array.isArray(diff.removed)).toBe(true);
    expect(Array.isArray(diff.unchanged)).toBe(true);
  });
});
