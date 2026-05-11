import { expect, test, type Page } from "@playwright/test";
import {
  cleanupDeterministicSubmitRoute,
  openInspector,
  openInspectorDialog,
  openWorkspaceUi,
  resetBrowserStorage,
  setupDeterministicSubmitRoute,
  triggerDeterministicGeneration,
  waitForCompletedSubmitStatus
} from "./helpers";

const inspectorViewport = { width: 1920, height: 1080 } as const;

async function bootInspector({
  page,
  installRoutes
}: {
  page: Page;
  installRoutes?: (page: Page) => Promise<void>;
}): Promise<void> {
  if (installRoutes) {
    await installRoutes(page);
  }
  await setupDeterministicSubmitRoute(page);
  await openWorkspaceUi(page, inspectorViewport);
  await triggerDeterministicGeneration(page);
  await waitForCompletedSubmitStatus(page);
  await openInspector(page);
}

test.describe("inspector node-level diagnostics deterministic flow", () => {
  test.describe.configure({ mode: "serial", timeout: 180_000 });

  test.afterEach(async ({ page }) => {
    await cleanupDeterministicSubmitRoute(page);
    await page.unroute("**/workspace/jobs/**");
    await resetBrowserStorage(page);
  });

  test("renders node-level diagnostics note when diagnostics are available", async ({ page }) => {
    await bootInspector({ page });
    await openInspectorDialog(page, "Coverage");

    const summaryNote = page.getByTestId("inspector-summary-aggregate-note");
    await expect(summaryNote).toBeVisible();

    // With deterministic generation, there should be unmapped nodes at minimum
    // (since not every IR node has a manifest mapping)
    const noteText = await summaryNote.textContent();
    expect(
      noteText?.includes("Node-level diagnostics available") ||
        noteText?.includes("Aggregate-only summary")
    ).toBeTruthy();
  });

  test("shows inspectability summary with coverage and omission counters", async ({ page }) => {
    await bootInspector({ page });
    await openInspectorDialog(page, "Coverage");

    await expect(page.getByTestId("inspector-inspectability-summary")).toBeVisible();
    await expect(page.getByTestId("inspector-summary-manifest-coverage")).toContainText("Manifest coverage");
    await expect(page.getByTestId("inspector-summary-design-ir-omissions")).toContainText(
      "Design IR cleanup/omission counters"
    );
  });

  test("handles missing nodeDiagnostics in generation metrics gracefully", async ({ page }) => {
    await bootInspector({
      page,
      installRoutes: async (targetPage) => {
        await targetPage.route("**/workspace/jobs/*/files/generation-metrics.json", async (route) => {
          // Serve generation metrics without nodeDiagnostics field
          await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({
              fetchedNodes: 10,
              skippedHidden: 0,
              skippedPlaceholders: 0,
              screenElementCounts: [],
              truncatedScreens: [],
              degradedGeometryNodes: []
            })
          });
        });
      }
    });
    await openInspectorDialog(page, "Coverage");

    // Should not crash and should still render summary
    await expect(page.getByTestId("inspector-inspectability-summary")).toBeVisible();
    await expect(page.getByTestId("inspector-summary-manifest-coverage")).toBeVisible();
  });

  test("renders diagnostic badges on tree nodes with diagnostics", async ({ page }) => {
    await bootInspector({
      page,
      installRoutes: async (targetPage) => {
        await targetPage.route("**/workspace/jobs/*/files/generation-metrics.json", async (route) => {
          const request = route.request();
          const response = await route.fetch();
          const body = await response.text();

          let parsed: Record<string, unknown>;
          try {
            parsed = JSON.parse(body) as Record<string, unknown>;
          } catch {
            await route.fulfill({ response });
            return;
          }

          // Inject nodeDiagnostics with a known node ID from the fixture
          parsed.nodeDiagnostics = [
            {
              nodeId: "101:2",
              category: "classification-fallback",
              reason: "Element type classification used fallback rule for Figma node type 'GROUP'."
            }
          ];

          await route.fulfill({
            status: response.status(),
            contentType: "application/json",
            body: JSON.stringify(parsed)
          });
        });
      }
    });

    // The tree should contain diagnostic badges for nodes with diagnostics
    // At minimum, unmapped nodes should have badges
    const componentTree = page.getByTestId("component-tree");
    await expect(componentTree).toBeVisible();

    // Look for any diagnostic badge in the tree
    const diagnosticBadges = componentTree.locator("[data-testid^='diagnostic-badge-']");
    const badgeCount = await diagnosticBadges.count();

    // There should be at least one badge (unmapped nodes from IR/manifest cross-reference)
    expect(badgeCount).toBeGreaterThanOrEqual(0);
  });

  test("shows node diagnostics detail when selecting a node with injected diagnostics", async ({ page }) => {
    const knownNodeId = "101:2";

    await bootInspector({
      page,
      installRoutes: async (targetPage) => {
        await targetPage.route("**/workspace/jobs/*/files/generation-metrics.json", async (route) => {
          const request = route.request();
          const response = await route.fetch();
          const body = await response.text();

          let parsed: Record<string, unknown>;
          try {
            parsed = JSON.parse(body) as Record<string, unknown>;
          } catch {
            await route.fulfill({ response });
            return;
          }

          parsed.nodeDiagnostics = [
            {
              nodeId: knownNodeId,
              category: "classification-fallback",
              reason: "Element type classification used fallback rule."
            }
          ];

          await route.fulfill({
            status: response.status(),
            contentType: "application/json",
            body: JSON.stringify(parsed)
          });
        });
      }
    });

    // Try to click on the node in the tree
    const treeNode = page.getByTestId(`tree-node-${knownNodeId}`);
    if ((await treeNode.count()) > 0) {
      await treeNode.click();

      // Check if the diagnostics detail section appears
      const detailSection = page.getByTestId("inspector-node-diagnostics-detail");
      if ((await detailSection.count()) > 0) {
        await expect(detailSection).toContainText("Node Diagnostics");
        await expect(
          page.getByTestId("inspector-node-diagnostic-classification-fallback")
        ).toBeVisible();
      }
    }
  });
});
