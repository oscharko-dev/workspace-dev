/**
 * E2E tests for Inspector local sync controls.
 *
 * Verifies preview/apply control flow, explicit overwrite confirmation gating,
 * and success rendering for the local sync panel.
 *
 * @see https://github.com/oscharko-dev/workspace-dev/issues/456
 */
import { expect, test } from "@playwright/test";
import {
  cleanupDeterministicSubmitRoute,
  openWorkspaceUi,
  resetBrowserStorage,
  setupDeterministicSubmitRoute,
  triggerDeterministicGeneration,
  waitForCompletedSubmitStatus
} from "./helpers";

const syncViewport = { width: 1920, height: 1080 } as const;

test.describe("inspector local sync controls", () => {
  test.beforeEach(async ({ page }) => {
    await setupDeterministicSubmitRoute(page);
  });

  test.afterEach(async ({ page }) => {
    await cleanupDeterministicSubmitRoute(page);
    await page.unroute("**/workspace/jobs/*/sync");
    await resetBrowserStorage(page);
  });

  test("requires preview + explicit confirmation before apply", async ({ page }) => {
    await page.route("**/workspace/jobs/*/sync", async (route) => {
      const body = route.request().postDataJSON() as Record<string, unknown>;
      if (body.mode === "dry_run") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            jobId: "job-1",
            sourceJobId: "job-source-1",
            boardKey: "board-key-1",
            targetPath: "sync-target",
            scopePath: "sync-target/board-key-1",
            destinationRoot: "/tmp/workspace/sync-target/board-key-1",
            files: [
              { path: "src/screens/Home.tsx", action: "overwrite", sizeBytes: 120 },
              { path: "package.json", action: "create", sizeBytes: 44 }
            ],
            summary: {
              totalFiles: 2,
              createCount: 1,
              overwriteCount: 1,
              totalBytes: 164
            },
            confirmationToken: "sync-token-123",
            confirmationExpiresAt: "2026-03-22T12:00:00.000Z"
          })
        });
        return;
      }

      if (body.mode === "apply") {
        expect(body.confirmationToken).toBe("sync-token-123");
        expect(body.confirmOverwrite).toBe(true);
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            jobId: "job-1",
            sourceJobId: "job-source-1",
            boardKey: "board-key-1",
            targetPath: "sync-target",
            scopePath: "sync-target/board-key-1",
            destinationRoot: "/tmp/workspace/sync-target/board-key-1",
            files: [
              { path: "src/screens/Home.tsx", action: "overwrite", sizeBytes: 120 },
              { path: "package.json", action: "create", sizeBytes: 44 }
            ],
            summary: {
              totalFiles: 2,
              createCount: 1,
              overwriteCount: 1,
              totalBytes: 164
            },
            appliedAt: "2026-03-22T12:02:00.000Z"
          })
        });
        return;
      }

      await route.fulfill({
        status: 400,
        contentType: "application/json",
        body: JSON.stringify({
          error: "VALIDATION_ERROR",
          message: "Unsupported mode"
        })
      });
    });

    await openWorkspaceUi(page, syncViewport);
    await triggerDeterministicGeneration(page);
    await waitForCompletedSubmitStatus(page);

    const syncPanel = page.getByTestId("inspector-sync-panel");
    const previewButton = page.getByTestId("inspector-sync-preview-button");
    const applyButton = page.getByTestId("inspector-sync-apply-button");
    const confirmCheckbox = page.getByTestId("inspector-sync-confirm-overwrite");

    await expect(syncPanel).toBeVisible();
    await expect(applyButton).toBeDisabled();

    await previewButton.click();
    await expect(page.getByTestId("inspector-sync-preview-summary")).toBeVisible();
    await expect(page.getByTestId("inspector-sync-preview-summary")).toContainText("Files: 2 total, 1 create, 1 overwrite");
    await expect(applyButton).toBeDisabled();

    await confirmCheckbox.click();
    await expect(applyButton).toBeEnabled();

    await applyButton.click();
    await expect(page.getByTestId("inspector-sync-success")).toBeVisible();
    await expect(page.getByTestId("inspector-sync-success")).toContainText("Wrote 2 files");
  });
});
