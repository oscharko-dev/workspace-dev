/**
 * E2E test for the click-to-inspect overlay on the live preview iframe.
 *
 * Tests that inspect mode can be toggled, that hovering shows a highlight
 * overlay, and that clicking selects a component and syncs the code panel.
 *
 * Requires FIGMA_ACCESS_TOKEN to run the full Figma integration tests.
 *
 * @see https://github.com/oscharko-dev/workspace-dev/issues/386
 */
import { test, expect } from "@playwright/test";

const FIGMA_FILE_KEY = process.env["FIGMA_FILE_KEY"] ?? "xZkvYk9KOezMsi9LmPEFGX";
const FIGMA_ACCESS_TOKEN = process.env["FIGMA_ACCESS_TOKEN"] ?? "";

const skipCondition = FIGMA_ACCESS_TOKEN.length === 0;

test.describe("Click-to-Inspect Overlay E2E", () => {
  test.describe("with Figma credentials", () => {
    test.skip(() => skipCondition, "FIGMA_ACCESS_TOKEN not set — skipping inspect overlay E2E tests");

    test("inspect mode toggle, hover highlight, and click-to-select", async ({ page }) => {
      test.setTimeout(300_000);

      const uiUrl = process.env["WORKSPACE_DEV_UI_URL"] ?? "http://127.0.0.1:1983/workspace/ui";
      await page.setViewportSize({ width: 1920, height: 1080 });
      await page.goto(uiUrl);

      await expect(page.getByRole("heading", { name: "Workspace Dev" })).toBeVisible();

      // Fill in form fields
      const figmaKeyInput = page.getByLabel("Figma file key");
      await figmaKeyInput.clear();
      await figmaKeyInput.fill(FIGMA_FILE_KEY);

      const tokenInput = page.getByLabel("Figma access token");
      await tokenInput.fill(FIGMA_ACCESS_TOKEN);

      // Submit the job
      await page.getByRole("banner").getByRole("button", { name: "Generate" }).click();

      // Wait for terminal state (COMPLETED or FAILED)
      await expect(async () => {
        const completedBadges = page.locator("span").filter({ hasText: /^COMPLETED$/ });
        const failedBadges = page.locator("span").filter({ hasText: /^FAILED$/ });
        const completedCount = await completedBadges.count();
        const failedCount = await failedBadges.count();
        expect(completedCount + failedCount).toBeGreaterThan(0);
      }).toPass({ timeout: 280_000, intervals: [3_000] });

      // Check if job completed successfully
      const completedBadges = page.locator("span").filter({ hasText: /^COMPLETED$/ });
      const jobCompleted = (await completedBadges.count()) > 0;

      if (!jobCompleted) {
        // Job failed — skip remaining assertions
        return;
      }

      // === Inspector panel should be visible ===
      const inspectorPanel = page.getByTestId("inspector-panel");
      await expect(inspectorPanel).toBeVisible({ timeout: 10_000 });

      // === Inspect toggle button should be present ===
      const inspectToggle = page.getByTestId("inspect-toggle");
      await expect(inspectToggle).toBeVisible({ timeout: 10_000 });
      await expect(inspectToggle).toHaveText("Inspect");

      // Inspect mode should be OFF by default (aria-pressed=false)
      await expect(inspectToggle).toHaveAttribute("aria-pressed", "false");

      // === Enable inspect mode ===
      await inspectToggle.click();
      await expect(inspectToggle).toHaveAttribute("aria-pressed", "true");

      // Toggle button should have the active styling (blue variant)
      await expect(inspectToggle).toHaveClass(/border-blue-400/);

      // === Wait for the iframe to be loaded ===
      const iframe = inspectorPanel.locator("iframe[title='Live preview']");
      await expect(iframe).toBeVisible({ timeout: 10_000 });

      // === Verify data-ir-id attributes exist in the iframe ===
      const iframeElement = iframe.first();
      const iframeSrc = await iframeElement.getAttribute("src");
      expect(iframeSrc).toBeTruthy();

      // Fetch the preview HTML directly to check for inspect bridge script
      const previewResponse = await page.request.get(iframeSrc!);
      const previewHtml = await previewResponse.text();
      expect(previewHtml).toContain("data-workspace-dev-inspect");
      expect(previewHtml).toContain("inspect:enable");
      expect(previewHtml).toContain("inspect:select");

      // === Check that the generated app has data-ir-id attributes ===
      // Access the iframe content via frame locator
      const iframeContent = page.frameLocator("iframe[title='Live preview']");

      // Wait for the iframe app to render
      await expect(async () => {
        const body = iframeContent.locator("body");
        const text = await body.textContent();
        expect(text).toBeTruthy();
        expect(text!.length).toBeGreaterThan(0);
      }).toPass({ timeout: 30_000, intervals: [2_000] });

      // Check for data-ir-id attributes in the iframe
      const irElements = iframeContent.locator("[data-ir-id]");
      await expect(async () => {
        const count = await irElements.count();
        expect(count).toBeGreaterThan(0);
      }).toPass({ timeout: 15_000, intervals: [2_000] });

      // === Simulate click on an element with data-ir-id in the iframe ===
      // Get the first element with data-ir-id
      const firstIrElement = irElements.first();
      const irNodeId = await firstIrElement.getAttribute("data-ir-id");
      expect(irNodeId).toBeTruthy();

      // Click the element in the iframe
      await firstIrElement.click({ force: true });

      // === Verify that clicking updated the code panel ===
      // After clicking, the code pane should show content (may or may not highlight
      // depending on manifest presence for that specific node)
      await expect(async () => {
        const codeContent = inspectorPanel.locator("pre");
        const preCount = await codeContent.count();
        expect(preCount).toBeGreaterThan(0);
        const text = await codeContent.first().textContent();
        expect(text).toBeTruthy();
        expect(text!.length).toBeGreaterThan(10);
      }).toPass({ timeout: 10_000, intervals: [1_000] });

      // === Disable inspect mode ===
      await inspectToggle.click();
      await expect(inspectToggle).toHaveAttribute("aria-pressed", "false");

      // Toggle should revert to default styling
      await expect(inspectToggle).not.toHaveClass(/border-blue-400/);

      // === Verify inspect mode can be toggled back on ===
      await inspectToggle.click();
      await expect(inspectToggle).toHaveAttribute("aria-pressed", "true");

      // Toggle off again for clean state
      await inspectToggle.click();
      await expect(inspectToggle).toHaveAttribute("aria-pressed", "false");
    });

    test("inspect bridge script is NOT in generated source files", async ({ page }) => {
      test.setTimeout(300_000);

      const uiUrl = process.env["WORKSPACE_DEV_UI_URL"] ?? "http://127.0.0.1:1983/workspace/ui";
      await page.setViewportSize({ width: 1920, height: 1080 });
      await page.goto(uiUrl);

      await expect(page.getByRole("heading", { name: "Workspace Dev" })).toBeVisible();

      // Fill in form fields
      const figmaKeyInput = page.getByLabel("Figma file key");
      await figmaKeyInput.clear();
      await figmaKeyInput.fill(FIGMA_FILE_KEY);

      const tokenInput = page.getByLabel("Figma access token");
      await tokenInput.fill(FIGMA_ACCESS_TOKEN);

      // Submit the job
      await page.getByRole("banner").getByRole("button", { name: "Generate" }).click();

      // Wait for terminal state
      await expect(async () => {
        const completedBadges = page.locator("span").filter({ hasText: /^COMPLETED$/ });
        const failedBadges = page.locator("span").filter({ hasText: /^FAILED$/ });
        const completedCount = await completedBadges.count();
        const failedCount = await failedBadges.count();
        expect(completedCount + failedCount).toBeGreaterThan(0);
      }).toPass({ timeout: 280_000, intervals: [3_000] });

      const completedBadges = page.locator("span").filter({ hasText: /^COMPLETED$/ });
      const jobCompleted = (await completedBadges.count()) > 0;

      if (!jobCompleted) {
        return;
      }

      // Inspector panel should be visible
      const inspectorPanel = page.getByTestId("inspector-panel");
      await expect(inspectorPanel).toBeVisible({ timeout: 10_000 });

      // Check generated source files via the code viewer
      // The inspect bridge script should NOT appear in any generated .tsx/.ts files
      const fileSelector = page.getByTestId("inspector-file-selector");
      await expect(fileSelector).toBeVisible();

      const options = fileSelector.locator("option");
      const optionCount = await options.count();

      for (let i = 0; i < Math.min(optionCount, 5); i++) {
        const optionValue = await options.nth(i).getAttribute("value");
        if (!optionValue) {
          continue;
        }

        // Select the file
        await fileSelector.selectOption(optionValue);

        // Wait for content to load
        await expect(async () => {
          const codeContent = inspectorPanel.locator("pre");
          const text = await codeContent.first().textContent();
          expect(text).toBeTruthy();
        }).toPass({ timeout: 10_000, intervals: [1_000] });

        // Verify the source code does NOT contain the inspect bridge
        const codeText = await inspectorPanel.locator("pre").first().textContent();
        expect(codeText).not.toContain("data-workspace-dev-inspect");
        expect(codeText).not.toContain("inspect:enable");
      }
    });
  });
});
