/**
 * E2E tests for the Inspector bootstrap flow.
 *
 * Covers: direct entry rendering, paste-to-hydrate happy path, 4xx inline
 * error state, and regression guard for the existing deep-link path.
 */
import { expect, test, type Page } from "@playwright/test";
import {
  collectPreviewNodeIds,
  findFirstSyncedNodeId,
  getInspectorLocators,
  getInspectorUiUrl,
  getPrototypeNavigationPastePayload,
  getUnsupportedEnvelopePastePayload,
  openInspectorBootstrap,
  resetBrowserStorage,
  simulateInspectorPaste,
  withSubmissionRateLimit,
} from "./helpers";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const BOOTSTRAP_VIEWPORT = { width: 1920, height: 1080 } as const;
const INSPECTOR_URL = getInspectorUiUrl();

const PROTOTYPE_NAVIGATION_PASTE = getPrototypeNavigationPastePayload();
const UNSUPPORTED_ENVELOPE_PASTE = getUnsupportedEnvelopePastePayload();

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
  test.describe.configure({ mode: "serial", timeout: 180_000 });

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
    await page.route("**/workspace/submit", async (route) => {
      const request = route.request();
      if (request.method() !== "POST") {
        await route.continue();
        return;
      }

      const rawPayload = request.postDataJSON() as Record<string, unknown>;
      await route.continue({
        headers: {
          ...request.headers(),
          "content-type": "application/json",
        },
        postData: JSON.stringify({
          ...rawPayload,
          pipelineId: "rocket",
        }),
      });
    });

    await openInspectorBootstrap(page, BOOTSTRAP_VIEWPORT);

    // Confirm bootstrap shell is visible before pasting
    await expect(page.getByTestId("inspector-bootstrap")).toBeVisible();

    // Act: simulate paste of a real supported fixture payload and let the real
    // deterministic server flow own the submit/job/artifact lifecycle.
    const submitResponsePromise = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        response.url().includes("/workspace/submit"),
    );

    await simulateInspectorPaste(page, PROTOTYPE_NAVIGATION_PASTE);

    const banner = page.getByTestId("smart-banner");
    await expect(banner).toBeVisible({ timeout: 5_000 });
    await expect(banner).toContainText("Figma-Dokument JSON");
    await withSubmissionRateLimit(async () => {
      await banner.getByRole("button", { name: "Import starten" }).click();
    });

    // Wait for submit to complete (confirms the POST was sent with right mode)
    const submitResponse = await submitResponsePromise;
    expect(submitResponse.status()).toBe(202);

    // Verify the submitted payload carries figmaSourceMode: "figma_paste"
    const submittedBody = submitResponse.request().postDataJSON() as Record<
      string,
      unknown
    >;
    expect(submittedBody["figmaSourceMode"]).toBe("figma_paste");
    expect(submittedBody["pipelineId"]).toBe("rocket");
    expect(typeof submittedBody["figmaJsonPayload"]).toBe("string");

    const {
      inspectorPanel,
      componentTree,
      previewFrame,
      previewIframe,
      codeViewer,
      fileSelector,
    } = getInspectorLocators(page);

    await expect(inspectorPanel).toBeVisible({ timeout: 120_000 });
    await expect(page.getByTestId("inspector-layout")).toBeVisible({
      timeout: 120_000,
    });
    await expect(componentTree).toBeVisible();
    await expect(fileSelector).toBeVisible();
    await expect(fileSelector).toBeEnabled({ timeout: 120_000 });
    await expect(
      page.getByRole("link", { name: "Open preview in new tab" }),
    ).toBeVisible({ timeout: 120_000 });
    await expect(previewIframe).toBeVisible({ timeout: 30_000 });
    await expect(codeViewer).toBeVisible({ timeout: 30_000 });

    // Assert — bootstrap shell is gone after hydration
    await expect(page.getByTestId("inspector-bootstrap")).toHaveCount(0);

    const previewNodeIds = await collectPreviewNodeIds(previewFrame);
    expect(previewNodeIds.length).toBeGreaterThan(0);

    const syncedNodeId = await findFirstSyncedNodeId(page, previewNodeIds);
    expect(syncedNodeId).toBeTruthy();

    const fileOptionValues = await fileSelector.evaluate((select) => {
      return Array.from((select as HTMLSelectElement).options).map(
        (option) => option.value,
      );
    });
    const generatedAppFile = "src/App.tsx";
    expect(fileOptionValues).toContain(generatedAppFile);
    expect(fileOptionValues).toContain("src/theme/theme.ts");
    expect(fileOptionValues.some((value) => /tailwind/i.test(value))).toBe(
      false,
    );

    await fileSelector.selectOption(generatedAppFile);
    await expect(page.getByTestId("code-viewer-filepath")).toHaveText(
      generatedAppFile,
    );
    const codeContent = page.getByTestId("code-content");
    await expect(codeContent).toContainText("./screens/Home", {
      timeout: 30_000,
    });
    const appCode = (await codeContent.textContent()) ?? "";
    expect(appCode).toContain("./screens/Details");
    expect(appCode).not.toContain("tailwind");

    await expect(page.getByTestId("inspector-suggestions-host")).toBeVisible();
    await expect(page.getByTestId("suggestions-quality-score")).toBeVisible();
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
    await simulateInspectorPaste(page, PROTOTYPE_NAVIGATION_PASTE);
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

    await simulateInspectorPaste(page, envelope);

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
    expect(submittedBody["figmaSourceMode"]).toBe("figma_plugin");
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
  test("pasting an unknown envelope version shows a clear unsupported-version error", async ({
    page,
  }) => {
    await openInspectorBootstrap(page, BOOTSTRAP_VIEWPORT);
    await expect(page.getByTestId("inspector-bootstrap")).toBeVisible();

    const submitResponsePromise = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        response.url().includes("/workspace/submit"),
    );

    await simulateInspectorPaste(page, UNSUPPORTED_ENVELOPE_PASTE);

    // Unknown versions still surface as plugin envelopes so the server can
    // return a dedicated unsupported-version error instead of a generic schema
    // mismatch.
    const banner = page.getByTestId("smart-banner");
    await expect(banner).toBeVisible({ timeout: 5_000 });
    await expect(banner).toContainText("Plugin Export");

    // Confirm the import — the server should reject the unsupported envelope
    // version with a dedicated error.
    await withSubmissionRateLimit(async () => {
      await banner.getByRole("button", { name: "Import starten" }).click();
    });
    const submitResponse = await submitResponsePromise;
    expect(submitResponse.status()).toBe(400);

    // Assert — inline error message is displayed
    const errorAlert = page.locator('[role="alert"]').first();
    await expect(errorAlert).toBeVisible({ timeout: 10_000 });
    await expect(errorAlert).toContainText(
      "clipboard envelope version is not supported yet",
    );

    // Assert — still on bootstrap shell
    await expect(page.getByTestId("inspector-bootstrap")).toBeVisible();
    await expect(page.getByTestId("inspector-layout")).toHaveCount(0);
  });
});
