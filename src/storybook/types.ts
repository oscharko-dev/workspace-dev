export type StorybookEntryType = "story" | "docs";

export type StorybookEvidenceType =
  | "story_componentPath"
  | "story_argTypes"
  | "story_args"
  | "story_design_link"
  | "theme_bundle"
  | "css"
  | "mdx_link"
  | "docs_image"
  | "docs_text";

export type StorybookEvidenceReliability = "authoritative" | "reference_only" | "derived";

export interface StorybookCssCustomPropertyDefinition {
  name: string;
  value: string;
}

export interface StorybookEvidenceUsage {
  canDriveTokens: boolean;
  canDriveProps: boolean;
  canDriveImports: boolean;
  canDriveStyling: boolean;
  canProvideMatchHints: boolean;
}

export interface StorybookEvidenceSource {
  entryId?: string;
  entryIds?: string[];
  entryType?: StorybookEntryType;
  title?: string;
  importPath?: string;
  bundlePath?: string;
  stylesheetPath?: string;
}

export interface StorybookEvidenceSummary {
  componentPath?: string;
  keys?: string[];
  url?: string;
  linkTarget?: string;
  imagePath?: string;
  text?: string;
  themeMarkers?: string[];
  customProperties?: string[];
}

export interface StorybookEvidenceItem {
  id: string;
  type: StorybookEvidenceType;
  reliability: StorybookEvidenceReliability;
  source: StorybookEvidenceSource;
  usage: StorybookEvidenceUsage;
  summary: StorybookEvidenceSummary;
}

export interface StorybookEvidenceStats {
  entryCount: number;
  evidenceCount: number;
  byType: Record<StorybookEvidenceType, number>;
  byReliability: Record<StorybookEvidenceReliability, number>;
}

export interface StorybookEvidenceArtifact {
  artifact: "storybook.evidence";
  version: 1;
  buildRoot: string;
  iframeBundlePath: string;
  stats: StorybookEvidenceStats;
  evidence: StorybookEvidenceItem[];
}

export interface StorybookIndexEntry {
  id: string;
  title: string;
  name: string;
  importPath: string;
  storiesImports: string[];
  type: StorybookEntryType;
  tags: string[];
  componentPath?: string;
}

export interface StorybookBuildContext {
  buildDir: string;
  buildRoot: string;
  iframeBundlePath: string;
  importPathToBundlePath: ReadonlyMap<string, string>;
  indexEntries: StorybookIndexEntry[];
}

export type StorybookCatalogDocsAttachment = "attached" | "unattached" | "not_applicable";

export type StorybookCatalogSignalType =
  | "componentPath"
  | "args"
  | "argTypes"
  | "designLinks"
  | "mdxLinks"
  | "docsImages"
  | "docsText"
  | "themeBundles"
  | "css";

export type StorybookCatalogJsonValue =
  | boolean
  | number
  | string
  | null
  | StorybookCatalogJsonValue[]
  | { [key: string]: StorybookCatalogJsonValue };

export interface StorybookCatalogSignalReferences {
  componentPath: string[];
  args: string[];
  argTypes: string[];
  designLinks: string[];
  mdxLinks: string[];
  docsImages: string[];
  docsText: string[];
  themeBundles: string[];
  css: string[];
}

export interface StorybookCatalogResolvedDocsLink {
  path: string;
  entryId?: string;
  familyId?: string;
  familyTitle?: string;
}

export interface StorybookCatalogLinkMetadata {
  internal: StorybookCatalogResolvedDocsLink[];
  external: string[];
}

export interface StorybookCatalogEntryMetadata {
  args?: Record<string, StorybookCatalogJsonValue>;
  argTypes?: Record<string, StorybookCatalogJsonValue>;
  designUrls: string[];
  mdxLinks: StorybookCatalogLinkMetadata;
}

export interface StorybookCatalogEntry {
  id: string;
  title: string;
  name: string;
  type: StorybookEntryType;
  tier: string;
  tags: string[];
  importPath: string;
  storiesImports: string[];
  docsAttachment: StorybookCatalogDocsAttachment;
  familyId: string;
  familyTitle: string;
  isDocsOnlyTier: boolean;
  componentPath?: string;
  signalReferences: StorybookCatalogSignalReferences;
  metadata: StorybookCatalogEntryMetadata;
}

export interface StorybookCatalogFamilyMetadata {
  designUrls: string[];
  mdxLinks: StorybookCatalogLinkMetadata;
}

export interface StorybookCatalogFamily {
  id: string;
  title: string;
  name: string;
  tier: string;
  isDocsOnlyTier: boolean;
  entryIds: string[];
  storyEntryIds: string[];
  docsEntryIds: string[];
  storyCount: number;
  propKeys: string[];
  hasDesignReference: boolean;
  componentPath?: string;
  signalReferences: StorybookCatalogSignalReferences;
  metadata: StorybookCatalogFamilyMetadata;
}

export interface StorybookCatalogStats {
  entryCount: number;
  familyCount: number;
  byEntryType: Record<StorybookEntryType, number>;
  byTier: Record<string, number>;
  byDocsAttachment: Record<StorybookCatalogDocsAttachment, number>;
  docsOnlyTiers: string[];
  byReferencedSignal: Record<StorybookCatalogSignalType, number>;
}

export interface StorybookCatalogArtifact {
  artifact: "storybook.catalog";
  version: 1;
  stats: StorybookCatalogStats;
  entries: StorybookCatalogEntry[];
  families: StorybookCatalogFamily[];
}

export type StorybookThemeDiagnosticSeverity = "warning" | "error";

export interface StorybookThemeDiagnostic {
  severity: StorybookThemeDiagnosticSeverity;
  code: string;
  message: string;
  bundlePath?: string;
  themeId?: string;
  tokenPath?: string[];
}

export interface StorybookThemeCandidate {
  id: string;
  bundlePath: string;
  score: number;
  topLevelKeys: string[];
  objectText: string;
}

export type StorybookTokenValueType =
  | "color"
  | "dimension"
  | "fontFamily"
  | "fontWeight"
  | "number"
  | "typography";

export type StorybookTokenClass =
  | "color"
  | "dimension"
  | "font"
  | "radius"
  | "spacing"
  | "typography"
  | "z-index";

export interface StorybookTokenAliasReference {
  path: string[];
}

export interface StorybookSanitizedEvidenceReference {
  type: StorybookEvidenceType;
  reliability: StorybookEvidenceReliability;
  entryId?: string;
  entryIds?: string[];
  entryType?: StorybookEntryType;
  title?: string;
  keys?: string[];
  themeMarkers?: string[];
  customProperties?: string[];
}

export interface StorybookTokenCompletenessMetadata {
  isBackfilled: boolean;
  satisfiesRequiredClass: boolean;
}

export interface StorybookTokenGraphEntry {
  id: string;
  themeId: string;
  path: string[];
  tokenClass: StorybookTokenClass;
  tokenType: StorybookTokenValueType;
  value: unknown;
  provenance: StorybookSanitizedEvidenceReference[];
  completeness: StorybookTokenCompletenessMetadata;
  aliases?: StorybookTokenAliasReference[];
  cssVariableNames?: string[];
  description?: string;
}

export interface StorybookExtractedTheme {
  id: string;
  name: string;
  context: string;
  categories: string[];
  tokenCount: number;
}

export interface StorybookTokenGraph {
  tokens: StorybookTokenGraphEntry[];
  themes: StorybookExtractedTheme[];
  diagnostics: StorybookThemeDiagnostic[];
}

export interface StorybookThemeAdapterInput {
  bundlePath: string;
  bundleText: string;
}

export interface StorybookThemeAdapter {
  name: string;
  collectCandidates(input: StorybookThemeAdapterInput): StorybookThemeCandidate[];
  extractTokenGraph(args: {
    bundlePath: string;
    bundleText: string;
    candidate: StorybookThemeCandidate;
  }): StorybookTokenGraph;
}

export interface StorybookThemeCatalog {
  themes: StorybookExtractedTheme[];
  tokenGraph: StorybookTokenGraphEntry[];
  diagnostics: StorybookThemeDiagnostic[];
}

export const STORYBOOK_PUBLIC_EXTENSION_KEY = "io.github.oscharko-dev.workspace-dev";

export interface StorybookPublicTokenStats {
  tokenCount: number;
  themeCount: number;
  byType: Record<StorybookTokenValueType, number>;
  diagnosticCount: number;
  errorCount: number;
}

export interface StorybookPublicThemeStats {
  themeCount: number;
  contextCount: number;
  diagnosticCount: number;
  errorCount: number;
}

export type StorybookPublicProvenanceByTokenClass = Record<string, StorybookSanitizedEvidenceReference[]>;
export type StorybookPublicProvenanceByThemeContext = Record<string, StorybookPublicProvenanceByTokenClass>;

export interface StorybookPublicComponent {
  id: string;
  name: string;
  title: string;
  componentPath?: string;
  propKeys: string[];
  storyCount: number;
  hasDesignReference: boolean;
}

export interface StorybookPublicComponentsArtifact {
  artifact: "storybook.components";
  version: 1;
  stats: {
    entryCount: number;
    componentCount: number;
    componentWithDesignReferenceCount: number;
    propKeyCount: number;
  };
  components: StorybookPublicComponent[];
}

export interface StorybookPublicTokensArtifact {
  $schema: string;
  $extensions: {
    [STORYBOOK_PUBLIC_EXTENSION_KEY]: {
      artifact: "storybook.tokens";
      version: 3;
      stats: StorybookPublicTokenStats;
      diagnostics: Array<Pick<StorybookThemeDiagnostic, "code" | "message" | "severity" | "themeId" | "tokenPath">>;
      themes: Array<Pick<StorybookExtractedTheme, "id" | "name" | "context" | "categories" | "tokenCount">>;
      provenance: StorybookPublicProvenanceByTokenClass;
    };
  };
  theme?: Record<string, unknown>;
  font?: Record<string, unknown>;
}

export interface StorybookPublicThemesArtifact {
  $schema: string;
  name: "storybook.themes";
  version: "2025.10";
  sets: Record<string, { sources: Array<{ $ref: string }> }>;
  modifiers: {
    theme: {
      default: string;
      contexts: Record<string, Array<{ $ref: string }>>;
    };
  };
  resolutionOrder: Array<{ $ref: string }>;
  $extensions: {
    [STORYBOOK_PUBLIC_EXTENSION_KEY]: {
      artifact: "storybook.themes";
      version: 3;
      stats: StorybookPublicThemeStats;
      diagnostics: Array<Pick<StorybookThemeDiagnostic, "code" | "message" | "severity" | "themeId" | "tokenPath">>;
      themes: Array<Pick<StorybookExtractedTheme, "id" | "name" | "context" | "categories" | "tokenCount">>;
      provenance: StorybookPublicProvenanceByThemeContext;
    };
  };
}

export interface StorybookPublicArtifacts {
  tokensArtifact: StorybookPublicTokensArtifact;
  themesArtifact: StorybookPublicThemesArtifact;
  componentsArtifact: StorybookPublicComponentsArtifact;
}

export type StorybookPublicArtifactFileKey = "tokens" | "themes" | "components";

export interface StorybookPublicArtifactFilePaths {
  tokens: string;
  themes: string;
  components: string;
}

export type ComponentMatchStatus = "matched" | "ambiguous" | "unmatched";

export type ComponentMatchConfidence = "high" | "medium" | "low" | "none";

export type ComponentMatchSemanticBucket =
  | "button"
  | "text_field"
  | "date_picker"
  | "accordion"
  | "typography"
  | "icon"
  | "dialog"
  | "card"
  | "chip"
  | "table"
  | "navigation"
  | "unknown";

export type ComponentMatchEvidenceClass =
  | "design_link"
  | "canonical_family_name"
  | "semantic_type"
  | "variant_or_prop_overlap"
  | "component_path_present"
  | "reference_only_docs";

export type ComponentMatchEvidenceRole = "candidate_selection" | "story_variant_selection" | "tie_breaker";

export type ComponentMatchRejectionReason =
  | "no_candidates"
  | "insufficient_authoritative_score"
  | "insufficient_total_score"
  | "insufficient_authoritative_lead";

export type ComponentMatchFallbackReason =
  | "used_library_resolution_canonical_name"
  | "used_figma_analysis_family_name"
  | "used_family_name_token_overlap"
  | "used_semantic_bucket"
  | "used_file_key_design_link"
  | "used_reference_only_docs_tiebreaker"
  | "selected_variant_by_overlap"
  | "selected_variant_by_attached_story_tiebreak"
  | "selected_variant_by_entry_id_tiebreak"
  | "selected_docs_entry_fallback";

export type ComponentMatchLibraryResolutionStatus =
  | "resolved_import"
  | "mui_fallback_allowed"
  | "mui_fallback_denied"
  | "not_applicable";

export type ComponentMatchLibraryResolutionReason =
  | "profile_import_resolved"
  | "profile_import_missing"
  | "profile_import_family_mismatch"
  | "profile_family_unresolved"
  | "match_ambiguous"
  | "match_unmatched";

export interface ComponentMatchReportVariantProperty {
  property: string;
  values: string[];
}

export interface ComponentMatchReportFigmaFamily {
  familyKey: string;
  familyName: string;
  nodeCount: number;
  variantProperties: ComponentMatchReportVariantProperty[];
  canonicalFamilyName?: string;
}

export interface ComponentMatchReportStorybookFamily {
  familyId: string;
  title: string;
  name: string;
  tier: string;
  storyCount: number;
}

export interface ComponentMatchReportStoryVariant {
  entryId: string;
  storyName: string;
}

export interface ComponentMatchReportUsedEvidence {
  class: ComponentMatchEvidenceClass;
  reliability: StorybookEvidenceReliability;
  role: ComponentMatchEvidenceRole;
}

export interface ComponentMatchReportResolvedImport {
  package: string;
  exportName: string;
  localName: string;
  propMappings?: Record<string, string>;
}

export interface ComponentMatchReportLibraryResolution {
  status: ComponentMatchLibraryResolutionStatus;
  reason: ComponentMatchLibraryResolutionReason;
  storybookTier?: string;
  profileFamily?: string;
  componentKey?: string;
  import?: ComponentMatchReportResolvedImport;
}

export interface ComponentMatchReportSummary {
  totalFigmaFamilies: number;
  storybookFamilyCount: number;
  storybookEntryCount: number;
  matched: number;
  ambiguous: number;
  unmatched: number;
  libraryResolution: {
    byStatus: Record<ComponentMatchLibraryResolutionStatus, number>;
    byReason: Record<ComponentMatchLibraryResolutionReason, number>;
  };
}

export interface ComponentMatchReportEntry {
  figma: ComponentMatchReportFigmaFamily;
  match: {
    status: ComponentMatchStatus;
    confidence: ComponentMatchConfidence;
    confidenceScore: number;
  };
  usedEvidence: ComponentMatchReportUsedEvidence[];
  rejectionReasons: ComponentMatchRejectionReason[];
  fallbackReasons: ComponentMatchFallbackReason[];
  libraryResolution: ComponentMatchReportLibraryResolution;
  storybookFamily?: ComponentMatchReportStorybookFamily;
  storyVariant?: ComponentMatchReportStoryVariant;
}

export interface ComponentMatchReportArtifact {
  artifact: "component.match_report";
  version: 1;
  summary: ComponentMatchReportSummary;
  entries: ComponentMatchReportEntry[];
}
