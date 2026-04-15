/**
 * E2E tests for the SmartBanner detect→banner→confirm/dismiss flow.
 *
 * Covers: intent detection on paste, banner visibility with correct label and
 * confidence, dropdown correction, "Import starten" confirm that starts the
 * import, and dismiss that returns to idle.
 *
 * Flow under test (issue #991):
 *   User pastes content
 *     → classifyPasteInput passes (valid JSON or JSON-like)
 *     → classifyPasteIntent runs
 *     → state becomes "detected"
 *     → SmartBanner appears (data-testid="smart-banner")
 *   User confirms → state becomes "pasting" → POST /workspace/submit fires
 *   User dismisses → state returns to "idle" → SmartBanner disappears
 */
import { expect, test, type Page } from "@playwright/test";
import {
  getPrototypeNavigationPastePayload,
  getWorkspaceUiUrl,
  resetBrowserStorage,
  simulateInspectorPaste,
  withSubmissionRateLimit,
} from "./helpers";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const BOOTSTRAP_VIEWPORT = { width: 1920, height: 1080 } as const;

const INSPECTOR_URL = (() => {
  const base = new URL(getWorkspaceUiUrl());
  base.pathname = base.pathname.replace(
    /\/workspace\/ui\/?$/,
    "/workspace/ui/inspector",
  );
  return base.toString();
})();

/**
 * A minimal Figma JSON_REST_V1 document payload.
 * classifyPasteInput → "direct_json"
 * classifyPasteIntent → FIGMA_JSON_DOC (confidence 0.9 → 90%)
 */
const FIGMA_DOC_JSON = JSON.stringify({
  document: {
    id: "0:0",
    type: "DOCUMENT",
    name: "Doc",
    children: [],
  },
  schemaVersion: "JSON_REST_V1",
});

/**
 * A Figma plugin export payload.
 * classifyPasteInput → "plugin_payload_json"
 * classifyPasteIntent → FIGMA_JSON_NODE_BATCH (confidence 0.85 → 85%)
 */
const PLUGIN_EXPORT_JSON = JSON.stringify({
  type: "PLUGIN_EXPORT",
  nodes: [],
});

/**
 * A plain JSON object that has no Figma-specific keys — not a document, not a
 * plugin export, not a node.
 * classifyPasteIntent → RAW_CODE_OR_TEXT (confidence 0.7 → 70%).
 */
const PLAIN_JSON_PAYLOAD = JSON.stringify({ greeting: "hello world" });

/**
 * Plain text (non-JSON) — classifyPasteIntent → RAW_CODE_OR_TEXT
 * (confidence 1.0 → 100%).
 */
const PLAIN_TEXT_PAYLOAD = "hello world — this is plain text, not JSON";

const TEST_JOB_ID = "smart-banner-test-job-id";
const PROTOTYPE_NAVIGATION_PASTE = getPrototypeNavigationPastePayload();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Navigates to the inspector route and waits for the bootstrap shell to mount.
 */
async function gotoInspector(page: Page): Promise<void> {
  await page.setViewportSize(BOOTSTRAP_VIEWPORT);
  await page.goto(INSPECTOR_URL);
  await page.waitForSelector('[data-testid="inspector-bootstrap"]', {
    timeout: 15_000,
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe("inspector SmartBanner — detect→banner→confirm/dismiss flow", () => {
  test.describe.configure({ mode: "serial", timeout: 180_000 });

  test.afterEach(async ({ page }) => {
    await page.unroute("**/workspace/submit");
    await page.unroute(`**/workspace/jobs/${TEST_JOB_ID}`);
    await page.unroute("**/workspace/jobs/**");
    await resetBrowserStorage(page);
  });

  // -------------------------------------------------------------------------
  // TC-1: Figma document JSON → banner shows "Figma-Dokument JSON"
  // -------------------------------------------------------------------------
  test('pasting a Figma document JSON shows the SmartBanner with label "Figma-Dokument JSON"', async ({
    page,
  }) => {
    // Arrange
    await gotoInspector(page);
    await expect(page.getByTestId("inspector-bootstrap")).toBeVisible();

    // Act — paste a JSON_REST_V1 document payload
    await simulateInspectorPaste(page, FIGMA_DOC_JSON);

    // Assert — SmartBanner container is visible
    const banner = page.getByTestId("smart-banner");
    await expect(banner).toBeVisible({ timeout: 5_000 });

    // Assert — the detected-type label shows "Figma-Dokument JSON"
    await expect(banner).toContainText("Figma-Dokument JSON");

    // Assert — the confidence badge is present and shows a non-zero percentage
    // (classifyPasteIntent → FIGMA_JSON_DOC at 90%)
    await expect(banner).toContainText("90%");

    // Assert — the bootstrap shell is still shown (not yet pasting)
    await expect(page.getByTestId("inspector-bootstrap")).toBeVisible();

    // Assert — import has NOT started (no POST to /workspace/submit yet)
    const submitRequests: string[] = [];
    page.on("request", (req) => {
      if (req.method() === "POST" && req.url().includes("/workspace/submit")) {
        submitRequests.push(req.url());
      }
    });
    await page.waitForTimeout(300);
    expect(
      submitRequests,
      "Expected POST /workspace/submit NOT to fire until the user confirms",
    ).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // TC-2: Plugin export JSON → banner shows "Figma-Node JSON"
  // -------------------------------------------------------------------------
  test('pasting a plugin export JSON shows the SmartBanner with label "Figma-Node JSON"', async ({
    page,
  }) => {
    // Arrange
    await gotoInspector(page);
    await expect(page.getByTestId("inspector-bootstrap")).toBeVisible();

    // Act — paste a PLUGIN_EXPORT payload
    await simulateInspectorPaste(page, PLUGIN_EXPORT_JSON);

    // Assert — SmartBanner is visible with the correct label
    const banner = page.getByTestId("smart-banner");
    await expect(banner).toBeVisible({ timeout: 5_000 });
    await expect(banner).toContainText("Figma-Node JSON");

    // Assert — confidence badge shows 85% (FIGMA_JSON_NODE_BATCH via plugin key)
    await expect(banner).toContainText("85%");

    // Assert — bootstrap shell remains visible (intent not yet confirmed)
    await expect(page.getByTestId("inspector-bootstrap")).toBeVisible();
  });

  // -------------------------------------------------------------------------
  // TC-3a: Plain JSON with no Figma signals → banner shows "Code / Text"
  // -------------------------------------------------------------------------
  test('pasting JSON with no Figma signals shows the SmartBanner with label "Code / Text"', async ({
    page,
  }) => {
    await gotoInspector(page);
    await expect(page.getByTestId("inspector-bootstrap")).toBeVisible();

    await simulateInspectorPaste(page, PLAIN_JSON_PAYLOAD);

    const banner = page.getByTestId("smart-banner");
    await expect(banner).toBeVisible({ timeout: 5_000 });
    await expect(banner).toContainText("Code / Text");
    await expect(page.getByTestId("inspector-bootstrap")).toBeVisible();
  });

  // -------------------------------------------------------------------------
  // TC-3b: Plain text (non-JSON) → banner shows "Code / Text"
  // -------------------------------------------------------------------------
  test('pasting plain non-JSON text shows the SmartBanner with label "Code / Text"', async ({
    page,
  }) => {
    await gotoInspector(page);
    await expect(page.getByTestId("inspector-bootstrap")).toBeVisible();

    await simulateInspectorPaste(page, PLAIN_TEXT_PAYLOAD);

    const banner = page.getByTestId("smart-banner");
    await expect(banner).toBeVisible({ timeout: 5_000 });
    await expect(banner).toContainText("Code / Text");
    await expect(page.getByTestId("inspector-bootstrap")).toBeVisible();
  });

  // -------------------------------------------------------------------------
  // TC-4: Correct classification via dropdown — label updates in banner
  // -------------------------------------------------------------------------
  test("changing the type dropdown updates the displayed label in the banner", async ({
    page,
  }) => {
    // Arrange — paste a doc JSON so initial intent is FIGMA_JSON_DOC
    await gotoInspector(page);
    await expect(page.getByTestId("inspector-bootstrap")).toBeVisible();
    await simulateInspectorPaste(page, FIGMA_DOC_JSON);

    const banner = page.getByTestId("smart-banner");
    await expect(banner).toBeVisible({ timeout: 5_000 });

    // Assert initial state — label shows "Figma-Dokument JSON"
    await expect(banner).toContainText("Figma-Dokument JSON");

    // Act — change the dropdown to "Figma-Node JSON"
    const dropdown = banner.getByRole("combobox", {
      name: "Erkannten Typ korrigieren",
    });
    await expect(dropdown).toBeVisible();
    await dropdown.selectOption("FIGMA_JSON_NODE_BATCH");

    // Assert — the display label span (not the dropdown options) shows the new label
    const displayLabel = banner.locator("span.font-semibold");
    await expect(displayLabel).toHaveText("Figma-Node JSON");
  });

  // -------------------------------------------------------------------------
  // TC-5: Clicking "Import starten" starts the import
  //
  // The confirmed intent is carried through to the POST body so the server
  // receives the (potentially corrected) intent value.
  // -------------------------------------------------------------------------
  test('"Import starten" confirms intent, fires POST /workspace/submit, and state transitions to pasting/queued', async ({
    page,
  }) => {
    await gotoInspector(page);
    await expect(page.getByTestId("inspector-bootstrap")).toBeVisible();

    // Paste to trigger "detected" state → SmartBanner appears
    await simulateInspectorPaste(page, PROTOTYPE_NAVIGATION_PASTE);
    const banner = page.getByTestId("smart-banner");
    await expect(banner).toBeVisible({ timeout: 5_000 });
    await expect(banner).toContainText("Figma-Dokument JSON");

    // Set up promise to await the submit response before asserting
    const submitResponsePromise = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        response.url().includes("/workspace/submit"),
    );

    // Act — click "Import starten"
    await withSubmissionRateLimit(async () => {
      await banner.getByRole("button", { name: "Import starten" }).click();
    });

    // Assert — POST /workspace/submit was sent
    const submitResponse = await submitResponsePromise;
    expect(submitResponse.status()).toBe(202);

    // Assert — the submitted body carries a figmaJsonPayload
    const submittedBody = submitResponse.request().postDataJSON() as Record<
      string,
      unknown
    >;
    expect(submittedBody["figmaSourceMode"]).toBe("figma_paste");
    expect(typeof submittedBody["figmaJsonPayload"]).toBe("string");

    // Assert — SmartBanner is removed once pasting begins (state leaves "detected")
    await expect(page.getByTestId("smart-banner")).toHaveCount(0, {
      timeout: 5_000,
    });

    // Assert — inspector panel eventually hydrates once job completes
    await expect(page.getByTestId("inspector-layout")).toBeVisible({
      timeout: 120_000,
    });
  });

  // -------------------------------------------------------------------------
  // TC-6: Dismiss (×) returns to idle — banner disappears, no import fires
  // -------------------------------------------------------------------------
  test("clicking the dismiss button (×) removes the SmartBanner and returns to idle without submitting", async ({
    page,
  }) => {
    // Arrange — do NOT install submit routes; any POST would be a test failure
    await gotoInspector(page);
    await expect(page.getByTestId("inspector-bootstrap")).toBeVisible();

    // Track any unexpected submit requests
    const submitRequests: string[] = [];
    page.on("request", (req) => {
      if (req.method() === "POST" && req.url().includes("/workspace/submit")) {
        submitRequests.push(req.url());
      }
    });

    // Paste to trigger "detected" state → SmartBanner appears
    await simulateInspectorPaste(page, FIGMA_DOC_JSON);
    const banner = page.getByTestId("smart-banner");
    await expect(banner).toBeVisible({ timeout: 5_000 });

    // Act — click the dismiss button (aria-label "Banner schliessen")
    await banner.getByRole("button", { name: "Banner schliessen" }).click();

    // Assert — SmartBanner is no longer in the DOM
    await expect(page.getByTestId("smart-banner")).toHaveCount(0, {
      timeout: 5_000,
    });

    // Assert — bootstrap shell is still visible (returned to idle, not errored)
    await expect(page.getByTestId("inspector-bootstrap")).toBeVisible();
    await expect(page.getByTestId("inspector-layout")).toHaveCount(0);

    // Assert — no POST /workspace/submit was fired
    await page.waitForTimeout(300);
    expect(
      submitRequests,
      "Expected POST /workspace/submit NOT to fire after dismiss",
    ).toHaveLength(0);
  });
});
