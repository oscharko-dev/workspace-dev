import { test, expect } from "@playwright/test";
import {
  ensureWorkspaceDiagnosticsVisible,
  getWorkspaceUiUrl,
  openWorkspaceUi,
  resetBrowserStorage
} from "./helpers";

const desktopViewportMatrix = [
  { label: "1536x864", width: 1536, height: 864 },
  { label: "1920x1080", width: 1920, height: 1080 },
  { label: "2560x1440", width: 2560, height: 1440 }
] as const;

for (const viewport of desktopViewportMatrix) {
  test.describe(`workspace shell at ${viewport.label}`, () => {
    test.beforeEach(async ({ page }) => {
      await openWorkspaceUi(page, {
        width: viewport.width,
        height: viewport.height
      });
    });

    test.afterEach(async ({ page }) => {
      await resetBrowserStorage(page);
    });

    test(`renders workspace shell without layout overflow at ${viewport.label}`, async ({ page }) => {
      const heading = page.getByRole("heading", { name: "Workspace Dev" });
      const banner = page.getByRole("banner");
      const figmaFileKeyInput = page.getByLabel("Figma file key");
      const generateButton = banner.getByRole("button", { name: "Generate" });

      await expect(heading).toBeVisible();
      await expect(banner).toContainText("Workspace Dev");
      await expect(figmaFileKeyInput).toBeVisible();
      await expect(generateButton).toBeVisible();

      const faviconUrl = new URL("/workspace/ui/favicon.svg", getWorkspaceUiUrl()).toString();
      const faviconResponse = await page.request.get(faviconUrl);
      expect(faviconResponse.ok(), `Expected favicon request to succeed for ${faviconUrl}`).toBeTruthy();

      const hasPageOverflow = await page.evaluate(() => {
        return {
          horizontal: document.documentElement.scrollWidth > document.documentElement.clientWidth,
          vertical: document.documentElement.scrollHeight > document.documentElement.clientHeight
        };
      });
      expect(hasPageOverflow.horizontal).toBe(false);
      expect(hasPageOverflow.vertical).toBe(false);

      const inputCard = page.getByTestId("input-card");
      const runtimeCard = page.getByTestId("runtime-card");
      const inputBox = await inputCard.boundingBox();
      const runtimeBox = await runtimeCard.boundingBox();

      expect(inputBox).not.toBeNull();
      expect(runtimeBox).not.toBeNull();

      if (inputBox && runtimeBox) {
        expect(inputBox.y + inputBox.height).toBeLessThanOrEqual(viewport.height);
        expect(runtimeBox.y + runtimeBox.height).toBeLessThanOrEqual(viewport.height);
      }

      const payloadContainers = [
        await ensureWorkspaceDiagnosticsVisible(page, {
          buttonLabel: "Runtime diagnostics",
          payloadTestId: "runtime-payload"
        }),
        await ensureWorkspaceDiagnosticsVisible(page, {
          buttonLabel: "Job diagnostics",
          payloadTestId: "job-payload"
        }),
        page.getByTestId("submit-payload")
      ];

      for (const payloadContainer of payloadContainers) {
        const metric = await payloadContainer.evaluate((node) => {
          const style = window.getComputedStyle(node);
          return {
            overflowX: style.overflowX,
            overflowY: style.overflowY,
            height: node.getBoundingClientRect().height
          };
        });

        expect(["auto", "scroll"]).toContain(metric.overflowX);
        expect(["auto", "scroll"]).toContain(metric.overflowY);
        expect(metric.height).toBeGreaterThan(30);
      }
    });
  });
}
