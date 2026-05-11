/**
 * `workspace-dev test-intelligence calibration-refit` sub-command
 * (Issue #2182).
 *
 * Drives the self-improving judge-calibration loop from the CLI.
 *
 * Usage:
 *   workspace-dev test-intelligence calibration-refit
 *     --locale <code>
 *     --risk-class <id>
 *     --gold-entries <json-file>
 *     [--curves-dir <dir>]
 *     [--proposed-at <iso>]
 *     [--dry-run]
 *     [--sign-key <pem>]
 *     [--decided-at <iso>]
 *     [--allow-key-fingerprint <hex>...]
 *
 * The `--dry-run` form proposes but never ratifies; the operator
 * reviews the on-disk proposal before promoting via a follow-up
 * invocation that supplies `--sign-key`. Ratification reuses the
 * audit-dossier signing key surface (PEM/JWK Ed25519 private key) so
 * operators run a single key-management workflow.
 *
 * Exit codes:
 *   0  success (proposal written; ratified or rolled back)
 *   1  operator/config error (missing flag, bad value)
 *   2  refit error (gate failure during ratify, signature mismatch)
 *   3  policy refusal (operator key not on allowlist)
 */

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { sanitizeErrorMessage } from "./error-sanitization.js";
import { canonicalJson } from "./test-intelligence/content-hash.js";
import {
  CalibrationRefitOperatorError,
  proposeCalibrationRefit,
  ratifyOrRollback,
  REGULATED_RISK_CLASSES,
  type CalibrationGoldEntry,
  type CalibrationRefitProposal,
  type RegulatedRiskClass,
} from "./test-intelligence/self-improving-calibration.js";
import type { SupportedLocale } from "./contracts/index.js";

/** Re-exported sink shape mirrors the rest of the test-intelligence CLI. */
export interface TestIntelligenceCalibrationRefitSink {
  stdout(message: string): void;
  stderr(message: string): void;
}

const SUPPORTED_LOCALE_CODES: ReadonlyArray<SupportedLocale> = Object.freeze([
  "DE-DE",
  "DE-AT",
  "DE-CH",
  "EN-IE",
  "FR-FR",
  "IT-IT",
] as const);

const isSupportedLocale = (value: string): value is SupportedLocale =>
  (SUPPORTED_LOCALE_CODES as ReadonlyArray<string>).includes(value);

const isRegulatedRiskClass = (value: string): value is RegulatedRiskClass =>
  (REGULATED_RISK_CLASSES as ReadonlyArray<string>).includes(value);

/**
 * Default location of the calibration-curves fixtures tree, resolved
 * relative to the repository root. Operators override with
 * `--curves-dir` when running ad-hoc dry runs against a sandbox.
 */
export const DEFAULT_CALIBRATION_CURVES_DIR =
  "fixtures/test-intelligence/calibration-curves" as const;

export interface TestIntelligenceCalibrationRefitOptions {
  readonly locale: SupportedLocale;
  readonly riskClass: RegulatedRiskClass;
  readonly goldEntriesFile: string;
  readonly curvesDir: string;
  readonly proposedAt: string;
  readonly dryRun: boolean;
  readonly forceRollback: boolean;
  readonly signKeyPath?: string;
  readonly decidedAt?: string;
  readonly rollbackReason?: string;
  readonly allowedKeyFingerprints: readonly string[];
}

const requireFlag = (
  args: ReadonlyArray<string>,
  flag: string,
  index: number,
): string => {
  const value = args[index + 1];
  if (typeof value !== "string" || value.length === 0) {
    throw new CalibrationRefitOperatorError(`Flag "${flag}" requires a value.`);
  }
  return value;
};

export const parseTestIntelligenceCalibrationRefitArgs = (
  args: ReadonlyArray<string>,
): TestIntelligenceCalibrationRefitOptions => {
  const out: Partial<{
    locale: SupportedLocale;
    riskClass: RegulatedRiskClass;
    goldEntriesFile: string;
    curvesDir: string;
    proposedAt: string;
    dryRun: boolean;
    forceRollback: boolean;
    signKeyPath: string;
    decidedAt: string;
    rollbackReason: string;
    allowedKeyFingerprints: string[];
  }> = {
    dryRun: false,
    forceRollback: false,
    allowedKeyFingerprints: [],
  };
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === undefined) continue;
    if (arg === "--locale") {
      const value = requireFlag(args, arg, i);
      if (!isSupportedLocale(value)) {
        throw new CalibrationRefitOperatorError(
          `--locale must be one of ${SUPPORTED_LOCALE_CODES.join(", ")}; got "${value}".`,
        );
      }
      out.locale = value;
      i += 1;
    } else if (arg === "--risk-class") {
      const value = requireFlag(args, arg, i);
      if (!isRegulatedRiskClass(value)) {
        throw new CalibrationRefitOperatorError(
          `--risk-class must be one of ${REGULATED_RISK_CLASSES.join(", ")}; got "${value}".`,
        );
      }
      out.riskClass = value;
      i += 1;
    } else if (arg === "--gold-entries") {
      out.goldEntriesFile = requireFlag(args, arg, i);
      i += 1;
    } else if (arg === "--curves-dir") {
      out.curvesDir = requireFlag(args, arg, i);
      i += 1;
    } else if (arg === "--proposed-at") {
      out.proposedAt = requireFlag(args, arg, i);
      i += 1;
    } else if (arg === "--dry-run") {
      out.dryRun = true;
    } else if (arg === "--force-rollback") {
      out.forceRollback = true;
    } else if (arg === "--sign-key") {
      out.signKeyPath = requireFlag(args, arg, i);
      i += 1;
    } else if (arg === "--decided-at") {
      out.decidedAt = requireFlag(args, arg, i);
      i += 1;
    } else if (arg === "--rollback-reason") {
      out.rollbackReason = requireFlag(args, arg, i);
      i += 1;
    } else if (arg === "--allow-key-fingerprint") {
      const value = requireFlag(args, arg, i);
      out.allowedKeyFingerprints!.push(value);
      i += 1;
    } else {
      throw new CalibrationRefitOperatorError(
        `Unknown argument: ${arg}. See --help.`,
      );
    }
  }
  if (out.locale === undefined) {
    throw new CalibrationRefitOperatorError("--locale <code> is required.");
  }
  if (out.riskClass === undefined) {
    throw new CalibrationRefitOperatorError(
      "--risk-class <id> is required.",
    );
  }
  if (out.goldEntriesFile === undefined) {
    throw new CalibrationRefitOperatorError(
      "--gold-entries <json-file> is required.",
    );
  }
  if (out.proposedAt === undefined) {
    throw new CalibrationRefitOperatorError(
      "--proposed-at <iso-8601> is required so the proposal artifact is reproducible.",
    );
  }
  if (!out.dryRun && out.signKeyPath === undefined) {
    throw new CalibrationRefitOperatorError(
      "--sign-key <pem> is required for ratification (or pass --dry-run to propose without ratifying).",
    );
  }
  if (!out.dryRun && out.decidedAt === undefined) {
    throw new CalibrationRefitOperatorError(
      "--decided-at <iso-8601> is required when ratifying.",
    );
  }
  return {
    locale: out.locale,
    riskClass: out.riskClass,
    goldEntriesFile: out.goldEntriesFile,
    curvesDir: out.curvesDir ?? resolve(process.cwd(), DEFAULT_CALIBRATION_CURVES_DIR),
    proposedAt: out.proposedAt,
    dryRun: out.dryRun ?? false,
    forceRollback: out.forceRollback ?? false,
    ...(out.signKeyPath !== undefined ? { signKeyPath: out.signKeyPath } : {}),
    ...(out.decidedAt !== undefined ? { decidedAt: out.decidedAt } : {}),
    ...(out.rollbackReason !== undefined
      ? { rollbackReason: out.rollbackReason }
      : {}),
    allowedKeyFingerprints: out.allowedKeyFingerprints ?? [],
  };
};

const loadGoldEntries = async (
  path: string,
): Promise<readonly CalibrationGoldEntry[]> => {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      (error as { code?: string }).code === "ENOENT"
    ) {
      throw new CalibrationRefitOperatorError(
        `--gold-entries file not found: ${path}`,
      );
    }
    throw error;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new CalibrationRefitOperatorError(
      `--gold-entries file is not valid JSON: ${(error as Error).message}`,
    );
  }
  const list = Array.isArray(parsed)
    ? parsed
    : typeof parsed === "object" &&
        parsed !== null &&
        Array.isArray((parsed as { entries?: unknown }).entries)
      ? (parsed as { entries: unknown[] }).entries
      : undefined;
  if (list === undefined) {
    throw new CalibrationRefitOperatorError(
      "--gold-entries file must be a JSON array of CalibrationGoldEntry or an object with an `entries` array.",
    );
  }
  for (const candidate of list) {
    if (
      typeof candidate !== "object" ||
      candidate === null ||
      typeof (candidate as { entryId?: unknown }).entryId !== "string"
    ) {
      throw new CalibrationRefitOperatorError(
        "Every gold entry must be an object with at least an `entryId: string` field.",
      );
    }
  }
  return list as readonly CalibrationGoldEntry[];
};

/** Stable summary block written to stdout for both dry-run and ratify paths. */
const summarizeProposal = (proposal: CalibrationRefitProposal): string =>
  canonicalJson({
    proposalId: proposal.proposalId,
    locale: proposal.locale,
    riskClass: proposal.riskClass,
    proposedCurveDigest: proposal.proposedCurveDigest,
    previousCurveDigest: proposal.previousCurveDigest,
    heldOutEce: proposal.heldOutEce,
    heldOutKappa: proposal.heldOutKappa,
    perClassHeldOutEce: proposal.perClassHeldOutEce,
    proposedAt: proposal.proposedAt,
    ratifiedAt: proposal.ratifiedAt,
    rolledBack: proposal.rolledBack,
    rollbackReason: proposal.rollbackReason,
    failedGates: proposal.gateEvaluation.failedGates,
  });

export const runTestIntelligenceCalibrationRefitCommand = async (
  options: TestIntelligenceCalibrationRefitOptions,
  sink: TestIntelligenceCalibrationRefitSink,
): Promise<number> => {
  try {
    const goldEntries = await loadGoldEntries(options.goldEntriesFile);
    const proposal = await proposeCalibrationRefit({
      locale: options.locale,
      riskClass: options.riskClass,
      goldEntries,
      curvesDir: options.curvesDir,
      proposedAt: options.proposedAt,
    });
    if (options.dryRun) {
      sink.stdout(`${summarizeProposal(proposal)}\n`);
      return 0;
    }
    const ratifyInput = {
      curvesDir: options.curvesDir,
      decidedAt: options.decidedAt!,
      forceRollback: options.forceRollback,
      ...(options.signKeyPath !== undefined ? { signKeyPath: options.signKeyPath } : {}),
      ...(options.rollbackReason !== undefined
        ? { rollbackReason: options.rollbackReason }
        : {}),
      ...(options.allowedKeyFingerprints.length > 0
        ? { allowedKeyFingerprints: options.allowedKeyFingerprints }
        : {}),
    };
    const finalised = await ratifyOrRollback(proposal, ratifyInput);
    sink.stdout(`${summarizeProposal(finalised)}\n`);
    return finalised.rolledBack ? 2 : 0;
  } catch (error) {
    if (error instanceof CalibrationRefitOperatorError) {
      sink.stderr(`error: ${error.message}\n`);
      // Distinguish allowlist refusals (exit code 3) from other operator errors (1).
      if (error.message.includes("not on the allowlist")) {
        return 3;
      }
      return 1;
    }
    sink.stderr(
      `error: ${sanitizeErrorMessage({
        error,
        fallback: "Failed to run calibration refit.",
      })}\n`,
    );
    return 2;
  }
};

export const TEST_INTELLIGENCE_CALIBRATION_REFIT_HELP = `workspace-dev test-intelligence calibration-refit - self-improving judge-calibration loop with hard rollback safety (Issue #2182)

Usage:
  workspace-dev test-intelligence calibration-refit
    --locale <code>
    --risk-class <id>
    --gold-entries <json-file>
    [--curves-dir <dir>]
    --proposed-at <iso-8601>
    [--dry-run]
    [--sign-key <pem>]
    [--decided-at <iso-8601>]
    [--rollback-reason <text>]
    [--force-rollback]
    [--allow-key-fingerprint <hex>]...

Options:
  --locale <code>             One of: DE-DE | DE-AT | DE-CH | EN-IE | FR-FR | IT-IT
  --risk-class <id>           One of: high | regulated_data | financial_transaction
  --gold-entries <json-file>  Path to a JSON file holding the gold-set entries.
                              Either a JSON array or an object with an \`entries\` array.
  --curves-dir <dir>          Production curves root.
                              Default: fixtures/test-intelligence/calibration-curves
  --proposed-at <iso-8601>    Strict ISO-8601 timestamp pinned for reproducibility.
  --dry-run                   Propose only; never ratify. Operator reviews the on-disk
                              proposal record before re-invoking with --sign-key.
  --sign-key <pem>            Path to the operator Ed25519 private key (PEM/JWK).
                              Reuses the audit-dossier signing-key surface.
  --decided-at <iso-8601>     Operator decision timestamp, stamped onto the proposal.
  --rollback-reason <text>    Optional explicit rollback reason; defaults to the gate
                              failure list.
  --force-rollback            Override gates and roll back regardless. Used by reviewers
                              who spot a qualitative issue not covered by automated gates.
  --allow-key-fingerprint     Repeatable. SPKI-DER SHA-256 fingerprints accepted for
                              ratification. Empty allowlist = any valid Ed25519 key.

Exit codes:
  0  success (proposal written; ratified or rolled back per outcome)
  1  operator/config error
  2  refit / gate / signature error
  3  operator-key allowlist refusal
`;
