export const STAGE_ARTIFACT_KEYS = {
  figmaRaw: "figma.raw",
  figmaCleaned: "figma.cleaned",
  figmaCleanedReport: "figma.cleaned.report",
  figmaFetchDiagnostics: "figma.fetch_diagnostics",
  figmaHybridEnrichment: "figma.hybrid.enrichment",
  regenerationSourceIr: "regeneration.source_ir",
  regenerationOverrides: "regeneration.overrides",
  designIr: "design.ir",
  generatedProject: "generated.project",
  codegenSummary: "codegen.summary",
  generationMetrics: "generation.metrics",
  componentManifest: "component.manifest",
  generationDiffContext: "generation.diff.context",
  generationDiff: "generation.diff",
  generationDiffFile: "generation.diff.file",
  validationSummary: "validation.summary",
  reproPath: "repro.path",
  gitPrStatus: "git.pr.status"
} as const;

export type StageArtifactKey = (typeof STAGE_ARTIFACT_KEYS)[keyof typeof STAGE_ARTIFACT_KEYS] | (string & {});
