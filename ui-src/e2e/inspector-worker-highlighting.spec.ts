import { expect, test } from "@playwright/test";
import {
  cleanupDeterministicSubmitRoute,
  getInspectorLocators,
  installClipboardMock,
  openInspector,
  openWorkspaceUi,
  resetBrowserStorage,
  setupDeterministicSubmitRoute,
  triggerDeterministicGeneration,
  waitForCompletedSubmitStatus
} from "./helpers";

const inspectorViewport = { width: 1920, height: 1080 } as const;
const CSP_VIOLATION_PATTERN = /content security policy|violates the following content security policy directive/i;
const STYLE_ATTRIBUTE_CSP_PATTERN = /applying inline style violates the following content security policy directive 'style-src 'self''/i;

test.describe("inspector worker highlighting deterministic flow", () => {
  test.describe.configure({ mode: "serial", timeout: 180_000 });
  let consoleMessages: string[] = [];

  test.beforeEach(async ({ page }) => {
    consoleMessages = [];
    page.on("console", (message) => {
      const locationUrl = message.location().url;
      if (locationUrl.includes("/workspace/repros/")) {
        return;
      }
      consoleMessages.push(`[${message.type()}] ${message.text()}`);
    });
    await installClipboardMock(page);
    await setupDeterministicSubmitRoute(page);
    await openWorkspaceUi(page, inspectorViewport);
    await triggerDeterministicGeneration(page);
    await waitForCompletedSubmitStatus(page);
    await openInspector(page);
  });

  test.afterEach(async ({ page }) => {
    await cleanupDeterministicSubmitRoute(page);
    await resetBrowserStorage(page);
  });

  test("keeps inspector responsive during rapid file switches, settles latest highlight, and logs no CSP violations", async ({ page }) => {
    const { codeViewer, fileSelector, componentTree } = getInspectorLocators(page);

    await expect(codeViewer).toBeVisible();
    await expect(fileSelector).toBeVisible();
    consoleMessages = [];

    const fileOptions = await fileSelector.locator("option").evaluateAll((options) => {
      return options
        .map((option) => (option as HTMLOptionElement).value)
        .filter((value): value is string => typeof value === "string" && value.length > 0);
    });
    expect(fileOptions.length).toBeGreaterThan(1);

    const firstFile = fileOptions[0];
    const secondFile = fileOptions[1];
    expect(firstFile).toBeTruthy();
    expect(secondFile).toBeTruthy();

    for (let iteration = 0; iteration < 8; iteration += 1) {
      await fileSelector.selectOption(iteration % 2 === 0 ? firstFile! : secondFile!);
    }

    await expect(page.getByTestId("code-viewer-filepath")).toHaveText(secondFile!);
    await expect
      .poll(async () => {
        return await page.getByTestId("code-content").getByText("Highlighting…").count();
      })
      .toBe(0);
    expect(await page.getByTestId("line-number").count()).toBeGreaterThan(0);

    const firstComponentNode = componentTree.getByTestId(/^tree-node-/).first();
    await expect(firstComponentNode).toBeVisible();
    await firstComponentNode.click();
    await expect(page.getByTestId("highlighted-line").first()).toBeVisible();

    expect(
      consoleMessages.filter((message) => {
        return CSP_VIOLATION_PATTERN.test(message) && !STYLE_ATTRIBUTE_CSP_PATTERN.test(message);
      })
    ).toEqual([]);
  });
});
