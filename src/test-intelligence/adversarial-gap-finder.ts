import { randomUUID } from "node:crypto";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type {
  CoveragePlan,
  GeneratedTestCaseList,
  IrMutationCoverageStrengthReport,
} from "../contracts/index.js";
import { canonicalJson } from "./content-hash.js";

export const ADVERSARIAL_GAP_FINDING_SCHEMA_VERSION = "1.0.0" as const;
export const ADVERSARIAL_GAP_FINDINGS_ARTIFACT_FILENAME =
  "adversarial-gap-findings.json" as const;

export const ADVERSARIAL_GAP_FINDING_KINDS = [
  "missing_boundary_case",
  "missing_negative_case",
  "missing_state_transition_case",
] as const;

export type AdversarialGapFindingKind =
  (typeof ADVERSARIAL_GAP_FINDING_KINDS)[number];

export interface AdversarialGapFinding {
  readonly schemaVersion: typeof ADVERSARIAL_GAP_FINDING_SCHEMA_VERSION;
  readonly findingId: string;
  readonly kind: AdversarialGapFindingKind;
  readonly severity: "major";
  readonly summary: string;
  readonly sourceRefs: readonly string[];
  readonly ruleRefs: readonly string[];
  readonly relatedMutationIds: readonly string[];
  readonly missingCaseType: "boundary" | "negative" | "navigation";
}

export interface FindAdversarialGapsInput {
  readonly list: GeneratedTestCaseList;
  readonly coveragePlan?: CoveragePlan;
  readonly mutationReport?: IrMutationCoverageStrengthReport;
}

type MutationRecord = NonNullable<
  FindAdversarialGapsInput["mutationReport"]
>["perMutation"][number];

const GAP_KIND_TO_CASE_TYPE: Readonly<
  Record<AdversarialGapFindingKind, AdversarialGapFinding["missingCaseType"]>
> = Object.freeze({
  missing_boundary_case: "boundary",
  missing_negative_case: "negative",
  missing_state_transition_case: "navigation",
});

const GAP_KIND_TO_SUMMARY: Readonly<Record<AdversarialGapFindingKind, string>> =
  Object.freeze({
    missing_boundary_case:
      "Boundary coverage is incomplete for surviving adversarial checks.",
    missing_negative_case:
      "Negative-path coverage is incomplete for surviving adversarial checks.",
    missing_state_transition_case:
      "State-transition coverage is incomplete for surviving adversarial checks.",
  });

const GAP_KIND_PRIORITY: Readonly<Record<AdversarialGapFindingKind, number>> =
  Object.freeze({
    missing_boundary_case: 0,
    missing_negative_case: 1,
    missing_state_transition_case: 2,
  });

export const findAdversarialGaps = (
  input: FindAdversarialGapsInput,
): readonly AdversarialGapFinding[] => {
  const findings = new Map<AdversarialGapFindingKind, AdversarialGapFinding>();
  const survivingIds = new Set(
    input.mutationReport?.survivingMutationsForRepair ?? [],
  );

  const groupedMutations = {
    missing_negative_case: [] as MutationRecord[],
    missing_boundary_case: [] as MutationRecord[],
    missing_state_transition_case: [] as MutationRecord[],
  };

  for (const mutation of input.mutationReport?.perMutation ?? []) {
    if (!survivingIds.has(mutation.mutationId)) {
      continue;
    }
    switch (mutation.mutationKind) {
      case "flip_required":
      case "invert_decision_rule":
      case "swap_equivalence_class":
        groupedMutations.missing_negative_case.push(mutation);
        break;
      case "shrink_boundary":
        groupedMutations.missing_boundary_case.push(mutation);
        break;
      case "drop_state_transition":
        groupedMutations.missing_state_transition_case.push(mutation);
        break;
    }
  }

  for (const [kind, mutations] of Object.entries(groupedMutations) as Array<
    [AdversarialGapFindingKind, MutationRecord[]]
  >) {
    if (mutations.length === 0) {
      continue;
    }
    findings.set(
      kind,
      buildFinding({
        kind,
        sourceRefs: uniqueSorted(
          mutations.flatMap((mutation) => mutation.affectedSourceRefs),
        ),
        ruleRefs: uniqueSorted(mutations.map((mutation) => mutation.mutationId)),
        relatedMutationIds: uniqueSorted(
          mutations.map((mutation) => mutation.mutationId),
        ),
      }),
    );
  }

  const cases = input.list.testCases;
  const hasNegative = cases.some((testCase) => testCase.type === "negative");
  const hasBoundary = cases.some((testCase) => testCase.type === "boundary");
  const hasStateTransition = cases.some(
    (testCase) =>
      testCase.type === "navigation" ||
      testCase.technique === "state_transition",
  );

  if (!hasNegative) {
    const refs = collectCoverageRefs(
      input.coveragePlan,
      new Set(["decision_table", "error_guessing"]),
    );
    if (refs.ruleRefs.length > 0) {
      const existing = findings.get("missing_negative_case");
      findings.set(
        "missing_negative_case",
        buildFinding({
          kind: "missing_negative_case",
          sourceRefs: [...(existing?.sourceRefs ?? []), ...refs.sourceRefs],
          ruleRefs: [...(existing?.ruleRefs ?? []), ...refs.ruleRefs],
          relatedMutationIds: existing?.relatedMutationIds ?? [],
        }),
      );
    }
  }

  if (!hasBoundary) {
    const refs = collectCoverageRefs(
      input.coveragePlan,
      new Set(["boundary_value"]),
    );
    if (refs.ruleRefs.length > 0) {
      const existing = findings.get("missing_boundary_case");
      findings.set(
        "missing_boundary_case",
        buildFinding({
          kind: "missing_boundary_case",
          sourceRefs: [...(existing?.sourceRefs ?? []), ...refs.sourceRefs],
          ruleRefs: [...(existing?.ruleRefs ?? []), ...refs.ruleRefs],
          relatedMutationIds: existing?.relatedMutationIds ?? [],
        }),
      );
    }
  }

  if (!hasStateTransition) {
    const refs = collectCoverageRefs(
      input.coveragePlan,
      new Set(["state_transition"]),
    );
    if (refs.ruleRefs.length > 0) {
      const existing = findings.get("missing_state_transition_case");
      findings.set(
        "missing_state_transition_case",
        buildFinding({
          kind: "missing_state_transition_case",
          sourceRefs: [...(existing?.sourceRefs ?? []), ...refs.sourceRefs],
          ruleRefs: [...(existing?.ruleRefs ?? []), ...refs.ruleRefs],
          relatedMutationIds: existing?.relatedMutationIds ?? [],
        }),
      );
    }
  }

  return [...findings.values()].sort(compareFindings);
};

export const serializeAdversarialGapFindings = (
  findings: readonly AdversarialGapFinding[],
): string => canonicalJson([...findings]);

export const writeAdversarialGapFindings = async (input: {
  readonly findings: readonly AdversarialGapFinding[];
  readonly runDir: string;
}): Promise<{ artifactPath: string; serialised: string }> => {
  if (typeof input.runDir !== "string" || input.runDir.length === 0) {
    throw new TypeError(
      "writeAdversarialGapFindings: runDir must be a non-empty string",
    );
  }
  await mkdir(input.runDir, { recursive: true });
  const artifactPath = join(
    input.runDir,
    ADVERSARIAL_GAP_FINDINGS_ARTIFACT_FILENAME,
  );
  const serialised = serializeAdversarialGapFindings(input.findings);
  const tempPath = `${artifactPath}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(tempPath, serialised, { encoding: "utf8" });
  await rename(tempPath, artifactPath);
  return { artifactPath, serialised };
};

const buildFinding = (input: {
  kind: AdversarialGapFindingKind;
  sourceRefs: readonly string[];
  ruleRefs: readonly string[];
  relatedMutationIds: readonly string[];
}): AdversarialGapFinding => ({
  schemaVersion: ADVERSARIAL_GAP_FINDING_SCHEMA_VERSION,
  findingId: `gap-${input.kind}`,
  kind: input.kind,
  severity: "major",
  summary: GAP_KIND_TO_SUMMARY[input.kind],
  sourceRefs: uniqueSorted(input.sourceRefs),
  ruleRefs: uniqueSorted(input.ruleRefs),
  relatedMutationIds: uniqueSorted(input.relatedMutationIds),
  missingCaseType: GAP_KIND_TO_CASE_TYPE[input.kind],
});

const collectCoverageRefs = (
  coveragePlan: CoveragePlan | undefined,
  techniques: ReadonlySet<string>,
): { sourceRefs: string[]; ruleRefs: string[] } => {
  if (coveragePlan === undefined) {
    return { sourceRefs: [], ruleRefs: [] };
  }
  const matches = [
    ...coveragePlan.minimumCases,
    ...coveragePlan.recommendedCases,
  ].filter((requirement) => techniques.has(requirement.technique));
  return {
    sourceRefs: uniqueSorted(
      matches.flatMap((requirement) => requirement.sourceRefs),
    ),
    ruleRefs: uniqueSorted(
      matches.map((requirement) => requirement.requirementId),
    ),
  };
};

const compareFindings = (
  left: AdversarialGapFinding,
  right: AdversarialGapFinding,
): number =>
  GAP_KIND_PRIORITY[left.kind] - GAP_KIND_PRIORITY[right.kind] ||
  left.findingId.localeCompare(right.findingId) ||
  left.ruleRefs.join("\0").localeCompare(right.ruleRefs.join("\0")) ||
  left.sourceRefs.join("\0").localeCompare(right.sourceRefs.join("\0"));

const uniqueSorted = (values: Iterable<string>): string[] =>
  [...new Set(values)].sort((left, right) => left.localeCompare(right));
