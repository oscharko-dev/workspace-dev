/**
 * E2E tests for multi-select scope controls and import-history toggle (Issue #1010).
 *
 * Architecture notes (from reading component-tree.tsx, InspectorPanel.tsx,
 * ImportHistoryPanel.tsx, InspectorBootstrap.tsx, useImportHistory.ts,
 * node-selection-state.ts, PasteDropZone.tsx):
 *
 * - Tree checkboxes (`tree-checkbox-{nodeId}`, role="checkbox") render only when
 *   the parent `ComponentTree` receives a `selection` prop AND the node is not a
 *   skeleton. `selection` is passed by InspectorPanel when `scopeControlsEnabled`.
 *
 * - `scopeControlsEnabled` = onGenerateSelected !== undefined
 *     && effectiveTreeNodes.length > 0
 *     && stage ∈ {transforming, mapping, generating, ready, partial}
 *     || designIrState.status === "ready"
 *
 *   The inspector-page always passes `onGenerateSelected`, so the gate is
 *   effectively: tree nodes present AND pipeline in a terminal/near-terminal stage.
 *
 * - Tree nodes come from `design-ir` (via designIrQuery) when the job reaches
 *   "completed" with outcome "partial" and fetchFinalArtifacts fires.
 *
 * - `aria-checked` on `tree-checkbox-{nodeId}` reflects tri-state:
 *     "true"  = checked, "false" = unchecked, "mixed" = partial.
 *   Default on mount = all selected → "true" for every leaf; clicking a leaf
 *   deselects it (aria-checked="false") and its ancestor may become "mixed".
 *
 * - `inspector-generate-selected` is disabled when selectedNodeIdsForGenerate.length === 0.
 *   selectedNodeIdsForGenerate is empty when selectionAllSelected = true (all checked),
 *   so the button is disabled on initial mount (all selected = "all screens" mode).
 *   After deselecting one leaf, selectionAllSelected becomes false and
 *   selectedNodeIdsForGenerate.length > 0 → button becomes enabled.
 *
 * - `inspector-import-history-toggle` renders only when `importHistory !== undefined`
 *   in InspectorPanel. The parent (inspector-page) always passes
 *   `importHistory={importHistoryHook.history.entries}`, which comes from
 *   GET /workspace/import-sessions. When that endpoint returns sessions, the array
 *   is non-empty and the toggle renders.
 *
 * - `import-history-panel` (data-testid) is the `<section>` rendered by
 *   ImportHistoryPanel — visible only after the toggle is clicked.
 *
 * - URL-import path: The `PasteDropZone` (rendered when bootstrap state is
 *   "idle") has an `aria-label="Figma design URL"` text input and a submit button
 *   "Open design". Submitting a valid Figma URL calls bootstrap.submitUrl()
 *   → POST /workspace/submit (no SmartBanner confirmation step — direct submit).
 *   This is only available before a job starts (bootstrap = idle state).
 *
 * Strategy:
 *   - POST /workspace/submit → 202 { jobId }
 *   - GET /workspace/jobs/:id → running x2, then completed+partial
 *   - GET /workspace/jobs/:id/design-ir → tree with parent + two leaf children
 *   - GET /workspace/import-sessions → non-empty list (for history toggle)
 *   For the URL-import test: interact with the PasteDropZone before any paste.
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

const JOB_ID = "multi-select-mock-job";

// Node ids must be stable strings that survive URL encoding and DOM queries.
const SCREEN_ID = "screen-100";
const CHILD_A_ID = "node-101";
const CHILD_B_ID = "node-102";

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
 * Job poll: running x2 → completed with outcome:"partial".
 * "completed" + partial outcome triggers fetchFinalArtifacts (design-ir fetch).
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
 * Design-IR with one screen that has two leaf children.
 * Parent (screen-100) + child A (node-101) + child B (node-102).
 * Checking/unchecking child A while child B remains checked puts the parent in
 * "mixed" (partial) state.
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
            id: SCREEN_ID,
            name: "HomeScreen",
            generatedFile: "src/screens/HomeScreen.tsx",
            children: [
              {
                id: CHILD_A_ID,
                name: "Header",
                type: "Frame",
                children: [],
              },
              {
                id: CHILD_B_ID,
                name: "Content",
                type: "Frame",
                children: [],
              },
            ],
          },
        ],
      }),
    });
  });
}

/**
 * Silence other artifact endpoints so the pipeline does not stall.
 */
async function installSilencedArtifactRoutes(page: Page): Promise<void> {
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
}

/**
 * Mocks /workspace/import-sessions with one session so the import-history-toggle
 * renders in the inspector toolbar.
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
            id: "hist-session-001",
            fileKey: "figma-file-abc",
            nodeId: "1:2",
            nodeName: "HomeScreen",
            importedAt: new Date(Date.now() - 86_400_000).toISOString(),
            nodeCount: 3,
            fileCount: 1,
            selectedNodes: [],
            scope: "all",
            componentMappings: 0,
            pasteIdentityKey: "multi-select-key-1",
            jobId: "prior-job-001",
            replayable: true,
          },
        ],
      }),
    });
  });
}

/**
 * Standard bootstrap sequence used by all tests that need the inspector panel
 * with scope controls active. Waits for the inspector-panel to mount.
 */
async function triggerPasteAndWaitForInspectorPanel(page: Page): Promise<void> {
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

/**
 * Waits for the component tree to be present AND for at least one checkbox to
 * appear, confirming scopeControlsEnabled has fired and tree nodes are rendered.
 *
 * The `expandedIds` useState initializer in ComponentTree runs once when the
 * component mounts. If screens is empty at mount time (design-ir not yet loaded),
 * the initializer produces an empty set and screen nodes start collapsed even
 * though they have children. We therefore:
 *  1. Wait for the screen-level checkbox (always a top-level visible row).
 *  2. Click "Expand" on the screen row to expand its children.
 *  3. Wait for the first child checkbox to appear.
 */
async function waitForCheckboxes(page: Page): Promise<void> {
  // Step 1 — wait for the screen row checkbox (always visible, depth=0)
  await expect(page.getByTestId(`tree-checkbox-${SCREEN_ID}`)).toBeVisible({
    timeout: 20_000,
  });

  // Step 2 — expand the screen node so child rows enter the virtual window.
  // The expand button is inside the screen row and has aria-label="Expand".
  const screenRow = page.getByTestId(`tree-screen-${SCREEN_ID}`);
  const expandBtn = screenRow.getByRole("button", { name: "Expand" });
  if ((await expandBtn.count()) > 0) {
    await expandBtn.click();
  }

  // Step 3 — wait for the first child checkbox to become visible
  await expect(page.getByTestId(`tree-checkbox-${CHILD_A_ID}`)).toBeVisible({
    timeout: 5_000,
  });
}

// ---------------------------------------------------------------------------
// Route teardown helper
// ---------------------------------------------------------------------------

async function uninstallAllRoutes(page: Page): Promise<void> {
  await page.unroute("**/workspace/submit");
  await page.unroute(`**/workspace/jobs/${JOB_ID}`);
  await page.unroute(`**/workspace/jobs/${JOB_ID}/design-ir`);
  await page.unroute(`**/workspace/jobs/${JOB_ID}/component-manifest`);
  await page.unroute(`**/workspace/jobs/${JOB_ID}/figma-analysis`);
  await page.unroute(`**/workspace/jobs/${JOB_ID}/token-intelligence`);
  await page.unroute(`**/workspace/jobs/${JOB_ID}/files`);
  await page.unroute("**/workspace/import-sessions");
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe("inspector multi-select scope controls and import history (issue #1010)", () => {
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
  // TC-1: Tree checkboxes render when the inspector has tree nodes
  //
  // Validates that `tree-checkbox-{nodeId}` elements are present once design-ir
  // data flows into the component tree and scopeControlsEnabled = true.
  // -------------------------------------------------------------------------
  test("tree-checkbox-{nodeId} elements render for each tree node when design-ir delivers nodes", async ({
    page,
  }) => {
    // Arrange
    await installSubmitRoute(page);
    await installJobPollRoute(page);
    await installDesignIrRoute(page);
    await installImportSessionsRoute(page);
    await installSilencedArtifactRoutes(page);

    // Act
    await triggerPasteAndWaitForInspectorPanel(page);
    await waitForCheckboxes(page);

    // Assert — checkboxes for both leaf nodes are present
    await expect(page.getByTestId(`tree-checkbox-${CHILD_A_ID}`)).toBeVisible();
    await expect(page.getByTestId(`tree-checkbox-${CHILD_B_ID}`)).toBeVisible();
  });

  // -------------------------------------------------------------------------
  // TC-2: Leaf checkbox toggles aria-checked from "true" to "false" on click
  //
  // Initial state: all selected → aria-checked="true".
  // After clicking: the leaf is excluded → aria-checked="false".
  // -------------------------------------------------------------------------
  test("clicking a leaf tree-checkbox toggles aria-checked from 'true' to 'false'", async ({
    page,
  }) => {
    // Arrange
    await installSubmitRoute(page);
    await installJobPollRoute(page);
    await installDesignIrRoute(page);
    await installImportSessionsRoute(page);
    await installSilencedArtifactRoutes(page);

    // Act
    await triggerPasteAndWaitForInspectorPanel(page);
    await waitForCheckboxes(page);

    const checkboxA = page.getByTestId(`tree-checkbox-${CHILD_A_ID}`);

    // Assert — initially all-selected, so aria-checked is "true"
    await expect(checkboxA).toHaveAttribute("aria-checked", "true");

    // Act — click to deselect
    await checkboxA.click();

    // Assert — leaf is now excluded → aria-checked="false"
    await expect(checkboxA).toHaveAttribute("aria-checked", "false");
  });

  // -------------------------------------------------------------------------
  // TC-3: Clicking a deselected leaf re-selects it (aria-checked back to "true")
  //
  // Round-trip: "true" → "false" (deselect) → "true" (re-select).
  // -------------------------------------------------------------------------
  test("clicking a deselected leaf tree-checkbox toggles aria-checked back to 'true'", async ({
    page,
  }) => {
    // Arrange
    await installSubmitRoute(page);
    await installJobPollRoute(page);
    await installDesignIrRoute(page);
    await installImportSessionsRoute(page);
    await installSilencedArtifactRoutes(page);

    // Act
    await triggerPasteAndWaitForInspectorPanel(page);
    await waitForCheckboxes(page);

    const checkboxA = page.getByTestId(`tree-checkbox-${CHILD_A_ID}`);

    // Deselect
    await checkboxA.click();
    await expect(checkboxA).toHaveAttribute("aria-checked", "false");

    // Re-select
    await checkboxA.click();

    // Assert — back to "true"
    await expect(checkboxA).toHaveAttribute("aria-checked", "true");
  });

  // -------------------------------------------------------------------------
  // TC-4: Deselecting one child puts the parent into "mixed" state
  //
  // With two leaf children (A, B): deselecting A while B remains checked causes
  // the parent screen node (screen-100) to enter aria-checked="mixed".
  // -------------------------------------------------------------------------
  test("parent node aria-checked becomes 'mixed' when one of its children is deselected", async ({
    page,
  }) => {
    // Arrange
    await installSubmitRoute(page);
    await installJobPollRoute(page);
    await installDesignIrRoute(page);
    await installImportSessionsRoute(page);
    await installSilencedArtifactRoutes(page);

    // Act
    await triggerPasteAndWaitForInspectorPanel(page);
    await waitForCheckboxes(page);

    const checkboxA = page.getByTestId(`tree-checkbox-${CHILD_A_ID}`);
    const parentCheckbox = page.getByTestId(`tree-checkbox-${SCREEN_ID}`);

    // Assert — parent initially fully checked
    await expect(parentCheckbox).toHaveAttribute("aria-checked", "true");

    // Deselect one child
    await checkboxA.click();

    // Assert — parent is now partially checked (mixed)
    await expect(parentCheckbox).toHaveAttribute("aria-checked", "mixed");
  });

  // -------------------------------------------------------------------------
  // TC-5: Clicking a "mixed" parent transitions it to fully checked ("true")
  //
  // The toggle rule: when checkState !== "checked", nextSelected = true.
  // So a "mixed" parent clicks to "checked" (all children re-selected).
  // -------------------------------------------------------------------------
  test("clicking a 'mixed' parent checkbox transitions it to fully checked ('true')", async ({
    page,
  }) => {
    // Arrange
    await installSubmitRoute(page);
    await installJobPollRoute(page);
    await installDesignIrRoute(page);
    await installImportSessionsRoute(page);
    await installSilencedArtifactRoutes(page);

    // Act
    await triggerPasteAndWaitForInspectorPanel(page);
    await waitForCheckboxes(page);

    const checkboxA = page.getByTestId(`tree-checkbox-${CHILD_A_ID}`);
    const parentCheckbox = page.getByTestId(`tree-checkbox-${SCREEN_ID}`);

    // Get parent into "mixed" state
    await checkboxA.click();
    await expect(parentCheckbox).toHaveAttribute("aria-checked", "mixed");

    // Click the mixed parent — should select all children
    await parentCheckbox.click();

    // Assert — parent (and all children) are now fully checked
    await expect(parentCheckbox).toHaveAttribute("aria-checked", "true");
    await expect(
      page.getByTestId(`tree-checkbox-${CHILD_A_ID}`),
    ).toHaveAttribute("aria-checked", "true");
    await expect(
      page.getByTestId(`tree-checkbox-${CHILD_B_ID}`),
    ).toHaveAttribute("aria-checked", "true");
  });

  // -------------------------------------------------------------------------
  // TC-6: inspector-generate-selected is enabled when all nodes are selected
  //        AND disabled only when all nodes are explicitly deselected
  //
  // disabled = !selectionAllSelected && selectedNodeIdsForGenerate.length === 0
  //
  // When selectionAllSelected=true (nothing excluded):
  //   !true && 0===0  →  false  →  button ENABLED ("generate all" mode).
  //
  // When every node is explicitly excluded (deselect all via "Deselect All"):
  //   !false && 0===0  →  true   →  button DISABLED.
  // -------------------------------------------------------------------------
  test("inspector-generate-selected is enabled when all selected, disabled when none selected", async ({
    page,
  }) => {
    // Arrange
    await installSubmitRoute(page);
    await installJobPollRoute(page);
    await installDesignIrRoute(page);
    await installImportSessionsRoute(page);
    await installSilencedArtifactRoutes(page);

    // Act
    await triggerPasteAndWaitForInspectorPanel(page);
    await waitForCheckboxes(page);

    const generateBtn = page.getByTestId("inspector-generate-selected");
    await expect(generateBtn).toBeVisible({ timeout: 10_000 });

    // Assert — initially all selected (selectionAllSelected=true) → button is enabled
    await expect(generateBtn).toBeEnabled();

    // Deselect all nodes using the toolbar "Deselect All" button
    const deselectAllBtn = page.getByTestId("tree-deselect-all");
    await expect(deselectAllBtn).toBeVisible({ timeout: 5_000 });
    await deselectAllBtn.click();

    // Assert — all nodes now excluded: selectionAllSelected=false AND
    // selectedNodeIdsForGenerate=[] → button becomes disabled
    await expect(generateBtn).toBeDisabled({ timeout: 5_000 });
  });

  // -------------------------------------------------------------------------
  // TC-7: inspector-generate-selected returns to enabled after re-selecting a node
  //
  // After "Deselect All" (all excluded, button disabled), checking any one node
  // causes selectedNodeIdsForGenerate.length > 0 → button re-enables.
  // -------------------------------------------------------------------------
  test("inspector-generate-selected re-enables after selecting at least one node from deselect-all state", async ({
    page,
  }) => {
    // Arrange
    await installSubmitRoute(page);
    await installJobPollRoute(page);
    await installDesignIrRoute(page);
    await installImportSessionsRoute(page);
    await installSilencedArtifactRoutes(page);

    // Act
    await triggerPasteAndWaitForInspectorPanel(page);
    await waitForCheckboxes(page);

    const generateBtn = page.getByTestId("inspector-generate-selected");
    await page.getByTestId("tree-deselect-all").click();
    await expect(generateBtn).toBeDisabled({ timeout: 5_000 });

    // Re-select child A only
    await page.getByTestId(`tree-checkbox-${CHILD_A_ID}`).click();

    // Assert — at least one node selected → button enabled again
    await expect(generateBtn).toBeEnabled({ timeout: 5_000 });
  });

  // -------------------------------------------------------------------------
  // TC-8: inspector-import-history-toggle renders when sessions are present
  //
  // The toggle only renders when importHistory has at least one entry.
  // Mocked /workspace/import-sessions returns one session → toggle visible.
  // -------------------------------------------------------------------------
  test("inspector-import-history-toggle is visible when import-sessions returns a non-empty list", async ({
    page,
  }) => {
    // Arrange
    await installSubmitRoute(page);
    await installJobPollRoute(page);
    await installDesignIrRoute(page);
    await installImportSessionsRoute(page);
    await installSilencedArtifactRoutes(page);

    // Act
    await triggerPasteAndWaitForInspectorPanel(page);

    // Assert — history toggle is rendered once the sessions query resolves
    const toggle = page.getByTestId("inspector-import-history-toggle");
    await expect(toggle).toBeVisible({ timeout: 15_000 });
  });

  // -------------------------------------------------------------------------
  // TC-9: Clicking inspector-import-history-toggle opens import-history-panel
  //
  // The panel (ImportHistoryPanel, data-testid="import-history-panel") is mounted
  // inside an absolute overlay only when importHistoryOpen=true in InspectorPanel.
  // -------------------------------------------------------------------------
  test("clicking inspector-import-history-toggle makes import-history-panel visible", async ({
    page,
  }) => {
    // Arrange
    await installSubmitRoute(page);
    await installJobPollRoute(page);
    await installDesignIrRoute(page);
    await installImportSessionsRoute(page);
    await installSilencedArtifactRoutes(page);

    // Act
    await triggerPasteAndWaitForInspectorPanel(page);

    const toggle = page.getByTestId("inspector-import-history-toggle");
    await expect(toggle).toBeVisible({ timeout: 15_000 });

    // Assert — panel is NOT present before clicking
    await expect(page.getByTestId("import-history-panel")).toHaveCount(0);

    // Click toggle
    await toggle.click();

    // Assert — panel is now visible
    await expect(page.getByTestId("import-history-panel")).toBeVisible({
      timeout: 5_000,
    });
  });

  // -------------------------------------------------------------------------
  // TC-10: URL-import path — submitting a Figma URL in PasteDropZone triggers
  //         POST /workspace/submit and loads the inspector panel
  //
  // The PasteDropZone renders in idle state before any paste. Filling the
  // "Figma design URL" input with a valid URL and submitting the form calls
  // bootstrap.submitUrl() → POST /workspace/submit (no SmartBanner needed).
  // -------------------------------------------------------------------------
  test("entering a valid Figma URL in PasteDropZone and submitting triggers /workspace/submit", async ({
    page,
  }) => {
    // Arrange
    await installSubmitRoute(page);
    await installJobPollRoute(page);
    await installDesignIrRoute(page);
    await installImportSessionsRoute(page);
    await installSilencedArtifactRoutes(page);

    // Navigate to bootstrap (idle state — PasteDropZone visible)
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

    // Act — fill in a valid Figma design URL (file-level, no node-id required for submit)
    const urlInput = page.getByLabel("Figma design URL");
    await expect(urlInput).toBeVisible({ timeout: 5_000 });
    await urlInput.fill(
      "https://www.figma.com/design/ABC123fileKeyXYZ0987/MyDesign?node-id=1-2",
    );

    // Submit the form — "Open design" button
    await page.getByRole("button", { name: "Open design" }).click();

    // Assert — /workspace/submit was called
    const submitResponse = await submitResponsePromise;
    expect(submitResponse.status()).toBe(202);

    // Assert — inspector panel eventually mounts
    await expect(page.getByTestId("inspector-panel")).toBeVisible({
      timeout: 20_000,
    });
  });
});
