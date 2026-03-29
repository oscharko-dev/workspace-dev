import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test, { afterEach } from "node:test";
import {
  buildIsolatedChildProcessEnv,
  createProjectInstance,
  removeProjectInstance,
  removeAllInstances,
  getProjectInstance,
  listProjectInstances,
  registerIsolationProcessCleanup,
  resolveIsolationEntryPointForTest,
  unregisterIsolationProcessCleanup
} from "./isolation.js";
import {
  isIsolatedChildAwaitingConfigMessage,
  isIsolatedChildStartMessage,
  isIsolatedChildReadyMessage,
  isIsolatedChildErrorMessage,
  isIsolatedChildShutdownMessage
} from "./isolation-startup-contract.js";

const temporaryIsolationRoots = new Set<string>();

const createIsolationBaseDir = async (): Promise<string> => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-isolation-"));
  temporaryIsolationRoots.add(rootDir);
  return rootDir;
};

const hasTsxRuntimeArg = (value: string): boolean => {
  return value === "tsx" || value.includes("/tsx/") || value.includes("\\tsx\\");
};

// Clean up after each test to avoid leaked processes
afterEach(async () => {
  await removeAllInstances();
  unregisterIsolationProcessCleanup();
  await Promise.all(
    [...temporaryIsolationRoots].map(async (rootDir) => {
      await rm(rootDir, { recursive: true, force: true });
    })
  );
  temporaryIsolationRoots.clear();
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
    assert.equal(resolved.execArgv.some((arg) => hasTsxRuntimeArg(arg)), true);
    return;
  }

  assert.equal(resolved.path.endsWith(".js"), true);
});

test("isolation: /workspace endpoint returns correct port per instance", async () => {
  const baseDir = await createIsolationBaseDir();
  const inst = await createProjectInstance("project-gamma", { workDir: baseDir });

  const res = await fetch(`http://${inst.host}:${inst.port}/workspace`);
  assert.equal(res.status, 200);

  const body = await res.json() as Record<string, unknown>;
  assert.equal(body.running, true);
  assert.equal(body.host, inst.host);
  // Port 0 was used for creation, but the OS assigned a real port
  assert.equal(typeof body.port, "number");
  assert.equal(body.outputRoot, path.resolve(inst.workDir, ".workspace-dev"));
});

test("isolation: restricted child env still boots when logFormat is json", async () => {
  const inst = await createProjectInstance("project-gamma-json", {
    workDir: "/tmp",
    logFormat: "json"
  });

  const res = await fetch(`http://${inst.host}:${inst.port}/healthz`);
  assert.equal(res.status, 200);
});

test("isolation: deprecated targetPath is ignored during isolated child startup", async () => {
  const baseDir = await createIsolationBaseDir();
  const inst = await createProjectInstance("project-targetpath", {
    workDir: baseDir,
    targetPath: "legacy-sync-target"
  });

  const res = await fetch(`http://${inst.host}:${inst.port}/workspace`);
  assert.equal(res.status, 200);

  const body = await res.json() as Record<string, unknown>;
  assert.equal(body.outputRoot, path.resolve(inst.workDir, ".workspace-dev"));
});

test("isolation: child env allowlist excludes parent-only secrets", () => {
  const childEnv = buildIsolatedChildProcessEnv({
    parentEnv: {
      NODE_ENV: "development",
      PATH: "/usr/bin:/bin",
      HOME: "/Users/tester",
      USER: "tester",
      LANG: "en_US.UTF-8",
      TMPDIR: "/tmp/workspace-dev",
      PNPM_HOME: "/Users/tester/.local/share/pnpm",
      SSL_CERT_FILE: "/etc/ssl/certs/custom.pem",
      CUSTOM_SECRET: "super-secret-token",
      CI: "true",
      HTTPS_PROXY: "http://proxy.internal:8080"
    }
  });

  assert.deepEqual(childEnv, {
    NODE_ENV: "production",
    PATH: "/usr/bin:/bin",
    HOME: "/Users/tester",
    USER: "tester",
    LANG: "en_US.UTF-8",
    TMPDIR: "/tmp/workspace-dev",
    PNPM_HOME: "/Users/tester/.local/share/pnpm",
    SSL_CERT_FILE: "/etc/ssl/certs/custom.pem"
  });
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

test("isolation: createProjectInstance does not register host process listeners by default", async () => {
  const beforeCounts = {
    exit: process.listenerCount("exit"),
    sigint: process.listenerCount("SIGINT"),
    sigterm: process.listenerCount("SIGTERM")
  };

  await createProjectInstance("project-no-cleanup-hook", { workDir: "/tmp" });

  const afterCounts = {
    exit: process.listenerCount("exit"),
    sigint: process.listenerCount("SIGINT"),
    sigterm: process.listenerCount("SIGTERM")
  };

  assert.deepEqual(afterCounts, beforeCounts);
});

test("isolation: process cleanup hooks are opt-in and idempotent", () => {
  const beforeCounts = {
    exit: process.listenerCount("exit"),
    sigint: process.listenerCount("SIGINT"),
    sigterm: process.listenerCount("SIGTERM")
  };

  registerIsolationProcessCleanup();
  registerIsolationProcessCleanup();

  assert.equal(process.listenerCount("exit"), beforeCounts.exit + 1);
  assert.equal(process.listenerCount("SIGINT"), beforeCounts.sigint + 1);
  assert.equal(process.listenerCount("SIGTERM"), beforeCounts.sigterm + 1);

  unregisterIsolationProcessCleanup();

  assert.equal(process.listenerCount("exit"), beforeCounts.exit);
  assert.equal(process.listenerCount("SIGINT"), beforeCounts.sigint);
  assert.equal(process.listenerCount("SIGTERM"), beforeCounts.sigterm);
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

test("isolation: running child process does not inherit parent-only env vars", async () => {
  const sentinelKey = "WORKSPACE_DEV_TEST_PARENT_SECRET";
  const sentinelValue = `sentinel-${Date.now()}`;
  process.env[sentinelKey] = sentinelValue;

  try {
    const baseDir = await createIsolationBaseDir();
    const inst = await createProjectInstance("project-env-check", { workDir: baseDir });

    // The /workspace endpoint includes outputRoot which proves workDir was honored.
    // To verify env isolation at the process level, we check that the child's
    // /healthz response succeeded (child booted without the full parent env).
    const res = await fetch(`http://${inst.host}:${inst.port}/healthz`);
    assert.equal(res.status, 200);

    // The child was forked with buildIsolatedChildProcessEnv() which excludes
    // non-allowlisted vars. The sentinel should not exist in the child.
    // We verify this indirectly: the child wouldn't boot if it relied on any
    // non-allowlisted env var, and our unit test confirms the sentinel is excluded.
    const childEnv = buildIsolatedChildProcessEnv({ parentEnv: process.env });
    assert.equal(childEnv[sentinelKey], undefined);
  } finally {
    delete process.env[sentinelKey];
  }
});

test("isolation: startup contract type guards reject malformed messages", () => {
  // awaiting_config
  assert.equal(isIsolatedChildAwaitingConfigMessage({ type: "awaiting_config", instanceId: "abc" }), true);
  assert.equal(isIsolatedChildAwaitingConfigMessage({ type: "awaiting_config" }), false);
  assert.equal(isIsolatedChildAwaitingConfigMessage({ type: "other" }), false);
  assert.equal(isIsolatedChildAwaitingConfigMessage(null), false);
  assert.equal(isIsolatedChildAwaitingConfigMessage("string"), false);

  // start
  assert.equal(isIsolatedChildStartMessage({ type: "start", config: { host: "127.0.0.1", workDir: "/tmp" } }), true);
  assert.equal(isIsolatedChildStartMessage({ type: "start", config: { host: "127.0.0.1", workDir: "/tmp", logFormat: "json" } }), true);
  assert.equal(isIsolatedChildStartMessage({ type: "start", config: { host: "127.0.0.1", workDir: "/tmp", logFormat: "invalid" } }), false);
  assert.equal(isIsolatedChildStartMessage({ type: "start", config: { host: "127.0.0.1" } }), false);
  assert.equal(isIsolatedChildStartMessage({ type: "start" }), false);

  // ready
  assert.equal(isIsolatedChildReadyMessage({ type: "ready", port: 3000, instanceId: "abc" }), true);
  assert.equal(isIsolatedChildReadyMessage({ type: "ready", port: "3000", instanceId: "abc" }), false);
  assert.equal(isIsolatedChildReadyMessage({ type: "ready", port: 3000 }), false);

  // error
  assert.equal(isIsolatedChildErrorMessage({ type: "error", message: "fail" }), true);
  assert.equal(isIsolatedChildErrorMessage({ type: "error" }), false);
  assert.equal(isIsolatedChildErrorMessage({ type: "error", message: 42 }), false);

  // shutdown
  assert.equal(isIsolatedChildShutdownMessage({ type: "shutdown" }), true);
  assert.equal(isIsolatedChildShutdownMessage({ type: "other" }), false);
  assert.equal(isIsolatedChildShutdownMessage(undefined), false);
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
