#!/usr/bin/env node
/**
 * Issue #2187 — air-gap smoke runner.
 *
 * Verifies the sovereign-cloud / air-gap deployment profile fails
 * closed under the strict env flag:
 *
 *  1. The air-gap fetch guard refuses every host outside the explicit
 *     allow-list (including the Figma REST and Azure IMDS hosts).
 *  2. The persistent replay cache refuses remote-scheme roots.
 *  3. The sovereign-cloud region-attestation source produces a
 *     `sovereign-cloud` observation with no warning severity.
 *  4. The figma-export CLI parser still validates required flags
 *     (so the connected-machine workflow is testable in CI even
 *     without an internet egress).
 *
 * The runner sets `WORKSPACE_TEST_SPACE_AIR_GAP_MODE=1` for every
 * sub-process, so any harness code path that quietly opens a public
 * socket fails the smoke run.
 *
 * Exits 0 on success; prints a one-line summary per check.
 */
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");

const tests = [
  "src/test-intelligence/air-gap-guard.test.ts",
  "src/test-intelligence/policy-profile.sovereign.test.ts",
  "src/test-intelligence/llm-gateway-sovereign.test.ts",
  "src/test-intelligence/replay-cache-persistent.airgap.test.ts",
  "src/test-intelligence/region-attestation.sovereign.test.ts",
  "src/test-intelligence-figma-export-cli.test.ts",
];

const env = {
  ...process.env,
  WORKSPACE_TEST_SPACE_AIR_GAP_MODE: "1",
  // Allow-list left empty deliberately — the test files set their own
  // narrow allow-lists per test. The env entry being present (even if
  // empty) exercises the env-driven resolver in air-gap-guard.
  WORKSPACE_TEST_SPACE_AIR_GAP_ALLOWED_HOSTS: "",
};

const child = spawn(
  "pnpm",
  ["exec", "tsx", "--test", ...tests],
  {
    cwd: repoRoot,
    env,
    stdio: "inherit",
  },
);

child.on("exit", (code) => {
  if (code !== 0) {
    process.stderr.write(
      "\nair-gap smoke failed: at least one strict-mode invariant regressed.\n",
    );
  } else {
    process.stdout.write(
      "\nair-gap smoke ok: every strict-mode invariant held.\n",
    );
  }
  process.exit(code ?? 1);
});
