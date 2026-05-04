import { expect, test } from "@playwright/test";
import {
  ensureWorkspaceDiagnosticsVisible,
  openWorkspaceUi,
  rememberSubmittedJobId,
  resetBrowserStorage,
  waitForSubmitTerminalStatus
} from "./helpers";

const viewport = { width: 1536, height: 864 } as const;
const TEST_JOB_ID = "job-terminal-failure";

test.describe("workspace submit terminal failure diagnostics", () => {
  test.afterEach(async ({ page }) => {
    await page.unroute("**/workspace/submit");
    await page.unroute(`**/workspace/jobs/${TEST_JOB_ID}`);
    await resetBrowserStorage(page);
  });

  test("surfaces terminal Figma source failures without waiting for a preview", async ({
    page
  }) => {
    await page.route("**/workspace/submit", async (route) => {
      await route.fulfill({
        status: 202,
        contentType: "application/json",
        body: JSON.stringify({ jobId: TEST_JOB_ID })
      });
    });

    await page.route(`**/workspace/jobs/${TEST_JOB_ID}`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          jobId: TEST_JOB_ID,
          status: "failed",
          error: {
            code: "E_FIGMA_LOW_FIDELITY_SOURCE",
            stage: "figma.source",
            message:
              "Figma source fidelity is too low to generate a reliable screen."
          }
        })
      });
    });

    await openWorkspaceUi(page, viewport);
    await page.getByLabel("Figma file key").fill("fixture-key");
    await page.getByLabel("Figma access token").fill("fixture-token");

    const submitResponsePromise = page.waitForResponse((response) => {
      return response.request().method() === "POST" && response.url().endsWith("/workspace/submit");
    });

    await page.getByRole("banner").getByRole("button", { name: "Generate" }).click();
    const submitResponse = await submitResponsePromise;
    expect(submitResponse.ok()).toBeTruthy();

    const submitPayload = await submitResponse.json() as { jobId?: string };
    const payload = await ensureWorkspaceDiagnosticsVisible(page, {
      buttonLabel: "Job diagnostics",
      payloadTestId: "job-payload"
    });
    await expect(payload).toContainText("E_FIGMA_LOW_FIDELITY_SOURCE");
    await expect(payload).toContainText(
      "Figma source fidelity is too low to generate a reliable screen."
    );
    if (typeof submitPayload.jobId === "string") {
      rememberSubmittedJobId(page, submitPayload.jobId);
    }
    expect(await waitForSubmitTerminalStatus(page, { timeoutMs: 5_000 })).toBe("FAILED");
    await expect(page.getByRole("button", { name: "Open Inspector" })).toHaveCount(0);
  });
});
