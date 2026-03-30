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
