import assert from "node:assert/strict";
import test from "node:test";
import { createWorkspaceServer } from "./server.js";

test("workspace server starts and responds on /workspace", async () => {
  const port = 19830 + Math.floor(Math.random() * 1000);
  const server = await createWorkspaceServer({ port, host: "127.0.0.1" });

  try {
    const response = await server.app.inject({
      method: "GET",
      url: "/workspace"
    });

    assert.equal(response.statusCode, 200);
    const body = response.json();
    assert.equal(body.running, true);
    assert.equal(body.figmaSourceMode, "rest");
    assert.equal(body.llmCodegenMode, "deterministic");
    assert.equal(body.port, port);
    assert.equal(typeof body.uptimeMs, "number");
  } finally {
    await server.app.close();
  }
});

test("workspace server healthz endpoint", async () => {
  const port = 19830 + Math.floor(Math.random() * 1000);
  const server = await createWorkspaceServer({ port, host: "127.0.0.1" });

  try {
    const response = await server.app.inject({
      method: "GET",
      url: "/healthz"
    });

    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json(), { ok: true, service: "workspace-dev" });
  } finally {
    await server.app.close();
  }
});

test("workspace server exposes listening address metadata and clears it after close", async () => {
  const server = await createWorkspaceServer({ port: 0, host: "127.0.0.1" });

  const addressesBeforeClose = server.app.addresses();
  assert.equal(addressesBeforeClose.length > 0, true);
  assert.equal(addressesBeforeClose[0]?.port, server.port);

  await server.app.close();

  const addressesAfterClose = server.app.addresses();
  assert.equal(addressesAfterClose.length, 0);
});

test("workspace server close is not silently idempotent", async () => {
  const server = await createWorkspaceServer({ port: 0, host: "127.0.0.1" });
  await server.app.close();
  await assert.rejects(async () => {
    await server.app.close();
  });
});

test("workspace server reports unknown route with deterministic 404 envelope", async () => {
  const port = 19830 + Math.floor(Math.random() * 1000);
  const server = await createWorkspaceServer({ port, host: "127.0.0.1" });

  try {
    const response = await server.app.inject({
      method: "GET",
      url: "/not-found"
    });

    assert.equal(response.statusCode, 404);
    const body = response.json();
    assert.equal(body.error, "NOT_FOUND");
    assert.match(body.message, /Unknown route/i);
  } finally {
    await server.app.close();
  }
});

test("workspace server blocks mcp mode on submit", async () => {
  const port = 19830 + Math.floor(Math.random() * 1000);
  const server = await createWorkspaceServer({ port, host: "127.0.0.1" });

  try {
    const response = await server.app.inject({
      method: "POST",
      url: "/workspace/submit",
      headers: { "content-type": "application/json" },
      payload: {
        figmaSourceMode: "mcp",
        figmaFileKey: "test-key"
      }
    });

    assert.equal(response.statusCode, 400);
    const body = response.json();
    assert.equal(body.error, "MODE_LOCK_VIOLATION");
    assert.match(body.message, /mcp.*not available/i);
  } finally {
    await server.app.close();
  }
});

test("workspace server rejects invalid JSON payloads", async () => {
  const port = 19830 + Math.floor(Math.random() * 1000);
  const server = await createWorkspaceServer({ port, host: "127.0.0.1" });

  try {
    const response = await server.app.inject({
      method: "POST",
      url: "/workspace/submit",
      headers: { "content-type": "application/json" },
      payload: "{\"figmaFileKey\":"
    });

    assert.equal(response.statusCode, 400);
    const body = response.json();
    assert.equal(body.error, "VALIDATION_ERROR");
    assert.equal(Array.isArray(body.issues), true);
    assert.match(body.issues[0]!.message, /Invalid JSON payload/i);
  } finally {
    await server.app.close();
  }
});

test("workspace server rejects oversized submit payloads", async () => {
  const port = 19830 + Math.floor(Math.random() * 1000);
  const server = await createWorkspaceServer({ port, host: "127.0.0.1" });

  try {
    const oversizedBody = JSON.stringify({
      figmaFileKey: "x".repeat(1_048_700)
    });

    const response = await server.app.inject({
      method: "POST",
      url: "/workspace/submit",
      headers: { "content-type": "application/json" },
      payload: oversizedBody
    });

    assert.equal(response.statusCode, 400);
    const body = response.json();
    assert.equal(body.error, "VALIDATION_ERROR");
    assert.equal(Array.isArray(body.issues), true);
    assert.match(body.issues[0]!.message, /1 MiB size limit/i);
  } finally {
    await server.app.close();
  }
});

test("workspace server rejects submit requests without a figmaFileKey", async () => {
  const port = 19830 + Math.floor(Math.random() * 1000);
  const server = await createWorkspaceServer({ port, host: "127.0.0.1" });

  try {
    const response = await server.app.inject({
      method: "POST",
      url: "/workspace/submit",
      headers: { "content-type": "application/json" },
      payload: {
        figmaSourceMode: "rest",
        llmCodegenMode: "deterministic"
      }
    });

    assert.equal(response.statusCode, 400);
    const body = response.json();
    assert.equal(body.error, "VALIDATION_ERROR");
    assert.ok(Array.isArray(body.issues));
  } finally {
    await server.app.close();
  }
});

test("workspace server surfaces non-port-conflict listen failures", async () => {
  await assert.rejects(
    async () => {
      await createWorkspaceServer({
        host: "invalid-hostname.workspace-dev.invalid",
        port: 0
      });
    },
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.doesNotMatch(error.message, /already in use/i);
      return true;
    }
  );
});

test("workspace server reports deterministic submit as not yet implemented", async () => {
  const port = 19830 + Math.floor(Math.random() * 1000);
  const server = await createWorkspaceServer({ port, host: "127.0.0.1" });

  try {
    const response = await server.app.inject({
      method: "POST",
      url: "/workspace/submit",
      headers: { "content-type": "application/json" },
      payload: {
        figmaSourceMode: "rest",
        llmCodegenMode: "deterministic",
        figmaFileKey: "test-key"
      }
    });

    assert.equal(response.statusCode, 501);
    const body = response.json();
    assert.equal(body.error, "SUBMIT_NOT_IMPLEMENTED");
    assert.equal(body.status, "not_implemented");
    assert.equal(body.figmaFileKey, "test-key");
    assert.equal(body.allowedModes.figmaSourceMode, "rest");
    assert.equal(body.allowedModes.llmCodegenMode, "deterministic");
    assert.match(body.message, /does not execute figma fetch, code generation, or filesystem output/i);
  } finally {
    await server.app.close();
  }
});

// ── Runtime validation tests (P2) ─────────────────────────────────────────

test("workspace server rejects non-string figmaFileKey via runtime validation", async () => {
  const port = 19830 + Math.floor(Math.random() * 1000);
  const server = await createWorkspaceServer({ port, host: "127.0.0.1" });

  try {
    const response = await server.app.inject({
      method: "POST",
      url: "/workspace/submit",
      headers: { "content-type": "application/json" },
      payload: { figmaFileKey: 12345 }
    });

    assert.equal(response.statusCode, 400);
    const body = response.json();
    assert.equal(body.error, "VALIDATION_ERROR");
    assert.ok(body.issues.length > 0);
  } finally {
    await server.app.close();
  }
});

test("workspace server rejects empty figmaFileKey via runtime validation", async () => {
  const port = 19830 + Math.floor(Math.random() * 1000);
  const server = await createWorkspaceServer({ port, host: "127.0.0.1" });

  try {
    const response = await server.app.inject({
      method: "POST",
      url: "/workspace/submit",
      headers: { "content-type": "application/json" },
      payload: { figmaFileKey: "" }
    });

    assert.equal(response.statusCode, 400);
    const body = response.json();
    assert.equal(body.error, "VALIDATION_ERROR");
  } finally {
    await server.app.close();
  }
});

test("workspace server rejects unknown fields in submit body (strict schema)", async () => {
  const port = 19830 + Math.floor(Math.random() * 1000);
  const server = await createWorkspaceServer({ port, host: "127.0.0.1" });

  try {
    const response = await server.app.inject({
      method: "POST",
      url: "/workspace/submit",
      headers: { "content-type": "application/json" },
      payload: {
        figmaFileKey: "test-key",
        unknownField: "should-fail"
      }
    });

    assert.equal(response.statusCode, 400);
    const body = response.json();
    assert.equal(body.error, "VALIDATION_ERROR");
  } finally {
    await server.app.close();
  }
});

test("workspace server rejects empty body on submit", async () => {
  const port = 19830 + Math.floor(Math.random() * 1000);
  const server = await createWorkspaceServer({ port, host: "127.0.0.1" });

  try {
    const response = await server.app.inject({
      method: "POST",
      url: "/workspace/submit",
      headers: { "content-type": "application/json" },
      payload: {}
    });

    assert.equal(response.statusCode, 400);
    const body = response.json();
    assert.equal(body.error, "VALIDATION_ERROR");
  } finally {
    await server.app.close();
  }
});
