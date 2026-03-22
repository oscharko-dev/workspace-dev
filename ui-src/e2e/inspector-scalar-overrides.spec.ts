import { expect, test, type Page } from "@playwright/test";
import {
  cleanupDeterministicSubmitRoute,
  getInspectorLocators,
  openWorkspaceUi,
  resetBrowserStorage,
  setupDeterministicSubmitRoute,
  triggerDeterministicGeneration,
  waitForCompletedSubmitStatus
} from "./helpers";

const scalarViewport = { width: 1920, height: 1080 } as const;
const SUBMIT_ENDPOINT_SUFFIX = "/workspace/submit";
const DRAFT_STORAGE_PREFIX = "workspace-dev:inspector-override-draft:v1:";

interface SubmitAcceptedPayload {
  jobId?: string;
}

function parseJsonObject(value: string | null): Record<string, unknown> {
  if (!value) {
    return {};
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    return parsed as Record<string, unknown>;
  } catch {
    return {};
  }
}

async function readActiveJobId(page: Page): Promise<string> {
  const payloadText = await page.getByTestId("job-payload").textContent();
  const payload = parseJsonObject(payloadText);
  const jobId = payload.jobId;
  if (typeof jobId !== "string" || jobId.length === 0) {
    throw new Error("Could not determine active jobId from runtime payload.");
  }
  return jobId;
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

async function findFirstEditableNodeId(page: Page): Promise<string> {
  const { componentTree } = getInspectorLocators(page);
  const nodes = componentTree.getByTestId(/^tree-node-/);
  const nodeCount = await nodes.count();

  for (let index = 0; index < nodeCount; index += 1) {
    const node = nodes.nth(index);
    await node.click();
    await expect(page.getByTestId("inspector-edit-capability")).toBeVisible();

    const capabilityText = await page.getByTestId("inspector-edit-capability").textContent();
    if (!capabilityText?.includes("Edit Capability: Supported")) {
      continue;
    }

    const nodeId = await node.getAttribute("data-node-id");
    if (typeof nodeId === "string" && nodeId.length > 0) {
      return nodeId;
    }
  }

  throw new Error("No editable node was found in deterministic inspector tree.");
}

async function enterEditStudio(page: Page, nodeId: string): Promise<void> {
  await page.getByTestId(`tree-node-${nodeId}`).click();
  const enterEditModeButton = page.getByTestId("inspector-enter-edit-mode");
  await expect(enterEditModeButton).toBeEnabled();
  await enterEditModeButton.click();
  await expect(page.getByTestId("inspector-edit-studio-panel")).toBeVisible();
}

async function applyScalarOverrides(page: Page): Promise<{
  stringField: "fillColor" | "fontFamily";
  stringValue: string;
  numericField: "opacity" | "cornerRadius" | "fontSize" | "fontWeight" | "gap";
  numericValue: string;
}> {
  const stringField: "fillColor" | "fontFamily" =
    (await page.getByTestId("inspector-edit-input-fillColor").count()) > 0 ? "fillColor" : "fontFamily";

  const stringValue = stringField === "fillColor" ? "#13a24b" : "Source Sans Pro";
  const stringInput = page.getByTestId(`inspector-edit-input-${stringField}`);
  await stringInput.fill(stringValue);
  await stringInput.blur();

  const numericCandidates: Array<{
    field: "opacity" | "cornerRadius" | "fontSize" | "fontWeight" | "gap";
    value: string;
  }> = [
    { field: "opacity", value: "0.65" },
    { field: "fontSize", value: "22" },
    { field: "fontWeight", value: "700" },
    { field: "cornerRadius", value: "12" },
    { field: "gap", value: "18" }
  ];

  const numericCandidate = await (async () => {
    for (const candidate of numericCandidates) {
      if ((await page.getByTestId(`inspector-edit-input-${candidate.field}`).count()) > 0) {
        return candidate;
      }
    }
    return null;
  })();

  if (!numericCandidate) {
    throw new Error("No numeric scalar override field is available for the selected deterministic node.");
  }

  const numericInput = page.getByTestId(`inspector-edit-input-${numericCandidate.field}`);
  await numericInput.fill(numericCandidate.value);
  await numericInput.blur();

  const payloadPreview = page.getByTestId("inspector-edit-payload-preview");
  await expect(payloadPreview).toContainText(`"field": "${stringField}"`);
  await expect(payloadPreview).toContainText(`"field": "${numericCandidate.field}"`);

  return {
    stringField,
    stringValue,
    numericField: numericCandidate.field,
    numericValue: numericCandidate.value
  };
}

async function submitDeterministicWithInjectedDraft({
  page,
  draftJson
}: {
  page: Page;
  draftJson: string;
}): Promise<string> {
  const submitResponsePromise = page.waitForResponse((response) => {
    return response.request().method() === "POST" && response.url().endsWith(SUBMIT_ENDPOINT_SUFFIX);
  });

  await page.getByRole("banner").getByRole("button", { name: "Generate" }).click();

  const submitResponse = await submitResponsePromise;
  expect(submitResponse.ok()).toBeTruthy();
  const payload = (await submitResponse.json()) as SubmitAcceptedPayload;
  if (typeof payload.jobId !== "string" || payload.jobId.length === 0) {
    throw new Error("Submit response did not include a jobId.");
  }

  await page.evaluate(({ jobId, serializedDraft, storagePrefix }) => {
    window.localStorage.setItem(`${storagePrefix}${jobId}`, serializedDraft);
  }, { jobId: payload.jobId, serializedDraft: draftJson, storagePrefix: DRAFT_STORAGE_PREFIX });

  return payload.jobId;
}

test.describe("inspector scalar overrides deterministic flow", () => {
  test.describe.configure({ mode: "serial", timeout: 240_000 });

  test.beforeEach(async ({ page }) => {
    await setupDeterministicSubmitRoute(page);
    await openWorkspaceUi(page, scalarViewport);
    await triggerDeterministicGeneration(page);
    await waitForCompletedSubmitStatus(page);
  });

  test.afterEach(async ({ page }) => {
    await cleanupDeterministicSubmitRoute(page);
    await resetBrowserStorage(page);
  });

  test("edits scalar overrides, excludes deferred controls, and restores persisted draft into a new matching job", async ({ page }) => {
    await assertScreenNodeUnsupported(page);

    const editableNodeId = await findFirstEditableNodeId(page);
    await enterEditStudio(page, editableNodeId);

    await expect(page.getByTestId("inspector-edit-v1-deferred-fields")).toHaveText(
      "Deferred in v1: width, height, layoutMode."
    );
    await expect(page.getByTestId("inspector-edit-input-width")).toHaveCount(0);
    await expect(page.getByTestId("inspector-edit-input-height")).toHaveCount(0);
    await expect(page.getByTestId("inspector-edit-input-layoutMode")).toHaveCount(0);

    const edited = await applyScalarOverrides(page);

    const firstJobId = await readActiveJobId(page);
    const persistedDraftJson = await page.evaluate(({ jobId, storagePrefix }) => {
      return window.localStorage.getItem(`${storagePrefix}${jobId}`);
    }, { jobId: firstJobId, storagePrefix: DRAFT_STORAGE_PREFIX });
    expect(persistedDraftJson).toBeTruthy();

    await page.getByTestId("inspector-exit-edit-mode").click();

    const secondJobId = await submitDeterministicWithInjectedDraft({
      page,
      draftJson: persistedDraftJson ?? ""
    });
    await waitForCompletedSubmitStatus(page);

    const activeSecondJobId = await readActiveJobId(page);
    expect(activeSecondJobId).toBe(secondJobId);

    const restoredDraftJson = await page.evaluate(({ jobId, storagePrefix }) => {
      return window.localStorage.getItem(`${storagePrefix}${jobId}`);
    }, { jobId: secondJobId, storagePrefix: DRAFT_STORAGE_PREFIX });
    expect(restoredDraftJson).toBeTruthy();

    await enterEditStudio(page, editableNodeId);
    await expect(page.getByTestId("inspector-edit-draft-stale-warning")).toHaveCount(0);

    const restoredStringInput = page.getByTestId(`inspector-edit-input-${edited.stringField}`);
    await expect(restoredStringInput).toHaveValue(edited.stringValue);

    const restoredNumericInput = page.getByTestId(`inspector-edit-input-${edited.numericField}`);
    await expect(restoredNumericInput).toHaveValue(edited.numericValue);

    const restoredPayloadPreview = page.getByTestId("inspector-edit-payload-preview");
    await expect(restoredPayloadPreview).toContainText(`"field": "${edited.stringField}"`);
    await expect(restoredPayloadPreview).toContainText(`"field": "${edited.numericField}"`);
  });
});
