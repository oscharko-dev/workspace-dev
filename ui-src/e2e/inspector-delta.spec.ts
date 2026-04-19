/**
 * E2E tests for the delta-import badge and ReImportPromptBanner (Issue #992).
 *
 * Architecture notes (from reading PipelineStatusBar.tsx, ReImportPromptBanner.tsx,
 * InspectorPanel.tsx, paste-pipeline.ts, useImportHistory.ts):
 *
 * - `PipelineStatusBar` is only rendered when `activePipeline.stage === "partial"`
 *   OR `activePipeline.errors.length > 0`. The delta badge therefore requires a
 *   partial or failed job outcome — a fully-completed job without errors does NOT
 *   show the status bar at all.
 *
 * - The delta badge (`pipeline-status-bar-paste-delta`) label is driven by the
 *   `mode` field of `pasteDeltaSummary`:
 *     · `"delta"` or `"auto_resolved_to_delta"` → "Delta Update" (emerald)
 *     · anything else (`"full"`, `"auto_resolved_to_full"`) → "Full Build" (slate)
 *   The `strategy` field does NOT affect the badge label.
 *
 * - The detail span (`pipeline-status-bar-paste-delta-detail`, "{N}/{M} reused")
 *   is only rendered when `pasteDeltaSummary.totalNodes > 0`.
 *
 * - `ReImportPromptBanner` (`reimport-banner`) appears when `previousImportSession`
 *   is non-null. That value comes from `useImportHistory.findPrevious()`, which
 *   fetches from `/workspace/import-sessions`. Matching is done by `pasteIdentityKey`.
 *   The submit response must carry a `pasteDeltaSummary` with the same
 *   `pasteIdentityKey` for the pipeline to store it on state, which then feeds
 *   `findPrevious`.
 *
 * - Clicking `reimport-regenerate-changed` calls `onGenerateSelected` →
 *   `bootstrap.regenerateScoped` → another POST to `/workspace/submit`.
 *
 * Strategy: intercept /workspace/submit → 202 with a `pasteDeltaSummary` payload.
 * Mock job poll to return `partial` (status bar is visible). Mock
 * `/workspace/import-sessions` for tests that need the reimport banner.
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

const JOB_ID = "delta-mock-job";

// Stable pasteIdentityKey used for matching across submit response and
// import-sessions mock.
const PASTE_IDENTITY_KEY = "delta-test-identity-key-k1";

// A prior session ID that differs from the active job so findPrevious returns it.
const PRIOR_SESSION_ID = "paste-import-1700000000000";
const PRIOR_SESSION_JOB_ID = "prior-mock-job-id";

// ---------------------------------------------------------------------------
// Route helpers
// ---------------------------------------------------------------------------

/**
 * Installs a submit mock that returns a pasteDeltaSummary shaped for
 * "auto_resolved_to_delta" (happy-path delta import).
 */
async function installDeltaSubmitRoute(page: Page): Promise<void> {
  await page.route("**/workspace/submit", async (route) => {
    if (route.request().method() !== "POST") {
      await route.continue();
      return;
    }
    await route.fulfill({
      status: 202,
      contentType: "application/json",
      body: JSON.stringify({
        jobId: JOB_ID,
        pasteDeltaSummary: {
          mode: "auto_resolved_to_delta",
          strategy: "delta",
          totalNodes: 10,
          nodesReused: 8,
          nodesReprocessed: 2,
          structuralChangeRatio: 0.2,
          pasteIdentityKey: PASTE_IDENTITY_KEY,
          priorManifestMissing: false,
        },
      }),
    });
  });
}

/**
 * Installs a submit mock that returns a pasteDeltaSummary shaped for a
 * structural-break ("full" mode, "structural_break" strategy). The badge
 * label becomes "Full Build".
 */
async function installStructuralBreakSubmitRoute(page: Page): Promise<void> {
  await page.route("**/workspace/submit", async (route) => {
    if (route.request().method() !== "POST") {
      await route.continue();
      return;
    }
    await route.fulfill({
      status: 202,
      contentType: "application/json",
      body: JSON.stringify({
        jobId: JOB_ID,
        pasteDeltaSummary: {
          mode: "full",
          strategy: "structural_break",
          totalNodes: 12,
          nodesReused: 0,
          nodesReprocessed: 12,
          structuralChangeRatio: 1.0,
          pasteIdentityKey: PASTE_IDENTITY_KEY,
          priorManifestMissing: false,
        },
      }),
    });
  });
}

/**
 * Installs a submit mock that omits pasteDeltaSummary entirely (no delta info).
 */
async function installPlainSubmitRoute(page: Page): Promise<void> {
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
 * Installs a submit mock where totalNodes is 0 so the detail span is suppressed.
 */
async function installZeroNodesSubmitRoute(page: Page): Promise<void> {
  await page.route("**/workspace/submit", async (route) => {
    if (route.request().method() !== "POST") {
      await route.continue();
      return;
    }
    await route.fulfill({
      status: 202,
      contentType: "application/json",
      body: JSON.stringify({
        jobId: JOB_ID,
        pasteDeltaSummary: {
          mode: "auto_resolved_to_delta",
          strategy: "no_changes",
          totalNodes: 0,
          nodesReused: 0,
          nodesReprocessed: 0,
          structuralChangeRatio: 0,
          pasteIdentityKey: PASTE_IDENTITY_KEY,
          priorManifestMissing: false,
        },
      }),
    });
  });
}

/**
 * Job poll returns running for the first two calls, then partial.
 * "partial" keeps the inspector panel visible and shows the PipelineStatusBar,
 * which is the only place the delta badge is rendered.
 */
async function installPartialJobRoute(page: Page): Promise<void> {
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
 * Mocks /workspace/import-sessions to return a single prior session that
 * matches by pasteIdentityKey. The session's jobId is intentionally different
 * from JOB_ID so `previousImportSession` is non-null.
 */
async function installImportSessionsRoute(page: Page): Promise<void> {
  await page.route("**/workspace/import-sessions", async (route) => {
    if (route.request().method() !== "GET") {
      await route.continue();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        sessions: [
          {
            id: PRIOR_SESSION_ID,
            fileKey: "figma-file-key-abc",
            nodeId: "1:2",
            nodeName: "HomePage",
            importedAt: new Date(Date.now() - 86_400_000).toISOString(), // 1 day ago
            nodeCount: 10,
            fileCount: 3,
            selectedNodes: [],
            scope: "all",
            componentMappings: 5,
            pasteIdentityKey: PASTE_IDENTITY_KEY,
            jobId: PRIOR_SESSION_JOB_ID,
            replayable: false,
          },
        ],
      }),
    });
  });
}

/**
 * Navigates to the inspector, resets storage, pastes, confirms the SmartBanner,
 * and waits for the inspector panel to mount. Resolves once the submit 202
 * is received.
 */
async function triggerPasteAndConfirm(page: Page): Promise<void> {
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

  await submitResponsePromise;

  await expect(page.getByTestId("inspector-panel")).toBeVisible({
    timeout: 15_000,
  });
}

// ---------------------------------------------------------------------------
// Route teardown helper
// ---------------------------------------------------------------------------

async function uninstallAllRoutes(page: Page): Promise<void> {
  await page.unroute("**/workspace/submit");
  await page.unroute(`**/workspace/jobs/${JOB_ID}`);
  await page.unroute("**/workspace/import-sessions");
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe("inspector delta import badge and reimport banner (issue #992)", () => {
  test.describe.configure({ mode: "serial", timeout: 90_000 });

  test.afterEach(async ({ page }) => {
    await uninstallAllRoutes(page);
    // Guard: resetBrowserStorage accesses localStorage which is unavailable on
    // blank pages (e.g. after a test.skip(true) that never navigated anywhere).
    const url = page.url();
    if (url && url !== "about:blank") {
      await resetBrowserStorage(page).catch(() => {
        // Silently ignore — storage inaccessible on non-inspector origins.
      });
    }
  });

  // -------------------------------------------------------------------------
  // TC-1: Delta badge renders with "Delta Update" label after auto_resolved_to_delta
  // -------------------------------------------------------------------------
  test("pipeline-status-bar-paste-delta shows 'Delta Update' when mode is auto_resolved_to_delta", async ({
    page,
  }) => {
    // Arrange
    await installDeltaSubmitRoute(page);
    await installPartialJobRoute(page);

    // Act
    await triggerPasteAndConfirm(page);

    // Assert — pipeline status bar appears (partial stage triggers it)
    const statusBar = page.getByTestId("pipeline-status-bar");
    await expect(statusBar).toBeVisible({ timeout: 30_000 });

    // Assert — delta badge is rendered with "Delta Update" label
    const deltaBadge = page.getByTestId("pipeline-status-bar-paste-delta");
    await expect(deltaBadge).toBeVisible({ timeout: 5_000 });
    await expect(deltaBadge).toContainText("Delta Update");
  });

  // -------------------------------------------------------------------------
  // TC-2: Delta detail span shows "{N}/{M} reused" when totalNodes > 0
  // -------------------------------------------------------------------------
  test("pipeline-status-bar-paste-delta-detail shows node-reuse counts when totalNodes is positive", async ({
    page,
  }) => {
    // Arrange
    await installDeltaSubmitRoute(page);
    await installPartialJobRoute(page);

    // Act
    await triggerPasteAndConfirm(page);

    // Assert — pipeline status bar appears
    await expect(page.getByTestId("pipeline-status-bar")).toBeVisible({
      timeout: 30_000,
    });

    // Assert — detail span shows "8/10 reused" (from mock: nodesReused=8, totalNodes=10)
    const detailSpan = page.getByTestId(
      "pipeline-status-bar-paste-delta-detail",
    );
    await expect(detailSpan).toBeVisible({ timeout: 5_000 });
    await expect(detailSpan).toContainText("8/10 reused");

    // Assert — the badge title tooltip also contains the verbose form
    const deltaBadge = page.getByTestId("pipeline-status-bar-paste-delta");
    const titleAttr = await deltaBadge.getAttribute("title");
    expect(titleAttr).toContain("8 of 10 nodes reused");
  });

  // -------------------------------------------------------------------------
  // TC-3: Structural-break fallback shows "Full Build" badge, not "Delta Update"
  // -------------------------------------------------------------------------
  test("pipeline-status-bar-paste-delta shows 'Full Build' when mode is 'full' (structural_break strategy)", async ({
    page,
  }) => {
    // Arrange: mode:"full" + strategy:"structural_break" → "Full Build" label
    await installStructuralBreakSubmitRoute(page);
    await installPartialJobRoute(page);

    // Act
    await triggerPasteAndConfirm(page);

    // Assert — pipeline status bar appears
    await expect(page.getByTestId("pipeline-status-bar")).toBeVisible({
      timeout: 30_000,
    });

    // Assert — badge shows "Full Build", not "Delta Update"
    const deltaBadge = page.getByTestId("pipeline-status-bar-paste-delta");
    await expect(deltaBadge).toBeVisible({ timeout: 5_000 });
    await expect(deltaBadge).toContainText("Full Build");
    await expect(deltaBadge).not.toContainText("Delta Update");
  });

  // -------------------------------------------------------------------------
  // TC-4: No delta badge when submit response omits pasteDeltaSummary
  // -------------------------------------------------------------------------
  test("pipeline-status-bar-paste-delta is absent when submit response has no pasteDeltaSummary", async ({
    page,
  }) => {
    // Arrange: plain submit with no pasteDeltaSummary
    await installPlainSubmitRoute(page);
    await installPartialJobRoute(page);

    // Act
    await triggerPasteAndConfirm(page);

    // Assert — pipeline status bar appears (partial outcome)
    await expect(page.getByTestId("pipeline-status-bar")).toBeVisible({
      timeout: 30_000,
    });

    // Assert — delta badge is NOT rendered (pasteDeltaSummary is undefined)
    await expect(
      page.getByTestId("pipeline-status-bar-paste-delta"),
    ).toHaveCount(0);
  });

  // -------------------------------------------------------------------------
  // TC-5: Detail span absent when totalNodes is 0
  // -------------------------------------------------------------------------
  test("pipeline-status-bar-paste-delta-detail is absent when totalNodes is 0", async ({
    page,
  }) => {
    // Arrange: delta summary with totalNodes=0 (no-changes run)
    await installZeroNodesSubmitRoute(page);
    await installPartialJobRoute(page);

    // Act
    await triggerPasteAndConfirm(page);

    // Assert — pipeline status bar and badge present
    await expect(page.getByTestId("pipeline-status-bar")).toBeVisible({
      timeout: 30_000,
    });
    await expect(
      page.getByTestId("pipeline-status-bar-paste-delta"),
    ).toBeVisible({ timeout: 5_000 });

    // Assert — detail span is NOT rendered (totalNodes === 0 suppresses it)
    await expect(
      page.getByTestId("pipeline-status-bar-paste-delta-detail"),
    ).toHaveCount(0);
  });

  // -------------------------------------------------------------------------
  // TC-6: ReImport banner visible when import history has a matching prior session
  //
  // `previousImportSession` is non-null when:
  //   · /workspace/import-sessions returns a session with `pasteIdentityKey: "k1"`
  //   · the submit response's pasteDeltaSummary also carries `pasteIdentityKey: "k1"`
  //     so bootstrap.pipelineState.pasteIdentityKey becomes "k1"
  //   · the matched session's jobId differs from the active jobId (otherwise skipped)
  // -------------------------------------------------------------------------
  test("reimport-banner is visible when import history has a prior session matching by pasteIdentityKey", async ({
    page,
  }) => {
    // Arrange
    await installImportSessionsRoute(page);
    await installDeltaSubmitRoute(page);
    await installPartialJobRoute(page);

    // Act
    await triggerPasteAndConfirm(page);

    // Assert — the reimport banner renders (previousImportSession matched)
    await expect(page.getByTestId("reimport-banner")).toBeVisible({
      timeout: 30_000,
    });
  });

  // -------------------------------------------------------------------------
  // TC-7: Clicking reimport-regenerate-changed dispatches another submit POST
  //
  // handleReimportRegenerateChanged calls onGenerateSelected → bootstrap.regenerateScoped
  // → POST /workspace/submit. Because the mock job route for the delta-mock-job
  // already settled, a second submit POST is the evidence that the button wired up.
  // -------------------------------------------------------------------------
  test("clicking reimport-regenerate-changed triggers a second /workspace/submit POST", async ({
    page,
  }) => {
    // Arrange
    await installImportSessionsRoute(page);

    let submitCallCount = 0;
    await page.route("**/workspace/submit", async (route) => {
      if (route.request().method() !== "POST") {
        await route.continue();
        return;
      }
      submitCallCount += 1;
      await route.fulfill({
        status: 202,
        contentType: "application/json",
        body: JSON.stringify({
          jobId: submitCallCount === 1 ? JOB_ID : `${JOB_ID}-retry`,
          pasteDeltaSummary: {
            mode: "auto_resolved_to_delta",
            strategy: "delta",
            totalNodes: 10,
            nodesReused: 8,
            nodesReprocessed: 2,
            structuralChangeRatio: 0.2,
            pasteIdentityKey: PASTE_IDENTITY_KEY,
            priorManifestMissing: false,
          },
        }),
      });
    });

    // Job poll for the first job — settles to partial to keep the inspector visible
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

    // Act — first paste → inspector panel + reimport banner
    await triggerPasteAndConfirm(page);
    await expect(page.getByTestId("reimport-banner")).toBeVisible({
      timeout: 30_000,
    });

    const submitCountBeforeClick = submitCallCount;

    // Click "Regenerate changed" — triggers a second submit
    await page.getByTestId("reimport-regenerate-changed").click();

    // Assert — a new POST to /workspace/submit was dispatched
    await expect
      .poll(() => submitCallCount, { timeout: 10_000, intervals: [200] })
      .toBeGreaterThan(submitCountBeforeClick);
  });
});
