/**
 * Form-screen accessibility coverage eval (Issue #1905).
 *
 * Measures, for every form screen in the Business Test Intent IR, whether
 * the candidate `GeneratedTestCaseList` contains at least one accessibility
 * test case that anchors back to the screen. The eval mirrors the WCAG 2.2
 * AA mandatory cases the policy gate enumerates as
 * `policy:form-screen-needs-accessibility-case` and adds:
 *
 *   - a per-screen `a11yCaseCoverage` count (anchored cases, not just any
 *     case of `type=accessibility`);
 *   - a hard gate that fails when any form screen has zero anchored cases;
 *   - a soft target (default 4) representing the WCAG 2.2 AA expected
 *     pillars per screen — surfaced for dashboards but **not** part of the
 *     hard gate so the suite stays achievable for the deterministic
 *     synthesiser, which produces a single composite a11y case per screen;
 *   - canonical-JSON per-screen reports persisted to
 *     `storybook-static/eval-reports/a11y-<fixture>.json` so the operator
 *     dashboard can render the same WCAG 2.2 AA pillar list the suite
 *     enforces.
 *
 * The module is pure and deterministic; identical inputs produce
 * byte-identical artifacts. No filesystem I/O outside of the explicit
 * `writeA11yCoverageEvalArtifact` writer; no LLM calls.
 *
 * Companion to:
 *   - `policy-gate.ts` (`policy:form-screen-needs-accessibility-case`)
 *   - `validation-harness.ts` (the deterministic synthesiser already emits
 *     one accessibility case per form screen by construction).
 */

import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import {
  GENERATED_TEST_CASE_SCHEMA_VERSION,
  REDACTION_POLICY_VERSION,
  TEST_INTELLIGENCE_CONTRACT_VERSION,
  TEST_INTELLIGENCE_PROMPT_TEMPLATE_VERSION,
  VISUAL_SIDECAR_SCHEMA_VERSION,
  type BusinessTestIntentIr,
  type GeneratedTestCase,
  type GeneratedTestCaseList,
} from "../contracts/index.js";
import {
  BASELINE_ARCHETYPE_FIXTURE_IDS,
  type BaselineArchetypeFixtureId,
  loadBaselineArchetypeFixture,
} from "./baseline-fixtures.js";
import { canonicalJson } from "./content-hash.js";
import { deriveBusinessTestIntentIr } from "./intent-derivation.js";
import type { IntentDerivationFigmaInput } from "./intent-derivation.js";
import { GENERATOR_FORM_SCREEN_A11Y_REPAIR_INSTRUCTION } from "./agent-role-profile.js";
import { synthesizeGeneratedTestCases } from "./validation-harness.js";

/** Schema version pinned on every persisted a11y-coverage eval artifact. */
export const A11Y_COVERAGE_EVAL_SCHEMA_VERSION = "1.0.0" as const;

/** Stable profile id used by the eval suite. */
export const A11Y_COVERAGE_EVAL_PROFILE_ID = "wcag-2.2-aa-form-screen" as const;

/** Stable, byte-stable timestamp baked into deterministic eval artifacts. */
export const A11Y_COVERAGE_EVAL_FIXTURE_GENERATED_AT =
  "2026-05-05T00:00:00.000Z" as const;

/**
 * Default minimum number of accessibility cases per form screen the eval
 * tracks as a *soft* target. The hard gate is `>= 1`; the soft target
 * surfaces the WCAG 2.2 AA pillar count so dashboards can flag screens
 * that pass the gate but only carry a single composite a11y case.
 */
export const A11Y_COVERAGE_EVAL_DEFAULT_SOFT_TARGET_PER_SCREEN = 4 as const;

/** Hard-gate threshold — every form screen MUST carry at least this many cases. */
export const A11Y_COVERAGE_EVAL_HARD_THRESHOLD_PER_SCREEN = 1 as const;

/**
 * Closed list of WCAG 2.2 AA pillars the eval surfaces per form screen.
 *
 * The list is hand-curated from WCAG 2.2 AA success criteria most directly
 * relevant to mask/form screens; it is intentionally small so the operator
 * dashboard can render the same six checkboxes the policy gate enumerates.
 * The enum is part of the persisted artifact so review tooling can
 * branch on the exact pillar without scraping freeform strings.
 */
export const A11Y_WCAG_22_AA_PILLAR_IDS = [
  "tab-order",
  "focus-indicator",
  "label-for-input",
  "error-announcements",
  "color-contrast",
  "keyboard-trap-freedom",
] as const;

export type A11yWcag22AaPillarId = (typeof A11Y_WCAG_22_AA_PILLAR_IDS)[number];

/** Human-readable description of each pillar, surfaced in artifacts and docs. */
export const A11Y_WCAG_22_AA_PILLARS: Readonly<
  Record<
    A11yWcag22AaPillarId,
    { readonly title: string; readonly successCriterion: string; readonly description: string }
  >
> = Object.freeze({
  "tab-order": Object.freeze({
    title: "Tab order is correct",
    successCriterion: "WCAG 2.4.3 Focus Order (Level A)",
    description:
      "All focusable controls are reachable in a logical order via the keyboard.",
  }),
  "focus-indicator": Object.freeze({
    title: "Focus indicator is visible",
    successCriterion: "WCAG 2.4.7 Focus Visible (Level AA) + 2.4.13 Focus Appearance",
    description:
      "Every interactive control shows a visible focus indicator, respecting prefers-reduced-motion.",
  }),
  "label-for-input": Object.freeze({
    title: "Label-for-input association",
    successCriterion: "WCAG 1.3.1 Info and Relationships (Level A) + 4.1.2 Name, Role, Value",
    description:
      "Every input field has a programmatically associated visible label.",
  }),
  "error-announcements": Object.freeze({
    title: "Error announcements for screen readers",
    successCriterion: "WCAG 3.3.1 Error Identification (Level A) + 4.1.3 Status Messages",
    description:
      "Validation errors are surfaced via aria-live so assistive tech announces them.",
  }),
  "color-contrast": Object.freeze({
    title: "Color contrast on buttons and disabled states",
    successCriterion: "WCAG 1.4.3 Contrast (Minimum) (Level AA) + 1.4.11 Non-text Contrast",
    description:
      "Form action buttons and their disabled states meet AA contrast against background.",
  }),
  "keyboard-trap-freedom": Object.freeze({
    title: "No keyboard traps",
    successCriterion: "WCAG 2.1.2 No Keyboard Trap (Level A)",
    description:
      "Focus can always be moved away from any control with the keyboard alone.",
  }),
});

/** Per-screen verdict shape returned by the eval. */
export interface A11yScreenCoverageReport {
  readonly screenId: string;
  readonly screenName: string;
  /** Number of detected input fields on the screen. Drives form-screen detection. */
  readonly fieldCount: number;
  /** Cases that satisfy `isFormScreenA11yCase` for this screen. */
  readonly a11yCaseCoverage: number;
  /** Ids of the matching cases, sorted alphabetically for byte stability. */
  readonly matchedTestCaseIds: ReadonlyArray<string>;
  /** Hard-gate verdict — `false` means the screen lacks any a11y case. */
  readonly hardGatePassed: boolean;
  /** Soft target verdict — `false` means below the per-screen target. */
  readonly softTargetPassed: boolean;
  /**
   * The WCAG 2.2 AA pillars expected for this screen. Stable, hand-curated
   * list — does NOT depend on the candidate list.
   */
  readonly expectedPillars: ReadonlyArray<A11yWcag22AaPillarId>;
}

export type A11yCoverageGateFailureReason =
  | "form_screen_missing_accessibility_case"
  | "form_screen_below_soft_target";

export interface A11yCoverageGateFailure {
  readonly reason: A11yCoverageGateFailureReason;
  readonly screenId: string;
  readonly observed: number;
  readonly threshold: number;
  /** Severity reflects whether the failure is hard (gate-blocking) or soft. */
  readonly severity: "error" | "warning";
}

export interface A11yCoverageVerdict {
  readonly passed: boolean;
  readonly failures: ReadonlyArray<A11yCoverageGateFailure>;
}

export interface A11yCoverageThresholds {
  readonly hardThresholdPerScreen: number;
  readonly softTargetPerScreen: number;
}

/** Frozen production thresholds shipped with the suite. */
export const A11Y_COVERAGE_PRODUCTION_BASELINE_THRESHOLDS: A11yCoverageThresholds =
  Object.freeze({
    hardThresholdPerScreen: A11Y_COVERAGE_EVAL_HARD_THRESHOLD_PER_SCREEN,
    softTargetPerScreen: A11Y_COVERAGE_EVAL_DEFAULT_SOFT_TARGET_PER_SCREEN,
  });

export interface A11yCoverageEvalMetrics {
  readonly formScreenCount: number;
  readonly formScreensWithCoverage: number;
  readonly formScreensMeetingSoftTarget: number;
  readonly totalA11yCases: number;
  /** `formScreensWithCoverage / formScreenCount`, 1 when no form screens exist. */
  readonly screenCoverageRatio: number;
}

export interface A11yCoverageRepairInstructionInput {
  readonly screenId: string;
}

export interface A11yCoverageRepairInstruction {
  readonly screenId: string;
  readonly testCaseId: "$job";
  readonly path: string;
  readonly instruction: string;
}

/**
 * Render the canonical repair instruction for a missing-case screen. The
 * template lives next to the generator profile so prompt-compiler and
 * judge code share one source of truth for the directive text.
 */
export const buildA11yCoverageRepairInstruction = (
  input: A11yCoverageRepairInstructionInput,
): A11yCoverageRepairInstruction => ({
  screenId: input.screenId,
  testCaseId: "$job",
  path: "qualitySignals.coveredScreenIds",
  instruction: GENERATOR_FORM_SCREEN_A11Y_REPAIR_INSTRUCTION.replace(
    "{screenId}",
    input.screenId,
  ),
});

export interface ComputeA11yCoverageInput {
  readonly intent: BusinessTestIntentIr;
  readonly generatedList: GeneratedTestCaseList;
  readonly thresholds?: A11yCoverageThresholds;
}

export interface A11yCoverageComputation {
  readonly perScreen: ReadonlyArray<A11yScreenCoverageReport>;
  readonly metrics: A11yCoverageEvalMetrics;
  readonly verdict: A11yCoverageVerdict;
  readonly thresholds: A11yCoverageThresholds;
  readonly repairInstructions: ReadonlyArray<A11yCoverageRepairInstruction>;
}

/**
 * A test case counts as a form-screen accessibility case when its `type`
 * is `accessibility` AND it carries a `figmaTraceRefs` entry pointing at
 * the target screen. We do NOT accept screen-implicit cases (every screen
 * referenced indirectly via covered field ids) because the policy gate
 * specifically requires an anchored trace to fire.
 */
export const isFormScreenA11yCase = (
  testCase: GeneratedTestCase,
  screenId: string,
): boolean => {
  if (testCase.type !== "accessibility") return false;
  for (const traceRef of testCase.figmaTraceRefs) {
    if (traceRef.screenId === screenId) return true;
  }
  return false;
};

/**
 * Pure-function eval — produces per-screen coverage, metrics, and a
 * structured verdict. Threshold object is optional; the production
 * baseline is applied when omitted.
 */
export const computeA11yCoverage = (
  input: ComputeA11yCoverageInput,
): A11yCoverageComputation => {
  const thresholds = input.thresholds ?? A11Y_COVERAGE_PRODUCTION_BASELINE_THRESHOLDS;

  const fieldsByScreen = new Map<string, number>();
  for (const field of input.intent.detectedFields) {
    fieldsByScreen.set(
      field.screenId,
      (fieldsByScreen.get(field.screenId) ?? 0) + 1,
    );
  }

  const screenNameById = new Map<string, string>();
  for (const screen of input.intent.screens) {
    screenNameById.set(screen.screenId, screen.screenName);
  }

  const formScreenIds = [...fieldsByScreen.keys()].sort();

  const perScreen: A11yScreenCoverageReport[] = [];
  const failures: A11yCoverageGateFailure[] = [];
  const repairInstructions: A11yCoverageRepairInstruction[] = [];

  let formScreensWithCoverage = 0;
  let formScreensMeetingSoftTarget = 0;
  let totalA11yCases = 0;

  for (const screenId of formScreenIds) {
    const fieldCount = fieldsByScreen.get(screenId) ?? 0;
    const matched = input.generatedList.testCases
      .filter((tc) => isFormScreenA11yCase(tc, screenId))
      .map((tc) => tc.id)
      .slice()
      .sort();
    const a11yCaseCoverage = matched.length;
    const hardGatePassed = a11yCaseCoverage >= thresholds.hardThresholdPerScreen;
    const softTargetPassed = a11yCaseCoverage >= thresholds.softTargetPerScreen;

    if (hardGatePassed) formScreensWithCoverage += 1;
    if (softTargetPassed) formScreensMeetingSoftTarget += 1;
    totalA11yCases += a11yCaseCoverage;

    perScreen.push({
      screenId,
      screenName: screenNameById.get(screenId) ?? screenId,
      fieldCount,
      a11yCaseCoverage,
      matchedTestCaseIds: matched,
      hardGatePassed,
      softTargetPassed,
      expectedPillars: A11Y_WCAG_22_AA_PILLAR_IDS,
    });

    if (!hardGatePassed) {
      failures.push({
        reason: "form_screen_missing_accessibility_case",
        screenId,
        observed: a11yCaseCoverage,
        threshold: thresholds.hardThresholdPerScreen,
        severity: "error",
      });
      repairInstructions.push(buildA11yCoverageRepairInstruction({ screenId }));
    } else if (!softTargetPassed) {
      failures.push({
        reason: "form_screen_below_soft_target",
        screenId,
        observed: a11yCaseCoverage,
        threshold: thresholds.softTargetPerScreen,
        severity: "warning",
      });
    }
  }

  const formScreenCount = formScreenIds.length;
  const metrics: A11yCoverageEvalMetrics = {
    formScreenCount,
    formScreensWithCoverage,
    formScreensMeetingSoftTarget,
    totalA11yCases,
    screenCoverageRatio:
      formScreenCount === 0
        ? 1
        : roundTo(formScreensWithCoverage / formScreenCount),
  };

  const verdict: A11yCoverageVerdict = {
    passed: failures.every((f) => f.severity !== "error"),
    failures,
  };

  return {
    perScreen,
    metrics,
    verdict,
    thresholds,
    repairInstructions,
  };
};

/** Identifier of the source the eval is exercised against. */
export type A11yCoverageEvalSourceId =
  | { readonly kind: "baseline-archetype"; readonly id: BaselineArchetypeFixtureId }
  | { readonly kind: "validation-fixture"; readonly id: string };

export interface A11yCoverageEvalArtifact {
  readonly schemaVersion: typeof A11Y_COVERAGE_EVAL_SCHEMA_VERSION;
  readonly contractVersion: typeof TEST_INTELLIGENCE_CONTRACT_VERSION;
  readonly profileId: typeof A11Y_COVERAGE_EVAL_PROFILE_ID;
  readonly generatedAt: string;
  readonly source: A11yCoverageEvalSourceId;
  readonly thresholds: A11yCoverageThresholds;
  readonly metrics: A11yCoverageEvalMetrics;
  readonly verdict: A11yCoverageVerdict;
  readonly perScreen: ReadonlyArray<A11yScreenCoverageReport>;
  readonly repairInstructions: ReadonlyArray<A11yCoverageRepairInstruction>;
  readonly methodology: {
    readonly deterministic: true;
    readonly pillarSource: "wcag-2.2-aa";
  };
}

export interface BuildA11yCoverageEvalArtifactBaselineInput {
  readonly archetypeId: BaselineArchetypeFixtureId;
  readonly generatedAt?: string;
  readonly thresholds?: A11yCoverageThresholds;
  readonly listOverride?: GeneratedTestCaseList;
}

export interface BuildA11yCoverageEvalArtifactValidationFixtureInput {
  readonly fixtureId: string;
  readonly figma: IntentDerivationFigmaInput;
  readonly generatedAt?: string;
  readonly thresholds?: A11yCoverageThresholds;
  readonly listOverride?: GeneratedTestCaseList;
}

const buildArtifact = (input: {
  source: A11yCoverageEvalSourceId;
  intent: BusinessTestIntentIr;
  list: GeneratedTestCaseList;
  generatedAt: string;
  thresholds: A11yCoverageThresholds;
}): A11yCoverageEvalArtifact => {
  const computation = computeA11yCoverage({
    intent: input.intent,
    generatedList: input.list,
    thresholds: input.thresholds,
  });
  return {
    schemaVersion: A11Y_COVERAGE_EVAL_SCHEMA_VERSION,
    contractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
    profileId: A11Y_COVERAGE_EVAL_PROFILE_ID,
    generatedAt: input.generatedAt,
    source: input.source,
    thresholds: input.thresholds,
    metrics: computation.metrics,
    verdict: computation.verdict,
    perScreen: computation.perScreen,
    repairInstructions: computation.repairInstructions,
    methodology: {
      deterministic: true,
      pillarSource: "wcag-2.2-aa",
    },
  };
};

const synthesizeForArtifact = (input: {
  jobId: string;
  intent: BusinessTestIntentIr;
  generatedAt: string;
}): GeneratedTestCaseList =>
  synthesizeGeneratedTestCases({
    jobId: input.jobId,
    generatedAt: input.generatedAt,
    intent: input.intent,
    audit: {
      jobId: input.jobId,
      generatedAt: input.generatedAt,
      contractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
      schemaVersion: GENERATED_TEST_CASE_SCHEMA_VERSION,
      promptTemplateVersion: TEST_INTELLIGENCE_PROMPT_TEMPLATE_VERSION,
      redactionPolicyVersion: REDACTION_POLICY_VERSION,
      visualSidecarSchemaVersion: VISUAL_SIDECAR_SCHEMA_VERSION,
      cacheHit: false,
      cacheKey: "a11y-coverage-eval-cache-key",
      inputHash: "a11y-coverage-eval-input-hash",
      promptHash: "a11y-coverage-eval-prompt-hash",
      schemaHash: "a11y-coverage-eval-schema-hash",
    },
  });

/**
 * Build the eval artifact for a baseline archetype fixture. When
 * `listOverride` is provided it is used verbatim; otherwise the
 * deterministic synthesiser produces the candidate list. The synthesiser
 * already emits one accessibility case per form screen, so the default
 * artifact passes the hard gate but lands below the soft target.
 */
export const buildA11yCoverageEvalArtifactForBaseline = async (
  input: BuildA11yCoverageEvalArtifactBaselineInput,
): Promise<A11yCoverageEvalArtifact> => {
  const generatedAt = input.generatedAt ?? A11Y_COVERAGE_EVAL_FIXTURE_GENERATED_AT;
  const thresholds = input.thresholds ?? A11Y_COVERAGE_PRODUCTION_BASELINE_THRESHOLDS;
  const fixture = await loadBaselineArchetypeFixture(input.archetypeId);
  const intent = deriveBusinessTestIntentIr({ figma: fixture.figma });
  const list =
    input.listOverride ??
    synthesizeForArtifact({
      jobId: `a11y-coverage-eval-${stripBaselinePrefix(input.archetypeId)}`,
      intent,
      generatedAt,
    });
  return buildArtifact({
    source: { kind: "baseline-archetype", id: input.archetypeId },
    intent,
    list,
    generatedAt,
    thresholds,
  });
};

/**
 * Build the eval artifact for a Wave 1 validation fixture or any other
 * loose Figma fixture. The caller passes the parsed Figma input directly
 * so this module does not have to know about every fixture loader.
 */
export const buildA11yCoverageEvalArtifactForValidationFixture = (
  input: BuildA11yCoverageEvalArtifactValidationFixtureInput,
): A11yCoverageEvalArtifact => {
  const generatedAt = input.generatedAt ?? A11Y_COVERAGE_EVAL_FIXTURE_GENERATED_AT;
  const thresholds = input.thresholds ?? A11Y_COVERAGE_PRODUCTION_BASELINE_THRESHOLDS;
  const intent = deriveBusinessTestIntentIr({ figma: input.figma });
  const list =
    input.listOverride ??
    synthesizeForArtifact({
      jobId: `a11y-coverage-eval-${input.fixtureId}`,
      intent,
      generatedAt,
    });
  return buildArtifact({
    source: { kind: "validation-fixture", id: input.fixtureId },
    intent,
    list,
    generatedAt,
    thresholds,
  });
};

export const buildAllBaselineA11yCoverageEvalArtifacts = (input?: {
  generatedAt?: string;
  thresholds?: A11yCoverageThresholds;
}): Promise<ReadonlyArray<A11yCoverageEvalArtifact>> =>
  Promise.all(
    BASELINE_ARCHETYPE_FIXTURE_IDS.map((archetypeId) =>
      buildA11yCoverageEvalArtifactForBaseline({
        archetypeId,
        ...(input?.generatedAt !== undefined ? { generatedAt: input.generatedAt } : {}),
        ...(input?.thresholds !== undefined ? { thresholds: input.thresholds } : {}),
      }),
    ),
  );

/** Default destination directory for per-screen JSON reports. */
export const A11Y_COVERAGE_EVAL_REPORT_DIRNAME =
  "storybook-static/eval-reports" as const;

/** Stable filename for an artifact written from an eval source. */
export const a11yCoverageEvalReportFilename = (
  source: A11yCoverageEvalSourceId,
): string => {
  const id =
    source.kind === "baseline-archetype"
      ? stripBaselinePrefix(source.id)
      : source.id;
  return `a11y-${id}.json`;
};

export interface WriteA11yCoverageEvalArtifactInput {
  readonly artifact: A11yCoverageEvalArtifact;
  /** Defaults to {@link A11Y_COVERAGE_EVAL_REPORT_DIRNAME}. */
  readonly outputDir?: string;
}

/**
 * Write the artifact atomically (temp file + rename) so concurrent eval
 * runs cannot leave a torn file on disk. The caller receives the absolute
 * output path.
 */
export const writeA11yCoverageEvalArtifact = async (
  input: WriteA11yCoverageEvalArtifactInput,
): Promise<string> => {
  const dir = input.outputDir ?? A11Y_COVERAGE_EVAL_REPORT_DIRNAME;
  const outputPath = join(
    dir,
    a11yCoverageEvalReportFilename(input.artifact.source),
  );
  await mkdir(dirname(outputPath), { recursive: true });
  const tempPath = `${outputPath}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(tempPath, canonicalJson(input.artifact), "utf8");
  await rename(tempPath, outputPath);
  return outputPath;
};

/** Convenience: round-trip an artifact from disk for golden-style tests. */
export const readA11yCoverageEvalArtifact = async (
  filePath: string,
): Promise<A11yCoverageEvalArtifact> => {
  const raw = await readFile(filePath, "utf8");
  return JSON.parse(raw) as A11yCoverageEvalArtifact;
};

/**
 * Drop the leading "baseline-" prefix used by archetype fixture ids so
 * report filenames are short and stable.
 */
const stripBaselinePrefix = (archetypeId: string): string =>
  archetypeId.replace(/^baseline-/u, "");

const roundTo = (value: number): number =>
  Math.round(value * 1_000_000) / 1_000_000;
