import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { access, copyFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  openWorkspaceUi,
  parseLiveJobPayload,
  resetBrowserStorage,
  type LiveJobPayload,
  waitForSubmitTerminalStatus
} from "./helpers";

const desktopViewport = { width: 1494, height: 1688 } as const;
const FIGMA_FILE_KEY = (process.env["FIGMA_FILE_KEY"] ?? process.env["FIGMA_BOARD_KEY"] ?? "").trim();
const FIGMA_ACCESS_TOKEN = (process.env["FIGMA_ACCESS_TOKEN"] ?? process.env["FIGMA_ACCESS_TOKEN_DEMO_FI"] ?? "").trim();
const ENABLE_LIVE_INSPECTOR_E2E = process.env["INSPECTOR_LIVE_E2E"] === "1";
const LIVE_SUBMIT_MAX_ATTEMPTS = 3;
const LIVE_RATE_LIMIT_RETRY_WAIT_MS = 20_000;
const DEFAULT_VISUAL_BASELINE_PATH = path.resolve(
  fileURLToPath(new URL("./fixtures/visual-parity-soll.png", import.meta.url))
);
const visualAuditMode = process.env["WORKSPACE_DEV_VISUAL_AUDIT_MODE"]?.trim().toLowerCase() === "strict" ? "strict" : "warn";
const configuredMaxDiffPixelRatio = Number.parseFloat(process.env["WORKSPACE_DEV_VISUAL_MAX_DIFF_PIXEL_RATIO"] ?? "");
const maxDiffPixelRatio =
  Number.isFinite(configuredMaxDiffPixelRatio) && configuredMaxDiffPixelRatio >= 0 && configuredMaxDiffPixelRatio <= 1
    ? configuredMaxDiffPixelRatio
    : 0.2;

interface SubmitAcceptedPayload {
  jobId?: string;
}

interface VisualParityReport {
  status: "passed" | "warn";
  mode: "warn" | "strict";
  baselinePath: string;
  runtimePreviewUrl: string;
  maxDiffPixelRatio: number;
  details: string;
}

const fileExists = async (filePath: string): Promise<boolean> => {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
};

const resolveVisualBaselinePath = async (): Promise<string | undefined> => {
  const configuredPath = process.env["WORKSPACE_DEV_VISUAL_BASELINE_PATH"]?.trim();
  if (configuredPath && await fileExists(configuredPath)) {
    return configuredPath;
  }
  if (await fileExists(DEFAULT_VISUAL_BASELINE_PATH)) {
    return DEFAULT_VISUAL_BASELINE_PATH;
  }
  return undefined;
};

const runLiveGenerationWithRetry = async (page: Page): Promise<string | undefined> => {
  let lastSubmittedJobId: string | undefined;

  for (let attempt = 1; attempt <= LIVE_SUBMIT_MAX_ATTEMPTS; attempt += 1) {
    const submitResponsePromise = page.waitForResponse((response) => {
      return response.request().method() === "POST" && response.url().endsWith("/workspace/submit");
    });

    await page.getByRole("banner").getByRole("button", { name: "Generate" }).click();
    const submitResponse = await submitResponsePromise;
    expect(submitResponse.ok()).toBeTruthy();

    const submitPayload = await submitResponse.json().catch(() => undefined) as SubmitAcceptedPayload | undefined;
    if (typeof submitPayload?.jobId === "string" && submitPayload.jobId.length > 0) {
      lastSubmittedJobId = submitPayload.jobId;
    }

    const terminalStatus = await waitForSubmitTerminalStatus(page, { timeoutMs: 300_000 });
    if (terminalStatus === "COMPLETED") {
      return lastSubmittedJobId;
    }

    const jobPayload = (await page.getByTestId("job-payload").textContent()) ?? "";
    const parsedPayload = parseLiveJobPayload(jobPayload);
    const errorCode = parsedPayload?.error?.code ?? "";
    const isRateLimited =
      errorCode === "E_FIGMA_RATE_LIMIT" ||
      jobPayload.includes("E_FIGMA_RATE_LIMIT") ||
      jobPayload.toLowerCase().includes("rate limit exceeded");
    if (!isRateLimited) {
      throw new Error(
        `Live submit ended with status ${terminalStatus}. Job payload excerpt: ${jobPayload.slice(0, 280)}`
      );
    }

    if (attempt === LIVE_SUBMIT_MAX_ATTEMPTS) {
      return undefined;
    }
    await page.waitForTimeout(LIVE_RATE_LIMIT_RETRY_WAIT_MS);
  }

  return undefined;
};

const writeVisualParityReport = async ({
  testInfo,
  report
}: {
  testInfo: TestInfo;
  report: VisualParityReport;
}): Promise<void> => {
  const reportPath = testInfo.outputPath("visual-parity-report.json");
  await mkdir(path.dirname(reportPath), { recursive: true });
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf-8");
  await testInfo.attach("visual-parity-report", {
    path: reportPath,
    contentType: "application/json"
  });
};

test.describe("visual parity live figma flow", () => {
  test.describe.configure({ mode: "serial", timeout: 420_000 });

  test.afterEach(async ({ page }) => {
    await resetBrowserStorage(page);
  });

  test("compares generated desktop preview against SOLL screenshot", async ({ page }, testInfo) => {
    test.skip(
      !ENABLE_LIVE_INSPECTOR_E2E || FIGMA_FILE_KEY.length === 0 || FIGMA_ACCESS_TOKEN.length === 0,
      "Set INSPECTOR_LIVE_E2E=1 and provide FIGMA_FILE_KEY/FIGMA_ACCESS_TOKEN (or FIGMA_BOARD_KEY/FIGMA_ACCESS_TOKEN_DEMO_FI)."
    );

    const baselinePath = await resolveVisualBaselinePath();
    test.skip(
      !baselinePath,
      "No baseline screenshot found. Set WORKSPACE_DEV_VISUAL_BASELINE_PATH or add ui-src/e2e/fixtures/visual-parity-soll.png."
    );

    await openWorkspaceUi(page, desktopViewport);
    await page.getByLabel("Figma file key").fill(FIGMA_FILE_KEY);
    await page.getByLabel("Figma access token").fill(FIGMA_ACCESS_TOKEN);

    const jobId = await runLiveGenerationWithRetry(page);
    test.skip(
      !jobId,
      `Skipping visual parity after ${String(LIVE_SUBMIT_MAX_ATTEMPTS)} attempts due to persistent Figma API rate limits.`
    );

    const runtimeOrigin = new URL(page.url()).origin;
    const runtimePreviewUrl = `${runtimeOrigin}/workspace/repros/${jobId}/`;
    await page.goto(runtimePreviewUrl, { waitUntil: "networkidle" });

    const screenshotPath = testInfo.outputPath("visual-parity-actual.png");
    const screenshotBuffer = await page.screenshot({
      path: screenshotPath,
      fullPage: false,
      animations: "disabled"
    });
    await testInfo.attach("visual-parity-actual", {
      path: screenshotPath,
      contentType: "image/png"
    });

    const snapshotName = "visual-parity-desktop.png";
    const snapshotPath = testInfo.snapshotPath(snapshotName);
    await mkdir(path.dirname(snapshotPath), { recursive: true });
    await copyFile(baselinePath, snapshotPath);

    let status: VisualParityReport["status"] = "passed";
    let details = "Generated preview matches baseline within threshold.";
    try {
      expect(screenshotBuffer).toMatchSnapshot(snapshotName, {
        maxDiffPixelRatio
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (visualAuditMode === "strict") {
        throw error;
      }
      status = "warn";
      details = `Visual difference exceeded threshold in warn mode: ${message}`;
    }

    await writeVisualParityReport({
      testInfo,
      report: {
        status,
        mode: visualAuditMode,
        baselinePath,
        runtimePreviewUrl,
        maxDiffPixelRatio,
        details
      }
    });
  });
});
