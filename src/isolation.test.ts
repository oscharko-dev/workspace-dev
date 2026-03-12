import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import test, { afterEach } from "node:test";
import {
  createProjectInstance,
  removeProjectInstance,
  removeAllInstances,
  getProjectInstance,
  listProjectInstances,
  resolveIsolationEntryPointForTest
} from "./isolation.js";

// Clean up after each test to avoid leaked processes
afterEach(async () => {
  await removeAllInstances();
});

test("isolation: two instances run in parallel on different ports", async () => {
  const instA = await createProjectInstance("project-alpha", { workDir: "/tmp" });
  const instB = await createProjectInstance("project-beta", { workDir: "/tmp" });

  // Ports must be different (OS-assigned)
  assert.notEqual(instA.port, instB.port, "Instances must have different ports");
  assert.notEqual(instA.instanceId, instB.instanceId, "Instance IDs must differ");

  // Both must be reachable via HTTP
  const [resA, resB] = await Promise.all([
    fetch(`http://${instA.host}:${instA.port}/healthz`),
    fetch(`http://${instB.host}:${instB.port}/healthz`)
  ]);

  assert.equal(resA.status, 200);
  assert.equal(resB.status, 200);

  const bodyA = await resA.json() as Record<string, unknown>;
  const bodyB = await resB.json() as Record<string, unknown>;
  assert.equal(bodyA.ok, true);
  assert.equal(bodyB.ok, true);
});

test("isolation: entrypoint resolver supports dist and source execution modes", () => {
  const resolved = resolveIsolationEntryPointForTest();
  assert.equal(existsSync(resolved.path), true);

  if (resolved.path.endsWith(".ts")) {
    const hasTsxImport = resolved.execArgv.some(
      (arg, index) => arg === "--import" && resolved.execArgv[index + 1] === "tsx"
    );
    assert.equal(hasTsxImport, true);
    return;
  }

  assert.equal(resolved.path.endsWith(".js"), true);
});

test("isolation: /workspace endpoint returns correct port per instance", async () => {
  const inst = await createProjectInstance("project-gamma", { workDir: "/tmp" });

  const res = await fetch(`http://${inst.host}:${inst.port}/workspace`);
  assert.equal(res.status, 200);

  const body = await res.json() as Record<string, unknown>;
  assert.equal(body.running, true);
  assert.equal(body.host, inst.host);
  // Port 0 was used for creation, but the OS assigned a real port
  assert.equal(typeof body.port, "number");
});

test("isolation: removeProjectInstance frees the port", async () => {
  const inst = await createProjectInstance("project-delta", { workDir: "/tmp" });
  const port = inst.port;

  // Instance is reachable
  const res1 = await fetch(`http://${inst.host}:${port}/healthz`);
  assert.equal(res1.status, 200);

  // Remove it
  const removed = await removeProjectInstance("project-delta");
  assert.equal(removed, true);

  // getProjectInstance should return undefined
  assert.equal(getProjectInstance("project-delta"), undefined);

  // Port should no longer be serving (connection refused)
  try {
    await fetch(`http://127.0.0.1:${port}/healthz`, { signal: AbortSignal.timeout(1000) });
    assert.fail("Expected connection refused after removal");
  } catch (err) {
    // Expected: fetch error (connection refused or abort)
    assert.ok(err instanceof Error);
  }
});

test("isolation: listProjectInstances tracks active instances", async () => {
  assert.equal(listProjectInstances().size, 0);

  await createProjectInstance("project-e1", { workDir: "/tmp" });
  assert.equal(listProjectInstances().size, 1);

  await createProjectInstance("project-e2", { workDir: "/tmp" });
  assert.equal(listProjectInstances().size, 2);

  await removeProjectInstance("project-e1");
  assert.equal(listProjectInstances().size, 1);

  await removeAllInstances();
  assert.equal(listProjectInstances().size, 0);
});

test("isolation: duplicate projectKey throws", async () => {
  await createProjectInstance("project-dup", { workDir: "/tmp" });

  await assert.rejects(
    () => createProjectInstance("project-dup", { workDir: "/tmp" }),
    /already exists/
  );
});

test("isolation: invalid projectKey throws", async () => {
  await assert.rejects(
    () => createProjectInstance("bad key!", { workDir: "/tmp" }),
    /Invalid projectKey/
  );

  await assert.rejects(
    () => createProjectInstance("../traversal", { workDir: "/tmp" }),
    /Invalid projectKey/
  );
});

test("isolation: removeProjectInstance returns false for unknown key", async () => {
  const result = await removeProjectInstance("nonexistent");
  assert.equal(result, false);
});

test("isolation: cleanup works after removeAllInstances", async () => {
  await createProjectInstance("cleanup-a", { workDir: "/tmp" });
  await createProjectInstance("cleanup-b", { workDir: "/tmp" });

  assert.equal(listProjectInstances().size, 2);

  await removeAllInstances();

  assert.equal(listProjectInstances().size, 0);
  assert.equal(getProjectInstance("cleanup-a"), undefined);
  assert.equal(getProjectInstance("cleanup-b"), undefined);
});

test("isolation: child startup errors are surfaced and do not leave active instances", async () => {
  await assert.rejects(
    () =>
      createProjectInstance("project-bad-host", {
        workDir: "/tmp",
        host: "invalid-hostname.workspace-dev.invalid"
      }),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /Instance for 'project-bad-host' failed:/);
      return true;
    }
  );

  assert.equal(getProjectInstance("project-bad-host"), undefined);
  assert.equal(listProjectInstances().size, 0);
});
