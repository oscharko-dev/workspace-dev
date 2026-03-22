/**
 * E2E tests for Inspector PR creation controls.
 *
 * Verifies prerequisite input gating, success/error rendering,
 * and PR result display for the PR creation panel.
 *
 * @see https://github.com/oscharko-dev/workspace-dev/issues/457
 */
import { expect, test, type Page } from "@playwright/test";
import {
  cleanupDeterministicSubmitRoute,
  openWorkspaceUi,
  resetBrowserStorage,
  setupDeterministicSubmitRoute,
  triggerDeterministicGeneration,
  waitForCompletedSubmitStatus
} from "./helpers";

const prViewport = { width: 1920, height: 1080 } as const;

async function setupRegenerationLineageRoute(page: Page): Promise<void> {
  await page.route("**/workspace/jobs/*", async (route) => {
    const request = route.request();
    if (request.method() !== "GET") {
      await route.continue();
      return;
    }

    const response = await route.fetch();
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      await route.fulfill({ response });
      return;
    }

    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      await route.fulfill({ response });
      return;
    }

    const record = payload as Record<string, unknown>;
    if (typeof record.jobId !== "string") {
      await route.fulfill({ response });
      return;
    }

    await route.fulfill({
      response,
      json: {
        ...record,
        lineage: {
          sourceJobId: "job-source-1"
        }
      }
    });
  });
}

test.describe("inspector PR creation controls", () => {
  test.describe.configure({ timeout: 120_000 });

  test.beforeEach(async ({ page }) => {
    await setupDeterministicSubmitRoute(page);
    await setupRegenerationLineageRoute(page);
  });

  test.afterEach(async ({ page }) => {
    await cleanupDeterministicSubmitRoute(page);
    await page.unroute("**/workspace/jobs/*/create-pr");
    await page.unroute("**/workspace/jobs/*");
    await resetBrowserStorage(page);
  });

  test("PR create button is disabled without repo URL and token", async ({ page }) => {
    await openWorkspaceUi(page, prViewport);
    await triggerDeterministicGeneration(page);
    await waitForCompletedSubmitStatus(page);

    const prPanel = page.locator("[data-testid='inspector-pr-panel']");
    await expect(prPanel).toBeVisible();

    const createButton = page.locator("[data-testid='inspector-pr-create-button']");
    await expect(createButton).toBeDisabled();

    // Fill repo URL only — still disabled
    await page.locator("[data-testid='inspector-pr-repo-url']").fill("https://github.com/acme/repo");
    await expect(createButton).toBeDisabled();

    // Fill token — now enabled
    await page.locator("[data-testid='inspector-pr-repo-token']").fill("ghp_test_token");
    await expect(createButton).toBeEnabled();
  });

  test("displays success with PR URL on successful creation", async ({ page }) => {
    await page.route("**/workspace/jobs/*/create-pr", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          jobId: "job-regen-1",
          sourceJobId: "job-source-1",
          gitPr: {
            status: "executed",
            prUrl: "https://github.com/acme/repo/pull/42",
            branchName: "auto/figma/board-key-abc12345",
            scopePath: "generated/board-key-abc12345",
            changedFiles: ["src/App.tsx", "src/screens/Home.tsx"]
          }
        })
      });
    });

    await openWorkspaceUi(page, prViewport);
    await triggerDeterministicGeneration(page);
    await waitForCompletedSubmitStatus(page);

    await page.locator("[data-testid='inspector-pr-repo-url']").fill("https://github.com/acme/repo");
    await page.locator("[data-testid='inspector-pr-repo-token']").fill("ghp_token");
    await page.locator("[data-testid='inspector-pr-create-button']").click();

    const successPanel = page.locator("[data-testid='inspector-pr-success']");
    await expect(successPanel).toBeVisible();

    const prLink = page.locator("[data-testid='inspector-pr-url-link']");
    await expect(prLink).toHaveAttribute("href", "https://github.com/acme/repo/pull/42");
    await expect(prLink).toHaveText("https://github.com/acme/repo/pull/42");
  });

  test("displays error on PR creation failure", async ({ page }) => {
    await page.route("**/workspace/jobs/*/create-pr", async (route) => {
      await route.fulfill({
        status: 409,
        contentType: "application/json",
        body: JSON.stringify({
          error: "NOT_REGENERATION_JOB",
          message: "Only regeneration jobs support PR creation."
        })
      });
    });

    await openWorkspaceUi(page, prViewport);
    await triggerDeterministicGeneration(page);
    await waitForCompletedSubmitStatus(page);

    await page.locator("[data-testid='inspector-pr-repo-url']").fill("https://github.com/acme/repo");
    await page.locator("[data-testid='inspector-pr-repo-token']").fill("ghp_token");
    await page.locator("[data-testid='inspector-pr-create-button']").click();

    const errorPanel = page.locator("[data-testid='inspector-pr-error']");
    await expect(errorPanel).toBeVisible();
    await expect(errorPanel).toContainText("NOT_REGENERATION_JOB");
  });

  test("sends targetPath when provided", async ({ page }) => {
    let capturedBody: Record<string, unknown> | null = null;

    await page.route("**/workspace/jobs/*/create-pr", async (route) => {
      capturedBody = route.request().postDataJSON() as Record<string, unknown>;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          jobId: "job-regen-1",
          sourceJobId: "job-source-1",
          gitPr: {
            status: "executed",
            branchName: "auto/figma/board-key-1234",
            scopePath: "apps/generated/board-key-1234",
            changedFiles: []
          }
        })
      });
    });

    await openWorkspaceUi(page, prViewport);
    await triggerDeterministicGeneration(page);
    await waitForCompletedSubmitStatus(page);

    await page.locator("[data-testid='inspector-pr-repo-url']").fill("https://github.com/acme/repo");
    await page.locator("[data-testid='inspector-pr-repo-token']").fill("ghp_token");
    await page.locator("[data-testid='inspector-pr-target-path']").fill("apps/generated");
    await page.locator("[data-testid='inspector-pr-create-button']").click();

    await page.locator("[data-testid='inspector-pr-success']").waitFor({ state: "visible" });

    expect(capturedBody).not.toBeNull();
    expect(capturedBody?.targetPath).toBe("apps/generated");
    expect(capturedBody?.repoUrl).toBe("https://github.com/acme/repo");
  });
});
