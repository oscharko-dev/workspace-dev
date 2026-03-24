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
  await openInspectorDialog(page, "Coverage");
}

test.describe("inspector inspectability summary deterministic flow", () => {
  test.describe.configure({ mode: "serial", timeout: 180_000 });

  test.afterEach(async ({ page }) => {
    await cleanupDeterministicSubmitRoute(page);
    await page.unroute("**/workspace/jobs/**");
    await resetBrowserStorage(page);
  });

  test("renders aggregate manifest coverage and Design IR omission counters", async ({ page }) => {
    await bootInspector({ page });

    await expect(page.getByTestId("inspector-inspectability-summary")).toBeVisible();
    await expect(page.getByTestId("inspector-summary-manifest-coverage")).toContainText("Manifest coverage");
    await expect(page.getByTestId("inspector-summary-design-ir-omissions")).toContainText(
      "Design IR cleanup/omission counters"
    );
    await expect(page.getByTestId("inspector-summary-mapped-count")).toContainText(/Mapped:\s+\d+/);
    await expect(page.getByTestId("inspector-summary-unmapped-count")).toContainText(/Unmapped:\s+\d+/);
    await expect(page.getByTestId("inspector-summary-total-count")).toContainText(/Total IR nodes:\s+\d+/);
    await expect(page.getByTestId("inspector-summary-mapped-percent")).toContainText(/Coverage:\s+\d+(\.\d+)?%/);
    await expect(page.getByTestId("inspector-summary-omission-classification-fallbacks")).toContainText(
      /Classification fallbacks:\s+\d+/
    );
    await expect(page.getByTestId("inspector-summary-aggregate-note")).toContainText(
      /Node-level diagnostics available|Aggregate-only summary/
    );
  });

  test("shows omission fallback when generation metrics file is unavailable", async ({ page }) => {
    await bootInspector({
      page,
      installRoutes: async (targetPage) => {
        await targetPage.route("**/workspace/jobs/*/files/generation-metrics.json", async (route) => {
          await route.fulfill({
            status: 404,
            contentType: "application/json",
            body: JSON.stringify({
              error: "FILE_NOT_FOUND",
              message: "Injected metrics file miss"
            })
          });
        });
      }
    });

    await expect(page.getByTestId("inspector-summary-omission-unavailable")).toBeVisible();
    await expect(page.getByTestId("inspector-summary-omission-unavailable")).toContainText("unavailable");
    await expect(page.getByTestId("inspector-summary-manifest-coverage")).toBeVisible();
  });
});
