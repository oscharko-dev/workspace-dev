/**
 * E2E tests for the Inspector bootstrap flow.
 *
 * Covers: direct entry rendering, paste-to-hydrate happy path, 4xx inline
 * error state, and regression guard for the existing deep-link path.
 *
 * All tests are fully mocked — no real server is required.
 */
import { expect, test, type Page } from "@playwright/test";
import { getWorkspaceUiUrl, resetBrowserStorage } from "./helpers";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const BOOTSTRAP_VIEWPORT = { width: 1920, height: 1080 } as const;

const INSPECTOR_URL = (() => {
  const base = new URL(getWorkspaceUiUrl());
  // UI_URL already ends with /workspace/ui; replace that suffix with the inspector path.
  base.pathname = base.pathname.replace(
    /\/workspace\/ui\/?$/,
    "/workspace/ui/inspector",
  );
  return base.toString();
})();

/** A minimal Figma JSON_REST_V1 payload that satisfies the bootstrap hook. */
const MINIMAL_FIGMA_JSON = JSON.stringify({
  document: {
    id: "0:0",
    name: "Test Document",
    type: "DOCUMENT",
    children: [],
  },
  components: {},
  styles: {},
  name: "Test File",
  schemaVersion: 0,
});

const TEST_JOB_ID = "test-job-id";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Navigates directly to the inspector route at the given path suffix and
 * waits for the React app shell to be attached (body present).
 */
async function gotoInspector(page: Page, search = ""): Promise<void> {
  await page.setViewportSize(BOOTSTRAP_VIEWPORT);
  await page.goto(`${INSPECTOR_URL}${search}`);
  // Wait for the React app to mount: either bootstrap shell or panel outer.
  await page.waitForSelector(
    '[data-testid="inspector-bootstrap"], [data-testid="inspector-panel"]',
    { timeout: 15_000 },
  );
}

/**
 * Dispatches a synthetic paste event carrying `text` onto the hidden textarea
 * inside PasteCapture.  This bypasses the system clipboard so no special
 * browser permissions are needed.
 */
async function simulatePaste(page: Page, text: string): Promise<void> {
  const textarea = page.getByLabel("Figma JSON paste target");
  await expect(textarea).toBeAttached();
  // Focus the textarea so the component treats it as active.
  await textarea.focus();
  await page.evaluate((pasteText) => {
    const el = document.querySelector<HTMLTextAreaElement>(
      "textarea[aria-label], textarea",
    );
    // Find specifically the paste-capture textarea (sr-only, inside PasteCapture).
    const textareas = Array.from(
      document.querySelectorAll<HTMLTextAreaElement>("textarea"),
    );
    const target =
      textareas.find((t) => {
        const label = document.querySelector(`label[for="${t.id}"]`);
        return label?.textContent
          ?.toLowerCase()
          .includes("figma json paste target");
      }) ??
      textareas[0] ??
      el;
    if (!target) {
      throw new Error("Could not find PasteCapture textarea");
    }
    const dt = new DataTransfer();
    dt.setData("text", pasteText);
    dt.setData("text/plain", pasteText);
    const event = new ClipboardEvent("paste", {
      bubbles: true,
      cancelable: true,
      clipboardData: dt,
    });
    target.dispatchEvent(event);
  }, text);
}

/**
 * Installs route intercepts for the submit + job-poll lifecycle used in the
 * paste happy-path test.
 *
 * - POST /workspace/submit → 202 { jobId }
 * - GET  /workspace/jobs/:id  → queued → running → completed (with preview)
 */
async function installBootstrapRoutes(page: Page): Promise<void> {
  let pollCount = 0;

  await page.route("**/workspace/submit", async (route) => {
    if (route.request().method() !== "POST") {
      await route.continue();
      return;
    }
    await route.fulfill({
      status: 202,
      contentType: "application/json",
      body: JSON.stringify({ jobId: TEST_JOB_ID }),
    });
  });

  await page.route(`**/workspace/jobs/${TEST_JOB_ID}`, async (route) => {
    if (route.request().method() !== "GET") {
      await route.continue();
      return;
    }
    pollCount += 1;
    if (pollCount === 1) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ jobId: TEST_JOB_ID, status: "queued" }),
      });
      return;
    }
    if (pollCount === 2) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ jobId: TEST_JOB_ID, status: "running" }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        jobId: TEST_JOB_ID,
        status: "completed",
        preview: { enabled: true, url: "about:blank" },
      }),
    });
  });
}

/**
 * Installs route intercepts that make all artifact sub-resource fetches on the
 * given jobId return 500 immediately, preventing the panel from hanging.
 */
async function installDeepLinkArtifactRoutes(
  page: Page,
  jobId: string,
): Promise<void> {
  await page.route(`**/workspace/jobs/${jobId}/**`, async (route) => {
    await route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({ error: "INJECTED_FAILURE", message: "e2e stub" }),
    });
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe("inspector bootstrap flow", () => {
  test.describe.configure({ mode: "parallel" });

  test.afterEach(async ({ page }) => {
    await page.unroute("**/workspace/submit");
    await page.unroute(`**/workspace/jobs/${TEST_JOB_ID}`);
    await page.unroute("**/workspace/jobs/**");
    await resetBrowserStorage(page);
  });

  // -------------------------------------------------------------------------
  // TC-1: Direct entry renders bootstrap shell
  // -------------------------------------------------------------------------
  test("direct entry renders bootstrap shell and not the inspector panel", async ({
    page,
  }) => {
    // Arrange
    await gotoInspector(page);

    // Assert — bootstrap shell is present
    await expect(page.getByTestId("inspector-bootstrap")).toBeVisible();

    // Assert — the three placeholder columns are present
    await expect(page.getByTestId("inspector-bootstrap-left")).toBeVisible();
    await expect(page.getByTestId("inspector-bootstrap-center")).toBeVisible();
    await expect(page.getByTestId("inspector-bootstrap-right")).toBeVisible();

    // Assert — the full inspector panel layout is NOT present
    await expect(page.getByTestId("inspector-layout")).toHaveCount(0);
  });

  // -------------------------------------------------------------------------
  // TC-2: Paste starts job and hydrates to the inspector panel
  // -------------------------------------------------------------------------
  test("paste shows the banner, confirms import, and hydrates into inspector panel when job completes", async ({
    page,
  }) => {
    // Arrange: mock submit + job poll
    await installBootstrapRoutes(page);
    await gotoInspector(page);

    // Confirm bootstrap shell is visible before pasting
    await expect(page.getByTestId("inspector-bootstrap")).toBeVisible();

    // Act: simulate paste of a valid Figma JSON payload
    const submitResponsePromise = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        response.url().includes("/workspace/submit"),
    );

    await simulatePaste(page, MINIMAL_FIGMA_JSON);

    const banner = page.getByTestId("smart-banner");
    await expect(banner).toBeVisible({ timeout: 5_000 });
    await banner.getByRole("button", { name: "Import starten" }).click();

    // Wait for submit to complete (confirms the POST was sent with right mode)
    const submitResponse = await submitResponsePromise;
    expect(submitResponse.status()).toBe(202);

    // Verify the submitted payload carries figmaSourceMode: "figma_paste"
    const submittedBody = submitResponse.request().postDataJSON() as Record<
      string,
      unknown
    >;
    expect(submittedBody["figmaSourceMode"]).toBe("figma_paste");
    expect(typeof submittedBody["figmaJsonPayload"]).toBe("string");

    // Assert — panel hydrates once the job reaches completed
    await expect(page.getByTestId("inspector-layout")).toBeVisible({
      timeout: 20_000,
    });

    // Assert — bootstrap shell is gone after hydration
    await expect(page.getByTestId("inspector-bootstrap")).toHaveCount(0);

    // Assert — URL has not been updated with new query params (spec deferred URL update)
    const currentUrl = page.url();
    expect(currentUrl).not.toContain("jobId=");
  });

  // -------------------------------------------------------------------------
  // TC-3: 4xx failure shows inline error; no retry button for non-retryable error
  // -------------------------------------------------------------------------
  test("4xx submit response after confirm shows inline error and no retry button", async ({
    page,
  }) => {
    // Arrange: mock submit to return 400 SCHEMA_MISMATCH
    await page.route("**/workspace/submit", async (route) => {
      if (route.request().method() !== "POST") {
        await route.continue();
        return;
      }
      await route.fulfill({
        status: 400,
        contentType: "application/json",
        body: JSON.stringify({
          error: "SCHEMA_MISMATCH",
          message: "Payload does not match JSON_REST_V1 schema",
        }),
      });
    });

    await gotoInspector(page);
    await expect(page.getByTestId("inspector-bootstrap")).toBeVisible();

    // Act: paste valid JSON and confirm import
    await simulatePaste(page, MINIMAL_FIGMA_JSON);
    const banner = page.getByTestId("smart-banner");
    await expect(banner).toBeVisible({ timeout: 5_000 });
    await banner.getByRole("button", { name: "Import starten" }).click();

    // Assert — inline error message is displayed (role="alert" from PasteCapture)
    const errorAlert = page.locator('[role="alert"]').first();
    await expect(errorAlert).toBeVisible({ timeout: 10_000 });
    // The SCHEMA_MISMATCH message copy from InspectorBootstrap.getErrorMessage
    await expect(errorAlert).toContainText("schema");

    // Assert — the "Try again" button is NOT rendered (4xx is non-retryable per hook contract)
    await expect(page.getByRole("button", { name: "Try again" })).toHaveCount(
      0,
    );

    // Assert — still on the bootstrap shell, not the inspector panel
    await expect(page.getByTestId("inspector-bootstrap")).toBeVisible();
    await expect(page.getByTestId("inspector-layout")).toHaveCount(0);
  });

  // -------------------------------------------------------------------------
  // TC-4: Existing deep-link flow unchanged (regression guard)
  // -------------------------------------------------------------------------
  test("deep-link with jobId and previewUrl renders inspector panel without bootstrap shell", async ({
    page,
  }) => {
    const existingJobId = "existing-job";
    const previewUrl = "about:blank";

    // Arrange: stub all artifact sub-resource calls to fail quickly so the
    // panel does not hang waiting for real server responses.
    await installDeepLinkArtifactRoutes(page, existingJobId);

    // Act: navigate with both deep-link params set
    const search = `?jobId=${encodeURIComponent(existingJobId)}&previewUrl=${encodeURIComponent(previewUrl)}`;
    await gotoInspector(page, search);

    // Assert — the inspector panel outer container is present (deep-link path)
    await expect(page.getByTestId("inspector-panel")).toBeVisible({
      timeout: 15_000,
    });

    // Assert — the three-column layout div is present (always rendered by InspectorPanel)
    await expect(page.getByTestId("inspector-layout")).toBeVisible({
      timeout: 15_000,
    });

    // Assert — the bootstrap shell is NOT shown (regression guard)
    await expect(page.getByTestId("inspector-bootstrap")).toHaveCount(0);
  });

  // -------------------------------------------------------------------------
  // TC-5: Clipboard envelope paste shows banner and hydrates (#997)
  // -------------------------------------------------------------------------
  test("pasting a valid ClipboardEnvelope shows plugin-envelope banner, confirms, and hydrates", async ({
    page,
  }) => {
    await installBootstrapRoutes(page);
    await gotoInspector(page);
    await expect(page.getByTestId("inspector-bootstrap")).toBeVisible();

    const envelope = JSON.stringify({
      kind: "workspace-dev/figma-selection@1",
      pluginVersion: "0.1.0",
      copiedAt: "2026-04-12T18:00:00.000Z",
      selections: [
        {
          document: { id: "1:2", type: "FRAME", name: "Card" },
          components: {},
          componentSets: {},
          styles: {},
        },
      ],
    });

    const submitResponsePromise = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        response.url().includes("/workspace/submit"),
    );

    await simulatePaste(page, envelope);

    // Assert — the smart banner appears with the detected intent
    const banner = page.getByTestId("smart-banner");
    await expect(banner).toBeVisible({ timeout: 5_000 });

    // The banner should show the detected intent label for FIGMA_PLUGIN_ENVELOPE
    await expect(banner).toContainText("Plugin Export");

    // Confirm the import
    await banner.getByRole("button", { name: "Import starten" }).click();

    const submitResponse = await submitResponsePromise;
    expect(submitResponse.status()).toBe(202);

    // Verify the submitted payload carries the correct mode and intent
    const submittedBody = submitResponse.request().postDataJSON() as Record<
      string,
      unknown
    >;
    expect(submittedBody["figmaSourceMode"]).toBe("figma_paste");
    expect(submittedBody["importIntent"]).toBe("FIGMA_PLUGIN_ENVELOPE");
    expect(typeof submittedBody["figmaJsonPayload"]).toBe("string");

    // Assert — panel hydrates once the job reaches completed
    await expect(page.getByTestId("inspector-layout")).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByTestId("inspector-bootstrap")).toHaveCount(0);
  });

  // -------------------------------------------------------------------------
  // TC-6: Unknown envelope version shows clear error (#997)
  // -------------------------------------------------------------------------
  test("pasting an unknown envelope version falls through to document validation and shows error", async ({
    page,
  }) => {
    // Mock submit to return 400 (schema validation will reject the unknown envelope)
    await page.route("**/workspace/submit", async (route) => {
      if (route.request().method() !== "POST") {
        await route.continue();
        return;
      }
      await route.fulfill({
        status: 400,
        contentType: "application/json",
        body: JSON.stringify({
          error: "SCHEMA_MISMATCH",
          message:
            "figmaJsonPayload does not match expected schema: document must be an object.",
        }),
      });
    });

    await gotoInspector(page);
    await expect(page.getByTestId("inspector-bootstrap")).toBeVisible();

    const unknownEnvelope = JSON.stringify({
      kind: "workspace-dev/figma-selection@99",
      pluginVersion: "0.1.0",
      copiedAt: "2026-04-12T18:00:00.000Z",
      selections: [
        {
          document: { id: "1:2", type: "FRAME", name: "Card" },
          components: {},
          componentSets: {},
          styles: {},
        },
      ],
    });

    await simulatePaste(page, unknownEnvelope);

    // The unknown kind is not detected as envelope — falls through to
    // JSON document detection (has no `document` at root level as Figma doc).
    // The banner shows since it's valid JSON with some structure.
    const banner = page.getByTestId("smart-banner");
    await expect(banner).toBeVisible({ timeout: 5_000 });

    // Confirm the import — server will reject with SCHEMA_MISMATCH
    await banner.getByRole("button", { name: "Import starten" }).click();

    // Assert — inline error message is displayed
    const errorAlert = page.locator('[role="alert"]').first();
    await expect(errorAlert).toBeVisible({ timeout: 10_000 });
    await expect(errorAlert).toContainText("schema");

    // Assert — still on bootstrap shell
    await expect(page.getByTestId("inspector-bootstrap")).toBeVisible();
    await expect(page.getByTestId("inspector-layout")).toHaveCount(0);
  });
});
