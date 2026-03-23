/**
 * E2E tests for Inspector local sync controls.
 *
 * Verifies preview/apply control flow, per-file decisions, explicit overwrite
 * confirmation gating, and success rendering for the local sync panel.
 *
 * @see https://github.com/oscharko-dev/workspace-dev/issues/456
 */
import { expect, test, type Page } from "@playwright/test";
import {
  cleanupDeterministicSubmitRoute,
  openWorkspaceUi,
  resetBrowserStorage,
  setupDeterministicSubmitRoute,
  triggerDeterministicGeneration,
  waitForCompletedSubmitStatus
} from "./helpers";

const syncViewport = { width: 1920, height: 1080 } as const;

async function setupRegenerationLineageRoute(page: Page): Promise<void> {
  await page.route("**/workspace/jobs/*", async (route) => {
    const request = route.request();
    if (request.method() !== "GET") {
      await route.continue();
      return;
    }

    const response = await route.fetch();
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      await route.fulfill({ response });
      return;
    }

    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      await route.fulfill({ response });
      return;
    }

    const record = payload as Record<string, unknown>;
    if (typeof record.jobId !== "string") {
      await route.fulfill({ response });
      return;
    }

    await route.fulfill({
      response,
      json: {
        ...record,
        lineage: {
          sourceJobId: "job-source-1"
        }
      }
    });
  });
}

test.describe("inspector local sync controls", () => {
  test.beforeEach(async ({ page }) => {
    await setupDeterministicSubmitRoute(page);
    await setupRegenerationLineageRoute(page);
  });

  test.afterEach(async ({ page }) => {
    await cleanupDeterministicSubmitRoute(page);
    await page.unroute("**/workspace/jobs/*/sync");
    await page.unroute("**/workspace/jobs/*");
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
              {
                path: "src/screens/Home.tsx",
                action: "overwrite",
                status: "overwrite",
                reason: "managed_destination_unchanged",
                decision: "write",
                selectedByDefault: true,
                sizeBytes: 120,
                message: "Destination matches the last synced baseline and can be overwritten safely."
              },
              {
                path: "package.json",
                action: "create",
                status: "create",
                reason: "new_file",
                decision: "write",
                selectedByDefault: true,
                sizeBytes: 44,
                message: "File will be created in the destination tree."
              },
              {
                path: "src/legacy.tsx",
                action: "overwrite",
                status: "conflict",
                reason: "destination_modified_since_sync",
                decision: "skip",
                selectedByDefault: false,
                sizeBytes: 19,
                message: "Destination was modified after the last sync. Review before overwriting it."
              }
            ],
            summary: {
              totalFiles: 3,
              selectedFiles: 2,
              createCount: 1,
              overwriteCount: 1,
              conflictCount: 1,
              untrackedCount: 0,
              unchangedCount: 0,
              totalBytes: 183,
              selectedBytes: 164
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
        expect(body.fileDecisions).toEqual([
          { path: "src/screens/Home.tsx", decision: "write" },
          { path: "package.json", decision: "write" },
          { path: "src/legacy.tsx", decision: "write" }
        ]);
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
              {
                path: "src/screens/Home.tsx",
                action: "overwrite",
                status: "overwrite",
                reason: "managed_destination_unchanged",
                decision: "write",
                selectedByDefault: true,
                sizeBytes: 120,
                message: "Destination matches the last synced baseline and can be overwritten safely."
              },
              {
                path: "package.json",
                action: "create",
                status: "create",
                reason: "new_file",
                decision: "write",
                selectedByDefault: true,
                sizeBytes: 44,
                message: "File will be created in the destination tree."
              },
              {
                path: "src/legacy.tsx",
                action: "overwrite",
                status: "conflict",
                reason: "destination_modified_since_sync",
                decision: "write",
                selectedByDefault: false,
                sizeBytes: 19,
                message: "Destination was modified after the last sync. Review before overwriting it."
              }
            ],
            summary: {
              totalFiles: 3,
              selectedFiles: 3,
              createCount: 1,
              overwriteCount: 1,
              conflictCount: 1,
              untrackedCount: 0,
              unchangedCount: 0,
              totalBytes: 183,
              selectedBytes: 183
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
    await expect(page.getByTestId("inspector-sync-preview-summary")).toContainText(
      "Files: 3 total, 1 create, 1 managed overwrite, 1 conflict"
    );
    await expect(page.getByTestId("inspector-sync-attention-banner")).toBeVisible();
    await expect(page.getByTestId("inspector-sync-selected-summary")).toContainText("Selected: 2 files");
    await expect(applyButton).toBeDisabled();

    await page.getByTestId("inspector-sync-file-toggle-2").click();
    await expect(page.getByTestId("inspector-sync-selected-summary")).toContainText("Selected: 3 files");
    await confirmCheckbox.click();
    await expect(applyButton).toBeEnabled();

    await applyButton.click();
    await expect(page.getByTestId("inspector-sync-success")).toBeVisible();
    await expect(page.getByTestId("inspector-sync-success")).toContainText("Wrote 3 files");
  });
});
