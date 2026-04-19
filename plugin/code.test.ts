/**
 * Tests for the upload message handler in plugin/code.js.
 *
 * code.js uses Figma globals (figma, __html__) and cannot be loaded as an
 * ES module in Node. We execute it with vm.runInThisContext after setting up
 * all globals, then read figma.ui.onmessage to drive the handler directly.
 */

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInThisContext } from "node:vm";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CODE_JS = readFileSync(join(__dirname, "code.js"), "utf8");

// ---------------------------------------------------------------------------
// Types mirroring the plugin's runtime contracts
// ---------------------------------------------------------------------------

interface ExportAsyncOptions {
  format: string;
}

interface ExportedRestDocument {
  document: { id: string; type: string; name: string };
  components: Record<string, unknown>;
  componentSets: Record<string, unknown>;
  styles: Record<string, unknown>;
}

interface FakeNode {
  id: string;
  type: string;
  name: string;
  exportAsync: (options: ExportAsyncOptions) => Promise<ExportedRestDocument>;
}

interface PostedMessage {
  type: string;
  [key: string]: unknown;
}

interface FakeFigma {
  _posted: PostedMessage[];
  showUI: () => void;
  closePlugin: () => void;
  currentPage: { selection: FakeNode[] };
  ui: {
    postMessage: (msg: PostedMessage) => void;
    onmessage: ((message: unknown) => unknown) | null;
  };
}

interface FakeFetchResponseHeaders {
  get: (name: string) => string | null;
}

interface FakeFetchResponse {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
  headers: FakeFetchResponseHeaders;
}

type FakeFetch = (
  url: string,
  options: { method?: string; headers?: unknown; body?: string },
) => Promise<FakeFetchResponse>;

interface CapturedFetchArgs {
  url: string;
  options: { method?: string; headers?: unknown; body?: string };
}

type Onmessage = (message: unknown) => Promise<void>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Builds a minimal Figma-like node that satisfies exportAsync().
 * exportAsync in code.js is called with { format: "JSON_REST_V1" }, but our
 * mock ignores the options argument and returns a plausible REST v1 shape.
 */
function makeNode(type = "FRAME", name = "Test Frame"): FakeNode {
  return {
    id: "123:456",
    type,
    name,
    exportAsync: async (_opts: ExportAsyncOptions) => ({
      document: { id: "123:456", type, name },
      components: {},
      componentSets: {},
      styles: {},
    }),
  };
}

/**
 * Loads code.js into this context with the supplied figma mock.
 * Returns the onmessage handler that code.js registered.
 *
 * Each call re-executes the plugin source so globals are fresh.
 */
function loadPlugin(figmaMock: FakeFigma, fetchMock: FakeFetch): Onmessage {
  (globalThis as Record<string, unknown>).figma = figmaMock;
  (globalThis as Record<string, unknown>).__html__ = "";
  (globalThis as Record<string, unknown>).fetch = fetchMock;
  // Wrap in an IIFE so that const/let declarations in code.js get a fresh
  // block scope on each call. Without this, the second loadPlugin call throws
  // "Identifier 'ENVELOPE_KIND' has already been declared" because
  // runInThisContext shares the same top-level scope across invocations.
  runInThisContext(`(function(){\n${CODE_JS}\n})()`);
  const handler = figmaMock.ui.onmessage;
  assert.ok(handler, "code.js must register figma.ui.onmessage");
  return handler as Onmessage;
}

/**
 * Creates a fresh figma mock object. postMessage records every call so tests
 * can assert on specific message types without caring about order.
 */
function makeFigmaMock(selection: FakeNode[] = []): FakeFigma {
  const posted: PostedMessage[] = [];
  return {
    _posted: posted,
    showUI: () => {},
    closePlugin: () => {},
    currentPage: {
      selection,
    },
    ui: {
      postMessage(msg: PostedMessage) {
        posted.push(msg);
      },
      onmessage: null,
    },
  };
}

/** Returns all postMessage calls of the given type. */
function messagesOfType(mock: FakeFigma, type: string): PostedMessage[] {
  return mock._posted.filter((m) => m.type === type);
}

/** Returns the single postMessage call of the given type, or throws. */
function singleMessageOfType(mock: FakeFigma, type: string): PostedMessage {
  const matches = messagesOfType(mock, type);
  assert.equal(
    matches.length,
    1,
    `Expected exactly one "${type}" message, got ${matches.length}: ${JSON.stringify(mock._posted)}`,
  );
  const match = matches[0];
  assert.ok(match);
  return match;
}

// ---------------------------------------------------------------------------
// Upload success path
// ---------------------------------------------------------------------------

describe("upload-to-local — success", () => {
  let figmaMock: FakeFigma;
  let onmessage: Onmessage;
  let capturedFetchArgs: CapturedFetchArgs | null;

  beforeEach(() => {
    capturedFetchArgs = null;
    figmaMock = makeFigmaMock([makeNode("FRAME", "Test Frame")]);

    const fetchMock: FakeFetch = async (url, options) => {
      capturedFetchArgs = { url, options };
      return {
        ok: true,
        status: 200,
        json: async () => ({ jobId: "job-abc" }),
        headers: { get: () => null },
      };
    };

    onmessage = loadPlugin(figmaMock, fetchMock);
  });

  it("posts upload-result with jobId and trackingUrl on success", async () => {
    await onmessage({
      type: "upload-to-local",
      endpointUrl: "http://127.0.0.1:1983",
    });

    const result = singleMessageOfType(figmaMock, "upload-result");
    assert.equal(result.jobId, "job-abc");
    assert.equal(
      result.trackingUrl,
      "http://127.0.0.1:1983/workspace/jobs/job-abc",
    );
  });

  it("calls fetch with the correct submit URL", async () => {
    await onmessage({
      type: "upload-to-local",
      endpointUrl: "http://127.0.0.1:1983",
    });

    assert.ok(capturedFetchArgs, "fetch was not called");
    assert.equal(
      capturedFetchArgs.url,
      "http://127.0.0.1:1983/workspace/submit",
    );
    assert.equal(capturedFetchArgs.options.method, "POST");
  });

  it("sends figmaSourceMode: 'figma_plugin' in the fetch body", async () => {
    await onmessage({
      type: "upload-to-local",
      endpointUrl: "http://127.0.0.1:1983",
    });

    assert.ok(capturedFetchArgs, "fetch was not called");
    assert.ok(capturedFetchArgs.options.body, "fetch body was not sent");
    const body = JSON.parse(capturedFetchArgs.options.body) as {
      figmaSourceMode: string;
    };
    assert.equal(body.figmaSourceMode, "figma_plugin");
  });

  it("sends figmaJsonPayload as a JSON string containing the envelope kind and pluginVersion", async () => {
    await onmessage({
      type: "upload-to-local",
      endpointUrl: "http://127.0.0.1:1983",
    });

    assert.ok(capturedFetchArgs, "fetch was not called");
    assert.ok(capturedFetchArgs.options.body, "fetch body was not sent");
    const body = JSON.parse(capturedFetchArgs.options.body) as {
      figmaJsonPayload: string;
    };
    assert.ok(
      typeof body.figmaJsonPayload === "string",
      "figmaJsonPayload must be a JSON string",
    );

    const payload = JSON.parse(body.figmaJsonPayload) as {
      kind: string;
      pluginVersion: string;
    };
    assert.equal(payload.kind, "workspace-dev/figma-selection@1");
    assert.equal(payload.pluginVersion, "0.2.0");
  });

  it("sends a status message before fetching", async () => {
    await onmessage({
      type: "upload-to-local",
      endpointUrl: "http://127.0.0.1:1983",
    });

    const statusMsgs = messagesOfType(figmaMock, "status");
    const uploadingMsg = statusMsgs.find(
      (m) => typeof m.message === "string" && m.message.includes("Uploading"),
    );
    assert.ok(
      uploadingMsg,
      "Expected a 'Uploading to WorkspaceDev...' status message",
    );
  });
});

// ---------------------------------------------------------------------------
// Upload HTTP error path
// ---------------------------------------------------------------------------

describe("upload-to-local — HTTP error", () => {
  let figmaMock: FakeFigma;
  let onmessage: Onmessage;

  beforeEach(() => {
    figmaMock = makeFigmaMock([makeNode("FRAME", "Test Frame")]);

    const fetchMock: FakeFetch = async (_url, _options) => ({
      ok: false,
      status: 422,
      headers: {
        get: (header: string) => (header === "x-request-id" ? "req-xyz" : null),
      },
      json: async () => ({ message: "Validation failed" }),
    });

    onmessage = loadPlugin(figmaMock, fetchMock);
  });

  it("posts upload-error with the server message and requestId", async () => {
    await onmessage({
      type: "upload-to-local",
      endpointUrl: "http://127.0.0.1:1983",
    });

    const err = singleMessageOfType(figmaMock, "upload-error");
    assert.equal(err.message, "Validation failed");
    assert.equal(err.requestId, "req-xyz");
  });

  it("does not post upload-result on HTTP error", async () => {
    await onmessage({
      type: "upload-to-local",
      endpointUrl: "http://127.0.0.1:1983",
    });

    assert.equal(messagesOfType(figmaMock, "upload-result").length, 0);
  });
});

// ---------------------------------------------------------------------------
// Upload HTTP error path — fallback when body lacks message
// ---------------------------------------------------------------------------

describe("upload-to-local — HTTP error with no body message", () => {
  let figmaMock: FakeFigma;
  let onmessage: Onmessage;

  beforeEach(() => {
    figmaMock = makeFigmaMock([makeNode("FRAME", "Test Frame")]);

    const fetchMock: FakeFetch = async (_url, _options) => ({
      ok: false,
      status: 503,
      headers: { get: () => "" },
      json: async () => ({}),
    });

    onmessage = loadPlugin(figmaMock, fetchMock);
  });

  it("falls back to 'HTTP <status>' when body has no message field", async () => {
    await onmessage({
      type: "upload-to-local",
      endpointUrl: "http://127.0.0.1:1983",
    });

    const err = singleMessageOfType(figmaMock, "upload-error");
    assert.equal(err.message, "HTTP 503");
  });
});

// ---------------------------------------------------------------------------
// Network / fetch throw path
// ---------------------------------------------------------------------------

describe("upload-to-local — network error", () => {
  let figmaMock: FakeFigma;
  let onmessage: Onmessage;

  beforeEach(() => {
    figmaMock = makeFigmaMock([makeNode("FRAME", "Test Frame")]);

    const fetchMock: FakeFetch = async (_url, _options) => {
      throw new Error("ECONNREFUSED");
    };

    onmessage = loadPlugin(figmaMock, fetchMock);
  });

  it("posts upload-error with the thrown error message", async () => {
    await onmessage({
      type: "upload-to-local",
      endpointUrl: "http://127.0.0.1:1983",
    });

    const err = singleMessageOfType(figmaMock, "upload-error");
    assert.equal(err.message, "Upload failed: ECONNREFUSED");
  });

  it("does not post upload-result on network error", async () => {
    await onmessage({
      type: "upload-to-local",
      endpointUrl: "http://127.0.0.1:1983",
    });

    assert.equal(messagesOfType(figmaMock, "upload-result").length, 0);
  });
});

// ---------------------------------------------------------------------------
// Empty selection guard (upload mode)
// ---------------------------------------------------------------------------

describe("upload-to-local — empty selection", () => {
  let figmaMock: FakeFigma;
  let onmessage: Onmessage;

  beforeEach(() => {
    figmaMock = makeFigmaMock([]);
    const fetchMock: FakeFetch = async () => {
      throw new Error("fetch should not be called with empty selection");
    };

    onmessage = loadPlugin(figmaMock, fetchMock);
  });

  it("posts an error and does not call fetch when nothing is selected", async () => {
    await onmessage({
      type: "upload-to-local",
      endpointUrl: "http://127.0.0.1:1983",
    });

    const err = singleMessageOfType(figmaMock, "error");
    assert.equal(
      err.message,
      "No nodes selected. Please select at least one layer.",
    );
  });

  it("does not post upload-result when nothing is selected", async () => {
    await onmessage({
      type: "upload-to-local",
      endpointUrl: "http://127.0.0.1:1983",
    });

    assert.equal(messagesOfType(figmaMock, "upload-result").length, 0);
  });

  it("does not post upload-error when nothing is selected (just the generic error)", async () => {
    await onmessage({
      type: "upload-to-local",
      endpointUrl: "http://127.0.0.1:1983",
    });

    assert.equal(messagesOfType(figmaMock, "upload-error").length, 0);
  });
});

// ---------------------------------------------------------------------------
// Unsupported node type guard (upload mode)
// ---------------------------------------------------------------------------

describe("upload-to-local — unsupported node type", () => {
  let figmaMock: FakeFigma;
  let onmessage: Onmessage;

  beforeEach(() => {
    figmaMock = makeFigmaMock([makeNode("SLICE", "Bad Node")]);
    const fetchMock: FakeFetch = async () => {
      throw new Error("fetch should not be called for unsupported node");
    };

    onmessage = loadPlugin(figmaMock, fetchMock);
  });

  it("posts an error and skips upload when node type is unsupported", async () => {
    await onmessage({
      type: "upload-to-local",
      endpointUrl: "http://127.0.0.1:1983",
    });

    const err = singleMessageOfType(figmaMock, "error");
    assert.ok(
      typeof err.message === "string" &&
        err.message.includes("Unsupported node type"),
      `Expected 'Unsupported node type' in: ${String(err.message)}`,
    );
  });

  it("lists the supported set in the error message", async () => {
    await onmessage({
      type: "upload-to-local",
      endpointUrl: "http://127.0.0.1:1983",
    });

    const err = singleMessageOfType(figmaMock, "error");
    assert.ok(
      typeof err.message === "string" && err.message.includes("Supported:"),
      `Expected 'Supported:' listing in: ${String(err.message)}`,
    );
    assert.ok(
      typeof err.message === "string" && err.message.includes("FRAME"),
      `Expected 'FRAME' in supported list: ${String(err.message)}`,
    );
  });
});

// ---------------------------------------------------------------------------
// Clipboard export path (valid FRAME selection)
// ---------------------------------------------------------------------------

describe("export-selection — clipboard mode, valid FRAME", () => {
  let figmaMock: FakeFigma;
  let onmessage: Onmessage;
  let exportAsyncCalls: ExportAsyncOptions[];

  beforeEach(() => {
    exportAsyncCalls = [];
    const node: FakeNode = {
      id: "123:456",
      type: "FRAME",
      name: "Test Frame",
      exportAsync: async (opts) => {
        exportAsyncCalls.push(opts);
        return {
          document: { id: "123:456", type: "FRAME", name: "Test Frame" },
          components: {},
          componentSets: {},
          styles: {},
        };
      },
    };
    figmaMock = makeFigmaMock([node]);
    const fetchMock: FakeFetch = async () => {
      throw new Error("fetch should not be called in clipboard mode");
    };

    onmessage = loadPlugin(figmaMock, fetchMock);
  });

  it("invokes exportAsync with { format: 'JSON_REST_V1' }", async () => {
    await onmessage({ type: "export-selection" });

    assert.equal(exportAsyncCalls.length, 1);
    assert.deepEqual(exportAsyncCalls[0], { format: "JSON_REST_V1" });
  });

  it("posts copy-to-clipboard with the envelope JSON string", async () => {
    await onmessage({ type: "export-selection" });

    const msg = singleMessageOfType(figmaMock, "copy-to-clipboard");
    assert.ok(
      typeof msg.payload === "string",
      "copy-to-clipboard payload must be a string",
    );
    const envelope = JSON.parse(msg.payload) as {
      kind: string;
      pluginVersion: string;
      copiedAt: string;
      selections: Array<Record<string, unknown>>;
    };
    assert.equal(envelope.kind, "workspace-dev/figma-selection@1");
    assert.equal(envelope.pluginVersion, "0.2.0");
    assert.equal(typeof envelope.copiedAt, "string");
    assert.equal(envelope.selections.length, 1);
  });
});

// ---------------------------------------------------------------------------
// exportAsync failure during upload
// ---------------------------------------------------------------------------

describe("upload-to-local — exportAsync throws", () => {
  let figmaMock: FakeFigma;
  let onmessage: Onmessage;

  beforeEach(() => {
    const badNode: FakeNode = {
      id: "999:000",
      type: "FRAME",
      name: "Broken Frame",
      exportAsync: async () => {
        throw new Error("Figma export quota exceeded");
      },
    };
    figmaMock = makeFigmaMock([badNode]);
    const fetchMock: FakeFetch = async () => {
      throw new Error("fetch should not be called when export fails");
    };

    onmessage = loadPlugin(figmaMock, fetchMock);
  });

  it("posts an error with the export failure message", async () => {
    await onmessage({
      type: "upload-to-local",
      endpointUrl: "http://127.0.0.1:1983",
    });

    const err = singleMessageOfType(figmaMock, "error");
    assert.ok(
      typeof err.message === "string" &&
        err.message.includes("Figma export quota exceeded"),
      `Expected export error message in: ${String(err.message)}`,
    );
  });

  it("does not fall through to upload-error when exportAsync throws", async () => {
    await onmessage({
      type: "upload-to-local",
      endpointUrl: "http://127.0.0.1:1983",
    });

    assert.equal(messagesOfType(figmaMock, "upload-error").length, 0);
    assert.equal(messagesOfType(figmaMock, "upload-result").length, 0);
  });
});

// ---------------------------------------------------------------------------
// close message
// ---------------------------------------------------------------------------

describe("close message", () => {
  it("calls figma.closePlugin when message type is 'close'", async () => {
    let closeCalled = false;
    const figmaMock = makeFigmaMock([]);
    figmaMock.closePlugin = () => {
      closeCalled = true;
    };

    const fetchMock: FakeFetch = async () => {
      throw new Error("fetch must not be called for close");
    };
    const onmessage = loadPlugin(figmaMock, fetchMock);

    await onmessage({ type: "close" });
    assert.ok(closeCalled, "closePlugin should have been called");
  });
});
