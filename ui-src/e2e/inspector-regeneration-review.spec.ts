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

const reviewViewport = { width: 1920, height: 1080 } as const;

function parseJsonRecord(value: string | null): Record<string, unknown> {
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

async function readActiveJobPayload(page: Page): Promise<Record<string, unknown>> {
  const payloadTexts = await page.getByTestId("job-payload").allTextContents();
  for (const payloadText of payloadTexts) {
    const parsed = parseJsonRecord(payloadText);
    if (typeof parsed.jobId === "string") {
      return parsed;
    }
  }

  const fallback = payloadTexts[0] ?? null;
  return parseJsonRecord(fallback);
}

async function readActiveJobId(page: Page): Promise<string> {
  const payload = await readActiveJobPayload(page);
  const jobId = payload.jobId;
  if (typeof jobId !== "string" || jobId.length === 0) {
    throw new Error("Could not resolve active jobId from runtime payload.");
  }
  return jobId;
}

async function findFirstEditableNodeId(page: Page): Promise<string> {
  const { componentTree } = getInspectorLocators(page);
  const nodes = componentTree.getByTestId(/^tree-node-/);
  const nodeCount = await nodes.count();

  for (let index = 0; index < nodeCount; index += 1) {
    const node = nodes.nth(index);
    await node.click();
    const capabilityPanel = page.getByTestId("inspector-edit-capability");
    await expect(capabilityPanel).toBeVisible();
    const capabilityText = await capabilityPanel.textContent();
    if (!capabilityText?.includes("Edit Capability: Supported")) {
      continue;
    }

    const nodeId = await node.getAttribute("data-node-id");
    if (typeof nodeId === "string" && nodeId.length > 0) {
      return nodeId;
    }
  }

  throw new Error("No editable node found in deterministic inspector tree.");
}

async function applySingleOverride(page: Page): Promise<void> {
  const fieldCandidates = [
    { field: "fillColor", value: "#2388dd" },
    { field: "fontFamily", value: "Source Sans Pro" },
    { field: "opacity", value: "0.6" },
    { field: "fontSize", value: "22" },
    { field: "fontWeight", value: "700" },
    { field: "cornerRadius", value: "8" },
    { field: "gap", value: "14" }
  ] as const;

  for (const candidate of fieldCandidates) {
    const input = page.getByTestId(`inspector-edit-input-${candidate.field}`);
    if ((await input.count()) === 0) {
      continue;
    }
    await input.fill(candidate.value);
    await input.blur();
    await expect(page.getByTestId("inspector-edit-payload-preview")).toContainText(`"field": "${candidate.field}"`);
    return;
  }

  throw new Error("No editable scalar field input available for deterministic override test.");
}

test.describe("inspector regeneration review deterministic flow", () => {
  test.describe.configure({ mode: "serial", timeout: 360_000 });

  test.beforeEach(async ({ page }) => {
    await setupDeterministicSubmitRoute(page);
    await openWorkspaceUi(page, reviewViewport);
  });

  test.afterEach(async ({ page }) => {
    await cleanupDeterministicSubmitRoute(page);
    await resetBrowserStorage(page);
  });

  test("supports edit -> pre-apply review -> regenerate -> diff/code continuity", async ({ page }) => {
    await triggerDeterministicGeneration(page);
    await waitForCompletedSubmitStatus(page);

    const sourceJobId = await readActiveJobId(page);

    await expect(page.getByTestId("inspector-impact-review-panel")).toBeVisible();
    await expect(page.getByTestId("inspector-impact-review-empty")).toBeVisible();
    await expect(page.getByTestId("inspector-sync-regeneration-required")).toBeVisible();
    await expect(page.getByTestId("inspector-pr-regeneration-required")).toBeVisible();
    await expect(page.getByTestId("inspector-sync-preview-button")).toBeDisabled();

    await page.getByTestId("inspector-pr-repo-url").fill("https://github.com/acme/repo");
    await page.getByTestId("inspector-pr-repo-token").fill("ghp_test_token");
    await expect(page.getByTestId("inspector-pr-create-button")).toBeDisabled();

    const editableNodeId = await findFirstEditableNodeId(page);
    await page.getByTestId(`tree-node-${editableNodeId}`).click();
    await page.getByTestId("inspector-enter-edit-mode").click();
    await expect(page.getByTestId("inspector-edit-studio-panel")).toBeVisible();

    await applySingleOverride(page);

    await expect(page.getByTestId("inspector-impact-review-summary")).toBeVisible();
    await expect(page.getByTestId("inspector-impact-review-summary-total")).toContainText("Total overrides: 1");

    const regenerateButton = page.getByTestId("inspector-impact-review-regenerate-button");
    await expect(regenerateButton).toBeEnabled();
    await regenerateButton.click();

    await waitForCompletedSubmitStatus(page);

    const regenerationPayload = await readActiveJobPayload(page);
    expect(typeof regenerationPayload.jobId === "string").toBeTruthy();
    expect(regenerationPayload.jobId).not.toBe(sourceJobId);

    const lineage = regenerationPayload.lineage as { sourceJobId?: string } | undefined;
    expect(lineage?.sourceJobId).toBe(sourceJobId);

    await expect(page.getByTestId("inspector-impact-review-regeneration-active")).toBeVisible();
    await expect(page.getByTestId("inspector-sync-preview-button")).toBeEnabled();
    await expect(page.getByTestId("inspector-pr-regeneration-required")).toHaveCount(0);

    await page.getByTestId("inspector-pr-repo-url").fill("https://github.com/acme/repo");
    await page.getByTestId("inspector-pr-repo-token").fill("ghp_test_token");
    await expect(page.getByTestId("inspector-pr-create-button")).toBeEnabled();

    const diffToggle = page.getByTestId("inspector-diff-toggle");
    await expect(diffToggle).toBeEnabled({ timeout: 15_000 });
    await diffToggle.click();
    await expect(page.getByTestId("diff-viewer")).toBeVisible();
  });
});
