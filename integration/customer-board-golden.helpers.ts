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
  resolveFigmaLibraryResolutionArtifact,
  type FigmaLibraryResolutionArtifact
} from "../src/job-engine/figma-library-resolution.js";
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
import {
  buildStorybookEvidenceArtifact,
  loadStorybookBuildContext,
  type StorybookEvidenceArtifact
} from "../src/storybook/evidence.js";
import {
  buildStorybookPublicArtifacts,
  type StorybookPublicArtifacts
} from "../src/storybook/public-extracts.js";
import { resolveStorybookTheme } from "../src/storybook/theme-resolver.js";
import {
  STORYBOOK_PUBLIC_EXTENSION_KEY,
  type StorybookPublicComponentsArtifact,
  type StorybookPublicThemesArtifact,
  type StorybookPublicTokensArtifact
} from "../src/storybook/types.js";

const MODULE_DIR = typeof __dirname === "string" ? __dirname : path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_ROOT = path.resolve(MODULE_DIR, "fixtures", "customer-board-golden");
const MANIFEST_PATH = path.join(FIXTURE_ROOT, "manifest.json");
const REQUESTED_STORYBOOK_STATIC_DIR = "storybook-static/storybook-static";
const CUSTOMER_BOARD_BRAND_ID = "customer-board";
const WORKSPACE_ROOT = process.cwd();

const TIMESTAMP_KEYS = new Set(["validatedAt", "submittedAt", "startedAt", "finishedAt", "lastModified", "updatedAt", "createdAt"]);
const PATH_KEYS = new Set(["filePath", "reportPath", "outputDir", "catalogPath", "generatedProjectDir", "jobDir", "reproDir"]);
const FORBIDDEN_FIXTURE_PATH_SEGMENTS = [
  "storybook.evidence",
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
    enableUiValidation: false,
    enableUnitTestValidation: false,
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

type FixtureArtifactKind = "json" | "text";

export interface CustomerBoardGoldenGeneratedArtifactSpec {
  name: string;
  kind: FixtureArtifactKind;
  actual: string;
  expected: string;
}

export interface CustomerBoardGoldenManifest {
  version: 1;
  fixtureId: "customer-board-golden";
  inputs: {
    figma: string;
    customerProfile: string;
  };
  derived: {
    storybookCatalog: string;
    storybookTokens: string;
    storybookThemes: string;
    storybookComponents: string;
    figmaAnalysis: string;
    figmaLibraryResolution: string;
    componentMatchReport: string;
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
  if (parsed.version !== 1) {
    throw new Error("customer-board manifest version must be 1.");
  }

  const inputs = parsed.inputs;
  const derived = parsed.derived;
  const expected = parsed.expected;
  if (!isPlainRecord(inputs) || !isPlainRecord(derived) || !isPlainRecord(expected)) {
    throw new Error("customer-board manifest inputs, derived, and expected sections are required.");
  }

  const generated = expected.generated;
  if (!Array.isArray(generated) || generated.length === 0) {
    throw new Error("customer-board manifest expected.generated must contain at least one artifact.");
  }

  const output: CustomerBoardGoldenManifest = {
    version: 1,
    fixtureId: "customer-board-golden",
    inputs: {
      figma: assertAllowedFixturePath(String(inputs.figma ?? "")),
      customerProfile: assertAllowedFixturePath(String(inputs.customerProfile ?? ""))
    },
    derived: {
      storybookCatalog: assertAllowedFixturePath(String(derived.storybookCatalog ?? "")),
      storybookTokens: assertAllowedFixturePath(String(derived.storybookTokens ?? "")),
      storybookThemes: assertAllowedFixturePath(String(derived.storybookThemes ?? "")),
      storybookComponents: assertAllowedFixturePath(String(derived.storybookComponents ?? "")),
      figmaAnalysis: assertAllowedFixturePath(String(derived.figmaAnalysis ?? "")),
      figmaLibraryResolution: assertAllowedFixturePath(String(derived.figmaLibraryResolution ?? "")),
      componentMatchReport: assertAllowedFixturePath(String(derived.componentMatchReport ?? ""))
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

const createCustomerBoardCustomerProfileInput = (): Record<string, unknown> => {
  return {
    version: 1,
    families: [
      {
        id: "Components",
        tierPriority: 10,
        aliases: {
          figma: ["Components"],
          storybook: ["components"],
          code: ["@customer/components"]
        }
      },
      {
        id: "ReactUI",
        tierPriority: 20,
        aliases: {
          figma: ["ReactUI"],
          storybook: ["reactui"],
          code: ["@customer/reactui"]
        }
      },
      {
        id: "Reactlib",
        tierPriority: 30,
        aliases: {
          figma: ["Reactlib"],
          storybook: ["reactlib"],
          code: ["@customer/reactlib"]
        }
      },
      {
        id: "IF-Components",
        tierPriority: 40,
        aliases: {
          figma: ["IF-Components"],
          storybook: ["if-components"],
          code: ["@customer/if-components"]
        }
      },
      {
        id: "OSPlus_neo-Components",
        tierPriority: 50,
        aliases: {
          figma: ["OSPlus_neo-Components"],
          storybook: ["osplus_neo-components", "osplus-neo-components"],
          code: ["@customer/osplus-neo-components"]
        }
      },
      {
        id: "Base",
        tierPriority: 60,
        aliases: {
          figma: ["Base"],
          storybook: ["base"],
          code: ["@customer/base"]
        }
      }
    ],
    brandMappings: [
      {
        id: CUSTOMER_BOARD_BRAND_ID,
        aliases: [CUSTOMER_BOARD_BRAND_ID, "sparkasse"],
        brandTheme: "sparkasse",
        storybookThemes: {
          light: "customer-board-light"
        }
      }
    ],
    imports: {
      components: {},
      icons: {}
    },
    fallbacks: {
      mui: {
        defaultPolicy: "allow",
        components: {}
      },
      icons: {
        defaultPolicy: "deny",
        icons: {}
      }
    },
    template: {
      dependencies: {},
      devDependencies: {},
      importAliases: {}
    },
    strictness: {
      match: "warn",
      token: "warn",
      import: "error"
    }
  };
};

const createCustomerBoardTokensArtifact = (): StorybookPublicTokensArtifact => {
  return {
    $schema: "https://www.designtokens.org/TR/2025.10/format/",
    $extensions: {
      [STORYBOOK_PUBLIC_EXTENSION_KEY]: {
        artifact: "storybook.tokens",
        version: 3,
        stats: {
          tokenCount: 13,
          themeCount: 1,
          byType: {
            color: 7,
            dimension: 2,
            fontFamily: 1,
            fontWeight: 0,
            number: 0,
            typography: 3
          },
          diagnosticCount: 0,
          errorCount: 0
        },
        diagnostics: [],
        themes: [
          {
            id: "customer-board-light",
            name: "Customer Board Light",
            context: "default",
            categories: ["color", "spacing", "radius", "typography", "font"],
            tokenCount: 13
          }
        ],
        provenance: {}
      }
    },
    theme: {
      "customer-board-light": {
        color: {
          primary: {
            main: { $type: "color", $value: "#d20a11" },
            "contrast-text": { $type: "color", $value: "#ffffff" }
          },
          secondary: {
            main: { $type: "color", $value: "#1a3d8f" }
          },
          text: {
            primary: { $type: "color", $value: "#212121" }
          },
          background: {
            default: { $type: "color", $value: "#f5f5f5" },
            paper: { $type: "color", $value: "#ffffff" }
          },
          divider: { $type: "color", $value: "#d9d9d9" }
        },
        spacing: {
          base: { $type: "dimension", $value: { value: 8, unit: "px" } }
        },
        radius: {
          shape: {
            "border-radius": { $type: "dimension", $value: { value: 12, unit: "px" } }
          }
        },
        typography: {
          base: {
            $type: "typography",
            $value: {
              fontFamily: "{font.family.body-text}",
              fontSize: { value: 16, unit: "px" },
              fontWeight: 400,
              lineHeight: 1.5
            }
          },
          body1: {
            $type: "typography",
            $value: {
              fontFamily: "{font.family.body-text}",
              fontSize: { value: 16, unit: "px" },
              fontWeight: 400,
              lineHeight: 1.5
            }
          },
          h1: {
            $type: "typography",
            $value: {
              fontFamily: "{font.family.body-text}",
              fontSize: { value: 28, unit: "px" },
              fontWeight: 700,
              lineHeight: 1.25
            }
          }
        }
      }
    },
    font: {
      family: {
        "body-text": {
          $type: "fontFamily",
          $value: "Body Text"
        }
      }
    }
  } as StorybookPublicTokensArtifact;
};

const createCustomerBoardThemesArtifact = (): StorybookPublicThemesArtifact => {
  return {
    $schema: "https://www.designtokens.org/TR/2025.10/resolver/",
    name: "storybook.themes",
    version: "2025.10",
    sets: {
      "customer-board-light": {
        sources: [{ $ref: "./tokens.json#/theme/customer-board-light" }]
      }
    },
    modifiers: {
      theme: {
        default: "default",
        contexts: {
          default: [{ $ref: "#/sets/customer-board-light" }]
        }
      }
    },
    resolutionOrder: [{ $ref: "#/modifiers/theme" }],
    $extensions: {
      [STORYBOOK_PUBLIC_EXTENSION_KEY]: {
        artifact: "storybook.themes",
        version: 3,
        stats: {
          themeCount: 1,
          contextCount: 1,
          diagnosticCount: 0,
          errorCount: 0
        },
        diagnostics: [],
        themes: [
          {
            id: "customer-board-light",
            name: "Customer Board Light",
            context: "default",
            categories: ["color", "spacing", "radius", "typography", "font"],
            tokenCount: 13
          }
        ],
        provenance: {}
      }
    }
  } as StorybookPublicThemesArtifact;
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
      const { componentPath, ...rest } = component;
      const normalizedComponentPath = componentPath?.trim();
      return {
        ...rest,
        ...(normalizedComponentPath &&
        !normalizedComponentPath.startsWith("./") &&
        !normalizedComponentPath.startsWith("/") &&
        !normalizedComponentPath.includes("src/")
          ? { componentPath: normalizedComponentPath }
          : {})
      };
    })
  } satisfies StorybookPublicComponentsArtifact;
  assertCustomerBoardPublicArtifactSanitized({
    label: "storybook.components",
    value: sanitized
  });
  return sanitized;
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
  jobDir
}: {
  runtime: ReturnType<typeof resolveRuntimeSettings>;
  jobDir: string;
}): JobRecord => {
  return {
    jobId: "customer-board-golden",
    status: "queued",
    submittedAt: nowIso(),
    request: {
      enableGitPr: false,
      figmaSourceMode: "local_json",
      llmCodegenMode: "deterministic",
      brandTheme: "derived",
      customerBrandId: CUSTOMER_BOARD_BRAND_ID,
      customerProfilePath: "integration/fixtures/customer-board-golden/inputs/customer-profile.json",
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
  rootDir
}: {
  customerProfile: ResolvedCustomerProfile;
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
    skipInstall: true,
    enableUiValidation: false,
    enableUnitTestValidation: false,
    figmaMaxRetries: 1,
    figmaRequestTimeoutMs: 1_000,
    customerProfile
  });

  await mkdir(jobDir, { recursive: true });
  await mkdir(generatedProjectDir, { recursive: true });

  const artifactStore = new StageArtifactStore({ jobDir });
  const executionContext: PipelineExecutionContext = {
    mode: "submission",
    job: createJobRecord({
      runtime,
      jobDir
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
  const raw = await readFile(filePath, "utf8");
  if (kind === "text") {
    return normalizeText(raw);
  }
  const parsed = JSON.parse(raw) as unknown;
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
  await maybeSetPath(STAGE_ARTIFACT_KEYS.storybookTokens, manifest.derived.storybookTokens);
  await maybeSetPath(STAGE_ARTIFACT_KEYS.storybookThemes, manifest.derived.storybookThemes);
  await maybeSetPath(STAGE_ARTIFACT_KEYS.storybookComponents, manifest.derived.storybookComponents);
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
    customerProfile
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
  outputs.set(
    manifest.expected.validationSummary,
    toStableJsonString(
      normalizeCustomerBoardFixtureValue({
        value: validationSummary,
        jobDir,
        fixtureRoot
      })
    )
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
  figmaInput,
  figmaLibrarySeed,
  files = createBundleFiles()
}: {
  storybookBuildDir: string;
  figmaInput: Record<string, unknown>;
  figmaLibrarySeed?: CustomerBoardFigmaLibrarySeedInput;
  files?: Map<string, CustomerBoardBundleFile>;
}): Promise<CustomerBoardGoldenBundle> => {
  const customerProfileInput = createCustomerBoardCustomerProfileInput();
  const customerProfile = parseCustomerProfileFromInput({
    input: customerProfileInput
  });
  const { designIr, figmaAnalysis } = deriveCustomerBoardDesignIrAndAnalysis({
    figmaInput
  });

  const buildContext = await loadStorybookBuildContext({
    buildDir: storybookBuildDir
  });
  const evidenceArtifact = await buildStorybookEvidenceArtifact({
    buildDir: storybookBuildDir,
    buildContext
  });
  const catalogArtifact = await buildStorybookCatalogArtifact({
    buildDir: storybookBuildDir,
    buildContext,
    evidenceArtifact
  });
  const publicArtifacts = await buildStorybookPublicArtifacts({
    buildDir: storybookBuildDir,
    buildContext,
    evidenceArtifact,
    catalogArtifact
  });

  const tokensArtifact = createCustomerBoardTokensArtifact();
  const themesArtifact = createCustomerBoardThemesArtifact();
  const resolvedStorybookTheme = resolveStorybookTheme({
    customerBrandId: CUSTOMER_BOARD_BRAND_ID,
    customerProfile,
    tokensArtifact,
    themesArtifact
  });

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
      resolvedStorybookTheme
    });

    const manifestBase: CustomerBoardGoldenManifest = {
      version: 1,
      fixtureId: "customer-board-golden",
      inputs: {
        figma: "inputs/figma.json",
        customerProfile: "inputs/customer-profile.json"
      },
      derived: {
        storybookCatalog: "derived/storybook.catalog.json",
        storybookTokens: "derived/storybook.tokens.json",
        storybookThemes: "derived/storybook.themes.json",
        storybookComponents: "derived/storybook.components.json",
        figmaAnalysis: "derived/figma-analysis.json",
        figmaLibraryResolution: "derived/figma-library-resolution.json",
        componentMatchReport: "derived/component-match-report.json"
      },
      expected: {
        validationSummary: "expected/validation-summary.json",
        generated: []
      }
    };

    const tempDerivedRoot = path.join(tempFixtureRoot, "derived");
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
      filePath: path.join(tempFixtureRoot, manifestBase.derived.figmaLibraryResolution),
      value: sanitizeFigmaLibraryResolutionArtifact({
        artifact: libraryResolutionArtifact
      })
    });
    await writeJsonFixtureFile({
      filePath: path.join(tempFixtureRoot, manifestBase.derived.componentMatchReport),
      value: componentMatchReportArtifact
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
    manifest.derived.storybookTokens,
    manifest.derived.storybookThemes,
    manifest.derived.storybookComponents,
    manifest.derived.figmaAnalysis,
    manifest.derived.figmaLibraryResolution,
    manifest.derived.componentMatchReport,
    manifest.expected.validationSummary,
    ...manifest.expected.generated.map((entry) => entry.expected)
  ];

  for (const relativePath of allRelativePaths) {
    const kind: FixtureArtifactKind =
      relativePath.endsWith(".json") || relativePath === "manifest.json" ? "json" : "text";
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
    assert.equal(actualEntry.content, expectedEntry.content, `Artifact content mismatch for '${relativePath}'.`);
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
