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

export type StorybookPublicTokenCategory =
  | "color"
  | "spacing"
  | "font"
  | "size"
  | "radius"
  | "shadow"
  | "motion"
  | "zIndex"
  | "other";

export interface StorybookPublicToken {
  id: string;
  name: string;
  category: StorybookPublicTokenCategory;
  values: string[];
}

export interface StorybookPublicTokensArtifact {
  artifact: "storybook.tokens";
  version: 1;
  stats: {
    entryCount: number;
    tokenCount: number;
    byCategory: Record<StorybookPublicTokenCategory, number>;
  };
  tokens: StorybookPublicToken[];
}

export interface StorybookPublicTheme {
  id: string;
  markers: string[];
  occurrenceCount: number;
  componentCount: number;
  componentTitles: string[];
}

export interface StorybookPublicThemesArtifact {
  artifact: "storybook.themes";
  version: 1;
  stats: {
    entryCount: number;
    themeCount: number;
    markerCount: number;
    componentLinkedThemeCount: number;
  };
  themes: StorybookPublicTheme[];
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
