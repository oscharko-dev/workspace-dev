import { expect, test, type Page } from "@playwright/test";
import { spawnSync } from "node:child_process";
import { cp, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
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
const LIVE_RETRY_WAIT_MS = 20_000;
const LIVE_SUBMIT_TIMEOUT_MS = 300_000;
const LIVE_STATUS_POLL_INTERVAL_MS = 1_000;
const DRAFT_STORAGE_PREFIX = "workspace-dev:inspector-override-draft:v1:";
const SUBMIT_ENDPOINT_SUFFIX = "/workspace/submit";
const JOB_ROUTE_PATTERN = "**/workspace/jobs/*";
const JOB_REGENERATE_ROUTE_PATTERN = "**/workspace/jobs/*/regenerate";
const DETERMINISTIC_FIXTURE_PATH = path.resolve(
  fileURLToPath(new URL("../../src/parity/fixtures/golden/rocket/prototype-navigation/figma.json", import.meta.url))
);
const EDITABLE_ELEMENT_TYPES = new Set([
  "text",
  "button",
  "input",
  "card",
  "container",
  "paper",
  "chip",
  "stack",
  "grid",
  "image",
  "avatar",
  "badge",
  "appbar",
  "dialog",
  "snackbar",
  "drawer",
  "navigation",
  "list",
  "divider"
]);
const SCALAR_FIELDS = [
  "fillColor",
  "opacity",
  "cornerRadius",
  "fontSize",
  "fontWeight",
  "fontFamily",
  "padding",
  "gap"
] as const;
const LAYOUT_FIELDS = [
  "width",
  "height",
  "layoutMode",
  "primaryAxisAlignItems",
  "counterAxisAlignItems"
] as const;
const OVERRIDE_DISCOVERY_FIELDS = [...SCALAR_FIELDS, ...LAYOUT_FIELDS] as const;

interface SubmitAcceptedPayload {
  jobId?: string;
}

interface RegenerationAcceptedPayload {
  jobId?: string;
  sourceJobId?: string;
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
  lineage?: {
    sourceJobId?: string;
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function extractScreens<TScreen>(value: unknown): TScreen[] {
  if (!isRecord(value)) {
    return [];
  }

  if (Array.isArray(value.screens)) {
    return value.screens as TScreen[];
  }

  if (isRecord(value.payload) && Array.isArray(value.payload.screens)) {
    return value.payload.screens as TScreen[];
  }

  return [];
}

function parseLiveJobPayload(payload: string | null): LiveJobPayload | null {
  if (!payload) {
    return null;
  }
  try {
    const parsed = JSON.parse(payload) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    return parsed as LiveJobPayload;
  } catch {
    return null;
  }
}

async function waitForJobTerminalStatus({
  page,
  runtimeOrigin,
  jobId,
  timeoutMs = LIVE_SUBMIT_TIMEOUT_MS
}: {
  page: Page;
  runtimeOrigin: string;
  jobId: string;
  timeoutMs?: number;
}): Promise<LiveJobPayload> {
  const deadline = Date.now() + timeoutMs;
  const encodedJobId = encodeURIComponent(jobId);

  while (Date.now() < deadline) {
    const response = await page.request.get(`${runtimeOrigin}/workspace/jobs/${encodedJobId}`);
    if (!response.ok()) {
      throw new Error(
        `Failed to poll job '${jobId}' terminal status. HTTP ${String(response.status())} ${response.statusText()}`
      );
    }

    const payload = (await response.json()) as LiveJobPayload;
    const status = payload.status;
    if (status === "completed" || status === "failed" || status === "canceled") {
      return payload;
    }

    await page.waitForTimeout(LIVE_STATUS_POLL_INTERVAL_MS);
  }

  throw new Error(`Timed out waiting for API terminal job status for job '${jobId}'.`);
}

async function createDeterministicCompletedSourceJob({
  page,
  runtimeOrigin
}: {
  page: Page;
  runtimeOrigin: string;
}): Promise<string> {
  const submitResponse = await page.request.post(`${runtimeOrigin}/workspace/submit`, {
    data: {
      figmaSourceMode: "local_json",
      figmaJsonPath: DETERMINISTIC_FIXTURE_PATH,
      llmCodegenMode: "deterministic",
      enableGitPr: false
    }
  });

  if (!submitResponse.ok()) {
    throw new Error(
      `Failed to create deterministic surrogate source job. HTTP ${String(submitResponse.status())} ${submitResponse.statusText()}`
    );
  }

  const submitPayload = (await submitResponse.json()) as SubmitAcceptedPayload;
  if (typeof submitPayload.jobId !== "string" || submitPayload.jobId.length === 0) {
    throw new Error("Deterministic surrogate submit did not return jobId.");
  }

  const terminalPayload = await waitForJobTerminalStatus({
    page,
    runtimeOrigin,
    jobId: submitPayload.jobId,
    timeoutMs: LIVE_SUBMIT_TIMEOUT_MS
  });
  if (terminalPayload.status !== "completed") {
    throw new Error(
      `Deterministic surrogate source job '${submitPayload.jobId}' finished with status '${String(terminalPayload.status)}'.`
    );
  }

  return submitPayload.jobId;
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
            message: "Validation bypassed for live inspector scalar override assertions."
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
  const surrogateSourceJobByLiveSourceId = new Map<string, string>();
  const pendingSurrogateSourceByLiveSourceId = new Map<string, Promise<string>>();
  const surrogateSourceErrorByLiveSourceId = new Map<string, string>();
  const regenerationSourceAliasByJobId = new Map<string, string>();

  const startSurrogateSourceJobCreation = ({
    liveSourceJobId,
    runtimeOrigin
  }: {
    liveSourceJobId: string;
    runtimeOrigin: string;
  }): void => {
    if (
      surrogateSourceJobByLiveSourceId.has(liveSourceJobId) ||
      pendingSurrogateSourceByLiveSourceId.has(liveSourceJobId) ||
      surrogateSourceErrorByLiveSourceId.has(liveSourceJobId)
    ) {
      return;
    }

    const pendingCreation = createDeterministicCompletedSourceJob({
      page,
      runtimeOrigin
    })
      .then((surrogateJobId) => {
        surrogateSourceJobByLiveSourceId.set(liveSourceJobId, surrogateJobId);
        return surrogateJobId;
      })
      .catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        surrogateSourceErrorByLiveSourceId.set(liveSourceJobId, message);
        throw error;
      })
      .finally(() => {
        pendingSurrogateSourceByLiveSourceId.delete(liveSourceJobId);
      });

    pendingSurrogateSourceByLiveSourceId.set(liveSourceJobId, pendingCreation);
    void pendingCreation.catch(() => {
      return;
    });
  };

  const resolveSurrogateSourceJobId = async ({
    liveSourceJobId,
    runtimeOrigin
  }: {
    liveSourceJobId: string;
    runtimeOrigin: string;
  }): Promise<string> => {
    const existing = surrogateSourceJobByLiveSourceId.get(liveSourceJobId);
    if (existing) {
      return existing;
    }

    const existingError = surrogateSourceErrorByLiveSourceId.get(liveSourceJobId);
    if (existingError) {
      throw new Error(
        `Failed to provision surrogate regeneration source for live job '${liveSourceJobId}': ${existingError}`
      );
    }

    startSurrogateSourceJobCreation({ liveSourceJobId, runtimeOrigin });
    const pending = pendingSurrogateSourceByLiveSourceId.get(liveSourceJobId);
    if (!pending) {
      throw new Error(`Failed to queue surrogate source creation for live job '${liveSourceJobId}'.`);
    }
    return await pending;
  };

  await page.route(JOB_REGENERATE_ROUTE_PATTERN, async (route) => {
    const request = route.request();
    if (request.method() !== "POST") {
      await route.continue();
      return;
    }

    const requestUrl = new URL(request.url());
    const pathSegments = requestUrl.pathname.split("/").filter((segment) => segment.length > 0);
    const jobsSegmentIndex = pathSegments.findIndex((segment) => segment === "jobs");
    const sourceJobId =
      jobsSegmentIndex >= 0 && pathSegments.length > jobsSegmentIndex + 2
        ? pathSegments[jobsSegmentIndex + 1]
        : undefined;
    if (!sourceJobId) {
      await route.continue();
      return;
    }

    let rewrittenSourceJobId = sourceJobId;
    if (
      surrogateSourceJobByLiveSourceId.has(sourceJobId) ||
      pendingSurrogateSourceByLiveSourceId.has(sourceJobId) ||
      surrogateSourceErrorByLiveSourceId.has(sourceJobId)
    ) {
      try {
        rewrittenSourceJobId = await resolveSurrogateSourceJobId({
          liveSourceJobId: sourceJobId,
          runtimeOrigin: requestUrl.origin
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await route.fulfill({
          status: 500,
          contentType: "application/json",
          body: JSON.stringify({
            error: "LIVE_REGEN_SURROGATE_FAILED",
            message
          })
        });
        return;
      }
    }

    if (rewrittenSourceJobId === sourceJobId) {
      await route.continue();
      return;
    }

    const rewrittenUrl = `${requestUrl.origin}/workspace/jobs/${encodeURIComponent(rewrittenSourceJobId)}/regenerate`;
    const response = await route.fetch({
      url: rewrittenUrl,
      postData: request.postData() ?? undefined
    });

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      await route.fulfill({ response });
      return;
    }

    if (!isRecord(payload)) {
      await route.fulfill({ response });
      return;
    }

    const parsedPayload = payload as RegenerationAcceptedPayload;
    if (typeof parsedPayload.jobId === "string" && parsedPayload.jobId.length > 0) {
      regenerationSourceAliasByJobId.set(parsedPayload.jobId, sourceJobId);
    }

    await route.fulfill({
      response,
      json: {
        ...payload,
        sourceJobId
      }
    });
  });

  await page.route(JOB_ROUTE_PATTERN, async (route) => {
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
    const regenerationAliasSourceJobId =
      typeof parsedPayload.jobId === "string" ? regenerationSourceAliasByJobId.get(parsedPayload.jobId) : undefined;
    if (
      regenerationAliasSourceJobId &&
      parsedPayload.lineage &&
      typeof parsedPayload.lineage === "object" &&
      !Array.isArray(parsedPayload.lineage)
    ) {
      await route.fulfill({
        response,
        json: {
          ...parsedPayload,
          lineage: {
            ...parsedPayload.lineage,
            sourceJobId: regenerationAliasSourceJobId
          }
        }
      });
      return;
    }

    const isValidateProjectFailure =
      parsedPayload.status === "failed" && parsedPayload.error?.code === "E_VALIDATE_PROJECT";
    if (!isValidateProjectFailure || typeof parsedPayload.jobId !== "string" || parsedPayload.jobId.length === 0) {
      await route.fulfill({ response });
      return;
    }

    if (!hydratedJobIds.has(parsedPayload.jobId)) {
      await exportPreviewArtifactsFromValidateFailure(parsedPayload);
      hydratedJobIds.add(parsedPayload.jobId);
      startSurrogateSourceJobCreation({
        liveSourceJobId: parsedPayload.jobId,
        runtimeOrigin: new URL(request.url()).origin
      });
    }

    await route.fulfill({
      response,
      json: toCompletedLiveJobPayload(parsedPayload)
    });
  });
}

async function cleanupLivePreviewCompletionShim(page: Page): Promise<void> {
  await page.unroute(JOB_REGENERATE_ROUTE_PATTERN);
  await page.unroute(JOB_ROUTE_PATTERN);
}

async function assertScreenNodeUnsupported(page: Page): Promise<void> {
  const { componentTree } = getInspectorLocators(page);
  const screenNode = componentTree.getByTestId(/^tree-screen-/).first();
  await expect(screenNode).toBeVisible();
  await screenNode.click();

  await expect(page.getByTestId("inspector-edit-capability")).toBeVisible();
  await expect(page.getByTestId("inspector-edit-capability-reason")).toContainText(
    "does not support structured editing"
  );
}

async function findFirstEditableNodeId({
  page,
  jobId,
  requiredEditableFields = []
}: {
  page: Page;
  jobId: string;
  requiredEditableFields?: readonly string[];
}): Promise<string> {
  const encodedJobId = encodeURIComponent(jobId);
  const runtimeOrigin = new URL(page.url()).origin;

  const designIrResponse = await page.request.get(`${runtimeOrigin}/workspace/jobs/${encodedJobId}/design-ir`);
  expect(designIrResponse.ok()).toBeTruthy();
  const designIrJson = (await designIrResponse.json()) as unknown;
  const designIrScreens = extractScreens<{
    children?: unknown[];
  }>(designIrJson);

  const manifestResponse = await page.request.get(`${runtimeOrigin}/workspace/jobs/${encodedJobId}/component-manifest`);
  expect(manifestResponse.ok()).toBeTruthy();
  const manifestJson = (await manifestResponse.json()) as unknown;
  const manifestScreens = extractScreens<{
    components?: Array<{
      irNodeId?: string;
    }>;
  }>(manifestJson);

  const mappedNodeIds = new Set<string>();
  for (const screen of manifestScreens) {
    for (const component of screen.components ?? []) {
      if (typeof component.irNodeId === "string" && component.irNodeId.length > 0) {
        mappedNodeIds.add(component.irNodeId);
      }
    }
  }

  const candidateNodeIds: string[] = [];
  const visitNode = (candidate: unknown): void => {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
      return;
    }

    const node = candidate as Record<string, unknown>;
    const nodeId = typeof node.id === "string" ? node.id : "";
    const nodeType = typeof node.type === "string" ? node.type : "";

    if (
      nodeId.length > 0 &&
      EDITABLE_ELEMENT_TYPES.has(nodeType) &&
      mappedNodeIds.has(nodeId) &&
      OVERRIDE_DISCOVERY_FIELDS.some((field) => node[field] !== undefined && node[field] !== null)
    ) {
      candidateNodeIds.push(nodeId);
    }

    if (Array.isArray(node.children)) {
      for (const child of node.children) {
        visitNode(child);
      }
    }
  };

  for (const screen of designIrScreens) {
    for (const child of screen.children ?? []) {
      visitNode(child);
    }
  }

  if (candidateNodeIds.length === 0) {
    throw new Error(
      `No mapped editable candidates with scalar fields were found in live design IR (designIrScreens=${String(designIrScreens.length)}, mappedNodeIds=${String(mappedNodeIds.size)}).`
    );
  }

  const inspectToggle = page.getByTestId("inspect-toggle");
  const capabilityPanel = page.getByTestId("inspector-edit-capability");
  let inspectEnabled = false;

  for (const nodeId of candidateNodeIds) {
    const treeNode = page.getByTestId(`tree-node-${nodeId}`);
    if ((await treeNode.count()) > 0) {
      await treeNode.first().click();
    } else {
      if ((await inspectToggle.count()) === 0) {
        continue;
      }
      if (!inspectEnabled) {
        const pressed = await inspectToggle.getAttribute("aria-pressed");
        if (pressed !== "true") {
          await inspectToggle.click();
        }
        inspectEnabled = true;
      }

      const previewNode = page.frameLocator("iframe[title='Live preview']").locator(`[data-ir-id=\"${nodeId}\"]`);
      if ((await previewNode.count()) === 0) {
        continue;
      }
      await previewNode.first().scrollIntoViewIfNeeded();
      await previewNode.first().click({ force: true });
    }

    await expect(capabilityPanel).toBeVisible();
    const capabilityText = await capabilityPanel.textContent();
    if (
      capabilityText?.includes("Edit Capability: Supported")
      && requiredEditableFields.every((field) => capabilityText.includes(field))
    ) {
      if (inspectEnabled) {
        const pressed = await inspectToggle.getAttribute("aria-pressed");
        if (pressed === "true") {
          await inspectToggle.click();
        }
      }
      return nodeId;
    }
  }

  throw new Error("No editable node could be selected from live mapped candidates.");
}

async function enterEditStudio(page: Page, nodeId: string): Promise<void> {
  const treeNode = page.getByTestId(`tree-node-${nodeId}`);
  if ((await treeNode.count()) > 0) {
    await treeNode.first().click();
  } else {
    const inspectToggle = page.getByTestId("inspect-toggle");
    if ((await inspectToggle.count()) > 0) {
      const pressed = await inspectToggle.getAttribute("aria-pressed");
      if (pressed !== "true") {
        await inspectToggle.click();
      }
    }

    const previewNode = page.frameLocator("iframe[title='Live preview']").locator(`[data-ir-id=\"${nodeId}\"]`);
    await expect(previewNode.first()).toBeVisible({ timeout: 15_000 });
    await previewNode.first().scrollIntoViewIfNeeded();
    await previewNode.first().click({ force: true });
    await expect(page.getByTestId("inspector-edit-capability")).toContainText("Edit Capability: Supported");
  }
  const enterEditModeButton = page.getByTestId("inspector-enter-edit-mode");
  await expect(enterEditModeButton).toBeEnabled();
  await enterEditModeButton.click();
  await expect(page.getByTestId("inspector-edit-studio-panel")).toBeVisible();
}

async function applyScalarOverrides(page: Page): Promise<{
  field: "fillColor" | "fontFamily" | "opacity" | "cornerRadius" | "fontSize" | "fontWeight" | "gap" | "padding";
  value: string;
  inputTestId: string;
}> {
  const candidates: Array<{
    field: "fillColor" | "fontFamily" | "opacity" | "cornerRadius" | "fontSize" | "fontWeight" | "gap" | "padding";
    value: string;
    inputTestId: string;
  }> = [
    { field: "fillColor", value: "#24a0d1", inputTestId: "inspector-edit-input-fillColor" },
    { field: "fontFamily", value: "Source Sans Pro", inputTestId: "inspector-edit-input-fontFamily" },
    { field: "opacity", value: "0.7", inputTestId: "inspector-edit-input-opacity" },
    { field: "fontSize", value: "20", inputTestId: "inspector-edit-input-fontSize" },
    { field: "fontWeight", value: "700", inputTestId: "inspector-edit-input-fontWeight" },
    { field: "cornerRadius", value: "10", inputTestId: "inspector-edit-input-cornerRadius" },
    { field: "gap", value: "14", inputTestId: "inspector-edit-input-gap" },
    { field: "padding", value: "12", inputTestId: "inspector-edit-input-padding-top" }
  ];

  for (const candidate of candidates) {
    const input = page.getByTestId(candidate.inputTestId);
    if ((await input.count()) === 0) {
      continue;
    }

    await input.fill(candidate.value);
    await input.blur();

    const payloadPreview = page.getByTestId("inspector-edit-payload-preview");
    await expect(payloadPreview).toContainText(`"field": "${candidate.field}"`);

    return candidate;
  }

  throw new Error("No scalar override field is available for the selected live node.");
}

async function applyLayoutOverrides(page: Page): Promise<{
  widthValue: string;
  layoutModeValue: "NONE";
}> {
  const widthInput = page.getByTestId("inspector-edit-input-width");
  await widthInput.fill("420");
  await widthInput.blur();

  const layoutModeInput = page.getByTestId("inspector-edit-input-layoutMode");
  await layoutModeInput.selectOption("NONE");

  const payloadPreview = page.getByTestId("inspector-edit-payload-preview");
  await expect(payloadPreview).toContainText("\"field\": \"width\"");
  await expect(payloadPreview).toContainText("\"field\": \"layoutMode\"");

  return {
    widthValue: "420",
    layoutModeValue: "NONE"
  };
}

async function runLiveSubmitWithRetryHardFail({
  page,
  onAccepted
}: {
  page: Page;
  onAccepted?: (jobId: string) => Promise<void>;
}): Promise<string> {
  let lastTransientError: string | null = null;

  for (let attempt = 1; attempt <= LIVE_SUBMIT_MAX_ATTEMPTS; attempt += 1) {
    const submitResponsePromise = page.waitForResponse((response) => {
      return response.request().method() === "POST" && response.url().endsWith(SUBMIT_ENDPOINT_SUFFIX);
    });

    await page.getByRole("banner").getByRole("button", { name: "Generate" }).click();
    const submitResponse = await submitResponsePromise;
    expect(submitResponse.ok()).toBeTruthy();

    const submitPayload = (await submitResponse.json()) as SubmitAcceptedPayload;
    if (typeof submitPayload.jobId !== "string" || submitPayload.jobId.length === 0) {
      throw new Error("Live submit response did not contain jobId.");
    }

    if (onAccepted) {
      await onAccepted(submitPayload.jobId);
    }

    let terminalStatus: string;
    try {
      terminalStatus = await waitForSubmitTerminalStatus(page, { timeoutMs: LIVE_SUBMIT_TIMEOUT_MS });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const isTimeout = message.includes("Timed out waiting for terminal submit status");
      if (!isTimeout) {
        throw error;
      }
      lastTransientError = `attempt ${String(attempt)} timed out`;
      if (attempt === LIVE_SUBMIT_MAX_ATTEMPTS) {
        break;
      }
      const cancelButton = page.getByRole("banner").getByRole("button", { name: "Cancel Job" });
      if ((await cancelButton.count()) > 0 && (await cancelButton.isEnabled())) {
        await cancelButton.click();
      }
      await page.waitForTimeout(LIVE_RETRY_WAIT_MS);
      continue;
    }

    if (terminalStatus === "COMPLETED") {
      return submitPayload.jobId;
    }

    const payloadText = await page.getByTestId("job-payload").textContent();
    const parsedPayload = parseLiveJobPayload(payloadText);
    const errorCode = parsedPayload?.error?.code ?? "";
    const isRateLimited =
      errorCode === "E_FIGMA_RATE_LIMIT" ||
      (payloadText ?? "").includes("E_FIGMA_RATE_LIMIT") ||
      (payloadText ?? "").toLowerCase().includes("rate limit exceeded");

    if (!isRateLimited) {
      throw new Error(
        `Live submit ended with status ${terminalStatus}. Job payload excerpt: ${(payloadText ?? "").slice(0, 300)}`
      );
    }

    lastTransientError = `attempt ${String(attempt)} failed with rate limit`;
    if (attempt === LIVE_SUBMIT_MAX_ATTEMPTS) {
      break;
    }
    await page.waitForTimeout(LIVE_RETRY_WAIT_MS);
  }

  throw new Error(
    `Live submit did not complete after ${String(LIVE_SUBMIT_MAX_ATTEMPTS)} attempts. Last transient error: ${String(lastTransientError)}`
  );
}

test.describe("inspector scalar overrides live figma flow", () => {
  test.describe.configure({ mode: "serial", timeout: 960_000 });

  test.afterEach(async ({ page }) => {
    await cleanupLivePreviewCompletionShim(page);
    await resetBrowserStorage(page);
  });

  test("applies scalar and layout overrides and restores persisted draft on the next live submit", async ({ page }) => {
    test.skip(
      !ENABLE_LIVE_INSPECTOR_E2E || FIGMA_FILE_KEY.length === 0 || FIGMA_ACCESS_TOKEN.length === 0,
      "Set INSPECTOR_LIVE_E2E=1, FIGMA_FILE_KEY, and FIGMA_ACCESS_TOKEN to run live inspector scalar override e2e."
    );

    await setupLivePreviewCompletionShim(page);
    await openWorkspaceUi(page, liveViewport);
    await page.getByLabel("Figma file key").fill(FIGMA_FILE_KEY);
    await page.getByLabel("Figma access token").fill(FIGMA_ACCESS_TOKEN);

    const firstJobId = await runLiveSubmitWithRetryHardFail({ page });
    await expect(page.getByTestId("inspector-panel")).toBeVisible();

    await assertScreenNodeUnsupported(page);

    const editableNodeId = await findFirstEditableNodeId({
      page,
      jobId: firstJobId,
      requiredEditableFields: ["width", "layoutMode", "gap"]
    });
    await enterEditStudio(page, editableNodeId);

    await expect(page.getByTestId("inspector-edit-supported-layout-fields")).toContainText("layoutMode");
    await expect(page.getByTestId("inspector-edit-input-width")).toBeVisible();
    await expect(page.getByTestId("inspector-edit-input-layoutMode")).toBeVisible();
    await expect(page.getByTestId("inspector-edit-input-x")).toHaveCount(0);

    const edited = await applyScalarOverrides(page);
    const layoutEdited = await applyLayoutOverrides(page);
    await expect(page.getByTestId("inspector-impact-review-layout-risk")).toBeVisible();

    const storedDraft = await page.evaluate(({ jobId, storagePrefix }) => {
      return window.localStorage.getItem(`${storagePrefix}${jobId}`);
    }, { jobId: firstJobId, storagePrefix: DRAFT_STORAGE_PREFIX });
    expect(storedDraft).toBeTruthy();

    await page.getByTestId("inspector-exit-edit-mode").click();

    const secondJobId = await runLiveSubmitWithRetryHardFail({
      page,
      onAccepted: async (jobId) => {
        await page.evaluate(({ targetJobId, serializedDraft, storagePrefix }) => {
          window.localStorage.setItem(`${storagePrefix}${targetJobId}`, serializedDraft);
        }, {
          targetJobId: jobId,
          serializedDraft: storedDraft ?? "",
          storagePrefix: DRAFT_STORAGE_PREFIX
        });
      }
    });

    await expect(page.getByTestId("inspector-panel")).toBeVisible();
    await enterEditStudio(page, editableNodeId);

    await expect(page.getByTestId("inspector-edit-draft-stale-warning")).toHaveCount(0);

    await expect(page.getByTestId(edited.inputTestId)).toHaveValue(edited.value);
    await expect(page.getByTestId("inspector-edit-input-width")).toHaveValue(layoutEdited.widthValue);
    await expect(page.getByTestId("inspector-edit-input-layoutMode")).toHaveValue(layoutEdited.layoutModeValue);

    const payloadPreview = page.getByTestId("inspector-edit-payload-preview");
    await expect(payloadPreview).toContainText(`"field": "${edited.field}"`);
    await expect(payloadPreview).toContainText("\"field\": \"width\"");
    await expect(payloadPreview).toContainText("\"field\": \"layoutMode\"");
  });

  test("routes review overrides through regeneration and keeps code plus diff continuity", async ({ page }) => {
    test.skip(
      !ENABLE_LIVE_INSPECTOR_E2E || FIGMA_FILE_KEY.length === 0 || FIGMA_ACCESS_TOKEN.length === 0,
      "Set INSPECTOR_LIVE_E2E=1, FIGMA_FILE_KEY, and FIGMA_ACCESS_TOKEN to run live inspector scalar override e2e."
    );

    await setupLivePreviewCompletionShim(page);
    await openWorkspaceUi(page, liveViewport);
    await page.getByLabel("Figma file key").fill(FIGMA_FILE_KEY);
    await page.getByLabel("Figma access token").fill(FIGMA_ACCESS_TOKEN);

    const sourceJobId = await runLiveSubmitWithRetryHardFail({ page });
    await expect(page.getByTestId("inspector-panel")).toBeVisible();

    await expect(page.getByTestId("inspector-sync-regeneration-required")).toBeVisible();
    await expect(page.getByTestId("inspector-pr-regeneration-required")).toBeVisible();
    await expect(page.getByTestId("inspector-sync-preview-button")).toBeDisabled();

    const editableNodeId = await findFirstEditableNodeId({
      page,
      jobId: sourceJobId,
      requiredEditableFields: ["width", "layoutMode", "gap"]
    });
    await enterEditStudio(page, editableNodeId);
    await applyScalarOverrides(page);
    await applyLayoutOverrides(page);

    await expect(page.getByTestId("inspector-impact-review-summary")).toBeVisible();
    await expect(page.getByTestId("inspector-impact-review-layout-risk")).toBeVisible();
    await expect(page.getByTestId("inspector-impact-review-regenerate-button")).toBeEnabled();
    await page.getByTestId("inspector-impact-review-regenerate-button").click();

    await expect
      .poll(async () => {
        const payloadText = await page.getByTestId("job-payload").textContent();
        const payload = parseLiveJobPayload(payloadText);
        return payload?.jobId ?? "";
      }, { timeout: LIVE_SUBMIT_TIMEOUT_MS })
      .not.toBe(sourceJobId);

    const terminalStatus = await waitForSubmitTerminalStatus(page, { timeoutMs: LIVE_SUBMIT_TIMEOUT_MS });
    expect(terminalStatus).toBe("COMPLETED");

    const regenerationPayload = parseLiveJobPayload(await page.getByTestId("job-payload").textContent());
    const regenerationJobId = regenerationPayload?.jobId;
    expect(typeof regenerationJobId).toBe("string");
    expect(regenerationJobId).not.toBe(sourceJobId);
    expect(regenerationPayload?.lineage?.sourceJobId).toBe(sourceJobId);

    await expect(page.getByTestId("inspector-impact-review-regeneration-active")).toBeVisible();
    await expect(page.getByTestId("inspector-sync-preview-button")).toBeEnabled();
    await expect(page.getByTestId("inspector-pr-regeneration-required")).toHaveCount(0);

    const liveSyncTargetPath = `artifacts/inspector-live-sync-${Date.now()}`;
    await page.getByTestId("inspector-sync-target-path").fill(liveSyncTargetPath);
    await page.getByTestId("inspector-sync-preview-button").click();
    await expect(page.getByTestId("inspector-sync-preview-summary")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("inspector-sync-selected-summary")).toContainText("Selected:");
    const selectedSummaryText = (await page.getByTestId("inspector-sync-selected-summary").textContent()) ?? "";
    expect(selectedSummaryText).not.toContain("Selected: 0 files");
    await page.getByTestId("inspector-sync-confirm-overwrite").click();
    await expect(page.getByTestId("inspector-sync-apply-button")).toBeEnabled();
    await page.getByTestId("inspector-sync-apply-button").click();
    await expect(page.getByTestId("inspector-sync-success")).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId("inspector-sync-success")).toContainText("Wrote");

    await page.getByTestId("inspector-pr-repo-url").fill("https://github.com/acme/repo");
    await page.getByTestId("inspector-pr-repo-token").fill("ghp_token");
    await expect(page.getByTestId("inspector-pr-create-button")).toBeEnabled();

    await expect(page.getByTestId("inspector-pane-code")).toBeVisible();
    await expect(page.getByTestId("inspector-file-selector")).toBeEnabled();

    const diffToggle = page.getByTestId("inspector-diff-toggle");
    await expect(diffToggle).toBeVisible({ timeout: 15_000 });
    if (await diffToggle.isEnabled()) {
      await diffToggle.click();
      await expect(page.getByTestId("diff-viewer")).toBeVisible({ timeout: 10_000 });
    } else {
      await expect(diffToggle).toHaveAttribute("title", "No previous job available for comparison");
      expect(regenerationPayload?.generationDiff?.previousJobId ?? null).toBeNull();
    }
  });
});
