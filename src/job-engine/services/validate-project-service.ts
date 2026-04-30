import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  WorkspaceCompositeQualityLighthouseSample,
  WorkspaceCompositeQualityPerformanceBreakdown,
  WorkspaceCompositeQualityReport,
  WorkspaceCompositeQualityWeights,
  WorkspaceJobConfidence,
  WorkspaceVisualBrowserName,
  WorkspaceVisualAuditResult,
  WorkspaceVisualQualityFrozenReference,
  WorkspaceVisualQualityReferenceMode,
  WorkspaceVisualQualityReport,
} from "../../contracts/index.js";
import type {
  WorkspacePipelineQualityValidationStatus,
  WorkspacePipelineQualityWarning,
} from "../../contracts/index.js";
import {
  DEFAULT_ACCESSIBILITY_REPORT_PATH,
  DEFAULT_SEMANTIC_COMPONENT_REPORT_PATH,
} from "../../parity/default-tailwind-emitter.js";
import { DESIGN_TOKEN_REPORT_PATH } from "../../parity/design-token-compiler.js";
import {
  prepareGenerationDiff,
  saveCurrentSnapshot,
  type GenerationDiffContext,
  writeGenerationDiffReport,
} from "../generation-diff.js";
import {
  getUiGateReportPaths,
  runProjectValidation,
  type ProjectValidationResult,
} from "../validation.js";
import type { StageService } from "../pipeline/stage-service.js";
import { STAGE_ARTIFACT_KEYS } from "../pipeline/artifact-keys.js";
import { createPipelineError } from "../errors.js";
import type { FigmaMcpEnrichment } from "../../parity/types.js";
import {
  validateCustomerProfileComponentApiComponentMatchReport,
  validateCustomerProfileComponentMatchReport,
  type CustomerProfileComponentApiValidationSummary,
  type CustomerProfileMatchValidationSummary,
  type CustomerProfileStyleValidationSummary,
  validateGeneratedProjectCustomerProfile,
  validateGeneratedProjectStorybookStyles,
  type CustomerProfileValidationSummary,
} from "../../customer-profile-validation.js";
import {
  type ComponentMatchReportArtifact,
  type StorybookEvidenceArtifact,
  type StorybookPublicThemesArtifact,
  type StorybookPublicTokensArtifact,
} from "../../storybook/types.js";
import {
  parseStorybookCatalogArtifact,
  parseStorybookComponentVisualCatalogArtifact,
  parseStorybookComponentsArtifact,
  parseStorybookEvidenceArtifact,
  parseStorybookThemesArtifact,
  parseStorybookTokensArtifact,
} from "../../storybook/artifact-validation.js";
import { isWithinRoot } from "../preview.js";
import { captureFromProject } from "../visual-capture.js";
import { comparePngBuffers, writeDiffImage } from "../visual-diff.js";
import {
  computeVisualQualityReport,
  type VisualQualityReport,
} from "../visual-scoring.js";
import {
  computeCrossBrowserConsistencyScore,
  normalizeVisualBrowserNames,
} from "../visual-browser-matrix.js";
import {
  extractTopLevelFrameCandidates,
  fetchFigmaVisualReference,
  findVisualQualityFixtureManifest,
  loadFrozenVisualReference,
  parsePngDimensions,
  resolveVisualQualityFrozenReferencePaths,
  selectVisualQualityReferenceNode,
} from "../visual-quality-reference.js";
import {
  computeConfidenceReport,
  type ConfidenceScoringInput,
} from "../confidence-scoring.js";
import type { ComponentManifest } from "../../parity/component-manifest.js";
import {
  buildPipelineQualityPassport,
  type PipelineQualityCoverageInput,
  type PipelineQualityGeneratedFileInput,
  writePipelineQualityPassport,
} from "../pipeline/quality-passport.js";
import type { CodegenGenerateSummary } from "./codegen-generate-types.js";

interface ValidateProjectServiceDeps {
  runProjectValidationFn: typeof runProjectValidation;
  prepareGenerationDiffFn: typeof prepareGenerationDiff;
  writeGenerationDiffReportFn: typeof writeGenerationDiffReport;
  saveCurrentSnapshotFn: typeof saveCurrentSnapshot;
  captureFromProjectFn: typeof captureFromProject;
  comparePngBuffersFn: typeof comparePngBuffers;
}

type ValidationGateStatus =
  | "ok"
  | "warn"
  | "failed"
  | "partial"
  | "not_available"
  | "not_requested";

interface ValidationArtifactStatusSummary {
  status: "ok" | "not_available" | "missing" | "invalid";
  filePath?: string;
}

interface ValidationFigmaLibraryResolutionSummary {
  total: number;
  resolved: number;
  partial: number;
  error: number;
  cacheHit: number;
  offlineReused: number;
  bySource: {
    live: number;
    cache: number;
    localCatalog: number;
  };
  entriesWithOriginFileKey: number;
}

interface ValidationFigmaLibraryResolutionStatusSummary extends ValidationArtifactStatusSummary {
  summary?: ValidationFigmaLibraryResolutionSummary;
}

interface ValidationStorybookArtifactSet {
  catalog: ValidationArtifactStatusSummary;
  evidence: ValidationArtifactStatusSummary;
  tokens: ValidationArtifactStatusSummary;
  themes: ValidationArtifactStatusSummary;
  components: ValidationArtifactStatusSummary;
  componentVisualCatalog: ValidationArtifactStatusSummary;
}

interface ValidationStorybookCompositionCoverage {
  totalFigmaFamilies: number;
  matched: number;
  ambiguous: number;
  unmatched: number;
  docsOnlyReferenceCount: number;
  docsOnlyFamilyNames: string[];
}

interface ValidationUiA11yCheckSummary {
  name: string;
  status: "passed" | "failed";
  count: number;
  details?: string;
}

interface ValidationUiA11yReportSummary {
  status: "ok" | "warn";
  reportPath: string;
  visualDiffCount: number;
  a11yViolationCount: number;
  interactionViolationCount: number;
  checks: ValidationUiA11yCheckSummary[];
  artifacts: string[];
  summary?: string;
  diagnostics?: string[];
}

type ValidationUiA11ySummary =
  | ValidationUiA11yReportSummary
  | {
      status: "not_requested";
    }
  | {
      status: "not_available";
      reportPath?: string;
      summary?: string;
    };

interface ValidationGeneratedAccessibilityReportSummary {
  status: "ok" | "warn";
  reportPath: string;
  warningCount: number;
  summary: string;
}

type ValidationGeneratedAccessibilitySummary =
  | ValidationGeneratedAccessibilityReportSummary
  | {
      status: "not_available";
      reportPath?: string;
      summary?: string;
    };

interface ValidationSummaryArtifact {
  status: "ok" | "warn" | "failed";
  validatedAt: string;
  generatedApp:
    | {
        status: "ok";
        attempts: number;
        install: ProjectValidationResult["install"];
        lintAutofix?: ProjectValidationResult["lintAutofix"];
        lint: ProjectValidationResult["lint"];
        typecheck: ProjectValidationResult["typecheck"];
        build: ProjectValidationResult["build"];
        test?: ProjectValidationResult["test"];
        validateUi?: ProjectValidationResult["validateUi"];
        perfAssert?: ProjectValidationResult["perfAssert"];
      }
    | {
        status: "failed";
        failedCommand: string;
      }
      | {
          status: "not_available";
        };
  generatedAccessibility: ValidationGeneratedAccessibilitySummary;
  uiA11y: ValidationUiA11ySummary;
  visualAudit: WorkspaceVisualAuditResult;
  visualQuality: WorkspaceVisualQualityReport;
  compositeQuality: WorkspaceCompositeQualityReport;
  confidence: WorkspaceJobConfidence;
  storybook:
    | {
        status: "ok" | "failed";
        requestedPath: string;
        artifacts: ValidationStorybookArtifactSet;
        composition?: ValidationStorybookCompositionCoverage;
      }
    | {
        status: "not_requested";
      };
  mapping: {
    status: "ok" | "warn" | "failed" | "partial" | "not_available";
    figmaLibraryResolution: ValidationFigmaLibraryResolutionStatusSummary;
    componentMatchReport: ValidationArtifactStatusSummary;
    customerProfileMatch:
      | {
          status: CustomerProfileMatchValidationSummary["status"];
          policy: CustomerProfileMatchValidationSummary["policy"];
          issueCount: number;
          counts: CustomerProfileMatchValidationSummary["counts"];
          issues: CustomerProfileMatchValidationSummary["issues"];
        }
      | {
          status: "not_available";
        };
    componentApi:
      | {
          status: CustomerProfileComponentApiValidationSummary["status"];
          issueCount: number;
          counts: CustomerProfileComponentApiValidationSummary["counts"];
          issues: CustomerProfileComponentApiValidationSummary["issues"];
        }
      | {
          status: "not_available";
        };
  };
  style: {
    status: CustomerProfileStyleValidationSummary["status"];
    issueCount: number;
    issues: CustomerProfileStyleValidationSummary["issues"];
    diagnostics: CustomerProfileStyleValidationSummary["diagnostics"];
    policy?: CustomerProfileStyleValidationSummary["policy"];
    storybook: {
      evidence: ValidationArtifactStatusSummary;
      tokens: ValidationArtifactStatusSummary;
      themes: ValidationArtifactStatusSummary;
      componentMatchReport: ValidationArtifactStatusSummary;
    };
    customerProfile?: {
      tokenPolicy: CustomerProfileValidationSummary["token"]["policy"];
      matchPolicy: CustomerProfileValidationSummary["match"]["policy"];
    };
  };
  import:
    | {
        status: CustomerProfileValidationSummary["status"];
        customerProfile: CustomerProfileValidationSummary;
      }
    | {
        status: "not_available";
      };
}

type StorybookArtifactKey = keyof ValidationStorybookArtifactSet;

type StorybookArtifactDescriptor = {
  key: StorybookArtifactKey;
  label: string;
};

const STORYBOOK_ARTIFACT_DESCRIPTORS: StorybookArtifactDescriptor[] = [
  {
    key: "catalog",
    label: "storybook.catalog",
  },
  {
    key: "evidence",
    label: "storybook.evidence",
  },
  {
    key: "tokens",
    label: "storybook.tokens",
  },
  {
    key: "themes",
    label: "storybook.themes",
  },
  {
    key: "components",
    label: "storybook.components",
  },
  {
    key: "componentVisualCatalog",
    label: "storybook.component-visual-catalog",
  },
];

const isFailedValidationArtifactStatus = (
  status: ValidationArtifactStatusSummary["status"],
): status is "missing" | "invalid" => {
  return status === "missing" || status === "invalid";
};

const listFailedStorybookArtifacts = ({
  artifacts,
}: {
  artifacts: ValidationStorybookArtifactSet;
}): Array<
  StorybookArtifactDescriptor & {
    status: "missing" | "invalid";
    filePath?: string;
  }
> => {
  const failedArtifacts: Array<
    StorybookArtifactDescriptor & {
      status: "missing" | "invalid";
      filePath?: string;
    }
  > = [];
  for (const descriptor of STORYBOOK_ARTIFACT_DESCRIPTORS) {
    const artifact = artifacts[descriptor.key];
    if (!isFailedValidationArtifactStatus(artifact.status)) {
      continue;
    }
    const status: "missing" | "invalid" = artifact.status;
    failedArtifacts.push({
      ...descriptor,
      status,
      ...(artifact.filePath ? { filePath: artifact.filePath } : {}),
    });
  }
  return failedArtifacts;
};

const buildStorybookGateMessage = ({
  artifacts,
}: {
  artifacts: Array<
    StorybookArtifactDescriptor & { status: "missing" | "invalid" }
  >;
}): string => {
  return (
    "Storybook validation gate failed because required artifacts are missing or invalid: " +
    artifacts
      .map((artifact) => `${artifact.label} (${artifact.status})`)
      .join(", ") +
    "."
  );
};

const buildStorybookGateDiagnostics = ({
  artifacts,
}: {
  artifacts: Array<
    StorybookArtifactDescriptor & {
      status: "missing" | "invalid";
      filePath?: string;
    }
  >;
}) => {
  return artifacts.map((artifact) => ({
    code:
      artifact.status === "invalid"
        ? "STORYBOOK_STYLE_ARTIFACT_INVALID"
        : "STORYBOOK_STYLE_ARTIFACT_MISSING",
    message:
      artifact.status === "invalid"
        ? `Required Storybook artifact '${artifact.label}' is unreadable or malformed.`
        : `Required Storybook artifact '${artifact.label}' is missing from validate.project inputs.`,
    suggestion:
      "Generate and persist the Storybook catalog, evidence, tokens, themes, components, and component visual catalog artifacts before validate.project runs.",
    stage: "validate.project" as const,
    severity: "error" as const,
    details: {
      artifactKey: artifact.label,
      ...(artifact.filePath ? { filePath: artifact.filePath } : {}),
    },
  }));
};

const buildStorybookCompositionCoverage = ({
  artifact,
}: {
  artifact: ComponentMatchReportArtifact;
}): ValidationStorybookCompositionCoverage => {
  const docsOnlyFamilyNames: string[] = [];
  for (const entry of artifact.entries) {
    if (entry.match.status !== "matched") {
      continue;
    }
    const hasAuthoritativeEvidence = entry.usedEvidence.some(
      (evidence) => evidence.reliability === "authoritative",
    );
    if (!hasAuthoritativeEvidence && entry.usedEvidence.length > 0) {
      docsOnlyFamilyNames.push(entry.figma.familyName);
    }
  }

  return {
    totalFigmaFamilies: artifact.summary.totalFigmaFamilies,
    matched: artifact.summary.matched,
    ambiguous: artifact.summary.ambiguous,
    unmatched: artifact.summary.unmatched,
    docsOnlyReferenceCount: docsOnlyFamilyNames.length,
    docsOnlyFamilyNames: docsOnlyFamilyNames.sort((a, b) => a.localeCompare(b)),
  };
};

const toJsonFileContent = (value: unknown): string => {
  return `${JSON.stringify(value, null, 2)}\n`;
};

const cloneVisualAuditResult = (
  value: WorkspaceVisualAuditResult,
): WorkspaceVisualAuditResult => {
  return {
    ...value,
    ...(value.regions
      ? {
          regions: value.regions.map((region) => ({ ...region })),
        }
      : {}),
    ...(value.warnings ? { warnings: [...value.warnings] } : {}),
  };
};

const cloneVisualQualityReport = (
  value: WorkspaceVisualQualityReport,
): WorkspaceVisualQualityReport => {
  return {
    ...value,
    ...(value.dimensions
      ? {
          dimensions: value.dimensions.map((dimension) => ({ ...dimension })),
        }
      : {}),
    ...(value.hotspots
      ? {
          hotspots: value.hotspots.map((hotspot) => ({ ...hotspot })),
        }
      : {}),
    ...(value.componentCoverage
      ? {
          componentCoverage: {
            ...value.componentCoverage,
            bySkipReason: { ...value.componentCoverage.bySkipReason },
          },
        }
      : {}),
    ...(value.components
      ? {
          components: value.components.map((component) => ({
            ...component,
            ...(component.warnings
              ? { warnings: [...component.warnings] }
              : {}),
          })),
        }
      : {}),
    ...(value.metadata
      ? {
          metadata: {
            ...value.metadata,
            configuredWeights: { ...value.metadata.configuredWeights },
            viewport: { ...value.metadata.viewport },
            versions: { ...value.metadata.versions },
          },
        }
      : {}),
    ...(value.browserBreakdown
      ? {
          browserBreakdown: { ...value.browserBreakdown },
        }
      : {}),
    ...(value.crossBrowserConsistency
      ? {
          crossBrowserConsistency: {
            ...value.crossBrowserConsistency,
            browsers: [...value.crossBrowserConsistency.browsers],
            pairwiseDiffs: value.crossBrowserConsistency.pairwiseDiffs.map(
              (pair) => ({ ...pair }),
            ),
            ...(value.crossBrowserConsistency.warnings
              ? { warnings: [...value.crossBrowserConsistency.warnings] }
              : {}),
          },
        }
      : {}),
    ...(value.perBrowser
      ? {
          perBrowser: value.perBrowser.map((entry) => ({
            ...entry,
            ...(entry.warnings ? { warnings: [...entry.warnings] } : {}),
          })),
        }
      : {}),
    ...(value.warnings ? { warnings: [...value.warnings] } : {}),
  };
};

const cloneCompositeQualityReport = (
  value: WorkspaceCompositeQualityReport,
): WorkspaceCompositeQualityReport => {
  return {
    ...value,
    ...(value.weights ? { weights: { ...value.weights } } : {}),
    ...(value.visual ? { visual: { ...value.visual } } : {}),
    ...(value.performance
      ? {
          performance: {
            ...value.performance,
            samples: value.performance.samples.map((sample) => ({ ...sample })),
            aggregateMetrics: { ...value.performance.aggregateMetrics },
            warnings: [...value.performance.warnings],
          },
        }
      : {}),
    ...(value.composite
      ? {
          composite: {
            ...value.composite,
            includedDimensions: [...value.composite.includedDimensions],
          },
        }
      : {}),
    ...(value.warnings ? { warnings: [...value.warnings] } : {}),
  };
};

const createNotRequestedVisualQualityReport =
  (): WorkspaceVisualQualityReport => ({
    status: "not_requested",
  });

const createNotRequestedCompositeQualityReport =
  (): WorkspaceCompositeQualityReport => ({
    status: "not_requested",
  });

const createFailedCompositeQualityReport = ({
  weights,
  generatedAt,
  message,
  warnings,
}: {
  weights: WorkspaceCompositeQualityWeights;
  generatedAt: string;
  message: string;
  warnings?: string[];
}): WorkspaceCompositeQualityReport => {
  return {
    status: "failed",
    generatedAt,
    weights: { ...weights },
    message,
    ...(warnings && warnings.length > 0 ? { warnings: [...warnings] } : {}),
  };
};

const createFailedVisualQualityReport = ({
  referenceSource,
  capturedAt,
  message,
  warnings,
}: {
  referenceSource: WorkspaceVisualQualityReferenceMode;
  capturedAt: string;
  message: string;
  warnings?: string[];
}): WorkspaceVisualQualityReport => {
  return {
    status: "failed",
    referenceSource,
    capturedAt,
    message,
    ...(warnings && warnings.length > 0 ? { warnings } : {}),
  };
};

const createCompletedVisualQualityReport = ({
  referenceSource,
  capturedAt,
  report,
  browserBreakdown,
  crossBrowserConsistency,
  perBrowser,
  warnings,
}: {
  referenceSource: WorkspaceVisualQualityReferenceMode;
  capturedAt: string;
  report: VisualQualityReport;
  browserBreakdown?: WorkspaceVisualQualityReport["browserBreakdown"];
  crossBrowserConsistency?: WorkspaceVisualQualityReport["crossBrowserConsistency"];
  perBrowser?: WorkspaceVisualQualityReport["perBrowser"];
  warnings?: string[];
}): WorkspaceVisualQualityReport => {
  return {
    status: "completed",
    referenceSource,
    capturedAt,
    overallScore: report.overallScore,
    interpretation: report.interpretation,
    dimensions: report.dimensions.map((dimension) => ({ ...dimension })),
    diffImagePath: report.diffImagePath,
    hotspots: report.hotspots.map((hotspot) => ({ ...hotspot })),
    metadata: {
      ...report.metadata,
      configuredWeights: { ...report.metadata.configuredWeights },
      viewport: { ...report.metadata.viewport },
      versions: { ...report.metadata.versions },
    },
    ...(browserBreakdown ? { browserBreakdown: { ...browserBreakdown } } : {}),
    ...(crossBrowserConsistency
      ? {
          crossBrowserConsistency: {
            ...crossBrowserConsistency,
            browsers: [...crossBrowserConsistency.browsers],
            pairwiseDiffs: crossBrowserConsistency.pairwiseDiffs.map(
              (pair) => ({ ...pair }),
            ),
            ...(crossBrowserConsistency.warnings
              ? { warnings: [...crossBrowserConsistency.warnings] }
              : {}),
          },
        }
      : {}),
    ...(perBrowser
      ? {
          perBrowser: perBrowser.map((entry) => ({
            ...entry,
            ...(entry.warnings ? { warnings: [...entry.warnings] } : {}),
          })),
        }
      : {}),
    ...(warnings && warnings.length > 0 ? { warnings: [...warnings] } : {}),
  };
};

const DEFAULT_COMPOSITE_QUALITY_WEIGHTS: WorkspaceCompositeQualityWeights = {
  visual: 0.6,
  performance: 0.4,
};

const roundCompositeMetric = (value: number, decimals: number): number => {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
};

const resolveCompositeQualityWeights = (
  input?: { visual?: number; performance?: number } | null,
): WorkspaceCompositeQualityWeights => {
  if (input === undefined || input === null) {
    return { ...DEFAULT_COMPOSITE_QUALITY_WEIGHTS };
  }

  const validate = (value: number | undefined, label: string): void => {
    if (value === undefined) {
      return;
    }
    if (!Number.isFinite(value) || value < 0 || value > 1) {
      throw new Error(`composite quality ${label} weight must be within 0..1.`);
    }
  };

  validate(input.visual, "visual");
  validate(input.performance, "performance");

  let visual = input.visual;
  let performance = input.performance;
  if (visual === undefined && performance === undefined) {
    return { ...DEFAULT_COMPOSITE_QUALITY_WEIGHTS };
  }
  if (visual === undefined && performance !== undefined) {
    visual = 1 - performance;
  } else if (performance === undefined && visual !== undefined) {
    performance = 1 - visual;
  }

  const total = (visual ?? 0) + (performance ?? 0);
  if (!Number.isFinite(total) || total <= 0) {
    throw new Error("composite quality weights must sum to a positive value.");
  }

  return {
    visual: roundCompositeMetric((visual ?? 0) / total, 4),
    performance: roundCompositeMetric((performance ?? 0) / total, 4),
  };
};

const computeCompositeScore = ({
  visualScore,
  performanceScore,
  weights,
}: {
  visualScore: number | null;
  performanceScore: number | null;
  weights: WorkspaceCompositeQualityWeights;
}): NonNullable<WorkspaceCompositeQualityReport["composite"]> => {
  if (visualScore === null && performanceScore === null) {
    return {
      score: null,
      includedDimensions: [],
      explanation: "no scores available",
    };
  }
  if (visualScore !== null && performanceScore === null) {
    return {
      score: roundCompositeMetric(visualScore, 2),
      includedDimensions: ["visual"],
      explanation: `visual-only fallback: ${String(roundCompositeMetric(visualScore, 2))}`,
    };
  }
  if (visualScore === null && performanceScore !== null) {
    return {
      score: roundCompositeMetric(performanceScore, 2),
      includedDimensions: ["performance"],
      explanation: `performance-only fallback: ${String(roundCompositeMetric(performanceScore, 2))}`,
    };
  }
  const resolvedVisual = visualScore ?? 0;
  const resolvedPerformance = performanceScore ?? 0;
  const score = roundCompositeMetric(
    weights.visual * resolvedVisual + weights.performance * resolvedPerformance,
    2,
  );
  return {
    score,
    includedDimensions: ["visual", "performance"],
    explanation: `${String(weights.visual)} * ${String(resolvedVisual)} + ${String(weights.performance)} * ${String(resolvedPerformance)} = ${String(score)}`,
  };
};

const meanCompositeMetricOrNull = (
  values: readonly number[],
): number | null => {
  if (values.length === 0) {
    return null;
  }
  return roundCompositeMetric(
    values.reduce((sum, value) => sum + value, 0) / values.length,
    2,
  );
};

const loadCompositePerformanceBreakdown = async ({
  artifactDir,
}: {
  artifactDir: string;
}): Promise<WorkspaceCompositeQualityPerformanceBreakdown> => {
  const candidatePaths = [
    path.join(artifactDir, "perf-assert-report.json"),
    path.join(artifactDir, "perf-baseline.json"),
  ];
  let sourcePath: string | undefined;
  let rawContent: string | undefined;
  for (const candidatePath of candidatePaths) {
    try {
      rawContent = await readFile(candidatePath, "utf8");
      sourcePath = candidatePath;
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        continue;
      }
      throw error;
    }
  }

  const warnings: string[] = [];
  if (rawContent === undefined || sourcePath === undefined) {
    return {
      score: null,
      sampleCount: 0,
      samples: [],
      aggregateMetrics: {
        fcp_ms: null,
        lcp_ms: null,
        cls: null,
        tbt_ms: null,
        speed_index_ms: null,
      },
      warnings: [
        `performance report not found (looked for ${candidatePaths.join(", ")})`,
      ],
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawContent);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      sourcePath,
      score: null,
      sampleCount: 0,
      samples: [],
      aggregateMetrics: {
        fcp_ms: null,
        lcp_ms: null,
        cls: null,
        tbt_ms: null,
        speed_index_ms: null,
      },
      warnings: [`performance report is not valid JSON: ${message}`],
    };
  }

  if (!isRecord(parsed) || !Array.isArray(parsed.samples)) {
    return {
      sourcePath,
      score: null,
      sampleCount: 0,
      samples: [],
      aggregateMetrics: {
        fcp_ms: null,
        lcp_ms: null,
        cls: null,
        tbt_ms: null,
        speed_index_ms: null,
      },
      warnings: ["performance report missing samples[] array"],
    };
  }

  const samples: WorkspaceCompositeQualityLighthouseSample[] = [];
  const performanceScores: number[] = [];
  const fcpValues: number[] = [];
  const lcpValues: number[] = [];
  const clsValues: number[] = [];
  const tbtValues: number[] = [];
  const speedIndexValues: number[] = [];

  const resolveLighthouseRoot = (
    value: unknown,
  ): Record<string, unknown> | null => {
    if (!isRecord(value)) {
      return null;
    }
    const report = isRecord(value.report) ? value.report : null;
    if (report && isRecord(report.lhr)) {
      return report.lhr;
    }
    if (report) {
      return report;
    }
    return isRecord(value.lhr) ? value.lhr : value;
  };
  const extractAuditMetric = (audits: unknown, key: string): number | null => {
    if (!isRecord(audits) || !isRecord(audits[key])) {
      return null;
    }
    const numericValue = audits[key].numericValue;
    return typeof numericValue === "number" && Number.isFinite(numericValue)
      ? numericValue
      : null;
  };
  const extractPerformanceScore = (lhrRoot: unknown): number | null => {
    if (
      !isRecord(lhrRoot) ||
      !isRecord(lhrRoot.categories) ||
      !isRecord(lhrRoot.categories.performance)
    ) {
      return null;
    }
    const score = lhrRoot.categories.performance.score;
    return typeof score === "number" && Number.isFinite(score)
      ? roundCompositeMetric(score * 100, 2)
      : null;
  };

  for (let index = 0; index < parsed.samples.length; index += 1) {
    const sample: unknown = (parsed.samples as unknown[])[index];
    if (!isRecord(sample)) {
      warnings.push(`sample[${String(index)}]: not an object, skipping`);
      continue;
    }
    const profile = sample.profile;
    if (profile !== "mobile" && profile !== "desktop") {
      warnings.push(
        `sample[${String(index)}]: unsupported lighthouse profile (${String(profile)})`,
      );
      continue;
    }
    const route = typeof sample.route === "string" ? sample.route : "(unknown)";
    const lighthouseReportRaw =
      isRecord(sample.artifacts) &&
      typeof sample.artifacts.lighthouseReport === "string"
        ? sample.artifacts.lighthouseReport
        : undefined;
    if (!lighthouseReportRaw) {
      warnings.push(
        `sample[${String(index)}] ${profile} ${route}: missing artifacts.lighthouseReport path`,
      );
      continue;
    }
    const lighthouseReportPath = path.isAbsolute(lighthouseReportRaw)
      ? lighthouseReportRaw
      : path.resolve(artifactDir, lighthouseReportRaw);
    let lighthouseReportContent: string;
    try {
      lighthouseReportContent = await readFile(lighthouseReportPath, "utf8");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      warnings.push(
        `sample[${String(index)}] ${profile} ${route}: failed to read ${lighthouseReportPath} (${message})`,
      );
      continue;
    }
    let lighthouseReportParsed: unknown;
    try {
      lighthouseReportParsed = JSON.parse(lighthouseReportContent);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      warnings.push(
        `sample[${String(index)}] ${profile} ${route}: malformed lighthouse report (${message})`,
      );
      continue;
    }

    const lighthouseRoot = resolveLighthouseRoot(lighthouseReportParsed);
    const audits = lighthouseRoot?.audits;
    const performanceScore = extractPerformanceScore(lighthouseRoot);
    const loadedSample: WorkspaceCompositeQualityLighthouseSample = {
      profile,
      route,
      performanceScore,
      fcp_ms: extractAuditMetric(audits, "first-contentful-paint"),
      lcp_ms: extractAuditMetric(audits, "largest-contentful-paint"),
      cls: extractAuditMetric(audits, "cumulative-layout-shift"),
      tbt_ms: extractAuditMetric(audits, "total-blocking-time"),
      speed_index_ms: extractAuditMetric(audits, "speed-index"),
    };
    samples.push(loadedSample);

    const label = `${profile} ${route}`;
    if (performanceScore !== null) {
      performanceScores.push(performanceScore);
    } else {
      warnings.push(`${label}: missing performance score`);
    }
    if (loadedSample.fcp_ms !== null) {
      fcpValues.push(loadedSample.fcp_ms);
    } else {
      warnings.push(`${label}: missing FCP`);
    }
    if (loadedSample.lcp_ms !== null) {
      lcpValues.push(loadedSample.lcp_ms);
    } else {
      warnings.push(`${label}: missing LCP`);
    }
    if (loadedSample.cls !== null) {
      clsValues.push(loadedSample.cls);
    } else {
      warnings.push(`${label}: missing CLS`);
    }
    if (loadedSample.tbt_ms !== null) {
      tbtValues.push(loadedSample.tbt_ms);
    } else {
      warnings.push(`${label}: missing TBT`);
    }
    if (loadedSample.speed_index_ms !== null) {
      speedIndexValues.push(loadedSample.speed_index_ms);
    } else {
      warnings.push(`${label}: missing Speed Index`);
    }
  }

  return {
    sourcePath,
    score: meanCompositeMetricOrNull(performanceScores),
    sampleCount: samples.length,
    samples,
    aggregateMetrics: {
      fcp_ms: meanCompositeMetricOrNull(fcpValues),
      lcp_ms: meanCompositeMetricOrNull(lcpValues),
      cls: meanCompositeMetricOrNull(clsValues),
      tbt_ms: meanCompositeMetricOrNull(tbtValues),
      speed_index_ms: meanCompositeMetricOrNull(speedIndexValues),
    },
    warnings,
  };
};

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null && !Array.isArray(value);
};

const resolveRequestedVisualQualityFrozenReference = ({
  context,
}: {
  context: Parameters<StageService<void>["execute"]>[1];
}): WorkspaceVisualQualityFrozenReference | undefined => {
  return (
    context.input?.visualQualityFrozenReference ??
    context.job.request.visualQualityFrozenReference
  );
};

const toUiA11yWarnSummary = ({
  reportPath,
  summary,
  diagnostics,
}: {
  reportPath: string;
  summary: string;
  diagnostics?: string[];
}): ValidationUiA11yReportSummary => {
  return {
    status: "warn",
    reportPath,
    visualDiffCount: 0,
    a11yViolationCount: 0,
    interactionViolationCount: 0,
    checks: [],
    artifacts: [],
    summary,
    ...(diagnostics && diagnostics.length > 0 ? { diagnostics } : {}),
  };
};

const parseUiA11yCheckSummary = ({
  input,
}: {
  input: unknown;
}): ValidationUiA11yCheckSummary | undefined => {
  if (!isRecord(input)) {
    return undefined;
  }

  const name = typeof input.name === "string" ? input.name.trim() : "";
  if (name.length === 0) {
    return undefined;
  }

  const statusRaw =
    typeof input.status === "string" ? input.status.trim().toLowerCase() : "";
  if (statusRaw !== "passed" && statusRaw !== "failed") {
    return undefined;
  }

  const count =
    typeof input.count === "number" && Number.isFinite(input.count)
      ? Math.max(0, Math.trunc(input.count))
      : 0;
  return {
    name,
    status: statusRaw,
    count,
    ...(typeof input.details === "string" && input.details.trim().length > 0
      ? { details: input.details.trim() }
      : {}),
  };
};

const parseUiA11yReportSummary = ({
  input,
  reportPath,
}: {
  input: string;
  reportPath: string;
}): ValidationUiA11yReportSummary => {
  const parsed: unknown = JSON.parse(input);
  if (!isRecord(parsed)) {
    throw new Error("Expected ui-gate report to be a JSON object.");
  }

  const diagnostics: string[] = [];
  const toViolationCount = ({
    key,
    value,
  }: {
    key: "visualDiffCount" | "a11yViolationCount" | "interactionViolationCount";
    value: unknown;
  }): number => {
    if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
      return Math.trunc(value);
    }
    diagnostics.push(`Expected '${key}' to be a non-negative number.`);
    return 0;
  };

  const visualDiffCount = toViolationCount({
    key: "visualDiffCount",
    value: parsed.visualDiffCount,
  });
  const a11yViolationCount = toViolationCount({
    key: "a11yViolationCount",
    value: parsed.a11yViolationCount,
  });
  const interactionViolationCount = toViolationCount({
    key: "interactionViolationCount",
    value: parsed.interactionViolationCount,
  });

  const checks = Array.isArray(parsed.checks)
    ? parsed.checks
        .map((entry) => parseUiA11yCheckSummary({ input: entry }))
        .filter(
          (entry): entry is ValidationUiA11yCheckSummary => entry !== undefined,
        )
    : [];
  if (!Array.isArray(parsed.checks)) {
    diagnostics.push("Expected 'checks' to be an array.");
  }

  const artifacts = Array.isArray(parsed.artifacts)
    ? [
        ...new Set(
          parsed.artifacts
            .filter((entry): entry is string => typeof entry === "string")
            .map((entry) => entry.trim())
            .filter((entry) => entry.length > 0),
        ),
      ]
    : [];
  if (!Array.isArray(parsed.artifacts)) {
    diagnostics.push("Expected 'artifacts' to be an array.");
  }

  const hasFailedChecks = checks.some((entry) => entry.status === "failed");
  const hasViolationCounts =
    visualDiffCount > 0 ||
    a11yViolationCount > 0 ||
    interactionViolationCount > 0;
  const status: ValidationUiA11yReportSummary["status"] =
    hasFailedChecks || hasViolationCounts || diagnostics.length > 0
      ? "warn"
      : "ok";

  return {
    status,
    reportPath,
    visualDiffCount,
    a11yViolationCount,
    interactionViolationCount,
    checks,
    artifacts,
    ...(typeof parsed.summary === "string" && parsed.summary.trim().length > 0
      ? { summary: parsed.summary.trim() }
      : {}),
    ...(diagnostics.length > 0 ? { diagnostics } : {}),
  };
};

const buildUiA11ySummary = async ({
  context,
  validationResult,
}: {
  context: Parameters<StageService<void>["execute"]>[1];
  validationResult?: ProjectValidationResult;
}): Promise<ValidationUiA11ySummary> => {
  if (!context.runtime.enableUiValidation) {
    return {
      status: "not_requested",
    };
  }

  const { reportPath } = getUiGateReportPaths({
    jobDir: context.paths.jobDir,
  });
  if (!validationResult?.validateUi) {
    return {
      status: "not_available",
      reportPath,
      summary:
        "UI/A11y validation did not run; ui-gate report is not available.",
    };
  }

  let reportInput: string;
  try {
    reportInput = await readFile(reportPath, "utf8");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return toUiA11yWarnSummary({
      reportPath,
      summary:
        "UI/A11y validation ran but ui-gate report is missing or unreadable.",
      diagnostics: [message],
    });
  }

  try {
    return parseUiA11yReportSummary({
      input: reportInput,
      reportPath,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return toUiA11yWarnSummary({
      reportPath,
      summary: "UI/A11y validation produced a malformed ui-gate report.",
      diagnostics: [message],
    });
  }
};

const toGeneratedAccessibilityWarnSummary = ({
  reportPath,
  summary,
  warningCount = 0,
}: {
  reportPath: string;
  summary: string;
  warningCount?: number;
}): ValidationGeneratedAccessibilityReportSummary => {
  return {
    status: "warn",
    reportPath,
    warningCount,
    summary,
  };
};

const parseGeneratedAccessibilityReportSummary = ({
  input,
  reportPath,
}: {
  input: string;
  reportPath: string;
}): ValidationGeneratedAccessibilityReportSummary => {
  const parsed: unknown = JSON.parse(input);
  if (!isRecord(parsed)) {
    throw new Error("Expected accessibility report to be a JSON object.");
  }

  const summary = isRecord(parsed.summary) ? parsed.summary : undefined;
  const message =
    typeof summary?.message === "string" && summary.message.trim().length > 0
      ? summary.message.trim()
      : undefined;
  const warningCount =
    typeof summary?.warningCount === "number" && Number.isFinite(summary.warningCount)
      ? Math.max(0, Math.trunc(summary.warningCount))
      : Array.isArray(parsed.warnings)
        ? parsed.warnings.length
        : 0;
  const status =
    typeof summary?.status === "string" && summary.status === "ok" && warningCount === 0
      ? "ok"
      : "warn";

  if (status === "ok") {
    return {
      status,
      reportPath,
      warningCount,
      summary:
        message ?? `Generated accessibility report found no warnings across 0 screen(s).`,
    };
  }

  return {
    status,
    reportPath,
    warningCount,
    summary:
      message ??
      `Generated accessibility report flagged ${warningCount} warning(s).`,
  };
};

const buildGeneratedAccessibilitySummary = async ({
  context,
}: {
  context: Parameters<StageService<void>["execute"]>[1];
}): Promise<ValidationGeneratedAccessibilitySummary> => {
  const codegenSummary = await context.artifactStore.getValue<CodegenGenerateSummary>(
    STAGE_ARTIFACT_KEYS.codegenSummary,
  );
  const reportPath = DEFAULT_ACCESSIBILITY_REPORT_PATH;
  const absoluteReportPath = path.join(
    context.paths.generatedProjectDir,
    DEFAULT_ACCESSIBILITY_REPORT_PATH,
  );
  const codegenSummaryValue = codegenSummary as
    | CodegenGenerateSummary
    | null
    | undefined;
  const generatedPaths =
    codegenSummaryValue === undefined || codegenSummaryValue === null
      ? []
      : codegenSummaryValue.generatedPaths;
  if (!generatedPaths.includes(DEFAULT_ACCESSIBILITY_REPORT_PATH)) {
    return {
      status: "not_available",
      reportPath,
      summary: "Generated accessibility report is not available.",
    };
  }

  let reportInput: string;
  try {
    reportInput = await readFile(absoluteReportPath, "utf8");
  } catch {
    return toGeneratedAccessibilityWarnSummary({
      reportPath,
      warningCount: 0,
      summary:
        "Generated accessibility report is missing or unreadable.",
    });
  }

  try {
    return parseGeneratedAccessibilityReportSummary({
      input: reportInput,
      reportPath,
    });
  } catch {
    return toGeneratedAccessibilityWarnSummary({
      reportPath,
      warningCount: 0,
      summary:
        "Generated accessibility report is malformed.",
    });
  }
};

const parseComponentMatchReportArtifact = ({
  input,
}: {
  input: string;
}): ComponentMatchReportArtifact => {
  const parsed: unknown = JSON.parse(input);
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !("artifact" in parsed) ||
    (parsed as Record<string, unknown>).artifact !== "component.match_report" ||
    !Array.isArray((parsed as Record<string, unknown>).entries)
  ) {
    throw new Error(
      "Expected a component.match_report artifact with an entries array.",
    );
  }
  return parsed as ComponentMatchReportArtifact;
};

const parseFigmaLibraryResolutionSummary = ({
  input,
}: {
  input: string;
}): ValidationFigmaLibraryResolutionSummary => {
  const parsed: unknown = JSON.parse(input);
  if (
    !isRecord(parsed) ||
    parsed.artifact !== "figma.library_resolution" ||
    !Array.isArray(parsed.entries) ||
    !isRecord(parsed.summary)
  ) {
    throw new Error(
      "Expected a figma.library_resolution artifact with entries and summary.",
    );
  }
  const summary = parsed.summary;

  const numericField = (
    key:
      | "total"
      | "resolved"
      | "partial"
      | "error"
      | "cacheHit"
      | "offlineReused",
  ): number => {
    const value = summary[key];
    return typeof value === "number" && Number.isFinite(value) ? value : 0;
  };

  let live = 0;
  let cache = 0;
  let localCatalog = 0;
  let entriesWithOriginFileKey = 0;
  for (const entry of parsed.entries) {
    if (!isRecord(entry)) {
      continue;
    }
    const resolutionSource =
      typeof entry.resolutionSource === "string" ? entry.resolutionSource : "";
    if (resolutionSource === "live") {
      live += 1;
    } else if (resolutionSource === "cache") {
      cache += 1;
    } else if (resolutionSource === "local_catalog") {
      localCatalog += 1;
    }
    if (
      typeof entry.originFileKey === "string" &&
      entry.originFileKey.trim().length > 0
    ) {
      entriesWithOriginFileKey += 1;
    }
  }

  return {
    total: numericField("total"),
    resolved: numericField("resolved"),
    partial: numericField("partial"),
    error: numericField("error"),
    cacheHit: numericField("cacheHit"),
    offlineReused: numericField("offlineReused"),
    bySource: {
      live,
      cache,
      localCatalog,
    },
    entriesWithOriginFileKey,
  };
};

const extractFailedCommandFromPipelineError = (error: unknown): string => {
  if (!isRecord(error)) {
    return "unknown";
  }
  const diagnostics = (error as { diagnostics?: unknown }).diagnostics;
  if (!Array.isArray(diagnostics) || diagnostics.length === 0) {
    return "unknown";
  }
  const firstDiagnostic: unknown = diagnostics[0];
  if (!isRecord(firstDiagnostic)) {
    return "unknown";
  }
  const details = firstDiagnostic.details;
  if (!isRecord(details)) {
    return "unknown";
  }
  const command = details.command;
  if (typeof command === "string" && command.trim().length > 0) {
    return command;
  }
  return "unknown";
};

const resolveSummaryStatus = ({
  generatedApp,
  uiA11y,
  visualAudit,
  compositeQuality,
  storybook,
  mapping,
  style,
  importSummary,
}: {
  generatedApp: ValidationSummaryArtifact["generatedApp"];
  uiA11y: ValidationSummaryArtifact["uiA11y"];
  visualAudit: ValidationSummaryArtifact["visualAudit"];
  compositeQuality: ValidationSummaryArtifact["compositeQuality"];
  storybook: ValidationSummaryArtifact["storybook"];
  mapping: ValidationSummaryArtifact["mapping"];
  style: ValidationSummaryArtifact["style"];
  importSummary: ValidationSummaryArtifact["import"];
}): ValidationSummaryArtifact["status"] => {
  const compositeQualityStatus: ValidationGateStatus =
    compositeQuality.status === "failed"
      ? "failed"
      : compositeQuality.status === "completed" &&
          (compositeQuality.warnings?.length ?? 0) > 0
        ? "warn"
        : compositeQuality.status === "completed"
          ? "ok"
          : "not_requested";
  const gateStatuses: ValidationGateStatus[] = [
    generatedApp.status,
    uiA11y.status,
    visualAudit.status,
    compositeQualityStatus,
    storybook.status,
    mapping.status,
    style.status,
    importSummary.status,
  ];
  if (gateStatuses.includes("failed")) {
    return "failed";
  }
  if (gateStatuses.includes("warn") || gateStatuses.includes("partial")) {
    return "warn";
  }
  return "ok";
};

const toArtifactStatusSummary = (
  filePath: string | undefined,
): ValidationArtifactStatusSummary => {
  return filePath
    ? {
        status: "ok",
        filePath,
      }
    : {
        status: "not_available",
    };
};

const PASSPORT_STAGE_ORDER = [
  "figma.source",
  "ir.derive",
  "template.prepare",
  "codegen.generate",
  "validate.project",
] as const;

const toPassportCoverageStatus = (
  status: ValidationSummaryArtifact["status"],
): WorkspacePipelineQualityValidationStatus => {
  if (status === "failed") {
    return "failed";
  }
  return status === "warn" ? "warning" : "passed";
};

const toPipelineScope = ({
  request,
}: {
  request: Parameters<StageService<void>["execute"]>[1]["job"]["request"];
}) => {
  if (request.selectedNodeIds && request.selectedNodeIds.length > 0) {
    return "selection" as const;
  }
  if (request.figmaNodeId && request.figmaNodeId.trim().length > 0) {
    return "node" as const;
  }
  return "board" as const;
};

const isSafeGeneratedProjectPath = ({
  generatedProjectDir,
  relativePath,
}: {
  generatedProjectDir: string;
  relativePath: string;
}): boolean => {
  const root = path.resolve(generatedProjectDir);
  const candidate = path.resolve(generatedProjectDir, relativePath);
  return candidate !== root && candidate.startsWith(`${root}${path.sep}`);
};

const collectQualityPassportGeneratedFiles = async ({
  generatedPaths,
  generatedProjectDir,
}: {
  generatedPaths: readonly string[];
  generatedProjectDir: string;
}): Promise<PipelineQualityGeneratedFileInput[]> => {
  const files: PipelineQualityGeneratedFileInput[] = [];
  for (const relativePath of [...new Set(generatedPaths)].sort((left, right) =>
    left.localeCompare(right),
  )) {
    if (
      relativePath === "quality-passport.json" ||
      !isSafeGeneratedProjectPath({ generatedProjectDir, relativePath })
    ) {
      continue;
    }
    const absolutePath = path.join(generatedProjectDir, relativePath);
    try {
      files.push({
        path: relativePath,
        content: await readFile(absolutePath),
      });
    } catch {
      files.push({ path: relativePath });
    }
  }
  return files;
};

const numberOrUndefined = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

const readJsonArtifact = async ({
  absolutePath,
}: {
  absolutePath: string;
}): Promise<unknown> => {
  try {
    return JSON.parse(await readFile(absolutePath, "utf8")) as unknown;
  } catch {
    return undefined;
  }
};

const resolveTokenCoverage = async ({
  generatedProjectDir,
  fallbackStatus,
}: {
  generatedProjectDir: string;
  fallbackStatus: WorkspacePipelineQualityValidationStatus;
}): Promise<PipelineQualityCoverageInput> => {
  const parsed = await readJsonArtifact({
    absolutePath: path.join(generatedProjectDir, DESIGN_TOKEN_REPORT_PATH),
  });
  if (!isRecord(parsed)) {
    return { covered: 0, total: 0, status: "not_run" };
  }
  if (isRecord(parsed.categories)) {
    let covered = 0;
    let total = 0;
    for (const category of Object.values(parsed.categories)) {
      if (!isRecord(category)) {
        continue;
      }
      const categoryMapped = numberOrUndefined(category.mapped);
      const categoryTotal = numberOrUndefined(category.total);
      if (categoryTotal === undefined || categoryTotal <= 0) {
        continue;
      }
      total += Math.trunc(categoryTotal);
      covered += Math.min(
        Math.max(0, Math.trunc(categoryMapped ?? 0)),
        Math.trunc(categoryTotal),
      );
    }
    if (total > 0) {
      return { covered, total, status: fallbackStatus };
    }
  }
  const ratio = numberOrUndefined(parsed.tokenCoverage);
  if (ratio !== undefined) {
    return {
      covered: Math.round(Math.max(0, Math.min(1, ratio)) * 10_000),
      total: 10_000,
      status: fallbackStatus,
    };
  }
  return { covered: 0, total: 0, status: "not_run" };
};

const resolveSemanticCoverage = async ({
  codegenSummary,
  generatedProjectDir,
  fallbackStatus,
}: {
  codegenSummary: CodegenGenerateSummary | undefined;
  generatedProjectDir: string;
  fallbackStatus: WorkspacePipelineQualityValidationStatus;
}): Promise<PipelineQualityCoverageInput> => {
  const mappingCoverage = codegenSummary?.mappingCoverage;
  if (mappingCoverage) {
    const total = Math.max(0, Math.trunc(mappingCoverage.totalCandidateNodes));
    const fallbackNodes = Math.max(0, Math.trunc(mappingCoverage.fallbackNodes));
    return {
      covered: Math.max(0, total - fallbackNodes),
      total,
      status: fallbackStatus,
    };
  }
  const parsed = await readJsonArtifact({
    absolutePath: path.join(
      generatedProjectDir,
      DEFAULT_SEMANTIC_COMPONENT_REPORT_PATH,
    ),
  });
  if (!isRecord(parsed)) {
    return { covered: 0, total: 0, status: "not_run" };
  }
  const components = Array.isArray(parsed.components)
    ? parsed.components.length
    : 0;
  const diagnostics = Array.isArray(parsed.diagnostics)
    ? parsed.diagnostics.length
    : 0;
  return {
    covered: components,
    total: components + diagnostics,
    status: diagnostics > 0 ? "warning" : fallbackStatus,
  };
};

const collectQualityPassportWarnings = async ({
  codegenSummary,
  context,
  summary,
  generatedProjectDir,
}: {
  codegenSummary: CodegenGenerateSummary | undefined;
  context: Parameters<StageService<void>["execute"]>[1];
  summary: ValidationSummaryArtifact;
  generatedProjectDir: string;
}): Promise<WorkspacePipelineQualityWarning[]> => {
  const warnings: WorkspacePipelineQualityWarning[] = [];
  const pushWarning = ({
    code,
    message,
    severity = "warning",
    source,
  }: Partial<WorkspacePipelineQualityWarning> & {
    code: string;
    message: string;
  }): void => {
    warnings.push({
      code,
      severity,
      message,
      ...(source ? { source } : {}),
    });
  };

  if (summary.status !== "ok") {
    pushWarning({
      code: "VALIDATION_SUMMARY_NOT_OK",
      severity: summary.status === "failed" ? "error" : "warning",
      message: `Validation summary completed with status '${summary.status}'.`,
      source: "validation-summary.json",
    });
  }
  for (const warning of codegenSummary?.llmWarnings ?? []) {
    pushWarning({
      code: warning.code,
      message: warning.message,
      source: "codegen.generate",
    });
  }
  for (const warning of codegenSummary?.mappingWarnings ?? []) {
    pushWarning({
      code: warning.code,
      message: warning.message,
      source: "component.mapping",
    });
  }
  for (const warning of codegenSummary?.iconWarnings ?? []) {
    pushWarning({
      code: warning.code ?? "ICON_FALLBACK",
      message: warning.message,
      source: "icon.render",
    });
  }
  for (const diagnostic of context.getCollectedDiagnostics() ?? []) {
    pushWarning({
      code: diagnostic.code,
      severity: diagnostic.severity === "error" ? "error" : diagnostic.severity,
      message: diagnostic.message,
      source: diagnostic.stage,
    });
  }
  const semanticReport = await readJsonArtifact({
    absolutePath: path.join(
      generatedProjectDir,
      DEFAULT_SEMANTIC_COMPONENT_REPORT_PATH,
    ),
  });
  if (isRecord(semanticReport) && Array.isArray(semanticReport.diagnostics)) {
    for (const diagnostic of semanticReport.diagnostics) {
      if (!isRecord(diagnostic)) {
        continue;
      }
      const code =
        typeof diagnostic.code === "string" && diagnostic.code.trim().length > 0
          ? diagnostic.code
          : "DEFAULT_SEMANTIC_DIAGNOSTIC";
      const message =
        typeof diagnostic.message === "string" &&
        diagnostic.message.trim().length > 0
          ? diagnostic.message
          : "Default semantic synthesis emitted a diagnostic.";
      pushWarning({
        code,
        message,
        source: DEFAULT_SEMANTIC_COMPONENT_REPORT_PATH,
      });
    }
  }

  const codegenSummaryValue = codegenSummary as
    | CodegenGenerateSummary
    | null
    | undefined;
  const generatedPaths =
    codegenSummaryValue === undefined || codegenSummaryValue === null
      ? []
      : codegenSummaryValue.generatedPaths;
  const shouldReadAccessibilityReport = generatedPaths.includes(
    DEFAULT_ACCESSIBILITY_REPORT_PATH,
  );
  if (!shouldReadAccessibilityReport) {
    return warnings;
  }

  const accessibilityReport = await readJsonArtifact({
    absolutePath: path.join(
      generatedProjectDir,
      DEFAULT_ACCESSIBILITY_REPORT_PATH,
    ),
  });
  if (
    isRecord(accessibilityReport) &&
    Array.isArray(accessibilityReport.warnings)
  ) {
    for (const warning of accessibilityReport.warnings) {
      if (!isRecord(warning)) {
        continue;
      }
      const code =
        typeof warning.code === "string" && warning.code.trim().length > 0
          ? warning.code
          : "DEFAULT_ACCESSIBILITY_DIAGNOSTIC";
      const message =
        typeof warning.message === "string" &&
        warning.message.trim().length > 0
          ? warning.message
          : "Generated accessibility report emitted a warning.";
      pushWarning({
        code,
        severity:
          warning.severity === "error" ||
          warning.severity === "info" ||
          warning.severity === "warning"
            ? warning.severity
            : "warning",
        message,
        source: DEFAULT_ACCESSIBILITY_REPORT_PATH,
      });
    }
  } else {
    pushWarning({
      code: "DEFAULT_ACCESSIBILITY_REPORT_MISSING",
      message: "Generated accessibility report is missing or malformed.",
      source: DEFAULT_ACCESSIBILITY_REPORT_PATH,
    });
  }
  return warnings;
};

const persistQualityPassportArtifact = async ({
  context,
  summary,
}: {
  context: Parameters<StageService<void>["execute"]>[1];
  summary: ValidationSummaryArtifact;
}): Promise<string> => {
  const codegenSummary = await context.artifactStore.getValue<CodegenGenerateSummary>(
    STAGE_ARTIFACT_KEYS.codegenSummary,
  );
  const fallbackStatus = toPassportCoverageStatus(summary.status);
  const generatedPaths = codegenSummary?.generatedPaths ?? [];
  const generatedFiles = await collectQualityPassportGeneratedFiles({
    generatedPaths,
    generatedProjectDir: context.paths.generatedProjectDir,
  });
  const passport = buildPipelineQualityPassport({
    pipelineMetadata: context.pipelineMetadata,
    sourceMode: context.resolvedFigmaSourceMode,
    scope: toPipelineScope({ request: context.job.request }),
    selectedNodeCount: context.job.request.selectedNodeIds?.length ?? 0,
    generatedFiles,
    validationStages: context.job.stages
      .filter((stage) =>
        PASSPORT_STAGE_ORDER.includes(
          stage.name as (typeof PASSPORT_STAGE_ORDER)[number],
        ),
      )
      .map((stage) => ({
        name: stage.name,
        status:
          stage.name === "validate.project"
            ? summary.status === "failed"
              ? "failed"
              : "completed"
            : stage.status,
      })),
    validationStatus: fallbackStatus,
    tokenCoverage: await resolveTokenCoverage({
      generatedProjectDir: context.paths.generatedProjectDir,
      fallbackStatus,
    }),
    semanticCoverage: await resolveSemanticCoverage({
      codegenSummary,
      generatedProjectDir: context.paths.generatedProjectDir,
      fallbackStatus,
    }),
    warnings: await collectQualityPassportWarnings({
      codegenSummary,
      context,
      summary,
      generatedProjectDir: context.paths.generatedProjectDir,
    }),
    metadata: {
      jobId: context.jobId,
      validatedAt: summary.validatedAt,
      pipelineDisplayName: context.pipelineMetadata.pipelineDisplayName,
      validationSummaryStatus: summary.status,
      storybookStatus: summary.storybook.status,
      visualQualityStatus: summary.visualQuality.status,
      compositeQualityStatus: summary.compositeQuality.status,
      confidenceStatus: summary.confidence.status,
    },
  });
  const passportPath = await writePipelineQualityPassport({
    passport,
    destinationDir: context.paths.generatedProjectDir,
  });
  await context.artifactStore.setValue({
    key: STAGE_ARTIFACT_KEYS.qualityPassport,
    stage: "validate.project",
    value: passport,
  });
  await context.artifactStore.setPath({
    key: STAGE_ARTIFACT_KEYS.qualityPassportFile,
    stage: "validate.project",
    absolutePath: passportPath,
  });
  context.job.artifacts.qualityPassportFile = passportPath;
  return passportPath;
};

const toFigmaLibraryResolutionStatusSummary = async ({
  filePath,
}: {
  filePath: string | undefined;
}): Promise<ValidationFigmaLibraryResolutionStatusSummary> => {
  if (!filePath) {
    return {
      status: "not_available",
    };
  }

  let input: string;
  try {
    input = await readFile(filePath, "utf8");
  } catch {
    return {
      status: "missing",
    };
  }

  try {
    return {
      status: "ok",
      filePath,
      summary: parseFigmaLibraryResolutionSummary({
        input,
      }),
    };
  } catch {
    return {
      status: "ok",
      filePath,
    };
  }
};

const persistValidationSummaryArtifacts = async ({
  context,
  summary,
}: {
  context: Parameters<StageService<void>["execute"]>[1];
  summary: ValidationSummaryArtifact;
}): Promise<string> => {
  const validationSummaryFilePath = path.join(
    context.paths.jobDir,
    "validation-summary.json",
  );
  await writeFile(
    validationSummaryFilePath,
    toJsonFileContent(summary),
    "utf8",
  );
  await context.artifactStore.setValue({
    key: STAGE_ARTIFACT_KEYS.validationSummary,
    stage: "validate.project",
    value: summary,
  });
  await context.artifactStore.setPath({
    key: STAGE_ARTIFACT_KEYS.validationSummaryFile,
    stage: "validate.project",
    absolutePath: validationSummaryFilePath,
  });
  await persistQualityPassportArtifact({
    context,
    summary,
  });
  return validationSummaryFilePath;
};

const buildValidationSummaryArtifact = async ({
  context,
  validatedAt,
  validationResult,
  generatedAppFailure,
  customerProfileImportSummary,
  customerProfileMatchSummary,
  customerProfileComponentApiSummary,
  customerProfileStyleSummary,
  componentMatchReportArtifact,
  storybookArtifactStatusOverrides,
  visualAuditResult,
  visualQualityReport,
  compositeQualityReport,
  confidence,
}: {
  context: Parameters<StageService<void>["execute"]>[1];
  validatedAt: string;
  validationResult?: ProjectValidationResult;
  generatedAppFailure?: { failedCommand: string };
  customerProfileImportSummary?: CustomerProfileValidationSummary;
  customerProfileMatchSummary?: CustomerProfileMatchValidationSummary;
  customerProfileComponentApiSummary?: CustomerProfileComponentApiValidationSummary;
  customerProfileStyleSummary?: CustomerProfileStyleValidationSummary;
  componentMatchReportArtifact?: ComponentMatchReportArtifact;
  storybookArtifactStatusOverrides?: Partial<
    Record<StorybookArtifactKey, ValidationArtifactStatusSummary["status"]>
  >;
  visualAuditResult?: WorkspaceVisualAuditResult;
  visualQualityReport?: WorkspaceVisualQualityReport;
  compositeQualityReport?: WorkspaceCompositeQualityReport;
  confidence?: WorkspaceJobConfidence;
}): Promise<ValidationSummaryArtifact> => {
  const storybookCatalogFile = await context.artifactStore.getPath(
    STAGE_ARTIFACT_KEYS.storybookCatalog,
  );
  const storybookEvidenceFile = await context.artifactStore.getPath(
    STAGE_ARTIFACT_KEYS.storybookEvidence,
  );
  const storybookTokensFile = await context.artifactStore.getPath(
    STAGE_ARTIFACT_KEYS.storybookTokens,
  );
  const storybookThemesFile = await context.artifactStore.getPath(
    STAGE_ARTIFACT_KEYS.storybookThemes,
  );
  const storybookComponentsFile = await context.artifactStore.getPath(
    STAGE_ARTIFACT_KEYS.storybookComponents,
  );
  const storybookComponentVisualCatalogFile =
    await context.artifactStore.getPath(
      STAGE_ARTIFACT_KEYS.componentVisualCatalog,
    );
  const figmaLibraryResolutionFile = await context.artifactStore.getPath(
    STAGE_ARTIFACT_KEYS.figmaLibraryResolution,
  );
  const componentMatchReportFile = await context.artifactStore.getPath(
    STAGE_ARTIFACT_KEYS.componentMatchReport,
  );
  const figmaLibraryResolutionSummary =
    await toFigmaLibraryResolutionStatusSummary({
      filePath: figmaLibraryResolutionFile,
    });

  const requestedStorybookStaticDir = context.requestedStorybookStaticDir;
  const toRequiredStorybookArtifactStatus = ({
    filePath,
    overrideStatus,
  }: {
    filePath: string | undefined;
    overrideStatus?: ValidationArtifactStatusSummary["status"];
  }): ValidationArtifactStatusSummary => {
    if (overrideStatus) {
      return {
        status: overrideStatus,
        ...(filePath ? { filePath } : {}),
      };
    }
    return filePath
      ? {
          status: "ok",
          filePath,
        }
      : {
          status: "missing",
        };
  };
  const storybookArtifacts: ValidationStorybookArtifactSet = {
    catalog: toRequiredStorybookArtifactStatus({
      filePath: storybookCatalogFile,
      ...(storybookArtifactStatusOverrides?.catalog
        ? { overrideStatus: storybookArtifactStatusOverrides.catalog }
        : {}),
    }),
    evidence: toRequiredStorybookArtifactStatus({
      filePath: storybookEvidenceFile,
      ...(storybookArtifactStatusOverrides?.evidence
        ? { overrideStatus: storybookArtifactStatusOverrides.evidence }
        : {}),
    }),
    tokens: toRequiredStorybookArtifactStatus({
      filePath: storybookTokensFile,
      ...(storybookArtifactStatusOverrides?.tokens
        ? { overrideStatus: storybookArtifactStatusOverrides.tokens }
        : {}),
    }),
    themes: toRequiredStorybookArtifactStatus({
      filePath: storybookThemesFile,
      ...(storybookArtifactStatusOverrides?.themes
        ? { overrideStatus: storybookArtifactStatusOverrides.themes }
        : {}),
    }),
    components: toRequiredStorybookArtifactStatus({
      filePath: storybookComponentsFile,
      ...(storybookArtifactStatusOverrides?.components
        ? { overrideStatus: storybookArtifactStatusOverrides.components }
        : {}),
    }),
    componentVisualCatalog: toRequiredStorybookArtifactStatus({
      filePath: storybookComponentVisualCatalogFile,
      ...(storybookArtifactStatusOverrides?.componentVisualCatalog
        ? {
            overrideStatus:
              storybookArtifactStatusOverrides.componentVisualCatalog,
          }
        : {}),
    }),
  };

  const compositionCoverage = componentMatchReportArtifact
    ? buildStorybookCompositionCoverage({
        artifact: componentMatchReportArtifact,
      })
    : undefined;
  const styleStorybookArtifacts = requestedStorybookStaticDir
    ? {
        evidence: storybookArtifacts.evidence,
        tokens: storybookArtifacts.tokens,
        themes: storybookArtifacts.themes,
      }
    : {
        evidence: toArtifactStatusSummary(storybookEvidenceFile),
        tokens: toArtifactStatusSummary(storybookTokensFile),
        themes: toArtifactStatusSummary(storybookThemesFile),
      };

  const storybookSummary: ValidationSummaryArtifact["storybook"] =
    requestedStorybookStaticDir
      ? {
          status:
            listFailedStorybookArtifacts({ artifacts: storybookArtifacts })
              .length === 0
              ? "ok"
              : "failed",
          requestedPath: requestedStorybookStaticDir,
          artifacts: storybookArtifacts,
          ...(compositionCoverage ? { composition: compositionCoverage } : {}),
        }
      : {
          status: "not_requested",
        };

  const mappingSummary: ValidationSummaryArtifact["mapping"] = {
    status:
      customerProfileMatchSummary || customerProfileComponentApiSummary
        ? [
            customerProfileMatchSummary?.status,
            customerProfileComponentApiSummary?.status,
          ].includes("failed")
          ? "failed"
          : [
                customerProfileMatchSummary?.status,
                customerProfileComponentApiSummary?.status,
              ].includes("warn")
            ? "warn"
            : "ok"
        : componentMatchReportFile
          ? "ok"
          : figmaLibraryResolutionFile
            ? "partial"
            : "not_available",
    figmaLibraryResolution: figmaLibraryResolutionSummary,
    componentMatchReport: toArtifactStatusSummary(componentMatchReportFile),
    customerProfileMatch: customerProfileMatchSummary
      ? {
          status: customerProfileMatchSummary.status,
          policy: customerProfileMatchSummary.policy,
          issueCount: customerProfileMatchSummary.issueCount,
          counts: customerProfileMatchSummary.counts,
          issues: customerProfileMatchSummary.issues,
        }
      : {
          status: "not_available",
        },
    componentApi: customerProfileComponentApiSummary
      ? {
          status: customerProfileComponentApiSummary.status,
          issueCount: customerProfileComponentApiSummary.issueCount,
          counts: customerProfileComponentApiSummary.counts,
          issues: customerProfileComponentApiSummary.issues,
        }
      : {
          status: "not_available",
        },
  };

  const styleSummary: ValidationSummaryArtifact["style"] =
    customerProfileStyleSummary
      ? {
          status: customerProfileStyleSummary.status,
          issueCount: customerProfileStyleSummary.issueCount,
          issues: customerProfileStyleSummary.issues,
          diagnostics: customerProfileStyleSummary.diagnostics,
          policy: customerProfileStyleSummary.policy,
          storybook: {
            evidence: styleStorybookArtifacts.evidence,
            tokens: styleStorybookArtifacts.tokens,
            themes: styleStorybookArtifacts.themes,
            componentMatchReport: toArtifactStatusSummary(
              componentMatchReportFile,
            ),
          },
          ...(context.resolvedCustomerProfile
            ? {
                customerProfile: {
                  tokenPolicy: context.resolvedCustomerProfile.strictness.token,
                  matchPolicy: context.resolvedCustomerProfile.strictness.match,
                },
              }
            : {}),
        }
      : {
          status: "not_available",
          issueCount: 0,
          issues: [],
          diagnostics: {
            evidence: {
              authoritativeStylingEvidenceCount: 0,
              referenceOnlyStylingEvidenceCount: 0,
              referenceOnlyEvidenceTypes: [],
            },
            tokens: {
              diagnosticCount: 0,
              errorCount: 0,
              diagnostics: [],
            },
            themes: {
              diagnosticCount: 0,
              errorCount: 0,
              diagnostics: [],
            },
            componentMatchReport: {
              resolvedCustomerComponentCount: 0,
              validatedComponentNames: [],
            },
          },
          storybook: {
            evidence: styleStorybookArtifacts.evidence,
            tokens: styleStorybookArtifacts.tokens,
            themes: styleStorybookArtifacts.themes,
            componentMatchReport: toArtifactStatusSummary(
              componentMatchReportFile,
            ),
          },
          ...(context.resolvedCustomerProfile
            ? {
                customerProfile: {
                  tokenPolicy: context.resolvedCustomerProfile.strictness.token,
                  matchPolicy: context.resolvedCustomerProfile.strictness.match,
                },
              }
            : {}),
        };

  const importSummary: ValidationSummaryArtifact["import"] =
    customerProfileImportSummary
      ? {
          status: customerProfileImportSummary.status,
          customerProfile: customerProfileImportSummary,
        }
      : {
          status: "not_available",
        };

  const generatedAppSummary: ValidationSummaryArtifact["generatedApp"] =
    validationResult
      ? {
          status: "ok",
          attempts: validationResult.attempts,
          install: validationResult.install,
          ...(validationResult.lintAutofix
            ? { lintAutofix: validationResult.lintAutofix }
            : {}),
          lint: validationResult.lint,
          typecheck: validationResult.typecheck,
          build: validationResult.build,
          ...(validationResult.test ? { test: validationResult.test } : {}),
          ...(validationResult.validateUi
            ? { validateUi: validationResult.validateUi }
            : {}),
          ...(validationResult.perfAssert
            ? { perfAssert: validationResult.perfAssert }
            : {}),
        }
      : generatedAppFailure
        ? {
            status: "failed",
            failedCommand: generatedAppFailure.failedCommand,
          }
        : {
            status: "not_available",
          };
  const generatedAccessibilitySummary =
    await buildGeneratedAccessibilitySummary({
      context,
    });
  const uiA11ySummary = await buildUiA11ySummary({
    context,
    ...(validationResult ? { validationResult } : {}),
  });
  const resolvedVisualAuditResult = cloneVisualAuditResult(
    visualAuditResult ?? context.job.visualAudit ?? { status: "not_requested" },
  );
  const resolvedVisualQualityReport = cloneVisualQualityReport(
    visualQualityReport ??
      context.job.visualQuality ??
      createNotRequestedVisualQualityReport(),
  );
  const resolvedCompositeQualityReport = cloneCompositeQualityReport(
    compositeQualityReport ??
      context.job.compositeQuality ??
      createNotRequestedCompositeQualityReport(),
  );

  return {
    status: resolveSummaryStatus({
      generatedApp: generatedAppSummary,
      uiA11y: uiA11ySummary,
      visualAudit: resolvedVisualAuditResult,
      compositeQuality: resolvedCompositeQualityReport,
      storybook: storybookSummary,
      mapping: mappingSummary,
      style: styleSummary,
      importSummary,
    }),
    validatedAt,
    generatedApp: generatedAppSummary,
    generatedAccessibility: generatedAccessibilitySummary,
    uiA11y: uiA11ySummary,
    visualAudit: resolvedVisualAuditResult,
    visualQuality: resolvedVisualQualityReport,
    compositeQuality: resolvedCompositeQualityReport,
    confidence: confidence ?? { status: "not_requested" },
    storybook: storybookSummary,
    mapping: mappingSummary,
    style: styleSummary,
    import: importSummary,
  };
};

export const createValidateProjectService = ({
  runProjectValidationFn = runProjectValidation,
  prepareGenerationDiffFn = prepareGenerationDiff,
  writeGenerationDiffReportFn = writeGenerationDiffReport,
  saveCurrentSnapshotFn = saveCurrentSnapshot,
  captureFromProjectFn = captureFromProject,
  comparePngBuffersFn = comparePngBuffers,
}: Partial<ValidateProjectServiceDeps> = {}): StageService<void> => {
  return {
    stageName: "validate.project",
    execute: async (_input, context) => {
      const generatedProjectDir = await context.artifactStore.requirePath(
        STAGE_ARTIFACT_KEYS.generatedProject,
      );
      const validatedAt = new Date().toISOString();

      let customerProfileMatchSummary:
        | CustomerProfileMatchValidationSummary
        | undefined;
      let customerProfileComponentApiSummary:
        | CustomerProfileComponentApiValidationSummary
        | undefined;
      let customerProfileStyleSummary:
        | CustomerProfileStyleValidationSummary
        | undefined;
      let customerProfileImportSummary:
        | Awaited<ReturnType<typeof validateGeneratedProjectCustomerProfile>>
        | undefined;
      let componentMatchReportArtifact:
        | ComponentMatchReportArtifact
        | undefined;
      let storybookEvidenceArtifact: StorybookEvidenceArtifact | undefined;
      let storybookTokensArtifact: StorybookPublicTokensArtifact | undefined;
      let storybookThemesArtifact: StorybookPublicThemesArtifact | undefined;
      let validationResult: ProjectValidationResult | undefined;

      const visualAuditRequest = context.job.request.visualAudit;
      let visualAuditResult: WorkspaceVisualAuditResult = visualAuditRequest
        ? {
            status: "failed",
            baselineImagePath: visualAuditRequest.baselineImagePath,
            warnings: [
              "Visual audit did not complete because validate.project exited before the audit step finished.",
            ],
          }
        : {
            status: "not_requested",
          };
      if (!visualAuditRequest) {
        context.job.visualAudit = { status: "not_requested" };
      }
      let visualAuditReferenceImagePath: string | undefined;
      let visualAuditActualImagePath: string | undefined;
      let visualAuditDiffImagePath: string | undefined;
      let visualAuditReportPath: string | undefined;
      const requestedVisualQualityEnabled =
        context.job.request.enableVisualQualityValidation;
      const requestedVisualQualityFrozenReference =
        resolveRequestedVisualQualityFrozenReference({ context });
      const explicitVisualQualityRequest =
        context.input?.enableVisualQualityValidation !== undefined ||
        context.input?.visualQualityReferenceMode !== undefined ||
        context.input?.visualQualityViewportWidth !== undefined ||
        context.input?.visualQualityFrozenReference !== undefined ||
        context.job.request.visualQualityFrozenReference !== undefined;
      const standaloneVisualQualityMode =
        context.job.request.visualQualityReferenceMode ??
        context.runtime.visualQualityReferenceMode;
      const standaloneVisualQualityViewportWidth =
        context.job.request.visualQualityViewportWidth ??
        context.runtime.visualQualityViewportWidth;
      const standaloneVisualQualityViewportHeight =
        context.job.request.visualQualityViewportHeight ??
        context.runtime.visualQualityViewportHeight;
      const standaloneVisualQualityDeviceScaleFactor =
        context.job.request.visualQualityDeviceScaleFactor ??
        context.runtime.visualQualityDeviceScaleFactor;
      const shouldRunStandaloneVisualQuality =
        requestedVisualQualityEnabled &&
        (!visualAuditRequest || explicitVisualQualityRequest);
      let resolvedVisualQualityReport: WorkspaceVisualQualityReport =
        createNotRequestedVisualQualityReport();
      let resolvedCompositeQualityReport: WorkspaceCompositeQualityReport =
        createNotRequestedCompositeQualityReport();
      context.job.visualQuality = createNotRequestedVisualQualityReport();
      context.job.compositeQuality = createNotRequestedCompositeQualityReport();
      delete context.job.artifacts.visualQualityReportFile;
      delete context.job.artifacts.compositeQualityReportFile;

      const buildSummary = async ({
        generatedAppFailure,
        storybookArtifactStatusOverrides,
        visualQualityReport,
        compositeQualityReport,
        confidence,
      }: {
        generatedAppFailure?: { failedCommand: string };
        storybookArtifactStatusOverrides?: Partial<
          Record<
            StorybookArtifactKey,
            ValidationArtifactStatusSummary["status"]
          >
        >;
        visualQualityReport?: WorkspaceVisualQualityReport;
        compositeQualityReport?: WorkspaceCompositeQualityReport;
        confidence?: WorkspaceJobConfidence;
      } = {}): Promise<ValidationSummaryArtifact> => {
        context.job.visualAudit = cloneVisualAuditResult(visualAuditResult);
        context.job.visualQuality = cloneVisualQualityReport(
          visualQualityReport ?? resolvedVisualQualityReport,
        );
        context.job.compositeQuality = cloneCompositeQualityReport(
          compositeQualityReport ?? resolvedCompositeQualityReport,
        );
        if (confidence) {
          context.job.confidence = confidence;
        }
        return buildValidationSummaryArtifact({
          context,
          validatedAt,
          ...(validationResult ? { validationResult } : {}),
          ...(generatedAppFailure ? { generatedAppFailure } : {}),
          ...(customerProfileImportSummary
            ? { customerProfileImportSummary }
            : {}),
          ...(customerProfileMatchSummary
            ? { customerProfileMatchSummary }
            : {}),
          ...(customerProfileComponentApiSummary
            ? { customerProfileComponentApiSummary }
            : {}),
          ...(customerProfileStyleSummary
            ? { customerProfileStyleSummary }
            : {}),
          ...(componentMatchReportArtifact
            ? { componentMatchReportArtifact }
            : {}),
          ...(storybookArtifactStatusOverrides
            ? { storybookArtifactStatusOverrides }
            : {}),
          visualAuditResult,
          visualQualityReport:
            visualQualityReport ?? resolvedVisualQualityReport,
          compositeQualityReport:
            compositeQualityReport ?? resolvedCompositeQualityReport,
          ...(confidence ? { confidence } : {}),
        });
      };

      const setVisualAuditJobArtifactPath = ({
        key,
        absolutePath,
      }: {
        key:
          | typeof STAGE_ARTIFACT_KEYS.visualAuditReferenceImage
          | typeof STAGE_ARTIFACT_KEYS.visualAuditActualImage
          | typeof STAGE_ARTIFACT_KEYS.visualAuditDiffImage
          | typeof STAGE_ARTIFACT_KEYS.visualAuditReport;
        absolutePath: string;
      }): void => {
        switch (key) {
          case STAGE_ARTIFACT_KEYS.visualAuditReferenceImage:
            visualAuditReferenceImagePath = absolutePath;
            context.job.artifacts.visualAuditReferenceImageFile = absolutePath;
            break;
          case STAGE_ARTIFACT_KEYS.visualAuditActualImage:
            visualAuditActualImagePath = absolutePath;
            context.job.artifacts.visualAuditActualImageFile = absolutePath;
            break;
          case STAGE_ARTIFACT_KEYS.visualAuditDiffImage:
            visualAuditDiffImagePath = absolutePath;
            context.job.artifacts.visualAuditDiffImageFile = absolutePath;
            break;
          case STAGE_ARTIFACT_KEYS.visualAuditReport:
            visualAuditReportPath = absolutePath;
            context.job.artifacts.visualAuditReportFile = absolutePath;
            break;
        }
      };

      const persistVisualAuditArtifactPath = async ({
        key,
        absolutePath,
      }: {
        key:
          | typeof STAGE_ARTIFACT_KEYS.visualAuditReferenceImage
          | typeof STAGE_ARTIFACT_KEYS.visualAuditActualImage
          | typeof STAGE_ARTIFACT_KEYS.visualAuditDiffImage
          | typeof STAGE_ARTIFACT_KEYS.visualAuditReport;
        absolutePath: string;
      }): Promise<void> => {
        setVisualAuditJobArtifactPath({ key, absolutePath });
        await context.artifactStore.setPath({
          key,
          stage: "validate.project",
          absolutePath,
        });
      };

      const persistVisualAuditResult = async (
        result: WorkspaceVisualAuditResult,
      ): Promise<WorkspaceVisualAuditResult> => {
        const clonedResult = cloneVisualAuditResult(result);
        visualAuditResult = clonedResult;
        context.job.visualAudit = cloneVisualAuditResult(clonedResult);
        await context.artifactStore.setValue({
          key: STAGE_ARTIFACT_KEYS.visualAuditResult,
          stage: "validate.project",
          value: cloneVisualAuditResult(clonedResult),
        });
        return clonedResult;
      };

      const persistVisualQualityResult = async (
        result: WorkspaceVisualQualityReport,
      ): Promise<WorkspaceVisualQualityReport> => {
        const clonedResult = cloneVisualQualityReport(result);
        resolvedVisualQualityReport = clonedResult;
        context.job.visualQuality = cloneVisualQualityReport(clonedResult);
        await context.artifactStore.setValue({
          key: STAGE_ARTIFACT_KEYS.visualQualityResult,
          stage: "validate.project",
          value: cloneVisualQualityReport(clonedResult),
        });
        return clonedResult;
      };

      const persistVisualQualityReportPath = async ({
        absolutePath,
      }: {
        absolutePath: string;
      }): Promise<void> => {
        context.job.artifacts.visualQualityReportFile = absolutePath;
        await context.artifactStore.setPath({
          key: STAGE_ARTIFACT_KEYS.visualQualityReport,
          stage: "validate.project",
          absolutePath,
        });
      };

      const persistCompositeQualityResult = async (
        result: WorkspaceCompositeQualityReport,
      ): Promise<WorkspaceCompositeQualityReport> => {
        const clonedResult = cloneCompositeQualityReport(result);
        resolvedCompositeQualityReport = clonedResult;
        context.job.compositeQuality =
          cloneCompositeQualityReport(clonedResult);
        await context.artifactStore.setValue({
          key: STAGE_ARTIFACT_KEYS.compositeQualityResult,
          stage: "validate.project",
          value: cloneCompositeQualityReport(clonedResult),
        });
        return clonedResult;
      };

      const persistCompositeQualityReportPath = async ({
        absolutePath,
      }: {
        absolutePath: string;
      }): Promise<void> => {
        context.job.artifacts.compositeQualityReportFile = absolutePath;
        await context.artifactStore.setPath({
          key: STAGE_ARTIFACT_KEYS.compositeQualityReport,
          stage: "validate.project",
          absolutePath,
        });
      };

      const buildConfidenceInput = async ({
        ctx,
        validationPassed: passed,
        matchReport,
        evidenceArtifact,
        visualReport,
      }: {
        ctx: Parameters<StageService<void>["execute"]>[1];
        validationPassed: boolean;
        matchReport: ComponentMatchReportArtifact | undefined;
        evidenceArtifact: StorybookEvidenceArtifact | undefined;
        visualReport: WorkspaceVisualQualityReport;
      }): Promise<ConfidenceScoringInput> => {
        const normalizeComponentAlias = (value: string): string =>
          value
            .trim()
            .toLowerCase()
            .replace(/[<>]/g, "")
            .replace(/[^a-z0-9]+/g, "");

        const generationMetricsPath = await ctx.artifactStore.getPath(
          STAGE_ARTIFACT_KEYS.generationMetrics,
        );
        let generationMetrics:
          | ConfidenceScoringInput["generationMetrics"]
          | undefined;
        if (generationMetricsPath) {
          try {
            const raw = JSON.parse(
              await readFile(generationMetricsPath, "utf8"),
            ) as Record<string, unknown>;
            const screenElementCounts = Array.isArray(raw.screenElementCounts)
              ? (raw.screenElementCounts as Array<{
                  screenId?: string;
                  screenName?: string;
                  elements?: number;
                }>)
              : [];
            const truncatedScreens = Array.isArray(raw.truncatedScreens)
              ? (raw.truncatedScreens as Array<{
                  screenId?: string;
                  screenName?: string;
                  originalElements?: number;
                  retainedElements?: number;
                  originalCount?: number;
                  truncatedCount?: number;
                }>)
              : [];
            const depthTruncated = raw.depthTruncatedScreens as
              | Array<{
                  screenId?: string;
                  screenName?: string;
                  maxDepth?: number;
                  firstTruncatedDepth?: number;
                  truncatedBranchCount?: number;
                  depthLimit?: number;
                }>
              | undefined;
            const classificationFb = raw.classificationFallbacks as
              | Array<{
                  nodeId: string;
                  original: string;
                  fallback: string;
                }>
              | undefined;
            generationMetrics = {
              fetchedNodes:
                typeof raw.fetchedNodes === "number" ? raw.fetchedNodes : 0,
              skippedHidden:
                typeof raw.skippedHidden === "number" ? raw.skippedHidden : 0,
              skippedPlaceholders:
                typeof raw.skippedPlaceholders === "number"
                  ? raw.skippedPlaceholders
                  : 0,
              screenElementCounts: screenElementCounts
                .filter(
                  (entry): entry is {
                    screenId: string;
                    screenName?: string;
                    elements?: number;
                  } => typeof entry.screenId === "string",
                )
                .map((entry) => ({
                  screenId: entry.screenId,
                  screenName: entry.screenName ?? entry.screenId,
                  elements: entry.elements ?? 0,
                })),
              truncatedScreens: truncatedScreens
                .filter(
                  (entry): entry is {
                    screenId: string;
                    screenName?: string;
                    originalElements?: number;
                    retainedElements?: number;
                    originalCount?: number;
                    truncatedCount?: number;
                  } => typeof entry.screenId === "string",
                )
                .map((entry) => ({
                  screenId: entry.screenId,
                  screenName: entry.screenName ?? entry.screenId,
                  originalElements:
                    entry.originalElements ?? entry.originalCount ?? 0,
                  retainedElements:
                    entry.retainedElements ?? entry.truncatedCount ?? 0,
                })),
              ...(depthTruncated
                ? {
                    depthTruncatedScreens: depthTruncated
                      .filter(
                        (entry): entry is {
                          screenId: string;
                          screenName?: string;
                          maxDepth?: number;
                          firstTruncatedDepth?: number;
                          truncatedBranchCount?: number;
                          depthLimit?: number;
                        } => typeof entry.screenId === "string",
                      )
                      .map((entry) => ({
                        screenId: entry.screenId,
                        screenName: entry.screenName ?? entry.screenId,
                        maxDepth: entry.maxDepth ?? entry.depthLimit ?? 0,
                        firstTruncatedDepth:
                          entry.firstTruncatedDepth ??
                          entry.maxDepth ??
                          entry.depthLimit ??
                          0,
                        truncatedBranchCount: entry.truncatedBranchCount ?? 0,
                      })),
                  }
                : {}),
              degradedGeometryNodes: Array.isArray(raw.degradedGeometryNodes)
                ? (raw.degradedGeometryNodes as string[])
                : [],
              ...(classificationFb
                ? { classificationFallbacks: classificationFb }
                : {}),
            };
          } catch {
            ctx.log({
              level: "warn",
              message:
                "Could not parse generation-metrics.json for confidence scoring; continuing without generation metrics.",
            });
          }
        }

        const componentMatch: ConfidenceScoringInput["componentMatch"] =
          matchReport
            ? {
                totalFigmaFamilies: matchReport.summary.totalFigmaFamilies,
                matched: matchReport.summary.matched,
                ambiguous: matchReport.summary.ambiguous,
                unmatched: matchReport.summary.unmatched,
                entries: matchReport.entries.map((e) => ({
                  figmaFamilyKey: e.figma.familyKey,
                  figmaFamilyName: e.figma.familyName,
                  matchStatus: e.match.status,
                  confidence: e.match.confidence,
                  confidenceScore: e.match.confidenceScore,
                  aliases: [
                    e.figma.familyKey,
                    e.figma.familyName,
                    e.figma.canonicalFamilyName,
                    e.storybookFamily?.name,
                    e.storybookFamily?.title,
                    e.libraryResolution.componentKey,
                    e.resolvedApi?.componentKey,
                  ].filter((alias): alias is string => Boolean(alias)),
                })),
              }
            : undefined;

        let screenComponents:
          | ConfidenceScoringInput["screenComponents"]
          | undefined;
        const componentManifestPath = await ctx.artifactStore.getPath(
          STAGE_ARTIFACT_KEYS.componentManifest,
        );
        if (componentManifestPath && componentMatch) {
          try {
            const manifest = JSON.parse(
              await readFile(componentManifestPath, "utf8"),
            ) as ComponentManifest;
            const entriesWithAliases = componentMatch.entries.map((entry) => ({
              ...entry,
              normalizedAliases: [
                ...new Set(
                  (entry.aliases ?? [])
                    .map((alias) => normalizeComponentAlias(alias))
                    .filter((alias) => alias.length > 0),
                ),
              ],
            }));

            const pickComponentId = ({
              irNodeName,
              irNodeType,
            }: {
              irNodeName: string;
              irNodeType: string;
            }): string | undefined => {
              const normalizedName = normalizeComponentAlias(irNodeName);
              const normalizedType = normalizeComponentAlias(irNodeType);
              if (normalizedName.length === 0 && normalizedType.length === 0) {
                return undefined;
              }
              const nameMatches = entriesWithAliases.filter((entry) =>
                entry.normalizedAliases.includes(normalizedName),
              );
              if (nameMatches.length === 1) {
                return nameMatches[0]!.figmaFamilyKey;
              }
              if (nameMatches.length > 1) {
                return undefined;
              }

              const typeMatches = entriesWithAliases.filter((entry) =>
                entry.normalizedAliases.includes(normalizedType),
              );
              if (typeMatches.length === 1) {
                return typeMatches[0]!.figmaFamilyKey;
              }
              return undefined;
            };

            screenComponents = manifest.screens
              .map((screen) => ({
                screenId: screen.screenId,
                componentIds: [
                  ...new Set(
                    screen.components
                      .map((component) =>
                        pickComponentId({
                          irNodeName: component.irNodeName,
                          irNodeType: component.irNodeType,
                        }),
                      )
                      .filter((componentId): componentId is string =>
                        Boolean(componentId),
                      ),
                  ),
                ],
              }))
              .filter((screen) => screen.componentIds.length > 0);
          } catch {
            ctx.log({
              level: "warn",
              message:
                "Could not parse component-manifest.json for confidence scoring; continuing without screen component ownership.",
            });
          }
        }

        const storybookEvidence: ConfidenceScoringInput["storybookEvidence"] =
          evidenceArtifact
            ? {
                entryCount: evidenceArtifact.stats.entryCount,
                evidenceCount: evidenceArtifact.stats.evidenceCount,
                byReliability: {
                  authoritative:
                    evidenceArtifact.stats.byReliability.authoritative,
                  reference_only:
                    evidenceArtifact.stats.byReliability.reference_only,
                  derived: evidenceArtifact.stats.byReliability.derived,
                },
              }
            : undefined;

        let visualQuality: ConfidenceScoringInput["visualQuality"] | undefined;
        if (
          visualReport.status === "completed" &&
          typeof visualReport.overallScore === "number"
        ) {
          const dims = visualReport.dimensions?.map((d) => ({
            name: d.name,
            score: d.score,
            weight: d.weight,
          }));
          const spots = visualReport.hotspots?.map((h) => ({
            severity: h.severity,
            category: h.category,
          }));
          visualQuality = {
            overallScore: visualReport.overallScore,
            ...(dims ? { dimensions: dims } : {}),
            ...(spots ? { hotspots: spots } : {}),
            ...(visualReport.componentAggregateScore !== undefined
              ? {
                  componentAggregateScore: visualReport.componentAggregateScore,
                }
              : {}),
          };
        }

        return {
          diagnostics: ctx.getCollectedDiagnostics() ?? [],
          ...(generationMetrics ? { generationMetrics } : {}),
          ...(componentMatch ? { componentMatch } : {}),
          ...(screenComponents ? { screenComponents } : {}),
          ...(storybookEvidence ? { storybookEvidence } : {}),
          ...(visualQuality ? { visualQuality } : {}),
          validationPassed: passed,
        };
      };

      const computeAndPersistConfidence = async ({
        ctx,
        validationPassed: passed,
        matchReport,
        evidenceArtifact,
        visualReport,
      }: {
        ctx: Parameters<StageService<void>["execute"]>[1];
        validationPassed: boolean;
        matchReport: ComponentMatchReportArtifact | undefined;
        evidenceArtifact: StorybookEvidenceArtifact | undefined;
        visualReport: WorkspaceVisualQualityReport;
      }): Promise<WorkspaceJobConfidence> => {
        try {
          const scoringInput = await buildConfidenceInput({
            ctx,
            validationPassed: passed,
            matchReport,
            evidenceArtifact,
            visualReport,
          });
          const confidenceResult = computeConfidenceReport(scoringInput);

          const jobConfidence: WorkspaceJobConfidence = {
            status: "completed",
            generatedAt: new Date().toISOString(),
            level: confidenceResult.level,
            score: confidenceResult.score,
            contributors: confidenceResult.contributors,
            screens: confidenceResult.screens,
            ...(confidenceResult.lowConfidenceSummary.length > 0
              ? { lowConfidenceSummary: confidenceResult.lowConfidenceSummary }
              : {}),
          };

          const confidenceReportPath = path.join(
            ctx.paths.jobDir,
            "confidence-report.json",
          );
          await writeFile(
            confidenceReportPath,
            toJsonFileContent(jobConfidence),
            "utf8",
          );
          ctx.job.artifacts.confidenceReportFile = confidenceReportPath;
          await ctx.artifactStore.setPath({
            key: STAGE_ARTIFACT_KEYS.confidenceReport,
            stage: "validate.project",
            absolutePath: confidenceReportPath,
          });
          await ctx.artifactStore.setValue({
            key: STAGE_ARTIFACT_KEYS.confidenceResult,
            stage: "validate.project",
            value: jobConfidence,
          });
          ctx.job.confidence = jobConfidence;

          ctx.log({
            level: "info",
            message: `Confidence scoring completed: ${confidenceResult.level} (${String(confidenceResult.score)}/100)`,
          });

          return jobConfidence;
        } catch (error) {
          const message =
            error instanceof Error
              ? error.message
              : "Confidence scoring failed.";
          ctx.log({
            level: "warn",
            message: `Confidence scoring failed without blocking validate.project: ${message}`,
          });
          return { status: "failed", message };
        }
      };

      const failVisualAudit = async ({
        code,
        message,
        suggestion,
        details,
        cause,
      }: {
        code: string;
        message: string;
        suggestion: string;
        details?: Record<string, unknown>;
        cause?: unknown;
      }): Promise<never> => {
        const warnings = [
          message,
          ...(visualAuditResult.warnings ?? []).filter(
            (warning) => warning !== message,
          ),
        ];
        await persistVisualAuditResult({
          status: "failed",
          ...(visualAuditRequest
            ? { baselineImagePath: visualAuditRequest.baselineImagePath }
            : {}),
          ...(visualAuditReferenceImagePath
            ? { referenceImagePath: visualAuditReferenceImagePath }
            : {}),
          ...(visualAuditActualImagePath
            ? { actualImagePath: visualAuditActualImagePath }
            : {}),
          ...(visualAuditDiffImagePath
            ? { diffImagePath: visualAuditDiffImagePath }
            : {}),
          ...(visualAuditReportPath
            ? { reportPath: visualAuditReportPath }
            : {}),
          warnings,
        });
        const summary = await buildSummary();
        await persistValidationSummaryArtifacts({
          context,
          summary,
        });
        throw createPipelineError({
          code,
          stage: "validate.project",
          message,
          cause,
          limits: context.runtime.pipelineDiagnosticLimits,
          diagnostics: [
            {
              code,
              message,
              suggestion,
              stage: "validate.project",
              severity: "error",
              ...(details ? { details } : {}),
            },
          ],
        });
      };

      const componentMatchReportPath = await context.artifactStore.getPath(
        STAGE_ARTIFACT_KEYS.componentMatchReport,
      );
      const storybookCatalogPath = await context.artifactStore.getPath(
        STAGE_ARTIFACT_KEYS.storybookCatalog,
      );
      const storybookEvidencePath = await context.artifactStore.getPath(
        STAGE_ARTIFACT_KEYS.storybookEvidence,
      );
      const storybookTokensPath = await context.artifactStore.getPath(
        STAGE_ARTIFACT_KEYS.storybookTokens,
      );
      const storybookThemesPath = await context.artifactStore.getPath(
        STAGE_ARTIFACT_KEYS.storybookThemes,
      );
      const storybookComponentsPath = await context.artifactStore.getPath(
        STAGE_ARTIFACT_KEYS.storybookComponents,
      );
      const storybookComponentVisualCatalogPath =
        await context.artifactStore.getPath(
          STAGE_ARTIFACT_KEYS.componentVisualCatalog,
        );
      const isStorybookRequested = Boolean(context.requestedStorybookStaticDir);
      if (componentMatchReportPath) {
        try {
          componentMatchReportArtifact = parseComponentMatchReportArtifact({
            input: await readFile(componentMatchReportPath, "utf8"),
          });
        } catch (error) {
          throw createPipelineError({
            code: "E_COMPONENT_MATCH_REPORT_INVALID",
            stage: "validate.project",
            message: "component.match_report is unreadable or malformed.",
            cause: error,
            limits: context.runtime.pipelineDiagnosticLimits,
          });
        }

        const compositionCoverage = buildStorybookCompositionCoverage({
          artifact: componentMatchReportArtifact,
        });
        if (compositionCoverage.unmatched > 0) {
          context.log({
            level: "warn",
            message:
              `Storybook composition: ${compositionCoverage.unmatched} of ${compositionCoverage.totalFigmaFamilies} ` +
              `Figma familie(s) have no Storybook match.`,
          });
        }
        if (compositionCoverage.ambiguous > 0) {
          context.log({
            level: "warn",
            message: `Storybook composition: ${compositionCoverage.ambiguous} Figma familie(s) have ambiguous Storybook matches.`,
          });
        }
        if (compositionCoverage.docsOnlyReferenceCount > 0) {
          context.log({
            level: "warn",
            message:
              `Storybook composition: ${compositionCoverage.docsOnlyReferenceCount} matched familie(s) rely on ` +
              `docs-only references without authoritative evidence: ${compositionCoverage.docsOnlyFamilyNames.join(", ")}.`,
          });
        }
      }

      if (isStorybookRequested) {
        const storybookArtifactPaths: Record<
          StorybookArtifactKey,
          string | undefined
        > = {
          catalog: storybookCatalogPath,
          evidence: storybookEvidencePath,
          tokens: storybookTokensPath,
          themes: storybookThemesPath,
          components: storybookComponentsPath,
          componentVisualCatalog: storybookComponentVisualCatalogPath,
        };
        const persistAndThrowInvalidStorybookArtifact = async ({
          artifactKey,
          cause,
        }: {
          artifactKey: StorybookArtifactKey;
          cause: unknown;
        }): Promise<never> => {
          const summary = await buildSummary({
            storybookArtifactStatusOverrides: {
              [artifactKey]: "invalid",
            },
          });
          await persistValidationSummaryArtifacts({
            context,
            summary,
          });
          const failedArtifacts = listFailedStorybookArtifacts({
            artifacts:
              summary.storybook.status === "not_requested"
                ? {
                    catalog: { status: "not_available" },
                    evidence: { status: "not_available" },
                    tokens: { status: "not_available" },
                    themes: { status: "not_available" },
                    components: { status: "not_available" },
                    componentVisualCatalog: { status: "not_available" },
                  }
                : summary.storybook.artifacts,
          });
          throw createPipelineError({
            code: "E_STORYBOOK_STYLE_ARTIFACT_INVALID",
            stage: "validate.project",
            message: "Storybook artifacts are unreadable or malformed.",
            cause,
            limits: context.runtime.pipelineDiagnosticLimits,
            diagnostics: buildStorybookGateDiagnostics({
              artifacts: failedArtifacts,
            }),
          });
        };
        const parseStorybookArtifact = async <T>({
          artifactKey,
          filePath,
          parse,
        }: {
          artifactKey: StorybookArtifactKey;
          filePath: string | undefined;
          parse: ({ input }: { input: string }) => T;
        }): Promise<T | undefined> => {
          if (!filePath) {
            return undefined;
          }
          try {
            return parse({
              input: await readFile(filePath, "utf8"),
            });
          } catch (error) {
            return persistAndThrowInvalidStorybookArtifact({
              artifactKey,
              cause: error,
            });
          }
        };
        await parseStorybookArtifact({
          artifactKey: "catalog",
          filePath: storybookCatalogPath,
          parse: parseStorybookCatalogArtifact,
        });
        storybookEvidenceArtifact = await parseStorybookArtifact({
          artifactKey: "evidence",
          filePath: storybookEvidencePath,
          parse: parseStorybookEvidenceArtifact,
        });
        storybookTokensArtifact = await parseStorybookArtifact({
          artifactKey: "tokens",
          filePath: storybookTokensPath,
          parse: parseStorybookTokensArtifact,
        });
        storybookThemesArtifact = await parseStorybookArtifact({
          artifactKey: "themes",
          filePath: storybookThemesPath,
          parse: parseStorybookThemesArtifact,
        });
        await parseStorybookArtifact({
          artifactKey: "components",
          filePath: storybookComponentsPath,
          parse: parseStorybookComponentsArtifact,
        });
        await parseStorybookArtifact({
          artifactKey: "componentVisualCatalog",
          filePath: storybookComponentVisualCatalogPath,
          parse: parseStorybookComponentVisualCatalogArtifact,
        });

        const missingRequiredStorybookArtifacts =
          STORYBOOK_ARTIFACT_DESCRIPTORS.filter(
            ({ key }) => !storybookArtifactPaths[key],
          );
        if (missingRequiredStorybookArtifacts.length > 0) {
          const summary = await buildSummary();
          await persistValidationSummaryArtifacts({
            context,
            summary,
          });
          throw createPipelineError({
            code: "E_STORYBOOK_VALIDATION_FAILED",
            stage: "validate.project",
            message: buildStorybookGateMessage({
              artifacts: missingRequiredStorybookArtifacts.map((artifact) => ({
                ...artifact,
                status: "missing" as const,
              })),
            }),
            limits: context.runtime.pipelineDiagnosticLimits,
            diagnostics: buildStorybookGateDiagnostics({
              artifacts: missingRequiredStorybookArtifacts.map((artifact) => ({
                ...artifact,
                status: "missing" as const,
              })),
            }),
          });
        }
      }

      if (context.resolvedCustomerProfile && componentMatchReportArtifact) {
        customerProfileMatchSummary =
          validateCustomerProfileComponentMatchReport({
            artifact: componentMatchReportArtifact,
            customerProfile: context.resolvedCustomerProfile,
          });
        customerProfileComponentApiSummary =
          validateCustomerProfileComponentApiComponentMatchReport({
            artifact: componentMatchReportArtifact,
            customerProfile: context.resolvedCustomerProfile,
          });
        if (customerProfileMatchSummary.issueCount > 0) {
          const logLevel =
            customerProfileMatchSummary.policy === "warn"
              ? "warn"
              : customerProfileMatchSummary.policy === "error"
                ? "error"
                : "info";
          context.log({
            level: logLevel,
            message:
              `Customer profile match policy reported ${customerProfileMatchSummary.issueCount} issue(s) ` +
              `(policy=${customerProfileMatchSummary.policy}).`,
          });
        }
        if (customerProfileComponentApiSummary.issueCount > 0) {
          const logLevel =
            customerProfileComponentApiSummary.status === "failed"
              ? "error"
              : "warn";
          context.log({
            level: logLevel,
            message:
              `Customer profile component API gate reported ${customerProfileComponentApiSummary.issueCount} issue(s) ` +
              `(status=${customerProfileComponentApiSummary.status}).`,
          });
        }
        if (customerProfileMatchSummary.status === "failed") {
          const summary = await buildSummary();
          await persistValidationSummaryArtifacts({
            context,
            summary,
          });
          throw createPipelineError({
            code: "E_CUSTOMER_PROFILE_MATCH_POLICY",
            stage: "validate.project",
            message: `Customer profile match policy failed with ${customerProfileMatchSummary.issueCount} issue(s).`,
            limits: context.runtime.pipelineDiagnosticLimits,
            diagnostics: customerProfileMatchSummary.issues.map((issue) => ({
              code: "E_CUSTOMER_PROFILE_MATCH_POLICY",
              message: issue.message,
              suggestion:
                "Fix the Storybook tier aliases, customer profile component import matrix, or fallback policy so the match report resolves deterministically.",
              stage: "validate.project",
              severity: "error",
              details: {
                figmaFamilyKey: issue.figmaFamilyKey,
                figmaFamilyName: issue.figmaFamilyName,
                status: issue.status,
                reason: issue.reason,
                ...(issue.componentKey
                  ? { componentKey: issue.componentKey }
                  : {}),
                ...(issue.storybookTier
                  ? { storybookTier: issue.storybookTier }
                  : {}),
                ...(issue.profileFamily
                  ? { profileFamily: issue.profileFamily }
                  : {}),
              },
            })),
          });
        }
        if (customerProfileComponentApiSummary.status === "failed") {
          const summary = await buildSummary();
          await persistValidationSummaryArtifacts({
            context,
            summary,
          });
          throw createPipelineError({
            code: "E_CUSTOMER_PROFILE_COMPONENT_API_POLICY",
            stage: "validate.project",
            message: `Customer profile component API gate failed with ${customerProfileComponentApiSummary.issueCount} issue(s).`,
            limits: context.runtime.pipelineDiagnosticLimits,
            diagnostics: customerProfileComponentApiSummary.issues.map(
              (issue) => ({
                code: issue.code,
                message: issue.message,
                suggestion:
                  "Align the customer component contract with the Storybook public API, or allow explicit MUI fallback for that component.",
                stage: "validate.project",
                severity: issue.severity === "error" ? "error" : "warning",
                details: {
                  figmaFamilyKey: issue.figmaFamilyKey,
                  figmaFamilyName: issue.figmaFamilyName,
                  ...(issue.componentKey
                    ? { componentKey: issue.componentKey }
                    : {}),
                  ...(issue.sourceProp ? { sourceProp: issue.sourceProp } : {}),
                  ...(issue.targetProp ? { targetProp: issue.targetProp } : {}),
                },
              }),
            ),
          });
        }
      }

      if (context.resolvedCustomerProfile) {
        if (!storybookEvidenceArtifact) {
          try {
            storybookEvidenceArtifact = storybookEvidencePath
              ? parseStorybookEvidenceArtifact({
                  input: await readFile(storybookEvidencePath, "utf8"),
                })
              : undefined;
          } catch (error) {
            throw createPipelineError({
              code: "E_STORYBOOK_STYLE_ARTIFACT_INVALID",
              stage: "validate.project",
              message: "Storybook style artifacts are unreadable or malformed.",
              cause: error,
              limits: context.runtime.pipelineDiagnosticLimits,
            });
          }
        }
        if (!storybookTokensArtifact) {
          try {
            storybookTokensArtifact = storybookTokensPath
              ? parseStorybookTokensArtifact({
                  input: await readFile(storybookTokensPath, "utf8"),
                })
              : undefined;
          } catch (error) {
            throw createPipelineError({
              code: "E_STORYBOOK_STYLE_ARTIFACT_INVALID",
              stage: "validate.project",
              message: "Storybook style artifacts are unreadable or malformed.",
              cause: error,
              limits: context.runtime.pipelineDiagnosticLimits,
            });
          }
        }
        if (!storybookThemesArtifact) {
          try {
            storybookThemesArtifact = storybookThemesPath
              ? parseStorybookThemesArtifact({
                  input: await readFile(storybookThemesPath, "utf8"),
                })
              : undefined;
          } catch (error) {
            throw createPipelineError({
              code: "E_STORYBOOK_STYLE_ARTIFACT_INVALID",
              stage: "validate.project",
              message: "Storybook style artifacts are unreadable or malformed.",
              cause: error,
              limits: context.runtime.pipelineDiagnosticLimits,
            });
          }
        }
        customerProfileStyleSummary =
          await validateGeneratedProjectStorybookStyles({
            generatedProjectDir,
            customerProfile: context.resolvedCustomerProfile,
            isStorybookFirstRequested: Boolean(
              context.requestedStorybookStaticDir ??
              context.resolvedStorybookStaticDir,
            ),
            ...(storybookEvidenceArtifact ? { storybookEvidenceArtifact } : {}),
            ...(storybookTokensArtifact ? { storybookTokensArtifact } : {}),
            ...(storybookThemesArtifact ? { storybookThemesArtifact } : {}),
            ...(componentMatchReportArtifact
              ? { componentMatchReportArtifact }
              : {}),
          });
        if (customerProfileStyleSummary.issueCount > 0) {
          const logLevel =
            customerProfileStyleSummary.status === "failed"
              ? "error"
              : customerProfileStyleSummary.status === "warn"
                ? "warn"
                : "info";
          context.log({
            level: logLevel,
            message:
              `Storybook-first style guard reported ${customerProfileStyleSummary.issueCount} issue(s) ` +
              `(policy=${customerProfileStyleSummary.policy}, status=${customerProfileStyleSummary.status}).`,
          });
        }
        if (customerProfileStyleSummary.status === "failed") {
          const summary = await buildSummary();
          await persistValidationSummaryArtifacts({
            context,
            summary,
          });
          throw createPipelineError({
            code: "E_CUSTOMER_PROFILE_STYLE_POLICY",
            stage: "validate.project",
            message: `Storybook-first style guard failed with ${customerProfileStyleSummary.issueCount} issue(s).`,
            limits: context.runtime.pipelineDiagnosticLimits,
            diagnostics: customerProfileStyleSummary.issues.map((issue) => ({
              code: issue.diagnosticCode ?? issue.category,
              message: issue.message,
              suggestion:
                "Use Storybook-derived theme or token references, and only forward props allowed by the resolved customer component API.",
              stage: "validate.project",
              severity: issue.severity,
              details: {
                category: issue.category,
                ...(issue.filePath ? { filePath: issue.filePath } : {}),
                ...(issue.line ? { line: issue.line } : {}),
                ...(issue.column ? { column: issue.column } : {}),
                ...(issue.componentName
                  ? { componentName: issue.componentName }
                  : {}),
                ...(issue.propName ? { propName: issue.propName } : {}),
                ...(issue.themeId ? { themeId: issue.themeId } : {}),
                ...(issue.tokenPath ? { tokenPath: issue.tokenPath } : {}),
                ...(issue.artifact ? { artifact: issue.artifact } : {}),
                ...(issue.evidenceTypes
                  ? { evidenceTypes: issue.evidenceTypes }
                  : {}),
              },
            })),
          });
        }
      }

      if (context.resolvedCustomerProfile) {
        customerProfileImportSummary =
          await validateGeneratedProjectCustomerProfile({
            generatedProjectDir,
            customerProfile: context.resolvedCustomerProfile,
          });
        if (customerProfileImportSummary.import.issueCount > 0) {
          const logLevel =
            customerProfileImportSummary.import.policy === "warn"
              ? "warn"
              : customerProfileImportSummary.import.policy === "error"
                ? "error"
                : "info";
          context.log({
            level: logLevel,
            message:
              `Customer profile import policy reported ${customerProfileImportSummary.import.issueCount} issue(s) ` +
              `(policy=${customerProfileImportSummary.import.policy}).`,
          });
        }
        if (customerProfileImportSummary.status === "failed") {
          const summary = await buildSummary();
          await persistValidationSummaryArtifacts({
            context,
            summary,
          });
          throw createPipelineError({
            code: "E_CUSTOMER_PROFILE_IMPORT_POLICY",
            stage: "validate.project",
            message: `Customer profile import policy failed with ${customerProfileImportSummary.import.issueCount} issue(s).`,
            limits: context.runtime.pipelineDiagnosticLimits,
            diagnostics: customerProfileImportSummary.import.issues.map(
              (issue) => ({
                code: issue.code,
                message: issue.message,
                suggestion:
                  "Update the customer profile import matrix, template config, or generated imports so they agree.",
                stage: "validate.project",
                severity: "error",
                details: {
                  ...(issue.filePath ? { filePath: issue.filePath } : {}),
                  ...(issue.modulePath ? { modulePath: issue.modulePath } : {}),
                },
              }),
            ),
          });
        }
      }

      const hasCustomerProfileDeps = context.resolvedCustomerProfile
        ? Object.keys(context.resolvedCustomerProfile.template.dependencies)
            .length > 0 ||
          Object.keys(context.resolvedCustomerProfile.template.devDependencies)
            .length > 0
        : false;

      try {
        validationResult = await runProjectValidationFn({
          generatedProjectDir,
          jobDir: context.paths.jobDir,
          enableLintAutofix: context.runtime.enableLintAutofix,
          enablePerfValidation: context.runtime.enablePerfValidation,
          enableUiValidation: context.runtime.enableUiValidation,
          enableUnitTestValidation: context.runtime.enableUnitTestValidation,
          unitTestIgnoreFailure: context.runtime.unitTestIgnoreFailure,
          commandTimeoutMs: context.runtime.commandTimeoutMs,
          commandStdoutMaxBytes: context.runtime.commandStdoutMaxBytes,
          commandStderrMaxBytes: context.runtime.commandStderrMaxBytes,
          installPreferOffline: context.runtime.installPreferOffline,
          skipInstall: context.runtime.skipInstall,
          lockfileMutable: hasCustomerProfileDeps,
          maxValidationAttempts: context.runtime.maxValidationAttempts,
          pipelineDiagnosticLimits: context.runtime.pipelineDiagnosticLimits,
          seedNodeModulesDir: path.join(
            context.paths.templateRoot,
            "node_modules",
          ),
          abortSignal: context.abortSignal,
          onLog: (message) => {
            context.log({
              level: "debug",
              message,
            });
          },
        });
      } catch (error) {
        const failedCommand = extractFailedCommandFromPipelineError(error);
        await persistVisualAuditResult({
          status: visualAuditRequest ? "failed" : "not_requested",
          ...(visualAuditRequest
            ? {
                baselineImagePath: visualAuditRequest.baselineImagePath,
                warnings: [
                  "Visual audit did not run because generated-project validation failed before the audit step.",
                ],
              }
            : {}),
        });
        const failureSummary = await buildSummary({
          generatedAppFailure: { failedCommand },
        });
        await persistValidationSummaryArtifacts({
          context,
          summary: failureSummary,
        });
        throw error;
      }
      if (!visualAuditRequest) {
        await persistVisualAuditResult({
          status: "not_requested",
        });
      } else {
        const resolvedBaselineSourcePath = path.resolve(
          context.resolvedWorkspaceRoot,
          visualAuditRequest.baselineImagePath,
        );
        if (
          !isWithinRoot({
            candidatePath: resolvedBaselineSourcePath,
            rootPath: context.resolvedWorkspaceRoot,
          })
        ) {
          await failVisualAudit({
            code: "E_VISUAL_AUDIT_BASELINE_PATH_INVALID",
            message: `Visual audit baseline '${visualAuditRequest.baselineImagePath}' resolves outside the workspace root.`,
            suggestion:
              "Provide a baseline image path that stays inside the workspace root.",
            details: {
              baselineImagePath: visualAuditRequest.baselineImagePath,
              resolvedBaselinePath: resolvedBaselineSourcePath,
              workspaceRoot: context.resolvedWorkspaceRoot,
            },
          });
        }

        const referenceBuffer = await (async (): Promise<Buffer> => {
          try {
            return await readFile(resolvedBaselineSourcePath);
          } catch (error) {
            return failVisualAudit({
              code: "E_VISUAL_AUDIT_BASELINE_MISSING",
              message: `Visual audit baseline '${visualAuditRequest.baselineImagePath}' is missing or unreadable.`,
              suggestion:
                "Add the baseline PNG inside the workspace root before running validate.project.",
              details: {
                baselineImagePath: visualAuditRequest.baselineImagePath,
                resolvedBaselinePath: resolvedBaselineSourcePath,
              },
              cause: error,
            });
          }
        })();

        const visualAuditDir = path.join(context.paths.jobDir, "visual-audit");
        try {
          await mkdir(visualAuditDir, { recursive: true });
        } catch (error) {
          await failVisualAudit({
            code: "E_VISUAL_AUDIT_ARTIFACT_DIR_FAILED",
            message: "Visual audit artifact directory could not be created.",
            suggestion:
              "Ensure the job output directory is writable before running validate.project.",
            details: {
              visualAuditDir,
            },
            cause: error,
          });
        }

        const referenceImagePath = path.join(visualAuditDir, "reference.png");
        try {
          await writeFile(referenceImagePath, referenceBuffer);
          await persistVisualAuditArtifactPath({
            key: STAGE_ARTIFACT_KEYS.visualAuditReferenceImage,
            absolutePath: referenceImagePath,
          });
        } catch (error) {
          await failVisualAudit({
            code: "E_VISUAL_AUDIT_REFERENCE_WRITE_FAILED",
            message: "Visual audit reference image could not be written.",
            suggestion:
              "Ensure the job output directory is writable before running validate.project.",
            details: {
              referenceImagePath,
              resolvedBaselinePath: resolvedBaselineSourcePath,
            },
            cause: error,
          });
        }

        const distDir = path.join(generatedProjectDir, "dist");
        const distIndexPath = path.join(distDir, "index.html");
        try {
          await access(distIndexPath);
        } catch (error) {
          await failVisualAudit({
            code: "E_VISUAL_AUDIT_BUILD_OUTPUT_MISSING",
            message:
              "Visual audit requires build output at 'dist/index.html', but that file is missing.",
            suggestion:
              "Make sure the generated project build writes a static dist bundle before the visual audit runs.",
            details: {
              distDir,
              distIndexPath,
              generatedProjectDir,
            },
            cause: error,
          });
        }

        const captureConfig = visualAuditRequest.capture as
          | Parameters<typeof captureFromProjectFn>[0]["config"]
          | undefined;
        const captureResult = await (async (): Promise<
          Awaited<ReturnType<typeof captureFromProjectFn>>
        > => {
          try {
            return await captureFromProjectFn({
              projectDir: distDir,
              ...(captureConfig ? { config: captureConfig } : {}),
              onLog: (message) => {
                context.log({
                  level: "info",
                  message: `Visual audit capture: ${message}`,
                });
              },
            });
          } catch (error) {
            return failVisualAudit({
              code: "E_VISUAL_AUDIT_CAPTURE_FAILED",
              message:
                "Visual audit could not capture the generated dist bundle.",
              suggestion:
                "Inspect the built dist bundle and capture settings, then rerun validate.project.",
              details: {
                distDir,
                distIndexPath,
              },
              cause: error,
            });
          }
        })();

        const actualImagePath = path.join(visualAuditDir, "actual.png");
        try {
          await writeFile(actualImagePath, captureResult.screenshotBuffer);
          await persistVisualAuditArtifactPath({
            key: STAGE_ARTIFACT_KEYS.visualAuditActualImage,
            absolutePath: actualImagePath,
          });
        } catch (error) {
          await failVisualAudit({
            code: "E_VISUAL_AUDIT_ACTUAL_WRITE_FAILED",
            message:
              "Visual audit captured a screenshot but could not persist it.",
            suggestion:
              "Ensure the job output directory is writable before running validate.project.",
            details: {
              actualImagePath,
            },
            cause: error,
          });
        }

        const compareConfig = visualAuditRequest.diff as
          | Parameters<typeof comparePngBuffersFn>[0]["config"]
          | undefined;
        const compareRegions = visualAuditRequest.regions as
          | Parameters<typeof comparePngBuffersFn>[0]["regions"]
          | undefined;
        const diffResult = await (async (): Promise<
          ReturnType<typeof comparePngBuffersFn>
        > => {
          try {
            return comparePngBuffersFn({
              referenceBuffer,
              testBuffer: captureResult.screenshotBuffer,
              ...(compareConfig ? { config: compareConfig } : {}),
              ...(compareRegions ? { regions: compareRegions } : {}),
            });
          } catch (error) {
            return failVisualAudit({
              code: "E_VISUAL_AUDIT_COMPARE_FAILED",
              message:
                "Visual audit could not compare the baseline and captured screenshots.",
              suggestion:
                "Align the baseline image and capture configuration so both images are comparable.",
              details: {
                baselineImagePath: visualAuditRequest.baselineImagePath,
                referenceImagePath,
                actualImagePath,
              },
              cause: error,
            });
          }
        })();

        const diffImagePath = path.join(visualAuditDir, "diff.png");
        try {
          await writeDiffImage({
            diffImageBuffer: diffResult.diffImageBuffer,
            outputPath: diffImagePath,
          });
          await persistVisualAuditArtifactPath({
            key: STAGE_ARTIFACT_KEYS.visualAuditDiffImage,
            absolutePath: diffImagePath,
          });
        } catch (error) {
          await failVisualAudit({
            code: "E_VISUAL_AUDIT_DIFF_WRITE_FAILED",
            message:
              "Visual audit computed a diff image but could not persist it.",
            suggestion:
              "Ensure the job output directory is writable before running validate.project.",
            details: {
              diffImagePath,
            },
            cause: error,
          });
        }

        const finalizedVisualAuditResult = cloneVisualAuditResult({
          status: diffResult.diffPixelCount > 0 ? "warn" : "ok",
          baselineImagePath: visualAuditRequest.baselineImagePath,
          referenceImagePath,
          actualImagePath,
          diffImagePath,
          similarityScore: diffResult.similarityScore,
          diffPixelCount: diffResult.diffPixelCount,
          totalPixels: diffResult.totalPixels,
          regions: diffResult.regions.map((region) => ({ ...region })),
          ...(diffResult.diffPixelCount > 0
            ? {
                warnings: [
                  `Visual audit detected ${String(diffResult.diffPixelCount)} differing pixel(s) across ${String(diffResult.totalPixels)} total pixel(s).`,
                ],
              }
            : {}),
        });

        const reportPath = path.join(visualAuditDir, "report.json");
        const visualQualityScoringReport = (() => {
          try {
            return computeVisualQualityReport({
              diffResult,
              comparedAt: validatedAt,
              diffImagePath,
              viewport: captureResult.viewport,
            });
          } catch (error) {
            return failVisualAudit({
              code: "E_VISUAL_AUDIT_REPORT_BUILD_FAILED",
              message:
                "Visual audit completed, but the structured quality report could not be generated.",
              suggestion:
                "Inspect the visual scoring configuration and report metadata inputs, then rerun validate.project.",
              details: {
                diffImagePath,
                actualImagePath,
                referenceImagePath,
              },
              cause: error,
            });
          }
        })();
        try {
          await writeFile(
            reportPath,
            toJsonFileContent(await visualQualityScoringReport),
            "utf8",
          );
          await persistVisualAuditArtifactPath({
            key: STAGE_ARTIFACT_KEYS.visualAuditReport,
            absolutePath: reportPath,
          });
        } catch (error) {
          await failVisualAudit({
            code: "E_VISUAL_AUDIT_REPORT_WRITE_FAILED",
            message:
              "Visual audit completed but could not persist the JSON report.",
            suggestion:
              "Ensure the job output directory is writable before running validate.project.",
            details: {
              reportPath,
            },
            cause: error,
          });
        }

        finalizedVisualAuditResult.reportPath = reportPath;
        await persistVisualAuditResult(finalizedVisualAuditResult);
        if (!shouldRunStandaloneVisualQuality) {
          await persistVisualQualityResult(
            createCompletedVisualQualityReport({
              referenceSource: standaloneVisualQualityMode,
              capturedAt: validatedAt,
              report: visualQualityScoringReport as VisualQualityReport,
            }),
          );
          await persistVisualQualityReportPath({
            absolutePath: reportPath,
          });
        }
        context.log({
          level: finalizedVisualAuditResult.status === "warn" ? "warn" : "info",
          message:
            finalizedVisualAuditResult.status === "warn"
              ? `Visual audit detected ${String(diffResult.diffPixelCount)} differing pixel(s).`
              : "Visual audit completed without detected pixel differences.",
        });
      }
      if (shouldRunStandaloneVisualQuality) {
        const runStandaloneVisualQuality = async (): Promise<void> => {
          const distDir = path.join(generatedProjectDir, "dist");
          const distIndexPath = path.join(distDir, "index.html");
          await access(distIndexPath);

          const visualQualityDir = path.join(
            context.paths.jobDir,
            "visual-quality",
          );
          await mkdir(visualQualityDir, { recursive: true });

          const referenceResult =
            standaloneVisualQualityMode === "figma_api"
              ? await (async () => {
                  const figmaFileKey = context.job.request.figmaFileKey;
                  if (!figmaFileKey) {
                    throw new Error(
                      "Visual quality validation requires figmaFileKey for figma_api mode.",
                    );
                  }
                  const figmaAccessToken =
                    context.input?.figmaAccessToken?.trim();
                  if (!figmaAccessToken) {
                    throw new Error(
                      "Visual quality validation requires figmaAccessToken for figma_api mode.",
                    );
                  }
                  const figmaJsonPath = await context.artifactStore.getPath(
                    STAGE_ARTIFACT_KEYS.figmaCleaned,
                  );
                  if (!figmaJsonPath) {
                    throw new Error(
                      "Visual quality validation requires a cleaned figma.json artifact for figma_api mode.",
                    );
                  }
                  const cleanedFigma = JSON.parse(
                    await readFile(figmaJsonPath, "utf8"),
                  ) as unknown;
                  const hybridMcpEnrichment =
                    await context.artifactStore.getValue<FigmaMcpEnrichment>(
                      STAGE_ARTIFACT_KEYS.figmaHybridEnrichment,
                    );
                  const topLevelFrameCandidates =
                    extractTopLevelFrameCandidates({
                      file: cleanedFigma,
                    });
                  const qualityGateNodeIds =
                    hybridMcpEnrichment?.screenshots
                      ?.filter(
                        (screenshot) =>
                          screenshot.purpose === "quality-gate" &&
                          screenshot.nodeId.trim().length > 0,
                      )
                      .map((screenshot) => screenshot.nodeId) ?? [];
                  const selectedQualityGateNode =
                    qualityGateNodeIds
                      .map((nodeId) =>
                        topLevelFrameCandidates.find(
                          (candidate) => candidate.nodeId === nodeId,
                        ),
                      )
                      .find(
                        (
                          candidate,
                        ): candidate is NonNullable<typeof candidate> =>
                          candidate !== undefined,
                      ) ?? null;
                  const selectedNode =
                    selectedQualityGateNode ??
                    selectVisualQualityReferenceNode({
                      file: cleanedFigma,
                      ...(context.runtime.figmaScreenNamePattern
                        ? {
                            preferredNamePattern:
                              context.runtime.figmaScreenNamePattern,
                          }
                        : {}),
                    });
                  if (selectedQualityGateNode) {
                    context.log({
                      level: "info",
                      message:
                        `Visual quality reference: selected MCP quality-gate ` +
                        `node ${selectedNode.nodeId}.`,
                    });
                  }
                  const pipelineReferencePaths =
                    await context.artifactStore.getValue<
                      Record<string, string>
                    >(STAGE_ARTIFACT_KEYS.figmaScreenshotReferences);
                  const pipelineReferencePath =
                    pipelineReferencePaths?.[selectedNode.nodeId];
                  if (pipelineReferencePath) {
                    const resolvedPipelineReferencePath = path.resolve(
                      context.paths.jobDir,
                      pipelineReferencePath,
                    );
                    if (
                      !isWithinRoot({
                        candidatePath: resolvedPipelineReferencePath,
                        rootPath: context.paths.jobDir,
                      })
                    ) {
                      throw new Error(
                        `Figma screenshot reference for node '${selectedNode.nodeId}' resolves outside the job directory.`,
                      );
                    }
                    const pipelineReferenceBuffer = await readFile(
                      resolvedPipelineReferencePath,
                    );
                    const dimensions = parsePngDimensions(
                      pipelineReferenceBuffer,
                    );
                    if (
                      dimensions.width !== standaloneVisualQualityViewportWidth
                    ) {
                      context.log({
                        level: "info",
                        message:
                          `Visual quality reference: ignored IR-derived Figma screenshot ` +
                          `for node ${selectedNode.nodeId} because width ` +
                          `${String(dimensions.width)} does not match requested ` +
                          `viewport width ${String(standaloneVisualQualityViewportWidth)}.`,
                      });
                    } else {
                      context.log({
                        level: "info",
                        message:
                          `Visual quality reference: using IR-derived Figma screenshot ` +
                          `for node ${selectedNode.nodeId}.`,
                      });
                      return {
                        buffer: pipelineReferenceBuffer,
                        metadata: {
                          capturedAt: new Date().toISOString(),
                          source: {
                            fileKey: figmaFileKey,
                            nodeId: selectedNode.nodeId,
                            nodeName: selectedNode.nodeName,
                            lastModified: "unknown",
                          },
                          viewport: dimensions,
                        },
                      };
                    }
                  }
                  const liveReference = await fetchFigmaVisualReference({
                    fileKey: figmaFileKey,
                    nodeId: selectedNode.nodeId,
                    accessToken: figmaAccessToken,
                    desiredWidth: standaloneVisualQualityViewportWidth,
                    fetchImpl: context.fetchWithCancellation,
                    maxRetries: context.runtime.figmaMaxRetries,
                    onLog: (message) => {
                      context.log({
                        level: "info",
                        message: `Visual quality reference: ${message}`,
                      });
                    },
                  });
                  return {
                    buffer: liveReference.buffer,
                    metadata: liveReference.metadata,
                  };
                })()
              : await (async () => {
                  const fixtureManifest =
                    await findVisualQualityFixtureManifest({
                      workspaceRoot: context.resolvedWorkspaceRoot,
                      inputPaths: [
                        context.job.request.customerProfilePath,
                        context.job.request.figmaJsonPath,
                      ].filter(
                        (value): value is string =>
                          typeof value === "string" && value.trim().length > 0,
                      ),
                    });
                  if (!fixtureManifest) {
                    throw new Error(
                      "Visual quality validation could not locate a frozen fixture manifest for the current job.",
                    );
                  }
                  const frozenReferencePaths =
                    requestedVisualQualityFrozenReference
                      ? resolveVisualQualityFrozenReferencePaths({
                          fixtureRoot: fixtureManifest.fixtureRoot,
                          frozenReference:
                            requestedVisualQualityFrozenReference,
                        })
                      : {
                          imagePath: path.join(
                            fixtureManifest.fixtureRoot,
                            fixtureManifest.frozenReferenceImage,
                          ),
                          metadataPath: path.join(
                            fixtureManifest.fixtureRoot,
                            fixtureManifest.frozenReferenceMetadata,
                          ),
                        };
                  const frozenReference = await loadFrozenVisualReference({
                    imagePath: frozenReferencePaths.imagePath,
                    metadataPath: frozenReferencePaths.metadataPath,
                  });
                  return {
                    buffer: frozenReference.buffer,
                    metadata: frozenReference.metadata,
                  };
                })();

          if (
            referenceResult.metadata.viewport.width !==
            standaloneVisualQualityViewportWidth
          ) {
            throw new Error(
              `Visual quality reference width ${String(referenceResult.metadata.viewport.width)} does not match requested viewport width ${String(standaloneVisualQualityViewportWidth)}.`,
            );
          }

          const referenceImagePath = path.join(
            visualQualityDir,
            "reference.png",
          );
          await writeFile(referenceImagePath, referenceResult.buffer);
          const browsers = normalizeVisualBrowserNames(
            context.job.request.visualQualityBrowsers,
          );
          const browserArtifacts: Array<{
            browser: WorkspaceVisualBrowserName;
            captureResult: Awaited<ReturnType<typeof captureFromProjectFn>>;
            scoringReport: VisualQualityReport;
            completedReport: WorkspaceVisualQualityReport;
            actualImagePath: string;
            diffImagePath: string;
            reportPath: string;
          }> = [];

          for (const browser of browsers) {
            const browserDir = path.join(visualQualityDir, "browsers", browser);
            await mkdir(browserDir, { recursive: true });

            const captureResult = await captureFromProjectFn({
              projectDir: distDir,
              browser,
              config: {
                viewport: {
                  width: standaloneVisualQualityViewportWidth,
                  height: standaloneVisualQualityViewportHeight,
                  deviceScaleFactor: standaloneVisualQualityDeviceScaleFactor,
                },
                waitForNetworkIdle: true,
                waitForFonts: true,
                waitForAnimations: true,
                timeoutMs: 30_000,
                fullPage: false,
              },
              onLog: (message) => {
                context.log({
                  level: "info",
                  message: `Visual quality capture [${browser}]: ${message}`,
                });
              },
            });

            const actualImagePath = path.join(browserDir, "actual.png");
            await writeFile(actualImagePath, captureResult.screenshotBuffer);

            const diffResult = comparePngBuffersFn({
              referenceBuffer: referenceResult.buffer,
              testBuffer: captureResult.screenshotBuffer,
            });
            const diffImagePath = path.join(browserDir, "diff.png");
            await writeDiffImage({
              diffImageBuffer: diffResult.diffImageBuffer,
              outputPath: diffImagePath,
            });

            const scoringReport = computeVisualQualityReport({
              diffResult,
              comparedAt: validatedAt,
              diffImagePath,
              viewport: captureResult.viewport,
            });
            const completedReport = createCompletedVisualQualityReport({
              referenceSource: standaloneVisualQualityMode,
              capturedAt: referenceResult.metadata.capturedAt,
              report: scoringReport,
            });
            const reportPath = path.join(browserDir, "report.json");
            await writeFile(
              reportPath,
              toJsonFileContent(completedReport),
              "utf8",
            );
            browserArtifacts.push({
              browser,
              captureResult,
              scoringReport,
              completedReport,
              actualImagePath,
              diffImagePath,
              reportPath,
            });
          }

          const primaryBrowserArtifact = browserArtifacts[0];
          if (!primaryBrowserArtifact) {
            throw new Error(
              "Visual quality validation did not capture any browser artifacts.",
            );
          }

          const actualImagePath = path.join(visualQualityDir, "actual.png");
          await writeFile(
            actualImagePath,
            primaryBrowserArtifact.captureResult.screenshotBuffer,
          );

          const diffImagePath = path.join(visualQualityDir, "diff.png");
          await writeDiffImage({
            diffImageBuffer: await readFile(
              primaryBrowserArtifact.diffImagePath,
            ),
            outputPath: diffImagePath,
          });

          const browserBreakdown = browserArtifacts.reduce<
            NonNullable<WorkspaceVisualQualityReport["browserBreakdown"]>
          >((accumulator, artifact) => {
            accumulator[artifact.browser] =
              artifact.completedReport.overallScore ?? 100;
            return accumulator;
          }, {});

          const crossBrowserConsistency =
            browserArtifacts.length > 1
              ? (() => {
                  const consistency = computeCrossBrowserConsistencyScore(
                    browserArtifacts.map((artifact) => ({
                      browser: artifact.browser,
                      screenshotBuffer: artifact.captureResult.screenshotBuffer,
                    })),
                  );
                  const pairwiseDir = path.join(visualQualityDir, "pairwise");
                  return {
                    consistency,
                    pairwiseDir,
                  };
                })()
              : undefined;

          let crossBrowserReport: WorkspaceVisualQualityReport["crossBrowserConsistency"];
          if (crossBrowserConsistency) {
            await mkdir(crossBrowserConsistency.pairwiseDir, {
              recursive: true,
            });
            crossBrowserReport = {
              browsers: [...crossBrowserConsistency.consistency.browsers],
              consistencyScore:
                crossBrowserConsistency.consistency.consistencyScore,
              pairwiseDiffs: [],
              ...(crossBrowserConsistency.consistency.warnings.length > 0
                ? {
                    warnings: [...crossBrowserConsistency.consistency.warnings],
                  }
                : {}),
            };
            for (const pair of crossBrowserConsistency.consistency
              .pairwiseDiffs) {
              const pairwiseDiffPath = path.join(
                crossBrowserConsistency.pairwiseDir,
                `${pair.browserA}-vs-${pair.browserB}.png`,
              );
              if (pair.diffBuffer !== null) {
                await writeDiffImage({
                  diffImageBuffer: pair.diffBuffer,
                  outputPath: pairwiseDiffPath,
                });
              }
              crossBrowserReport.pairwiseDiffs.push({
                browserA: pair.browserA,
                browserB: pair.browserB,
                diffPercent: pair.diffPercent,
                ...(pair.diffBuffer !== null
                  ? { diffImagePath: pairwiseDiffPath }
                  : {}),
              });
            }
          }

          const topLevelWarnings = [
            ...(primaryBrowserArtifact.completedReport.warnings ?? []),
            ...(crossBrowserReport?.warnings ?? []),
          ];
          const completedReport = createCompletedVisualQualityReport({
            referenceSource: standaloneVisualQualityMode,
            capturedAt: referenceResult.metadata.capturedAt,
            report: {
              ...primaryBrowserArtifact.scoringReport,
              diffImagePath,
            },
            browserBreakdown,
            ...(crossBrowserReport
              ? { crossBrowserConsistency: crossBrowserReport }
              : {}),
            perBrowser: browserArtifacts.map((artifact) => ({
              browser: artifact.browser,
              overallScore: artifact.completedReport.overallScore ?? 100,
              actualImagePath: artifact.actualImagePath,
              diffImagePath: artifact.diffImagePath,
              reportPath: artifact.reportPath,
              ...(artifact.completedReport.warnings &&
              artifact.completedReport.warnings.length > 0
                ? { warnings: [...artifact.completedReport.warnings] }
                : {}),
            })),
            ...(topLevelWarnings.length > 0
              ? { warnings: [...new Set(topLevelWarnings)] }
              : {}),
          });
          const reportPath = path.join(visualQualityDir, "report.json");
          await writeFile(
            reportPath,
            toJsonFileContent(completedReport),
            "utf8",
          );
          await persistVisualQualityResult(completedReport);
          await persistVisualQualityReportPath({
            absolutePath: reportPath,
          });
          context.log({
            level:
              completedReport.overallScore !== undefined &&
              completedReport.overallScore < 100
                ? "warn"
                : "info",
            message: `Visual quality validation completed via ${standaloneVisualQualityMode} across ${browsers.join(", ")}.`,
          });
        };

        try {
          await runStandaloneVisualQuality();
        } catch (error) {
          const message =
            error instanceof Error
              ? error.message
              : "Visual quality validation failed.";
          await persistVisualQualityResult(
            createFailedVisualQualityReport({
              referenceSource: standaloneVisualQualityMode,
              capturedAt: new Date().toISOString(),
              message,
              warnings: [message],
            }),
          );
          context.log({
            level: "warn",
            message: `Visual quality validation failed without blocking the pipeline: ${message}`,
          });
        }
      }
      const resolveCompositeQualityWeightOverrides =
        (): WorkspaceCompositeQualityWeights => {
          return resolveCompositeQualityWeights(
            context.input?.compositeQualityWeights ??
              context.job.request.compositeQualityWeights ??
              context.runtime.compositeQualityWeights,
          );
        };

      const buildCompositeQualityForValidation = async (): Promise<void> => {
        const weights = resolveCompositeQualityWeightOverrides();
        const generatedAt = new Date().toISOString();
        const visualQualityReportPath =
          context.job.artifacts.visualQualityReportFile ??
          (await context.artifactStore.getPath(
            STAGE_ARTIFACT_KEYS.visualQualityReport,
          )) ??
          path.join(context.paths.jobDir, "visual-quality", "report.json");
        const perfArtifactDir = path.join(
          generatedProjectDir,
          ".figmapipe",
          "performance",
        );

        try {
          const performanceBreakdown = await loadCompositePerformanceBreakdown({
            artifactDir: perfArtifactDir,
          });

          const visualInput =
            resolvedVisualQualityReport.status === "completed" &&
            typeof resolvedVisualQualityReport.overallScore === "number"
              ? {
                  score: resolvedVisualQualityReport.overallScore,
                  ranAt: resolvedVisualQualityReport.capturedAt ?? generatedAt,
                  source: visualQualityReportPath,
                }
              : null;
          const visualWarnings =
            resolvedVisualQualityReport.status === "failed"
              ? [
                  ...(resolvedVisualQualityReport.message
                    ? [resolvedVisualQualityReport.message]
                    : []),
                  ...(resolvedVisualQualityReport.warnings ?? []),
                ].map((warning) => `visual: ${warning}`)
              : [];
          const hasPerformanceSignal =
            performanceBreakdown.sampleCount > 0 ||
            performanceBreakdown.score !== null;

          if (visualInput === null && !hasPerformanceSignal) {
            await persistCompositeQualityResult({
              status: "not_requested",
              generatedAt,
              weights: { ...weights },
              ...(visualWarnings.length > 0
                ? { warnings: [...new Set(visualWarnings)] }
                : {}),
            });
            return;
          }

          const composite = computeCompositeScore({
            visualScore: visualInput?.score ?? null,
            performanceScore: performanceBreakdown.score,
            weights,
          });
          const warnings = [
            ...(visualInput === null ? ["visual score missing"] : []),
            ...performanceBreakdown.warnings.map(
              (warning) => `performance: ${warning}`,
            ),
            ...visualWarnings,
          ];
          const normalizedReport: WorkspaceCompositeQualityReport = {
            status: "completed",
            generatedAt,
            weights: { ...weights },
            visual: visualInput ? { ...visualInput } : null,
            performance: {
              ...(performanceBreakdown.sourcePath
                ? { sourcePath: performanceBreakdown.sourcePath }
                : {}),
              score: performanceBreakdown.score,
              sampleCount: performanceBreakdown.sampleCount,
              samples: performanceBreakdown.samples.map((sample) => ({
                ...sample,
              })),
              aggregateMetrics: { ...performanceBreakdown.aggregateMetrics },
              warnings: [...performanceBreakdown.warnings],
            },
            composite,
            warnings: [...new Set(warnings)],
          };
          const compositeQualityDir = path.join(
            context.paths.jobDir,
            "composite-quality",
          );
          await mkdir(compositeQualityDir, { recursive: true });
          const compositeQualityReportPath = path.join(
            compositeQualityDir,
            "report.json",
          );
          await writeFile(
            compositeQualityReportPath,
            toJsonFileContent(normalizedReport),
            "utf8",
          );
          await persistCompositeQualityResult(normalizedReport);
          await persistCompositeQualityReportPath({
            absolutePath: compositeQualityReportPath,
          });
        } catch (error) {
          const message =
            error instanceof Error
              ? error.message
              : "Composite quality report generation failed.";
          await persistCompositeQualityResult(
            createFailedCompositeQualityReport({
              weights,
              generatedAt,
              message,
              warnings: [message],
            }),
          );
          context.log({
            level: "warn",
            message: `Composite quality report generation failed without blocking validate.project: ${message}`,
          });
        }
      };

      await buildCompositeQualityForValidation();

      const jobConfidence = await computeAndPersistConfidence({
        ctx: context,
        validationPassed: true,
        matchReport: componentMatchReportArtifact,
        evidenceArtifact: storybookEvidenceArtifact,
        visualReport: resolvedVisualQualityReport,
      });

      const summary = await buildSummary({
        visualQualityReport: resolvedVisualQualityReport,
        compositeQualityReport: resolvedCompositeQualityReport,
        confidence: jobConfidence,
      });
      await persistValidationSummaryArtifacts({
        context,
        summary,
      });
      const failedStorybookArtifacts =
        summary.storybook.status === "failed"
          ? listFailedStorybookArtifacts({
              artifacts: summary.storybook.artifacts,
            })
          : [];
      if (failedStorybookArtifacts.length > 0) {
        throw createPipelineError({
          code: "E_STORYBOOK_VALIDATION_FAILED",
          stage: "validate.project",
          message: buildStorybookGateMessage({
            artifacts: failedStorybookArtifacts,
          }),
          limits: context.runtime.pipelineDiagnosticLimits,
          diagnostics: buildStorybookGateDiagnostics({
            artifacts: failedStorybookArtifacts,
          }),
        });
      }

      const diffContext =
        await context.artifactStore.requireValue<GenerationDiffContext>(
          STAGE_ARTIFACT_KEYS.generationDiffContext,
        );
      const preparedDiff = await prepareGenerationDiffFn({
        generatedProjectDir,
        outputRoot: context.resolvedPaths.outputRoot,
        boardKey: diffContext.boardKey,
        jobId: context.jobId,
        onLog: (message) => {
          context.log({
            level: "debug",
            message,
          });
        },
      });
      const diffReportPath = await writeGenerationDiffReportFn({
        jobDir: context.paths.jobDir,
        report: preparedDiff.report,
      });
      await context.artifactStore.setValue({
        key: STAGE_ARTIFACT_KEYS.generationDiff,
        stage: "validate.project",
        value: preparedDiff.report,
      });
      await context.artifactStore.setPath({
        key: STAGE_ARTIFACT_KEYS.generationDiffFile,
        stage: "validate.project",
        absolutePath: diffReportPath,
      });
      await saveCurrentSnapshotFn({
        outputRoot: context.resolvedPaths.outputRoot,
        snapshot: preparedDiff.snapshot,
      });
      context.log({
        level: "info",
        message: `Post-validation generation diff: ${preparedDiff.report.summary}`,
      });
    },
  };
};

export const ValidateProjectService: StageService<void> =
  createValidateProjectService();
