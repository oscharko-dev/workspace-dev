/**
 * E2E tests for paste/drop/upload import target in the Inspector bootstrap middle column.
 *
 * Covers: file drop/upload happy paths, unsupported file rejection, oversized file
 * rejection, empty paste, non-JSON paste, and drag-over visual state.
 */
import { expect, test, type Locator, type Page } from "@playwright/test";
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

/** 6 MiB — must match FIGMA_PASTE_MAX_BYTES in submit-schema.ts */
const FIGMA_PASTE_MAX_BYTES = 6 * 1024 * 1024;

const TEST_JOB_ID = "drop-test-job-id";
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
 * Asserts that no POST was made to /workspace/submit while performing the
 * guarded action.
 *
 * The request listener is installed before the action runs so a synchronous
 * submit fired during drop/paste cannot be missed.
 */
async function assertSubmitNotCalled(
  page: Page,
  action: () => Promise<void>,
): Promise<void> {
  const submitRequests: string[] = [];
  const requestListener = (req: { method(): string; url(): string }) => {
    if (req.method() === "POST" && req.url().includes("/workspace/submit")) {
      submitRequests.push(req.url());
    }
  };

  page.on("request", requestListener);
  try {
    await action();
    // Give the UI a moment to fire any pending requests before asserting.
    await page.waitForTimeout(500);
    expect(
      submitRequests,
      "Expected POST /workspace/submit NOT to be called, but it was.",
    ).toHaveLength(0);
  } finally {
    page.off("request", requestListener);
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe("inspector bootstrap — paste/drop/upload import target", () => {
  test.describe.configure({ mode: "serial", timeout: 180_000 });

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
      contents: PROTOTYPE_NAVIGATION_PASTE,
    });

    const banner = page.getByTestId("smart-banner");
    await expect(banner).toBeVisible({ timeout: 5_000 });
    await withSubmissionRateLimit(async () => {
      await banner.getByRole("button", { name: "Import starten" }).click();
    });

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
      timeout: 120_000,
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
    await gotoInspector(page);

    const submitResponsePromise = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        response.url().includes("/workspace/submit"),
    );

    await uploadFile(page, {
      name: "figma-export.json",
      type: "application/json",
      contents: PROTOTYPE_NAVIGATION_PASTE,
    });

    const banner = page.getByTestId("smart-banner");
    await expect(banner).toBeVisible({ timeout: 5_000 });
    await withSubmissionRateLimit(async () => {
      await banner.getByRole("button", { name: "Import starten" }).click();
    });

    const submitResponse = await submitResponsePromise;
    expect(submitResponse.status()).toBe(202);

    const submittedBody = submitResponse.request().postDataJSON() as Record<
      string,
      unknown
    >;
    expect(submittedBody["figmaSourceMode"]).toBe("figma_paste");
    expect(typeof submittedBody["figmaJsonPayload"]).toBe("string");

    await expect(page.getByTestId("inspector-layout")).toBeVisible({
      timeout: 120_000,
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
    await assertSubmitNotCalled(page, async () => {
      await dropFile(pasteArea, {
        name: "design.png",
        type: "image/png",
        contents: "PNG_BINARY_DATA",
      });
    });

    // Assert — inline alert with "Unsupported file" error copy
    const alert = page.locator('[role="alert"]').first();
    await expect(alert).toBeVisible({ timeout: 5_000 });
    await expect(alert).toContainText(/unsupported file/i);

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
    await assertSubmitNotCalled(page, async () => {
      await dropFile(pasteArea, {
        name: "figma-huge.json",
        type: "application/json",
        contents: sevenMibContents,
      });
    });

    // Assert — inline alert mentioning the 6 MiB limit
    const alert = page.locator('[role="alert"]').first();
    await expect(alert).toBeVisible({ timeout: 5_000 });
    await expect(alert).toContainText(/6 MiB/);

  });

  // -------------------------------------------------------------------------
  // TC-4: Empty paste (whitespace-only)
  // -------------------------------------------------------------------------
  test("uploading JSON and receiving UNSUPPORTED_FORMAT shows the inline envelope error", async ({
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
        body: JSON.stringify({ error: "UNSUPPORTED_FORMAT" }),
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
      contents: PROTOTYPE_NAVIGATION_PASTE,
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
    await assertSubmitNotCalled(page, async () => {
      await simulateInspectorPaste(page, "   ");
    });

    // Assert — inline alert with the EMPTY_INPUT copy
    const alert = page.locator('[role="alert"]').first();
    await expect(alert).toBeVisible({ timeout: 5_000 });
    await expect(alert).toContainText(
      /please paste, drop, or upload a figma json export/i,
    );

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
    await assertSubmitNotCalled(page, async () => {
      await simulateInspectorPaste(page, "hello");
    });

    const banner = page.getByTestId("smart-banner");
    await expect(banner).toBeVisible({ timeout: 5_000 });
    await expect(banner).toContainText("Code / Text");

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
