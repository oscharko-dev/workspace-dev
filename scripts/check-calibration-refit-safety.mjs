#!/usr/bin/env node
/**
 * G11 CI guard — `G11_CALIBRATION_REFIT_SAFETY` (Issue #2182).
 *
 * Walks the production calibration-curves tree and asserts that every
 * `<locale>__<riskClass>.json` curve is backed by a matching ratified
 * proposal in `proposals/`. PRs that hand-edit a production curve
 * without a corresponding ratified, signature-verified proposal are
 * rejected.
 *
 * Usage:
 *   node scripts/check-calibration-refit-safety.mjs
 *     [--curves-dir <path>]              (default: fixtures/test-intelligence/calibration-curves)
 *     [--allow-key-fingerprint <hex>]... (repeatable; restricts which Ed25519 keys may sign)
 *     [--quiet]
 *
 * Exit codes:
 *   0  every production curve is backed by a ratified proposal
 *   1  G11 violation (one or more unbacked curves; details on stderr)
 *   2  unexpected error (filesystem, parser, etc.)
 */

import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import {
  CalibrationRefitSafetyHardGateError,
  assertCalibrationRefitSafety,
} from "../src/test-intelligence/self-improving-calibration.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const DEFAULT_CURVES_DIR = path.resolve(
  REPO_ROOT,
  "fixtures/test-intelligence/calibration-curves",
);

const parseArgs = (argv) => {
  const result = {
    curvesDir: DEFAULT_CURVES_DIR,
    allowedKeyFingerprints: [],
    quiet: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--curves-dir") {
      const value = argv[++i];
      if (value === undefined) {
        throw new TypeError("--curves-dir requires a path");
      }
      result.curvesDir = path.resolve(REPO_ROOT, value);
    } else if (arg && arg.startsWith("--curves-dir=")) {
      result.curvesDir = path.resolve(REPO_ROOT, arg.slice("--curves-dir=".length));
    } else if (arg === "--allow-key-fingerprint") {
      const value = argv[++i];
      if (value === undefined) {
        throw new TypeError("--allow-key-fingerprint requires a hex digest");
      }
      result.allowedKeyFingerprints.push(value);
    } else if (arg && arg.startsWith("--allow-key-fingerprint=")) {
      result.allowedKeyFingerprints.push(
        arg.slice("--allow-key-fingerprint=".length),
      );
    } else if (arg === "--quiet") {
      result.quiet = true;
    } else if (arg === "--help" || arg === "-h") {
      process.stdout.write(
        "usage: check-calibration-refit-safety.mjs [--curves-dir <path>] [--allow-key-fingerprint <hex>]... [--quiet]\n",
      );
      process.exit(0);
    } else if (arg !== undefined) {
      throw new TypeError(`unknown argument: ${arg}`);
    }
  }
  return result;
};

const main = async () => {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`error: ${(error instanceof Error ? error.message : String(error))}\n`);
    process.exit(2);
  }

  try {
    await assertCalibrationRefitSafety({
      curvesDir: opts.curvesDir,
      ...(opts.allowedKeyFingerprints.length > 0
        ? { allowedKeyFingerprints: opts.allowedKeyFingerprints }
        : {}),
    });
    if (!opts.quiet) {
      process.stdout.write(
        `G11_CALIBRATION_REFIT_SAFETY: ok (curves dir ${opts.curvesDir})\n`,
      );
    }
    process.exit(0);
  } catch (error) {
    if (error instanceof CalibrationRefitSafetyHardGateError) {
      process.stderr.write(`${error.message}\n`);
      process.exit(1);
    }
    process.stderr.write(
      `error: unexpected failure while running G11 guard: ${(error instanceof Error ? error.message : String(error))}\n`,
    );
    process.exit(2);
  }
};

await main();
