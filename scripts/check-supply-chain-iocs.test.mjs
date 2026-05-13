import { test } from "node:test";
import assert from "node:assert";
import { scanContent, runGuard } from "./check-supply-chain-iocs.mjs";

test("scanContent reports current TanStack IOC resolver", () => {
  const findings = scanContent(
    'optionalDependencies:\n  "@tanstack/setup": "github:tanstack/router#79ac49eedf774dd4b0cfa308722bc463cfe5885c"\n',
    "pnpm-lock.yaml",
  );

  assert.ok(
    findings.some((finding) => finding.id === "tanstack-orphan-setup-resolver"),
  );
});

test("scanContent reports current Mini Shai-Hulud payload file", () => {
  const findings = scanContent(
    "packages:\n  intercom-client@7.0.4:\n    files:\n      - router_runtime.js\n",
    "pnpm-lock.yaml",
  );

  assert.ok(
    findings.some(
      (finding) => finding.id === "mini-shai-hulud-runtime-payload",
    ),
  );
  assert.ok(
    findings.some((finding) => finding.id === "known-compromised-npm-versions"),
  );
});

test("scanContent does not flag clean TanStack Query versions", () => {
  assert.deepStrictEqual(
    scanContent(
      "'@tanstack/react-query@5.100.8(react@19.2.5)': {}",
      "pnpm-lock.yaml",
    ),
    [],
  );
});

test("runGuard returns 1 when any target contains an IOC", async () => {
  const errs = [];
  const exitCode = await runGuard({
    packageRoot: "/unused",
    targets: ["pnpm-lock.yaml"],
    readTextFile: async () => "router_init.js",
    stdout: () => {},
    stderr: (msg) => errs.push(msg),
  });

  assert.strictEqual(exitCode, 1);
  assert.ok(errs.some((entry) => entry.includes("router_init")));
});

test("runGuard returns 0 for clean targets", async () => {
  const logs = [];
  const exitCode = await runGuard({
    packageRoot: "/unused",
    targets: ["package.json"],
    readTextFile: async () => '{"dependencies":{"react":"19.2.6"}}',
    stdout: (msg) => logs.push(msg),
    stderr: () => {},
  });

  assert.strictEqual(exitCode, 0);
  assert.ok(logs[0]?.includes("Passed"));
});
