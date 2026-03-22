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

const inspectorViewport = { width: 1920, height: 1080 } as const;

function toErrorBody(error: string, message: string): string {
  return JSON.stringify({ error, message });
}

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
}

test.describe("inspector data states deterministic flow", () => {
  test.describe.configure({ mode: "serial", timeout: 180_000 });

  test.afterEach(async ({ page }) => {
    await cleanupDeterministicSubmitRoute(page);
    await page.unroute("**/workspace/jobs/**");
    await resetBrowserStorage(page);
  });

  test("recovers from manifest fetch failure with endpoint retry", async ({ page }) => {
    let failManifestRequests = true;
    await bootInspector({
      page,
      installRoutes: async (targetPage) => {
        await targetPage.route("**/workspace/jobs/*/component-manifest*", async (route) => {
          if (failManifestRequests) {
            await route.fulfill({
              status: 500,
              contentType: "application/json",
              body: toErrorBody("INTERNAL_ERROR", "Injected manifest failure")
            });
            return;
          }
          await route.continue();
        });
      }
    });

    const { componentTree, fileSelector } = getInspectorLocators(page);
    await expect(page.getByTestId("inspector-error-component-manifest")).toBeVisible();
    await expect(page.getByTestId("inspector-source-component-manifest-error")).toBeVisible();
    await expect(componentTree).toBeVisible();
    await expect(fileSelector).toBeVisible();

    failManifestRequests = false;
    await page.getByTestId("inspector-banner-retry-component-manifest").click();
    await expect(page.getByTestId("inspector-error-component-manifest")).toHaveCount(0);
    await expect(page.getByTestId("inspector-source-component-manifest-ready")).toBeVisible();
  });

  test("recovers from design-ir fetch failure while keeping code browsing active", async ({ page }) => {
    let failDesignIrRequests = true;
    await bootInspector({
      page,
      installRoutes: async (targetPage) => {
        await targetPage.route("**/workspace/jobs/*/design-ir*", async (route) => {
          if (failDesignIrRequests) {
            await route.fulfill({
              status: 500,
              contentType: "application/json",
              body: toErrorBody("DESIGN_IR_NOT_FOUND", "Injected design-ir failure")
            });
            return;
          }
          await route.continue();
        });
      }
    });

    const { fileSelector } = getInspectorLocators(page);
    await expect(page.getByTestId("inspector-error-design-ir")).toBeVisible();
    await expect(page.getByTestId("inspector-design-ir-state-error")).toBeVisible();
    await expect(fileSelector).toBeVisible();

    failDesignIrRequests = false;
    await page.getByTestId("inspector-retry-design-ir").click();
    await expect(page.getByTestId("inspector-error-design-ir")).toHaveCount(0);
    await expect(page.getByTestId("component-tree")).toBeVisible();
    await expect(page.getByTestId("inspector-source-design-ir-ready")).toBeVisible();
  });

  test("recovers from files listing failure with code-pane retry", async ({ page }) => {
    let failFilesRequests = true;
    await bootInspector({
      page,
      installRoutes: async (targetPage) => {
        await targetPage.route("**/workspace/jobs/*/files*", async (route) => {
          const pathname = new URL(route.request().url()).pathname;
          if (!/\/workspace\/jobs\/[^/]+\/files$/.test(pathname)) {
            await route.continue();
            return;
          }

          if (failFilesRequests) {
            await route.fulfill({
              status: 500,
              contentType: "application/json",
              body: toErrorBody("FILES_NOT_FOUND", "Injected files listing failure")
            });
            return;
          }
          await route.continue();
        });
      }
    });

    await expect(page.getByTestId("inspector-state-files-error")).toBeVisible();
    await expect(page.getByTestId("inspector-source-files-error")).toBeVisible();

    failFilesRequests = false;
    await page.getByTestId("inspector-retry-files").click();
    await expect(page.getByTestId("inspector-state-files-error")).toHaveCount(0);
    await expect(page.getByTestId("inspector-source-files-ready")).toBeVisible();

    const optionCount = await page.getByTestId("inspector-file-selector").getByRole("option").count();
    expect(optionCount).toBeGreaterThan(0);
  });

  test("recovers from file-content fetch failure with retry", async ({ page }) => {
    let failOnce = true;
    await bootInspector({
      page,
      installRoutes: async (targetPage) => {
        await targetPage.route("**/workspace/jobs/*/files/*", async (route) => {
          const pathname = new URL(route.request().url()).pathname;
          if (pathname.endsWith("/files/generation-metrics.json")) {
            await route.continue();
            return;
          }
          if (failOnce) {
            failOnce = false;
            await route.fulfill({
              status: 404,
              contentType: "application/json",
              body: toErrorBody("FILE_NOT_FOUND", "Injected file-content failure")
            });
            return;
          }
          await route.continue();
        });
      }
    });

    await expect(page.getByTestId("inspector-state-file-content-error")).toBeVisible();
    await expect(page.getByTestId("inspector-source-file-content-error")).toBeVisible();

    await page.getByTestId("inspector-retry-file-content").click();
    await expect(page.getByTestId("inspector-state-file-content-error")).toHaveCount(0);
    await expect(page.getByTestId("inspector-source-file-content-ready")).toBeVisible();
    await expect(page.getByTestId("inspector-pane-code")).toBeVisible();
  });
});
