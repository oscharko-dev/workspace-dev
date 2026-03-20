import { expect, test, type Page } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const UI_URL = process.env.WORKSPACE_DEV_UI_URL ?? "http://127.0.0.1:19831/workspace/ui";
const FIXTURE_PATH = path.resolve(
  fileURLToPath(new URL("../../src/parity/fixtures/golden/prototype-navigation/figma.json", import.meta.url))
);

const setupDeterministicSubmit = async (page: Page): Promise<void> => {
  await page.route("**/workspace/submit", async (route) => {
    const request = route.request();
    if (request.method() !== "POST") {
      await route.continue();
      return;
    }

    const rawPayload = request.postDataJSON() as Record<string, unknown>;
    const rewritten: Record<string, unknown> = {
      ...rawPayload,
      figmaSourceMode: "local_json",
      figmaJsonPath: FIXTURE_PATH,
      llmCodegenMode: "deterministic",
      enableGitPr: false
    };
    delete rewritten.figmaFileKey;
    delete rewritten.figmaAccessToken;

    await route.continue({
      headers: {
        ...request.headers(),
        "content-type": "application/json"
      },
      postData: JSON.stringify(rewritten)
    });
  });
};

const waitForCompletedStatus = async (page: Page): Promise<void> => {
  const submitStatusBadge = page
    .getByTestId("runtime-card")
    .locator("p")
    .filter({ hasText: "Submit:" })
    .locator("span")
    .first();

  const terminalStatus = await expect
    .poll(
      async () => {
        return (await submitStatusBadge.textContent())?.trim() ?? "";
      },
      {
        timeout: 120_000,
        intervals: [500, 1_000, 2_000]
      }
    )
    .toMatch(/^(COMPLETED|FAILED|CANCELED)$/)
    .then(async () => {
      return (await submitStatusBadge.textContent())?.trim() ?? "";
    });

  expect(terminalStatus).toBe("COMPLETED");
};

test("Inspector e2e: full deterministic flow from submit to inspect sync", async ({ page }) => {
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

  await setupDeterministicSubmit(page);

  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto(UI_URL);

  await expect(page.getByRole("heading", { name: "Workspace Dev" })).toBeVisible();

  await page.getByLabel("Figma file key").fill("fixture-key");
  await page.getByLabel("Figma access token").fill("fixture-token");
  await page.getByRole("banner").getByRole("button", { name: "Generate" }).click();

  await waitForCompletedStatus(page);

  const inspectorPanel = page.getByTestId("inspector-panel");
  await expect(inspectorPanel).toBeVisible();

  const componentTree = page.getByTestId("component-tree");
  const previewFrame = page.frameLocator("iframe[title='Live preview']");
  const codeViewer = page.getByTestId("code-viewer");

  await expect(componentTree).toBeVisible();
  await expect(page.locator("iframe[title='Live preview']")).toBeVisible();
  await expect(codeViewer).toBeVisible();

  const fileSelector = page.getByTestId("inspector-file-selector");
  await expect(fileSelector).toBeVisible();
  const fileOptions = fileSelector.locator("option");
  const optionCount = await fileOptions.count();
  expect(optionCount).toBeGreaterThan(0);

  if (optionCount > 1) {
    const secondValue = await fileOptions.nth(1).getAttribute("value");
    expect(secondValue).toBeTruthy();
    await fileSelector.selectOption(secondValue!);
    await expect(page.getByTestId("code-viewer-filepath")).toHaveText(secondValue!);
  }

  const firstScreen = componentTree.locator("[data-testid^='tree-screen-']").first();
  await expect(firstScreen).toBeVisible();
  const collapseButton = firstScreen.locator("button[aria-label='Collapse']");
  await collapseButton.click();
  await expect(firstScreen.locator("button[aria-label='Expand']")).toBeVisible();
  await firstScreen.locator("button[aria-label='Expand']").click();
  await expect(firstScreen.locator("button[aria-label='Collapse']")).toBeVisible();

  const firstComponentNode = componentTree.locator("[data-testid^='tree-node-']").first();
  await expect(firstComponentNode).toBeVisible();
  await firstComponentNode.click();
  await expect(firstComponentNode).toHaveAttribute("aria-selected", "true");
  await expect(page.getByTestId("highlighted-line").first()).toBeVisible();

  const inspectToggle = page.getByTestId("inspect-toggle");
  await inspectToggle.click();
  await expect(inspectToggle).toHaveAttribute("aria-pressed", "true");

  const previewNodeIds = await previewFrame
    .locator("[data-ir-id]")
    .evaluateAll((elements) =>
      elements
        .map((el) => el.getAttribute("data-ir-id"))
        .filter((id): id is string => typeof id === "string" && id.length > 0)
    );
  expect(previewNodeIds.length).toBeGreaterThan(0);

  let syncedNodeId: string | null = null;
  for (const nodeId of previewNodeIds) {
    const treeNode = page.locator(`[data-testid='tree-node-${nodeId}']`);
    if ((await treeNode.count()) > 0) {
      syncedNodeId = nodeId;
      break;
    }
  }

  expect(syncedNodeId).toBeTruthy();
  await previewFrame.locator(`[data-ir-id='${syncedNodeId!}']`).first().click({ force: true });

  const syncedTreeNode = page.locator(`[data-testid='tree-node-${syncedNodeId!}']`);
  await expect(syncedTreeNode).toHaveAttribute("aria-selected", "true");
  await expect(page.getByTestId("code-content")).toBeVisible();

  const copyButton = page.getByTestId("inspector-copy-button");
  await expect(copyButton).toBeVisible();
  await copyButton.click();
  await expect(copyButton).toHaveText("Copied!");
});
