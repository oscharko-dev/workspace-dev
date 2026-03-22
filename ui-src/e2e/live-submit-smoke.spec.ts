/**
 * Live Figma smoke test for UI submit flow.
 *
 * Uses real Figma credentials from environment variables and validates that
 * submit reaches a terminal lifecycle state in the UI.
 *
 * This intentionally tolerates terminal FAILED/CANCELED for unstable live
 * environments (for example lint/validation failures after successful fetch).
 */
import { expect, test } from "@playwright/test";
import {
  openWorkspaceUi,
  resetBrowserStorage,
  waitForSubmitTerminalStatus
} from "./helpers";

const liveViewport = { width: 1920, height: 1080 } as const;
const FIGMA_FILE_KEY = process.env["FIGMA_FILE_KEY"] ?? "";
const FIGMA_ACCESS_TOKEN = process.env["FIGMA_ACCESS_TOKEN"] ?? "";
const ENABLE_LIVE_INSPECTOR_E2E = process.env["INSPECTOR_LIVE_E2E"] === "1";

test.describe("live submit smoke", () => {
  test.describe.configure({ mode: "serial", timeout: 360_000 });

  test.afterEach(async ({ page }) => {
    await resetBrowserStorage(page);
  });

  test("submit reaches terminal state with live credentials", async ({ page }) => {
    test.skip(
      !ENABLE_LIVE_INSPECTOR_E2E || FIGMA_FILE_KEY.length === 0 || FIGMA_ACCESS_TOKEN.length === 0,
      "Set INSPECTOR_LIVE_E2E=1, FIGMA_FILE_KEY, and FIGMA_ACCESS_TOKEN."
    );

    await openWorkspaceUi(page, liveViewport);
    await page.getByLabel("Figma file key").fill(FIGMA_FILE_KEY);
    await page.getByLabel("Figma access token").fill(FIGMA_ACCESS_TOKEN);

    const submitResponsePromise = page.waitForResponse((response) => {
      return response.request().method() === "POST" && response.url().endsWith("/workspace/submit");
    });
    await page.getByRole("banner").getByRole("button", { name: "Generate" }).click();
    const submitResponse = await submitResponsePromise;
    expect(submitResponse.ok()).toBeTruthy();

    const terminalStatus = await waitForSubmitTerminalStatus(page, { timeoutMs: 300_000 });
    expect(["COMPLETED", "FAILED", "CANCELED"]).toContain(terminalStatus);

    const jobPayload = (await page.getByTestId("job-payload").textContent()) ?? "";
    expect(jobPayload).toContain(`"status": "${terminalStatus.toLowerCase()}"`);

    if (terminalStatus === "COMPLETED") {
      await expect(page.getByTestId("inspector-panel")).toBeVisible();
    }
  });
});
