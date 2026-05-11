/**
 * Judge disagreement report writer (Issue #2038).
 *
 * The writer takes the evaluated cross-family policy result, the
 * per-judge bindings, and an optional cost-per-family rollup, and
 * persists a canonical-JSON, byte-stable
 * `judge-disagreement-report.json` artifact under the active runDir.
 *
 * Hard invariants:
 *
 *   - The artifact is always non-empty: every run gets a report,
 *     even when the panel is unanimous (the disagreement-rate
 *     trending in B.10 needs the audit anchor regardless).
 *   - `rawPromptsIncluded: false` is a literal, type-level `false`
 *     stamped on the artifact.
 *   - `judges` is sorted alphabetically by `judgeId` for canonical-JSON
 *     stability.
 *   - `perFamilyAgreement` and `costByFamily` are sorted by `family`.
 *   - The atomic-write pattern is `writeFile` to
 *     `${path}.${pid}.${randomUUID()}.tmp`, then `rename`.
 */

import { randomUUID } from "node:crypto";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import {
  JUDGE_DISAGREEMENT_DECISION_LABELS,
  JUDGE_DISAGREEMENT_ESCALATION_ACTIONS,
  JUDGE_DISAGREEMENT_REPORT_ARTIFACT_FILENAME,
  JUDGE_DISAGREEMENT_REPORT_SCHEMA_VERSION,
  TEST_INTELLIGENCE_CONTRACT_VERSION,
  type JudgeDisagreementCostByFamily,
  type JudgeDisagreementJudgeEntry,
  type JudgeDisagreementMatrixCell,
  type JudgeDisagreementReport,
  type JudgeModelFamily,
  type LogicJudgeVerdictLabel,
} from "../contracts/index.js";
import { canonicalJson } from "./content-hash.js";
import {
  assessCrossFamilyPanel,
  isJudgeModelFamily,
  isJudgeModelRegion,
  type CrossFamilyJudgePolicyOptions,
  type JudgeFamilyBinding,
} from "./cross-family-judge-policy.js";

const RATE_PRECISION = 1e6;

const roundRate = (value: number): number =>
  Math.round(value * RATE_PRECISION) / RATE_PRECISION;

const compareByJudgeId = (
  a: JudgeDisagreementJudgeEntry,
  b: JudgeDisagreementJudgeEntry,
): number => (a.judgeId < b.judgeId ? -1 : a.judgeId > b.judgeId ? 1 : 0);

const compareByFamily = <T extends { readonly family: JudgeModelFamily }>(
  a: T,
  b: T,
): number => (a.family < b.family ? -1 : a.family > b.family ? 1 : 0);

const buildPerFamilyMatrix = (
  bindings: readonly JudgeFamilyBinding[],
  resolvedVerdict: LogicJudgeVerdictLabel,
): readonly JudgeDisagreementMatrixCell[] => {
  const cells = new Map<JudgeModelFamily, { agreements: number; dissents: number; votes: number }>();
  for (const binding of bindings) {
    const cell = cells.get(binding.family) ?? {
      agreements: 0,
      dissents: 0,
      votes: 0,
    };
    cell.votes++;
    if (binding.verdict === resolvedVerdict) {
      cell.agreements++;
    } else {
      cell.dissents++;
    }
    cells.set(binding.family, cell);
  }
  const result: JudgeDisagreementMatrixCell[] = [];
  for (const [family, cell] of cells) {
    result.push(
      Object.freeze({
        family,
        agreements: cell.agreements,
        dissents: cell.dissents,
        votes: cell.votes,
      }),
    );
  }
  result.sort(compareByFamily);
  return Object.freeze(result);
};

const normaliseCostByFamily = (
  rollup: ReadonlyMap<JudgeModelFamily, { readonly totalTokens: number; readonly costMicrounits: number }> | undefined,
  families: readonly JudgeModelFamily[],
): readonly JudgeDisagreementCostByFamily[] => {
  const familySet = new Set<JudgeModelFamily>(families);
  const seen = new Set<JudgeModelFamily>();
  const result: JudgeDisagreementCostByFamily[] = [];
  if (rollup !== undefined) {
    for (const [family, value] of rollup) {
      if (!isJudgeModelFamily(family)) {
        throw new RangeError(
          `judge-disagreement-report: cost rollup family "${String(family)}" is not a known JudgeModelFamily`,
        );
      }
      if (!familySet.has(family)) {
        throw new RangeError(
          `judge-disagreement-report: cost rollup carries family "${family}" but no judge in the run binds that family. ` +
            `Cost rollups must match the panel's judge bindings.`,
        );
      }
      if (
        !Number.isFinite(value.totalTokens) ||
        value.totalTokens < 0 ||
        !Number.isInteger(value.totalTokens)
      ) {
        throw new RangeError(
          `judge-disagreement-report: cost rollup totalTokens for family "${family}" must be a non-negative integer`,
        );
      }
      if (
        !Number.isFinite(value.costMicrounits) ||
        value.costMicrounits < 0 ||
        !Number.isInteger(value.costMicrounits)
      ) {
        throw new RangeError(
          `judge-disagreement-report: cost rollup costMicrounits for family "${family}" must be a non-negative integer`,
        );
      }
      seen.add(family);
      result.push(
        Object.freeze({
          family,
          totalTokens: value.totalTokens,
          costMicrounits: value.costMicrounits,
        }),
      );
    }
  }
  for (const family of families) {
    if (!seen.has(family)) {
      result.push(
        Object.freeze({ family, totalTokens: 0, costMicrounits: 0 }),
      );
    }
  }
  result.sort(compareByFamily);
  return Object.freeze(result);
};

/** Input shape consumed by {@link buildJudgeDisagreementReport}. */
export interface BuildJudgeDisagreementReportInput {
  readonly jobId: string;
  readonly generatedAt: string;
  readonly bindings: readonly JudgeFamilyBinding[];
  readonly options?: CrossFamilyJudgePolicyOptions;
  /**
   * Optional per-family cost rollup. The writer normalises the map
   * into the persisted array; missing families default to zero so
   * the artifact always carries one entry per distinct family.
   */
  readonly costByFamily?: ReadonlyMap<
    JudgeModelFamily,
    { readonly totalTokens: number; readonly costMicrounits: number }
  >;
}

/**
 * Build the canonical, validated
 * {@link JudgeDisagreementReport} record. Throws on any structural
 * violation; never returns a half-validated record.
 */
export const buildJudgeDisagreementReport = (
  input: BuildJudgeDisagreementReportInput,
): JudgeDisagreementReport => {
  if (typeof input.jobId !== "string" || input.jobId.length === 0) {
    throw new TypeError(
      "buildJudgeDisagreementReport: jobId must be a non-empty string",
    );
  }
  if (typeof input.generatedAt !== "string" || input.generatedAt.length === 0) {
    throw new TypeError(
      "buildJudgeDisagreementReport: generatedAt must be a non-empty string",
    );
  }
  for (let i = 0; i < input.bindings.length; i++) {
    const binding = input.bindings[i];
    if (binding === undefined) {
      throw new TypeError(
        `buildJudgeDisagreementReport: bindings[${i}] is undefined`,
      );
    }
    if (!isJudgeModelFamily(binding.family)) {
      throw new RangeError(
        `buildJudgeDisagreementReport: bindings[${i}].family "${String(binding.family)}" is not a known JudgeModelFamily`,
      );
    }
    if (!isJudgeModelRegion(binding.region)) {
      throw new RangeError(
        `buildJudgeDisagreementReport: bindings[${i}].region "${String(binding.region)}" is not a known JudgeModelRegion`,
      );
    }
  }

  const result = assessCrossFamilyPanel(input.bindings, input.options ?? {});
  const judges: JudgeDisagreementJudgeEntry[] = input.bindings.map((binding) =>
    Object.freeze({
      judgeId: binding.judgeId,
      family: binding.family,
      modelId: binding.modelId,
      promptVersion: binding.promptVersion,
      region: binding.region,
      verdict: binding.verdict,
    }),
  );
  judges.sort(compareByJudgeId);

  const perFamilyAgreement = buildPerFamilyMatrix(
    input.bindings,
    result.resolvedVerdict,
  );
  const costByFamily = normaliseCostByFamily(input.costByFamily, result.families);

  return Object.freeze({
    schemaVersion: JUDGE_DISAGREEMENT_REPORT_SCHEMA_VERSION,
    contractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
    generatedAt: input.generatedAt,
    jobId: input.jobId,
    decision: result.decision,
    escalation: result.escalation,
    disagreementRate: roundRate(result.disagreementRate),
    escalationRate: roundRate(result.escalationRate),
    judges: Object.freeze(judges),
    perFamilyAgreement,
    costByFamily,
    rawPromptsIncluded: false,
  });
};

/** Serialise a report to canonical JSON with a trailing newline. */
export const serializeJudgeDisagreementReport = (
  report: JudgeDisagreementReport,
): string => `${canonicalJson(report)}\n`;

const ISO_8601 =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/u;

const assertNonNegativeInteger = (
  value: number,
  where: string,
): void => {
  if (
    !Number.isFinite(value) ||
    value < 0 ||
    !Number.isInteger(value)
  ) {
    throw new RangeError(`${where}: must be a non-negative integer`);
  }
};

/** Validate a reloaded report. Throws on any structural violation. */
export const assertJudgeDisagreementReportInvariants = (
  report: JudgeDisagreementReport,
): void => {
  if (typeof report.jobId !== "string" || report.jobId.length === 0) {
    throw new TypeError(
      "JudgeDisagreementReport: jobId must be a non-empty string",
    );
  }
  const where = `JudgeDisagreementReport[${report.jobId}]`;
  const schemaVersion: string = report.schemaVersion;
  if (schemaVersion !== JUDGE_DISAGREEMENT_REPORT_SCHEMA_VERSION) {
    throw new TypeError(
      `${where}: schemaVersion must be "${JUDGE_DISAGREEMENT_REPORT_SCHEMA_VERSION}", got "${schemaVersion}"`,
    );
  }
  const contractVersion: string = report.contractVersion;
  if (contractVersion !== TEST_INTELLIGENCE_CONTRACT_VERSION) {
    throw new TypeError(
      `${where}: contractVersion must be "${TEST_INTELLIGENCE_CONTRACT_VERSION}", got "${contractVersion}"`,
    );
  }
  if (
    typeof report.generatedAt !== "string" ||
    !ISO_8601.test(report.generatedAt)
  ) {
    throw new RangeError(
      `${where}: generatedAt must be a strict ISO-8601 timestamp`,
    );
  }
  if (
    !(JUDGE_DISAGREEMENT_DECISION_LABELS as readonly string[]).includes(
      report.decision,
    )
  ) {
    throw new RangeError(
      `${where}: decision "${report.decision}" is not a known JudgeDisagreementDecisionLabel`,
    );
  }
  if (
    !(JUDGE_DISAGREEMENT_ESCALATION_ACTIONS as readonly string[]).includes(
      report.escalation,
    )
  ) {
    throw new RangeError(
      `${where}: escalation "${report.escalation}" is not a known JudgeDisagreementEscalationAction`,
    );
  }
  if (
    !Number.isFinite(report.disagreementRate) ||
    report.disagreementRate < 0 ||
    report.disagreementRate > 1
  ) {
    throw new RangeError(
      `${where}: disagreementRate must be a finite number in [0,1]`,
    );
  }
  if (
    !Number.isFinite(report.escalationRate) ||
    report.escalationRate < 0 ||
    report.escalationRate > 1
  ) {
    throw new RangeError(
      `${where}: escalationRate must be a finite number in [0,1]`,
    );
  }
  if (report.judges.length === 0) {
    throw new RangeError(`${where}: judges must be a non-empty array`);
  }
  for (let i = 0; i < report.judges.length; i++) {
    const judge = report.judges[i]!;
    if (!isJudgeModelFamily(judge.family)) {
      throw new RangeError(
        `${where}: judges[${i}].family "${String(judge.family)}" is not a known JudgeModelFamily`,
      );
    }
    if (!isJudgeModelRegion(judge.region)) {
      throw new RangeError(
        `${where}: judges[${i}].region "${String(judge.region)}" is not a known JudgeModelRegion`,
      );
    }
    if (typeof judge.modelId !== "string" || judge.modelId.length === 0) {
      throw new TypeError(
        `${where}: judges[${i}].modelId must be a non-empty string`,
      );
    }
    if (
      typeof judge.promptVersion !== "string" ||
      judge.promptVersion.length === 0
    ) {
      throw new TypeError(
        `${where}: judges[${i}].promptVersion must be a non-empty string`,
      );
    }
  }
  for (let i = 1; i < report.judges.length; i++) {
    const prev = report.judges[i - 1]!;
    const cur = report.judges[i]!;
    if (compareByJudgeId(prev, cur) >= 0) {
      throw new RangeError(
        `${where}: judges must be sorted alphabetically by judgeId`,
      );
    }
  }
  for (let i = 0; i < report.perFamilyAgreement.length; i++) {
    const cell = report.perFamilyAgreement[i]!;
    if (!isJudgeModelFamily(cell.family)) {
      throw new RangeError(
        `${where}: perFamilyAgreement[${i}].family "${String(cell.family)}" is not a known JudgeModelFamily`,
      );
    }
    assertNonNegativeInteger(
      cell.agreements,
      `${where}: perFamilyAgreement[${i}].agreements`,
    );
    assertNonNegativeInteger(
      cell.dissents,
      `${where}: perFamilyAgreement[${i}].dissents`,
    );
    assertNonNegativeInteger(
      cell.votes,
      `${where}: perFamilyAgreement[${i}].votes`,
    );
    if (cell.agreements + cell.dissents !== cell.votes) {
      throw new RangeError(
        `${where}: perFamilyAgreement[${i}] for family "${cell.family}" must satisfy agreements + dissents === votes`,
      );
    }
  }
  for (let i = 1; i < report.perFamilyAgreement.length; i++) {
    if (
      compareByFamily(
        report.perFamilyAgreement[i - 1]!,
        report.perFamilyAgreement[i]!,
      ) >= 0
    ) {
      throw new RangeError(
        `${where}: perFamilyAgreement must be sorted alphabetically by family`,
      );
    }
  }
  for (let i = 0; i < report.costByFamily.length; i++) {
    const cell = report.costByFamily[i]!;
    if (!isJudgeModelFamily(cell.family)) {
      throw new RangeError(
        `${where}: costByFamily[${i}].family "${String(cell.family)}" is not a known JudgeModelFamily`,
      );
    }
    assertNonNegativeInteger(
      cell.totalTokens,
      `${where}: costByFamily[${i}].totalTokens`,
    );
    assertNonNegativeInteger(
      cell.costMicrounits,
      `${where}: costByFamily[${i}].costMicrounits`,
    );
  }
  for (let i = 1; i < report.costByFamily.length; i++) {
    if (
      compareByFamily(
        report.costByFamily[i - 1]!,
        report.costByFamily[i]!,
      ) >= 0
    ) {
      throw new RangeError(
        `${where}: costByFamily must be sorted alphabetically by family`,
      );
    }
  }
  // The contract pins `rawPromptsIncluded` to the literal `false`. Cast
  // through `unknown` so the runtime guard still fires when a tampered
  // artifact reloads with an unexpected value.
  const rawPromptsIncluded: unknown = report.rawPromptsIncluded;
  if (rawPromptsIncluded !== false) {
    throw new TypeError(
      `${where}: rawPromptsIncluded must be the literal false`,
    );
  }
};

/** Input shape consumed by {@link writeJudgeDisagreementReport}. */
export interface WriteJudgeDisagreementReportInput {
  readonly runDir: string;
  readonly report: JudgeDisagreementReport;
}

/** Result of a successful disagreement-report write. */
export interface WriteJudgeDisagreementReportResult {
  readonly artifactPath: string;
  readonly serialised: string;
  readonly bytes: Buffer;
}

/**
 * Atomically write the disagreement-report artifact to
 * `<runDir>/judge-disagreement-report.json`. Validates the report
 * before serialisation so a malformed record never reaches disk.
 */
export const writeJudgeDisagreementReport = async (
  input: WriteJudgeDisagreementReportInput,
): Promise<WriteJudgeDisagreementReportResult> => {
  if (typeof input.runDir !== "string" || input.runDir.trim().length === 0) {
    throw new TypeError(
      "writeJudgeDisagreementReport: runDir must be a non-empty string",
    );
  }
  assertJudgeDisagreementReportInvariants(input.report);
  const serialised = serializeJudgeDisagreementReport(input.report);
  const finalPath = join(
    input.runDir,
    JUDGE_DISAGREEMENT_REPORT_ARTIFACT_FILENAME,
  );
  await mkdir(dirname(finalPath), { recursive: true });
  const bytes = Buffer.from(serialised, "utf8");
  const tmpPath = `${finalPath}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(tmpPath, bytes);
  await rename(tmpPath, finalPath);
  return Object.freeze({ artifactPath: finalPath, serialised, bytes });
};
