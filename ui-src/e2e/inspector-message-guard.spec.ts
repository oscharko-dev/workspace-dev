import { expect, test, type FrameLocator, type Page } from "@playwright/test";
import {
  cleanupDeterministicSubmitRoute,
  collectPreviewNodeIds,
  findFirstSyncedNodeId,
  getInspectorLocators,
  openWorkspaceUi,
  resetBrowserStorage,
  setupDeterministicSubmitRoute,
  triggerDeterministicGeneration,
  waitForCompletedSubmitStatus
} from "./helpers";

const inspectorViewport = { width: 1920, height: 1080 } as const;

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
      if (
        data.type === "inspect:enable" ||
        data.type === "inspect:disable" ||
        data.type === "inspect:scope:set" ||
        data.type === "inspect:scope:clear"
      ) {
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

async function getInspectControlMessageTypes(previewFrame: FrameLocator): Promise<string[]> {
  return await previewFrame.locator("body").evaluate(() => {
    const scope = window as typeof window & {
      __workspaceDevInspectControlMessages?: unknown[];
    };
    const messages = scope.__workspaceDevInspectControlMessages ?? [];
    return messages
      .map((message) => {
        if (!message || typeof message !== "object") {
          return "";
        }
        const candidate = message as { type?: unknown };
        return typeof candidate.type === "string" ? candidate.type : "";
      })
      .filter((type) => type.length > 0);
  });
}

test.describe("inspector postMessage channel guards deterministic flow", () => {
  test.describe.configure({ mode: "serial", timeout: 180_000 });

  test.beforeEach(async ({ page }) => {
    await setupDeterministicSubmitRoute(page);
    await openWorkspaceUi(page, inspectorViewport);
    await triggerDeterministicGeneration(page);
    await waitForCompletedSubmitStatus(page);
  });

  test.afterEach(async ({ page }) => {
    await cleanupDeterministicSubmitRoute(page);
    await resetBrowserStorage(page);
  });

  test("rejects foreign-origin/invalid-session inspect events and accepts valid session events", async ({ page }) => {
    const { previewFrame, previewIframe } = getInspectorLocators(page);
    const inspectToggle = page.getByTestId("inspect-toggle");

    await installInspectControlCapture(previewFrame);
    await expect(inspectToggle).toBeVisible();
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
      ({ irNodeId, forgedToken }) => {
        const iframe = document.querySelector("iframe[title='Live preview']");
        if (!(iframe instanceof HTMLIFrameElement) || !iframe.contentWindow) {
          throw new Error("Preview iframe contentWindow is unavailable.");
        }
        window.dispatchEvent(
          new MessageEvent("message", {
            data: { type: "inspect:select", irNodeId, sessionToken: forgedToken },
            origin: "https://evil.example",
            source: iframe.contentWindow
          })
        );
      },
      { irNodeId: targetNodeId, forgedToken: sessionToken }
    );
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

  test("bridge ignores invalid control messages and unknown sessions", async ({ page }) => {
    const { previewFrame, previewIframe } = getInspectorLocators(page);
    const inspectToggle = page.getByTestId("inspect-toggle");

    const previewOrigin = await previewIframe.evaluate((iframe) => {
      if (!(iframe instanceof HTMLIFrameElement)) {
        throw new Error("Preview iframe element is unavailable.");
      }
      return new URL(iframe.src, window.location.href).origin;
    });

    await page.evaluate((origin) => {
      const iframe = document.querySelector("iframe[title='Live preview']");
      if (!(iframe instanceof HTMLIFrameElement) || !iframe.contentWindow) {
        throw new Error("Preview iframe contentWindow is unavailable.");
      }
      iframe.contentWindow.postMessage({ type: "inspect:enable" }, origin);
    }, previewOrigin);
    await expect
      .poll(async () => {
        return await previewFrame.locator("body").evaluate(() => document.body.style.cursor || "");
      })
      .toBe("");

    await installInspectControlCapture(previewFrame);
    await inspectToggle.click();
    await expect(inspectToggle).toHaveAttribute("aria-pressed", "true");

    const sessionToken = await waitForInspectSessionToken({ page, previewFrame });
    await expect
      .poll(async () => {
        return await previewFrame.locator("body").evaluate(() => document.body.style.cursor);
      })
      .toBe("crosshair");

    await page.evaluate(
      ({ origin, invalidSessionToken }) => {
        const iframe = document.querySelector("iframe[title='Live preview']");
        if (!(iframe instanceof HTMLIFrameElement) || !iframe.contentWindow) {
          throw new Error("Preview iframe contentWindow is unavailable.");
        }
        iframe.contentWindow.postMessage(
          { type: "inspect:disable", sessionToken: `${invalidSessionToken}-invalid` },
          origin
        );
      },
      { origin: previewOrigin, invalidSessionToken: sessionToken }
    );
    await expect
      .poll(async () => {
        return await previewFrame.locator("body").evaluate(() => document.body.style.cursor);
      })
      .toBe("crosshair");

    await inspectToggle.click();
    await expect(inspectToggle).toHaveAttribute("aria-pressed", "false");
    await expect
      .poll(async () => {
        return await previewFrame.locator("body").evaluate(() => document.body.style.cursor || "");
      })
      .toBe("");
  });

  test("scope bridge spotlights active subtree, constrains inspect, and fails open for unmapped scope", async ({ page }) => {
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

    const scopeTreeNode = page.getByTestId("tree-node-nav-button");
    const outsideTreeNode = page.getByTestId("tree-node-home-title");
    await expect(scopeTreeNode).toBeVisible();
    await expect(outsideTreeNode).toBeVisible();

    await installInspectControlCapture(previewFrame);
    await scopeTreeNode.click();
    await expect(scopeTreeNode).toHaveAttribute("aria-selected", "true");
    await page.getByTestId("breadcrumb-enter-scope").click();
    await expect(page.getByTestId("breadcrumb-scope-badge")).toBeVisible();

    await expect
      .poll(
        async () => {
          const types = await getInspectControlMessageTypes(previewFrame);
          return types.includes("inspect:scope:set");
        },
        { timeout: 40_000 }
      )
      .toBe(true);

    const scopeSpotlight = previewFrame.locator("[data-workspace-dev-inspect-scope]");
    await expect(scopeSpotlight).toBeVisible();

    await previewFrame.locator("[data-ir-id='home-title']").first().click({ force: true });
    await expect(scopeTreeNode).toHaveAttribute("aria-selected", "true");

    await previewFrame.locator("[data-ir-id='nav-button']").first().click({ force: true });
    await expect(outsideTreeNode).not.toHaveAttribute("aria-selected", "true");

    await page.getByTestId("breadcrumb-exit-scope").click();
    await expect(page.getByTestId("breadcrumb-scope-badge")).not.toBeVisible();
    await expect
      .poll(
        async () => {
          const types = await getInspectControlMessageTypes(previewFrame);
          return types.includes("inspect:scope:clear");
        },
        { timeout: 40_000 }
      )
      .toBe(true);
    await expect(scopeSpotlight).not.toBeVisible();

    await previewFrame.locator("[data-ir-id='home-title']").first().click({ force: true });
    await expect(outsideTreeNode).toHaveAttribute("aria-selected", "true");

    await page.evaluate(
      ({ origin, validSessionToken }) => {
        const iframe = document.querySelector("iframe[title='Live preview']");
        if (!(iframe instanceof HTMLIFrameElement) || !iframe.contentWindow) {
          throw new Error("Preview iframe contentWindow is unavailable.");
        }
        iframe.contentWindow.postMessage(
          {
            type: "inspect:scope:set",
            sessionToken: validSessionToken,
            irNodeId: "missing-scope-node-443"
          },
          origin
        );
      },
      { origin: previewOrigin, validSessionToken: sessionToken }
    );
    await expect(scopeSpotlight).not.toBeVisible();

    await scopeTreeNode.click();
    await expect(scopeTreeNode).toHaveAttribute("aria-selected", "true");
    await previewFrame.locator("[data-ir-id='home-title']").first().click({ force: true });
    await expect(outsideTreeNode).toHaveAttribute("aria-selected", "true");
  });
});
