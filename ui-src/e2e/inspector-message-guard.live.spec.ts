import { expect, test, type FrameLocator, type Page } from "@playwright/test";
import {
  collectPreviewNodeIds,
  findFirstSyncedNodeId,
  getInspectorLocators,
  openWorkspaceUi,
  resetBrowserStorage,
  waitForSubmitTerminalStatus
} from "./helpers";

const liveViewport = { width: 1920, height: 1080 } as const;
const FIGMA_FILE_KEY = process.env["FIGMA_FILE_KEY"] ?? "";
const FIGMA_ACCESS_TOKEN = process.env["FIGMA_ACCESS_TOKEN"] ?? "";
const ENABLE_LIVE_INSPECTOR_E2E = process.env["INSPECTOR_LIVE_E2E"] === "1";
const LIVE_SUBMIT_MAX_ATTEMPTS = 3;
const LIVE_RATE_LIMIT_RETRY_WAIT_MS = 20_000;

async function installInspectControlCapture(previewFrame: FrameLocator): Promise<void> {
  await previewFrame.locator("body").evaluate(() => {
    const scope = window as typeof window & {
      __workspaceDevInspectControlMessages?: unknown[];
      __workspaceDevInspectControlListenerInstalled?: boolean;
    };

    if (scope.__workspaceDevInspectControlListenerInstalled) {
      return;
    }
    scope.__workspaceDevInspectControlMessages = [];
    window.addEventListener("message", (event) => {
      const payload = event.data;
      if (!payload || typeof payload !== "object") {
        return;
      }
      const data = payload as { type?: unknown };
      if (data.type === "inspect:enable" || data.type === "inspect:disable") {
        scope.__workspaceDevInspectControlMessages?.push(payload);
      }
    });
    scope.__workspaceDevInspectControlListenerInstalled = true;
  });
}

async function waitForInspectSessionToken({
  page,
  previewFrame
}: {
  page: Page;
  previewFrame: FrameLocator;
}): Promise<string> {
  const maxAttempts = 40;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const token = await previewFrame.locator("body").evaluate(() => {
      const scope = window as typeof window & {
        __workspaceDevInspectControlMessages?: unknown[];
      };
      const messages = scope.__workspaceDevInspectControlMessages ?? [];
      for (let idx = messages.length - 1; idx >= 0; idx -= 1) {
        const message = messages[idx] as { type?: unknown; sessionToken?: unknown };
        if (message?.type === "inspect:enable" && typeof message.sessionToken === "string") {
          return message.sessionToken;
        }
      }
      return null;
    });

    if (typeof token === "string" && token.length > 0) {
      return token;
    }

    await page.waitForTimeout(100);
  }

  throw new Error("Timed out waiting for inspect session token.");
}

test.describe("inspector postMessage channel guards live figma flow", () => {
  test.describe.configure({ mode: "serial", timeout: 420_000 });

  test.afterEach(async ({ page }) => {
    await resetBrowserStorage(page);
  });

  test("rejects invalid-session forged events and accepts valid session events", async ({ page }) => {
    test.skip(
      !ENABLE_LIVE_INSPECTOR_E2E || FIGMA_FILE_KEY.length === 0 || FIGMA_ACCESS_TOKEN.length === 0,
      "Set INSPECTOR_LIVE_E2E=1, FIGMA_FILE_KEY, and FIGMA_ACCESS_TOKEN to run live inspector e2e."
    );

    await openWorkspaceUi(page, liveViewport);
    await page.getByLabel("Figma file key").fill(FIGMA_FILE_KEY);
    await page.getByLabel("Figma access token").fill(FIGMA_ACCESS_TOKEN);

    let completed = false;
    let exhaustedRateLimit = false;
    let lastError: unknown = null;
    for (let attempt = 1; attempt <= LIVE_SUBMIT_MAX_ATTEMPTS; attempt += 1) {
      const submitResponsePromise = page.waitForResponse((response) => {
        return response.request().method() === "POST" && response.url().endsWith("/workspace/submit");
      });

      await page.getByRole("banner").getByRole("button", { name: "Generate" }).click();
      const submitResponse = await submitResponsePromise;
      expect(submitResponse.ok()).toBeTruthy();

      const terminalStatus = await waitForSubmitTerminalStatus(page, { timeoutMs: 240_000 });
      if (terminalStatus === "COMPLETED") {
        completed = true;
        break;
      }

      const jobPayload = (await page.getByTestId("job-payload").textContent()) ?? "";
      const isRateLimited =
        jobPayload.includes("E_FIGMA_RATE_LIMIT") ||
        jobPayload.toLowerCase().includes("rate limit exceeded");
      if (!isRateLimited) {
        throw new Error(
          `Live submit ended with status ${terminalStatus}. Job payload excerpt: ${jobPayload.slice(0, 280)}`
        );
      }

      lastError = `attempt ${String(attempt)} failed with rate limit`;
      if (attempt === LIVE_SUBMIT_MAX_ATTEMPTS) {
        exhaustedRateLimit = true;
        break;
      }
      await page.waitForTimeout(LIVE_RATE_LIMIT_RETRY_WAIT_MS);
    }

    if (!completed && exhaustedRateLimit) {
      test.skip(
        true,
        `Skipping live inspector lane after ${String(LIVE_SUBMIT_MAX_ATTEMPTS)} attempts due to persistent Figma API rate limits.`
      );
    }

    expect(completed, `Live Figma generation did not complete. Last error: ${String(lastError)}`).toBeTruthy();

    const { previewFrame, previewIframe } = getInspectorLocators(page);
    const inspectToggle = page.getByTestId("inspect-toggle");
    await installInspectControlCapture(previewFrame);
    await inspectToggle.click();
    await expect(inspectToggle).toHaveAttribute("aria-pressed", "true");

    const sessionToken = await waitForInspectSessionToken({ page, previewFrame });
    const previewOrigin = await previewIframe.evaluate((iframe) => {
      if (!(iframe instanceof HTMLIFrameElement)) {
        throw new Error("Preview iframe element is unavailable.");
      }
      return new URL(iframe.src, window.location.href).origin;
    });

    const previewNodeIds = await collectPreviewNodeIds(previewFrame);
    const syncedNodeId = await findFirstSyncedNodeId(page, previewNodeIds);
    expect(syncedNodeId, "Expected at least one preview node to map to a component tree node").toBeTruthy();
    const targetNodeId = syncedNodeId as string;
    const targetTreeNode = page.getByTestId(`tree-node-${targetNodeId}`);
    await expect(targetTreeNode).not.toHaveAttribute("aria-selected", "true");

    await page.evaluate(
      ({ irNodeId, expectedOrigin }) => {
        const iframe = document.querySelector("iframe[title='Live preview']");
        if (!(iframe instanceof HTMLIFrameElement) || !iframe.contentWindow) {
          throw new Error("Preview iframe contentWindow is unavailable.");
        }
        window.dispatchEvent(
          new MessageEvent("message", {
            data: { type: "inspect:select", irNodeId, sessionToken: "wrong-session-token" },
            origin: expectedOrigin,
            source: iframe.contentWindow
          })
        );
      },
      { irNodeId: targetNodeId, expectedOrigin: previewOrigin }
    );
    await expect(targetTreeNode).not.toHaveAttribute("aria-selected", "true");

    await page.evaluate(
      ({ irNodeId, expectedOrigin, validSessionToken }) => {
        const iframe = document.querySelector("iframe[title='Live preview']");
        if (!(iframe instanceof HTMLIFrameElement) || !iframe.contentWindow) {
          throw new Error("Preview iframe contentWindow is unavailable.");
        }
        window.dispatchEvent(
          new MessageEvent("message", {
            data: { type: "inspect:select", irNodeId, sessionToken: validSessionToken },
            origin: expectedOrigin,
            source: iframe.contentWindow
          })
        );
      },
      { irNodeId: targetNodeId, expectedOrigin: previewOrigin, validSessionToken: sessionToken }
    );
    await expect(targetTreeNode).toHaveAttribute("aria-selected", "true");
  });
});
