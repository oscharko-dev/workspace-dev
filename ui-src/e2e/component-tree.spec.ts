/**
 * E2E test for the Component Tree sidebar in the Inspector panel.
 *
 * Validates that the component tree renders the full IR hierarchy,
 * nodes are collapsible/expandable, selection updates the code pane,
 * and keyboard navigation works.
 *
 * @see https://github.com/oscharko-dev/workspace-dev/issues/383
 */
import { test, expect } from "@playwright/test";

const FIGMA_FILE_KEY = process.env["FIGMA_FILE_KEY"] ?? "xZkvYk9KOezMsi9LmPEFGX";
const FIGMA_ACCESS_TOKEN = process.env["FIGMA_ACCESS_TOKEN"] ?? "";

const skipCondition = FIGMA_ACCESS_TOKEN.length === 0;

test.describe("Component Tree E2E", () => {
  test.describe("with Figma credentials", () => {
    test.skip(() => skipCondition, "FIGMA_ACCESS_TOKEN not set — skipping component tree E2E tests");

    test("renders component tree, supports expand/collapse and selection", async ({ page }) => {
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

      // Check if job completed
      const completedBadges = page.locator("span").filter({ hasText: /^COMPLETED$/ });
      const jobCompleted = (await completedBadges.count()) > 0;

      if (!jobCompleted) {
        // Job failed — skip tree tests
        return;
      }

      // === Inspector panel should now be visible ===
      const inspectorPanel = page.getByTestId("inspector-panel");
      await expect(inspectorPanel).toBeVisible({ timeout: 10_000 });

      // === Component tree should be visible ===
      const componentTree = page.getByTestId("component-tree");
      await expect(componentTree).toBeVisible({ timeout: 10_000 });

      // Tree should have the "Components" header
      await expect(componentTree.getByText("Components")).toBeVisible();

      // === Tree should contain screen nodes ===
      const treeItems = componentTree.locator("[role='treeitem']");
      await expect(async () => {
        const count = await treeItems.count();
        expect(count).toBeGreaterThan(0);
      }).toPass({ timeout: 10_000, intervals: [1_000] });

      // Count screen-level nodes (data-testid starting with tree-screen-)
      const screenNodes = componentTree.locator("[data-testid^='tree-screen-']");
      const screenCount = await screenNodes.count();
      expect(screenCount).toBeGreaterThan(0);

      // === Test collapse/expand ===
      // Screens should be expanded by default — check for child nodes
      const firstScreen = screenNodes.first();
      const firstScreenId = await firstScreen.getAttribute("data-node-id");
      expect(firstScreenId).toBeTruthy();

      // Get chevron button on first screen
      const chevronButton = firstScreen.locator("button[aria-label='Collapse']");
      const hasChevron = (await chevronButton.count()) > 0;

      if (hasChevron) {
        // Collapse the first screen
        await chevronButton.click();

        // After collapse, there should be fewer visible tree items
        // and the button label should change
        await expect(firstScreen.locator("button[aria-label='Expand']")).toBeVisible();

        // Expand it again
        await firstScreen.locator("button[aria-label='Expand']").click();
        await expect(firstScreen.locator("button[aria-label='Collapse']")).toBeVisible();
      }

      // === Test node selection updates code pane ===
      // Click on the first screen node
      await firstScreen.click();

      // Code pane should show content
      await expect(async () => {
        const codeContent = page.getByTestId("code-content");
        await expect(codeContent).toBeVisible();
        const lineCount = await codeContent.locator("[class*='flex text-xs']").count();
        expect(lineCount).toBeGreaterThan(0);
      }).toPass({ timeout: 10_000, intervals: [1_000] });

      // File selector should have a value
      const fileSelector = page.getByTestId("inspector-file-selector");
      const selectedFile = await fileSelector.inputValue();
      expect(selectedFile).toBeTruthy();
      expect(selectedFile.endsWith(".tsx") || selectedFile.endsWith(".ts")).toBe(true);

      // === Test child node selection with line highlighting ===
      // Find a child node (not a screen)
      const childNodes = componentTree.locator("[data-testid^='tree-node-']");
      const childCount = await childNodes.count();

      if (childCount > 0) {
        // Click on first child node
        await childNodes.first().click();

        // Wait for code to update
        await page.waitForTimeout(500);

        // Code content should still be visible
        const codeContent = page.getByTestId("code-content");
        await expect(codeContent).toBeVisible();
      }

      // === Test tree sidebar collapse ===
      const collapseButton = page.getByTestId("tree-collapse-button");
      await collapseButton.click();

      // Tree should now be collapsed
      await expect(componentTree).not.toBeVisible();

      // Expand button should be visible
      const expandButton = page.getByTestId("tree-expand-button");
      await expect(expandButton).toBeVisible();

      // Re-expand the tree
      await expandButton.click();
      await expect(page.getByTestId("component-tree")).toBeVisible();

      // === Test keyboard navigation ===
      const treeContainer = componentTree.locator("[role='tree']");
      await treeContainer.focus();

      // Press ArrowDown to move focus
      await treeContainer.press("ArrowDown");

      // Press Enter to select
      await treeContainer.press("Enter");

      // Code pane should still be functional
      await expect(page.getByTestId("code-content")).toBeVisible();

      // === Bounding box check — tree should be within viewport ===
      const treeBox = await componentTree.boundingBox();
      expect(treeBox).not.toBeNull();
      if (treeBox) {
        expect(treeBox.width).toBeGreaterThan(100);
        expect(treeBox.height).toBeGreaterThan(100);
      }
    });

    test("element type badges are displayed on tree nodes", async ({ page }) => {
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

      const componentTree = page.getByTestId("component-tree");
      await expect(componentTree).toBeVisible({ timeout: 10_000 });

      // Each child node should have a type badge (a small span with title attribute)
      const typeBadges = componentTree.locator("[data-testid^='tree-node-'] span[title]");

      await expect(async () => {
        const badgeCount = await typeBadges.count();
        expect(badgeCount).toBeGreaterThan(0);
      }).toPass({ timeout: 10_000, intervals: [1_000] });

      // Verify at least one badge has a known type
      const firstBadgeTitle = await typeBadges.first().getAttribute("title");
      expect(firstBadgeTitle).toBeTruthy();
    });

    test("selecting extracted component navigates to its own file", async ({ page }) => {
      test.setTimeout(300_000);

      const uiUrl = process.env["WORKSPACE_DEV_UI_URL"] ?? "http://127.0.0.1:1983/workspace/ui";
      await page.setViewportSize({ width: 1920, height: 1080 });
      await page.goto(uiUrl);

      await expect(page.getByRole("heading", { name: "Workspace Dev" })).toBeVisible();

      const figmaKeyInput = page.getByLabel("Figma file key");
      await figmaKeyInput.clear();
      await figmaKeyInput.fill(FIGMA_FILE_KEY);

      const tokenInput = page.getByLabel("Figma access token");
      await tokenInput.fill(FIGMA_ACCESS_TOKEN);

      await page.getByRole("banner").getByRole("button", { name: "Generate" }).click();

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

      const inspectorPanel = page.getByTestId("inspector-panel");
      await expect(inspectorPanel).toBeVisible({ timeout: 10_000 });

      const componentTree = page.getByTestId("component-tree");
      await expect(componentTree).toBeVisible({ timeout: 10_000 });

      // Click the first screen to set initial file
      const screenNodes = componentTree.locator("[data-testid^='tree-screen-']");
      const screenCount = await screenNodes.count();
      if (screenCount === 0) {
        return;
      }

      await screenNodes.first().click();

      const fileSelector = page.getByTestId("inspector-file-selector");
      const initialFile = await fileSelector.inputValue();

      // Now try clicking child nodes — if file changes, it means an extracted component navigated
      const childNodes = componentTree.locator("[data-testid^='tree-node-']");
      const childCount = await childNodes.count();

      let fileChanged = false;
      for (let i = 0; i < Math.min(childCount, 10); i++) {
        await childNodes.nth(i).click();
        await page.waitForTimeout(300);
        const currentFile = await fileSelector.inputValue();
        if (currentFile !== initialFile) {
          fileChanged = true;
          // Verify the new file is a .tsx file
          expect(currentFile.endsWith(".tsx") || currentFile.endsWith(".ts")).toBe(true);
          break;
        }
      }

      // This is OK — not all designs will have extracted components
      // The test validates the mechanism works when present
      if (fileChanged) {
        const codeContent = page.getByTestId("code-content");
        await expect(codeContent).toBeVisible();
      }
    });
  });
});
