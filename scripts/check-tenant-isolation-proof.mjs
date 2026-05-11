#!/usr/bin/env node
/**
 * G12 CI guard — `G12_TENANT_ISOLATION_PROOF_PASS` (Issue #2130).
 *
 * Regenerates the constructive cross-tenant isolation proof from the
 * current source and asserts byte-equality against the committed
 * `fixtures/test-intelligence/tenant-isolation/tenant-isolation-proof.json` artifact.
 *
 * Any change to `replay-cache.ts`, `replay-cache-persistent.ts`, or
 * `tenant-isolation-proof.ts` that affects the proof bytes will fail
 * this gate until the operator regenerates the artifact (via
 * `pnpm run generate:tenant-isolation-proof`) **and** lands an ADR
 * review for the regenerated proof — see
 * `docs/dora/multi-tenant-isolation.md`.
 *
 * Usage:
 *   node scripts/check-tenant-isolation-proof.mjs [--committed <path>] [--quiet]
 *
 * Exit codes:
 *   0  proof artifact matches the committed bytes
 *   1  G12 violation (drift; details on stderr)
 *   2  unexpected error (filesystem, parser, etc.)
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import {
  G12_TENANT_ISOLATION_PROOF_PASS,
  TENANT_ISOLATION_PROOF_DEFAULT_REPO_PATH,
  TENANT_ISOLATION_PROOF_FIXED_GENERATED_AT,
  buildTenantIsolationProof,
  computeTenantIsolationProofDigest,
  serializeTenantIsolationProof,
} from "../src/test-intelligence/tenant-isolation-proof.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");

const parseArgs = (argv) => {
  const result = {
    committed: path.resolve(REPO_ROOT, TENANT_ISOLATION_PROOF_DEFAULT_REPO_PATH),
    quiet: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--committed") {
      const value = argv[++i];
      if (value === undefined)
        throw new TypeError("--committed requires a path");
      result.committed = path.resolve(REPO_ROOT, value);
    } else if (arg && arg.startsWith("--committed=")) {
      result.committed = path.resolve(REPO_ROOT, arg.slice("--committed=".length));
    } else if (arg === "--quiet") {
      result.quiet = true;
    } else if (arg === "--help" || arg === "-h") {
      process.stdout.write(
        "usage: check-tenant-isolation-proof.mjs [--committed <path>] [--quiet]\n",
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

  let committedBytes;
  try {
    committedBytes = await readFile(args.committed, "utf8");
  } catch (err) {
    if (err && err.code === "ENOENT") {
      process.stderr.write(
        `${G12_TENANT_ISOLATION_PROOF_PASS} FAILED: committed proof not found at ${args.committed}\n` +
          `run: pnpm run generate:tenant-isolation-proof\n`,
      );
      process.exit(1);
    }
    throw err;
  }

  const proof = buildTenantIsolationProof({
    generatedAt: TENANT_ISOLATION_PROOF_FIXED_GENERATED_AT,
  });
  const regenerated = serializeTenantIsolationProof(proof);

  if (regenerated !== committedBytes) {
    process.stderr.write(
      `${G12_TENANT_ISOLATION_PROOF_PASS} FAILED: regenerated proof bytes differ from committed artifact.\n` +
        `committed: ${args.committed}\n` +
        `expected proofSha256: ${proof.proofSha256}\n` +
        `committed proofSha256: ${(() => {
          try {
            return JSON.parse(committedBytes).proofSha256 ?? "<missing>";
          } catch {
            return "<unparseable>";
          }
        })()}\n` +
        `run: pnpm run generate:tenant-isolation-proof\n` +
        `then commit the regenerated fixtures/test-intelligence/tenant-isolation/tenant-isolation-proof.json and update the ADR if the cache-key construction or storage layout changed.\n`,
    );
    process.exit(1);
  }

  const reDerived = computeTenantIsolationProofDigest(proof);
  if (reDerived !== proof.proofSha256) {
    process.stderr.write(
      `${G12_TENANT_ISOLATION_PROOF_PASS} FAILED: internal digest mismatch (proofSha256 cannot self-verify).\n`,
    );
    process.exit(1);
  }

  if (!args.quiet) {
    process.stdout.write(
      `${G12_TENANT_ISOLATION_PROOF_PASS} ok (proofSha256=${proof.proofSha256})\n`,
    );
  }
};

main().catch((err) => {
  process.stderr.write(
    `check-tenant-isolation-proof: ${String(err && err.stack ? err.stack : err)}\n`,
  );
  process.exit(2);
});
