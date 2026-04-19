/**
 * E2E tests for PipelineErrorBanner + retry UX (Issue #1008).
 *
 * Architecture notes (discovered from reading PipelineStatusBar.tsx):
 *
 * - When `activePipeline.errors.length > 0 || activePipeline.stage === "partial"`,
 *   the InspectorPanel renders a <PipelineStatusBar>.
 * - PipelineStatusBar shows a summary strip (data-testid="pipeline-status-bar").
 * - A top-level retry button is rendered at data-testid="pipeline-status-bar-retry"
 *   when `canRetry && onRetry` are truthy.
 * - The per-error PipelineErrorBanner (data-testid="pipeline-error-banner") is
 *   rendered only after the user clicks "Details"
 *   (data-testid="pipeline-status-bar-details-toggle").
 * - A retry countdown is shown at data-testid="pipeline-status-bar-retry-countdown".
 *
 * Strategy: intercept /workspace/submit → 202 { jobId }, then mock the job-poll
 * endpoint to return a "partial"/"failed" payload. This exercises the real
 * component tree end-to-end without touching the server.
 */
import { expect, test, type Page } from "@playwright/test";
import {
  getInspectorUiUrl,
  getPrototypeNavigationPastePayload,
  resetBrowserStorage,
  simulateInspectorPaste,
} from "./helpers";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const BOOTSTRAP_VIEWPORT = { width: 1920, height: 1080 } as const;
const INSPECTOR_URL = getInspectorUiUrl();
const PROTO_PASTE = getPrototypeNavigationPastePayload();

// Stable job ID — returned by the submit mock and matched in poll routes.
const JOB_ID = "err-recovery-mock-job";

// ---------------------------------------------------------------------------
// Route helpers
// ---------------------------------------------------------------------------

async function installSubmitRoute(page: Page): Promise<void> {
  await page.route("**/workspace/submit", async (route) => {
    if (route.request().method() !== "POST") {
      await route.continue();
      return;
    }
    await route.fulfill({
      status: 202,
      contentType: "application/json",
      body: JSON.stringify({ jobId: JOB_ID }),
    });
  });
}

/**
 * Retryable partial failure — CODEGEN_PARTIAL, no cooldown.
 */
async function installRetryableJobRoute(page: Page): Promise<void> {
  let pollCount = 0;
  await page.route(`**/workspace/jobs/${JOB_ID}`, async (route) => {
    if (route.request().method() !== "GET") {
      await route.continue();
      return;
    }
    pollCount += 1;
    if (pollCount <= 2) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ jobId: JOB_ID, status: "running" }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        jobId: JOB_ID,
        status: "partial",
        outcome: "partial",
        error: {
          code: "CODEGEN_PARTIAL",
          message: "Code generation failed for one or more files.",
          stage: "generating",
          retryable: true,
        },
      }),
    });
  });
}

/**
 * Retryable partial failure with a 30s cooldown — button starts disabled.
 */
async function installRetryableWithCooldownJobRoute(page: Page): Promise<void> {
  let pollCount = 0;
  await page.route(`**/workspace/jobs/${JOB_ID}`, async (route) => {
    if (route.request().method() !== "GET") {
      await route.continue();
      return;
    }
    pollCount += 1;
    if (pollCount <= 1) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ jobId: JOB_ID, status: "running" }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        jobId: JOB_ID,
        status: "partial",
        outcome: "partial",
        error: {
          code: "MCP_RATE_LIMITED",
          message: "MCP rate limit reached.",
          stage: "resolving",
          retryable: true,
          retryAfterMs: 30_000, // 30s countdown active during test
        },
      }),
    });
  });
}

/**
 * Non-retryable terminal failure.
 */
async function installNonRetryableJobRoute(page: Page): Promise<void> {
  let pollCount = 0;
  await page.route(`**/workspace/jobs/${JOB_ID}`, async (route) => {
    if (route.request().method() !== "GET") {
      await route.continue();
      return;
    }
    pollCount += 1;
    if (pollCount <= 1) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ jobId: JOB_ID, status: "running" }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        jobId: JOB_ID,
        status: "failed",
        error: {
          code: "FILE_NOT_FOUND",
          message: "The Figma file could not be found.",
          stage: "resolving",
          retryable: false,
        },
      }),
    });
  });
}

/**
 * Navigates to the inspector bootstrap, clears storage, pastes, confirms the
 * SmartBanner, and waits for the inspector panel to mount.
 */
async function triggerPasteAndConfirm(page: Page): Promise<void> {
  // Navigate first so localStorage is accessible, then clear storage so no
  // prior import sessions or history items interfere.
  await page.setViewportSize(BOOTSTRAP_VIEWPORT);
  await page.goto(INSPECTOR_URL);
  await resetBrowserStorage(page);
  await page.reload();
  await page.waitForSelector('[data-testid="inspector-bootstrap"]', {
    timeout: 15_000,
  });

  const submitResponsePromise = page.waitForResponse(
    (res) =>
      res.request().method() === "POST" &&
      res.url().includes("/workspace/submit"),
  );

  await simulateInspectorPaste(page, PROTO_PASTE);
  const smartBanner = page.getByTestId("smart-banner");
  await expect(smartBanner).toBeVisible({ timeout: 5_000 });
  await smartBanner.getByRole("button", { name: "Import starten" }).click();

  // Wait for submit ACK before proceeding
  await submitResponsePromise;

  // Wait for the inspector panel to mount (rendered once jobId is known)
  await expect(page.getByTestId("inspector-panel")).toBeVisible({
    timeout: 15_000,
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe("inspector pipeline error recovery (issue #1008)", () => {
  test.describe.configure({ mode: "serial", timeout: 90_000 });

  test.afterEach(async ({ page }) => {
    await page.unroute("**/workspace/submit");
    await page.unroute(`**/workspace/jobs/${JOB_ID}`);
    await resetBrowserStorage(page);
  });

  // -------------------------------------------------------------------------
  // TC-1: Retryable partial error → status bar visible with summary text
  // -------------------------------------------------------------------------
  test("retryable partial error shows pipeline-status-bar with amber summary", async ({
    page,
  }) => {
    // Arrange
    await installSubmitRoute(page);
    await installRetryableJobRoute(page);

    // Act
    await triggerPasteAndConfirm(page);

    // Assert — pipeline status bar appears (partial/error stage)
    const statusBar = page.getByTestId("pipeline-status-bar");
    await expect(statusBar).toBeVisible({ timeout: 30_000 });

    // Assert — summary text includes "Partially imported"
    await expect(statusBar).toContainText(/Partially imported/i);
  });

  // -------------------------------------------------------------------------
  // TC-2: Details panel shows pipeline-error-banner with role=alert
  // -------------------------------------------------------------------------
  test("expanding error details shows pipeline-error-banner with role=alert", async ({
    page,
  }) => {
    // Arrange
    await installSubmitRoute(page);
    await installRetryableJobRoute(page);

    // Act
    await triggerPasteAndConfirm(page);
    const statusBar = page.getByTestId("pipeline-status-bar");
    await expect(statusBar).toBeVisible({ timeout: 30_000 });

    // Expand details panel
    const detailsToggle = page.getByTestId(
      "pipeline-status-bar-details-toggle",
    );
    await expect(detailsToggle).toBeVisible();
    await detailsToggle.click();

    // Assert — per-error PipelineErrorBanner is now visible
    const errorBanner = page.getByTestId("pipeline-error-banner");
    await expect(errorBanner).toBeVisible({ timeout: 5_000 });

    // Assert — role=alert is on the banner (a11y requirement from issue #1008)
    await expect(errorBanner).toHaveRole("alert");

    // Assert — CODEGEN_PARTIAL error copy is surfaced
    await expect(errorBanner).toContainText(/Code generation|Some files/i);
  });

  // -------------------------------------------------------------------------
  // TC-3: Retryable error → top-level retry button enabled, no cooldown
  // -------------------------------------------------------------------------
  test("retryable pipeline error renders an enabled pipeline-status-bar retry button", async ({
    page,
  }) => {
    // Arrange
    await installSubmitRoute(page);
    await installRetryableJobRoute(page);

    // Act
    await triggerPasteAndConfirm(page);

    // Assert — top-level retry button is rendered and enabled
    const retryButton = page.getByTestId("pipeline-status-bar-retry");
    await expect(retryButton).toBeVisible({ timeout: 30_000 });
    await expect(retryButton).toBeEnabled();
  });

  // -------------------------------------------------------------------------
  // TC-4: Retryable error with cooldown → retry button disabled + countdown
  // -------------------------------------------------------------------------
  test("retry button is disabled and countdown shown while cooldown is active", async ({
    page,
  }) => {
    // Arrange: error has retryAfterMs → button starts disabled
    await installSubmitRoute(page);
    await installRetryableWithCooldownJobRoute(page);

    // Act
    await triggerPasteAndConfirm(page);

    // Assert — retry button is disabled
    const retryButton = page.getByTestId("pipeline-status-bar-retry");
    await expect(retryButton).toBeVisible({ timeout: 30_000 });
    await expect(retryButton).toBeDisabled();

    // Assert — countdown text is rendered in the status bar
    await expect(
      page.getByTestId("pipeline-status-bar-retry-countdown"),
    ).toBeVisible();
    await expect(
      page.getByTestId("pipeline-status-bar-retry-countdown"),
    ).toContainText(/Retry available in \d+s/);
  });

  // -------------------------------------------------------------------------
  // TC-5: Clicking Retry dispatches a new /workspace/submit POST
  // -------------------------------------------------------------------------
  test("clicking the status-bar retry button dispatches a retry-stage request", async ({
    page,
  }) => {
    // Arrange: install submit and job routes, then intercept retry-stage calls.
    // Note: for CODEGEN_PARTIAL the pipeline emits a retryRequest{stage:"generating"},
    // so retry() calls /workspace/jobs/:id/retry-stage (not /workspace/submit).
    await installSubmitRoute(page);
    await installRetryableJobRoute(page);

    let retryStageCallCount = 0;
    await page.route(
      `**/workspace/jobs/${JOB_ID}/retry-stage`,
      async (route) => {
        if (route.request().method() !== "POST") {
          await route.continue();
          return;
        }
        retryStageCallCount += 1;
        // Respond with a new jobId so the retry pipeline can proceed
        await route.fulfill({
          status: 202,
          contentType: "application/json",
          body: JSON.stringify({ jobId: `${JOB_ID}-retry` }),
        });
      },
    );

    // Act
    await triggerPasteAndConfirm(page);

    // Wait for enabled retry button (CODEGEN_PARTIAL has no cooldown)
    const retryButton = page.getByTestId("pipeline-status-bar-retry");
    await expect(retryButton).toBeVisible({ timeout: 30_000 });
    await expect(retryButton).toBeEnabled({ timeout: 5_000 });

    // Click retry
    await retryButton.click();

    // Assert — POST to /workspace/jobs/:id/retry-stage was dispatched
    await expect
      .poll(() => retryStageCallCount, { timeout: 10_000, intervals: [200] })
      .toBeGreaterThan(0);
  });

  // -------------------------------------------------------------------------
  // TC-6: Non-retryable terminal failure → bootstrap reverts to "failed" state
  //
  // When the job returns status:"failed" (non-retryable), bootstrap.state.kind
  // becomes "failed" and activeJobId is set to null, causing inspector-page.tsx
  // to render InspectorBootstrap rather than PanelView. The "Import failed"
  // message appears inside the bootstrap centre pane, not in PipelineStatusBar.
  // -------------------------------------------------------------------------
  test("non-retryable terminal job failure shows bootstrap error state without a status-bar retry button", async ({
    page,
  }) => {
    // Arrange
    await installSubmitRoute(page);
    await installNonRetryableJobRoute(page);

    // Act
    await triggerPasteAndConfirm(page);

    // Assert — bootstrap reverts to error state; role="alert" carries the
    // "Import failed. Please try again." message in the centre pane.
    const errorAlert = page.locator('[role="alert"]').filter({
      hasText: /Import failed/i,
    });
    await expect(errorAlert).toBeVisible({ timeout: 30_000 });

    // Assert — the PipelineStatusBar retry button is NOT rendered
    // (terminal job failure surfaces as bootstrap error, not status bar)
    await expect(page.getByTestId("pipeline-status-bar-retry")).toHaveCount(0);
  });
});
