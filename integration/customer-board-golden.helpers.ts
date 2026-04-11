import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  parseCustomerProfileConfig,
  type ResolvedCustomerProfile
} from "../src/customer-profile.js";
import { cleanFigmaForCodegen } from "../src/job-engine/figma-clean.js";
import { createDefaultFigmaMcpEnrichmentLoader } from "../src/job-engine/figma-hybrid-enrichment.js";
import { fetchFigmaFile } from "../src/job-engine/figma-source.js";
import {
  fetchFigmaVisualReference,
  selectVisualQualityReferenceNode
} from "../src/job-engine/visual-quality-reference.js";
import {
  resolveFigmaLibraryResolutionArtifact,
  type FigmaLibraryResolutionArtifact
} from "../src/job-engine/figma-library-resolution.js";
import { createJobStorybookArtifactPaths } from "../src/job-engine/storybook-artifacts.js";
import {
  STAGE_ARTIFACT_KEYS
} from "../src/job-engine/pipeline/artifact-keys.js";
import {
  StageArtifactStore
} from "../src/job-engine/pipeline/artifact-store.js";
import {
  createStageRuntimeContext,
  type PipelineExecutionContext,
  type StageRuntimeContext
} from "../src/job-engine/pipeline/context.js";
import { resolveRuntimeSettings } from "../src/job-engine/runtime.js";
import { createInitialStages, nowIso } from "../src/job-engine/stage-state.js";
import { createCodegenGenerateService } from "../src/job-engine/services/codegen-generate-service.js";
import { TemplatePrepareService } from "../src/job-engine/services/template-prepare-service.js";
import { createValidateProjectService } from "../src/job-engine/services/validate-project-service.js";
import type {
  JobRecord,
  WorkspacePipelineError
} from "../src/job-engine/types.js";
import { buildFigmaAnalysis, type FigmaAnalysis } from "../src/parity/figma-analysis.js";
import { applyAppShellsToDesignIr } from "../src/parity/ir-app-shells.js";
import { figmaToDesignIrWithOptions } from "../src/parity/ir.js";
import { applyScreenVariantFamiliesToDesignIr } from "../src/parity/ir-screen-variants.js";
import type { DesignIR } from "../src/parity/types-ir.js";
import { buildStorybookCatalogArtifact, type StorybookCatalogArtifact } from "../src/storybook/catalog.js";
import {
  buildComponentMatchReportArtifact,
  serializeComponentMatchReportArtifact,
  type ComponentMatchReportArtifact
} from "../src/storybook/component-match-report.js";
import { buildStorybookComponentVisualCatalogArtifact } from "../src/storybook/component-visual-catalog.js";
import {
  buildStorybookEvidenceArtifact,
  loadStorybookBuildContext,
  type StorybookEvidenceArtifact
} from "../src/storybook/evidence.js";
import {
  buildStorybookPublicArtifacts,
  type StorybookPublicArtifacts
} from "../src/storybook/public-extracts.js";
import {
  parseStorybookComponentVisualCatalogArtifact,
  parseStorybookComponentsArtifact
} from "../src/storybook/artifact-validation.js";
import { resolveStorybookTheme } from "../src/storybook/theme-resolver.js";
import {
  type StorybookEntryType,
  type StorybookEvidenceReliability,
  type StorybookEvidenceStats,
  type StorybookEvidenceSummary,
  type StorybookEvidenceType,
  type StorybookEvidenceUsage,
  type StorybookPublicComponentsArtifact
} from "../src/storybook/types.js";

const MODULE_DIR = typeof __dirname === "string" ? __dirname : path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_ROOT = path.resolve(MODULE_DIR, "fixtures", "customer-board-golden");
const MANIFEST_PATH = path.join(FIXTURE_ROOT, "manifest.json");
const REQUESTED_STORYBOOK_STATIC_DIR = "storybook-static/storybook-static";
const CUSTOMER_BOARD_BRAND_ID = "customer-board";
const CUSTOMER_BOARD_VISUAL_QUALITY_VIEWPORT_WIDTH = 1280;
const WORKSPACE_ROOT = process.cwd();

const TIMESTAMP_KEYS = new Set([
  "validatedAt",
  "submittedAt",
  "startedAt",
  "finishedAt",
  "capturedAt",
  "lastModified",
  "updatedAt",
  "createdAt",
  "comparedAt"
]);
const PATH_KEYS = new Set(["filePath", "reportPath", "outputDir", "catalogPath", "generatedProjectDir", "jobDir", "reproDir"]);
const FORBIDDEN_FIXTURE_PATH_SEGMENTS = [
  "storybook-static",
  ".zip",
  ".."
] as const;
const FORBIDDEN_PUBLIC_ARTIFACT_PATTERNS = [
  /storybook\.evidence/iu,
  /storybook-static/iu,
  /(^|[/\\])tmp([/\\]|$)/iu,
  /buildRoot/iu,
  /iframeBundlePath/iu,
  /bundlePath/iu,
  /importPath/iu,
  /data:application\/font/iu,
  /data:image\//iu
] as const;

export const resolveCustomerBoardLiveRuntimeSettings = () =>
  resolveRuntimeSettings({
    enablePreview: false,
    skipInstall: false,
    enableUiValidation: true,
    enableVisualQualityValidation: true,
    visualQualityReferenceMode: "frozen_fixture",
    visualQualityViewportWidth: CUSTOMER_BOARD_VISUAL_QUALITY_VIEWPORT_WIDTH,
    enableUnitTestValidation: true,
    unitTestIgnoreFailure: true,
    figmaRequestTimeoutMs: 30_000,
    figmaMaxRetries: 4,
    figmaNodeBatchSize: 1,
    figmaNodeFetchConcurrency: 1,
    figmaAdaptiveBatchingEnabled: false,
    figmaCircuitBreakerFailureThreshold: 8,
    figmaCacheEnabled: false,
    figmaMaxScreenCandidates: 1,
    figmaScreenNamePattern: "SeitenContent"
  });

export const createCustomerBoardHybridLiveRuntimeSettings = () => {
  const runtime = resolveCustomerBoardLiveRuntimeSettings();
  runtime.figmaMcpEnrichmentLoader ??= createDefaultFigmaMcpEnrichmentLoader({
    timeoutMs: runtime.figmaTimeoutMs,
    maxRetries: runtime.figmaMaxRetries,
    maxScreenCandidates: runtime.figmaMaxScreenCandidates,
    ...(runtime.figmaScreenNamePattern !== undefined
      ? { screenNamePattern: runtime.figmaScreenNamePattern }
      : {})
  });
  return runtime;
};

type FixtureArtifactKind = "json" | "text" | "binary";

export interface CustomerBoardGoldenGeneratedArtifactSpec {
  name: string;
  kind: FixtureArtifactKind;
  actual: string;
  expected: string;
}

export interface CustomerBoardStorybookEvidenceHintsArtifact {
  artifact: "customer-board.storybook_evidence_hints";
  version: 1;
  stats: StorybookEvidenceStats;
  evidence: CustomerBoardStorybookEvidenceHintItem[];
}

export interface CustomerBoardStorybookEvidenceHintItem {
  id: string;
  type: StorybookEvidenceType;
  reliability: StorybookEvidenceReliability;
  usage: StorybookEvidenceUsage;
  source: CustomerBoardStorybookEvidenceHintSource;
  summary: CustomerBoardStorybookEvidenceHintSummary;
}

export interface CustomerBoardStorybookEvidenceHintSource {
  entryId?: string;
  entryIds?: string[];
  entryType?: StorybookEntryType;
  title?: string;
}

export interface CustomerBoardStorybookEvidenceHintSummary {
  componentPath?: string;
  keys?: string[];
  url?: string;
  linkTarget?: string;
  imagePath?: string;
  text?: string;
  themeMarkers?: string[];
  customProperties?: string[];
}

export interface CustomerBoardGoldenManifest {
  version: 3;
  fixtureId: "customer-board-golden";
  inputs: {
    figma: string;
    customerProfile: string;
  };
  derived: {
    storybookEvidenceHints: string;
    storybookCatalog: string;
    storybookTokens: string;
    storybookThemes: string;
    storybookComponents: string;
    componentVisualCatalog: string;
    figmaAnalysis: string;
    figmaLibraryResolution: string;
    componentMatchReport: string;
  };
  visualQuality: {
    frozenReferenceImage: string;
    frozenReferenceMetadata: string;
  };
  expected: {
    validationSummary: string;
    generated: CustomerBoardGoldenGeneratedArtifactSpec[];
  };
}

export interface CustomerBoardExecutionResult {
  executionContext: PipelineExecutionContext;
  designIr: DesignIR;
  figmaAnalysis: FigmaAnalysis;
}

interface CustomerBoardBundleFile {
  kind: FixtureArtifactKind;
  content: string;
}

export interface CustomerBoardGoldenBundle {
  manifest: CustomerBoardGoldenManifest;
  files: Map<string, CustomerBoardBundleFile>;
}

export interface CustomerBoardFigmaLibrarySeedInput {
  fileKey: string;
  accessToken: string;
}

const compareStrings = (left: string, right: string): number => left.localeCompare(right);

const normalizeText = (value: string): string => `${value.replace(/\r\n/g, "\n").trimEnd()}\n`;

const isPlainRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null && !Array.isArray(value);
};

const toStableJsonValue = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map((entry) => toStableJsonValue(entry));
  }
  if (!isPlainRecord(value)) {
    return value;
  }
  const sorted = Object.entries(value).sort(([left], [right]) => left.localeCompare(right));
  const output: Record<string, unknown> = {};
  for (const [key, entryValue] of sorted) {
    output[key] = toStableJsonValue(entryValue);
  }
  return output;
};

const toStableJsonString = (value: unknown): string => `${JSON.stringify(toStableJsonValue(value), null, 2)}\n`;

const assertAllowedFixturePath = (value: string): string => {
  const normalized = value.replace(/\\/gu, "/").trim();
  if (normalized.length === 0) {
    throw new Error("Fixture path must not be empty.");
  }
  if (path.isAbsolute(normalized)) {
    throw new Error(`Fixture path '${normalized}' must be relative.`);
  }
  for (const forbiddenSegment of FORBIDDEN_FIXTURE_PATH_SEGMENTS) {
    if (normalized.includes(forbiddenSegment)) {
      throw new Error(`Fixture path '${normalized}' contains forbidden segment '${forbiddenSegment}'.`);
    }
  }
  return normalized;
};

const parseManifest = ({
  input
}: {
  input: string;
}): CustomerBoardGoldenManifest => {
  const parsed = JSON.parse(input) as unknown;
  if (!isPlainRecord(parsed)) {
    throw new Error("Expected customer-board manifest to be an object.");
  }

  const fixtureId = parsed.fixtureId;
  if (fixtureId !== "customer-board-golden") {
    throw new Error("customer-board manifest fixtureId must be 'customer-board-golden'.");
  }
  if (parsed.version !== 3) {
    throw new Error("customer-board manifest version must be 3.");
  }

  const inputs = parsed.inputs;
  const derived = parsed.derived;
  const visualQuality = parsed.visualQuality;
  const expected = parsed.expected;
  if (!isPlainRecord(inputs) || !isPlainRecord(derived) || !isPlainRecord(visualQuality) || !isPlainRecord(expected)) {
    throw new Error("customer-board manifest inputs, derived, visualQuality, and expected sections are required.");
  }

  const generated = expected.generated;
  if (!Array.isArray(generated) || generated.length === 0) {
    throw new Error("customer-board manifest expected.generated must contain at least one artifact.");
  }

  const output: CustomerBoardGoldenManifest = {
    version: 3,
    fixtureId: "customer-board-golden",
    inputs: {
      figma: assertAllowedFixturePath(String(inputs.figma ?? "")),
      customerProfile: assertAllowedFixturePath(String(inputs.customerProfile ?? ""))
    },
    derived: {
      storybookEvidenceHints: assertAllowedFixturePath(String(derived.storybookEvidenceHints ?? "")),
      storybookCatalog: assertAllowedFixturePath(String(derived.storybookCatalog ?? "")),
      storybookTokens: assertAllowedFixturePath(String(derived.storybookTokens ?? "")),
      storybookThemes: assertAllowedFixturePath(String(derived.storybookThemes ?? "")),
      storybookComponents: assertAllowedFixturePath(String(derived.storybookComponents ?? "")),
      componentVisualCatalog: assertAllowedFixturePath(String(derived.componentVisualCatalog ?? "")),
      figmaAnalysis: assertAllowedFixturePath(String(derived.figmaAnalysis ?? "")),
      figmaLibraryResolution: assertAllowedFixturePath(String(derived.figmaLibraryResolution ?? "")),
      componentMatchReport: assertAllowedFixturePath(String(derived.componentMatchReport ?? ""))
    },
    visualQuality: {
      frozenReferenceImage: assertAllowedFixturePath(String(visualQuality.frozenReferenceImage ?? "")),
      frozenReferenceMetadata: assertAllowedFixturePath(String(visualQuality.frozenReferenceMetadata ?? ""))
    },
    expected: {
      validationSummary: assertAllowedFixturePath(String(expected.validationSummary ?? "")),
      generated: generated.map((entry, index) => {
        if (!isPlainRecord(entry)) {
          throw new Error(`customer-board manifest expected.generated[${index}] must be an object.`);
        }
        const kind = entry.kind;
        if (kind !== "json" && kind !== "text") {
          throw new Error(`customer-board manifest expected.generated[${index}] has unsupported kind '${String(kind)}'.`);
        }
        return {
          name: String(entry.name ?? ""),
          kind,
          actual: assertAllowedFixturePath(String(entry.actual ?? "")),
          expected: assertAllowedFixturePath(String(entry.expected ?? ""))
        };
      })
    }
  };

  return output;
};

const normalizePathValue = ({
  value,
  jobDir,
  fixtureRoot,
  workspaceRoot
}: {
  value: string;
  jobDir?: string;
  fixtureRoot: string;
  workspaceRoot: string;
}): string => {
  const normalized = value.replace(/\\/gu, "/");
  const normalizedFixtureRoot = fixtureRoot.replace(/\\/gu, "/");
  const normalizedWorkspaceRoot = workspaceRoot.replace(/\\/gu, "/");
  const normalizedJobDir = jobDir?.replace(/\\/gu, "/");

  if (normalizedJobDir && normalized.startsWith(normalizedJobDir)) {
    const relative = path.posix.relative(normalizedJobDir, normalized);
    return relative.length > 0 ? `<job-dir>/${relative}` : "<job-dir>";
  }
  if (normalized.startsWith(normalizedFixtureRoot)) {
    const relative = path.posix.relative(normalizedFixtureRoot, normalized);
    return relative.length > 0 ? `<fixture-root>/${relative}` : "<fixture-root>";
  }
  if (normalized.startsWith(normalizedWorkspaceRoot)) {
    const relative = path.posix.relative(normalizedWorkspaceRoot, normalized);
    return relative.length > 0 ? `<workspace-root>/${relative}` : "<workspace-root>";
  }
  const normalizedTempRoot = os.tmpdir().replace(/\\/gu, "/");
  if (normalized.startsWith(normalizedTempRoot)) {
    const relative = path.posix.relative(normalizedTempRoot, normalized);
    return relative.length > 0 ? `<tmp>/${relative}` : "<tmp>";
  }
  return normalized;
};

export const normalizeCustomerBoardFixtureValue = ({
  value,
  jobDir,
  fixtureRoot = FIXTURE_ROOT,
  workspaceRoot = WORKSPACE_ROOT
}: {
  value: unknown;
  jobDir?: string;
  fixtureRoot?: string;
  workspaceRoot?: string;
}): unknown => {
  const visit = ({
    current,
    key
  }: {
    current: unknown;
    key?: string;
  }): unknown => {
    if (Array.isArray(current)) {
      return current.map((entry) => visit({ current: entry }));
    }
    if (typeof current === "string") {
      if (key && TIMESTAMP_KEYS.has(key)) {
        return "<timestamp>";
      }
      if (key === "jobId") {
        return "<job-id>";
      }
      if ((key && PATH_KEYS.has(key)) || path.isAbsolute(current)) {
        return normalizePathValue({
          value: current,
          jobDir,
          fixtureRoot,
          workspaceRoot
        });
      }
      return current.replace(/\r\n/gu, "\n");
    }
    if (!isPlainRecord(current)) {
      return current;
    }
    const output: Record<string, unknown> = {};
    for (const [entryKey, entryValue] of Object.entries(current).sort(([left], [right]) => left.localeCompare(right))) {
      output[entryKey] = visit({
        current: entryValue,
        key: entryKey
      });
    }
    return output;
  };

  return visit({ current: value });
};

const sanitizeValidationSummaryForFixture = ({
  value
}: {
  value: unknown;
}): unknown => {
  if (!isPlainRecord(value)) {
    return value;
  }

  const output = structuredClone(value) as Record<string, unknown>;
  const storybook = isPlainRecord(output.storybook) ? output.storybook : undefined;
  if (storybook) {
    delete storybook.requestedPath;
    const storybookArtifacts = isPlainRecord(storybook.artifacts) ? storybook.artifacts : undefined;
    const evidenceArtifact = isPlainRecord(storybookArtifacts?.evidence) ? storybookArtifacts.evidence : undefined;
    if (evidenceArtifact) {
      delete evidenceArtifact.filePath;
    }
  }

  const style = isPlainRecord(output.style) ? output.style : undefined;
  const styleStorybook = isPlainRecord(style?.storybook) ? style.storybook : undefined;
  const styleEvidence = isPlainRecord(styleStorybook?.evidence) ? styleStorybook.evidence : undefined;
  if (styleEvidence) {
    delete styleEvidence.filePath;
  }

  const generatedApp = isPlainRecord(output.generatedApp) ? output.generatedApp : undefined;
  const install = isPlainRecord(generatedApp?.install) ? generatedApp.install : undefined;
  if (install && typeof install.strategy === "string") {
    install.strategy = "normalized";
  }

  return output;
};

const collectForbiddenArtifactLeaks = ({
  value,
  pathSegments = []
}: {
  value: unknown;
  pathSegments?: string[];
}): string[] => {
  if (Array.isArray(value)) {
    return value.flatMap((entry, index) =>
      collectForbiddenArtifactLeaks({
        value: entry,
        pathSegments: [...pathSegments, String(index)]
      })
    );
  }
  if (typeof value === "string") {
    return FORBIDDEN_PUBLIC_ARTIFACT_PATTERNS.flatMap((pattern) =>
      pattern.test(value) ? [pathSegments.join(".") || "<root>"] : []
    );
  }
  if (!isPlainRecord(value)) {
    return [];
  }
  return Object.entries(value).flatMap(([key, entryValue]) =>
    collectForbiddenArtifactLeaks({
      value: entryValue,
      pathSegments: [...pathSegments, key]
    })
  );
};

const isStorybookComponentsArtifactValue = (
  value: unknown
): value is { artifact: "storybook.components"; components: unknown[] } => {
  return isPlainRecord(value) && value.artifact === "storybook.components" && Array.isArray(value.components);
};

export const assertCustomerBoardPublicArtifactSanitized = ({
  label,
  value
}: {
  label: string;
  value: unknown;
}): void => {
  const leaks = collectForbiddenArtifactLeaks({ value });
  if (leaks.length > 0) {
    throw new Error(`${label} contains forbidden public artifact leakage at: ${leaks.join(", ")}`);
  }
  if (isStorybookComponentsArtifactValue(value)) {
    try {
      parseStorybookComponentsArtifact({
        input: JSON.stringify(value)
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`${label} contains invalid public component metadata: ${message}`);
    }
  }
};

const readJsonFile = async <T>({
  filePath
}: {
  filePath: string;
}): Promise<T> => JSON.parse(await readFile(filePath, "utf8")) as T;

const parseCustomerProfileFromInput = ({
  input
}: {
  input: unknown;
}): ResolvedCustomerProfile => {
  const parsed = parseCustomerProfileConfig({
    input
  });
  if (!parsed) {
    throw new Error("Failed to parse customer-board customer profile fixture.");
  }
  return parsed;
};

const resolvePrimaryStorybookThemeId = ({
  publicArtifacts
}: {
  publicArtifacts: StorybookPublicArtifacts;
}): string => {
  const extractedThemes = publicArtifacts.tokensArtifact.$extensions["io.github.oscharko-dev.workspace-dev"]?.themes;
  if (!Array.isArray(extractedThemes) || extractedThemes.length === 0) {
    throw new Error("Customer-board fixture generation requires at least one extracted Storybook theme.");
  }

  const defaultContextTheme = extractedThemes.find(
    (theme): theme is { id: string; context: string } =>
      typeof theme === "object" &&
      theme !== null &&
      typeof (theme as { id?: unknown }).id === "string" &&
      typeof (theme as { context?: unknown }).context === "string" &&
      (theme as { context: string }).context === "default"
  );
  if (defaultContextTheme) {
    return defaultContextTheme.id;
  }

  const firstTheme = extractedThemes.find(
    (theme): theme is { id: string } =>
      typeof theme === "object" && theme !== null && typeof (theme as { id?: unknown }).id === "string"
  );
  if (firstTheme) {
    return firstTheme.id;
  }

  throw new Error("Customer-board fixture generation could not resolve an extracted Storybook theme id.");
};

export const loadCustomerBoardCustomerProfileInput = async ({
  fixtureRoot = FIXTURE_ROOT,
  storybookThemeId
}: {
  fixtureRoot?: string;
  storybookThemeId: string;
}): Promise<Record<string, unknown>> => {
  const customerProfileInput = await readJsonFile<Record<string, unknown>>({
    filePath: path.join(fixtureRoot, "inputs", "customer-profile.json")
  });

  const brandMappings = customerProfileInput.brandMappings;
  if (!Array.isArray(brandMappings)) {
    throw new Error("Customer-board fixture customer profile must define brandMappings.");
  }

  const customerBrandMapping = brandMappings.find(
    (entry): entry is Record<string, unknown> =>
      isPlainRecord(entry) && entry.id === CUSTOMER_BOARD_BRAND_ID
  );
  if (!customerBrandMapping) {
    throw new Error(`Customer-board fixture customer profile must define a '${CUSTOMER_BOARD_BRAND_ID}' brand mapping.`);
  }

  const storybookThemes = customerBrandMapping.storybookThemes;
  if (!isPlainRecord(storybookThemes)) {
    throw new Error("Customer-board fixture customer profile must define storybookThemes for the customer brand mapping.");
  }

  if (storybookThemes.light !== storybookThemeId) {
    customerBrandMapping.storybookThemes = {
      ...storybookThemes,
      light: storybookThemeId
    };
  }

  return customerProfileInput;
};

const sanitizeCatalogArtifact = ({
  artifact
}: {
  artifact: StorybookCatalogArtifact;
}): StorybookCatalogArtifact => {
  const sanitized = {
    ...artifact,
    entries: artifact.entries.map((entry) => {
      const { importPath: _importPath, ...rest } = entry;
      return rest;
    })
  } satisfies StorybookCatalogArtifact;
  assertCustomerBoardPublicArtifactSanitized({
    label: "storybook.catalog",
    value: sanitized
  });
  return sanitized;
};

const sanitizeComponentsArtifact = ({
  artifact
}: {
  artifact: StorybookPublicComponentsArtifact;
}): StorybookPublicComponentsArtifact => {
  const sanitized = {
    ...artifact,
    components: artifact.components.map((component) => {
      const { componentPath: _componentPath, ...rest } = component as typeof component & { componentPath?: string };
      return rest;
    })
  } satisfies StorybookPublicComponentsArtifact;
  parseStorybookComponentsArtifact({
    input: JSON.stringify(sanitized)
  });
  assertCustomerBoardPublicArtifactSanitized({
    label: "storybook.components",
    value: sanitized
  });
  return sanitized;
};

const sanitizeComponentVisualCatalogArtifact = ({
  artifact
}: {
  artifact: Record<string, unknown>;
}): Record<string, unknown> => {
  parseStorybookComponentVisualCatalogArtifact({
    input: JSON.stringify(artifact)
  });
  assertCustomerBoardPublicArtifactSanitized({
    label: "storybook.component-visual-catalog",
    value: artifact
  });
  return artifact;
};

const createEmptyStorybookEvidenceStats = (): StorybookEvidenceStats => ({
  entryCount: 0,
  evidenceCount: 0,
  byType: {
    story_componentPath: 0,
    story_argTypes: 0,
    story_args: 0,
    story_design_link: 0,
    theme_bundle: 0,
    css: 0,
    mdx_link: 0,
    docs_image: 0,
    docs_text: 0
  },
  byReliability: {
    authoritative: 0,
    reference_only: 0,
    derived: 0
  }
});

const toUniqueSortedStrings = (values: readonly string[] | undefined): string[] | undefined => {
  if (!values || values.length === 0) {
    return undefined;
  }
  const normalized = [...new Set(values.map((value) => value.trim()).filter((value) => value.length > 0))].sort(compareStrings);
  return normalized.length > 0 ? normalized : undefined;
};

const sanitizeStorybookEvidenceSummaryForHints = ({
  summary
}: {
  summary: StorybookEvidenceSummary;
}): CustomerBoardStorybookEvidenceHintSummary => {
  return {
    ...(typeof summary.componentPath === "string" ? { componentPath: summary.componentPath } : {}),
    ...(toUniqueSortedStrings(summary.keys) ? { keys: toUniqueSortedStrings(summary.keys) } : {}),
    ...(typeof summary.url === "string" ? { url: summary.url } : {}),
    ...(typeof summary.linkTarget === "string" ? { linkTarget: summary.linkTarget } : {}),
    ...(typeof summary.imagePath === "string" ? { imagePath: summary.imagePath } : {}),
    ...(typeof summary.text === "string" ? { text: summary.text } : {}),
    ...(toUniqueSortedStrings(summary.themeMarkers) ? { themeMarkers: toUniqueSortedStrings(summary.themeMarkers) } : {}),
    ...(toUniqueSortedStrings(summary.customProperties)
      ? { customProperties: toUniqueSortedStrings(summary.customProperties) }
      : {})
  };
};

const collectStorybookEvidenceStats = ({
  evidence
}: {
  evidence: readonly Pick<CustomerBoardStorybookEvidenceHintItem, "type" | "reliability" | "source">[];
}): StorybookEvidenceStats => {
  const stats = createEmptyStorybookEvidenceStats();
  const entryIds = new Set<string>();

  for (const item of evidence) {
    stats.evidenceCount += 1;
    stats.byType[item.type] += 1;
    stats.byReliability[item.reliability] += 1;
    const sourceEntryIds = [
      ...(typeof item.source.entryId === "string" ? [item.source.entryId] : []),
      ...(item.source.entryIds ?? [])
    ];
    for (const entryId of sourceEntryIds) {
      const normalizedEntryId = entryId.trim();
      if (normalizedEntryId.length > 0) {
        entryIds.add(normalizedEntryId);
      }
    }
  }

  stats.entryCount = entryIds.size;
  return stats;
};

export const createCustomerBoardStorybookEvidenceHintsArtifact = ({
  artifact
}: {
  artifact: StorybookEvidenceArtifact;
}): CustomerBoardStorybookEvidenceHintsArtifact => {
  const evidence = artifact.evidence.map((item) => ({
    id: item.id,
    type: item.type,
    reliability: item.reliability,
    usage: item.usage,
    source: {
      ...(typeof item.source.entryId === "string" ? { entryId: item.source.entryId } : {}),
      ...(toUniqueSortedStrings(item.source.entryIds) ? { entryIds: toUniqueSortedStrings(item.source.entryIds) } : {}),
      ...(typeof item.source.entryType === "string" ? { entryType: item.source.entryType } : {}),
      ...(typeof item.source.title === "string" ? { title: item.source.title } : {})
    },
    summary: sanitizeStorybookEvidenceSummaryForHints({
      summary: item.summary
    })
  }));

  const hintsArtifact: CustomerBoardStorybookEvidenceHintsArtifact = {
    artifact: "customer-board.storybook_evidence_hints",
    version: 1,
    stats: collectStorybookEvidenceStats({
      evidence
    }),
    evidence
  };

  assertCustomerBoardPublicArtifactSanitized({
    label: "customer-board.storybook_evidence_hints",
    value: hintsArtifact
  });

  return hintsArtifact;
};

export const materializeCustomerBoardRuntimeStorybookEvidenceArtifact = ({
  hintsArtifact
}: {
  hintsArtifact: CustomerBoardStorybookEvidenceHintsArtifact;
}): StorybookEvidenceArtifact => {
  const evidence = hintsArtifact.evidence.map((item) => ({
    id: item.id,
    type: item.type,
    reliability: item.reliability,
    usage: item.usage,
    source: {
      ...(typeof item.source.entryId === "string" ? { entryId: item.source.entryId } : {}),
      ...(item.source.entryIds ? { entryIds: item.source.entryIds } : {}),
      ...(typeof item.source.entryType === "string" ? { entryType: item.source.entryType } : {}),
      ...(typeof item.source.title === "string" ? { title: item.source.title } : {})
    },
    summary: {
      ...(typeof item.summary.componentPath === "string" ? { componentPath: item.summary.componentPath } : {}),
      ...(item.summary.keys ? { keys: item.summary.keys } : {}),
      ...(typeof item.summary.url === "string" ? { url: item.summary.url } : {}),
      ...(typeof item.summary.linkTarget === "string" ? { linkTarget: item.summary.linkTarget } : {}),
      ...(typeof item.summary.imagePath === "string" ? { imagePath: item.summary.imagePath } : {}),
      ...(typeof item.summary.text === "string" ? { text: item.summary.text } : {}),
      ...(item.summary.themeMarkers ? { themeMarkers: item.summary.themeMarkers } : {}),
      ...(item.summary.customProperties ? { customProperties: item.summary.customProperties } : {})
    }
  }));

  return {
    artifact: "storybook.evidence",
    version: 1,
    buildRoot: ".customer-board-runtime",
    iframeBundlePath: "assets/iframe.fixture.js",
    stats: collectStorybookEvidenceStats({
      evidence
    }),
    evidence
  };
};

const sanitizeFigmaInputForFixture = ({
  input
}: {
  input: Record<string, unknown>;
}): Record<string, unknown> => {
  const { lastModified: _lastModified, ...rest } = input;
  return rest;
};

const sanitizeFigmaLibraryResolutionArtifact = ({
  artifact
}: {
  artifact: FigmaLibraryResolutionArtifact;
}): FigmaLibraryResolutionArtifact => {
  const { lastModified: _lastModified, fileKey: _fileKey, ...rest } = artifact;
  return rest as FigmaLibraryResolutionArtifact;
};

const normalizeFigmaLibraryResolutionVariantPropertiesForComparison = ({
  variantProperties
}: {
  variantProperties: unknown;
}): Array<{ property: string; values: string[] }> => {
  if (!Array.isArray(variantProperties)) {
    return [];
  }
  return variantProperties
    .flatMap((entry) => {
      if (!isPlainRecord(entry) || typeof entry.property !== "string" || !Array.isArray(entry.values)) {
        return [];
      }
      const values = [...new Set(entry.values.filter((value): value is string => typeof value === "string"))].sort(compareStrings);
      return [
        {
          property: entry.property,
          values
        }
      ];
    })
    .sort((left, right) => {
      const byProperty = left.property.localeCompare(right.property);
      if (byProperty !== 0) {
        return byProperty;
      }
      return left.values.join("\u0000").localeCompare(right.values.join("\u0000"));
    });
};

const normalizeFigmaLibraryResolutionLocalAssetForComparison = ({
  asset
}: {
  asset: unknown;
}): Record<string, unknown> | undefined => {
  if (!isPlainRecord(asset)) {
    return undefined;
  }
  const output: Record<string, unknown> = {};
  for (const key of ["componentSetId", "description", "key", "name", "remote"] as const) {
    const value = asset[key];
    if (typeof value === "string" || typeof value === "boolean") {
      output[key] = value;
    }
  }
  return Object.keys(output).length > 0 ? output : undefined;
};

const resolveFigmaLibraryResolutionCanonicalNameForComparison = ({
  entry
}: {
  entry: Record<string, unknown>;
}): string | undefined => {
  const heuristicFamilyName = typeof entry.heuristicFamilyName === "string" ? entry.heuristicFamilyName.trim() : "";
  if (heuristicFamilyName.length > 0) {
    return heuristicFamilyName;
  }

  const localComponentSet = normalizeFigmaLibraryResolutionLocalAssetForComparison({
    asset: entry.localComponentSet
  });
  if (typeof localComponentSet?.name === "string" && localComponentSet.name.trim().length > 0) {
    return localComponentSet.name.trim();
  }

  const localComponent = normalizeFigmaLibraryResolutionLocalAssetForComparison({
    asset: entry.localComponent
  });
  if (typeof localComponent?.name === "string" && localComponent.name.trim().length > 0) {
    return localComponent.name.trim();
  }

  const canonicalFamilyName = typeof entry.canonicalFamilyName === "string" ? entry.canonicalFamilyName.trim() : "";
  return canonicalFamilyName.length > 0 ? canonicalFamilyName : undefined;
};

const normalizeFigmaLibraryResolutionArtifactForComparison = ({
  content
}: {
  content: string;
}): string => {
  const parsed = JSON.parse(content) as unknown;
  if (!isPlainRecord(parsed) || !Array.isArray(parsed.entries)) {
    return content;
  }

  const normalizedEntries = parsed.entries
    .flatMap((entry) => {
      if (!isPlainRecord(entry) || typeof entry.componentId !== "string" || typeof entry.familyKey !== "string") {
        return [];
      }

      const referringNodeIds = Array.isArray(entry.referringNodeIds)
        ? [...new Set(entry.referringNodeIds.filter((value): value is string => typeof value === "string"))].sort(compareStrings)
        : [];
      const variantProperties = normalizeFigmaLibraryResolutionVariantPropertiesForComparison({
        variantProperties: entry.variantProperties
      });
      const localComponent = normalizeFigmaLibraryResolutionLocalAssetForComparison({
        asset: entry.localComponent
      });
      const localComponentSet = normalizeFigmaLibraryResolutionLocalAssetForComparison({
        asset: entry.localComponentSet
      });
      const canonicalFamilyName = resolveFigmaLibraryResolutionCanonicalNameForComparison({
        entry
      });

      return [
        {
          componentId: entry.componentId,
          ...(typeof entry.componentKey === "string" ? { componentKey: entry.componentKey } : {}),
          ...(typeof entry.componentSetId === "string" ? { componentSetId: entry.componentSetId } : {}),
          ...(typeof entry.componentSetKey === "string" ? { componentSetKey: entry.componentSetKey } : {}),
          familyKey: entry.familyKey,
          ...(canonicalFamilyName ? { canonicalFamilyName } : {}),
          ...(typeof entry.heuristicFamilyName === "string" ? { heuristicFamilyName: entry.heuristicFamilyName } : {}),
          ...(localComponent ? { localComponent } : {}),
          ...(localComponentSet ? { localComponentSet } : {}),
          referringNodeIds,
          variantProperties
        }
      ];
    })
    .sort((left, right) => {
      const byFamilyKey = left.familyKey.localeCompare(right.familyKey);
      if (byFamilyKey !== 0) {
        return byFamilyKey;
      }
      return left.componentId.localeCompare(right.componentId);
    });

  return toStableJsonString({
    artifact: parsed.artifact,
    version: parsed.version,
    ...(typeof parsed.figmaSourceMode === "string" ? { figmaSourceMode: parsed.figmaSourceMode } : {}),
    ...(typeof parsed.fingerprint === "string" ? { fingerprint: parsed.fingerprint } : {}),
    summary: {
      total: normalizedEntries.length
    },
    entries: normalizedEntries
  });
};

const normalizeComponentMatchReportArtifactForComparison = ({
  content
}: {
  content: string;
}): string => {
  const parsed = JSON.parse(content) as unknown;
  if (!isPlainRecord(parsed) || !Array.isArray(parsed.entries)) {
    return content;
  }

  const normalizedEntries = parsed.entries
    .flatMap((entry) => {
      if (!isPlainRecord(entry) || !isPlainRecord(entry.figma) || typeof entry.figma.familyKey !== "string") {
        return [];
      }

      const figma = {
        familyKey: entry.figma.familyKey,
        ...(typeof entry.figma.familyName === "string" ? { familyName: entry.figma.familyName } : {}),
        ...(typeof entry.figma.nodeCount === "number" ? { nodeCount: entry.figma.nodeCount } : {}),
        variantProperties: normalizeFigmaLibraryResolutionVariantPropertiesForComparison({
          variantProperties: entry.figma.variantProperties
        })
      };

      return [
        {
          figma
        }
      ];
    })
    .sort((left, right) => left.figma.familyKey.localeCompare(right.figma.familyKey));

  return toStableJsonString({
    artifact: parsed.artifact,
    version: parsed.version,
    summary: {
      totalFigmaFamilies: normalizedEntries.length
    },
    entries: normalizedEntries
  });
};

const normalizeValidationSummaryArtifactForComparison = ({
  content
}: {
  content: string;
}): string => {
  const parsed = JSON.parse(content) as unknown;
  if (!isPlainRecord(parsed)) {
    return content;
  }

  const storybook = isPlainRecord(parsed.storybook) ? parsed.storybook : undefined;
  const storybookArtifacts = isPlainRecord(storybook?.artifacts) ? storybook.artifacts : undefined;
  const mapping = isPlainRecord(parsed.mapping) ? parsed.mapping : undefined;
  const style = isPlainRecord(parsed.style) ? parsed.style : undefined;
  const styleStorybook = isPlainRecord(style?.storybook) ? style.storybook : undefined;
  const importSummary = isPlainRecord(parsed.import) ? parsed.import : undefined;
  const visualQuality = isPlainRecord(parsed.visualQuality) ? parsed.visualQuality : undefined;

  const normalizeStatusObject = (value: unknown): Record<string, unknown> | undefined => {
    if (!isPlainRecord(value) || typeof value.status !== "string") {
      return undefined;
    }
    return {
      status: value.status
    };
  };

  return toStableJsonString({
    ...(typeof parsed.status === "string" ? { status: parsed.status } : {}),
    storybook: storybook
      ? {
          ...(typeof storybook.status === "string" ? { status: storybook.status } : {}),
          artifacts: {
            ...(normalizeStatusObject(storybookArtifacts?.catalog) ? { catalog: normalizeStatusObject(storybookArtifacts?.catalog) } : {}),
            ...(normalizeStatusObject(storybookArtifacts?.evidence) ? { evidence: normalizeStatusObject(storybookArtifacts?.evidence) } : {}),
            ...(normalizeStatusObject(storybookArtifacts?.tokens) ? { tokens: normalizeStatusObject(storybookArtifacts?.tokens) } : {}),
            ...(normalizeStatusObject(storybookArtifacts?.themes) ? { themes: normalizeStatusObject(storybookArtifacts?.themes) } : {}),
            ...(normalizeStatusObject(storybookArtifacts?.components)
              ? { components: normalizeStatusObject(storybookArtifacts?.components) }
              : {}),
            ...(normalizeStatusObject(storybookArtifacts?.componentVisualCatalog)
              ? { componentVisualCatalog: normalizeStatusObject(storybookArtifacts?.componentVisualCatalog) }
              : {})
          }
        }
      : undefined,
    mapping: mapping
      ? {
          ...(typeof mapping.status === "string" ? { status: mapping.status } : {}),
          ...(normalizeStatusObject(mapping.figmaLibraryResolution)
            ? { figmaLibraryResolution: normalizeStatusObject(mapping.figmaLibraryResolution) }
            : {}),
          ...(normalizeStatusObject(mapping.componentMatchReport)
            ? { componentMatchReport: normalizeStatusObject(mapping.componentMatchReport) }
            : {}),
          ...(normalizeStatusObject(mapping.customerProfileMatch)
            ? { customerProfileMatch: normalizeStatusObject(mapping.customerProfileMatch) }
            : {}),
          ...(normalizeStatusObject(mapping.componentApi) ? { componentApi: normalizeStatusObject(mapping.componentApi) } : {})
        }
      : undefined,
    style: style
      ? {
          ...(typeof style.status === "string" ? { status: style.status } : {}),
          storybook: {
            ...(normalizeStatusObject(styleStorybook?.evidence) ? { evidence: normalizeStatusObject(styleStorybook?.evidence) } : {}),
            ...(normalizeStatusObject(styleStorybook?.tokens) ? { tokens: normalizeStatusObject(styleStorybook?.tokens) } : {}),
            ...(normalizeStatusObject(styleStorybook?.themes) ? { themes: normalizeStatusObject(styleStorybook?.themes) } : {}),
            ...(normalizeStatusObject(styleStorybook?.componentMatchReport)
              ? { componentMatchReport: normalizeStatusObject(styleStorybook?.componentMatchReport) }
              : {})
          }
        }
      : undefined,
    visualQuality: visualQuality
      ? {
          ...(typeof visualQuality.status === "string" ? { status: visualQuality.status } : {}),
          ...(typeof visualQuality.referenceSource === "string"
            ? { referenceSource: visualQuality.referenceSource }
            : {})
        }
      : undefined,
    import: importSummary && typeof importSummary.status === "string" ? { status: importSummary.status } : undefined
  });
};

const normalizeVisualReferenceMetadataForComparison = ({
  content
}: {
  content: string;
}): string => {
  const parsed = JSON.parse(content) as unknown;
  if (!isPlainRecord(parsed)) {
    return content;
  }
  const source = isPlainRecord(parsed.source) ? parsed.source : undefined;
  const viewport = isPlainRecord(parsed.viewport) ? parsed.viewport : undefined;
  return toStableJsonString({
    ...(typeof parsed.capturedAt === "string" ? { capturedAt: "<timestamp>" } : {}),
    ...(source
      ? {
          source: {
            ...(typeof source.fileKey === "string" ? { fileKey: source.fileKey } : {}),
            ...(typeof source.nodeId === "string" ? { nodeId: source.nodeId } : {}),
            ...(typeof source.nodeName === "string" ? { nodeName: source.nodeName } : {}),
            ...(typeof source.lastModified === "string" ? { lastModified: "<timestamp>" } : {})
          }
        }
      : {}),
    ...(viewport
      ? {
          viewport: {
            ...(typeof viewport.width === "number" ? { width: viewport.width } : {}),
            ...(typeof viewport.height === "number" ? { height: viewport.height } : {})
          }
        }
      : {})
  });
};

const normalizeBundleEntryContentForComparison = ({
  relativePath,
  entry
}: {
  relativePath: string;
  entry: CustomerBoardBundleFile;
}): string => {
  if (entry.kind === "json" && relativePath.endsWith("figma-library-resolution.json")) {
    return normalizeFigmaLibraryResolutionArtifactForComparison({
      content: entry.content
    });
  }
  if (entry.kind === "json" && relativePath.endsWith("component-match-report.json")) {
    return normalizeComponentMatchReportArtifactForComparison({
      content: entry.content
    });
  }
  if (entry.kind === "json" && relativePath.endsWith("validation-summary.json")) {
    return normalizeValidationSummaryArtifactForComparison({
      content: entry.content
    });
  }
  if (entry.kind === "json" && relativePath.endsWith("visual-quality/reference.metadata.json")) {
    return normalizeVisualReferenceMetadataForComparison({
      content: entry.content
    });
  }
  return entry.content;
};

const buildCuratedGeneratedArtifactSpecs = async ({
  generatedProjectDir
}: {
  generatedProjectDir: string;
}): Promise<CustomerBoardGoldenGeneratedArtifactSpec[]> => {
  const generated = new Set<string>(["src/App.tsx", "src/theme/theme.ts"]);

  const screensDir = path.join(generatedProjectDir, "src", "screens");
  try {
    const screenFiles = (await readdir(screensDir, { recursive: true }))
      .filter((entry): entry is string => typeof entry === "string" && entry.endsWith(".tsx"))
      .map((entry) => path.posix.join("src/screens", entry.replace(/\\/gu, "/")))
      .sort(compareStrings);
    for (const filePath of screenFiles) {
      generated.add(filePath);
      const source = await readFile(path.join(generatedProjectDir, filePath), "utf8");
      const importMatches = [...source.matchAll(/from\s+["'](\.\.\/[^"']+)["']/gu)];
      for (const match of importMatches) {
        const relativeImport = match[1];
        if (!relativeImport) {
          continue;
        }
        const resolvedBase = path.posix.normalize(path.posix.join(path.posix.dirname(filePath), relativeImport));
        for (const candidate of [`${resolvedBase}.tsx`, `${resolvedBase}.ts`, path.posix.join(resolvedBase, "index.tsx"), path.posix.join(resolvedBase, "index.ts")]) {
          try {
            await readFile(path.join(generatedProjectDir, candidate), "utf8");
            generated.add(candidate);
            break;
          } catch {
            // continue
          }
        }
      }
    }
  } catch {
    // no screens emitted
  }

  return [...generated]
    .sort(compareStrings)
    .map((actualPath) => ({
      name: actualPath.replace(/[^A-Za-z0-9]+/gu, "-").replace(/^-|-$/gu, ""),
      kind: actualPath.endsWith(".json") ? "json" : "text",
      actual: actualPath,
      expected: path.posix.join("expected", "generated", actualPath)
    }));
};

const createJobRecord = ({
  runtime,
  jobDir,
  customerProfilePath
}: {
  runtime: ReturnType<typeof resolveRuntimeSettings>;
  jobDir: string;
  customerProfilePath: string;
}): JobRecord => {
  return {
    jobId: "customer-board-golden",
    status: "queued",
    submittedAt: nowIso(),
    request: {
      enableVisualQualityValidation: true,
      visualQualityReferenceMode: "frozen_fixture",
      visualQualityViewportWidth: CUSTOMER_BOARD_VISUAL_QUALITY_VIEWPORT_WIDTH,
      enableGitPr: false,
      figmaSourceMode: "local_json",
      llmCodegenMode: "deterministic",
      brandTheme: "derived",
      customerBrandId: CUSTOMER_BOARD_BRAND_ID,
      customerProfilePath,
      storybookStaticDir: REQUESTED_STORYBOOK_STATIC_DIR,
      generationLocale: "en-US",
      formHandlingMode: "react_hook_form"
    },
    stages: createInitialStages(),
    logs: [],
    artifacts: {
      outputRoot: path.dirname(path.dirname(jobDir)),
      jobDir
    },
    preview: { enabled: false },
    queue: {
      runningCount: 0,
      queuedCount: 0,
      maxConcurrentJobs: runtime.maxConcurrentJobs,
      maxQueuedJobs: runtime.maxQueuedJobs
    }
  };
};

const createExecutionContext = async ({
  customerProfile,
  fixtureRoot = FIXTURE_ROOT,
  rootDir
}: {
  customerProfile: ResolvedCustomerProfile;
  fixtureRoot?: string;
  rootDir?: string;
}): Promise<{
  executionContext: PipelineExecutionContext;
  stageContextFor: (stage: StageRuntimeContext["log"] extends (input: infer T) => void ? T extends { stage?: infer S } ? Exclude<S, undefined> : never : never) => StageRuntimeContext;
}> => {
  const root = rootDir ?? (await mkdtemp(path.join(os.tmpdir(), "workspace-dev-customer-board-golden-")));
  const jobsRoot = path.join(root, "jobs");
  const jobDir = path.join(jobsRoot, "job");
  const generatedProjectDir = path.join(jobDir, "generated-app");
  const runtime = resolveRuntimeSettings({
    enablePreview: false,
    skipInstall: false,
    enableUiValidation: true,
    enableVisualQualityValidation: true,
    visualQualityReferenceMode: "frozen_fixture",
    visualQualityViewportWidth: CUSTOMER_BOARD_VISUAL_QUALITY_VIEWPORT_WIDTH,
    enableUnitTestValidation: true,
    unitTestIgnoreFailure: true,
    figmaMaxRetries: 1,
    figmaRequestTimeoutMs: 1_000,
    customerProfile
  });

  await mkdir(jobDir, { recursive: true });
  await mkdir(generatedProjectDir, { recursive: true });

  const artifactStore = new StageArtifactStore({ jobDir });
  const customerProfilePath = path.join(fixtureRoot, "inputs", "customer-profile.json");
  const executionContext: PipelineExecutionContext = {
    mode: "submission",
    job: createJobRecord({
      runtime,
      jobDir,
      customerProfilePath
    }),
    runtime,
    resolvedPaths: {
      workspaceRoot: WORKSPACE_ROOT,
      outputRoot: root,
      jobsRoot,
      reprosRoot: path.join(root, "repros")
    },
    resolvedWorkspaceRoot: WORKSPACE_ROOT,
    resolveBaseUrl: () => "http://127.0.0.1:1983",
    jobAbortController: new AbortController(),
    fetchWithCancellation: runtime.fetchImpl,
    paths: {
      jobDir,
      generatedProjectDir,
      figmaRawJsonFile: path.join(jobDir, "figma.raw.json"),
      figmaJsonFile: path.join(jobDir, "figma.json"),
      designIrFile: path.join(jobDir, "design-ir.json"),
      figmaAnalysisFile: path.join(jobDir, "figma-analysis.json"),
      stageTimingsFile: path.join(jobDir, "stage-timings.json"),
      reproDir: path.join(root, "repros", "job"),
      iconMapFilePath: path.join(root, "icon-map.json"),
      designSystemFilePath: path.join(root, "design-system.json"),
      irCacheDir: path.join(root, "cache", "ir"),
      templateRoot: path.join(WORKSPACE_ROOT, "template", "react-mui-app"),
      templateCopyFilter: () => true
    },
    artifactStore,
    resolvedBrandTheme: "derived",
    resolvedCustomerBrandId: CUSTOMER_BOARD_BRAND_ID,
    resolvedFigmaSourceMode: "local_json",
    resolvedFormHandlingMode: "react_hook_form",
    requestedStorybookStaticDir: REQUESTED_STORYBOOK_STATIC_DIR,
    resolvedStorybookStaticDir: REQUESTED_STORYBOOK_STATIC_DIR,
    resolvedCustomerProfile: customerProfile,
    generationLocaleResolution: { locale: "en-US" },
    resolvedGenerationLocale: "en-US",
    appendDiagnostics: () => {
      // no-op for fixture execution
    },
    getCollectedDiagnostics: () => undefined,
    syncPublicJobProjection: async () => {
      // no-op for fixture execution
    }
  };

  return {
    executionContext,
    stageContextFor: (stage) => createStageRuntimeContext({ executionContext, stage })
  };
};

const writeJsonFixtureFile = async ({
  filePath,
  value
}: {
  filePath: string;
  value: unknown;
}): Promise<void> => {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, toStableJsonString(value), "utf8");
};

const writeTextFixtureFile = async ({
  filePath,
  value
}: {
  filePath: string;
  value: string;
}): Promise<void> => {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, normalizeText(value), "utf8");
};

const readNormalizedFixtureArtifact = async ({
  filePath,
  kind
}: {
  filePath: string;
  kind: FixtureArtifactKind;
}): Promise<string> => {
  if (kind === "binary") {
    return (await readFile(filePath)).toString("base64");
  }
  const raw = await readFile(filePath, "utf8");
  if (kind === "text") {
    return normalizeText(raw);
  }
  const parsed = JSON.parse(raw) as unknown;
  if (filePath.endsWith("validation-summary.json")) {
    return toStableJsonString(
      normalizeCustomerBoardFixtureValue({
        value: sanitizeValidationSummaryForFixture({
          value: parsed
        })
      })
    );
  }
  return toStableJsonString(parsed);
};

export const deriveCustomerBoardDesignIrAndAnalysis = ({
  figmaInput
}: {
  figmaInput: Record<string, unknown>;
}): {
  designIr: DesignIR;
  figmaAnalysis: FigmaAnalysis;
} => {
  const baseIr = figmaToDesignIrWithOptions(figmaInput as Parameters<typeof figmaToDesignIrWithOptions>[0], {
    brandTheme: "derived"
  });
  const figmaAnalysis = buildFigmaAnalysis({
    file: figmaInput as Parameters<typeof buildFigmaAnalysis>[0]["file"]
  });
  const withAppShells = applyAppShellsToDesignIr({
    ir: baseIr,
    figmaAnalysis
  });
  const designIr = applyScreenVariantFamiliesToDesignIr({
    ir: withAppShells,
    figmaAnalysis
  });
  return {
    designIr,
    figmaAnalysis
  };
};

const seedFixtureArtifacts = async ({
  executionContext,
  manifest,
  fixtureRoot,
  designIr,
  figmaAnalysis
}: {
  executionContext: PipelineExecutionContext;
  manifest: CustomerBoardGoldenManifest;
  fixtureRoot: string;
  designIr: DesignIR;
  figmaAnalysis: FigmaAnalysis;
}): Promise<void> => {
  await writeFile(executionContext.paths.designIrFile, toStableJsonString(designIr), "utf8");
  await writeFile(executionContext.paths.figmaAnalysisFile, toStableJsonString(figmaAnalysis), "utf8");
  await executionContext.artifactStore.setPath({
    key: STAGE_ARTIFACT_KEYS.designIr,
    stage: "ir.derive",
    absolutePath: executionContext.paths.designIrFile
  });
  await executionContext.artifactStore.setPath({
    key: STAGE_ARTIFACT_KEYS.figmaAnalysis,
    stage: "ir.derive",
    absolutePath: executionContext.paths.figmaAnalysisFile
  });

  const derivedPathFor = (relativePath: string) => path.join(fixtureRoot, relativePath);
  const maybeSetPath = async (key: string, relativePath: string): Promise<void> => {
    await executionContext.artifactStore.setPath({
      key,
      stage: "ir.derive",
      absolutePath: derivedPathFor(relativePath)
    });
  };

  await maybeSetPath(STAGE_ARTIFACT_KEYS.storybookCatalog, manifest.derived.storybookCatalog);
  const storybookEvidenceHintsArtifact = await readJsonFile<CustomerBoardStorybookEvidenceHintsArtifact>({
    filePath: derivedPathFor(manifest.derived.storybookEvidenceHints)
  });
  const runtimeStorybookEvidenceArtifact = materializeCustomerBoardRuntimeStorybookEvidenceArtifact({
    hintsArtifact: storybookEvidenceHintsArtifact
  });
  const runtimeStorybookEvidencePath = path.join(executionContext.paths.jobDir, "storybook.evidence.runtime.json");
  await writeJsonFixtureFile({
    filePath: runtimeStorybookEvidencePath,
    value: runtimeStorybookEvidenceArtifact
  });
  await executionContext.artifactStore.setPath({
    key: STAGE_ARTIFACT_KEYS.storybookEvidence,
    stage: "ir.derive",
    absolutePath: runtimeStorybookEvidencePath
  });
  await maybeSetPath(STAGE_ARTIFACT_KEYS.storybookTokens, manifest.derived.storybookTokens);
  await maybeSetPath(STAGE_ARTIFACT_KEYS.storybookThemes, manifest.derived.storybookThemes);
  await maybeSetPath(STAGE_ARTIFACT_KEYS.storybookComponents, manifest.derived.storybookComponents);
  await maybeSetPath(STAGE_ARTIFACT_KEYS.componentVisualCatalog, manifest.derived.componentVisualCatalog);
  await maybeSetPath(STAGE_ARTIFACT_KEYS.figmaLibraryResolution, manifest.derived.figmaLibraryResolution);
  await maybeSetPath(STAGE_ARTIFACT_KEYS.componentMatchReport, manifest.derived.componentMatchReport);
};

export const loadCustomerBoardGoldenManifest = async ({
  manifestPath = MANIFEST_PATH
}: {
  manifestPath?: string;
} = {}): Promise<CustomerBoardGoldenManifest> => {
  return parseManifest({
    input: await readFile(manifestPath, "utf8")
  });
};

export const loadCustomerBoardFixtureInputs = async ({
  manifest,
  fixtureRoot = FIXTURE_ROOT
}: {
  manifest: CustomerBoardGoldenManifest;
  fixtureRoot?: string;
}): Promise<{
  figmaInput: Record<string, unknown>;
  customerProfile: ResolvedCustomerProfile;
}> => {
  const figmaInput = await readJsonFile<Record<string, unknown>>({
    filePath: path.join(fixtureRoot, manifest.inputs.figma)
  });
  const customerProfileInput = await readJsonFile<Record<string, unknown>>({
    filePath: path.join(fixtureRoot, manifest.inputs.customerProfile)
  });
  return {
    figmaInput,
    customerProfile: parseCustomerProfileFromInput({
      input: customerProfileInput
    })
  };
};

export const executeCustomerBoardFixture = async ({
  manifest,
  fixtureRoot = FIXTURE_ROOT
}: {
  manifest: CustomerBoardGoldenManifest;
  fixtureRoot?: string;
}): Promise<CustomerBoardExecutionResult> => {
  const { figmaInput, customerProfile } = await loadCustomerBoardFixtureInputs({
    manifest,
    fixtureRoot
  });
  const { designIr, figmaAnalysis } = deriveCustomerBoardDesignIrAndAnalysis({
    figmaInput
  });
  const { executionContext, stageContextFor } = await createExecutionContext({
    customerProfile,
    fixtureRoot
  });

  await seedFixtureArtifacts({
    executionContext,
    manifest,
    fixtureRoot,
    designIr,
    figmaAnalysis
  });

  try {
    await TemplatePrepareService.execute(undefined, stageContextFor("template.prepare"));
    await createCodegenGenerateService().execute(
      {
        boardKeySeed: "customer-board-golden"
      },
      stageContextFor("codegen.generate")
    );
    await createValidateProjectService().execute(undefined, stageContextFor("validate.project"));
    return {
      executionContext,
      designIr,
      figmaAnalysis
    };
  } catch (error) {
    throw error;
  }
};

export const collectCustomerBoardFixtureOutputsFromPaths = async ({
  manifest,
  generatedProjectDir,
  jobDir,
  fixtureRoot = FIXTURE_ROOT
}: {
  manifest: CustomerBoardGoldenManifest;
  generatedProjectDir: string;
  jobDir: string;
  fixtureRoot?: string;
}): Promise<Map<string, string>> => {
  const outputs = new Map<string, string>();
  for (const artifact of manifest.expected.generated) {
    const absolutePath = path.join(generatedProjectDir, artifact.actual);
    outputs.set(artifact.expected, await readNormalizedFixtureArtifact({ filePath: absolutePath, kind: artifact.kind }));
  }

  const validationSummary = await readJsonFile<unknown>({
    filePath: path.join(jobDir, "validation-summary.json")
  });
  const sanitizedValidationSummary = normalizeCustomerBoardFixtureValue({
    value: sanitizeValidationSummaryForFixture({
      value: validationSummary
    }),
    jobDir,
    fixtureRoot
  });
  assertCustomerBoardPublicArtifactSanitized({
    label: "validation.summary",
    value: sanitizedValidationSummary
  });
  outputs.set(
    manifest.expected.validationSummary,
    toStableJsonString(sanitizedValidationSummary)
  );
  return outputs;
};

export const collectActualFixtureOutputs = async ({
  manifest,
  executionContext,
  fixtureRoot = FIXTURE_ROOT
}: {
  manifest: CustomerBoardGoldenManifest;
  executionContext: PipelineExecutionContext;
  fixtureRoot?: string;
}): Promise<Map<string, string>> => {
  return collectCustomerBoardFixtureOutputsFromPaths({
    manifest,
    generatedProjectDir: executionContext.paths.generatedProjectDir,
    jobDir: executionContext.paths.jobDir,
    fixtureRoot
  });
};

const createBundleFiles = (): Map<string, CustomerBoardBundleFile> => new Map<string, CustomerBoardBundleFile>();

const addBundleJson = ({
  files,
  relativePath,
  value,
  sanitize = true
}: {
  files: Map<string, CustomerBoardBundleFile>;
  relativePath: string;
  value: unknown;
  sanitize?: boolean;
}): void => {
  const normalizedPath = assertAllowedFixturePath(relativePath);
  if (sanitize) {
    assertCustomerBoardPublicArtifactSanitized({
      label: normalizedPath,
      value
    });
  }
  files.set(normalizedPath, {
    kind: "json",
    content: toStableJsonString(value)
  });
};

const addBundleText = ({
  files,
  relativePath,
  value
}: {
  files: Map<string, CustomerBoardBundleFile>;
  relativePath: string;
  value: string;
}): void => {
  const normalizedPath = assertAllowedFixturePath(relativePath);
  files.set(normalizedPath, {
    kind: "text",
    content: normalizeText(value)
  });
};

const addBundleBinary = ({
  files,
  relativePath,
  value
}: {
  files: Map<string, CustomerBoardBundleFile>;
  relativePath: string;
  value: Buffer;
}): void => {
  const normalizedPath = assertAllowedFixturePath(relativePath);
  files.set(normalizedPath, {
    kind: "binary",
    content: value.toString("base64")
  });
};

const fetchLiveCleanedFigmaFile = async ({
  fileKey,
  accessToken
}: {
  fileKey: string;
  accessToken: string;
}): Promise<Record<string, unknown>> => {
  const runtime = resolveCustomerBoardLiveRuntimeSettings();
  const cacheDir = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-customer-board-live-figma-"));
  try {
    const result = await fetchFigmaFile({
      fileKey,
      accessToken,
      timeoutMs: runtime.figmaTimeoutMs,
      maxRetries: runtime.figmaMaxRetries,
      fetchImpl: fetch,
      onLog: () => {
        // test helper intentionally keeps live fixture fetch quiet
      },
      bootstrapDepth: runtime.figmaBootstrapDepth,
      nodeBatchSize: runtime.figmaNodeBatchSize,
      nodeFetchConcurrency: runtime.figmaNodeFetchConcurrency,
      adaptiveBatchingEnabled: runtime.figmaAdaptiveBatchingEnabled,
      maxScreenCandidates: runtime.figmaMaxScreenCandidates,
      cacheEnabled: runtime.figmaCacheEnabled,
      cacheTtlMs: runtime.figmaCacheTtlMs,
      cacheDir,
      ...(runtime.figmaScreenNamePattern !== undefined
        ? { screenNamePattern: runtime.figmaScreenNamePattern }
        : {}),
      ...(runtime.pipelineDiagnosticLimits !== undefined
        ? { pipelineDiagnosticLimits: runtime.pipelineDiagnosticLimits }
        : {})
    });
    const cleaned = cleanFigmaForCodegen({
      file: result.file
    });
    return sanitizeFigmaInputForFixture({
      input: cleaned.cleanedFile as Record<string, unknown>
    });
  } finally {
    await rm(cacheDir, { recursive: true, force: true });
  }
};

export const buildCustomerBoardGoldenBundle = async ({
  storybookBuildDir,
  figmaFileKey,
  figmaAccessToken
}: {
  storybookBuildDir: string;
  figmaFileKey: string;
  figmaAccessToken: string;
}): Promise<CustomerBoardGoldenBundle> => {
  const files = createBundleFiles();
  const figmaInput = await fetchLiveCleanedFigmaFile({
    fileKey: figmaFileKey,
    accessToken: figmaAccessToken
  });
  return buildCustomerBoardGoldenBundleFromFigmaInput({
    storybookBuildDir,
    figmaInput,
    figmaLibrarySeed: {
      fileKey: figmaFileKey,
      accessToken: figmaAccessToken
    },
    files
  });
};

export const buildCustomerBoardGoldenBundleFromFigmaInput = async ({
  storybookBuildDir,
  storybookJobDir,
  figmaInput,
  figmaLibrarySeed,
  files = createBundleFiles(),
  fixtureRoot = FIXTURE_ROOT
}: {
  storybookBuildDir: string;
  storybookJobDir?: string;
  figmaInput: Record<string, unknown>;
  figmaLibrarySeed?: CustomerBoardFigmaLibrarySeedInput;
  files?: Map<string, CustomerBoardBundleFile>;
  fixtureRoot?: string;
}): Promise<CustomerBoardGoldenBundle> => {
  const { designIr, figmaAnalysis } = deriveCustomerBoardDesignIrAndAnalysis({
    figmaInput
  });

  let evidenceArtifact: StorybookEvidenceArtifact;
  let catalogArtifact: StorybookCatalogArtifact;
  let publicArtifacts: StorybookPublicArtifacts;

  if (storybookJobDir) {
    const artifactPaths = createJobStorybookArtifactPaths({
      jobDir: storybookJobDir
    });
    evidenceArtifact = await readJsonFile<StorybookEvidenceArtifact>({
      filePath: artifactPaths.evidenceFile
    });
    catalogArtifact = await readJsonFile<StorybookCatalogArtifact>({
      filePath: artifactPaths.catalogFile
    });
    publicArtifacts = {
      tokensArtifact: await readJsonFile<StorybookPublicArtifacts["tokensArtifact"]>({
        filePath: artifactPaths.tokensFile
      }),
      themesArtifact: await readJsonFile<StorybookPublicArtifacts["themesArtifact"]>({
        filePath: artifactPaths.themesFile
      }),
      componentsArtifact: await readJsonFile<StorybookPublicArtifacts["componentsArtifact"]>({
        filePath: artifactPaths.componentsFile
      })
    };
  } else {
    const buildContext = await loadStorybookBuildContext({
      buildDir: storybookBuildDir
    });
    evidenceArtifact = await buildStorybookEvidenceArtifact({
      buildDir: storybookBuildDir,
      buildContext
    });
    catalogArtifact = await buildStorybookCatalogArtifact({
      buildDir: storybookBuildDir,
      buildContext,
      evidenceArtifact
    });
    publicArtifacts = await buildStorybookPublicArtifacts({
      buildDir: storybookBuildDir,
      buildContext,
      evidenceArtifact,
      catalogArtifact
    });
  }
  const storybookThemeId = resolvePrimaryStorybookThemeId({
    publicArtifacts
  });
  const customerProfileInput = await loadCustomerBoardCustomerProfileInput({
    fixtureRoot,
    storybookThemeId
  });
  const customerProfile = parseCustomerProfileFromInput({
    input: customerProfileInput
  });
  const tokensArtifact = publicArtifacts.tokensArtifact;
  const themesArtifact = publicArtifacts.themesArtifact;
  const libraryResolutionCacheDir = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-customer-board-library-resolution-"));
  const tempFixtureRoot = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-customer-board-bundle-"));
  try {
    if (figmaLibrarySeed) {
      await resolveFigmaLibraryResolutionArtifact({
        analysis: figmaAnalysis,
        file: figmaInput as Parameters<typeof resolveFigmaLibraryResolutionArtifact>[0]["file"],
        figmaSourceMode: "rest",
        cacheDir: libraryResolutionCacheDir,
        fileKey: figmaLibrarySeed.fileKey,
        accessToken: figmaLibrarySeed.accessToken,
        fetchImpl: fetch,
        timeoutMs: 30_000,
        maxRetries: 4
      });
    }

    const libraryResolutionArtifact = await resolveFigmaLibraryResolutionArtifact({
      analysis: figmaAnalysis,
      file: figmaInput as Parameters<typeof resolveFigmaLibraryResolutionArtifact>[0]["file"],
      figmaSourceMode: "local_json",
      cacheDir: libraryResolutionCacheDir,
      fetchImpl: fetch,
      timeoutMs: 1_000,
      maxRetries: 1
    });
    if (!libraryResolutionArtifact) {
      throw new Error("Expected figma.library_resolution artifact for customer-board fixture generation.");
    }

    const componentMatchReportArtifact = buildComponentMatchReportArtifact({
      figmaAnalysis,
      catalogArtifact,
      evidenceArtifact,
      componentsArtifact: publicArtifacts.componentsArtifact,
      figmaLibraryResolutionArtifact: libraryResolutionArtifact,
      resolvedCustomerProfile: customerProfile,
      resolvedStorybookTheme: resolveStorybookTheme({
        customerBrandId: CUSTOMER_BOARD_BRAND_ID,
        customerProfile,
        tokensArtifact,
        themesArtifact
      })
    });

    const storybookEvidenceHintsArtifact = createCustomerBoardStorybookEvidenceHintsArtifact({
      artifact: evidenceArtifact
    });
    const componentVisualCatalogArtifact = buildStorybookComponentVisualCatalogArtifact({
      componentMatchReportArtifact,
      catalogArtifact,
      evidenceArtifact
    });
    const selectedVisualReferenceNode = selectVisualQualityReferenceNode({
      file: figmaInput,
      preferredNamePattern: "SeitenContent"
    });

    const manifestBase: CustomerBoardGoldenManifest = {
      version: 3,
      fixtureId: "customer-board-golden",
      inputs: {
        figma: "inputs/figma.json",
        customerProfile: "inputs/customer-profile.json"
      },
      derived: {
        storybookEvidenceHints: "derived/storybook.evidence-hints.json",
        storybookCatalog: "derived/storybook.catalog.json",
        storybookTokens: "derived/storybook.tokens.json",
        storybookThemes: "derived/storybook.themes.json",
        storybookComponents: "derived/storybook.components.json",
        componentVisualCatalog: "derived/storybook.component-visual-catalog.json",
        figmaAnalysis: "derived/figma-analysis.json",
        figmaLibraryResolution: "derived/figma-library-resolution.json",
        componentMatchReport: "derived/component-match-report.json"
      },
      visualQuality: {
        frozenReferenceImage: "visual-quality/reference.png",
        frozenReferenceMetadata: "visual-quality/reference.metadata.json"
      },
      expected: {
        validationSummary: "expected/validation-summary.json",
        generated: []
      }
    };
    const frozenVisualReference = figmaLibrarySeed
      ? await fetchFigmaVisualReference({
          fileKey: figmaLibrarySeed.fileKey,
          nodeId: selectedVisualReferenceNode.nodeId,
          accessToken: figmaLibrarySeed.accessToken,
          desiredWidth: CUSTOMER_BOARD_VISUAL_QUALITY_VIEWPORT_WIDTH,
          fetchImpl: fetch,
          maxRetries: 4
        })
      : {
          buffer: await readFile(path.join(fixtureRoot, manifestBase.visualQuality.frozenReferenceImage)),
          metadata: await readJsonFile({
            filePath: path.join(fixtureRoot, manifestBase.visualQuality.frozenReferenceMetadata)
          })
        };

    const tempDerivedRoot = path.join(tempFixtureRoot, "derived");
    await writeJsonFixtureFile({
      filePath: path.join(tempFixtureRoot, manifestBase.derived.storybookEvidenceHints),
      value: storybookEvidenceHintsArtifact
    });
    await writeJsonFixtureFile({
      filePath: path.join(tempFixtureRoot, manifestBase.derived.storybookCatalog),
      value: sanitizeCatalogArtifact({ artifact: catalogArtifact })
    });
    await writeJsonFixtureFile({
      filePath: path.join(tempFixtureRoot, manifestBase.derived.storybookTokens),
      value: tokensArtifact
    });
    await writeJsonFixtureFile({
      filePath: path.join(tempFixtureRoot, manifestBase.derived.storybookThemes),
      value: themesArtifact
    });
    await writeJsonFixtureFile({
      filePath: path.join(tempFixtureRoot, manifestBase.derived.storybookComponents),
      value: sanitizeComponentsArtifact({ artifact: publicArtifacts.componentsArtifact })
    });
    await writeJsonFixtureFile({
      filePath: path.join(tempFixtureRoot, manifestBase.derived.componentVisualCatalog),
      value: sanitizeComponentVisualCatalogArtifact({
        artifact: componentVisualCatalogArtifact as Record<string, unknown>
      })
    });
    await writeJsonFixtureFile({
      filePath: path.join(tempFixtureRoot, manifestBase.derived.figmaLibraryResolution),
      value: sanitizeFigmaLibraryResolutionArtifact({
        artifact: libraryResolutionArtifact
      })
    });
    await writeJsonFixtureFile({
      filePath: path.join(tempFixtureRoot, manifestBase.derived.componentMatchReport),
      value: componentMatchReportArtifact
    });
    await mkdir(path.join(tempFixtureRoot, path.dirname(manifestBase.visualQuality.frozenReferenceImage)), { recursive: true });
    await writeFile(
      path.join(tempFixtureRoot, manifestBase.visualQuality.frozenReferenceImage),
      frozenVisualReference.buffer
    );
    await writeJsonFixtureFile({
      filePath: path.join(tempFixtureRoot, manifestBase.visualQuality.frozenReferenceMetadata),
      value: frozenVisualReference.metadata
    });
    void tempDerivedRoot;

    const runtimeManifest = {
      ...manifestBase,
      expected: {
        ...manifestBase.expected,
        generated: []
      }
    } satisfies CustomerBoardGoldenManifest;

    await writeJsonFixtureFile({
      filePath: path.join(tempFixtureRoot, runtimeManifest.inputs.figma),
      value: figmaInput
    });
    await writeJsonFixtureFile({
      filePath: path.join(tempFixtureRoot, runtimeManifest.inputs.customerProfile),
      value: customerProfileInput
    });
    await writeJsonFixtureFile({
      filePath: path.join(tempFixtureRoot, "manifest.json"),
      value: runtimeManifest
    });

    const { executionContext } = await executeCustomerBoardFixture({
      manifest: runtimeManifest,
      fixtureRoot: tempFixtureRoot
    });
    const generatedSpecs = await buildCuratedGeneratedArtifactSpecs({
      generatedProjectDir: executionContext.paths.generatedProjectDir
    });
    const manifest: CustomerBoardGoldenManifest = {
      ...runtimeManifest,
      expected: {
        ...runtimeManifest.expected,
        generated: generatedSpecs
      }
    };

    addBundleJson({
      files,
      relativePath: manifest.inputs.figma,
      value: figmaInput,
      sanitize: false
    });
    addBundleJson({
      files,
      relativePath: manifest.inputs.customerProfile,
      value: customerProfileInput,
      sanitize: false
    });
    addBundleJson({
      files,
      relativePath: manifest.derived.storybookEvidenceHints,
      value: storybookEvidenceHintsArtifact
    });
    addBundleJson({
      files,
      relativePath: manifest.derived.storybookCatalog,
      value: sanitizeCatalogArtifact({ artifact: catalogArtifact })
    });
    addBundleJson({
      files,
      relativePath: manifest.derived.storybookTokens,
      value: tokensArtifact
    });
    addBundleJson({
      files,
      relativePath: manifest.derived.storybookThemes,
      value: themesArtifact
    });
    addBundleJson({
      files,
      relativePath: manifest.derived.storybookComponents,
      value: sanitizeComponentsArtifact({ artifact: publicArtifacts.componentsArtifact })
    });
    addBundleJson({
      files,
      relativePath: manifest.derived.componentVisualCatalog,
      value: sanitizeComponentVisualCatalogArtifact({
        artifact: componentVisualCatalogArtifact as Record<string, unknown>
      })
    });
    addBundleJson({
      files,
      relativePath: manifest.derived.figmaAnalysis,
      value: figmaAnalysis,
      sanitize: false
    });
    addBundleJson({
      files,
      relativePath: manifest.derived.figmaLibraryResolution,
      value: sanitizeFigmaLibraryResolutionArtifact({
        artifact: libraryResolutionArtifact
      }),
      sanitize: false
    });
    addBundleJson({
      files,
      relativePath: manifest.derived.componentMatchReport,
      value: componentMatchReportArtifact
    });
    addBundleBinary({
      files,
      relativePath: manifest.visualQuality.frozenReferenceImage,
      value: frozenVisualReference.buffer
    });
    addBundleJson({
      files,
      relativePath: manifest.visualQuality.frozenReferenceMetadata,
      value: frozenVisualReference.metadata,
      sanitize: false
    });

    const outputs = await collectActualFixtureOutputs({
      manifest,
      executionContext,
      fixtureRoot: tempFixtureRoot
    });
    for (const [relativePath, content] of outputs.entries()) {
      const spec = relativePath.endsWith(".json") || relativePath === manifest.expected.validationSummary ? "json" : "text";
      files.set(relativePath, {
        kind: spec,
        content: spec === "text" ? normalizeText(content) : normalizeText(content)
      });
    }

    files.set("manifest.json", {
      kind: "json",
      content: toStableJsonString(manifest)
    });

    return {
      manifest,
      files
    };
  } finally {
    await rm(tempFixtureRoot, { recursive: true, force: true });
    await rm(libraryResolutionCacheDir, { recursive: true, force: true });
  }
};

export const writeCustomerBoardGoldenBundle = async ({
  bundle,
  fixtureRoot = FIXTURE_ROOT
}: {
  bundle: CustomerBoardGoldenBundle;
  fixtureRoot?: string;
}): Promise<void> => {
  for (const [relativePath, entry] of bundle.files.entries()) {
    const absolutePath = path.join(fixtureRoot, relativePath);
    await mkdir(path.dirname(absolutePath), { recursive: true });
    if (entry.kind === "binary") {
      await writeFile(absolutePath, Buffer.from(entry.content, "base64"));
      continue;
    }
    await writeFile(absolutePath, entry.content, "utf8");
  }
};

export const readCommittedCustomerBoardGoldenBundle = async ({
  fixtureRoot = FIXTURE_ROOT
}: {
  fixtureRoot?: string;
} = {}): Promise<CustomerBoardGoldenBundle> => {
  const manifest = await loadCustomerBoardGoldenManifest({
    manifestPath: path.join(fixtureRoot, "manifest.json")
  });
  const files = createBundleFiles();
  const allRelativePaths = [
    "manifest.json",
    manifest.inputs.figma,
    manifest.inputs.customerProfile,
    manifest.derived.storybookCatalog,
    manifest.derived.storybookEvidenceHints,
    manifest.derived.storybookTokens,
    manifest.derived.storybookThemes,
    manifest.derived.storybookComponents,
    manifest.derived.componentVisualCatalog,
    manifest.derived.figmaAnalysis,
    manifest.derived.figmaLibraryResolution,
    manifest.derived.componentMatchReport,
    manifest.visualQuality.frozenReferenceImage,
    manifest.visualQuality.frozenReferenceMetadata,
    manifest.expected.validationSummary,
    ...manifest.expected.generated.map((entry) => entry.expected)
  ];

  for (const relativePath of allRelativePaths) {
    const kind: FixtureArtifactKind =
      relativePath === manifest.visualQuality.frozenReferenceImage
        ? "binary"
        : relativePath.endsWith(".json") || relativePath === "manifest.json"
          ? "json"
          : "text";
    files.set(relativePath, {
      kind,
      content: await readNormalizedFixtureArtifact({
        filePath: path.join(fixtureRoot, relativePath),
        kind
      })
    });
  }

  return {
    manifest,
    files
  };
};

export const assertCustomerBoardBundlesEqual = async ({
  actual,
  expected
}: {
  actual: CustomerBoardGoldenBundle;
  expected: CustomerBoardGoldenBundle;
}): Promise<void> => {
  assert.deepEqual([...actual.files.keys()].sort(compareStrings), [...expected.files.keys()].sort(compareStrings));
  for (const [relativePath, actualEntry] of actual.files.entries()) {
    const expectedEntry = expected.files.get(relativePath);
    assert.ok(expectedEntry, `Expected committed customer-board bundle entry '${relativePath}'.`);
    assert.equal(actualEntry.kind, expectedEntry.kind, `Artifact kind mismatch for '${relativePath}'.`);
    assert.equal(
      normalizeBundleEntryContentForComparison({
        relativePath,
        entry: actualEntry
      }),
      normalizeBundleEntryContentForComparison({
        relativePath,
        entry: expectedEntry
      }),
      `Artifact content mismatch for '${relativePath}'.`
    );
  }
};

export const getCustomerBoardFixtureRoot = (): string => FIXTURE_ROOT;
export const getCustomerBoardManifestPath = (): string => MANIFEST_PATH;
export const getCustomerBoardRequestedStorybookStaticDir = (): string => REQUESTED_STORYBOOK_STATIC_DIR;
export const getCustomerBoardBrandId = (): string => CUSTOMER_BOARD_BRAND_ID;

export const isWorkspacePipelineError = (error: unknown): error is WorkspacePipelineError => {
  return (
    error instanceof Error &&
    "code" in error &&
    typeof (error as { code?: unknown }).code === "string" &&
    "stage" in error &&
    typeof (error as { stage?: unknown }).stage === "string"
  );
};
