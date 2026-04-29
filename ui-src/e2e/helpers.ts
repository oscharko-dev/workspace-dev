import { readFileSync } from "node:fs";
import { open, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import { expect, type FrameLocator, type Locator, type Page } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";

export interface ViewportSize {
  width: number;
  height: number;
}

export interface InspectorLocators {
  inspectorPanel: Locator;
  componentTree: Locator;
  previewFrame: FrameLocator;
  previewIframe: Locator;
  codeViewer: Locator;
  fileSelector: Locator;
}

export type InspectorDialogLabel = "Review" | "Sync" | "PR" | "Coverage";

const configuredUiUrl = process.env.WORKSPACE_DEV_UI_URL?.trim();
const configuredRuntimeBaseUrl = process.env.WORKSPACE_DEV_RUNTIME_BASE_URL?.trim();
const configuredPort = Number.parseInt(process.env.WORKSPACE_DEV_E2E_PORT?.trim() ?? "", 10);
const defaultPort = Number.isFinite(configuredPort) && configuredPort > 0 ? configuredPort : 19831;
const runtimeBaseUrl = configuredRuntimeBaseUrl ?? `http://127.0.0.1:${String(defaultPort)}`;
const UI_URL = configuredUiUrl ?? `${runtimeBaseUrl}/workspace/ui`;
const INSPECTOR_URL = (() => {
  const base = new URL(UI_URL);
  base.pathname = base.pathname.replace(/\/workspace\/ui\/?$/, "/workspace/ui/inspector");
  return base.toString();
})();
const FIXTURE_PATH = path.resolve(
  fileURLToPath(new URL("../../src/parity/fixtures/golden/rocket/prototype-navigation/figma.json", import.meta.url))
);
const UNSUPPORTED_ENVELOPE_FIXTURE_PATH = path.resolve(
  fileURLToPath(
    new URL(
      "../../integration/fixtures/figma-paste-pipeline/envelopes/unsupported-version-envelope.json",
      import.meta.url
    )
  )
);
const PROTOTYPE_NAVIGATION_PASTE_PAYLOAD = readFileSync(FIXTURE_PATH, "utf8");
const UNSUPPORTED_ENVELOPE_PASTE_PAYLOAD = readFileSync(UNSUPPORTED_ENVELOPE_FIXTURE_PATH, "utf8");
const TERMINAL_STATUS_PATTERN = /^(COMPLETED|FAILED|CANCELED)$/;
const TERMINAL_STATUS_CAPTURE_PATTERN = /Submit:\s*(COMPLETED|FAILED|CANCELED)/i;
const JOB_COMPLETED_PATTERN = /completed successfully/i;
const JOB_FAILED_PATTERN = /\bfailed\b/i;
const JOB_CANCELED_PATTERN = /\bcanceled\b/i;
const submittedJobIds = new WeakMap<Page, string>();

export interface LiveJobPayload {
  jobId?: string;
  status?: string;
  error?: {
    code?: string;
    message?: string;
    stage?: string;
  };
}

export function parseLiveJobPayload(raw: string | null | undefined): LiveJobPayload | null {
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    return parsed as LiveJobPayload;
  } catch {
    return null;
  }
}

function isJsonRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function extractSubmitJobId(value: unknown): string | null {
  if (!isJsonRecord(value)) {
    return null;
  }
  if (typeof value.jobId === "string" && value.jobId.trim().length > 0) {
    return value.jobId;
  }
  if (isJsonRecord(value.payload) && typeof value.payload.jobId === "string" && value.payload.jobId.trim().length > 0) {
    return value.payload.jobId;
  }
  return null;
}

function extractJobIdFromPreviewUrl(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  const match = value.match(/\/workspace\/repros\/([^/]+)\//);
  return match?.[1] ? decodeURIComponent(match[1]) : null;
}

async function resolveCurrentSubmittedJobId(page: Page): Promise<string | null> {
  const jobPayloadLocator = page.getByTestId("job-payload");
  if ((await jobPayloadLocator.count()) > 0) {
    const payload = parseLiveJobPayload(await jobPayloadLocator.textContent({ timeout: 100 }).catch(() => null));
    if (typeof payload?.jobId === "string" && payload.jobId.trim().length > 0) {
      return payload.jobId;
    }
  }

  const previewHref = await page
    .getByRole("link", { name: /open runtime preview|preview/i })
    .first()
    .getAttribute("href", { timeout: 100 })
    .catch(() => null);
  return extractJobIdFromPreviewUrl(previewHref);
}

async function fetchSubmittedJobStatus(page: Page): Promise<string | null> {
  const currentJobId = await resolveCurrentSubmittedJobId(page);
  if (currentJobId) {
    submittedJobIds.set(page, currentJobId);
  }

  const jobId = currentJobId ?? submittedJobIds.get(page);
  if (!jobId) {
    return null;
  }

  const statusResponse = await page.request
    .get(`${runtimeBaseUrl}/workspace/jobs/${encodeURIComponent(jobId)}`)
    .catch(() => null);
  if (!statusResponse?.ok()) {
    return null;
  }

  const payload = (await statusResponse.json().catch(() => null)) as unknown;
  if (!isJsonRecord(payload) || typeof payload.status !== "string") {
    return null;
  }

  const status = payload.status.toUpperCase();
  return TERMINAL_STATUS_PATTERN.test(status) ? status : null;
}

const SUBMIT_ENDPOINT_SUFFIX = "/workspace/submit";
const SUBMISSION_LOCK_PATH = path.join(os.tmpdir(), "workspace-dev-playwright-submit.lock");
const SUBMISSION_TIMESTAMP_PATH = path.join(
  os.tmpdir(),
  "workspace-dev-playwright-submit.timestamp"
);
const SUBMISSION_SPACING_MS = 10_000;
const SUBMISSION_LOCK_STALE_MS = 60_000;

/**
 * Returns the workspace UI URL used by Playwright E2E tests.
 */
export function getWorkspaceUiUrl(): string {
  return UI_URL;
}

/**
 * Returns the direct inspector bootstrap URL used by inspector-specific E2E tests.
 */
export function getInspectorUiUrl(): string {
  return INSPECTOR_URL;
}

/**
 * Returns the deterministic paste payload used for the supported real bootstrap flow.
 */
export function getPrototypeNavigationPastePayload(): string {
  return PROTOTYPE_NAVIGATION_PASTE_PAYLOAD;
}

/**
 * Returns an unsupported plugin-envelope payload for real bootstrap error coverage.
 */
export function getUnsupportedEnvelopePastePayload(): string {
  return UNSUPPORTED_ENVELOPE_PASTE_PAYLOAD;
}

async function delay(ms: number): Promise<void> {
  await new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function acquireSubmissionSlot(): Promise<() => Promise<void>> {
  while (true) {
    try {
      const lockHandle = await open(SUBMISSION_LOCK_PATH, "wx");
      let waitMs = 0;

      try {
        const previousTimestamp = Number.parseInt(
          await readFile(SUBMISSION_TIMESTAMP_PATH, "utf8"),
          10
        );
        if (Number.isFinite(previousTimestamp)) {
          waitMs = Math.max(0, SUBMISSION_SPACING_MS - (Date.now() - previousTimestamp));
        }
      } catch {
        // No previous submission timestamp recorded yet.
      }

      if (waitMs > 0) {
        await delay(waitMs);
      }

      return async () => {
        await writeFile(SUBMISSION_TIMESTAMP_PATH, String(Date.now()), "utf8");
        await lockHandle.close();
        await rm(SUBMISSION_LOCK_PATH, { force: true });
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
        throw error;
      }
      try {
        const lockStats = await stat(SUBMISSION_LOCK_PATH);
        if (Date.now() - lockStats.mtimeMs > SUBMISSION_LOCK_STALE_MS) {
          await rm(SUBMISSION_LOCK_PATH, { force: true });
          continue;
        }
      } catch {
        // Lock disappeared between attempts.
      }
      await delay(250);
    }
  }
}

/**
 * Serializes real submit requests across Playwright workers and projects.
 *
 * The server enforces a rate limit on /workspace/submit, so real deterministic
 * flows need spacing when the matrix is running in parallel.
 */
export async function withSubmissionRateLimit<T>(callback: () => Promise<T>): Promise<T> {
  const release = await acquireSubmissionSlot();
  try {
    return await callback();
  } finally {
    await release();
  }
}

/**
 * Installs a clipboard mock so copy actions can be asserted deterministically.
 */
export async function installClipboardMock(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const clipboard = {
      writeText: async (): Promise<void> => {
        return;
      }
    };
    Object.defineProperty(navigator, "clipboard", {
      value: clipboard,
      configurable: true
    });
  });
}

/**
 * Rewrites submit requests to deterministic local-fixture execution.
 */
export async function setupDeterministicSubmitRoute(page: Page): Promise<void> {
  await page.route("**/workspace/submit", async (route) => {
    const request = route.request();
    if (request.method() !== "POST") {
      await route.continue();
      return;
    }

    const rawPayload = request.postDataJSON() as Record<string, unknown>;
    const rewrittenPayload: Record<string, unknown> = {
      ...rawPayload,
      figmaSourceMode: "local_json",
      figmaJsonPath: FIXTURE_PATH,
      llmCodegenMode: "deterministic",
      enableGitPr: false
    };
    delete rewrittenPayload.figmaFileKey;
    delete rewrittenPayload.figmaAccessToken;

    await route.continue({
      headers: {
        ...request.headers(),
        "content-type": "application/json"
      },
      postData: JSON.stringify(rewrittenPayload)
    });
  });
}

/**
 * Removes the deterministic submit route installed by setupDeterministicSubmitRoute.
 */
export async function cleanupDeterministicSubmitRoute(page: Page): Promise<void> {
  await page.unroute("**/workspace/submit");
}

/**
 * Opens the workspace UI at a requested viewport and validates the shell heading.
 */
export async function openWorkspaceUi(page: Page, viewport: ViewportSize): Promise<void> {
  await page.setViewportSize(viewport);
  await page.goto(UI_URL);
  await expect(page.getByRole("heading", { name: "Workspace Dev" })).toBeVisible();
}

/**
 * Opens the inspector bootstrap route and waits for the bootstrap shell to mount.
 */
export async function openInspectorBootstrap(page: Page, viewport: ViewportSize): Promise<void> {
  await page.setViewportSize(viewport);
  await page.goto(INSPECTOR_URL);
  await expect(page.getByTestId("inspector-bootstrap")).toBeVisible();
}

/**
 * Dispatches a synthetic paste event onto the hidden inspector paste target.
 *
 * This bypasses system clipboard permissions while still exercising the real
 * bootstrap paste ingestion path.
 */
export async function simulateInspectorPaste(page: Page, text: string): Promise<void> {
  const pasteArea = page.getByRole("region", { name: "Paste area" });
  await expect(pasteArea).toBeVisible();
  await page.evaluate((pasteText) => {
    const textareas = Array.from(document.querySelectorAll<HTMLTextAreaElement>("textarea"));
    const target =
      textareas.find((candidate) => {
        const label = document.querySelector(`label[for="${candidate.id}"]`);
        const labelText = label?.textContent?.toLowerCase() ?? "";
        return labelText.includes("figma json paste target") || labelText.includes("figma clipboard paste target");
      }) ?? textareas[0];

    if (!target) {
      throw new Error("Could not find PasteCapture textarea");
    }

    target.focus();
    const clipboardData = {
      dropEffect: "copy",
      effectAllowed: "all",
      files: [],
      items: [],
      types: ["text", "text/plain"],
      getData(format: string): string {
        return format === "text" || format === "text/plain" ? pasteText : "";
      },
      setData(): void {
        // Read-only test shim for paste listeners.
      }
    };
    const event = new Event("paste", {
      bubbles: true,
      cancelable: true
    });
    Object.defineProperty(event, "clipboardData", {
      configurable: true,
      enumerable: true,
      value: clipboardData
    });
    target.dispatchEvent(event);
  }, text);
}

/**
 * Triggers a deterministic generation request and asserts that submit responds successfully.
 */
export async function triggerDeterministicGeneration(page: Page): Promise<void> {
  await withSubmissionRateLimit(async () => {
    const submitResponsePromise = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        response.url().endsWith(SUBMIT_ENDPOINT_SUFFIX)
    );

    await page.getByLabel("Figma file key").fill("fixture-key");
    await page.getByLabel("Figma access token").fill("fixture-token");
    await page.getByRole("banner").getByRole("button", { name: "Generate" }).click();

    const submitResponse = await submitResponsePromise;
    expect(
      submitResponse.ok(),
      `Expected submit response to be successful, but got HTTP ${submitResponse.status()}`
    ).toBeTruthy();

    const submitPayload = (await submitResponse.json().catch(() => null)) as unknown;
    const jobId = extractSubmitJobId(submitPayload);
    if (jobId) {
      submittedJobIds.set(page, jobId);
    }
  });
}

/**
 * Waits until the submit status reaches any terminal state.
 */
export async function waitForSubmitTerminalStatus(
  page: Page,
  options?: { timeoutMs?: number }
): Promise<string> {
  const timeoutMs = options?.timeoutMs ?? 120_000;
  const runtimeCard = page.getByTestId("runtime-card");
  const intervalsMs = [500, 1_000, 2_000] as const;
  const startedAt = Date.now();
  let intervalIndex = 0;

  while (Date.now() - startedAt <= timeoutMs) {
    const apiStatus = await fetchSubmittedJobStatus(page);
    if (apiStatus) {
      return apiStatus;
    }

    const runtimeCardText = (await runtimeCard.textContent())?.replace(/\s+/g, " ").trim() ?? "";
    const match = runtimeCardText.match(TERMINAL_STATUS_CAPTURE_PATTERN);
    const status = match?.[1]?.toUpperCase() ?? "";

    if (TERMINAL_STATUS_PATTERN.test(status)) {
      return status;
    }

    const openInspectorButton = page.getByRole("button", { name: "Open Inspector" });
    if ((await openInspectorButton.count()) > 0 && await openInspectorButton.isVisible().catch(() => false)) {
      return "COMPLETED";
    }

    const jobStatusText = (await page.getByTestId("job-status-card").textContent())?.replace(/\s+/g, " ").trim() ?? "";
    if (JOB_COMPLETED_PATTERN.test(jobStatusText)) {
      return "COMPLETED";
    }
    if (JOB_FAILED_PATTERN.test(jobStatusText)) {
      return "FAILED";
    }
    if (JOB_CANCELED_PATTERN.test(jobStatusText)) {
      return "CANCELED";
    }

    // Fall back to inspecting the job-payload element directly so that failures
    // that surface an error object (e.g. E_FIGMA_LOW_FIDELITY_SOURCE) or a
    // terminal status without updating the UI text are detected immediately
    // instead of looping until the Playwright timeout is reached.
    const jobPayloadLocator = page.getByTestId("job-payload");
    const jobPayloadText =
      (await jobPayloadLocator.count()) > 0
        ? await jobPayloadLocator.textContent({ timeout: 100 }).catch(() => null)
        : null;
    const jobPayload = parseLiveJobPayload(jobPayloadText);
    const payloadStatus = jobPayload?.status?.toLowerCase();
    if (payloadStatus === "completed") {
      return "COMPLETED";
    }
    if (payloadStatus === "failed" || jobPayload?.error !== undefined) {
      return "FAILED";
    }
    if (payloadStatus === "canceled") {
      return "CANCELED";
    }

    const waitMs = intervalsMs[Math.min(intervalIndex, intervalsMs.length - 1)] ?? 2_000;
    intervalIndex += 1;
    await page.waitForTimeout(waitMs);
  }

  throw new Error(`Timed out waiting for terminal submit status after ${String(timeoutMs)}ms.`);
}

/**
 * Waits until the submit status reaches a terminal state and requires COMPLETED.
 */
export async function waitForCompletedSubmitStatus(
  page: Page,
  options?: { timeoutMs?: number }
): Promise<void> {
  const terminalStatus = await waitForSubmitTerminalStatus(page, options);
  expect(terminalStatus, `Expected deterministic flow to complete, but terminal status was ${terminalStatus}`).toBe(
    "COMPLETED"
  );
}

/**
 * Opens the Inspector from the workspace shell once a generation has completed.
 */
export async function openInspector(page: Page): Promise<void> {
  if (page.url().includes("/workspace/ui/inspector")) {
    await expect(page.getByTestId("inspector-panel")).toBeVisible();
    return;
  }

  const openInspectorButton = page.getByRole("button", { name: "Open Inspector" });
  await expect(openInspectorButton).toBeVisible({ timeout: 30_000 });
  await openInspectorButton.click();
  await expect(page).toHaveURL(/\/workspace\/ui\/inspector/);
  await expect(page.getByTestId("inspector-panel")).toBeVisible();
}

/**
 * Expands a collapsible workspace diagnostics section when its payload is hidden.
 */
export async function ensureWorkspaceDiagnosticsVisible(
  page: Page,
  options: {
    buttonLabel: "Runtime diagnostics" | "Job diagnostics";
    payloadTestId: "runtime-payload" | "job-payload";
  }
): Promise<Locator> {
  const payload = page.getByTestId(options.payloadTestId);
  if (await payload.count()) {
    await expect(payload).toBeVisible();
    return payload;
  }

  const toggle = page.getByRole("button", { name: options.buttonLabel, exact: true });
  await expect(toggle).toBeVisible();
  await toggle.click();
  await expect(payload).toBeVisible();
  return payload;
}

/**
 * Opens a config dialog from the Inspector header and waits for its panel content.
 */
export async function openInspectorDialog(page: Page, label: InspectorDialogLabel): Promise<void> {
  const dialogTestIdByLabel: Record<InspectorDialogLabel, string> = {
    Review: "inspector-impact-review-panel",
    Sync: "inspector-sync-panel",
    PR: "inspector-pr-panel",
    Coverage: "inspector-inspectability-summary"
  };

  const button = page.getByRole("button", { name: label, exact: true });
  await expect(button).toBeVisible();
  await button.click();
  await expect(page.getByTestId(dialogTestIdByLabel[label])).toBeVisible();
}

/**
 * Returns common inspector locators used across focused inspector E2E tests.
 */
export function getInspectorLocators(page: Page): InspectorLocators {
  return {
    inspectorPanel: page.getByTestId("inspector-panel"),
    componentTree: page.getByTestId("component-tree"),
    previewFrame: page.frameLocator("iframe[title='Live preview']"),
    previewIframe: page.getByTitle("Live preview"),
    codeViewer: page.getByTestId("code-viewer"),
    fileSelector: page.getByTestId("inspector-file-selector")
  };
}

/**
 * Selects the second generated file option when available and returns its value.
 */
export async function selectSecondInspectorFile(fileSelector: Locator): Promise<string | null> {
  const options = fileSelector.getByRole("option");
  const optionCount = await options.count();
  if (optionCount <= 1) {
    return null;
  }

  const secondOption = options.nth(1);
  const secondValue = await secondOption.evaluate((option) => {
    return (option as HTMLOptionElement).value;
  });
  expect(secondValue, "Expected second file selector option to have a value").toBeTruthy();

  await fileSelector.selectOption(secondValue);
  return secondValue;
}

/**
 * Collects all inspectable `data-ir-id` values from the live preview iframe.
 */
export async function collectPreviewNodeIds(previewFrame: FrameLocator): Promise<string[]> {
  return await previewFrame.locator("[data-ir-id]").evaluateAll((elements) => {
    return elements
      .map((element) => element.getAttribute("data-ir-id"))
      .filter((nodeId): nodeId is string => typeof nodeId === "string" && nodeId.length > 0);
  });
}

/**
 * Finds the first preview node id that is also present in the component tree.
 */
export async function findFirstSyncedNodeId(page: Page, previewNodeIds: string[]): Promise<string | null> {
  for (const nodeId of previewNodeIds) {
    const treeNode = page.getByTestId(`tree-node-${nodeId}`);
    if ((await treeNode.count()) > 0) {
      return nodeId;
    }
  }
  return null;
}

/**
 * Clears browser storage to keep each test isolated.
 */
export async function resetBrowserStorage(page: Page): Promise<void> {
  await page.evaluate(() => {
    try {
      window.localStorage.clear();
      window.sessionStorage.clear();
    } catch {
      // Ignore SecurityError on about:blank or cross-origin
    }
  });
}
