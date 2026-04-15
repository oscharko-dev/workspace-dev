import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const typesFilePath = path.resolve(__dirname, "./types.ts");

const EXPECTED_TYPES_EXPORTS = [
  "AppShellIR",
  "BaseElementIR",
  "BoardRegistryRecord",
  "ComponentMappingCoverage",
  "ComponentMappingRule",
  "ComponentMappingSource",
  "CounterAxisAlignItems",
  "CredentialProfileMetadata",
  "CredentialProfilePayload",
  "CredentialProfileRecord",
  "CredentialRef",
  "DeploymentProfile",
  "CssGridChildHints",
  "DepthTruncatedScreenMetric",
  "DesignIR",
  "DesignIrDarkPaletteHints",
  "DesignIrThemeAnalysis",
  "DesignManifest",
  "DesignNodeFingerprint",
  "DesignScreenFingerprint",
  "DesignTokenActionPalette",
  "DesignTokenPalette",
  "DesignTokenTypographyScale",
  "DesignTokenTypographyVariant",
  "DesignTokenTypographyVariantName",
  "DesignTokenSource",
  "DesignTokenSourceMetric",
  "DesignTokens",
  "DiffFile",
  "DiffStats",
  "EditSessionEvent",
  "EditSessionGitStatus",
  "EditSessionRecord",
  "EditSessionState",
  "EditSessionSyncState",
  "EditSessionTypecheckDiagnostic",
  "EditSessionTypecheckResult",
  "EditableFileNode",
  "ElementAssetReferenceIR",
  "ElementCodeConnectMappingIR",
  "ElementPrototypeNavigationIR",
  "ElementSpacingIR",
  "FigmaAnalysis",
  "FigmaAnalysisAppShellSignal",
  "FigmaAnalysisComponentDensity",
  "FigmaAnalysisComponentFamily",
  "FigmaAnalysisDiagnostic",
  "FigmaAnalysisExternalComponent",
  "FigmaAnalysisFrameVariantGroup",
  "FigmaAnalysisLayoutGraph",
  "FigmaAnalysisTokenSignals",
  "FigmaMcpAuthMode",
  "FigmaMcpAssetReference",
  "FigmaMcpCodeConnectMapping",
  "FigmaMcpDesignSystemMapping",
  "FigmaMcpEnrichmentDiagnostic",
  "FigmaMcpEnrichment",
  "FigmaMcpMetadataHint",
  "FigmaMcpNodeHint",
  "FigmaMcpScreenshotReference",
  "FigmaMcpStyleCatalogEntry",
  "FigmaMcpVariableDefinition",
  "FigmaSourceMode",
  "FileContentRecord",
  "GeneratedFile",
  "GenerationMetrics",
  "IRValidationError",
  "IRValidationResult",
  "JobDeltaSummary",
  "JobDiffPreview",
  "JobEvent",
  "JobEventType",
  "JobExecutionMode",
  "JobInput",
  "JobLlmMetrics",
  "JobMetrics",
  "JobPreview",
  "JobPreviewState",
  "JobQueueState",
  "JobQueueStatus",
  "JobRecord",
  "JobResult",
  "JobSourceMeta",
  "JobStage",
  "JobStageState",
  "JobState",
  "JobWarning",
  "JobWarningCode",
  "KpiAlert",
  "KpiAlertCode",
  "KpiBaselineComparison",
  "KpiBucket",
  "KpiDurationStats",
  "KpiRateStats",
  "KpiTrendBucket",
  "KpiVisualQualityDimensionScores",
  "LatestSuccessJobResponse",
  "LatestSuccessPreview",
  "LlmApiKeyMode",
  "LlmCodegenMode",
  "LlmEndpointMode",
  "LlmProviderMode",
  "McpCoverageMetric",
  "MappingCoverageMetrics",
  "MappingGateMode",
  "MappingPolicy",
  "NodeDiagnosticCategory",
  "NodeDiagnosticEntry",
  "NonTextElementIR",
  "NonTextElementType",
  "PasteDeltaSummary",
  "PatchPlan",
  "PatchPlanStepDelete",
  "PatchPlanStepWrite",
  "PortfolioKpiResponse",
  "PortfolioKpiSnapshot",
  "PrimaryAxisAlignItems",
  "ProjectActivity",
  "ProjectDeleteResponse",
  "ProjectKpiResponse",
  "ProjectKpiSnapshot",
  "ProjectSummary",
  "RepoAuthSource",
  "RepoConfig",
  "ResponsiveBreakpoint",
  "ReviewEvidenceRecord",
  "ReviewEvidenceSummary",
  "SaveOperationCommit",
  "SaveOperationResult",
  "ScreenAppShellIR",
  "ScreenElementCountMetric",
  "ScreenElementIR",
  "ScreenElementIRTextRequiresText",
  "ScreenElementSemanticSource",
  "ScreenElementType",
  "ScreenIR",
  "ScreenVariantFamilyAxis",
  "ScreenVariantFamilyInitialStateIR",
  "ScreenVariantFamilyIR",
  "ScreenVariantFamilyScenarioIR",
  "ScreenVariantFieldErrorEvidenceIR",
  "ScreenVariantScreenLevelErrorEvidenceIR",
  "ScreenResponsiveIR",
  "ScreenResponsiveLayoutOverride",
  "ScreenResponsiveLayoutOverridesByBreakpoint",
  "ScreenResponsiveVariantIR",
  "ScreenSimplificationMetric",
  "SimplificationMetrics",
  "SyncBranchPolicy",
  "SyncChangeClass",
  "SyncChangeRecord",
  "SyncDiffEvidence",
  "SyncDiffHunk",
  "SyncDiffLine",
  "SyncFailPolicy",
  "SyncPolicy",
  "SyncPolicySchedule",
  "SyncRunRecord",
  "SyncRunResultStatus",
  "SyncRunStatus",
  "SyncRunSummary",
  "TokenBridgeResult",
  "TokenConflict",
  "TextElementIR",
  "TruncatedScreenMetric",
  "UiGateMode",
  "UiGatePolicy",
  "UiGateResult",
  "ValidatedDesignIR",
  "ValidationFailure",
  "isNonTextElement",
  "isTextElement",
  "validateDesignIR",
  "ValidatorInstallPolicy",
  "VariantElementState",
  "VariantMappingIR",
  "VariantMuiProps",
  "VariantStateSnapshot",
  "VariantStateStyle",
] as const;

const hasExportModifier = (node: ts.Node): boolean =>
  ts.canHaveModifiers(node) &&
  (ts
    .getModifiers(node)
    ?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) ??
    false);

test("types barrel exports stay stable and use named re-exports", async () => {
  const source = await readFile(typesFilePath, "utf8");
  const parsed = ts.createSourceFile(
    typesFilePath,
    source,
    ts.ScriptTarget.ESNext,
    true,
    ts.ScriptKind.TS,
  );
  const names = new Set<string>();

  for (const statement of parsed.statements) {
    if (ts.isExportDeclaration(statement)) {
      assert.ok(
        statement.exportClause,
        "types.ts must not use wildcard re-exports.",
      );
      assert.ok(
        ts.isNamedExports(statement.exportClause),
        "types.ts must only use named re-exports.",
      );
      if (ts.isNamedExports(statement.exportClause)) {
        for (const element of statement.exportClause.elements) {
          names.add(element.name.text);
        }
      }
      continue;
    }

    if (ts.isTypeAliasDeclaration(statement) && hasExportModifier(statement)) {
      names.add(statement.name.text);
      continue;
    }

    if (ts.isInterfaceDeclaration(statement) && hasExportModifier(statement)) {
      names.add(statement.name.text);
    }
  }

  const actual = [...names].sort((left, right) => left.localeCompare(right));
  const expected = [...EXPECTED_TYPES_EXPORTS].sort((left, right) =>
    left.localeCompare(right),
  );
  assert.deepEqual(actual, expected);
});
