import { randomUUID } from "node:crypto";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type {
  JudgePanelVerdict,
  TestCaseValidationIssue,
  TestCaseValidationReport,
} from "../contracts/index.js";
import { canonicalJson, sha256Hex } from "./content-hash.js";
import type { AdversarialGapFinding } from "./adversarial-gap-finder.js";

export const CONSOLIDATED_FINDING_SCHEMA_VERSION = "1.0.0" as const;
export const CONSOLIDATED_FINDINGS_ARTIFACT_FILENAME =
  "finding-consolidator.json" as const;

export const REPAIR_CHANGE_TARGETS = [
  "expected_result",
  "metadata",
  "steps",
  "test_data",
  "traceability",
] as const;

export type RepairChangeTarget = (typeof REPAIR_CHANGE_TARGETS)[number];
export type ConsolidatedFindingSeverity = "critical" | "major" | "minor";
export type ConsolidatedFindingSource = "gap" | "judge" | "validator";

export interface ConsolidatedFinding {
  readonly schemaVersion: typeof CONSOLIDATED_FINDING_SCHEMA_VERSION;
  readonly findingId: string;
  readonly fingerprint: string;
  readonly source: ConsolidatedFindingSource;
  readonly severity: ConsolidatedFindingSeverity;
  readonly kind: string;
  readonly summary: string;
  readonly repairTarget: RepairChangeTarget;
  readonly testCaseId?: string;
  readonly sourceRefs: readonly string[];
  readonly ruleRefs: readonly string[];
  readonly relatedFindingIds: readonly string[];
  readonly preferredCaseTypes?: readonly string[];
}

export interface ConsolidateFindingsInput {
  readonly validationReport?: TestCaseValidationReport;
  readonly judgeVerdicts?: readonly JudgePanelVerdict[];
  readonly gapFindings?: readonly AdversarialGapFinding[];
}

const SEVERITY_RANK: Readonly<Record<ConsolidatedFindingSeverity, number>> =
  Object.freeze({
    critical: 0,
    major: 1,
    minor: 2,
  });

export const consolidateFindings = (
  input: ConsolidateFindingsInput,
): readonly ConsolidatedFinding[] => {
  const candidates: ConsolidatedFinding[] = [
    ...(input.validationReport?.issues ?? []).map(normalizeValidationIssue),
    ...(input.judgeVerdicts ?? []).flatMap(normalizeJudgeVerdict),
    ...(input.gapFindings ?? []).map(normalizeGapFinding),
  ];

  const byFingerprint = new Map<string, ConsolidatedFinding>();
  for (const candidate of candidates) {
    const existing = byFingerprint.get(candidate.fingerprint);
    if (existing === undefined) {
      byFingerprint.set(candidate.fingerprint, candidate);
      continue;
    }
    byFingerprint.set(candidate.fingerprint, mergeFindings(existing, candidate));
  }

  return [...byFingerprint.values()].sort(compareFindings);
};

export const serializeConsolidatedFindings = (
  findings: readonly ConsolidatedFinding[],
): string => canonicalJson([...findings]);

export const writeConsolidatedFindings = async (input: {
  readonly findings: readonly ConsolidatedFinding[];
  readonly runDir: string;
}): Promise<{ artifactPath: string; serialised: string }> => {
  if (typeof input.runDir !== "string" || input.runDir.length === 0) {
    throw new TypeError(
      "writeConsolidatedFindings: runDir must be a non-empty string",
    );
  }
  await mkdir(input.runDir, { recursive: true });
  const artifactPath = join(
    input.runDir,
    CONSOLIDATED_FINDINGS_ARTIFACT_FILENAME,
  );
  const serialised = serializeConsolidatedFindings(input.findings);
  const tempPath = `${artifactPath}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(tempPath, serialised, { encoding: "utf8" });
  await rename(tempPath, artifactPath);
  return { artifactPath, serialised };
};

const normalizeValidationIssue = (
  issue: TestCaseValidationIssue,
): ConsolidatedFinding => {
  const repairTarget = inferRepairChangeTarget(issue.path);
  const severity = mapValidationSeverity(issue.severity, issue.code);
  return buildFinding({
    source: "validator",
    severity,
    kind: issue.code,
    summary: issue.message,
    repairTarget,
    ...(issue.testCaseId !== undefined ? { testCaseId: issue.testCaseId } : {}),
    sourceRefs: extractRefsFromMessage(issue.message),
    ruleRefs: [issue.code],
    relatedFindingIds: [buildSourceFindingId("validator", issue.code, issue.testCaseId)],
  });
};

const normalizeJudgeVerdict = (
  verdict: JudgePanelVerdict,
): readonly ConsolidatedFinding[] => {
  if (verdict.agreement === "both_pass") {
    return [];
  }
  const severity: ConsolidatedFindingSeverity =
    verdict.agreement === "both_fail" ? "critical" : "major";
  return [
    buildFinding({
      source: "judge",
      severity,
      kind: verdict.agreement,
      summary:
        verdict.agreement === "both_fail"
          ? `Judge panel failed criterion "${verdict.criterion}".`
          : `Judge panel disagreement on criterion "${verdict.criterion}".`,
      repairTarget: "metadata",
      testCaseId: verdict.testCaseId,
      sourceRefs: [],
      ruleRefs: [verdict.criterion],
      relatedFindingIds: [
        buildSourceFindingId("judge", verdict.criterion, verdict.testCaseId),
      ],
    }),
  ];
};

const normalizeGapFinding = (
  finding: AdversarialGapFinding,
): ConsolidatedFinding =>
  buildFinding({
    source: "gap",
    severity: finding.severity,
    kind: finding.kind,
    summary: finding.summary,
    repairTarget:
      finding.missingCaseType === "boundary"
        ? "expected_result"
        : finding.missingCaseType === "negative"
          ? "test_data"
          : "steps",
    sourceRefs: [...finding.sourceRefs],
    ruleRefs: [...finding.ruleRefs],
    relatedFindingIds: [finding.findingId, ...finding.relatedMutationIds],
    preferredCaseTypes:
      finding.missingCaseType === "boundary"
        ? ["boundary", "validation", "functional"]
        : finding.missingCaseType === "negative"
          ? ["negative", "validation", "functional"]
          : ["navigation", "exploratory", "functional"],
  });

const buildFinding = (input: {
  source: ConsolidatedFindingSource;
  severity: ConsolidatedFindingSeverity;
  kind: string;
  summary: string;
  repairTarget: RepairChangeTarget;
  testCaseId?: string;
  sourceRefs: readonly string[];
  ruleRefs: readonly string[];
  relatedFindingIds: readonly string[];
  preferredCaseTypes?: readonly string[];
}): ConsolidatedFinding => {
  const fingerprint = sha256Hex({
    source: input.source,
    severity: input.severity,
    kind: input.kind,
    summary: input.summary,
    repairTarget: input.repairTarget,
    testCaseId: input.testCaseId ?? null,
    sourceRefs: [...new Set(input.sourceRefs)].sort(),
    ruleRefs: [...new Set(input.ruleRefs)].sort(),
  });
  const findingId = `repair-${fingerprint.slice(0, 16)}`;
  return {
    schemaVersion: CONSOLIDATED_FINDING_SCHEMA_VERSION,
    findingId,
    fingerprint,
    source: input.source,
    severity: input.severity,
    kind: input.kind,
    summary: input.summary,
    repairTarget: input.repairTarget,
    ...(input.testCaseId !== undefined ? { testCaseId: input.testCaseId } : {}),
    sourceRefs: uniqueSorted(input.sourceRefs),
    ruleRefs: uniqueSorted(input.ruleRefs),
    relatedFindingIds: uniqueSorted(input.relatedFindingIds),
    ...(input.preferredCaseTypes !== undefined
      ? { preferredCaseTypes: uniqueSorted(input.preferredCaseTypes) }
      : {}),
  };
};

const mergeFindings = (
  left: ConsolidatedFinding,
  right: ConsolidatedFinding,
): ConsolidatedFinding => ({
  ...(compareFindings(left, right) <= 0 ? left : right),
  severity:
    SEVERITY_RANK[left.severity] <= SEVERITY_RANK[right.severity]
      ? left.severity
      : right.severity,
  relatedFindingIds: uniqueSorted([
    ...left.relatedFindingIds,
    ...right.relatedFindingIds,
  ]),
  sourceRefs: uniqueSorted([...left.sourceRefs, ...right.sourceRefs]),
  ruleRefs: uniqueSorted([...left.ruleRefs, ...right.ruleRefs]),
  ...(left.preferredCaseTypes !== undefined ||
  right.preferredCaseTypes !== undefined
    ? {
        preferredCaseTypes: uniqueSorted([
          ...(left.preferredCaseTypes ?? []),
          ...(right.preferredCaseTypes ?? []),
        ]),
      }
    : {}),
});

const compareFindings = (
  left: ConsolidatedFinding,
  right: ConsolidatedFinding,
): number =>
  SEVERITY_RANK[left.severity] - SEVERITY_RANK[right.severity] ||
  (left.testCaseId ?? "").localeCompare(right.testCaseId ?? "") ||
  left.kind.localeCompare(right.kind) ||
  left.repairTarget.localeCompare(right.repairTarget) ||
  left.fingerprint.localeCompare(right.fingerprint);

const mapValidationSeverity = (
  severity: "error" | "warning",
  code: string,
): ConsolidatedFindingSeverity => {
  if (severity === "warning") {
    return "minor";
  }
  if (code === "schema_invalid" || code === "semantic_suspicious_content") {
    return "critical";
  }
  return "major";
};

const inferRepairChangeTarget = (path: string): RepairChangeTarget => {
  if (path.includes(".steps[")) return "steps";
  if (path.includes(".expectedResults")) return "expected_result";
  if (path.includes(".testData")) return "test_data";
  return "metadata";
};

const buildSourceFindingId = (
  source: ConsolidatedFindingSource,
  kind: string,
  testCaseId?: string,
): string =>
  `${source}:${kind}:${testCaseId ?? "job"}`;

const extractRefsFromMessage = (message: string): string[] => {
  const matches = message.match(/[A-Za-z0-9_.:-]+/gu) ?? [];
  return uniqueSorted(matches.filter((token) => token.includes(":")));
};

const uniqueSorted = (values: Iterable<string>): string[] =>
  [...new Set(values)].sort((left, right) => left.localeCompare(right));
