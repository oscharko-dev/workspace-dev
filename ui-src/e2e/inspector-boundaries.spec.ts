import { expect, test } from "@playwright/test";
import {
  cleanupDeterministicSubmitRoute,
  getInspectorLocators,
  openWorkspaceUi,
  resetBrowserStorage,
  setupDeterministicSubmitRoute,
  triggerDeterministicGeneration,
  waitForCompletedSubmitStatus
} from "./helpers";

const inspectorViewport = { width: 1920, height: 1080 } as const;

test.describe("inspector boundary gutters deterministic flow", () => {
  test.describe.configure({ mode: "serial", timeout: 180_000 });

  test.beforeEach(async ({ page }) => {
    await setupDeterministicSubmitRoute(page);

    await page.route("**/workspace/jobs/*/component-manifest*", async (route) => {
      const response = await route.fetch();
      const payload = (await response.json()) as {
        screens?: Array<{
          file?: string;
          components?: Array<Record<string, unknown>>;
        }>;
      };

      const firstScreen = payload.screens?.[0];
      const targetFile = firstScreen?.file;
      if (firstScreen && targetFile && Array.isArray(firstScreen.components)) {
        for (let i = 1; i <= 4; i += 1) {
          firstScreen.components.push({
            irNodeId: `synthetic-overlap-${String(i)}`,
            irNodeName: `Synthetic overlap ${String(i)}`,
            irNodeType: "container",
            file: targetFile,
            startLine: 1,
            endLine: 1
          });
        }
      }

      await route.fulfill({ response, json: payload });
    });

    await openWorkspaceUi(page, inspectorViewport);
    await triggerDeterministicGeneration(page);
    await waitForCompletedSubmitStatus(page);
  });

  test.afterEach(async ({ page }) => {
    await page.unroute("**/workspace/jobs/*/component-manifest*");
    await cleanupDeterministicSubmitRoute(page);
    await resetBrowserStorage(page);
  });

  test("renders toggleable gutter boundaries with tooltip and click sync", async ({ page }) => {
    const { codeViewer } = getInspectorLocators(page);
    await expect(codeViewer).toBeVisible();

    const boundariesToggle = page.getByTestId("code-viewer-boundaries-toggle");
    await expect(boundariesToggle).toHaveText("Boundaries: Off");

    await boundariesToggle.click();
    await expect(boundariesToggle).toHaveText("Boundaries: On");

    const markers = page.getByTestId(/^code-boundary-marker-/);
    await expect(markers.first()).toBeVisible();

    await expect(page.getByTestId("code-boundary-overflow-indicator-1")).toBeVisible();

    const markerNodeIds = await page.locator("[data-boundary-node-id]").evaluateAll((elements) => {
      return elements
        .map((element) => element.getAttribute("data-boundary-node-id"))
        .filter((nodeId): nodeId is string => typeof nodeId === "string" && nodeId.length > 0);
    });

    let syncedNodeId: string | null = null;
    for (const nodeId of markerNodeIds) {
      if ((await page.getByTestId(`tree-node-${nodeId}`).count()) > 0) {
        syncedNodeId = nodeId;
        break;
      }
    }

    expect(syncedNodeId, "Expected at least one boundary marker to map to a tree node").toBeTruthy();

    const syncedMarker = page.getByTestId(`code-boundary-marker-${syncedNodeId!}`).first();
    await syncedMarker.hover();

    const tooltip = page.getByTestId("code-boundary-tooltip");
    await expect(tooltip).toBeVisible();
    await expect(page.getByTestId("code-boundary-tooltip-name")).toHaveText(/.+/);
    await expect(page.getByTestId("code-boundary-tooltip-type")).toHaveText(/.+/);
    await expect(page.getByTestId("code-boundary-tooltip-range")).toHaveText(/Lines\s+\d+-\d+/);

    await syncedMarker.click();
    await expect(page.getByTestId(`tree-node-${syncedNodeId!}`)).toHaveAttribute("aria-selected", "true");
    await expect(page.getByTestId("highlighted-line").first()).toBeVisible();

    await boundariesToggle.click();
    await expect(boundariesToggle).toHaveText("Boundaries: Off");
    await expect(page.getByTestId(/^code-boundary-marker-/)).toHaveCount(0);
  });
});
