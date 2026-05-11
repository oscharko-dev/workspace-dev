#!/usr/bin/env node
/**
 * Cross-tenant isolation proof generator (Issue #2130).
 *
 * Builds the deterministic `tenant-isolation-proof.json` artifact and
 * writes it to `fixtures/test-intelligence/tenant-isolation/tenant-isolation-proof.json` (or the
 * `--output` path passed by the caller). The artifact is a structural
 * proof of the claim "no read under tenant A can return bytes
 * written under tenant B" — see `src/test-intelligence/tenant-isolation-proof.ts`
 * for the algebra.
 *
 * Usage:
 *   node scripts/generate-tenant-isolation-proof.mjs [--output <path>] [--quiet]
 *
 * Exit codes:
 *   0 — proof regenerated successfully
 *   2 — unexpected error (filesystem, parser, etc.)
 */

import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import {
  TENANT_ISOLATION_PROOF_DEFAULT_REPO_PATH,
  TENANT_ISOLATION_PROOF_FIXED_GENERATED_AT,
  buildTenantIsolationProof,
  writeTenantIsolationProof,
} from "../src/test-intelligence/tenant-isolation-proof.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");

const parseArgs = (argv) => {
  const result = {
    output: path.resolve(REPO_ROOT, TENANT_ISOLATION_PROOF_DEFAULT_REPO_PATH),
    quiet: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--output") {
      const value = argv[++i];
      if (value === undefined)
        throw new TypeError("--output requires a path");
      result.output = path.resolve(REPO_ROOT, value);
    } else if (arg && arg.startsWith("--output=")) {
      result.output = path.resolve(REPO_ROOT, arg.slice("--output=".length));
    } else if (arg === "--quiet") {
      result.quiet = true;
    } else if (arg === "--help" || arg === "-h") {
      process.stdout.write(
        "usage: generate-tenant-isolation-proof.mjs [--output <path>] [--quiet]\n",
      );
      process.exit(0);
    } else if (arg !== undefined) {
      throw new TypeError(`unknown argument: ${arg}`);
    }
  }
  return result;
};

const main = async () => {
  const args = parseArgs(process.argv.slice(2));
  const proof = buildTenantIsolationProof({
    generatedAt: TENANT_ISOLATION_PROOF_FIXED_GENERATED_AT,
  });
  const result = await writeTenantIsolationProof({
    proof,
    artifactPath: args.output,
  });
  if (!args.quiet) {
    process.stdout.write(
      `wrote ${result.artifactPath} (proofSha256=${result.digest})\n`,
    );
  }
};

main().catch((err) => {
  process.stderr.write(
    `generate-tenant-isolation-proof: ${String(err && err.stack ? err.stack : err)}\n`,
  );
  process.exit(2);
});
