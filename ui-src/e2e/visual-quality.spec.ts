/**
 * Smoke test for the Visual Quality diff gallery page.
 *
 * Verifies that the route loads, the empty state renders, the sample
 * data path hydrates the dashboard, gallery, and history chart, and the
 * overlay/zoom interactions work end-to-end.
 *
 * @see https://github.com/oscharko-dev/workspace-dev/issues/844
 */
import { expect, test } from "@playwright/test";
import { getWorkspaceUiUrl, resetBrowserStorage } from "./helpers";

const visualQualityViewport = { width: 1440, height: 900 } as const;

function buildVisualQualityUrl(): string {
  const base = new URL(getWorkspaceUiUrl());
  base.pathname = base.pathname.replace(/\/?$/, "/visual-quality");
  return base.toString();
}

test.describe("visual quality diff gallery", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize(visualQualityViewport);
  });

  test.afterEach(async ({ page }) => {
    await resetBrowserStorage(page);
  });

  test("empty state renders and sample data hydrates the dashboard + gallery", async ({
    page,
  }) => {
    const consoleErrors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") {
        consoleErrors.push(message.text());
      }
    });

    await page.goto(buildVisualQualityUrl());

    const emptyState = page.getByTestId("visual-quality-empty-state");
    await expect(emptyState).toBeVisible();

    await page.getByTestId("visual-quality-load-sample").click();

    const dashboard = page.getByTestId("score-dashboard");
    await expect(dashboard).toBeVisible();
    await expect(dashboard).toContainText("Overall score");

    const gallery = page.getByTestId("gallery-view");
    await expect(gallery).toBeVisible();

    const firstCard = page.getByTestId(/^screen-card-/).first();
    await expect(firstCard).toBeVisible();
    await firstCard.click();

    const detail = page.getByTestId("screen-detail");
    await expect(detail).toBeVisible();

    // Side-by-side is the default overlay mode.
    await expect(page.getByTestId("overlay-side-by-side")).toBeVisible();

    // Switch to onion-skin and confirm the opacity slider is present.
    await page.getByTestId("overlay-mode-onion-skin").click();
    await expect(page.getByTestId("onion-opacity-slider")).toBeVisible();

    // Switch to heatmap and confirm the heatmap is present.
    await page.getByTestId("overlay-mode-heatmap").click();
    await expect(page.getByTestId("overlay-heatmap")).toBeVisible();

    // History chart renders because the sample report includes history entries.
    await expect(page.getByTestId("history-chart")).toBeVisible();

    // Open the zoom modal from a zoomable image and close it with Escape.
    const zoomTrigger = page.getByRole("button", {
      name: "Zoom difference heatmap",
    });
    await zoomTrigger.click();
    const modal = page.getByTestId("zoom-modal");
    await expect(modal).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(modal).toBeHidden();

    expect(
      consoleErrors,
      `Console errors detected: ${consoleErrors.join(" | ")}`,
    ).toHaveLength(0);
  });
});
