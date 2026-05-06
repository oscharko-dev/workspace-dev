import { randomUUID } from "node:crypto";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import {
  FAITHFULNESS_VERDICT_SCHEMA_VERSION,
  JUDGE_CONSENSUS_ARTIFACT_FILENAME,
  JUDGE_CONSENSUS_SCHEMA_VERSION,
  LOGIC_JUDGE_VERDICT_SCHEMA_VERSION,
  TEST_INTELLIGENCE_CONTRACT_VERSION,
  type FaithfulnessVerdict,
  type JudgeConsensusFinding,
  type JudgeConsensusPanelEntry,
  type JudgeConsensusVerdict,
  type JudgeVerdict,
  type RepairInstruction,
} from "../contracts/index.js";
import { canonicalJson } from "./content-hash.js";

type ConsensusVerdictLabel = JudgeConsensusVerdict["verdict"];

const MAX_INSTRUCTION_LENGTH = 240 as const;
const MAX_PATH_LENGTH = 160 as const;
const MAX_MESSAGE_LENGTH = 240 as const;

const compareInstruction = (
  left: RepairInstruction,
  right: RepairInstruction,
): number =>
  (left.kind ?? "").localeCompare(right.kind ?? "") ||
  (left.message ?? "").localeCompare(right.message ?? "") ||
  left.testCaseId.localeCompare(right.testCaseId) ||
  left.path.localeCompare(right.path) ||
  left.instruction.localeCompare(right.instruction);

const truncate = (value: string, maxLength: number): string =>
  value.length <= maxLength ? value : `${value.slice(0, maxLength - 3)}...`;

const normalizeWeight = (weight: number): number =>
  Number.isFinite(weight) && weight > 0 ? weight : 1;

const normalizeJudgeVerdict = (
  entry: JudgeConsensusPanelEntry,
): JudgeConsensusPanelEntry => {
  if (
    (entry.judgeId === "a11y_judge" || entry.judgeId === "coverage_judge") &&
    entry.verdict === "reject"
  ) {
    return { ...entry, verdict: "repair" };
  }
  return entry;
};

const toSeverityRank = (verdict: ConsensusVerdictLabel): number => {
  switch (verdict) {
    case "reject":
      return 2;
    case "repair":
      return 1;
    default:
      return 0;
  }
};

const selectHigherSeverity = (
  left: JudgeConsensusPanelEntry,
  right: JudgeConsensusPanelEntry,
): JudgeConsensusPanelEntry => {
  const verdictDelta =
    toSeverityRank(left.verdict) - toSeverityRank(right.verdict);
  if (verdictDelta !== 0) {
    return verdictDelta > 0 ? left : right;
  }
  const weightDelta = left.weight - right.weight;
  if (weightDelta !== 0) {
    return weightDelta > 0 ? left : right;
  }
  return left.judgeId.localeCompare(right.judgeId) <= 0 ? left : right;
};

const isSchemaClassFinding = (entry: JudgeConsensusPanelEntry): boolean =>
  entry.findings.some(
    (finding) =>
      finding.category === "schema_class" || finding.code.includes("schema"),
  ) ||
  entry.repairInstructions.some((instruction) => instruction.kind === "schema_violation");

const isCrossModalMismatchFinding = (entry: JudgeConsensusPanelEntry): boolean =>
  entry.findings.some(
    (finding) => finding.category === "cross_modal_mismatch",
  );

const isIrAllowlistViolationFinding = (
  entry: JudgeConsensusPanelEntry,
): boolean =>
  entry.findings.some(
    (finding) =>
      finding.category === "ir_allowlist_violation" ||
      finding.code.startsWith("invented_"),
  );

const hasVeto = (entry: JudgeConsensusPanelEntry): boolean => {
  switch (entry.judgeId) {
    case "logic_judge":
      return isSchemaClassFinding(entry);
    case "faithfulness_judge":
      return isCrossModalMismatchFinding(entry);
    case "hallucination_judge":
      return isIrAllowlistViolationFinding(entry);
    default:
      return false;
  }
};

const dedupeRepairInstructions = (
  panel: readonly JudgeConsensusPanelEntry[],
): readonly RepairInstruction[] => {
  const dedup = new Map<string, RepairInstruction>();
  for (const entry of panel) {
    for (const instruction of entry.repairInstructions) {
      const normalized: RepairInstruction = {
        testCaseId: instruction.testCaseId,
        path: truncate(instruction.path, MAX_PATH_LENGTH),
        instruction: truncate(instruction.instruction, MAX_INSTRUCTION_LENGTH),
        ...(instruction.kind !== undefined ? { kind: instruction.kind } : {}),
        ...(instruction.message !== undefined
          ? { message: truncate(instruction.message, MAX_MESSAGE_LENGTH) }
          : {}),
      };
      const key = [
        normalized.kind ?? "",
        normalized.message ?? "",
        normalized.testCaseId,
        normalized.path,
        normalized.instruction,
      ].join("\0");
      if (!dedup.has(key)) {
        dedup.set(key, normalized);
      }
    }
  }
  return [...dedup.values()].sort(compareInstruction);
};

const resolveWeightedVerdict = (
  panel: readonly JudgeConsensusPanelEntry[],
): ConsensusVerdictLabel => {
  const totals = {
    accept: 0,
    repair: 0,
    reject: 0,
  };
  for (const entry of panel) {
    totals[entry.verdict] += entry.weight;
  }
  const maxWeight = Math.max(totals.accept, totals.repair, totals.reject);
  const tied = (
    Object.entries(totals) as Array<[ConsensusVerdictLabel, number]>
  )
    .filter(([, weight]) => weight === maxWeight)
    .map(([verdict]) => verdict);
  if (tied.length === 1) {
    return tied[0]!;
  }
  if (tied.includes("repair")) {
    return "repair";
  }
  if (tied.includes("accept") && tied.includes("reject")) {
    return "repair";
  }
  return tied.sort((left, right) => toSeverityRank(right) - toSeverityRank(left))[0]!;
};

export interface BuildJudgeConsensusInput {
  readonly jobId: string;
  readonly generatedAt: string;
  readonly panel: readonly JudgeConsensusPanelEntry[];
}

export const buildLogicJudgeConsensusEntry = (
  verdict: JudgeVerdict,
  weight = 1,
): JudgeConsensusPanelEntry => ({
  judgeId: "logic_judge",
  verdict: verdict.verdict,
  weight: normalizeWeight(weight),
  findings: verdict.findings.map(
    (finding): JudgeConsensusFinding => ({
      testCaseId: finding.testCaseId,
      code: finding.code,
      message: finding.message,
      severity: finding.severity,
      category: finding.code.includes("schema") ? "schema_class" : "other",
    }),
  ),
  repairInstructions: verdict.repairInstructions,
});

const buildFaithfulnessRepairInstructions = (
  verdict: FaithfulnessVerdict,
): readonly RepairInstruction[] => {
  const instructions: RepairInstruction[] = [];
  for (const hallucination of verdict.hallucinations) {
    instructions.push({
      testCaseId: hallucination.testCaseId,
      path:
        hallucination.stepIndex !== undefined
          ? `steps[${hallucination.stepIndex}]`
          : "$case",
      instruction: truncate(
        `Faithfulness hallucination: ${hallucination.message}`,
        MAX_INSTRUCTION_LENGTH,
      ),
    });
  }
  for (const mismatch of verdict.mismatches) {
    instructions.push({
      testCaseId: mismatch.testCaseId,
      path:
        mismatch.stepIndex !== undefined
          ? `steps[${mismatch.stepIndex}].expected`
          : "expectedResults",
      instruction: truncate(
        `Faithfulness mismatch (expected="${mismatch.expectedLabel}", visible="${mismatch.visibleLabel}"): ${mismatch.message}`,
        MAX_INSTRUCTION_LENGTH,
      ),
    });
  }
  return instructions.sort(compareInstruction);
};

export const buildFaithfulnessJudgeConsensusEntry = (
  verdict: FaithfulnessVerdict,
  weight = 1,
): JudgeConsensusPanelEntry => ({
  judgeId: "faithfulness_judge",
  verdict: verdict.verdict,
  weight: normalizeWeight(weight),
  findings: [
    ...verdict.hallucinations.map(
      (hallucination): JudgeConsensusFinding => ({
        testCaseId: hallucination.testCaseId,
        code: "hallucination",
        message: hallucination.message,
        category: "hallucination",
      }),
    ),
    ...verdict.mismatches.map(
      (mismatch): JudgeConsensusFinding => ({
        testCaseId: mismatch.testCaseId,
        code: "cross_modal_mismatch",
        message: mismatch.message,
        category: "cross_modal_mismatch",
      }),
    ),
  ],
  repairInstructions: buildFaithfulnessRepairInstructions(verdict),
});

export const buildJudgeConsensus = (
  input: BuildJudgeConsensusInput,
): JudgeConsensusVerdict => {
  if (input.jobId.trim().length === 0) {
    throw new TypeError("buildJudgeConsensus: jobId must be non-empty");
  }
  const panel = input.panel.map((entry) =>
    normalizeJudgeVerdict({
      ...entry,
      weight: normalizeWeight(entry.weight),
    }),
  );
  if (panel.length === 0) {
    throw new RangeError("buildJudgeConsensus: panel must contain at least one judge");
  }
  const repairInstructions = dedupeRepairInstructions(panel);
  const vetoCandidate = panel.filter(hasVeto).reduce<JudgeConsensusPanelEntry | undefined>(
    (selected, entry) =>
      selected === undefined ? entry : selectHigherSeverity(selected, entry),
    undefined,
  );
  const verdict =
    vetoCandidate?.verdict ?? resolveWeightedVerdict(panel);
  return {
    schemaVersion: JUDGE_CONSENSUS_SCHEMA_VERSION,
    contractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
    generatedAt: input.generatedAt,
    jobId: input.jobId,
    verdict,
    repairInstructions,
    ...(vetoCandidate !== undefined
      ? {
          vetoBy: {
            judgeId: vetoCandidate.judgeId,
            verdict: vetoCandidate.verdict,
            findingCodes: vetoCandidate.findings.map((finding) => finding.code),
          },
        }
      : {}),
    panel,
  };
};

export interface WriteJudgeConsensusArtifactInput {
  readonly runDir: string;
  readonly artifact: JudgeConsensusVerdict;
}

export const writeJudgeConsensusArtifact = async (
  input: WriteJudgeConsensusArtifactInput,
): Promise<{ readonly path: string; readonly bytes: Buffer }> => {
  const filePath = join(input.runDir, JUDGE_CONSENSUS_ARTIFACT_FILENAME);
  await mkdir(dirname(filePath), { recursive: true });
  const bytes = Buffer.from(canonicalJson(input.artifact), "utf8");
  const tmp = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(tmp, bytes);
  await rename(tmp, filePath);
  return { path: filePath, bytes };
};

export const isLogicJudgeVerdict = (value: unknown): value is JudgeVerdict =>
  typeof value === "object" &&
  value !== null &&
  "schemaVersion" in value &&
  (value as { schemaVersion?: unknown }).schemaVersion ===
    LOGIC_JUDGE_VERDICT_SCHEMA_VERSION;

export const isFaithfulnessJudgeVerdict = (
  value: unknown,
): value is FaithfulnessVerdict =>
  typeof value === "object" &&
  value !== null &&
  "schemaVersion" in value &&
  (value as { schemaVersion?: unknown }).schemaVersion ===
    FAITHFULNESS_VERDICT_SCHEMA_VERSION;
