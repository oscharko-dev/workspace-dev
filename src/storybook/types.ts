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

export interface StorybookTokenAliasReference {
  path: string[];
}

export interface StorybookTokenGraphEntry {
  id: string;
  themeId: string;
  path: string[];
  tokenType: StorybookTokenValueType;
  value: unknown;
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
      version: 2;
      stats: StorybookPublicTokenStats;
      diagnostics: Array<Pick<StorybookThemeDiagnostic, "code" | "message" | "severity" | "themeId" | "tokenPath">>;
      themes: Array<Pick<StorybookExtractedTheme, "id" | "name" | "context" | "categories" | "tokenCount">>;
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
      version: 2;
      stats: StorybookPublicThemeStats;
      diagnostics: Array<Pick<StorybookThemeDiagnostic, "code" | "message" | "severity" | "themeId" | "tokenPath">>;
      themes: Array<Pick<StorybookExtractedTheme, "id" | "name" | "context" | "categories" | "tokenCount">>;
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
