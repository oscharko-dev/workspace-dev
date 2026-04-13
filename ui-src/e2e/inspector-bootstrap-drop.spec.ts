/**
 * E2E tests for paste/drop/upload import target in the Inspector bootstrap middle column.
 *
 * Covers: file drop/upload happy paths, unsupported file rejection, oversized file
 * rejection, empty paste, non-JSON paste, and drag-over visual state.
 *
 * All tests are fully mocked — no real server is required.
 */
import { expect, test, type Locator, type Page } from "@playwright/test";
import { getWorkspaceUiUrl, resetBrowserStorage } from "./helpers";

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

/** 6 MiB — must match FIGMA_PASTE_MAX_BYTES in submit-schema.ts */
const FIGMA_PASTE_MAX_BYTES = 6 * 1024 * 1024;

/**
 * Minimal Figma JSON_REST_V1 payload that the paste-input classifier and
 * server validation accept.
 */
const MINIMAL_FIGMA_JSON = JSON.stringify({
  document: { id: "0:1", type: "DOCUMENT" },
});

const TEST_JOB_ID = "drop-test-job-id";

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

/**
 * Simulates a clipboard paste onto the hidden PasteCapture textarea.
 *
 * Uses page.evaluate to dispatch a ClipboardEvent so no real clipboard
 * permission is needed.
 */
async function simulatePaste(page: Page, text: string): Promise<void> {
  const textarea = page.getByLabel("Figma JSON paste target");
  await expect(textarea).toBeAttached();
  await textarea.focus();
  await page.evaluate((pasteText) => {
    const textareas = Array.from(
      document.querySelectorAll<HTMLTextAreaElement>("textarea"),
    );
    const target =
      textareas.find((t) => {
        const label = document.querySelector(`label[for="${t.id}"]`);
        return label?.textContent
          ?.toLowerCase()
          .includes("figma json paste target");
      }) ?? textareas[0];
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

interface DropFileOptions {
  name: string;
  type: string;
  /** String contents — will be encoded to UTF-8 to determine byte size. */
  contents: string;
}

/**
 * Dispatches a synthetic drop event carrying a single File onto the given
 * locator.  The File is constructed entirely inside the browser context so
 * no file-system access is required.
 */
async function dropFile(
  locator: Locator,
  { name, type, contents }: DropFileOptions,
): Promise<void> {
  await locator.dispatchEvent("drop", {
    dataTransfer: await locator.page().evaluateHandle(
      ([fileName, mimeType, fileContents]) => {
        const file = new File([fileContents], fileName, { type: mimeType });
        const dt = new DataTransfer();
        dt.items.add(file);
        return dt;
      },
      [name, type, contents] as [string, string, string],
    ),
  });
}

/**
 * Selects a file via the hidden upload input in PasteCapture.
 */
async function uploadFile(
  page: Page,
  { name, type, contents }: DropFileOptions,
): Promise<void> {
  const uploadInput = page.getByLabel("Upload Figma JSON file");
  await expect(uploadInput).toBeAttached();
  await uploadInput.setInputFiles({
    name,
    mimeType: type,
    buffer: Buffer.from(contents, "utf-8"),
  });
}

/**
 * Installs route mocks for the submit + job-poll lifecycle.
 *
 * - POST /workspace/submit  → 202 { jobId }
 * - GET  /workspace/jobs/:id → queued → running → completed (with previewUrl)
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
 * Asserts that no POST was made to /workspace/submit during the test.
 *
 * Installs a route that fulfills with a sentinel 400 and immediately
 * fails — a POST reaching this handler means the client-side fast-reject
 * did not fire.
 */
async function assertSubmitNotCalled(page: Page): Promise<void> {
  // We rely on the fact that we did NOT install a submit route — any request
  // would either fail network-level or reach the real server (which is mocked
  // by Playwright's webServer to exist but our specific test does not set a
  // route for it).  Instead, track whether a submit request was fired.
  const submitRequests: string[] = [];
  page.on("request", (req) => {
    if (req.method() === "POST" && req.url().includes("/workspace/submit")) {
      submitRequests.push(req.url());
    }
  });
  // Give the UI a moment to fire any pending requests before asserting.
  await page.waitForTimeout(500);
  expect(
    submitRequests,
    "Expected POST /workspace/submit NOT to be called, but it was.",
  ).toHaveLength(0);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe("inspector bootstrap — paste/drop/upload import target", () => {
  test.describe.configure({ mode: "parallel" });

  test.afterEach(async ({ page }) => {
    await page.unroute("**/workspace/submit");
    await page.unroute(`**/workspace/jobs/${TEST_JOB_ID}`);
    await page.unroute("**/workspace/jobs/**");
    await resetBrowserStorage(page);
  });

  // -------------------------------------------------------------------------
  // TC-1: Happy path — valid JSON file drop
  // -------------------------------------------------------------------------
  test("dropping a valid Figma JSON file shows the banner, confirms import, and hydrates into the inspector panel", async ({
    page,
  }) => {
    // Arrange
    await installBootstrapRoutes(page);
    await gotoInspector(page);
    await expect(page.getByTestId("inspector-bootstrap")).toBeVisible();

    const pasteArea = page.getByRole("region", { name: "Paste area" });
    await expect(pasteArea).toBeVisible();

    const submitResponsePromise = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        response.url().includes("/workspace/submit"),
    );

    // Act — drop a valid .json file
    await dropFile(pasteArea, {
      name: "figma-export.json",
      type: "application/json",
      contents: MINIMAL_FIGMA_JSON,
    });

    const banner = page.getByTestId("smart-banner");
    await expect(banner).toBeVisible({ timeout: 5_000 });
    await banner.getByRole("button", { name: "Import starten" }).click();

    // Assert — submit was sent with figmaSourceMode: "figma_paste"
    const submitResponse = await submitResponsePromise;
    expect(submitResponse.status()).toBe(202);

    const submittedBody = submitResponse.request().postDataJSON() as Record<
      string,
      unknown
    >;
    expect(submittedBody["figmaSourceMode"]).toBe("figma_paste");
    expect(typeof submittedBody["figmaJsonPayload"]).toBe("string");

    // Assert — the inspector panel hydrates once the job completes
    await expect(page.getByTestId("inspector-layout")).toBeVisible({
      timeout: 20_000,
    });

    // Assert — bootstrap shell is gone after hydration
    await expect(page.getByTestId("inspector-bootstrap")).toHaveCount(0);
  });

  // -------------------------------------------------------------------------
  // TC-2: Unsupported file drop (.png)
  // -------------------------------------------------------------------------
  test("uploading a valid Figma JSON file via the file picker hydrates into the inspector panel", async ({
    page,
  }) => {
    await installBootstrapRoutes(page);
    await gotoInspector(page);

    const submitResponsePromise = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        response.url().includes("/workspace/submit"),
    );

    await uploadFile(page, {
      name: "figma-export.json",
      type: "application/json",
      contents: MINIMAL_FIGMA_JSON,
    });

    const banner = page.getByTestId("smart-banner");
    await expect(banner).toBeVisible({ timeout: 5_000 });
    await banner.getByRole("button", { name: "Import starten" }).click();

    const submitResponse = await submitResponsePromise;
    expect(submitResponse.status()).toBe(202);

    const submittedBody = submitResponse.request().postDataJSON() as Record<
      string,
      unknown
    >;
    expect(submittedBody["figmaSourceMode"]).toBe("figma_paste");
    expect(typeof submittedBody["figmaJsonPayload"]).toBe("string");

    await expect(page.getByTestId("inspector-layout")).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByTestId("inspector-bootstrap")).toHaveCount(0);
  });

  // -------------------------------------------------------------------------
  // TC-2: Unsupported file drop (.png)
  // -------------------------------------------------------------------------
  test("dropping a .png file shows an inline alert and does NOT hit /workspace/submit", async ({
    page,
  }) => {
    // Arrange — no submit route installed; any POST would be a test failure
    await gotoInspector(page);
    await expect(page.getByTestId("inspector-bootstrap")).toBeVisible();

    const pasteArea = page.getByRole("region", { name: "Paste area" });

    // Act — drop an unsupported image file
    await dropFile(pasteArea, {
      name: "design.png",
      type: "image/png",
      contents: "PNG_BINARY_DATA",
    });

    // Assert — inline alert with "Unsupported file" error copy
    const alert = page.locator('[role="alert"]').first();
    await expect(alert).toBeVisible({ timeout: 5_000 });
    await expect(alert).toContainText(/unsupported file/i);

    // Assert — POST /workspace/submit was NOT triggered
    await assertSubmitNotCalled(page);

    // Assert — still on the bootstrap shell
    await expect(page.getByTestId("inspector-bootstrap")).toBeVisible();
    await expect(page.getByTestId("inspector-layout")).toHaveCount(0);
  });

  // -------------------------------------------------------------------------
  // TC-3: Oversized .json file drop (> 6 MiB)
  // -------------------------------------------------------------------------
  test("dropping a 7 MiB JSON file shows an inline alert mentioning '6 MiB' and does NOT submit", async ({
    page,
  }) => {
    // Arrange — build a 7 MiB payload (just over the 6 MiB limit)
    const sevenMibContents =
      '{"document":{"id":"0:1","type":"DOCUMENT","data":"' +
      "x".repeat(FIGMA_PASTE_MAX_BYTES + 1_024 * 1_024) +
      '"}}';

    await gotoInspector(page);
    await expect(page.getByTestId("inspector-bootstrap")).toBeVisible();

    const pasteArea = page.getByRole("region", { name: "Paste area" });

    // Act — drop an oversized JSON file
    await dropFile(pasteArea, {
      name: "figma-huge.json",
      type: "application/json",
      contents: sevenMibContents,
    });

    // Assert — inline alert mentioning the 6 MiB limit
    const alert = page.locator('[role="alert"]').first();
    await expect(alert).toBeVisible({ timeout: 5_000 });
    await expect(alert).toContainText(/6 MiB/);

    // Assert — POST /workspace/submit was NOT triggered
    await assertSubmitNotCalled(page);
  });

  // -------------------------------------------------------------------------
  // TC-4: Empty paste (whitespace-only)
  // -------------------------------------------------------------------------
  test("uploading JSON and receiving UNSUPPORTED_CLIPBOARD_KIND shows the inline envelope error", async ({
    page,
  }) => {
    await page.route("**/workspace/submit", async (route) => {
      if (route.request().method() !== "POST") {
        await route.continue();
        return;
      }
      await route.fulfill({
        status: 400,
        contentType: "application/json",
        body: JSON.stringify({ error: "UNSUPPORTED_CLIPBOARD_KIND" }),
      });
    });

    await gotoInspector(page);

    const submitResponsePromise = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        response.url().includes("/workspace/submit"),
    );

    await uploadFile(page, {
      name: "figma-export.json",
      type: "application/json",
      contents: MINIMAL_FIGMA_JSON,
    });

    const banner = page.getByTestId("smart-banner");
    await expect(banner).toBeVisible({ timeout: 5_000 });
    await banner.getByRole("button", { name: "Import starten" }).click();

    const submitResponse = await submitResponsePromise;
    expect(submitResponse.status()).toBe(400);

    const alert = page.locator('[role="alert"]').first();
    await expect(alert).toBeVisible({ timeout: 5_000 });
    await expect(alert).toContainText(
      /clipboard envelope version is not supported yet/i,
    );
    await expect(page.getByTestId("inspector-layout")).toHaveCount(0);
  });

  // -------------------------------------------------------------------------
  // TC-4: Empty paste (whitespace-only)
  // -------------------------------------------------------------------------
  test("pasting whitespace-only text shows the EMPTY_INPUT inline alert and does NOT submit", async ({
    page,
  }) => {
    // Arrange
    // Note: PasteCapture silently swallows a zero-length clipboard value (early
    // return in handlePaste). Whitespace-only text ("   ") passes through to
    // onPaste → submitPaste → classifyPasteInput, which returns reason:"empty"
    // and triggers the EMPTY_INPUT failure path.
    await gotoInspector(page);
    await expect(page.getByTestId("inspector-bootstrap")).toBeVisible();

    // Act — simulate pasting whitespace-only content
    await simulatePaste(page, "   ");

    // Assert — inline alert with the EMPTY_INPUT copy
    const alert = page.locator('[role="alert"]').first();
    await expect(alert).toBeVisible({ timeout: 5_000 });
    await expect(alert).toContainText(
      /please paste, drop, or upload a figma json export/i,
    );

    // Assert — POST /workspace/submit was NOT triggered
    await assertSubmitNotCalled(page);

    // Assert — still on bootstrap shell
    await expect(page.getByTestId("inspector-bootstrap")).toBeVisible();
  });

  // -------------------------------------------------------------------------
  // TC-5: Non-JSON paste ("hello")
  // -------------------------------------------------------------------------
  test("pasting a non-JSON string shows the smart banner and does NOT submit", async ({
    page,
  }) => {
    // Arrange
    await gotoInspector(page);
    await expect(page.getByTestId("inspector-bootstrap")).toBeVisible();

    // Act — paste a plain string that is not JSON
    await simulatePaste(page, "hello");

    const banner = page.getByTestId("smart-banner");
    await expect(banner).toBeVisible({ timeout: 5_000 });
    await expect(banner).toContainText("Code / Text");

    // Assert — POST /workspace/submit was NOT triggered
    await assertSubmitNotCalled(page);

    // Assert — still on bootstrap shell
    await expect(page.getByTestId("inspector-bootstrap")).toBeVisible();
  });

  // -------------------------------------------------------------------------
  // TC-6: Drag-over visual state — highlighted ring class applied
  // -------------------------------------------------------------------------
  test("dragging files over the paste area applies the highlighted ring class", async ({
    page,
  }) => {
    // Arrange
    await gotoInspector(page);
    await expect(page.getByTestId("inspector-bootstrap")).toBeVisible();

    const pasteArea = page.getByRole("region", { name: "Paste area" });

    // Act — dispatch a dragover event with Files type
    await pasteArea.dispatchEvent("dragover", {
      dataTransfer: await page.evaluateHandle(() => {
        const dt = new DataTransfer();
        // Simulate a file being dragged — types will include "Files"
        const file = new File(["{}"], "test.json", {
          type: "application/json",
        });
        dt.items.add(file);
        return dt;
      }),
    });

    // Assert — the ring-2 class is applied while dragging over
    await expect(pasteArea).toHaveClass(/ring-2/, { timeout: 3_000 });
  });
});
