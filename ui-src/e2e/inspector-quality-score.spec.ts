/**
 * E2E tests for the Quality Score panel (Issue #993).
 *
 * Architecture notes (from reading SuggestionsPanel.tsx, InspectorPanel.tsx,
 * import-quality-score.ts, token-suggestion-model.ts, a11y-nudge.ts):
 *
 * - SuggestionsPanel (data-testid="inspector-suggestions-panel") is rendered
 *   inside an "inspector-suggestions-host" wrapper when EITHER:
 *     · qualityScore.summary.totalNodes > 0
 *     · tokenSuggestionsModel.available === true
 *     · a11yNudgeModel.summary.total > 0
 *
 * - totalNodes > 0 requires a non-empty DesignIR (screens with children)
 *   served from /workspace/jobs/:id/design-ir.
 *
 * - Risk rows (suggestions-risk-{severity}) appear when deriveQualityScore
 *   produces risks — the score must be below thresholds given the IR.
 *
 * - Token section (suggestions-token-section) requires
 *   /workspace/jobs/:id/token-intelligence to return conflicts or unmapped
 *   variables (available=true gate in deriveTokenSuggestionModel).
 *
 * - A11y section (suggestions-a11y-section) is driven by file content fetched
 *   from /workspace/jobs/:id/files/:path. The InspectorPanel does NOT pass
 *   onFocusFile to SuggestionsPanel — so suggestions-a11y-focus-{ruleId}
 *   buttons are never rendered in this integration surface.
 *
 * - The focus button (suggestions-a11y-focus-{ruleId}) is only rendered when
 *   the parent passes onFocusFile. InspectorPanel.tsx (line ~6458) omits it,
 *   so TC-8 (focus button DOM effect) is skipped with an explanation.
 *
 * Strategy: intercept /workspace/submit → 202, mock the job poll to return
 * status:"partial" (avoids previewUrl requirement), then mock the final-
 * artifact endpoints so each section has data to render.
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

const JOB_ID = "quality-score-mock-job";

// A TSX file path that the a11y scanner will pick up (matches /\.(tsx|jsx|html|mdx)$/)
const A11Y_FILE_PATH = "src/screens/HomeScreen.tsx";

// File content with deliberate a11y smells so nudges are produced:
//   · <img> without alt → img-missing-alt (high)
//   · <a> without href → anchor-missing-href (medium)
const A11Y_FILE_CONTENT = `
export function HomeScreen() {
  return (
    <div>
      <img src="/logo.png" />
      <a>Go back</a>
      <h1>Welcome</h1>
    </div>
  );
}
`;

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
 * Job poll returns running for the first two calls, then partial (no preview
 * URL needed). "partial" outcome still triggers fetchFinalArtifacts.
 */
async function installJobPollRoute(page: Page): Promise<void> {
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
        status: "completed",
        outcome: "partial",
      }),
    });
  });
}

/**
 * Returns a DesignIR with one screen containing several children, enough for
 * deriveQualityScore to produce totalNodes > 0 and risk tags (deep/large tree
 * with interactive elements lacking semantics).
 */
async function installDesignIrRoute(page: Page): Promise<void> {
  await page.route(`**/workspace/jobs/${JOB_ID}/design-ir`, async (route) => {
    if (route.request().method() !== "GET") {
      await route.continue();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        jobId: JOB_ID,
        screens: [
          {
            id: "screen-1",
            name: "Home",
            generatedFile: A11Y_FILE_PATH,
            children: [
              {
                id: "node-1",
                name: "Container",
                type: "Frame",
                children: [
                  // Interactive node without semantic — triggers accessibility risk
                  {
                    id: "node-2",
                    name: "ClickableDiv",
                    type: "Button",
                    children: [],
                  },
                  {
                    id: "node-3",
                    name: "Label",
                    type: "Text",
                    children: [],
                  },
                ],
              },
            ],
          },
        ],
      }),
    });
  });
}

/**
 * Returns a figma-analysis payload with one diagnostic so the diagnostics
 * summary is non-zero (the panel shows the count in the quality-summary text).
 */
async function installFigmaAnalysisRoute(page: Page): Promise<void> {
  await page.route(
    `**/workspace/jobs/${JOB_ID}/figma-analysis`,
    async (route) => {
      if (route.request().method() !== "GET") {
        await route.continue();
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          jobId: JOB_ID,
          diagnostics: [
            { severity: "warning", sourceNodeId: "node-2" },
            { severity: "error", sourceNodeId: "node-3" },
          ],
        }),
      });
    },
  );
}

/**
 * Returns a token-intelligence payload with one conflict and one unmapped
 * variable so deriveTokenSuggestionModel sets available=true.
 */
async function installTokenIntelligenceRoute(page: Page): Promise<void> {
  await page.route(
    `**/workspace/jobs/${JOB_ID}/token-intelligence`,
    async (route) => {
      if (route.request().method() !== "GET") {
        await route.continue();
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          jobId: JOB_ID,
          conflicts: [
            {
              name: "color/primary/500",
              figmaValue: "#3b82f6",
              existingValue: "#2563eb",
              resolution: "figma",
            },
          ],
          unmappedVariables: ["color/accent/300"],
          libraryKeys: [],
          cssCustomProperties: null,
          codeConnectMappings: [],
          designSystemMappings: [],
          heuristicComponentMappings: [],
        }),
      });
    },
  );
}

/**
 * Returns a file listing with one TSX file so the a11y scanner fetches it.
 */
async function installFilesListRoute(page: Page): Promise<void> {
  await page.route(`**/workspace/jobs/${JOB_ID}/files`, async (route) => {
    if (route.request().method() !== "GET") {
      await route.continue();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        files: [{ path: A11Y_FILE_PATH, sizeBytes: A11Y_FILE_CONTENT.length }],
      }),
    });
  });
}

/**
 * Returns the TSX file content containing deliberate a11y smells.
 * The URL is /workspace/jobs/:id/files/:encodedPath
 */
async function installFileContentRoute(page: Page): Promise<void> {
  await page.route(`**/workspace/jobs/${JOB_ID}/files/**`, async (route) => {
    if (route.request().method() !== "GET") {
      await route.continue();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "text/plain",
      body: A11Y_FILE_CONTENT,
    });
  });
}

/**
 * Silence the component-manifest endpoint so the pipeline does not stall
 * waiting for a 404 or network error to resolve.
 */
async function installManifestRoute(page: Page): Promise<void> {
  await page.route(
    `**/workspace/jobs/${JOB_ID}/component-manifest`,
    async (route) => {
      if (route.request().method() !== "GET") {
        await route.continue();
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ jobId: JOB_ID, screens: [] }),
      });
    },
  );
}

/**
 * Installs all artifact routes for the quality-score mock job.
 */
async function installAllArtifactRoutes(page: Page): Promise<void> {
  await installDesignIrRoute(page);
  await installFigmaAnalysisRoute(page);
  await installTokenIntelligenceRoute(page);
  await installFilesListRoute(page);
  await installFileContentRoute(page);
  await installManifestRoute(page);
}

/**
 * Navigates to the inspector bootstrap, clears storage, pastes, confirms the
 * SmartBanner, and waits for the inspector panel and suggestions panel to mount.
 */
async function triggerPasteAndWaitForSuggestionsPanel(
  page: Page,
): Promise<void> {
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

  // Wait for the suggestions panel to mount — it requires at least one of the
  // artifact fetches to succeed (design-ir provides totalNodes > 0).
  await expect(page.getByTestId("inspector-suggestions-panel")).toBeVisible({
    timeout: 20_000,
  });
}

// ---------------------------------------------------------------------------
// Route teardown helper
// ---------------------------------------------------------------------------

async function uninstallAllRoutes(page: Page): Promise<void> {
  await page.unroute("**/workspace/submit");
  await page.unroute(`**/workspace/jobs/${JOB_ID}`);
  await page.unroute(`**/workspace/jobs/${JOB_ID}/design-ir`);
  await page.unroute(`**/workspace/jobs/${JOB_ID}/figma-analysis`);
  await page.unroute(`**/workspace/jobs/${JOB_ID}/token-intelligence`);
  await page.unroute(`**/workspace/jobs/${JOB_ID}/files`);
  await page.unroute(`**/workspace/jobs/${JOB_ID}/files/**`);
  await page.unroute(`**/workspace/jobs/${JOB_ID}/component-manifest`);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe("inspector quality score panel (issue #993)", () => {
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
  // TC-1: Suggestions panel is visible after import with design-ir data
  // -------------------------------------------------------------------------
  test("inspector-suggestions-panel is visible once design-ir delivers nodes", async ({
    page,
  }) => {
    // Arrange
    await installSubmitRoute(page);
    await installJobPollRoute(page);
    await installAllArtifactRoutes(page);

    // Act
    await triggerPasteAndWaitForSuggestionsPanel(page);

    // Assert — the outer panel section is rendered
    await expect(page.getByTestId("inspector-suggestions-panel")).toBeVisible();
  });

  // -------------------------------------------------------------------------
  // TC-2: Quality score numeric value and band label are rendered
  // -------------------------------------------------------------------------
  test("suggestions-quality-score shows a numeric score and suggestions-quality-band shows a textual band", async ({
    page,
  }) => {
    // Arrange
    await installSubmitRoute(page);
    await installJobPollRoute(page);
    await installAllArtifactRoutes(page);

    // Act
    await triggerPasteAndWaitForSuggestionsPanel(page);

    // Assert — score section is present
    const scoreSection = page.getByTestId("suggestions-quality-score");
    await expect(scoreSection).toBeVisible();

    // Assert — band badge contains a numeric component followed by a textual band word
    const bandBadge = page.getByTestId("suggestions-quality-band");
    await expect(bandBadge).toBeVisible();
    // Band text is "Excellent · 92" / "Good · 75" / "Fair · 60" / "Poor · 40"
    await expect(bandBadge).toContainText(
      /^(Excellent|Good|Fair|Poor)\s*·\s*\d+$/,
    );
  });

  // -------------------------------------------------------------------------
  // TC-3: At least one risk row is present
  // -------------------------------------------------------------------------
  test("at least one risk row (suggestions-risk-{severity}) is rendered when nodes produce risks", async ({
    page,
  }) => {
    // Arrange
    await installSubmitRoute(page);
    await installJobPollRoute(page);
    await installAllArtifactRoutes(page);

    // Act
    await triggerPasteAndWaitForSuggestionsPanel(page);

    // Assert — at least one risk tag across all severities
    const anyRisk = page
      .getByTestId("suggestions-risk-high")
      .or(page.getByTestId("suggestions-risk-medium"))
      .or(page.getByTestId("suggestions-risk-low"));
    await expect(anyRisk.first()).toBeVisible({ timeout: 10_000 });
  });

  // -------------------------------------------------------------------------
  // TC-4: Token section is visible when conflicts/unmapped present
  // -------------------------------------------------------------------------
  test("suggestions-token-section is visible when token-intelligence returns conflicts", async ({
    page,
  }) => {
    // Arrange
    await installSubmitRoute(page);
    await installJobPollRoute(page);
    await installAllArtifactRoutes(page);

    // Act
    await triggerPasteAndWaitForSuggestionsPanel(page);

    // Assert
    await expect(page.getByTestId("suggestions-token-section")).toBeVisible({
      timeout: 10_000,
    });
  });

  // -------------------------------------------------------------------------
  // TC-5: Accept-all and reject-all buttons are present and enabled
  // -------------------------------------------------------------------------
  test("suggestions-token-accept-all and suggestions-token-reject-all buttons are enabled", async ({
    page,
  }) => {
    // Arrange
    await installSubmitRoute(page);
    await installJobPollRoute(page);
    await installAllArtifactRoutes(page);

    // Act
    await triggerPasteAndWaitForSuggestionsPanel(page);
    await expect(page.getByTestId("suggestions-token-section")).toBeVisible({
      timeout: 10_000,
    });

    // Assert — both bulk-action buttons are rendered and clickable
    await expect(
      page.getByTestId("suggestions-token-accept-all"),
    ).toBeEnabled();
    await expect(
      page.getByTestId("suggestions-token-reject-all"),
    ).toBeEnabled();
  });

  // -------------------------------------------------------------------------
  // TC-6: Accept-all marks all token rows as accepted (blue border / checked)
  // -------------------------------------------------------------------------
  test("clicking suggestions-token-accept-all checks all token row checkboxes", async ({
    page,
  }) => {
    // Arrange
    await installSubmitRoute(page);
    await installJobPollRoute(page);
    await installAllArtifactRoutes(page);

    // Act
    await triggerPasteAndWaitForSuggestionsPanel(page);
    await expect(page.getByTestId("suggestions-token-section")).toBeVisible({
      timeout: 10_000,
    });

    // There is one conflict row (kind="conflict") from the mock.
    // After reject-all, the checkbox should be unchecked. Then after accept-all, checked.
    await page.getByTestId("suggestions-token-reject-all").click();
    const checkbox = page
      .getByTestId("suggestions-token-conflict")
      .locator('input[type="checkbox"]');
    await expect(checkbox).not.toBeChecked();

    // Click accept-all — all checkboxes should become checked
    await page.getByTestId("suggestions-token-accept-all").click();
    await expect(checkbox).toBeChecked();
  });

  // -------------------------------------------------------------------------
  // TC-7: Reject-all unchecks all token row checkboxes
  // -------------------------------------------------------------------------
  test("clicking suggestions-token-reject-all unchecks all token row checkboxes", async ({
    page,
  }) => {
    // Arrange
    await installSubmitRoute(page);
    await installJobPollRoute(page);
    await installAllArtifactRoutes(page);

    // Act
    await triggerPasteAndWaitForSuggestionsPanel(page);
    await expect(page.getByTestId("suggestions-token-section")).toBeVisible({
      timeout: 10_000,
    });

    // Ensure at least one row is checked first by clicking accept-all
    await page.getByTestId("suggestions-token-accept-all").click();
    const checkbox = page
      .getByTestId("suggestions-token-conflict")
      .locator('input[type="checkbox"]');
    await expect(checkbox).toBeChecked();

    // Click reject-all — all checkboxes become unchecked
    await page.getByTestId("suggestions-token-reject-all").click();
    await expect(checkbox).not.toBeChecked();
  });

  // -------------------------------------------------------------------------
  // TC-8: A11y section renders rows when generated file content has smells
  // -------------------------------------------------------------------------
  test("suggestions-a11y-section is visible and shows nudge rows when file content has a11y issues", async ({
    page,
  }) => {
    // Arrange
    await installSubmitRoute(page);
    await installJobPollRoute(page);
    await installAllArtifactRoutes(page);

    // Act
    await triggerPasteAndWaitForSuggestionsPanel(page);

    // The a11y section is driven by per-file fetches that fire after the files
    // list resolves. Allow extra time for the react-query cascade.
    const a11ySection = page.getByTestId("suggestions-a11y-section");
    await expect(a11ySection).toBeVisible({ timeout: 15_000 });

    // Assert — at least one nudge row across severities
    const anyNudge = page
      .getByTestId("suggestions-a11y-high")
      .or(page.getByTestId("suggestions-a11y-medium"))
      .or(page.getByTestId("suggestions-a11y-low"));
    await expect(anyNudge.first()).toBeVisible({ timeout: 5_000 });
  });

  // -------------------------------------------------------------------------
  // TC-9: A11y focus button is NOT rendered in the InspectorPanel integration
  //
  // InspectorPanel.tsx omits the onFocusFile prop when mounting SuggestionsPanel
  // (line ~6458 in InspectorPanel.tsx). SuggestionsPanel only renders the
  // focus button when onFocusFile is provided (line ~606 in SuggestionsPanel.tsx).
  // Testing DOM-focus changes is therefore impossible without a component-level
  // change to wire up the prop. This is intentionally skipped rather than
  // silently absent.
  // -------------------------------------------------------------------------
  test("suggestions-a11y-focus-{ruleId} button changes DOM focus when clicked", async () => {
    // InspectorPanel.tsx omits the onFocusFile prop when mounting SuggestionsPanel
    // (line ~6458 in InspectorPanel.tsx). SuggestionsPanel only renders the
    // focus button when onFocusFile is provided (line ~606 in SuggestionsPanel.tsx).
    // Testing DOM-focus changes is therefore impossible without a component-level
    // change to wire up the prop.
    test.skip(
      true,
      "onFocusFile is not wired in InspectorPanel — focus buttons are never rendered",
    );
  });

  // -------------------------------------------------------------------------
  // TC-10: Panel is NOT shown when design-ir has no nodes and token/a11y absent
  // -------------------------------------------------------------------------
  test("inspector-suggestions-panel is absent when design-ir returns empty screens and no token or a11y data", async ({
    page,
  }) => {
    // Arrange — override design-ir to return empty screens
    await installSubmitRoute(page);
    await installJobPollRoute(page);

    // Install an empty design-ir (totalNodes = 0)
    await page.route(`**/workspace/jobs/${JOB_ID}/design-ir`, async (route) => {
      if (route.request().method() !== "GET") {
        await route.continue();
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ jobId: JOB_ID, screens: [] }),
      });
    });

    // Return figma-analysis with zero diagnostics
    await page.route(
      `**/workspace/jobs/${JOB_ID}/figma-analysis`,
      async (route) => {
        if (route.request().method() !== "GET") {
          await route.continue();
          return;
        }
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ jobId: JOB_ID, diagnostics: [] }),
        });
      },
    );

    // Return token-intelligence with no conflicts or unmapped (available=false)
    await page.route(
      `**/workspace/jobs/${JOB_ID}/token-intelligence`,
      async (route) => {
        if (route.request().method() !== "GET") {
          await route.continue();
          return;
        }
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            jobId: JOB_ID,
            conflicts: [],
            unmappedVariables: [],
            libraryKeys: [],
            cssCustomProperties: null,
            codeConnectMappings: [],
            designSystemMappings: [],
            heuristicComponentMappings: [],
          }),
        });
      },
    );

    // Return files list with no TSX files — no a11y nudges will be produced
    await page.route(`**/workspace/jobs/${JOB_ID}/files`, async (route) => {
      if (route.request().method() !== "GET") {
        await route.continue();
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ files: [] }),
      });
    });

    await installManifestRoute(page);

    // Act
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

    // Allow time for artifact fetches to complete before asserting absence.
    // A 2s wait is acceptable here — we are asserting absence, not waiting
    // for an event to fire, so a short bounded wait prevents a false negative.
    await page.waitForTimeout(2_000); // bounded absence check — 2s max

    // Assert — the panel must not be present (SuggestionsPanel returns null)
    await expect(page.getByTestId("inspector-suggestions-panel")).toHaveCount(
      0,
    );
  });
});
