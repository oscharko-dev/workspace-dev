import { test, expect, type Page } from "@playwright/test";
import { expectNoBlockingAccessibilityViolations } from "./a11y";
import {
  getWorkspaceUiUrl,
  installClipboardMock,
  resetBrowserStorage,
} from "./helpers";

const routes = ["/workspace/ui/test-space", "/ui/test-space"] as const;

function buildUrl(pathname: string): string {
  return new URL(pathname, getWorkspaceUiUrl()).toString();
}

async function installTestSpaceApiMock(page: Page): Promise<void> {
  const markdownResponses = [
    "# Generated test cases\n\n- TC-1: Happy path\n",
    "# Generated test cases\n\n- TC-1: Happy path\n- TC-2: Refresh check\n",
  ];
  const requestBody = {
    figmaSourceMode: "rest",
    figmaJsonPayload: JSON.stringify({
      document: {
        name: "Test Space",
        type: "DOCUMENT",
        children: [],
      },
    }),
    businessContext: {
      summary:
        "Generate business-facing test cases for the primary Figma flow. Focus on customer-visible outcomes, critical state transitions, and failure recovery.",
      goals: ["Validate the flow against business rules and expected customer outcomes."],
      constraints: ["Keep the suite concise, deterministic, and traceable."],
    },
  };
  const runResponse = {
    runId: "run-123",
    status: "completed",
    modelDeployment: "gpt-oss-120b",
    createdAt: "2026-04-24T08:30:00.000Z",
    updatedAt: "2026-04-24T08:31:00.000Z",
    request: requestBody,
  };

  await page.route("**/workspace/test-space/runs**", async (route) => {
    const request = route.request();
    const url = request.url();

    if (request.method() === "POST" && url.endsWith("/workspace/test-space/runs")) {
      expect(request.postDataJSON()).toMatchObject(requestBody);
      expect(request.postDataJSON()).not.toHaveProperty("businessObjective");
      expect(request.postDataJSON()).not.toHaveProperty("businessConstraints");
      expect(request.postDataJSON()).not.toHaveProperty("figmaFileKey");
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(runResponse),
      });
      return;
    }

    if (request.method() === "GET" && url.endsWith("/workspace/test-space/runs/run-123")) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(runResponse),
      });
      return;
    }

    if (
      request.method() === "GET" &&
      url.endsWith("/workspace/test-space/runs/run-123/test-cases")
    ) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          testCases: [
            {
              id: "TC-1",
              title: "Happy path purchase completes",
              priority: "P0",
              type: "happy_path",
              preconditions: ["Signed-in user", "Cart contains one item"],
              steps: [
                {
                  order: 1,
                  action: "Open checkout",
                  expectedResult: "Checkout loads with the order summary.",
                },
                {
                  order: 2,
                  action: "Submit payment",
                  expectedResult: "Order confirmation is shown.",
                },
              ],
              expectedResult: "Order confirmation is shown.",
              coverageTags: ["checkout", "payment"],
              traceability: ["figma-node-12", "figma-node-27"],
              notes: "Primary business happy path.",
            },
          ],
        }),
      });
      return;
    }

    if (request.method() === "GET" && url.endsWith("/workspace/test-space/runs/run-123/test-cases.md")) {
      const markdown = markdownResponses.shift() ?? "";
      await route.fulfill({
        status: 200,
        contentType: "text/markdown; charset=utf-8",
        body: markdown,
      });
      return;
    }

    await route.continue();
  });
}

for (const routePath of routes) {
  test.describe(`test space at ${routePath}`, () => {
    test.beforeEach(async ({ page }) => {
      await page.setViewportSize({ width: 1536, height: 864 });
      await installClipboardMock(page);
      await installTestSpaceApiMock(page);
      await page.goto(buildUrl(routePath), { waitUntil: "domcontentloaded" });
    });

    test.afterEach(async ({ page }) => {
      await resetBrowserStorage(page);
    });

    test("renders, generates, and refreshes markdown without QC controls", async ({ page }) => {
      await expect(page.getByRole("heading", { name: "Test Space v1" })).toBeVisible();
      await expect(page.getByLabel("Figma JSON payload")).toBeVisible();
      await expect(page.getByLabel("Figma file key")).toBeVisible();
      await expect(page.getByRole("button", { name: "Generate test cases" })).toBeVisible();
      await expect(page.getByRole("button", { name: /qc/i })).toHaveCount(0);

      await page.getByLabel("Figma JSON payload").fill(
        JSON.stringify({
          document: {
            name: "Test Space",
            type: "DOCUMENT",
            children: [],
          },
        }),
      );
      await page.getByRole("button", { name: "Generate test cases" }).click();

      const detailPanel = page.getByTestId("test-space-detail-panel");
      const markdownPanel = page.getByTestId("test-space-markdown-panel");

      await expect(detailPanel.getByText("Happy path purchase completes")).toBeVisible();
      await expect(markdownPanel.getByText("# Generated test cases")).toBeVisible();
      await expect(detailPanel.getByText("1. Open checkout")).toBeVisible();

      await expectNoBlockingAccessibilityViolations({
        page,
        include: "[data-testid='test-space-page']",
      });

      await page.getByRole("button", { name: "Save Markdown" }).click();
      await expect(page.getByText(/Refresh check/)).toBeVisible();

      const downloadPromise = page.waitForEvent("download");
      await page.getByRole("button", { name: "Export Markdown" }).click();
      const download = await downloadPromise;
      expect(download.suggestedFilename()).toMatch(/^test-space-run-123\.md$/);

      await page.getByRole("button", { name: "Copy Markdown" }).click();
      await expect(page.getByText("Markdown copied to clipboard.")).toBeVisible();
    });
  });
}
