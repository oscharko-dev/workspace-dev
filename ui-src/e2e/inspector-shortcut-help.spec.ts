/**
 * E2E tests for the Inspector keyboard shortcut help overlay.
 *
 * Verifies the shortcut help overlay can be opened via toolbar button
 * and `?` key, dismissed with Escape, and displays all shortcut categories.
 *
 * @see https://github.com/oscharko-dev/workspace-dev/issues/436
 */
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

const shortcutTestViewport = { width: 1920, height: 1080 } as const;

test.describe("inspector shortcut help overlay", () => {
  test.describe.configure({ mode: "serial", timeout: 180_000 });

  test.beforeEach(async ({ page }) => {
    await setupDeterministicSubmitRoute(page);
    await openWorkspaceUi(page, shortcutTestViewport);
    await triggerDeterministicGeneration(page);
    await waitForCompletedSubmitStatus(page);
  });

  test.afterEach(async ({ page }) => {
    await cleanupDeterministicSubmitRoute(page);
    await resetBrowserStorage(page);
  });

  test("toolbar button opens shortcut help overlay", async ({ page }) => {
    const { inspectorPanel } = getInspectorLocators(page);
    await expect(inspectorPanel).toBeVisible();

    const helpButton = page.getByTestId("inspector-shortcut-help-button");
    await expect(helpButton).toBeVisible();
    await helpButton.click();

    const overlay = page.getByTestId("shortcut-help-overlay");
    await expect(overlay).toBeVisible({ timeout: 5_000 });

    // All four categories should be visible
    await expect(page.getByTestId("shortcut-category-component-tree")).toBeVisible();
    await expect(page.getByTestId("shortcut-category-code-viewer")).toBeVisible();
    await expect(page.getByTestId("shortcut-category-pane-layout")).toBeVisible();
    await expect(page.getByTestId("shortcut-category-inspector-tool")).toBeVisible();
  });

  test("pressing ? key opens and closes the overlay", async ({ page }) => {
    const { inspectorPanel } = getInspectorLocators(page);
    await expect(inspectorPanel).toBeVisible();

    // Click the inspector heading to place focus outside any input field
    await page.getByRole("heading", { name: "Inspector" }).click();

    // Dispatch ? keydown event on document.body for reliable delivery
    await page.evaluate(() => {
      document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "?", bubbles: true, cancelable: true }));
    });
    const overlay = page.getByTestId("shortcut-help-overlay");
    await expect(overlay).toBeVisible({ timeout: 5_000 });

    // Dispatch ? again to toggle off
    await page.evaluate(() => {
      document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "?", bubbles: true, cancelable: true }));
    });
    await expect(overlay).not.toBeVisible({ timeout: 5_000 });
  });

  test("Escape key dismisses the overlay", async ({ page }) => {
    const helpButton = page.getByTestId("inspector-shortcut-help-button");
    await helpButton.click();

    const overlay = page.getByTestId("shortcut-help-overlay");
    await expect(overlay).toBeVisible({ timeout: 5_000 });

    await page.keyboard.press("Escape");
    await expect(overlay).not.toBeVisible({ timeout: 5_000 });
  });

  test("close button dismisses the overlay", async ({ page }) => {
    const helpButton = page.getByTestId("inspector-shortcut-help-button");
    await helpButton.click();

    await expect(page.getByTestId("shortcut-help-overlay")).toBeVisible({ timeout: 5_000 });

    await page.getByTestId("shortcut-help-close").click();
    await expect(page.getByTestId("shortcut-help-overlay")).not.toBeVisible({ timeout: 5_000 });
  });

  test("overlay has proper ARIA dialog attributes", async ({ page }) => {
    const helpButton = page.getByTestId("inspector-shortcut-help-button");
    await helpButton.click();

    const overlay = page.getByTestId("shortcut-help-overlay");
    await expect(overlay).toBeVisible({ timeout: 5_000 });

    const role = await overlay.getAttribute("role");
    expect(role).toBe("dialog");

    const ariaModal = await overlay.getAttribute("aria-modal");
    expect(ariaModal).toBe("true");

    const ariaLabel = await overlay.getAttribute("aria-label");
    expect(ariaLabel).toBe("Keyboard shortcuts");
  });

  test("overlay contains kbd elements for shortcut keys", async ({ page }) => {
    const helpButton = page.getByTestId("inspector-shortcut-help-button");
    await helpButton.click();

    const panel = page.getByTestId("shortcut-help-panel");
    await expect(panel).toBeVisible({ timeout: 5_000 });

    const kbdCount = await panel.locator("kbd").count();
    expect(kbdCount, "Expected multiple kbd elements for shortcut keys").toBeGreaterThan(10);
  });
});
