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
const FIXTURE_PATH = path.resolve(
  fileURLToPath(new URL("../../src/parity/fixtures/golden/prototype-navigation/figma.json", import.meta.url))
);
const TERMINAL_STATUS_PATTERN = /^(COMPLETED|FAILED|CANCELED)$/;
const TERMINAL_STATUS_CAPTURE_PATTERN = /Submit:\s*([A-Z_]+)(?=\s|$)/i;
const JOB_COMPLETED_PATTERN = /completed successfully/i;
const JOB_FAILED_PATTERN = /\bfailed\b/i;
const JOB_CANCELED_PATTERN = /\bcanceled\b/i;
const SUBMIT_ENDPOINT_SUFFIX = "/workspace/submit";

/**
 * Returns the workspace UI URL used by Playwright E2E tests.
 */
export function getWorkspaceUiUrl(): string {
  return UI_URL;
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
 * Triggers a deterministic generation request and asserts that submit responds successfully.
 */
export async function triggerDeterministicGeneration(page: Page): Promise<void> {
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
  await expect(openInspectorButton).toBeVisible();
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
    window.localStorage.clear();
    window.sessionStorage.clear();
  });
}
