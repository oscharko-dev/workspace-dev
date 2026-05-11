/**
 * Import Quality Score — Issue #993.
 *
 * Derives a Pre-flight Quality Score for a paste import from already-available
 * pipeline state: DesignIR, figma analysis diagnostics, component manifest,
 * pipeline errors. Score components are structural, semantic, and codegen-risk.
 *
 * The score is intentionally simple and deterministic so it can be rendered in
 * the inspector without extra network calls. Node-level "risk tags" surface
 * accessibility and interaction-heavy components for priority review.
 */

import type {
  ResolvedWorkspaceQualityPolicy,
  WorkspaceQualityPolicy,
} from "./workspace-policy";

// ---------------------------------------------------------------------------
// Minimal, UI-side DesignIR shape (kept local to avoid pulling in server types)
// ---------------------------------------------------------------------------

export interface QualityScoreElementInput {
  id: string;
  name: string;
  type: string;
  semanticType?: string;
  semanticSource?: string;
  validationType?: string;
  onClick?: unknown;
  onSubmit?: unknown;
  ariaLabel?: string;
  role?: string;
  children?: QualityScoreElementInput[];
  /**
   * Arbitrary IR fields — allows passing-through unknown hints without the
   * input contract breaking when the IR evolves.
   */
  [key: string]: unknown;
}

export interface QualityScoreScreenInput {
  id: string;
  name: string;
  children: QualityScoreElementInput[];
}

export interface QualityScoreDiagnosticInput {
  /** One of "error" | "warning" | "info" (case-insensitive). */
  severity?: string | undefined;
  sourceNodeId?: string | undefined;
  code?: string | undefined;
}

export interface QualityScoreManifestComponentInput {
  irNodeId: string;
}

export interface QualityScoreManifestScreenInput {
  components: QualityScoreManifestComponentInput[];
}

export interface QualityScoreManifestInput {
  screens: QualityScoreManifestScreenInput[];
}

export interface QualityScorePipelineErrorInput {
  stage?: string | undefined;
  code?: string | undefined;
}

export interface DeriveQualityScoreInput {
  screens: QualityScoreScreenInput[];
  diagnostics?: QualityScoreDiagnosticInput[];
  manifest?: QualityScoreManifestInput | null;
  errors?: QualityScorePipelineErrorInput[];
  policy?: WorkspaceQualityPolicy;
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

export type QualityScoreBand = "excellent" | "good" | "fair" | "poor";

export type QualityRiskSeverity = "high" | "medium" | "low";

export type QualityRiskCategory =
  | "structural"
  | "semantic"
  | "codegen"
  | "accessibility"
  | "interaction";

export interface QualityRiskTag {
  id: string;
  category: QualityRiskCategory;
  severity: QualityRiskSeverity;
  label: string;
  detail: string;
  nodeId?: string;
  nodeName?: string;
}

export interface QualityScoreBreakdown {
  structure: number;
  semantic: number;
  codegen: number;
}

export interface QualityScoreResult {
  score: number;
  band: QualityScoreBand;
  breakdown: QualityScoreBreakdown;
  risks: QualityRiskTag[];
  summary: {
    totalNodes: number;
    maxDepth: number;
    unmappedNodes: number;
    interactiveWithoutSemantics: number;
    diagnosticsBySeverity: { error: number; warning: number; info: number };
  };
  policyApplied: boolean;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_POLICY: ResolvedWorkspaceQualityPolicy = {
  bandThresholds: { excellent: 85, good: 70, fair: 50 },
  weights: { structure: 0.35, semantic: 0.4, codegen: 0.25 },
  maxAcceptableDepth: 6,
  maxAcceptableNodes: 120,
  riskSeverityOverrides: {},
};

const SEMANTIC_INTERACTIVE_TYPES = new Set([
  "Button",
  "Link",
  "Anchor",
  "Checkbox",
  "Radio",
  "Switch",
  "Select",
  "Input",
  "TextField",
  "Textarea",
  "Tab",
  "MenuItem",
]);

// ---------------------------------------------------------------------------
// Derivation
// ---------------------------------------------------------------------------

export function deriveQualityScore(
  input: DeriveQualityScoreInput,
): QualityScoreResult {
  const policy = resolvePolicy(input.policy);
  const flatNodes = flattenElements(input.screens);
  const maxDepth = computeMaxDepth(input.screens);
  const totalNodes = flatNodes.length;

  const diagnosticsBySeverity = countDiagnosticsBySeverity(
    input.diagnostics ?? [],
  );
  const unmappedNodes = countUnmappedNodes(flatNodes, input.manifest ?? null);
  const interactiveWithoutSemantics = flatNodes.filter(
    isInteractiveWithoutSemantics,
  ).length;

  const risks: QualityRiskTag[] = [];
  const structureScore = computeStructureScore({
    totalNodes,
    maxDepth,
    policy,
    risks,
  });
  const semanticScore = computeSemanticScore({
    flatNodes,
    interactiveWithoutSemantics,
    risks,
    policy,
  });
  const codegenScore = computeCodegenScore({
    diagnosticsBySeverity,
    unmappedNodes,
    totalNodes,
    errors: input.errors ?? [],
    risks,
  });

  const weightedScore =
    totalNodes === 0
      ? 0
      : clampScore(
          structureScore * policy.weights.structure +
            semanticScore * policy.weights.semantic +
            codegenScore * policy.weights.codegen,
        );

  return {
    score: Math.round(weightedScore),
    band: bandFor(weightedScore, policy.bandThresholds),
    breakdown: {
      structure: Math.round(structureScore),
      semantic: Math.round(semanticScore),
      codegen: Math.round(codegenScore),
    },
    risks: sortRisks(risks),
    summary: {
      totalNodes,
      maxDepth,
      unmappedNodes,
      interactiveWithoutSemantics,
      diagnosticsBySeverity,
    },
    policyApplied: Boolean(input.policy),
  };
}

// ---------------------------------------------------------------------------
// Helpers — flattening + counts
// ---------------------------------------------------------------------------

function flattenElements(
  screens: QualityScoreScreenInput[],
): QualityScoreElementInput[] {
  const out: QualityScoreElementInput[] = [];
  const walk = (nodes: QualityScoreElementInput[]): void => {
    for (const node of nodes) {
      out.push(node);
      if (node.children && node.children.length > 0) {
        walk(node.children);
      }
    }
  };
  for (const screen of screens) {
    walk(screen.children);
  }
  return out;
}

function computeMaxDepth(screens: QualityScoreScreenInput[]): number {
  let max = 0;
  const visit = (nodes: QualityScoreElementInput[], depth: number): void => {
    if (depth > max) max = depth;
    for (const node of nodes) {
      if (node.children && node.children.length > 0) {
        visit(node.children, depth + 1);
      }
    }
  };
  for (const screen of screens) {
    visit(screen.children, 1);
  }
  return max;
}

function countDiagnosticsBySeverity(
  diagnostics: QualityScoreDiagnosticInput[],
): { error: number; warning: number; info: number } {
  const counts = { error: 0, warning: 0, info: 0 };
  for (const entry of diagnostics) {
    const severity = normalizeSeverity(entry.severity);
    counts[severity] += 1;
  }
  return counts;
}

function normalizeSeverity(
  value: string | undefined,
): "error" | "warning" | "info" {
  const normalized = (value ?? "").trim().toLowerCase();
  if (normalized === "error" || normalized === "critical") return "error";
  if (normalized === "warning" || normalized === "warn") return "warning";
  return "info";
}

function countUnmappedNodes(
  flatNodes: QualityScoreElementInput[],
  manifest: QualityScoreManifestInput | null,
): number {
  if (!manifest || manifest.screens.length === 0) {
    return flatNodes.length;
  }
  const mapped = new Set<string>();
  for (const screen of manifest.screens) {
    for (const component of screen.components) {
      mapped.add(component.irNodeId);
    }
  }
  return flatNodes.filter((node) => !mapped.has(node.id)).length;
}

function isInteractiveWithoutSemantics(
  node: QualityScoreElementInput,
): boolean {
  const hasInteraction =
    Boolean(node.onClick) ||
    Boolean(node.onSubmit) ||
    node.validationType !== undefined;
  if (!hasInteraction) return false;
  const semanticType = node.semanticType ?? "";
  if (SEMANTIC_INTERACTIVE_TYPES.has(semanticType)) return false;
  if ((node.role ?? "").trim().length > 0) return false;
  return (node.ariaLabel ?? "").trim().length === 0;
}

// ---------------------------------------------------------------------------
// Sub-scores
// ---------------------------------------------------------------------------

function computeStructureScore(args: {
  totalNodes: number;
  maxDepth: number;
  policy: ResolvedWorkspaceQualityPolicy;
  risks: QualityRiskTag[];
}): number {
  const { totalNodes, maxDepth, policy, risks } = args;
  let score = 100;

  const depthPenalty = Math.max(0, maxDepth - policy.maxAcceptableDepth) * 8;
  if (depthPenalty > 0) {
    risks.push({
      id: "deep-nesting",
      category: "structural",
      severity: overrideSeverity(
        policy,
        "deep-nesting",
        depthPenalty >= 24 ? "high" : "medium",
      ),
      label: "Deep nesting detected",
      detail: `Max nesting depth is ${maxDepth} (policy: ${policy.maxAcceptableDepth}). Deep trees often indicate over-grouping and make codegen fragile.`,
    });
  }

  const overshoot = Math.max(0, totalNodes - policy.maxAcceptableNodes);
  const sizePenalty =
    overshoot > 0 ? Math.min(40, Math.round(overshoot / 8)) : 0;
  if (sizePenalty > 0) {
    risks.push({
      id: "large-subtree",
      category: "structural",
      severity: overrideSeverity(
        policy,
        "large-subtree",
        sizePenalty >= 20 ? "high" : "medium",
      ),
      label: "Large subtree",
      detail: `${totalNodes} nodes exceed the policy budget of ${policy.maxAcceptableNodes}. Consider splitting the import.`,
    });
  }

  score -= depthPenalty + sizePenalty;
  if (totalNodes === 0) {
    risks.push({
      id: "empty-ir",
      category: "structural",
      severity: "high",
      label: "Empty import",
      detail: "No screen elements were produced by the IR transformer.",
    });
    return 0;
  }
  return clampScore(score);
}

function computeSemanticScore(args: {
  flatNodes: QualityScoreElementInput[];
  interactiveWithoutSemantics: number;
  risks: QualityRiskTag[];
  policy: ResolvedWorkspaceQualityPolicy;
}): number {
  const { flatNodes, interactiveWithoutSemantics, risks, policy } = args;
  if (flatNodes.length === 0) return 0;

  let score = 100;

  const interactiveNodes = flatNodes.filter(
    (node) => Boolean(node.onClick) || Boolean(node.onSubmit),
  );
  if (interactiveWithoutSemantics > 0) {
    const ratio =
      interactiveWithoutSemantics / Math.max(1, interactiveNodes.length);
    const penalty = Math.round(ratio * 50);
    score -= penalty;
    for (const node of flatNodes
      .filter(isInteractiveWithoutSemantics)
      .slice(0, 5)) {
      risks.push({
        id: `interaction-no-semantics-${node.id}`,
        category: "interaction",
        severity: overrideSeverity(policy, "interaction-no-semantics", "high"),
        label: "Interactive node missing semantics",
        detail: `Node '${node.name}' has interaction handlers but no semantic type, role, or ARIA label. Screen reader users will not be able to operate it.`,
        nodeId: node.id,
        nodeName: node.name,
      });
    }
  }

  const missingValidation = flatNodes.filter(
    (node) =>
      (node.semanticType === "Input" ||
        node.semanticType === "TextField" ||
        node.semanticType === "Textarea") &&
      !node.validationType,
  );
  if (missingValidation.length > 0) {
    score -= Math.min(15, missingValidation.length * 3);
    risks.push({
      id: "input-without-validation",
      category: "semantic",
      severity: overrideSeverity(
        policy,
        "input-without-validation",
        missingValidation.length > 3 ? "medium" : "low",
      ),
      label: "Inputs without validation",
      detail: `${missingValidation.length} input field(s) do not declare a validation type. Generated code may omit Zod/form-level checks.`,
    });
  }

  return clampScore(score);
}

function computeCodegenScore(args: {
  diagnosticsBySeverity: { error: number; warning: number; info: number };
  unmappedNodes: number;
  totalNodes: number;
  errors: QualityScorePipelineErrorInput[];
  risks: QualityRiskTag[];
}): number {
  const { diagnosticsBySeverity, unmappedNodes, totalNodes, errors, risks } =
    args;
  let score = 100;
  score -= diagnosticsBySeverity.error * 12;
  score -= diagnosticsBySeverity.warning * 4;
  score -= diagnosticsBySeverity.info * 1;

  if (diagnosticsBySeverity.error > 0) {
    risks.push({
      id: "figma-diagnostics-errors",
      category: "codegen",
      severity: "high",
      label: "Figma analyzer reported errors",
      detail: `${diagnosticsBySeverity.error} error-level diagnostic(s) were raised during Figma analysis. Generated code may skip these nodes.`,
    });
  }

  if (totalNodes > 0) {
    const unmappedRatio = unmappedNodes / totalNodes;
    if (unmappedRatio > 0) {
      const penalty = Math.round(unmappedRatio * 50);
      score -= penalty;
      if (unmappedRatio >= 0.3) {
        risks.push({
          id: "high-unmapped-ratio",
          category: "codegen",
          severity: unmappedRatio >= 0.6 ? "high" : "medium",
          label: "High unmapped-node ratio",
          detail: `${unmappedNodes} of ${totalNodes} nodes (${Math.round(unmappedRatio * 100)}%) are not present in the component manifest.`,
        });
      }
    }
  }

  if (errors.length > 0) {
    score -= errors.length * 10;
    risks.push({
      id: "pipeline-errors",
      category: "codegen",
      severity: errors.length > 1 ? "high" : "medium",
      label: "Pipeline errors during generation",
      detail: `${errors.length} pipeline stage(s) failed. Score is capped until the errors are resolved.`,
    });
  }

  return clampScore(score);
}

// ---------------------------------------------------------------------------
// Policy + banding helpers
// ---------------------------------------------------------------------------

function resolvePolicy(
  policy: WorkspaceQualityPolicy | undefined,
): ResolvedWorkspaceQualityPolicy {
  if (!policy) return DEFAULT_POLICY;
  return {
    bandThresholds: {
      ...DEFAULT_POLICY.bandThresholds,
      ...policy.bandThresholds,
    },
    weights: { ...DEFAULT_POLICY.weights, ...policy.weights },
    maxAcceptableDepth:
      policy.maxAcceptableDepth ?? DEFAULT_POLICY.maxAcceptableDepth,
    maxAcceptableNodes:
      policy.maxAcceptableNodes ?? DEFAULT_POLICY.maxAcceptableNodes,
    riskSeverityOverrides: {
      ...DEFAULT_POLICY.riskSeverityOverrides,
      ...policy.riskSeverityOverrides,
    },
  };
}

function overrideSeverity(
  policy: ResolvedWorkspaceQualityPolicy,
  riskId: string,
  fallback: QualityRiskSeverity,
): QualityRiskSeverity {
  const override = policy.riskSeverityOverrides[riskId];
  return override ?? fallback;
}

function bandFor(
  score: number,
  thresholds: ResolvedWorkspaceQualityPolicy["bandThresholds"],
): QualityScoreBand {
  if (score >= thresholds.excellent) return "excellent";
  if (score >= thresholds.good) return "good";
  if (score >= thresholds.fair) return "fair";
  return "poor";
}

function clampScore(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, value));
}

function sortRisks(risks: QualityRiskTag[]): QualityRiskTag[] {
  const severityRank: Record<QualityRiskSeverity, number> = {
    high: 0,
    medium: 1,
    low: 2,
  };
  return [...risks].sort((a, b) => {
    if (severityRank[a.severity] !== severityRank[b.severity]) {
      return severityRank[a.severity] - severityRank[b.severity];
    }
    return a.label.localeCompare(b.label);
  });
}
