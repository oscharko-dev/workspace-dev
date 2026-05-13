/**
 * Per-deployment model card generator (Issue #2112).
 *
 * Discharges the EU AI Act Article 13 transparency obligation by emitting
 * a deterministic, byte-stable model card describing the eu-banking-default
 * deployment bundle: the multi-agent topology, the per-role model
 * deployments selected by the #2099 routing policy, the calibration and
 * judge-accuracy gates that bound runtime behaviour, the domain-invariant
 * catalog, and the human-oversight controls layered on top.
 *
 * The artifact ships as a paired bundle:
 *
 *   - `<profile>.model-card.json` — machine-readable, canonical JSON.
 *   - `<profile>.model-card.md`   — human-readable rendering of the same
 *                                   content (no extra facts).
 *
 * The card is derived entirely from compile-time constants — model
 * routing policy, calibration thresholds, inter-rater gate thresholds,
 * faithfulness gates, domain-invariant registry — so two builds at the
 * same commit produce byte-identical output. The CI hook in the
 * dev-quality gate regenerates the bundle and refuses any drift the
 * commit did not stamp.
 *
 * Every regulation-bound section cites a public source: routing policy →
 * digest of the canonical JSON, gate thresholds → exported constants,
 * invariants → the legal-source frame in `domain-invariant-registry.ts`,
 * provider training-data statements → curated entries with citation
 * URLs and a transcription date.
 */

import {
  EU_BANKING_DEFAULT_POLICY_PROFILE_VERSION,
  MODEL_ROUTING_ROLES,
  TEST_INTELLIGENCE_CONTRACT_VERSION,
  type ModelRoutingPolicy,
  type ModelRoutingRole,
  type ModelRoutingRoute,
  type ModelRoutingTierLabel,
} from "../contracts/index.js";
import {
  CALIBRATION_ECE_THRESHOLDS,
  CALIBRATION_HISTOGRAM_BIN_COUNT,
  CALIBRATION_MIN_SAMPLE_FLOOR,
  CALIBRATION_RISK_CATEGORIES,
} from "./calibration-metrics.js";
import { canonicalJson, sha256Hex } from "./content-hash.js";
import {
  buildActiveDatasetInvariantRegistry,
  type DomainInvariant,
} from "./domain-invariant-registry.js";
import { FAITHFULNESS_PRODUCTION_BASELINE_THRESHOLDS } from "./faithfulness-eval.js";
import {
  INTER_RATER_GATE_THRESHOLDS,
  INTER_RATER_KAPPA_HARD_FLOOR,
  INTER_RATER_KAPPA_WARN_FLOOR,
  INTER_RATER_PER_SCENARIO_GATE_MIN_PAIRS,
  INTER_RATER_REVIEWER_SHARE_HARD_CAP,
  INTER_RATER_REVIEWER_SHARE_WARN_CAP,
} from "./inter-rater-agreement.js";
import {
  EU_BANKING_DEFAULT_MODEL_ROUTING_POLICY,
  computeModelRoutingPolicyDigest,
} from "./model-routing-policy.js";
import { PROVIDER_TRAINING_DATA_STATEMENTS } from "./model-card-provider-statements.js";

/* -------------------------------------------------------------------- */
/*  Schema                                                               */
/* -------------------------------------------------------------------- */

/** Pinned schema version of the model-card artifact. */
export const MODEL_CARD_SCHEMA_VERSION = "1.0.0" as const;

/**
 * Manually-bumped `generatedAt` pin for the committed model-card
 * artefacts. Bump to the current date (UTC, midnight) whenever the
 * card's content is regenerated and re-committed; the `model-card:check`
 * gate compares on-disk artefacts against the generator output at this
 * pinned timestamp so the drift detector never fires on calendar drift
 * alone. Mirrors the `FAITHFULNESS_EVAL_FIXTURE_GENERATED_AT`
 * convention used by the faithfulness eval fixtures.
 */
export const MODEL_CARD_GENERATED_AT_PIN =
  "2026-05-09T00:00:00.000Z" as const;

/** Directory the rendered cards live under, relative to the repo root. */
export const MODEL_CARD_DOCS_DIRNAME =
  "docs/eu-ai-act/model-cards" as const;

/** Suffix applied to the JSON twin. */
export const MODEL_CARD_JSON_FILENAME_SUFFIX =
  ".model-card.json" as const;

/** Suffix applied to the human-readable markdown rendering. */
export const MODEL_CARD_MD_FILENAME_SUFFIX = ".model-card.md" as const;

/**
 * High-level capability description per agent role. Curated copy lives
 * here so the markdown rendering stays a pure projection of the JSON twin.
 */
const MODEL_ROUTING_ROLE_DESCRIPTIONS: Readonly<
  Record<ModelRoutingRole, string>
> = Object.freeze({
  test_generation:
    "Generates the candidate test-case list from the typed business intent IR. Heavy-tier reasoning model; output is constrained-decoded against the GeneratedTestCaseList JSON schema.",
  logic_judge:
    "Evaluates each generated test case against the policy gate, repair instructions, and coverage budget. Cross-family secondary slot is required for adversarial diversity (#2099).",
  coverage_planner:
    "Plans the field/action/validation coverage budget per fixture. Triage-tier light model; output bounded by deterministic post-processing.",
  risk_ranker:
    "Ranks generated cases by regulatory risk so the human-review queue surfaces highest-risk cases first. Triage-tier light model; output is a sorted list of risk scores.",
  visual_primary:
    "Multimodal inspection of rendered screens for accessibility and visual regression. Captures Figma node coverage signals fed back into faithfulness scoring.",
  visual_fallback:
    "Multimodal fallback when the primary visual model is unavailable or the route circuit-breaks. Lower latency and cost; same output schema.",
  a11y_judge:
    "Multimodal accessibility judge. Asserts WCAG / EN 301 549 properties on rendered screens for the EAA invariants (INV-EAA-KBD-01 et al.).",
  faithfulness_judge:
    "Multimodal cross-checks each generated case against the source Figma node + IR field/action graph. Cross-family fallback ensures provider-outage robustness (#2099).",
  document_ingestion:
    "Ingests customer-supplied requirements docs and Jira context into the typed multi-source envelope. Multimodal primary; heavy-tier text fallback when the multimodal route fails.",
  adversarial_critic:
    "Generates adversarial probes to lift the negative-case ratio (G-NEG-CASE) and surfaces gaps the primary judge missed (cross-family secondary required by #2099).",
  calibration_holdout_generator:
    "Synthesises the calibration gold-set holdout fixtures used by the #2107 ECE gate and the #2109 inter-rater protocol. Heavy-tier reasoning model.",
});

const TIER_LABEL_DESCRIPTIONS: Readonly<
  Record<ModelRoutingTierLabel, string>
> = Object.freeze({
  light: "Triage / low-cost reasoning",
  heavy: "High-capability reasoning",
  multimodal: "Multimodal vision + text",
});

/* -------------------------------------------------------------------- */
/*  Card content types                                                   */
/* -------------------------------------------------------------------- */

export interface ModelCardIdentity {
  /** Stable cardId, e.g. `eu-banking-default@1.0.0+routing-1.0.0`. */
  readonly cardId: string;
  readonly profileId: string;
  readonly profileVersion: string;
  readonly routingPolicyId: string;
  readonly routingPolicyVersion: string;
  /** sha256 hex digest of the canonical-JSON of the routing policy. */
  readonly routingPolicyDigest: string;
}

export interface ModelCardIntendedUse {
  readonly primaryUseCase: ReadonlyArray<string>;
  readonly intendedUsers: ReadonlyArray<string>;
  readonly operationalContext: ReadonlyArray<string>;
  readonly outOfScope: ReadonlyArray<string>;
}

export interface ModelCardArchitectureRoleSummary {
  readonly role: ModelRoutingRole;
  readonly description: string;
}

export interface ModelCardArchitecture {
  readonly topology: string;
  readonly roleSummary: ReadonlyArray<ModelCardArchitectureRoleSummary>;
  readonly safetyControls: ReadonlyArray<string>;
}

export interface ModelCardDeployment {
  readonly role: ModelRoutingRole;
  readonly slot: string;
  readonly tierLabel: ModelRoutingTierLabel;
  readonly tierDescription: string;
  readonly providerId: string;
  readonly modelId: string;
  readonly inferenceProfileId?: string;
  readonly modelRevision?: string;
  readonly gatewayRelease?: string;
  readonly region?: string;
  readonly family?: string;
  readonly ictRegisterRef?: string;
}

export interface ModelCardProviderStatement {
  /** Provider id (matches `modelBinding.providerId`). */
  readonly providerId: string;
  /**
   * Whether the statement was transcribed verbatim from the provider's
   * public documentation. `transcribed-verbatim` is the auditable case;
   * `paraphrased` and `unavailable` are flagged so auditors can see when
   * the lineage is partial.
   */
  readonly fidelity:
    | "transcribed-verbatim"
    | "paraphrased"
    | "unavailable";
  /** Public URL the statement was sourced from. */
  readonly sourceUrl: string;
  /** Date (UTC, ISO 8601 date-only) the statement was last transcribed. */
  readonly transcribedOn: string;
  /** Statement body, broken into paragraphs to keep the markdown stable. */
  readonly statement: ReadonlyArray<string>;
  /**
   * Optional mapping of model deployment ids this statement applies to,
   * scoped to providers that publish per-model statements.
   */
  readonly appliesToDeployments?: ReadonlyArray<string>;
}

export interface ModelCardTrainingDataLineage {
  readonly summary: string;
  readonly note: string;
  readonly providerStatements: ReadonlyArray<ModelCardProviderStatement>;
}

export interface ModelCardCalibrationEcEntry {
  readonly riskCategory: string;
  readonly maxExpectedCalibrationError: number;
  readonly description: string;
}

export interface ModelCardJudgeAccuracy {
  readonly kappaHardFloor: number;
  readonly kappaWarnFloor: number;
  readonly perScenarioGateMinPairs: number;
  readonly reviewerShareHardCap: number;
  readonly reviewerShareWarnCap: number;
  readonly notes: ReadonlyArray<string>;
}

export interface ModelCardFaithfulnessGate {
  readonly metric: string;
  readonly bound: "minimum" | "maximum";
  readonly threshold: number;
  readonly failureReason: string;
}

export interface ModelCardPerformance {
  readonly faithfulnessGates: ReadonlyArray<ModelCardFaithfulnessGate>;
  readonly calibrationEce: ReadonlyArray<ModelCardCalibrationEcEntry>;
  readonly calibration: {
    readonly histogramBinCount: number;
    readonly minimumSampleFloor: number;
    readonly notes: ReadonlyArray<string>;
  };
  readonly judgeAccuracy: ModelCardJudgeAccuracy;
}

export interface ModelCardLimitations {
  readonly knownFailureModes: ReadonlyArray<string>;
  readonly unsupportedLocales: ReadonlyArray<string>;
  readonly edgeCases: ReadonlyArray<string>;
}

export interface ModelCardCalibrationProvenance {
  readonly goldSetComposition: ReadonlyArray<string>;
  readonly interRaterProtocol: ReadonlyArray<string>;
  readonly reviewerRotation: ReadonlyArray<string>;
}

export interface ModelCardInvariantSummary {
  readonly invariantId: string;
  readonly scope: string;
  readonly severity: "error" | "warning";
  readonly framework?: string;
  readonly citation?: string;
  readonly url?: string;
}

export interface ModelCardDomainInvariants {
  readonly registeredCount: number;
  readonly invariantsByFramework: ReadonlyArray<{
    readonly framework: string;
    readonly count: number;
  }>;
  readonly invariants: ReadonlyArray<ModelCardInvariantSummary>;
}

export interface ModelCardUpdateCadence {
  readonly driftDetectionTriggers: ReadonlyArray<string>;
  readonly recalibrationSchedule: ReadonlyArray<string>;
}

export interface ModelCard {
  readonly schemaVersion: typeof MODEL_CARD_SCHEMA_VERSION;
  readonly contractVersion: typeof TEST_INTELLIGENCE_CONTRACT_VERSION;
  readonly generatedAt: string;
  readonly identity: ModelCardIdentity;
  readonly intendedUse: ModelCardIntendedUse;
  readonly architecture: ModelCardArchitecture;
  readonly deployments: ReadonlyArray<ModelCardDeployment>;
  readonly trainingDataLineage: ModelCardTrainingDataLineage;
  readonly performance: ModelCardPerformance;
  readonly limitations: ModelCardLimitations;
  readonly calibrationProvenance: ModelCardCalibrationProvenance;
  readonly domainInvariants: ModelCardDomainInvariants;
  readonly updateCadence: ModelCardUpdateCadence;
}

/* -------------------------------------------------------------------- */
/*  Curated copy                                                         */
/* -------------------------------------------------------------------- */

const EU_BANKING_DEFAULT_INTENDED_USE: ModelCardIntendedUse = Object.freeze({
  primaryUseCase: Object.freeze([
    "Test-case generation, evaluation, and export for regulated EU banking and insurance flows: payments, KYC/onboarding, MiFID order entry, GwG screening, IDD distribution, GDPR self-service consoles.",
    "Multi-agent QA-assistance: a deterministic harness orchestrates LLM roles to draft, critique, and triage test cases that a human reviewer ratifies before export.",
    "Compliance evidence emission: every job persists an evidence manifest, a CycloneDX 1.6 ML-BOM, an inter-rater agreement artifact, and the model card itself as auditable artifacts.",
  ]),
  intendedUsers: Object.freeze([
    "QA engineers, test architects, and compliance reviewers in EU banking, insurance, and financial-services organisations.",
    "Regulated-industry release managers integrating the export pipeline with QC/ALM (Jira, Xray, ALM Octane).",
    "Auditors verifying EU AI Act, DORA, GDPR, MiFID II, PSD2, and IDD trace-ability against generated test artefacts.",
  ]),
  operationalContext: Object.freeze([
    "Two-reviewer human-oversight gate (Issue #2109): every test case requires reviewer approval before export. Disagreements escalate to a designated arbiter.",
    "Air-gapped operation supported: no telemetry, no cloud upload of customer artefacts beyond the explicitly configured Azure AI Foundry deployments.",
    "Deterministic replay: the routing policy, prompt template version, and policy-profile id are stamped on every artifact so any reviewer can reproduce a run from the persisted evidence bundle.",
  ]),
  outOfScope: Object.freeze([
    "Autonomous decision-making about whether to release software to production. The system is QA-assistance only; release decisions remain with the operator's change-management process.",
    "Generation of executable code, deployment artefacts, runtime configuration, or production data. The output is test-case content, never executable production code.",
    "Profiling of natural persons, scoring of customers, credit decisions, employment screening, or any Annex III activity that targets a specific individual. Test cases are generated against synthetic personas only.",
    "Substitute for legal advice. The domain-invariant catalog encodes a curated subset of EU regulations; operators retain responsibility for the legal interpretation that applies to their deployment.",
    "Single-reviewer workflows. Operating the system with the inter-rater protocol disabled or with a single reviewer is unsupported and trips the calibration gate.",
  ]),
});

const EU_BANKING_DEFAULT_ARCHITECTURE_TOPOLOGY =
  "The runtime is a deterministic harness that orchestrates a fixed set of LLM-backed agent roles plus deterministic services (constrained decoding, evidence persistence, policy gating). Roles are bound to model deployments by the #2099 typed routing policy; cross-family secondary/triage slots provide provider-outage robustness on the test-generation, logic-judge, faithfulness-judge, and adversarial-critic roles. Every LLM call passes through the LLM gateway, which enforces the policy gate, redacts high-risk secrets, and stamps the call into the evidence manifest." as const;

const EU_BANKING_DEFAULT_SAFETY_CONTROLS: ReadonlyArray<string> = Object.freeze([
  "Policy gate (Issue #1364): every generated test case passes the eu-banking-default policy profile before persistence. PII, payments, and authorisation surfaces require strong review controls and a non-empty validation case.",
  "Domain-invariant gate (Issues #2040, #2108, #2110): cross-field invariants encoded against the typed test design model fire deterministic findings with severity `error` (block export) or `warning` (record only).",
  "Faithfulness gate: trace-fidelity, hallucinated-id, and field/action coverage thresholds bound the gap between IR and generated cases. A gate failure routes the job to the repair loop before reviewer hand-off.",
  "Inter-rater agreement gate (Issue #2109): two-reviewer Cohen's κ on the calibration gold set must clear the κ ≥ 0.7 hard floor. Reviewer-share is capped at 0.6 to prevent single-reviewer dominance.",
  "Workflow state-machine validator (Issue #2111): step sequences are verified for reachability against per-fixture state machines so infeasible flows are caught before export.",
  "Cache-break and compaction telemetry: any deviation from the expected prompt cache shape is logged as a structured event the post-market-monitoring runbook subscribes to.",
  "Evidence manifest + CycloneDX ML-BOM: every job emits an auditable bundle of model deployment ids, prompt template version, policy-profile digest, and per-artifact sha256 hashes.",
]);

const EU_BANKING_DEFAULT_LIMITATIONS: ModelCardLimitations = Object.freeze({
  knownFailureModes: Object.freeze([
    "Generative drift on regulatory text: when a regulation is amended after the prompt template version was pinned, the catalog may surface invariants that no longer cite the current article. The post-market monitoring runbook (docs/eu-ai-act/post-market-monitoring.md) flags this on each release.",
    "Cross-family judge disagreement: the cross-family secondary slot exists precisely because two judges from the same family can collude on a shared blind spot. When primary and secondary disagree above the divergence threshold, the gate routes the case to human adjudication rather than auto-resolving.",
    "Sparse-cell calibration: per-risk-category ECE is only gated when the bin has at least the minimum sample floor. With sample counts below the floor the gate downgrades to `warning` to avoid trapping the run on a measurement artefact.",
    "Multimodal latency tail: the multimodal primary route can exceed the per-request budget under provider-side throttling. The fallback route trips automatically; the run continues with the lower-tier judge but stamps a 'multimodal-fallback-used' property on the evidence manifest.",
    "Long-document ingestion: the document-ingestion role caps inputs at the contract-pinned token budget. Inputs exceeding the cap are truncated with a deterministic warning and the truncation is recorded on the multi-source envelope.",
  ]),
  unsupportedLocales: Object.freeze([
    "All non-EU regulatory frameworks. The domain-invariant catalog encodes EU + DACH-region rules (PSD2, MiFID II, GwG, GDPR, IDD, Solvency II, EAA, BGB references). UK FCA, US (FINRA, FFIEC, OFAC), Swiss FINMA, APAC (MAS, ASIC), and Latin-American frameworks are out of scope.",
    "Right-to-left scripts. UI fixtures and prompt templates assume left-to-right text direction; Arabic and Hebrew flows are not exercised.",
    "Languages outside the curated set (English, German). Other EU languages (French, Italian, Spanish, Dutch, Polish, …) are not represented in the calibration gold set and therefore cannot be claimed to meet the inter-rater κ floor in those locales.",
  ]),
  edgeCases: Object.freeze([
    "Synthesised field-level cases on onboarding screens that pull `s-onboarding-account` into the case text: the catalog scopes regulated invariants by risk category to avoid spurious firings on these stubs (see `domain-invariant-registry.ts` rationale).",
    "Documents pasted into Jira with embedded HTML/MathML payloads: the untrusted-content normaliser strips and canonicalises the input before ingestion. Malformed canonicalisation surfaces as a multi-source reconciliation conflict the human reviewer ratifies.",
    "Fixtures whose Figma nodes have been renamed mid-run: trace-fidelity drops sharply; the gate fails closed and the run is routed to the repair loop rather than auto-completing on a partial trace.",
    "Calibration gold-set drift: when the gold set is updated, the inter-rater protocol re-runs end-to-end and the model card regenerates so the calibration provenance section reflects the new gold-set composition.",
  ]),
});

const EU_BANKING_DEFAULT_CALIBRATION_PROVENANCE: ModelCardCalibrationProvenance =
  Object.freeze({
    goldSetComposition: Object.freeze([
      "Gold-set fixtures span happy-path, adversarial, and edge scenarios for both the logic judge and the faithfulness judge (`judge-calibration-eval.ts`).",
      "Each fixture carries a paired rating from two distinct reviewers; disagreements are recorded with the arbiter assignment and the adjudicated verdict.",
      "Risk-category coverage spans all five categories the calibration ECE gate requires (low, medium, high, regulated_data, financial_transaction) so the per-class ECE diagnostics are not synthetic.",
      "Fixture provenance is stamped on the calibration artifact's `generatedAt` timestamp; the gold set is regenerated whenever the prompt template version bumps or the policy profile changes.",
    ]),
    interRaterProtocol: Object.freeze([
      "Cohen's κ is computed per judge across all paired ratings (overall) and per-(judge, scenario kind). The per-scenario gate is only enforced when the cell has at least the per-scenario minimum paired-rating count; below the floor the gate downgrades to a warning to avoid measurement-artefact failures.",
      "κ < 0.7 (hard floor) fails the gate; κ < 0.8 (warn floor) raises a warning recorded on the calibration artifact but does not block release. Both thresholds are exported constants and pinned by `dev-quality-gate` regression tests.",
      "Agreement is rated on the verdict alphabet `accept | repair | reject`. The vacuous-truth empty case returns κ = 1 with `degenerate: true` so an empty cell is composable rather than silently failing the gate.",
    ]),
    reviewerRotation: Object.freeze([
      "Per-judge reviewer assignments are tracked across the gold set; no single reviewer may exceed the hard cap on assignment share. Above the warn cap the rotation report raises a warning so reviewer-bias is surfaced before the share saturates.",
      "Arbiter assignments (`buildArbiterAssignmentFromFixture`) are recorded as a separate counter so the reviewer pool's adjudication load is visible alongside the primary-rating load.",
      "Distinct-reviewer count is reported per judge; falling below two distinct reviewers fails the gate with `missing_paired_ratings`.",
    ]),
  });

const EU_BANKING_DEFAULT_UPDATE_CADENCE: ModelCardUpdateCadence = Object.freeze({
  driftDetectionTriggers: Object.freeze([
    "Drift canary nightly job (`test-intelligence-drift-canary.yml`) re-runs the production-baseline fixtures and compares against the persisted golden artefacts. Any divergence above the canary threshold opens a high-priority issue.",
    "Live smoke job (`test-intelligence-live-e2e.yml`) exercises the gateway against the configured Azure AI Foundry deployments and surfaces provider-side regressions before they reach production runs.",
    "Cache-break events log: structural deviations in the prompt cache shape are streamed to the cache-break events log; sustained breakage above the warn threshold raises a calibration-refresh ticket.",
    "Domain-invariant catalog test suite asserts the legal-source frame on each invariant; a citation that no longer resolves to the cited article fails the test and forces a model-card regeneration.",
  ]),
  recalibrationSchedule: Object.freeze([
    "Quarterly: full re-run of the inter-rater protocol on a freshly sampled gold set. The κ trend is recorded on the calibration artifact and the model card regenerates as part of the release-gate.",
    "On prompt-template version bump (`TEST_INTELLIGENCE_PROMPT_TEMPLATE_VERSION`): the calibration holdout regenerates and the per-class ECE thresholds are re-validated before the release-gate signs off.",
    "On routing-policy version bump (`MODEL_ROUTING_POLICY_SCHEMA_VERSION` or `policyVersion`): the model card regenerates so the routing-policy digest reflects the new policy and the per-role deployment table stays current.",
    "On contract-version bump (`TEST_INTELLIGENCE_CONTRACT_VERSION`): every persisted artifact is re-emitted to track the schema evolution; the model card carries the contract version on its envelope so auditors can correlate.",
  ]),
});

/* -------------------------------------------------------------------- */
/*  Builders                                                             */
/* -------------------------------------------------------------------- */

const ISO_8601_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;

const ISO_8601_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const compareString = (left: string, right: string): number =>
  left.localeCompare(right, "en");

const buildArchitecture = (): ModelCardArchitecture =>
  Object.freeze({
    topology: EU_BANKING_DEFAULT_ARCHITECTURE_TOPOLOGY,
    roleSummary: Object.freeze(
      [...MODEL_ROUTING_ROLES]
        .sort(compareString)
        .map((role) =>
          Object.freeze({
            role,
            description: MODEL_ROUTING_ROLE_DESCRIPTIONS[role],
          }),
        ),
    ),
    safetyControls: EU_BANKING_DEFAULT_SAFETY_CONTROLS,
  });

const compareDeployment = (
  left: ModelCardDeployment,
  right: ModelCardDeployment,
): number =>
  compareString(left.role, right.role) ||
  compareString(left.slot, right.slot) ||
  compareString(left.tierLabel, right.tierLabel);

const buildDeployment = (route: ModelRoutingRoute): ModelCardDeployment => {
  const binding = route.modelBinding;
  return Object.freeze({
    role: route.role,
    slot: route.slot,
    tierLabel: route.tierLabel,
    tierDescription: TIER_LABEL_DESCRIPTIONS[route.tierLabel],
    providerId: binding.providerId,
    modelId: binding.modelId,
    ...(binding.inferenceProfileId !== undefined
      ? { inferenceProfileId: binding.inferenceProfileId }
      : {}),
    ...(route.modelRevision !== undefined
      ? { modelRevision: route.modelRevision }
      : {}),
    ...(route.gatewayRelease !== undefined
      ? { gatewayRelease: route.gatewayRelease }
      : {}),
    ...(binding.region !== undefined ? { region: binding.region } : {}),
    ...(binding.family !== undefined ? { family: binding.family } : {}),
    ...(binding.ictRegisterRef !== undefined
      ? { ictRegisterRef: binding.ictRegisterRef }
      : {}),
  });
};

const buildDeployments = (
  policy: ModelRoutingPolicy,
): ReadonlyArray<ModelCardDeployment> =>
  Object.freeze(
    policy.routes.map(buildDeployment).sort(compareDeployment),
  );

const RISK_CATEGORY_DESCRIPTIONS: Readonly<Record<string, string>> =
  Object.freeze({
    low: "Non-regulated, non-PII surfaces (e.g. marketing landing screens). Generous ECE budget.",
    medium: "Generic transactional surfaces without regulated-data exposure. Generous ECE budget.",
    high: "Sensitive but non-financial flows (e.g. multi-step onboarding without payment). Generous ECE budget.",
    regulated_data: "Special-category personal data (GDPR Art. 9). Tightened ECE budget.",
    financial_transaction: "Payments, securities orders, AML thresholds. Tightest ECE budget.",
  });

const buildPerformance = (): ModelCardPerformance => {
  const faithfulnessGates: ReadonlyArray<ModelCardFaithfulnessGate> =
    Object.freeze([
      Object.freeze({
        metric: "fieldCoverageRatio",
        bound: "minimum",
        threshold: FAITHFULNESS_PRODUCTION_BASELINE_THRESHOLDS.fieldCoverageRatio,
        failureReason: "field_coverage_below_threshold",
      }),
      Object.freeze({
        metric: "actionCoverageRatio",
        bound: "minimum",
        threshold: FAITHFULNESS_PRODUCTION_BASELINE_THRESHOLDS.actionCoverageRatio,
        failureReason: "action_coverage_below_threshold",
      }),
      Object.freeze({
        metric: "traceFidelityScore",
        bound: "minimum",
        threshold: FAITHFULNESS_PRODUCTION_BASELINE_THRESHOLDS.traceFidelityScore,
        failureReason: "trace_fidelity_below_threshold",
      }),
      Object.freeze({
        metric: "hallucinatedIdRate",
        bound: "maximum",
        threshold: FAITHFULNESS_PRODUCTION_BASELINE_THRESHOLDS.hallucinatedIdRate,
        failureReason: "hallucinated_id_above_threshold",
      }),
    ]);

  const calibrationEce: ReadonlyArray<ModelCardCalibrationEcEntry> =
    Object.freeze(
      [...CALIBRATION_RISK_CATEGORIES]
        .sort(compareString)
        .map((riskCategory) =>
          Object.freeze({
            riskCategory,
            maxExpectedCalibrationError: CALIBRATION_ECE_THRESHOLDS[riskCategory],
            description:
              RISK_CATEGORY_DESCRIPTIONS[riskCategory] ??
              "(no description provided)",
          }),
        ),
    );

  const judgeAccuracy: ModelCardJudgeAccuracy = Object.freeze({
    kappaHardFloor: INTER_RATER_GATE_THRESHOLDS.kappaHardFloor,
    kappaWarnFloor: INTER_RATER_GATE_THRESHOLDS.kappaWarnFloor,
    perScenarioGateMinPairs:
      INTER_RATER_GATE_THRESHOLDS.perScenarioGateMinPairs,
    reviewerShareHardCap: INTER_RATER_GATE_THRESHOLDS.reviewerShareHardCap,
    reviewerShareWarnCap: INTER_RATER_GATE_THRESHOLDS.reviewerShareWarnCap,
    notes: Object.freeze([
      `κ < ${INTER_RATER_KAPPA_HARD_FLOOR} fails the gate; κ < ${INTER_RATER_KAPPA_WARN_FLOOR} raises a warning.`,
      `Per-scenario κ is enforced only when the cell carries ≥ ${INTER_RATER_PER_SCENARIO_GATE_MIN_PAIRS} paired ratings; below this threshold the gate emits a warning instead of a failure.`,
      `Reviewer share > ${INTER_RATER_REVIEWER_SHARE_HARD_CAP} fails; > ${INTER_RATER_REVIEWER_SHARE_WARN_CAP} warns. Both thresholds are exported constants pinned by regression tests.`,
    ]),
  });

  return Object.freeze({
    faithfulnessGates,
    calibrationEce,
    calibration: Object.freeze({
      histogramBinCount: CALIBRATION_HISTOGRAM_BIN_COUNT,
      minimumSampleFloor: CALIBRATION_MIN_SAMPLE_FLOOR,
      notes: Object.freeze([
        `Reliability diagrams use ${CALIBRATION_HISTOGRAM_BIN_COUNT} equal-width confidence bins on [0, 1].`,
        `The plug-in ECE is reported alongside a debiased ECE that subtracts the expected absolute calibration gap under the binomial null per bin.`,
        `Per-class ECE diagnostics require at least ${CALIBRATION_MIN_SAMPLE_FLOOR} samples in the cell before the gate is enforced.`,
      ]),
    }),
    judgeAccuracy,
  });
};

const buildDomainInvariants = (
  invariants: ReadonlyArray<DomainInvariant>,
): ModelCardDomainInvariants => {
  const summaries = [...invariants]
    .map((inv) => {
      const summary: ModelCardInvariantSummary = Object.freeze({
        invariantId: inv.id,
        scope: inv.scope,
        severity: inv.severity,
        ...(inv.legalSource?.framework !== undefined
          ? { framework: inv.legalSource.framework }
          : {}),
        ...(inv.legalSource?.citation !== undefined
          ? { citation: inv.legalSource.citation }
          : {}),
        ...(inv.legalSource?.url !== undefined
          ? { url: inv.legalSource.url }
          : {}),
      });
      return summary;
    })
    .sort((left, right) => compareString(left.invariantId, right.invariantId));

  const counts = new Map<string, number>();
  for (const inv of invariants) {
    const key = inv.legalSource?.framework ?? "(uncited)";
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const invariantsByFramework = [...counts.entries()]
    .map(([framework, count]) => Object.freeze({ framework, count }))
    .sort((left, right) => compareString(left.framework, right.framework));

  return Object.freeze({
    registeredCount: invariants.length,
    invariantsByFramework: Object.freeze(invariantsByFramework),
    invariants: Object.freeze(summaries),
  });
};

const validateProviderStatement = (
  statement: ModelCardProviderStatement,
): void => {
  if (typeof statement.providerId !== "string" || statement.providerId.length === 0) {
    throw new Error(
      "model-card: provider statement must declare a non-empty providerId",
    );
  }
  const fidelity = statement.fidelity as string;
  if (
    fidelity !== "transcribed-verbatim" &&
    fidelity !== "paraphrased" &&
    fidelity !== "unavailable"
  ) {
    throw new Error(
      `model-card: provider statement for "${statement.providerId}" has unknown fidelity "${fidelity}"`,
    );
  }
  if (
    typeof statement.transcribedOn !== "string" ||
    !ISO_8601_DATE_PATTERN.test(statement.transcribedOn)
  ) {
    throw new Error(
      `model-card: provider statement for "${statement.providerId}" must declare a YYYY-MM-DD transcribedOn date`,
    );
  }
};

const buildTrainingDataLineage = (): ModelCardTrainingDataLineage => {
  const sorted = [...PROVIDER_TRAINING_DATA_STATEMENTS].sort(
    (left, right) => compareString(left.providerId, right.providerId),
  );
  for (const statement of sorted) {
    validateProviderStatement(statement);
  }
  return Object.freeze({
    summary:
      "Training-data lineage is sourced from the LLM provider's published statements (Microsoft Azure / Mistral / OpenAI) at the transcription dates listed below. workspace-dev does not retrain or fine-tune any of the bound models; deployments are consumed read-only via Azure AI Foundry.",
    note: "Provider statements are transcribed verbatim where the provider publishes a fixed-form statement (`fidelity: transcribed-verbatim`); they are paraphrased only when the original is structured prose without a quotable summary (`fidelity: paraphrased`). When the provider publishes no statement covering the deployment, the entry is recorded as `unavailable` so auditors can see the gap rather than infer a guarantee that does not exist.",
    providerStatements: Object.freeze(sorted),
  });
};

export interface BuildModelCardInput {
  /**
   * Generation timestamp; defaults to the routing policy's policyVersion-
   * derived deterministic timestamp if not provided. Must be ISO 8601.
   * The CI generator passes a fixed timestamp so the artifact stays
   * byte-stable across runs at the same commit.
   */
  readonly generatedAt: string;
  /**
   * Routing policy to derive the deployments from. Defaults to the
   * eu-banking-default policy.
   */
  readonly routingPolicy?: ModelRoutingPolicy;
  /**
   * Optional override of the policy-profile version stamp. Defaults to
   * `EU_BANKING_DEFAULT_POLICY_PROFILE_VERSION`. Useful when the card is
   * being built for a derived profile.
   */
  readonly profileVersion?: string;
}

/**
 * Build a deterministic, byte-stable model card for the eu-banking-default
 * deployment bundle. The card is sourced entirely from compile-time
 * constants and the routing policy passed in (defaults to the
 * eu-banking-default policy); identical inputs at the same commit always
 * yield identical bytes.
 */
export const buildModelCard = (input: BuildModelCardInput): ModelCard => {
  if (
    typeof input.generatedAt !== "string" ||
    !ISO_8601_PATTERN.test(input.generatedAt)
  ) {
    throw new TypeError("buildModelCard: generatedAt must be ISO-8601");
  }
  const routingPolicy =
    input.routingPolicy ?? EU_BANKING_DEFAULT_MODEL_ROUTING_POLICY;
  const profileVersion =
    input.profileVersion ?? EU_BANKING_DEFAULT_POLICY_PROFILE_VERSION;

  const routingPolicyDigest = computeModelRoutingPolicyDigest(routingPolicy);
  const cardId = `${routingPolicy.policyProfileId}@${profileVersion}+routing-${routingPolicy.policyVersion}`;

  const registry = buildActiveDatasetInvariantRegistry();
  const invariants = registry.list();

  const card: ModelCard = {
    schemaVersion: MODEL_CARD_SCHEMA_VERSION,
    contractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
    generatedAt: input.generatedAt,
    identity: Object.freeze({
      cardId,
      profileId: routingPolicy.policyProfileId,
      profileVersion,
      routingPolicyId: routingPolicy.policyId,
      routingPolicyVersion: routingPolicy.policyVersion,
      routingPolicyDigest,
    }),
    intendedUse: EU_BANKING_DEFAULT_INTENDED_USE,
    architecture: buildArchitecture(),
    deployments: buildDeployments(routingPolicy),
    trainingDataLineage: buildTrainingDataLineage(),
    performance: buildPerformance(),
    limitations: EU_BANKING_DEFAULT_LIMITATIONS,
    calibrationProvenance: EU_BANKING_DEFAULT_CALIBRATION_PROVENANCE,
    domainInvariants: buildDomainInvariants(invariants),
    updateCadence: EU_BANKING_DEFAULT_UPDATE_CADENCE,
  };
  return Object.freeze(card);
};

/* -------------------------------------------------------------------- */
/*  Validators                                                           */
/* -------------------------------------------------------------------- */

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isStringArray = (value: unknown): value is ReadonlyArray<string> =>
  Array.isArray(value) && value.every((item) => typeof item === "string");

/**
 * Hand-rolled structural validator. The eu-banking-default profile
 * requires every section to be present and non-empty; we hard-check both
 * shape and the invariants the renderer relies on.
 */
export const isModelCard = (value: unknown): value is ModelCard => {
  if (!isRecord(value)) return false;
  if (
    value["schemaVersion"] !== MODEL_CARD_SCHEMA_VERSION ||
    value["contractVersion"] !== TEST_INTELLIGENCE_CONTRACT_VERSION ||
    typeof value["generatedAt"] !== "string" ||
    !ISO_8601_PATTERN.test(value["generatedAt"])
  ) {
    return false;
  }
  const identity = value["identity"];
  if (
    !isRecord(identity) ||
    typeof identity["cardId"] !== "string" ||
    typeof identity["profileId"] !== "string" ||
    typeof identity["profileVersion"] !== "string" ||
    typeof identity["routingPolicyId"] !== "string" ||
    typeof identity["routingPolicyVersion"] !== "string" ||
    typeof identity["routingPolicyDigest"] !== "string" ||
    !/^[0-9a-f]{64}$/.test(identity["routingPolicyDigest"])
  ) {
    return false;
  }
  const intended = value["intendedUse"];
  if (
    !isRecord(intended) ||
    !isStringArray(intended["primaryUseCase"]) ||
    !isStringArray(intended["intendedUsers"]) ||
    !isStringArray(intended["operationalContext"]) ||
    !isStringArray(intended["outOfScope"])
  ) {
    return false;
  }
  if (
    !Array.isArray(value["deployments"]) ||
    (value["deployments"] as readonly unknown[]).length === 0
  ) {
    return false;
  }
  return true;
};

/* -------------------------------------------------------------------- */
/*  Markdown rendering                                                   */
/* -------------------------------------------------------------------- */

const escapeMarkdownTableCell = (value: string): string =>
  value.replace(/\\/gu, "\\\\").replace(/\|/gu, "\\|").replace(/\r?\n/gu, " ");

const renderList = (items: ReadonlyArray<string>): string =>
  items.map((item) => `- ${item}`).join("\n");

const renderDeploymentTable = (
  deployments: ReadonlyArray<ModelCardDeployment>,
): string => {
  const header =
    "| Role | Slot | Tier | Provider | Model deployment | Region | Revision | Gateway release |";
  const separator = "| --- | --- | --- | --- | --- | --- | --- | --- |";
  const rows = deployments.map((d) =>
    [
      d.role,
      d.slot,
      d.tierLabel,
      d.providerId,
      d.modelId,
      d.region ?? "—",
      d.modelRevision ?? "—",
      d.gatewayRelease ?? "—",
    ]
      .map(escapeMarkdownTableCell)
      .reduce(
        (line, cell) => `${line} ${cell} |`,
        "|",
      ),
  );
  return [header, separator, ...rows].join("\n");
};

const renderInvariantTable = (
  invariants: ReadonlyArray<ModelCardInvariantSummary>,
): string => {
  const header =
    "| Invariant | Severity | Framework | Citation |";
  const separator = "| --- | --- | --- | --- |";
  const rows = invariants.map((inv) =>
    [
      inv.invariantId,
      inv.severity,
      inv.framework ?? "—",
      inv.url !== undefined && inv.citation !== undefined
        ? `[${inv.citation}](${inv.url})`
        : inv.citation ?? "—",
    ]
      .map(escapeMarkdownTableCell)
      .reduce((line, cell) => `${line} ${cell} |`, "|"),
  );
  return [header, separator, ...rows].join("\n");
};

const renderInvariantCounts = (
  counts: ReadonlyArray<{ readonly framework: string; readonly count: number }>,
): string => {
  const header = "| Framework | Invariants |";
  const separator = "| --- | --- |";
  const rows = counts.map(
    (entry) => `| ${escapeMarkdownTableCell(entry.framework)} | ${entry.count} |`,
  );
  return [header, separator, ...rows].join("\n");
};

const renderEceTable = (
  rows: ReadonlyArray<ModelCardCalibrationEcEntry>,
): string => {
  const header = "| Risk category | Max ECE | Description |";
  const separator = "| --- | --- | --- |";
  const body = rows.map(
    (row) =>
      `| ${escapeMarkdownTableCell(row.riskCategory)} | ${row.maxExpectedCalibrationError} | ${escapeMarkdownTableCell(row.description)} |`,
  );
  return [header, separator, ...body].join("\n");
};

const renderFaithfulnessTable = (
  rows: ReadonlyArray<ModelCardFaithfulnessGate>,
): string => {
  const header = "| Metric | Bound | Threshold | Failure reason |";
  const separator = "| --- | --- | --- | --- |";
  const body = rows.map(
    (row) =>
      `| ${row.metric} | ${row.bound} | ${row.threshold} | ${row.failureReason} |`,
  );
  return [header, separator, ...body].join("\n");
};

const renderProviderStatement = (
  statement: ModelCardProviderStatement,
): string => {
  const header = `### ${statement.providerId} (${statement.fidelity}, transcribed ${statement.transcribedOn})`;
  const sourceLine = `Source: <${statement.sourceUrl}>`;
  const appliesTo =
    statement.appliesToDeployments !== undefined &&
    statement.appliesToDeployments.length > 0
      ? `Applies to: ${statement.appliesToDeployments.join(", ")}`
      : undefined;
  const body = statement.statement.join("\n\n");
  return [header, sourceLine, ...(appliesTo !== undefined ? [appliesTo] : []), "", body].join("\n");
};

/**
 * Render the markdown view of a model card. The output is deterministic:
 * identical input always produces identical bytes, including a trailing
 * newline so `git diff` shows clean hunks.
 */
export const renderModelCardMarkdown = (card: ModelCard): string => {
  const sections: string[] = [];

  sections.push(`# Model card — ${card.identity.cardId}`);
  sections.push(
    [
      `**Profile:** \`${card.identity.profileId}\` (version \`${card.identity.profileVersion}\`)`,
      `**Routing policy:** \`${card.identity.routingPolicyId}\` version \`${card.identity.routingPolicyVersion}\` (digest \`${card.identity.routingPolicyDigest}\`)`,
      `**Schema:** \`${card.schemaVersion}\` · **Contract:** \`${card.contractVersion}\``,
      `**Generated at:** ${card.generatedAt}`,
      "",
      "This document discharges the EU AI Act Article 13 transparency obligation for the workspace-dev test-intelligence deployment bundle. It is auto-generated by `scripts/generate-model-card.ts` and verified for drift on every PR; do not edit by hand.",
    ].join("\n"),
  );

  sections.push("## 1. Intended use");
  sections.push("### Primary use cases");
  sections.push(renderList(card.intendedUse.primaryUseCase));
  sections.push("### Intended users");
  sections.push(renderList(card.intendedUse.intendedUsers));
  sections.push("### Operational context");
  sections.push(renderList(card.intendedUse.operationalContext));
  sections.push("### Out of scope");
  sections.push(renderList(card.intendedUse.outOfScope));

  sections.push("## 2. System architecture");
  sections.push(card.architecture.topology);
  sections.push("### Roles");
  sections.push(
    card.architecture.roleSummary
      .map((entry) => `- **${entry.role}** — ${entry.description}`)
      .join("\n"),
  );
  sections.push("### Safety controls");
  sections.push(renderList(card.architecture.safetyControls));

  sections.push("## 3. Per-role model deployments");
  sections.push(renderDeploymentTable(card.deployments));

  sections.push("## 4. Training data lineage");
  sections.push(card.trainingDataLineage.summary);
  sections.push(card.trainingDataLineage.note);
  for (const statement of card.trainingDataLineage.providerStatements) {
    sections.push(renderProviderStatement(statement));
  }

  sections.push("## 5. Performance");
  sections.push("### 5.1 Faithfulness gates");
  sections.push(renderFaithfulnessTable(card.performance.faithfulnessGates));
  sections.push("### 5.2 Calibration (ECE per risk class)");
  sections.push(renderEceTable(card.performance.calibrationEce));
  sections.push(renderList(card.performance.calibration.notes));
  sections.push("### 5.3 Judge accuracy (inter-rater κ)");
  const judge = card.performance.judgeAccuracy;
  sections.push(
    [
      `- **κ hard floor:** ${judge.kappaHardFloor}`,
      `- **κ warn floor:** ${judge.kappaWarnFloor}`,
      `- **Per-scenario gate min paired ratings:** ${judge.perScenarioGateMinPairs}`,
      `- **Reviewer share hard cap:** ${judge.reviewerShareHardCap}`,
      `- **Reviewer share warn cap:** ${judge.reviewerShareWarnCap}`,
    ].join("\n"),
  );
  sections.push(renderList(judge.notes));

  sections.push("## 6. Limitations");
  sections.push("### Known failure modes");
  sections.push(renderList(card.limitations.knownFailureModes));
  sections.push("### Unsupported locales");
  sections.push(renderList(card.limitations.unsupportedLocales));
  sections.push("### Edge cases");
  sections.push(renderList(card.limitations.edgeCases));

  sections.push("## 7. Calibration provenance");
  sections.push("### Gold-set composition");
  sections.push(renderList(card.calibrationProvenance.goldSetComposition));
  sections.push("### Inter-rater protocol");
  sections.push(renderList(card.calibrationProvenance.interRaterProtocol));
  sections.push("### Reviewer rotation");
  sections.push(renderList(card.calibrationProvenance.reviewerRotation));

  sections.push("## 8. Domain-invariant catalog");
  sections.push(
    `${card.domainInvariants.registeredCount} invariants are registered on the eu-banking-default profile.`,
  );
  sections.push(renderInvariantCounts(card.domainInvariants.invariantsByFramework));
  sections.push(renderInvariantTable(card.domainInvariants.invariants));

  sections.push("## 9. Update cadence");
  sections.push("### Drift-detection triggers");
  sections.push(renderList(card.updateCadence.driftDetectionTriggers));
  sections.push("### Re-calibration schedule");
  sections.push(renderList(card.updateCadence.recalibrationSchedule));

  return `${sections.join("\n\n")}\n`;
};

/**
 * Serialize a model card to canonical JSON with a trailing newline. The
 * canonical-JSON form sorts every object key, so two cards built at the
 * same commit produce byte-identical bytes.
 */
export const serializeModelCard = (card: ModelCard): string =>
  `${canonicalJson(card)}\n`;

/**
 * Compute the sha256 digest of the canonical JSON form of the card.
 * Useful for evidence manifests that want to pin the card without
 * re-reading the file.
 */
export const computeModelCardDigest = (card: ModelCard): string =>
  sha256Hex(card);
