import { beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { JSDOM } from "jsdom";

const __dirname = dirname(fileURLToPath(import.meta.url));
const UI_HTML = readFileSync(join(__dirname, "ui.html"), "utf8");

interface Harness {
  window: JSDOM["window"];
  statusEl: HTMLElement;
  downloadBtn: HTMLButtonElement;
  createObjectUrlCalls: string[];
}

function createHarness(writeTextImpl: (text: string) => Promise<void>): Harness {
  const dom = new JSDOM(UI_HTML, {
    runScripts: "dangerously",
    url: "https://workspace-dev.test/plugin-ui",
  });
  const { window } = dom;
  const createObjectUrlCalls: string[] = [];
  const revokeObjectUrlCalls: string[] = [];

  Object.defineProperty(window.navigator, "clipboard", {
    configurable: true,
    value: {
      writeText: writeTextImpl,
    },
  });

  Object.defineProperty(window, "parent", {
    configurable: true,
    value: { postMessage: () => undefined },
  });

  window.URL.createObjectURL = ((blob: Blob) => {
    createObjectUrlCalls.push(String(blob.type));
    return "blob:workspace-dev-test";
  }) as typeof window.URL.createObjectURL;
  window.URL.revokeObjectURL = ((url: string) => {
    revokeObjectUrlCalls.push(url);
  }) as typeof window.URL.revokeObjectURL;
  window.HTMLAnchorElement.prototype.click = function click(): void {};

  const statusEl = window.document.getElementById("status");
  const downloadBtn = window.document.getElementById("download-btn");

  assert.ok(statusEl instanceof window.HTMLElement);
  assert.ok(downloadBtn instanceof window.HTMLButtonElement);
  assert.equal(revokeObjectUrlCalls.length, 0);

  return {
    window,
    statusEl,
    downloadBtn,
    createObjectUrlCalls,
  };
}

describe("plugin/ui.html clipboard fallback", () => {
  let harness: Harness;

  beforeEach(() => {
    harness = createHarness(async () => {
      throw new Error("clipboard unavailable");
    });
  });

  it("shows the download fallback when clipboard write fails", async () => {
    await harness.window.onmessage?.({
      data: {
        pluginMessage: {
          type: "copy-to-clipboard",
          payload: "{\"kind\":\"workspace-dev/figma-selection@1\"}",
        },
      },
    } as MessageEvent);

    assert.equal(
      harness.statusEl.textContent,
      "Clipboard write failed. Use Download instead.",
    );
    assert.equal(harness.statusEl.className, "status-error");
  });

  it("retains the payload so Download JSON still works after clipboard failure", async () => {
    await harness.window.onmessage?.({
      data: {
        pluginMessage: {
          type: "copy-to-clipboard",
          payload: "{\"kind\":\"workspace-dev/figma-selection@1\"}",
        },
      },
    } as MessageEvent);

    harness.downloadBtn.click();

    assert.equal(harness.createObjectUrlCalls.length, 1);
    assert.equal(harness.createObjectUrlCalls[0], "application/json");
    assert.equal(harness.statusEl.textContent, "Downloaded!");
    assert.equal(harness.statusEl.className, "status-success");
  });
});
