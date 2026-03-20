/**
 * E2E test for the Inspector split-pane layout.
 *
 * Tests the inspector panel UI components — fallback view, responsive
 * layout, and (when a Figma job completes) the full inspector with
 * preview and code pane.
 *
 * The full inspector test requires FIGMA_ACCESS_TOKEN and a job that
 * reaches "completed" status (with preview enabled).
 *
 * @see https://github.com/oscharko-dev/workspace-dev/issues/382
 */
import { test, expect } from "@playwright/test";

const FIGMA_FILE_KEY = process.env["FIGMA_FILE_KEY"] ?? "xZkvYk9KOezMsi9LmPEFGX";
const FIGMA_ACCESS_TOKEN = process.env["FIGMA_ACCESS_TOKEN"] ?? "";

const skipCondition = FIGMA_ACCESS_TOKEN.length === 0;

test.describe("Inspector Panel E2E", () => {
  test("falls back to Result card when no job is active", async ({ page }) => {
    const uiUrl = process.env["WORKSPACE_DEV_UI_URL"] ?? "http://127.0.0.1:1983/workspace/ui";
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.goto(uiUrl);

    await expect(page.getByRole("heading", { name: "Workspace Dev" })).toBeVisible();

    // Without any job, the Result card should show
    const resultCard = page.getByTestId("result-card");
    await expect(resultCard).toBeVisible();

    // Inspector panel should NOT be visible
    const inspectorPanel = page.getByTestId("inspector-panel");
    await expect(inspectorPanel).not.toBeVisible();

    // Should show fallback message
    await expect(resultCard.getByText("No generated output yet.")).toBeVisible();
  });

  test("responsive stacking at smaller viewport", async ({ page }) => {
    const uiUrl = process.env["WORKSPACE_DEV_UI_URL"] ?? "http://127.0.0.1:1983/workspace/ui";
    // Use a width below lg breakpoint (1024px)
    await page.setViewportSize({ width: 768, height: 1024 });
    await page.goto(uiUrl);

    await expect(page.getByRole("heading", { name: "Workspace Dev" })).toBeVisible();

    // At mobile width, the result card should be visible (fallback mode since no job)
    const resultCard = page.getByTestId("result-card");
    await expect(resultCard).toBeVisible();

    // No page overflow
    const hasPageOverflow = await page.evaluate(() => {
      return {
        horizontal: document.documentElement.scrollWidth > document.documentElement.clientWidth
      };
    });
    expect(hasPageOverflow.horizontal).toBe(false);
  });

  test.describe("with Figma credentials", () => {
    test.skip(() => skipCondition, "FIGMA_ACCESS_TOKEN not set — skipping inspector Figma E2E tests");

    test("renders inspector with preview and code pane after job completes", async ({ page }) => {
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

      if (jobCompleted) {
        // === Inspector panel should now be visible ===
        const inspectorPanel = page.getByTestId("inspector-panel");
        await expect(inspectorPanel).toBeVisible({ timeout: 10_000 });

        // Verify heading
        await expect(inspectorPanel.getByRole("heading", { name: "Inspector" })).toBeVisible();

        // === Preview pane (iframe) should be present ===
        const iframe = inspectorPanel.locator("iframe[title='Live preview']");
        await expect(iframe).toBeVisible({ timeout: 10_000 });

        // Verify iframe src contains repros path
        const iframeSrc = await iframe.getAttribute("src");
        expect(iframeSrc).toBeTruthy();
        expect(iframeSrc).toContain("/workspace/repros/");

        // === File selector dropdown should be populated ===
        const fileSelector = page.getByTestId("inspector-file-selector");
        await expect(fileSelector).toBeVisible();

        const options = fileSelector.locator("option");
        const optionCount = await options.count();
        expect(optionCount).toBeGreaterThan(0);

        // Should have .tsx or .ts files
        const optionTexts: string[] = [];
        for (let i = 0; i < optionCount; i++) {
          const text = await options.nth(i).textContent();
          if (text) {
            optionTexts.push(text);
          }
        }
        const hasCodeFiles = optionTexts.some((t) => t.endsWith(".tsx") || t.endsWith(".ts"));
        expect(hasCodeFiles).toBe(true);

        // === Code content should be displayed ===
        await expect(async () => {
          const pre = inspectorPanel.locator("pre");
          const preCount = await pre.count();
          expect(preCount).toBeGreaterThan(0);
          const text = await pre.first().textContent();
          expect(text).toBeTruthy();
          expect(text!.length).toBeGreaterThan(10);
        }).toPass({ timeout: 10_000, intervals: [1_000] });

        // Should contain import statement (React code)
        const codeContent = await inspectorPanel.locator("pre").first().textContent();
        expect(codeContent).toContain("import");

        // === Copy button should be present ===
        const copyButton = page.getByTestId("inspector-copy-button");
        await expect(copyButton).toBeVisible();

        // === File selector works: change file and see new content ===
        if (optionCount > 1) {
          const secondOption = await options.nth(1).getAttribute("value");
          if (secondOption) {
            await fileSelector.selectOption(secondOption);
            await expect(async () => {
              const pre = inspectorPanel.locator("pre");
              const text = await pre.first().textContent();
              expect(text).toBeTruthy();
              expect(text!.length).toBeGreaterThan(0);
            }).toPass({ timeout: 10_000, intervals: [1_000] });
          }
        }

        // === Bounding box check ===
        const inspectorBox = await inspectorPanel.boundingBox();
        expect(inspectorBox).not.toBeNull();
      } else {
        // Job failed (e.g., at validate.project) — inspector should NOT show.
        // Result card should show the failure message instead.
        const resultCard = page.getByTestId("result-card");
        await expect(resultCard).toBeVisible();
        const inspectorPanel = page.getByTestId("inspector-panel");
        await expect(inspectorPanel).not.toBeVisible();
      }
    });
  });
});
