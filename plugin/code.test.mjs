/**
 * Tests for the upload message handler in plugin/code.js.
 *
 * code.js uses Figma globals (figma, __html__) and cannot be loaded as an
 * ES module in Node. We execute it with vm.runInThisContext after setting up
 * all globals, then read figma.ui.onmessage to drive the handler directly.
 *
 * Run: node --test plugin/code.test.mjs
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
// Helpers
// ---------------------------------------------------------------------------

/**
 * Builds a minimal Figma-like node that satisfies exportAsync().
 * exportAsync in code.js is called with { format: "JSON_REST_V1" }, but our
 * mock ignores the options argument and returns a plausible REST v1 shape.
 */
function makeNode(type = "FRAME", name = "Test Frame") {
  return {
    id: "123:456",
    type,
    name,
    exportAsync: async (_opts) => ({
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
function loadPlugin(figmaMock, fetchMock) {
  globalThis.figma = figmaMock;
  globalThis.__html__ = "";
  globalThis.fetch = fetchMock;
  // Wrap in an IIFE so that const/let declarations in code.js get a fresh
  // block scope on each call. Without this, the second loadPlugin call throws
  // "Identifier 'ENVELOPE_KIND' has already been declared" because
  // runInThisContext shares the same top-level scope across invocations.
  runInThisContext(`(function(){\n${CODE_JS}\n})()`);
  return figmaMock.ui.onmessage;
}

/**
 * Creates a fresh figma mock object. postMessage records every call so tests
 * can assert on specific message types without caring about order.
 */
function makeFigmaMock(selection = []) {
  const posted = [];
  return {
    _posted: posted,
    showUI: () => {},
    closePlugin: () => {},
    currentPage: {
      selection,
    },
    ui: {
      postMessage(msg) {
        posted.push(msg);
      },
      // onmessage is assigned by code.js at load time
      onmessage: null,
    },
  };
}

/** Returns all postMessage calls of the given type. */
function messagesOfType(mock, type) {
  return mock._posted.filter((m) => m.type === type);
}

/** Returns the single postMessage call of the given type, or throws. */
function singleMessageOfType(mock, type) {
  const matches = messagesOfType(mock, type);
  assert.equal(
    matches.length,
    1,
    `Expected exactly one "${type}" message, got ${matches.length}: ${JSON.stringify(mock._posted)}`,
  );
  return matches[0];
}

// ---------------------------------------------------------------------------
// Upload success path
// ---------------------------------------------------------------------------

describe("upload-to-local — success", () => {
  let figmaMock;
  let onmessage;
  let capturedFetchArgs;

  beforeEach(() => {
    capturedFetchArgs = null;
    figmaMock = makeFigmaMock([makeNode("FRAME", "Test Frame")]);

    const fetchMock = async (url, options) => {
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

    const body = JSON.parse(capturedFetchArgs.options.body);
    assert.equal(body.figmaSourceMode, "figma_plugin");
  });

  it("sends figmaJsonPayload as a JSON string containing the envelope kind and pluginVersion", async () => {
    await onmessage({
      type: "upload-to-local",
      endpointUrl: "http://127.0.0.1:1983",
    });

    const body = JSON.parse(capturedFetchArgs.options.body);
    assert.ok(
      typeof body.figmaJsonPayload === "string",
      "figmaJsonPayload must be a JSON string",
    );

    const payload = JSON.parse(body.figmaJsonPayload);
    assert.equal(payload.kind, "workspace-dev/figma-selection@1");
    assert.equal(payload.pluginVersion, "0.2.0");
  });

  it("sends a status message before fetching", async () => {
    await onmessage({
      type: "upload-to-local",
      endpointUrl: "http://127.0.0.1:1983",
    });

    const statusMsgs = messagesOfType(figmaMock, "status");
    const uploadingMsg = statusMsgs.find((m) =>
      m.message.includes("Uploading"),
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
  let figmaMock;
  let onmessage;

  beforeEach(() => {
    figmaMock = makeFigmaMock([makeNode("FRAME", "Test Frame")]);

    const fetchMock = async (_url, _options) => ({
      ok: false,
      status: 422,
      headers: {
        get: (header) => (header === "x-request-id" ? "req-xyz" : null),
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
  let figmaMock;
  let onmessage;

  beforeEach(() => {
    figmaMock = makeFigmaMock([makeNode("FRAME", "Test Frame")]);

    const fetchMock = async (_url, _options) => ({
      ok: false,
      status: 503,
      headers: { get: () => "" },
      json: async () => ({}), // no message field
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
  let figmaMock;
  let onmessage;

  beforeEach(() => {
    figmaMock = makeFigmaMock([makeNode("FRAME", "Test Frame")]);

    const fetchMock = async (_url, _options) => {
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
  let figmaMock;
  let onmessage;

  beforeEach(() => {
    figmaMock = makeFigmaMock([]); // no nodes selected
    const fetchMock = async () => {
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
  let figmaMock;
  let onmessage;

  beforeEach(() => {
    figmaMock = makeFigmaMock([makeNode("SLICE", "Bad Node")]);
    const fetchMock = async () => {
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
      err.message.includes("Unsupported node type"),
      `Expected 'Unsupported node type' in: ${err.message}`,
    );
  });
});

// ---------------------------------------------------------------------------
// exportAsync failure during upload
// ---------------------------------------------------------------------------

describe("upload-to-local — exportAsync throws", () => {
  let figmaMock;
  let onmessage;

  beforeEach(() => {
    const badNode = {
      id: "999:000",
      type: "FRAME",
      name: "Broken Frame",
      exportAsync: async () => {
        throw new Error("Figma export quota exceeded");
      },
    };
    figmaMock = makeFigmaMock([badNode]);
    const fetchMock = async () => {
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
      err.message.includes("Figma export quota exceeded"),
      `Expected export error message in: ${err.message}`,
    );
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

    const onmessage = loadPlugin(figmaMock, async () => {
      throw new Error("fetch must not be called for close");
    });

    await onmessage({ type: "close" });
    assert.ok(closeCalled, "closePlugin should have been called");
  });
});
