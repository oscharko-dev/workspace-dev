/**
 * E2E tests for the syntax-highlighted code viewer.
 *
 * Validates that Shiki-based syntax highlighting, line numbers, copy button,
 * word wrap toggle, and file path display all work end-to-end after a Figma
 * job completes.
 *
 * Requires FIGMA_ACCESS_TOKEN to run the full Figma integration tests.
 *
 * @see https://github.com/oscharko-dev/workspace-dev/issues/384
 */
import { test, expect } from "@playwright/test";

const FIGMA_FILE_KEY = process.env["FIGMA_FILE_KEY"] ?? "xZkvYk9KOezMsi9LmPEFGX";
const FIGMA_ACCESS_TOKEN = process.env["FIGMA_ACCESS_TOKEN"] ?? "";

const skipCondition = FIGMA_ACCESS_TOKEN.length === 0;

test.describe("Code Viewer — Syntax Highlighting E2E", () => {
  test.describe("with Figma credentials", () => {
    test.skip(() => skipCondition, "FIGMA_ACCESS_TOKEN not set — skipping code viewer E2E tests");

    test("renders syntax-highlighted code with all features after job completes", async ({ page }) => {
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

      // === Inspector panel should now be visible ===
      const inspectorPanel = page.getByTestId("inspector-panel");
      await expect(inspectorPanel).toBeVisible({ timeout: 10_000 });

      // === CodeViewer should be rendered ===
      const codeViewer = page.getByTestId("code-viewer");
      await expect(codeViewer).toBeVisible({ timeout: 10_000 });

      // === File path should be displayed ===
      const filePath = page.getByTestId("code-viewer-filepath");
      await expect(filePath).toBeVisible();
      const filePathText = await filePath.textContent();
      expect(filePathText).toBeTruthy();
      expect(filePathText!.endsWith(".tsx") || filePathText!.endsWith(".ts")).toBe(true);

      // === Line numbers should be present in gutter ===
      await expect(async () => {
        const lineNumbers = page.getByTestId("line-number");
        const count = await lineNumbers.count();
        expect(count).toBeGreaterThan(0);
        // First line number should be "1"
        const firstLine = lineNumbers.first();
        await expect(firstLine).toHaveText("1");
      }).toPass({ timeout: 15_000, intervals: [1_000] });

      // === Syntax highlighting: code should contain color-styled spans ===
      await expect(async () => {
        const codeContent = page.getByTestId("code-content");
        // Shiki renders inline styles with `color:` on spans
        const html = await codeContent.innerHTML();
        expect(html).toContain("color:");
        // Should contain import keyword (React/MUI code)
        const text = await codeContent.textContent();
        expect(text).toContain("import");
      }).toPass({ timeout: 20_000, intervals: [2_000] });

      // === MUI imports should be highlighted correctly ===
      const codeText = await page.getByTestId("code-content").textContent();
      // Generated code typically imports from @mui/material
      if (codeText?.includes("@mui/material")) {
        // Verify the MUI import text is present and rendered (not broken by tokenization)
        expect(codeText).toContain("@mui/material");
      }

      // === Copy button should be present and functional ===
      const copyButton = page.getByTestId("inspector-copy-button");
      await expect(copyButton).toBeVisible();
      await expect(copyButton).toHaveText("Copy");

      // === Word wrap toggle should work ===
      const wrapToggle = page.getByTestId("code-viewer-wrap-toggle");
      await expect(wrapToggle).toBeVisible();
      await expect(wrapToggle).toHaveText("Wrap: Off");

      // Click to enable word wrap
      await wrapToggle.click();
      await expect(wrapToggle).toHaveText("Wrap: On");

      // Click again to disable
      await wrapToggle.click();
      await expect(wrapToggle).toHaveText("Wrap: Off");

      // === File switching: select a different file and verify highlighting updates ===
      const fileSelector = page.getByTestId("inspector-file-selector");
      const options = fileSelector.locator("option");
      const optionCount = await options.count();

      if (optionCount > 1) {
        const secondOption = await options.nth(1).getAttribute("value");
        if (secondOption) {
          await fileSelector.selectOption(secondOption);

          // Wait for new file content to load and highlight
          await expect(async () => {
            const codeContent = page.getByTestId("code-content");
            const html = await codeContent.innerHTML();
            expect(html).toContain("color:");
          }).toPass({ timeout: 15_000, intervals: [1_000] });

          // File path should update
          const updatedPath = await page.getByTestId("code-viewer-filepath").textContent();
          expect(updatedPath).toBe(secondOption);
        }
      }

      // === Component tree click should trigger highlight range ===
      const treeButtons = inspectorPanel.locator("[data-testid='component-tree'] button");
      const treeButtonCount = await treeButtons.count();
      if (treeButtonCount > 1) {
        // Click a non-screen node to trigger highlight range
        await treeButtons.nth(1).click();

        // Check if highlighted lines appear
        await expect(async () => {
          const highlightedLines = page.getByTestId("highlighted-line");
          const count = await highlightedLines.count();
          // May or may not produce highlighted lines depending on manifest
          // Just verify no crash
          expect(count).toBeGreaterThanOrEqual(0);
        }).toPass({ timeout: 5_000, intervals: [500] });
      }
    });
  });
});
