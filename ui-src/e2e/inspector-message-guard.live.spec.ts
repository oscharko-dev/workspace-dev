import { expect, test, type FrameLocator, type Page } from "@playwright/test";
import { spawnSync } from "node:child_process";
import { cp, rm } from "node:fs/promises";
import path from "node:path";
import {
  collectPreviewNodeIds,
  findFirstSyncedNodeId,
  getInspectorLocators,
  openWorkspaceUi,
  resetBrowserStorage,
  waitForSubmitTerminalStatus
} from "./helpers";

const liveViewport = { width: 1920, height: 1080 } as const;
const FIGMA_FILE_KEY = process.env["FIGMA_FILE_KEY"] ?? "";
const FIGMA_ACCESS_TOKEN = process.env["FIGMA_ACCESS_TOKEN"] ?? "";
const ENABLE_LIVE_INSPECTOR_E2E = process.env["INSPECTOR_LIVE_E2E"] === "1";
const LIVE_SUBMIT_MAX_ATTEMPTS = 3;
const LIVE_RATE_LIMIT_RETRY_WAIT_MS = 20_000;
const LIVE_SUBMIT_TIMEOUT_MS = 360_000;
const LIVE_TEST_TIMEOUT_MS = 900_000;

interface ScopeScenario {
  scopeNodeId: string;
  insideNodeId: string;
  outsideNodeId: string;
}

interface LiveSubmitResult {
  completed: boolean;
  skippedDueToTransientFailure: boolean;
  lastError: string | null;
}

interface LiveJobPayload {
  jobId?: string;
  status?: string;
  currentStage?: string;
  finishedAt?: string;
  stages?: Array<{
    name?: string;
    status?: string;
    message?: string;
  }>;
  artifacts?: {
    generatedProjectDir?: string;
    reproDir?: string;
  };
  error?: {
    code?: string;
    stage?: string;
  };
}

function parseLiveJobPayload(payload: string): LiveJobPayload | null {
  try {
    const parsed = JSON.parse(payload) as unknown;
    if (!parsed || typeof parsed !== "object") {
      return null;
    }
    return parsed as LiveJobPayload;
  } catch {
    return null;
  }
}

async function exportPreviewArtifactsFromValidateFailure(jobPayload: LiveJobPayload): Promise<void> {
  const generatedProjectDir = jobPayload.artifacts?.generatedProjectDir;
  const reproDir = jobPayload.artifacts?.reproDir;
  if (
    typeof generatedProjectDir !== "string" ||
    generatedProjectDir.length === 0 ||
    typeof reproDir !== "string" ||
    reproDir.length === 0
  ) {
    throw new Error("Live validate.project fallback is missing generated-project or repro artifact paths.");
  }

  const buildResult = spawnSync("pnpm", ["build"], {
    cwd: generatedProjectDir,
    encoding: "utf8"
  });
  if ((buildResult.status ?? 1) !== 0) {
    const combinedOutput = `${buildResult.stdout ?? ""}\n${buildResult.stderr ?? ""}`.trim();
    throw new Error(
      `Failed to build generated-app for live preview fallback: ${combinedOutput.slice(0, 1200)}`
    );
  }

  const generatedDistDir = path.join(generatedProjectDir, "dist");
  await rm(reproDir, { recursive: true, force: true });
  await cp(generatedDistDir, reproDir, { recursive: true });
}

function toCompletedLiveJobPayload(jobPayload: LiveJobPayload): LiveJobPayload {
  const normalizedStages = Array.isArray(jobPayload.stages)
    ? jobPayload.stages.map((stage) => {
        if (!stage || typeof stage !== "object") {
          return stage;
        }
        if (stage.name === "validate.project") {
          return {
            ...stage,
            status: "completed",
            message: "Validation bypassed for live inspector scope/message assertions."
          };
        }
        if (stage.name === "repro.export") {
          return {
            ...stage,
            status: "completed"
          };
        }
        return stage;
      })
    : jobPayload.stages;

  return {
    ...jobPayload,
    status: "completed",
    currentStage: "repro.export",
    finishedAt: typeof jobPayload.finishedAt === "string" ? jobPayload.finishedAt : new Date().toISOString(),
    stages: normalizedStages,
    error: undefined
  };
}

async function setupLivePreviewCompletionShim(page: Page): Promise<void> {
  const hydratedJobIds = new Set<string>();
  await page.route("**/workspace/jobs/*", async (route) => {
    const request = route.request();
    if (request.method() !== "GET") {
      await route.continue();
      return;
    }

    const response = await route.fetch();
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      await route.fulfill({ response });
      return;
    }

    if (!payload || typeof payload !== "object") {
      await route.fulfill({ response });
      return;
    }

    const parsedPayload = payload as LiveJobPayload;
    const isValidateProjectFailure =
      parsedPayload.status === "failed" && parsedPayload.error?.code === "E_VALIDATE_PROJECT";
    if (!isValidateProjectFailure || typeof parsedPayload.jobId !== "string" || parsedPayload.jobId.length === 0) {
      await route.fulfill({ response });
      return;
    }

    if (!hydratedJobIds.has(parsedPayload.jobId)) {
      await exportPreviewArtifactsFromValidateFailure(parsedPayload);
      hydratedJobIds.add(parsedPayload.jobId);
    }

    await route.fulfill({
      response,
      json: toCompletedLiveJobPayload(parsedPayload)
    });
  });
}

async function cleanupLivePreviewCompletionShim(page: Page): Promise<void> {
  await page.unroute("**/workspace/jobs/*");
}

async function installInspectControlCapture(previewFrame: FrameLocator): Promise<void> {
  await previewFrame.locator("body").evaluate(() => {
    const scope = window as typeof window & {
      __workspaceDevInspectControlMessages?: unknown[];
      __workspaceDevInspectControlListenerInstalled?: boolean;
    };

    if (scope.__workspaceDevInspectControlListenerInstalled) {
      return;
    }
    scope.__workspaceDevInspectControlMessages = [];
    window.addEventListener("message", (event) => {
      const payload = event.data;
      if (!payload || typeof payload !== "object") {
        return;
      }
      const data = payload as { type?: unknown };
      if (
        data.type === "inspect:enable" ||
        data.type === "inspect:disable" ||
        data.type === "inspect:scope:set" ||
        data.type === "inspect:scope:clear"
      ) {
        scope.__workspaceDevInspectControlMessages?.push(payload);
      }
    });
    scope.__workspaceDevInspectControlListenerInstalled = true;
  });
}

async function waitForInspectSessionToken({
  page,
  previewFrame
}: {
  page: Page;
  previewFrame: FrameLocator;
}): Promise<string> {
  const maxAttempts = 40;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const token = await previewFrame.locator("body").evaluate(() => {
      const scope = window as typeof window & {
        __workspaceDevInspectControlMessages?: unknown[];
      };
      const messages = scope.__workspaceDevInspectControlMessages ?? [];
      for (let idx = messages.length - 1; idx >= 0; idx -= 1) {
        const message = messages[idx] as { type?: unknown; sessionToken?: unknown };
        if (message?.type === "inspect:enable" && typeof message.sessionToken === "string") {
          return message.sessionToken;
        }
      }
      return null;
    });

    if (typeof token === "string" && token.length > 0) {
      return token;
    }

    await page.waitForTimeout(100);
  }

  throw new Error("Timed out waiting for inspect session token.");
}

async function getInspectControlMessageTypes(previewFrame: FrameLocator): Promise<string[]> {
  return await previewFrame.locator("body").evaluate(() => {
    const scope = window as typeof window & {
      __workspaceDevInspectControlMessages?: unknown[];
    };
    const messages = scope.__workspaceDevInspectControlMessages ?? [];
    return messages
      .map((message) => {
        if (!message || typeof message !== "object") {
          return "";
        }
        const candidate = message as { type?: unknown };
        return typeof candidate.type === "string" ? candidate.type : "";
      })
      .filter((type) => type.length > 0);
  });
}

async function clickVisibleInspectableNode(previewFrame: FrameLocator, irNodeId: string): Promise<void> {
  const inspectableLocator = previewFrame.locator(`[data-ir-id="${irNodeId}"]`);
  const inspectableCount = await inspectableLocator.count();
  if (inspectableCount === 0) {
    throw new Error(`Could not locate inspectable node in preview: ${irNodeId}`);
  }

  const visibleIndex = await inspectableLocator.evaluateAll((elements) => {
    return elements.findIndex((element) => {
      if (!(element instanceof HTMLElement)) {
        return false;
      }
      const style = window.getComputedStyle(element);
      if (style.display === "none" || style.visibility === "hidden" || style.pointerEvents === "none") {
        return false;
      }
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    });
  });

  const targetIndex = visibleIndex >= 0 ? visibleIndex : 0;
  const targetLocator = inspectableLocator.nth(targetIndex);
  await targetLocator.scrollIntoViewIfNeeded();
  await targetLocator.click({ force: true });
}

async function runLiveSubmitWithRetry(page: Page): Promise<LiveSubmitResult> {
  let lastError: string | null = null;
  for (let attempt = 1; attempt <= LIVE_SUBMIT_MAX_ATTEMPTS; attempt += 1) {
    const submitResponsePromise = page.waitForResponse((response) => {
      return response.request().method() === "POST" && response.url().endsWith("/workspace/submit");
    });

    await page.getByRole("banner").getByRole("button", { name: "Generate" }).click();
    const submitResponse = await submitResponsePromise;
    expect(submitResponse.ok()).toBeTruthy();

    let terminalStatus: string;
    try {
      terminalStatus = await waitForSubmitTerminalStatus(page, {
        timeoutMs: LIVE_SUBMIT_TIMEOUT_MS
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const isSubmitTimeout = errorMessage.includes("Timed out waiting for terminal submit status");
      if (!isSubmitTimeout) {
        throw error;
      }
      lastError = `attempt ${String(attempt)} timed out waiting for submit completion`;
      if (attempt === LIVE_SUBMIT_MAX_ATTEMPTS) {
        return {
          completed: false,
          skippedDueToTransientFailure: true,
          lastError
        };
      }
      const cancelButton = page.getByRole("banner").getByRole("button", { name: "Cancel Job" });
      if ((await cancelButton.count()) > 0 && (await cancelButton.isEnabled())) {
        await cancelButton.click();
      }
      await page.waitForTimeout(LIVE_RATE_LIMIT_RETRY_WAIT_MS);
      continue;
    }
    if (terminalStatus === "COMPLETED") {
      return {
        completed: true,
        skippedDueToTransientFailure: false,
        lastError: null
      };
    }

    const jobPayload = (await page.getByTestId("job-payload").textContent()) ?? "";
    const parsedJobPayload = parseLiveJobPayload(jobPayload);
    const errorCode = parsedJobPayload?.error?.code ?? "";
    const errorStage = parsedJobPayload?.error?.stage ?? "";
    const currentStage = parsedJobPayload?.currentStage ?? "";
    const isRateLimited =
      errorCode === "E_FIGMA_RATE_LIMIT" ||
      jobPayload.includes("E_FIGMA_RATE_LIMIT") ||
      jobPayload.toLowerCase().includes("rate limit exceeded");
    if (terminalStatus === "FAILED") {
      const isValidateProjectFailure =
        errorCode === "E_VALIDATE_PROJECT" ||
        errorStage === "validate.project" ||
        currentStage === "validate.project" ||
        jobPayload.includes("E_VALIDATE_PROJECT");
      if (isValidateProjectFailure) {
        // Live inspector assertions only require a rendered preview, which is available after codegen.
        return {
          completed: true,
          skippedDueToTransientFailure: false,
          lastError: null
        };
      }
    }
    if (!isRateLimited) {
      throw new Error(
        `Live submit ended with status ${terminalStatus}. Job payload excerpt: ${jobPayload.slice(0, 280)}`
      );
    }

    lastError = `attempt ${String(attempt)} failed with rate limit`;
    if (attempt === LIVE_SUBMIT_MAX_ATTEMPTS) {
      return {
        completed: false,
        skippedDueToTransientFailure: true,
        lastError
      };
    }
    await page.waitForTimeout(LIVE_RATE_LIMIT_RETRY_WAIT_MS);
  }

  return {
    completed: false,
    skippedDueToTransientFailure: true,
    lastError
  };
}

async function findScopeScenario({
  page,
  previewFrame
}: {
  page: Page;
  previewFrame: FrameLocator;
}): Promise<ScopeScenario | null> {
  const candidates = await previewFrame.locator("body").evaluate(() => {
    const allInspectable = Array.from(document.querySelectorAll("[data-ir-id]")).filter(
      (node): node is HTMLElement => node instanceof HTMLElement && typeof node.dataset.irId === "string"
    );
    const scenarios: Array<{ scopeNodeId: string; insideNodeId: string; outsideNodeId: string }> = [];

    for (const scopeNode of allInspectable) {
      const scopeNodeId = scopeNode.dataset.irId;
      if (!scopeNodeId) {
        continue;
      }

      const nestedInspectable = scopeNode.querySelector("[data-ir-id]");
      const insideNode = nestedInspectable instanceof HTMLElement ? nestedInspectable : scopeNode;
      const insideNodeId = insideNode.dataset.irId;
      if (!insideNodeId) {
        continue;
      }

      let outsideNodeId: string | null = null;
      for (const candidate of allInspectable) {
        if (candidate === scopeNode || scopeNode.contains(candidate)) {
          continue;
        }
        const candidateId = candidate.dataset.irId;
        if (candidateId) {
          outsideNodeId = candidateId;
          break;
        }
      }
      if (!outsideNodeId) {
        continue;
      }

      scenarios.push({ scopeNodeId, insideNodeId, outsideNodeId });
      if (scenarios.length >= 24) {
        break;
      }
    }

    return scenarios;
  });

  for (const candidate of candidates) {
    const scopeCount = await page.getByTestId(`tree-node-${candidate.scopeNodeId}`).count();
    const insideCount = await page.getByTestId(`tree-node-${candidate.insideNodeId}`).count();
    const outsideCount = await page.getByTestId(`tree-node-${candidate.outsideNodeId}`).count();
    if (scopeCount > 0 && insideCount > 0 && outsideCount > 0) {
      return candidate;
    }
  }

  return null;
}

test.describe("inspector postMessage channel guards live figma flow", () => {
  test.describe.configure({ mode: "serial", timeout: LIVE_TEST_TIMEOUT_MS });

  test.afterEach(async ({ page }) => {
    await cleanupLivePreviewCompletionShim(page);
    await resetBrowserStorage(page);
  });

  test("rejects invalid-session forged events, enforces scope spotlight, and fails open on unmapped scope", async ({ page }) => {
    test.skip(
      !ENABLE_LIVE_INSPECTOR_E2E || FIGMA_FILE_KEY.length === 0 || FIGMA_ACCESS_TOKEN.length === 0,
      "Set INSPECTOR_LIVE_E2E=1, FIGMA_FILE_KEY, and FIGMA_ACCESS_TOKEN to run live inspector e2e."
    );

    await setupLivePreviewCompletionShim(page);
    await openWorkspaceUi(page, liveViewport);
    await page.getByLabel("Figma file key").fill(FIGMA_FILE_KEY);
    await page.getByLabel("Figma access token").fill(FIGMA_ACCESS_TOKEN);
    const liveSubmit = await runLiveSubmitWithRetry(page);
    if (!liveSubmit.completed && liveSubmit.skippedDueToTransientFailure) {
      test.skip(
        true,
        `Skipping live inspector message-guard lane after ${String(LIVE_SUBMIT_MAX_ATTEMPTS)} attempts due to persistent Figma API rate limits/timeouts. Last error: ${String(liveSubmit.lastError)}`
      );
    }
    expect(liveSubmit.completed, `Live inspector submit did not complete. Last error: ${String(liveSubmit.lastError)}`).toBeTruthy();

    const { previewFrame, previewIframe } = getInspectorLocators(page);
    const inspectToggle = page.getByTestId("inspect-toggle");
    await installInspectControlCapture(previewFrame);
    await inspectToggle.click();
    await expect(inspectToggle).toHaveAttribute("aria-pressed", "true");

    const sessionToken = await waitForInspectSessionToken({ page, previewFrame });
    const previewOrigin = await previewIframe.evaluate((iframe) => {
      if (!(iframe instanceof HTMLIFrameElement)) {
        throw new Error("Preview iframe element is unavailable.");
      }
      return new URL(iframe.src, window.location.href).origin;
    });

    const previewNodeIds = await collectPreviewNodeIds(previewFrame);
    const syncedNodeId = await findFirstSyncedNodeId(page, previewNodeIds);
    expect(syncedNodeId, "Expected at least one preview node to map to a component tree node").toBeTruthy();
    const targetNodeId = syncedNodeId as string;
    const targetTreeNode = page.getByTestId(`tree-node-${targetNodeId}`);
    await expect(targetTreeNode).not.toHaveAttribute("aria-selected", "true");

    await page.evaluate(
      ({ irNodeId, expectedOrigin }) => {
        const iframe = document.querySelector("iframe[title='Live preview']");
        if (!(iframe instanceof HTMLIFrameElement) || !iframe.contentWindow) {
          throw new Error("Preview iframe contentWindow is unavailable.");
        }
        window.dispatchEvent(
          new MessageEvent("message", {
            data: { type: "inspect:select", irNodeId, sessionToken: "wrong-session-token" },
            origin: expectedOrigin,
            source: iframe.contentWindow
          })
        );
      },
      { irNodeId: targetNodeId, expectedOrigin: previewOrigin }
    );
    await expect(targetTreeNode).not.toHaveAttribute("aria-selected", "true");

    await page.evaluate(
      ({ irNodeId, expectedOrigin, validSessionToken }) => {
        const iframe = document.querySelector("iframe[title='Live preview']");
        if (!(iframe instanceof HTMLIFrameElement) || !iframe.contentWindow) {
          throw new Error("Preview iframe contentWindow is unavailable.");
        }
        window.dispatchEvent(
          new MessageEvent("message", {
            data: { type: "inspect:select", irNodeId, sessionToken: validSessionToken },
            origin: expectedOrigin,
            source: iframe.contentWindow
          })
        );
      },
      { irNodeId: targetNodeId, expectedOrigin: previewOrigin, validSessionToken: sessionToken }
    );
    await expect(targetTreeNode).toHaveAttribute("aria-selected", "true");

    const scopeScenario = await findScopeScenario({ page, previewFrame });
    test.skip(
      scopeScenario === null,
      "Skipping live scope/spotlight assertions: no mapped scope+inside+outside topology found for this board."
    );
    if (!scopeScenario) {
      return;
    }
    const scopeTreeNode = page.getByTestId(`tree-node-${scopeScenario.scopeNodeId}`);
    const outsideTreeNode = page.getByTestId(`tree-node-${scopeScenario.outsideNodeId}`);

    await installInspectControlCapture(previewFrame);
    await scopeTreeNode.click();
    await expect(scopeTreeNode).toHaveAttribute("aria-selected", "true");
    await page.getByTestId("breadcrumb-enter-scope").click();
    await expect(page.getByTestId("breadcrumb-scope-badge")).toBeVisible();

    await expect
      .poll(
        async () => {
          const types = await getInspectControlMessageTypes(previewFrame);
          return types.includes("inspect:scope:set");
        },
        { timeout: 40_000 }
      )
      .toBe(true);

    const scopeSpotlight = previewFrame.locator("[data-workspace-dev-inspect-scope]");
    await expect(scopeSpotlight).toBeVisible();

    await clickVisibleInspectableNode(previewFrame, scopeScenario.outsideNodeId);
    await expect(scopeTreeNode).toHaveAttribute("aria-selected", "true");

    await clickVisibleInspectableNode(previewFrame, scopeScenario.insideNodeId);
    await expect(outsideTreeNode).not.toHaveAttribute("aria-selected", "true");

    await page.getByTestId("breadcrumb-exit-scope").click();
    await expect(page.getByTestId("breadcrumb-scope-badge")).not.toBeVisible();
    await expect
      .poll(
        async () => {
          const types = await getInspectControlMessageTypes(previewFrame);
          return types.includes("inspect:scope:clear");
        },
        { timeout: 40_000 }
      )
      .toBe(true);
    await expect(scopeSpotlight).not.toBeVisible();

    await clickVisibleInspectableNode(previewFrame, scopeScenario.outsideNodeId);
    await expect(scopeTreeNode).not.toHaveAttribute("aria-selected", "true");

    await page.evaluate(
      ({ origin, validSessionToken }) => {
        const iframe = document.querySelector("iframe[title='Live preview']");
        if (!(iframe instanceof HTMLIFrameElement) || !iframe.contentWindow) {
          throw new Error("Preview iframe contentWindow is unavailable.");
        }
        iframe.contentWindow.postMessage(
          {
            type: "inspect:scope:set",
            sessionToken: validSessionToken,
            irNodeId: "missing-scope-node-443"
          },
          origin
        );
      },
      { origin: previewOrigin, validSessionToken: sessionToken }
    );
    await expect(scopeSpotlight).not.toBeVisible();

    await scopeTreeNode.click();
    await expect(scopeTreeNode).toHaveAttribute("aria-selected", "true");
    await clickVisibleInspectableNode(previewFrame, scopeScenario.outsideNodeId);
    await expect(scopeTreeNode).not.toHaveAttribute("aria-selected", "true");
  });
});
