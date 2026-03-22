import { expect, test } from "@playwright/test";
import {
  cleanupDeterministicSubmitRoute,
  getInspectorLocators,
  installClipboardMock,
  openWorkspaceUi,
  resetBrowserStorage,
  setupDeterministicSubmitRoute,
  triggerDeterministicGeneration,
  waitForCompletedSubmitStatus
} from "./helpers";

const inspectorViewport = { width: 1920, height: 1080 } as const;
const LARGE_TREE_NODE_COUNT = 1_500;

interface DesignIrElementNode {
  id: string;
  name: string;
  type: string;
}

function buildLargeTreeChildren(): DesignIrElementNode[] {
  return Array.from({ length: LARGE_TREE_NODE_COUNT }, (_, index) => {
    const value = index + 1;
    return {
      id: `large-node-${String(value)}`,
      name: `Leaf ${String(value).padStart(4, "0")}`,
      type: "text"
    };
  });
}

test.describe("inspector large component tree deterministic flow", () => {
  test.describe.configure({ mode: "serial", timeout: 180_000 });

  test.beforeEach(async ({ page }) => {
    await installClipboardMock(page);
    await setupDeterministicSubmitRoute(page);

    await page.route("**/workspace/jobs/*/design-ir", async (route) => {
      const request = route.request();
      if (request.method() !== "GET") {
        await route.continue();
        return;
      }

      const url = new URL(request.url());
      const jobMatch = /\/workspace\/jobs\/([^/]+)\/design-ir$/.exec(url.pathname);
      const encodedJobId = jobMatch?.[1] ?? "unknown-job";
      const jobId = decodeURIComponent(encodedJobId);

      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          jobId,
          screens: [
            {
              id: "screen-large",
              name: "Large Screen",
              generatedFile: "src/screens/LargeScreen.tsx",
              children: buildLargeTreeChildren()
            }
          ]
        })
      });
    });

    await openWorkspaceUi(page, inspectorViewport);
    await triggerDeterministicGeneration(page);
    await waitForCompletedSubmitStatus(page);
  });

  test.afterEach(async ({ page }) => {
    await cleanupDeterministicSubmitRoute(page);
    await page.unroute("**/workspace/jobs/*/design-ir");
    await resetBrowserStorage(page);
  });

  test("virtualizes large trees and keeps search + keyboard interactions responsive", async ({ page }) => {
    const { componentTree } = getInspectorLocators(page);
    await expect(componentTree).toBeVisible();

    const totalCount = page.getByTestId("component-tree-total-count");
    await expect(totalCount).toHaveText(String(LARGE_TREE_NODE_COUNT + 1));

    // Virtualized rendering should keep mounted treeitems much smaller than total rows.
    const mountedTreeItems = await page.getByRole("treeitem").count();
    expect(mountedTreeItems).toBeLessThan(220);

    const searchInput = page.getByTestId("tree-search-input");
    await searchInput.fill("Leaf 1200");

    await expect(componentTree.getByText("Leaf 1200")).toBeVisible();
    await expect(totalCount).toHaveText("2");

    await searchInput.fill("");
    await expect(totalCount).toHaveText(String(LARGE_TREE_NODE_COUNT + 1));

    const tree = page.getByRole("tree", { name: "Component tree" });
    await tree.focus();
    for (let index = 0; index < 40; index += 1) {
      await page.keyboard.press("ArrowDown");
    }
    await page.keyboard.press("Enter");

    await expect(page.locator("[role='treeitem'][aria-selected='true']")).toHaveCount(1);
  });
});
