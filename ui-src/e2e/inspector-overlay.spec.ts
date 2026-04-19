/**
 * E2E tests for the Inspector preview overlay mode.
 *
 * Verifies that overlay mode can be enabled in the real Inspector flow, the
 * opacity controls are visible, and quick-set actions update the live preview
 * layer in-browser.
 */
import { expect, test, type Page } from "@playwright/test";
import {
  getPrototypeNavigationPastePayload,
  openInspectorBootstrap,
  resetBrowserStorage,
  simulateInspectorPaste,
} from "./helpers";

const overlayViewport = { width: 1920, height: 1080 } as const;
const testJobId = "overlay-job-id";
const prototypeNavigationPaste = getPrototypeNavigationPastePayload();
const mockScreenshotUrl =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9s6nxs8AAAAASUVORK5CYII=";

async function installOverlayRoutes(page: Page): Promise<void> {
  let pollCount = 0;

  await page.route("**/workspace/submit", async (route) => {
    if (route.request().method() !== "POST") {
      await route.continue();
      return;
    }
    await route.fulfill({
      status: 202,
      contentType: "application/json",
      body: JSON.stringify({ jobId: testJobId }),
    });
  });

  await page.route(`**/workspace/jobs/${testJobId}`, async (route) => {
    if (route.request().method() !== "GET") {
      await route.continue();
      return;
    }
    pollCount += 1;
    if (pollCount === 1) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          jobId: testJobId,
          status: "running",
          stages: [
            {
              name: "figma.source",
              status: "running",
            },
          ],
        }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        jobId: testJobId,
        status: "completed",
        stages: [
          {
            name: "figma.source",
            status: "completed",
          },
          {
            name: "ir.derive",
            status: "completed",
          },
          {
            name: "template.prepare",
            status: "completed",
          },
        ],
        preview: { enabled: true, url: "about:blank" },
      }),
    });
  });

  await page.route(`**/workspace/jobs/${testJobId}/screenshot`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        jobId: testJobId,
        screenshotUrl: mockScreenshotUrl,
        url: mockScreenshotUrl,
      }),
    });
  });
}

test.describe("inspector preview overlay", () => {
  test.describe.configure({ mode: "serial", timeout: 180_000 });

  test.afterEach(async ({ page }) => {
    await page.unroute("**/workspace/submit");
    await page.unroute(`**/workspace/jobs/${testJobId}`);
    await page.unroute(`**/workspace/jobs/${testJobId}/screenshot`);
    await resetBrowserStorage(page);
  });

  test("overlay mode exposes opacity controls and quick-set actions in the bootstrap import flow", async ({
    page,
  }) => {
    await installOverlayRoutes(page);
    await openInspectorBootstrap(page, overlayViewport);

    await simulateInspectorPaste(page, prototypeNavigationPaste);

    const banner = page.getByTestId("smart-banner");
    await expect(banner).toBeVisible({ timeout: 5_000 });
    await banner.getByRole("button", { name: "Import starten" }).click();

    await expect(page.getByTestId("inspector-panel")).toBeVisible({
      timeout: 30_000,
    });

    const overlayToggle = page.getByTestId("preview-overlay-toggle");
    await expect(overlayToggle).toBeVisible({ timeout: 10_000 });
    await overlayToggle.click();

    await expect(overlayToggle).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("preview-overlay-layout")).toBeVisible();
    await expect(
      page.getByTestId("preview-overlay-quickset-controls"),
    ).toBeVisible();
    await expect(
      page.getByTestId("preview-overlay-shortcut-hint"),
    ).toHaveText("Keys 0 / 5 / 1");

    const slider = page.getByTestId("preview-overlay-opacity-slider");
    await expect(slider).toHaveValue("50");

    const previewIframe = page.getByTitle("Live preview");

    await page.getByTestId("preview-overlay-quickset-100").click();
    await expect(slider).toHaveValue("100");
    await expect
      .poll(async () => {
        return await previewIframe.evaluate((node) => {
          return (node as HTMLIFrameElement).style.opacity;
        });
      })
      .toBe("1");

    await page.getByTestId("preview-overlay-quickset-0").click();
    await expect(slider).toHaveValue("0");
    await expect
      .poll(async () => {
        return await previewIframe.evaluate((node) => {
          return (node as HTMLIFrameElement).style.opacity;
        });
      })
      .toBe("0");

    await page.getByTestId("preview-overlay-quickset-50").click();
    await expect(slider).toHaveValue("50");
    await expect
      .poll(async () => {
        return await previewIframe.evaluate((node) => {
          return (node as HTMLIFrameElement).style.opacity;
        });
      })
      .toBe("0.5");

    await expect
      .poll(async () => {
        return await page.evaluate(() => {
          return window.localStorage.getItem(
            "workspace-dev:inspector:preview-view-mode",
          );
        });
      })
      .toBe("overlay");
  });
});
