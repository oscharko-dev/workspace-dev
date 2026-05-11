/**
 * `workspace-dev test-intelligence onboard` sub-command (Issue #2185, W8-3).
 *
 * Wires {@link runTenantOnboarding} and {@link runTenantOnboardingDoctor}
 * to the CLI:
 *
 *   pnpm exec tsx src/cli.ts test-intelligence onboard \
 *     --tenant-id <id> \
 *     --legal-name <name> \
 *     --policy-profile <profile> \
 *     --output-root <dir> [--force] [--environment-id <id>] [--project-id <id>] \
 *     [--jurisdiction <code>] [--effective-date <iso>]
 *
 *   pnpm exec tsx src/cli.ts test-intelligence onboard --doctor \
 *     --tenant-id <id> --output-root <dir> \
 *     [--environment-id <id>] [--project-id <id>]
 *
 * Exit codes:
 *   0  — onboarding completed (or doctor passed every check).
 *   1  — operator/config error (missing flag, invalid input, refusal to overwrite).
 *   2  — doctor found one or more failures.
 */

import { sanitizeErrorMessage } from "./error-sanitization.js";
import {
  runTenantOnboarding,
  runTenantOnboardingDoctor,
  TenantOnboardingValidationError,
  type TenantOnboardingDoctorResult,
  type TenantOnboardingInput,
  type TenantOnboardingResult,
} from "./test-intelligence/tenant-onboarding.js";

/** Sink for stdout/stderr writes — symmetric with sibling CLIs. */
export interface TestIntelligenceOnboardSink {
  readonly stdout: (chunk: string) => void;
  readonly stderr: (chunk: string) => void;
}

/** Operator-facing parser error (separate class makes dispatcher mapping unambiguous). */
export class TestIntelligenceOnboardOperatorError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TestIntelligenceOnboardOperatorError";
  }
}

/** Parsed flags for `test-intelligence onboard` (provision mode). */
export interface TestIntelligenceOnboardOptions {
  readonly mode: "provision";
  readonly tenantId: string;
  readonly legalName: string;
  readonly policyProfileId: string;
  readonly outputRoot: string;
  readonly force: boolean;
  readonly environmentId: string;
  readonly projectId?: string;
  readonly jurisdiction: string;
  readonly effectiveDate?: string;
}

/** Parsed flags for `test-intelligence onboard --doctor`. */
export interface TestIntelligenceOnboardDoctorOptions {
  readonly mode: "doctor";
  readonly tenantId: string;
  readonly outputRoot: string;
  readonly environmentId: string;
  readonly projectId?: string;
}

export type TestIntelligenceOnboardParsedArgs =
  | TestIntelligenceOnboardOptions
  | TestIntelligenceOnboardDoctorOptions;

const DEFAULT_ENVIRONMENT_ID = "prod";
const DEFAULT_JURISDICTION = "EU";

const requireValue = (
  flag: string,
  next: string | undefined,
): string => {
  if (next === undefined || next.trim().length === 0) {
    throw new TestIntelligenceOnboardOperatorError(
      `${flag} requires a non-empty value`,
    );
  }
  return next;
};

const setOnce = <T>(
  flag: string,
  current: T | undefined,
  value: T,
): T => {
  if (current !== undefined) {
    throw new TestIntelligenceOnboardOperatorError(
      `${flag} may be specified at most once`,
    );
  }
  return value;
};

/**
 * Parse the kebab-case flag form. The parser refuses unknown flags so a
 * typo never silently downgrades to a default.
 */
export const parseTestIntelligenceOnboardArgs = (
  argv: readonly string[],
): TestIntelligenceOnboardParsedArgs => {
  let doctorMode = false;
  let tenantId: string | undefined;
  let legalName: string | undefined;
  let policyProfileId: string | undefined;
  let outputRoot: string | undefined;
  let force = false;
  let environmentId: string | undefined;
  let projectId: string | undefined;
  let jurisdiction: string | undefined;
  let effectiveDate: string | undefined;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];

    if (arg === "--doctor") {
      if (doctorMode) {
        throw new TestIntelligenceOnboardOperatorError(
          "--doctor may be specified at most once",
        );
      }
      doctorMode = true;
      continue;
    }
    if (arg === "--force") {
      if (force) {
        throw new TestIntelligenceOnboardOperatorError(
          "--force may be specified at most once",
        );
      }
      force = true;
      continue;
    }
    if (arg === "--tenant-id") {
      tenantId = setOnce("--tenant-id", tenantId, requireValue("--tenant-id", next));
      i += 1;
      continue;
    }
    if (arg === "--legal-name") {
      legalName = setOnce("--legal-name", legalName, requireValue("--legal-name", next));
      i += 1;
      continue;
    }
    if (arg === "--policy-profile") {
      policyProfileId = setOnce(
        "--policy-profile",
        policyProfileId,
        requireValue("--policy-profile", next),
      );
      i += 1;
      continue;
    }
    if (arg === "--output-root") {
      outputRoot = setOnce(
        "--output-root",
        outputRoot,
        requireValue("--output-root", next),
      );
      i += 1;
      continue;
    }
    if (arg === "--environment-id") {
      environmentId = setOnce(
        "--environment-id",
        environmentId,
        requireValue("--environment-id", next),
      );
      i += 1;
      continue;
    }
    if (arg === "--project-id") {
      projectId = setOnce(
        "--project-id",
        projectId,
        requireValue("--project-id", next),
      );
      i += 1;
      continue;
    }
    if (arg === "--jurisdiction") {
      jurisdiction = setOnce(
        "--jurisdiction",
        jurisdiction,
        requireValue("--jurisdiction", next),
      );
      i += 1;
      continue;
    }
    if (arg === "--effective-date") {
      effectiveDate = setOnce(
        "--effective-date",
        effectiveDate,
        requireValue("--effective-date", next),
      );
      i += 1;
      continue;
    }
    throw new TestIntelligenceOnboardOperatorError(
      `unknown flag for "test-intelligence onboard": ${arg}`,
    );
  }

  if (tenantId === undefined) {
    throw new TestIntelligenceOnboardOperatorError("--tenant-id is required");
  }
  if (outputRoot === undefined) {
    throw new TestIntelligenceOnboardOperatorError("--output-root is required");
  }

  if (doctorMode) {
    if (legalName !== undefined) {
      throw new TestIntelligenceOnboardOperatorError(
        "--legal-name is not valid with --doctor",
      );
    }
    if (policyProfileId !== undefined) {
      throw new TestIntelligenceOnboardOperatorError(
        "--policy-profile is not valid with --doctor",
      );
    }
    if (jurisdiction !== undefined) {
      throw new TestIntelligenceOnboardOperatorError(
        "--jurisdiction is not valid with --doctor",
      );
    }
    if (effectiveDate !== undefined) {
      throw new TestIntelligenceOnboardOperatorError(
        "--effective-date is not valid with --doctor",
      );
    }
    if (force) {
      throw new TestIntelligenceOnboardOperatorError(
        "--force is not valid with --doctor",
      );
    }
    return {
      mode: "doctor",
      tenantId,
      outputRoot,
      environmentId: environmentId ?? DEFAULT_ENVIRONMENT_ID,
      ...(projectId !== undefined ? { projectId } : {}),
    };
  }

  if (legalName === undefined) {
    throw new TestIntelligenceOnboardOperatorError("--legal-name is required");
  }
  if (policyProfileId === undefined) {
    throw new TestIntelligenceOnboardOperatorError(
      "--policy-profile is required",
    );
  }

  return {
    mode: "provision",
    tenantId,
    legalName,
    policyProfileId,
    outputRoot,
    force,
    environmentId: environmentId ?? DEFAULT_ENVIRONMENT_ID,
    ...(projectId !== undefined ? { projectId } : {}),
    jurisdiction: jurisdiction ?? DEFAULT_JURISDICTION,
    ...(effectiveDate !== undefined ? { effectiveDate } : {}),
  };
};

const formatDoctorReport = (result: TenantOnboardingDoctorResult): string => {
  const lines: string[] = [];
  lines.push(
    `Doctor report for tenant "${result.tenantId}" (${result.tenantDirectory}):`,
  );
  lines.push("");
  for (const check of result.checks) {
    const marker = check.ok ? "[ ok ]" : "[fail]";
    lines.push(`  ${marker} ${check.name}: ${check.detail}`);
  }
  lines.push("");
  if (result.orphanedFiles.length > 0) {
    lines.push("Orphaned entries:");
    for (const orphan of result.orphanedFiles) {
      lines.push(`  - ${orphan}`);
    }
    lines.push("");
  }
  lines.push(
    result.ok
      ? "Result: PASS — tenant directory is healthy."
      : "Result: FAIL — fix the failing checks before the next production run.",
  );
  return `${lines.join("\n")}\n`;
};

/** Run the onboarding command (provision or doctor) and return an exit code. */
export const runTestIntelligenceOnboardCommand = async (
  options: TestIntelligenceOnboardParsedArgs,
  sink: TestIntelligenceOnboardSink,
): Promise<number> => {
  if (options.mode === "doctor") {
    let report: TenantOnboardingDoctorResult;
    try {
      report = await runTenantOnboardingDoctor({
        tenantId: options.tenantId,
        outputRoot: options.outputRoot,
        environmentId: options.environmentId,
        ...(options.projectId !== undefined
          ? { projectId: options.projectId }
          : {}),
      });
    } catch (err) {
      if (err instanceof TenantOnboardingValidationError) {
        sink.stderr(`error: ${err.message}\n`);
        return 1;
      }
      sink.stderr(
        `error: doctor failed: ${sanitizeErrorMessage({
          error: err,
          fallback: "doctor failed",
        })}\n`,
      );
      return 1;
    }
    sink.stdout(formatDoctorReport(report));
    return report.ok ? 0 : 2;
  }

  const provisionInput: TenantOnboardingInput = {
    tenantId: options.tenantId,
    legalName: options.legalName,
    policyProfileId: options.policyProfileId,
    outputRoot: options.outputRoot,
    force: options.force,
    environmentId: options.environmentId,
    ...(options.projectId !== undefined ? { projectId: options.projectId } : {}),
    jurisdiction: options.jurisdiction,
    ...(options.effectiveDate !== undefined
      ? { effectiveDate: options.effectiveDate }
      : {}),
  };

  let result: TenantOnboardingResult;
  try {
    result = await runTenantOnboarding(provisionInput);
  } catch (err) {
    if (err instanceof TenantOnboardingValidationError) {
      sink.stderr(`error: ${err.message}\n`);
      return 1;
    }
    sink.stderr(
      `error: tenant onboarding failed: ${sanitizeErrorMessage({
        error: err,
        fallback: "tenant onboarding failed",
      })}\n`,
    );
    return 1;
  }
  sink.stdout(result.summaryReport);
  return 0;
};

/** Help text for `test-intelligence onboard`. */
export const TEST_INTELLIGENCE_ONBOARD_HELP = `\
workspace-dev test-intelligence onboard — self-service customer onboarding (Issue #2185)

Usage:
  workspace-dev test-intelligence onboard \\
    --tenant-id <id> \\
    --legal-name <name> \\
    --policy-profile <profile> \\
    --output-root <dir> \\
    [--force] [--environment-id <id>] [--project-id <id>] \\
    [--jurisdiction <code>] [--effective-date <iso>]

  workspace-dev test-intelligence onboard --doctor \\
    --tenant-id <id> --output-root <dir> \\
    [--environment-id <id>] [--project-id <id>]

Required flags (provision mode):
  --tenant-id <id>          ^[a-z0-9][a-z0-9_-]{0,63}$
  --legal-name <name>       Customer's registered legal entity name
  --policy-profile <id>     Known profile id (default registry: eu-banking-default)
  --output-root <dir>       Root under which tenants/<tenant-id>/ is laid down

Optional flags:
  --force                   Overwrite an existing tenant directory
  --environment-id <id>     Tenant-scope environment (default: prod)
  --project-id <id>         Optional tenant-scope project id
  --jurisdiction <code>     ISO-3166 jurisdiction (default: EU)
  --effective-date <iso>    ISO-8601 date for the ICT register (default: today)

What --doctor checks:
  - Tenant directory + calibration corpus accessible
  - Tenant bundle parses; tenantId matches expected scope
  - ICT register present with all three signing-key fingerprints
  - Audit-dossier (W6-1), region-attestation (W6-3), reviewer-signing (W6-5) keys present
  - Public-key fingerprints match what the ICT register pinned
  - No orphaned top-level entries in the tenant directory

Exit codes:
  0  onboarding succeeded (or doctor passed every check)
  1  operator/config error
  2  doctor found one or more failures
`;
