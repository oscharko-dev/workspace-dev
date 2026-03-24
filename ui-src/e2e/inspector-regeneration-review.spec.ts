import { expect, test, type Page } from "@playwright/test";
import {
  cleanupDeterministicSubmitRoute,
  ensureWorkspaceDiagnosticsVisible,
  getInspectorLocators,
  openInspector,
  openInspectorDialog,
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function extractJobPayloadRecord(value: Record<string, unknown>): Record<string, unknown> | null {
  if (typeof value.jobId === "string") {
    return value;
  }

  if (isRecord(value.payload) && typeof value.payload.jobId === "string") {
    return value.payload;
  }

  if (isRecord(value.result) && isRecord(value.result.payload) && typeof value.result.payload.jobId === "string") {
    return value.result.payload;
  }

  return null;
}

async function readActiveJobId(page: Page): Promise<string> {
  await ensureWorkspaceDiagnosticsVisible(page, {
    buttonLabel: "Job diagnostics",
    payloadTestId: "job-payload"
  });

  const payloadText = await page.getByTestId("job-payload").textContent();
  const payload = parseJsonRecord(payloadText);
  const resolvedPayload = extractJobPayloadRecord(payload);
  const jobId = resolvedPayload?.jobId;
  if (typeof jobId !== "string" || jobId.length === 0) {
    throw new Error("Could not resolve active jobId from runtime payload.");
  }
  return jobId;
}

async function closeConfigDialog(page: Page): Promise<void> {
  const closeButton = page.getByRole("button", { name: "Close dialog" });
  await expect(closeButton).toBeVisible();
  await closeButton.click();
  await expect(closeButton).toHaveCount(0);
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
    if (!capabilityText?.startsWith("Edit: ")) {
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

async function waitForRegeneratedInspectorSources(page: Page): Promise<void> {
  const diffToggle = page.getByTestId("inspector-diff-toggle");
  const readyStatuses = [
    page.getByTestId("inspector-source-files-ready"),
    page.getByTestId("inspector-source-design-ir-ready"),
    page.getByTestId("inspector-source-component-manifest-ready"),
    page.getByTestId("inspector-source-file-content-ready")
  ] as const;
  const retryButtons = [
    page.getByTestId("inspector-banner-retry-files"),
    page.getByTestId("inspector-retry-files"),
    page.getByTestId("inspector-banner-retry-design-ir"),
    page.getByTestId("inspector-retry-design-ir"),
    page.getByTestId("inspector-banner-retry-component-manifest"),
    page.getByTestId("inspector-banner-retry-file-content"),
    page.getByTestId("inspector-retry-file-content")
  ] as const;

  for (let attempt = 0; attempt < 90; attempt += 1) {
    const statusesReady = await Promise.all(
      readyStatuses.map(async (statusBadge) => {
        const count = await statusBadge.count().catch(() => 0);
        if (count === 0) {
          return false;
        }
        return statusBadge.isVisible().catch(() => false);
      })
    );

    if (statusesReady.every(Boolean) && await diffToggle.isEnabled().catch(() => false)) {
      return;
    }

    for (const retryButton of retryButtons) {
      const count = await retryButton.count().catch(() => 0);
      if (count === 0) {
        continue;
      }

      if (await retryButton.isVisible().catch(() => false)) {
        await retryButton.click({ timeout: 1_000 }).catch(() => {});
      }
    }

    await page.waitForTimeout(1_000);
  }

  for (const statusBadge of readyStatuses) {
    await expect(statusBadge).toBeVisible();
  }
  await expect(diffToggle).toBeEnabled();
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
    await openInspector(page);

    await openInspectorDialog(page, "Review");
    await expect(page.getByTestId("inspector-impact-review-empty")).toBeVisible();
    await closeConfigDialog(page);

    await openInspectorDialog(page, "Sync");
    await expect(page.getByTestId("inspector-sync-regeneration-required")).toBeVisible();
    await expect(page.getByTestId("inspector-sync-preview-button")).toBeDisabled();
    await closeConfigDialog(page);

    await openInspectorDialog(page, "PR");
    await expect(page.getByTestId("inspector-pr-regeneration-required")).toBeVisible();
    await page.getByTestId("inspector-pr-repo-url").fill("https://github.com/acme/repo");
    await page.getByTestId("inspector-pr-repo-token").fill("ghp_test_token");
    await expect(page.getByTestId("inspector-pr-create-button")).toBeDisabled();
    await closeConfigDialog(page);

    const editableNodeId = await findFirstEditableNodeId(page);
    await page.getByTestId(`tree-node-${editableNodeId}`).click();
    await page.getByTestId("inspector-enter-edit-mode").click();
    await expect(page.getByTestId("inspector-edit-studio-panel")).toBeVisible();

    await applySingleOverride(page);

    await openInspectorDialog(page, "Review");
    await expect(page.getByTestId("inspector-impact-review-summary")).toBeVisible();
    await expect(page.getByTestId("inspector-impact-review-summary-total")).toContainText("Total overrides: 1");

    const regenerateButton = page.getByTestId("inspector-impact-review-regenerate-button");
    await expect(regenerateButton).toBeEnabled();
    await regenerateButton.click();

    await expect(page.getByTestId("inspector-impact-review-regeneration-active")).toBeVisible();
    await closeConfigDialog(page);
    await waitForRegeneratedInspectorSources(page);

    await openInspectorDialog(page, "Sync");
    await expect(page.getByTestId("inspector-sync-regeneration-required")).toHaveCount(0);
    await expect(page.getByTestId("inspector-sync-preview-button")).toBeEnabled();
    await closeConfigDialog(page);

    await openInspectorDialog(page, "PR");
    await expect(page.getByTestId("inspector-pr-regeneration-required")).toHaveCount(0);
    await page.getByTestId("inspector-pr-repo-url").fill("https://github.com/acme/repo");
    await page.getByTestId("inspector-pr-repo-token").fill("ghp_test_token");
    await expect(page.getByTestId("inspector-pr-create-button")).toBeEnabled();
    await closeConfigDialog(page);

    const diffToggle = page.getByTestId("inspector-diff-toggle");
    await expect(diffToggle).toBeEnabled({ timeout: 60_000 });
    await diffToggle.click();
    await expect(page.getByTestId("diff-viewer")).toBeVisible();
  });
});
