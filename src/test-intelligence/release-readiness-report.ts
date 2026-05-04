/**
 * Consolidated release-readiness report (Issue #1803).
 *
 * The release pipeline (`release:quality-gates`) runs the canonical set of
 * twelve harness gates as ordered subprocesses, captures each gate's
 * stdout+stderr to a per-gate log file, and consolidates the verdicts into
 * a single canonical-JSON report committed to evidence at
 * `<RELEASE_READINESS_ARTIFACT_DIRECTORY>/release-readiness-report.json`.
 *
 * This module provides the pure builder/serializer/parser/atomic-writer; the
 * CLI orchestrator under `scripts/run-release-readiness.mjs` produces the
 * inputs from live subprocess execution.
 *
 * Acceptance contract (Issue #1803):
 * - Single command produces a complete release-readiness report.
 * - Report is canonical-JSON and committed to evidence.
 * - Failures are attributable to the offending gate with a clear log link.
 *
 * Each gate identifier is closed-set, ordered, and listed exactly once. The
 * parser refuses any payload that drops, duplicates, or reorders the gates
 * — a half-written report can never be accepted as evidence.
 */

import { randomUUID } from "node:crypto";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

import {
  ALLOWED_RELEASE_READINESS_GATE_IDS,
  ALLOWED_RELEASE_READINESS_GATE_STATUSES,
  RELEASE_READINESS_REPORT_ARTIFACT_FILENAME,
  RELEASE_READINESS_REPORT_SCHEMA_VERSION,
  TEST_INTELLIGENCE_CONTRACT_VERSION,
  type ReleaseReadinessGateId,
  type ReleaseReadinessGateResult,
  type ReleaseReadinessGateStatus,
  type ReleaseReadinessReport,
} from "../contracts/index.js";
import { canonicalJson } from "./content-hash.js";

const ISO_8601_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;

const RELEASE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;

const ATTRIBUTION_LABEL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;

const COMMAND_MAX_LENGTH = 512;
const LOG_PATH_MAX_LENGTH = 1024;
const MAX_ATTRIBUTION_PER_GATE = 64;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isReleaseReadinessGateId = (
  value: unknown,
): value is ReleaseReadinessGateId =>
  typeof value === "string" &&
  (ALLOWED_RELEASE_READINESS_GATE_IDS as readonly string[]).includes(value);

const isReleaseReadinessGateStatus = (
  value: unknown,
): value is ReleaseReadinessGateStatus =>
  typeof value === "string" &&
  (ALLOWED_RELEASE_READINESS_GATE_STATUSES as readonly string[]).includes(
    value,
  );

const isAttributionLabel = (value: unknown): value is string =>
  typeof value === "string" && ATTRIBUTION_LABEL_PATTERN.test(value);

// Disallow embedded newlines/carriage-returns so a malicious command or
// log-path field cannot smuggle a second line into a CI log preview. Spaces
// are allowed because pnpm script invocations like "pnpm run lint:ts-style"
// legitimately contain whitespace.
const HAS_NEWLINE = /[\n\r]/;

const isCommandString = (value: unknown): value is string =>
  typeof value === "string" &&
  value.length > 0 &&
  value.length <= COMMAND_MAX_LENGTH &&
  !HAS_NEWLINE.test(value);

const isLogPathString = (value: unknown): value is string =>
  typeof value === "string" &&
  value.length > 0 &&
  value.length <= LOG_PATH_MAX_LENGTH &&
  !HAS_NEWLINE.test(value);

const isFiniteNonNegativeInteger = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= 0;

/** Strict structural validator for {@link ReleaseReadinessGateResult}. */
export const isReleaseReadinessGateResult = (
  value: unknown,
): value is ReleaseReadinessGateResult => {
  if (!isRecord(value)) return false;
  if (!isReleaseReadinessGateId(value["gateId"])) return false;
  if (!isCommandString(value["command"])) return false;
  if (!isReleaseReadinessGateStatus(value["status"])) return false;
  if (!isFiniteNonNegativeInteger(value["durationMs"])) return false;
  const status = value["status"];
  const exitCode = value["exitCode"];
  if (status === "skipped") {
    if (exitCode !== null) return false;
    if (value["logPath"] !== null) return false;
    if (value["durationMs"] !== 0) return false;
  } else {
    if (
      typeof exitCode !== "number" ||
      !Number.isInteger(exitCode) ||
      exitCode < -255 ||
      exitCode > 255
    ) {
      return false;
    }
    if (status === "passed" && exitCode !== 0) return false;
    if (status === "failed" && exitCode === 0) return false;
    if (!isLogPathString(value["logPath"])) return false;
  }
  if (!Array.isArray(value["attribution"])) return false;
  const attribution = value["attribution"] as readonly unknown[];
  if (attribution.length > MAX_ATTRIBUTION_PER_GATE) return false;
  for (const label of attribution) {
    if (!isAttributionLabel(label)) return false;
  }
  return true;
};

/** Strict structural validator for {@link ReleaseReadinessReport}. */
export const isReleaseReadinessReport = (
  value: unknown,
): value is ReleaseReadinessReport => {
  if (!isRecord(value)) return false;
  if (value["schemaVersion"] !== RELEASE_READINESS_REPORT_SCHEMA_VERSION) {
    return false;
  }
  if (value["contractVersion"] !== TEST_INTELLIGENCE_CONTRACT_VERSION) {
    return false;
  }
  if (
    typeof value["releaseId"] !== "string" ||
    !RELEASE_ID_PATTERN.test(value["releaseId"])
  ) {
    return false;
  }
  if (
    typeof value["generatedAt"] !== "string" ||
    !ISO_8601_PATTERN.test(value["generatedAt"])
  ) {
    return false;
  }
  if (typeof value["passed"] !== "boolean") return false;
  if (!Array.isArray(value["gates"])) return false;
  const gates = value["gates"] as readonly unknown[];
  if (gates.length !== ALLOWED_RELEASE_READINESS_GATE_IDS.length) return false;
  for (let index = 0; index < gates.length; index += 1) {
    const gate = gates[index];
    if (!isReleaseReadinessGateResult(gate)) return false;
    if (gate.gateId !== ALLOWED_RELEASE_READINESS_GATE_IDS[index]) {
      return false;
    }
  }
  // Top-level `passed` must reflect every non-skipped gate.
  const computedPassed = (
    gates as readonly ReleaseReadinessGateResult[]
  ).every((gate) => gate.status !== "failed");
  if (value["passed"] !== computedPassed) return false;
  return true;
};

export interface BuildReleaseReadinessReportInput {
  readonly releaseId: string;
  readonly generatedAt: string;
  readonly gates: readonly ReleaseReadinessGateResult[];
}

/**
 * Build a {@link ReleaseReadinessReport} from per-gate subprocess results.
 *
 * - `gates` MUST contain exactly one entry per
 *   {@link ALLOWED_RELEASE_READINESS_GATE_IDS} member; order is enforced
 *   by re-sorting against the canonical list (input order may vary).
 * - The top-level `passed` is derived: `true` iff no gate is `failed`. A
 *   gate marked `skipped` does not fail the release — the orchestrator
 *   marks `test_ti_live_e2e` skipped only when its env-gate explicitly
 *   says live credentials are absent.
 */
export const buildReleaseReadinessReport = (
  input: BuildReleaseReadinessReportInput,
): ReleaseReadinessReport => {
  if (
    typeof input.releaseId !== "string" ||
    !RELEASE_ID_PATTERN.test(input.releaseId)
  ) {
    throw new TypeError(
      "buildReleaseReadinessReport: releaseId must match RELEASE_ID_PATTERN",
    );
  }
  if (
    typeof input.generatedAt !== "string" ||
    !ISO_8601_PATTERN.test(input.generatedAt)
  ) {
    throw new TypeError(
      "buildReleaseReadinessReport: generatedAt must be ISO-8601",
    );
  }
  const byId = new Map<ReleaseReadinessGateId, ReleaseReadinessGateResult>();
  for (const gate of input.gates) {
    if (!isReleaseReadinessGateResult(gate)) {
      throw new TypeError(
        "buildReleaseReadinessReport: invalid ReleaseReadinessGateResult",
      );
    }
    if (byId.has(gate.gateId)) {
      throw new TypeError(
        `buildReleaseReadinessReport: duplicate gateId ${gate.gateId}`,
      );
    }
    byId.set(gate.gateId, gate);
  }
  const orderedGates: ReleaseReadinessGateResult[] = [];
  for (const id of ALLOWED_RELEASE_READINESS_GATE_IDS) {
    const gate = byId.get(id);
    if (!gate) {
      throw new TypeError(
        `buildReleaseReadinessReport: missing gate ${id}; report must list every gate`,
      );
    }
    orderedGates.push(gate);
  }
  const passed = orderedGates.every((gate) => gate.status !== "failed");
  return {
    schemaVersion: RELEASE_READINESS_REPORT_SCHEMA_VERSION,
    contractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
    releaseId: input.releaseId,
    generatedAt: input.generatedAt,
    passed,
    gates: orderedGates,
  };
};

/** Canonical-JSON serializer (trailing newline). */
export const serializeReleaseReadinessReport = (
  report: ReleaseReadinessReport,
): string => `${canonicalJson(report)}\n`;

/**
 * Strict parser. Returns `undefined` for any malformed payload so a half-
 * written or hand-edited report cannot be promoted to evidence.
 */
export const parseReleaseReadinessReport = (
  payload: string,
): ReleaseReadinessReport | undefined => {
  if (!payload.endsWith("\n")) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    return undefined;
  }
  if (!isReleaseReadinessReport(parsed)) return undefined;
  return parsed;
};

export interface WriteReleaseReadinessReportInput {
  readonly report: ReleaseReadinessReport;
  readonly runDir: string;
}

export interface WriteReleaseReadinessReportResult {
  readonly artifactPath: string;
  readonly serialized: string;
}

/**
 * Atomically write `<runDir>/release-readiness-report.json` (tmp + rename).
 *
 * The serialized payload is byte-stable for byte-identical inputs because
 * `canonicalJson` sorts object keys deterministically and `gates[]` is
 * pre-sorted into canonical pipeline order by {@link buildReleaseReadinessReport}.
 */
export const writeReleaseReadinessReport = async (
  input: WriteReleaseReadinessReportInput,
): Promise<WriteReleaseReadinessReportResult> => {
  if (typeof input.runDir !== "string" || input.runDir.length === 0) {
    throw new TypeError(
      "writeReleaseReadinessReport: runDir must be a non-empty string",
    );
  }
  if (!isReleaseReadinessReport(input.report)) {
    throw new TypeError(
      "writeReleaseReadinessReport: refusing to persist invalid ReleaseReadinessReport",
    );
  }
  const serialized = serializeReleaseReadinessReport(input.report);
  const artifactPath = join(
    input.runDir,
    RELEASE_READINESS_REPORT_ARTIFACT_FILENAME,
  );
  const tmpPath = `${artifactPath}.${process.pid}.${randomUUID()}.tmp`;
  await mkdir(input.runDir, { recursive: true });
  await writeFile(tmpPath, serialized, "utf8");
  await rename(tmpPath, artifactPath);
  return { artifactPath, serialized };
};

/**
 * Canonical command spec for each release-readiness gate, mirroring the
 * pipeline order defined in {@link ALLOWED_RELEASE_READINESS_GATE_IDS}.
 *
 * `livePolicy` declares whether the gate is skippable when its prerequisites
 * are absent. Only `test_ti_live_e2e` is opt-in (`live_credentials_required`);
 * every other gate is mandatory and must run.
 */
export interface ReleaseReadinessGateSpec {
  readonly gateId: ReleaseReadinessGateId;
  readonly command: string;
  readonly livePolicy: "mandatory" | "live_credentials_required";
}

export const RELEASE_READINESS_GATE_SPECS: readonly ReleaseReadinessGateSpec[] =
  Object.freeze([
    { gateId: "typecheck", command: "pnpm run typecheck", livePolicy: "mandatory" },
    { gateId: "test", command: "pnpm run test", livePolicy: "mandatory" },
    {
      gateId: "test_ti_eval",
      command: "pnpm run test:ti-eval",
      livePolicy: "mandatory",
    },
    {
      gateId: "test_ti_live_e2e",
      command: "pnpm run test:ti-live-e2e",
      livePolicy: "live_credentials_required",
    },
    {
      gateId: "lint_no_telemetry",
      command: "pnpm run lint:no-telemetry",
      livePolicy: "mandatory",
    },
    {
      gateId: "lint_secrets_all",
      command: "pnpm run lint:secrets:all",
      livePolicy: "mandatory",
    },
    {
      gateId: "lint_agent_boundaries",
      command: "pnpm run lint:agent-boundaries",
      livePolicy: "mandatory",
    },
    {
      gateId: "lint_ts_style",
      command: "pnpm run lint:ts-style",
      livePolicy: "mandatory",
    },
    { gateId: "build", command: "pnpm run build", livePolicy: "mandatory" },
    {
      gateId: "release_ml_bom_emit",
      command: "pnpm run release:ml-bom-emit",
      livePolicy: "mandatory",
    },
    {
      gateId: "release_merkle_roundtrip",
      command: "pnpm run release:merkle-roundtrip",
      livePolicy: "mandatory",
    },
    {
      gateId: "release_library_coverage_report",
      command: "pnpm run release:library-coverage-report",
      livePolicy: "mandatory",
    },
  ] as const);
