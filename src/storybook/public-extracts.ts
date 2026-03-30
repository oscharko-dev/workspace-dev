import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { buildStorybookEvidenceArtifact } from "./evidence.js";
import { buildStorybookThemeCatalog } from "./theme-catalog.js";
import { uniqueSorted } from "./text.js";
import { STORYBOOK_PUBLIC_EXTENSION_KEY } from "./types.js";
import type {
  StorybookEvidenceItem,
  StorybookExtractedTheme,
  StorybookPublicArtifactFilePaths,
  StorybookPublicArtifacts,
  StorybookPublicComponent,
  StorybookPublicComponentsArtifact,
  StorybookPublicThemesArtifact,
  StorybookPublicTokensArtifact,
  StorybookThemeDiagnostic,
  StorybookTokenGraphEntry,
  StorybookTokenValueType
} from "./types.js";

const STORYBOOK_PUBLIC_TOKENS_FILE_NAME = "tokens.json";
const STORYBOOK_PUBLIC_THEMES_FILE_NAME = "themes.json";
const STORYBOOK_PUBLIC_COMPONENTS_FILE_NAME = "components.json";
const DTCG_FORMAT_SCHEMA_URL = "https://www.designtokens.org/TR/2025.10/format/";
const DTCG_RESOLVER_SCHEMA_URL = "https://www.designtokens.org/TR/2025.10/resolver/";
const THEME_CONTEXT_PREFIX = "theme";

type JsonPrimitive = boolean | number | string | null;
type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

interface ComponentAccumulator {
  title: string;
  componentPath?: string;
  storyIds: Set<string>;
  propKeys: Set<string>;
  hasDesignReference: boolean;
}

const toStableJsonValue = (value: JsonValue): JsonValue => {
  if (Array.isArray(value)) {
    return value.map((item) => toStableJsonValue(item));
  }
  if (typeof value === "object" && value !== null) {
    const entries = Object.entries(value).sort(([left], [right]) => left.localeCompare(right));
    const result: Record<string, JsonValue> = {};
    for (const [key, entryValue] of entries) {
      result[key] = toStableJsonValue(entryValue);
    }
    return result;
  }
  return value;
};

const toStableJsonString = (value: JsonValue): string => {
  return `${JSON.stringify(toStableJsonValue(value), null, 2)}\n`;
};

const buildStableId = (prefix: string, value: unknown): string => {
  const hash = createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 16);
  return `${prefix}:${hash}`;
};

const compareComponents = (left: StorybookPublicComponent, right: StorybookPublicComponent): number => {
  const byTitle = left.title.localeCompare(right.title);
  if (byTitle !== 0) {
    return byTitle;
  }
  return left.name.localeCompare(right.name);
};

const toSanitizedDiagnostics = (
  diagnostics: StorybookThemeDiagnostic[]
): Array<Pick<StorybookThemeDiagnostic, "code" | "message" | "severity" | "themeId" | "tokenPath">> => {
  return diagnostics.map((diagnostic) => ({
    code: diagnostic.code,
    message: diagnostic.message,
    severity: diagnostic.severity,
    ...(diagnostic.themeId ? { themeId: diagnostic.themeId } : {}),
    ...(diagnostic.tokenPath ? { tokenPath: diagnostic.tokenPath } : {})
  }));
};

const toThemeSummaries = (
  themes: StorybookExtractedTheme[]
): Array<Pick<StorybookExtractedTheme, "id" | "name" | "context" | "categories" | "tokenCount">> => {
  return themes.map((theme) => ({
    id: theme.id,
    name: theme.name,
    context: theme.context,
    categories: theme.categories,
    tokenCount: theme.tokenCount
  }));
};

const createInitialTokenCountRecord = (): Record<StorybookTokenValueType, number> => ({
  color: 0,
  dimension: 0,
  fontFamily: 0,
  fontWeight: 0,
  number: 0,
  typography: 0
});

const setNestedRecordValue = ({
  target,
  pathSegments,
  value
}: {
  target: Record<string, unknown>;
  pathSegments: string[];
  value: Record<string, unknown>;
}): void => {
  let cursor: Record<string, unknown> = target;
  for (let index = 0; index < pathSegments.length; index += 1) {
    const segment = pathSegments[index];
    if (!segment) {
      continue;
    }
    if (index === pathSegments.length - 1) {
      cursor[segment] = value;
      return;
    }

    const existing = cursor[segment];
    if (typeof existing !== "object" || existing === null || Array.isArray(existing)) {
      const next: Record<string, unknown> = {};
      cursor[segment] = next;
      cursor = next;
      continue;
    }
    cursor = existing as Record<string, unknown>;
  }
};

const buildTokenNode = (token: StorybookTokenGraphEntry): Record<string, unknown> => {
  const extensions: Record<string, unknown> = {};
  if (token.cssVariableNames && token.cssVariableNames.length > 0) {
    extensions.cssVariableNames = uniqueSorted(token.cssVariableNames);
  }
  if (token.aliases && token.aliases.length > 0) {
    extensions.aliases = token.aliases.map((alias) => alias.path.join("."));
  }

  return {
    $type: token.tokenType,
    $value: token.value,
    ...(token.description ? { $description: token.description } : {}),
    ...(Object.keys(extensions).length > 0 ? { $extensions: { [STORYBOOK_PUBLIC_EXTENSION_KEY]: extensions } } : {})
  };
};

const buildComponentsArtifact = ({
  entryCount,
  evidenceItems
}: {
  entryCount: number;
  evidenceItems: StorybookEvidenceItem[];
}): StorybookPublicComponentsArtifact => {
  const componentsByImportPath = new Map<string, ComponentAccumulator>();

  for (const item of evidenceItems) {
    if (item.type !== "story_componentPath") {
      continue;
    }
    const importPath = item.source.importPath;
    const title = item.source.title;
    if (typeof importPath !== "string" || typeof title !== "string") {
      continue;
    }
    const existing = componentsByImportPath.get(importPath) ?? {
      title,
      storyIds: new Set<string>(),
      propKeys: new Set<string>(),
      hasDesignReference: false
    };
    if (typeof item.summary.componentPath === "string") {
      existing.componentPath = item.summary.componentPath;
    }
    const entryId = item.source.entryId;
    if (typeof entryId === "string") {
      existing.storyIds.add(entryId);
    }
    componentsByImportPath.set(importPath, existing);
  }

  for (const item of evidenceItems) {
    const importPath = item.source.importPath;
    if (typeof importPath !== "string") {
      continue;
    }
    const component = componentsByImportPath.get(importPath);
    if (!component) {
      continue;
    }

    if (item.type === "story_argTypes" || item.type === "story_args") {
      for (const key of item.summary.keys ?? []) {
        component.propKeys.add(key);
      }
    }
    if (item.type === "story_design_link") {
      component.hasDesignReference = true;
    }
    for (const entryId of item.source.entryIds ?? []) {
      component.storyIds.add(entryId);
    }
  }

  const components = [...componentsByImportPath.values()]
    .map((component) => {
      const name = component.title.split("/").at(-1) ?? component.title;
      return {
        id: buildStableId("component", {
          title: component.title,
          componentPath: component.componentPath ?? "",
          propKeys: [...component.propKeys].sort((left, right) => left.localeCompare(right))
        }),
        name,
        title: component.title,
        ...(component.componentPath ? { componentPath: component.componentPath } : {}),
        propKeys: [...component.propKeys].sort((left, right) => left.localeCompare(right)),
        storyCount: component.storyIds.size,
        hasDesignReference: component.hasDesignReference
      } satisfies StorybookPublicComponent;
    })
    .sort(compareComponents);

  return {
    artifact: "storybook.components",
    version: 1,
    stats: {
      entryCount,
      componentCount: components.length,
      componentWithDesignReferenceCount: components.filter((component) => component.hasDesignReference).length,
      propKeyCount: new Set(components.flatMap((component) => component.propKeys)).size
    },
    components
  };
};

const buildTokensArtifact = ({
  tokens,
  themes,
  diagnostics
}: {
  tokens: StorybookTokenGraphEntry[];
  themes: StorybookExtractedTheme[];
  diagnostics: StorybookThemeDiagnostic[];
}): StorybookPublicTokensArtifact => {
  const byType = createInitialTokenCountRecord();
  const tokenDocument: Record<string, unknown> = {};

  for (const token of tokens) {
    byType[token.tokenType] += 1;
    setNestedRecordValue({
      target: tokenDocument,
      pathSegments: token.path,
      value: buildTokenNode(token)
    });
  }

  return {
    $schema: DTCG_FORMAT_SCHEMA_URL,
    ...tokenDocument,
    $extensions: {
      [STORYBOOK_PUBLIC_EXTENSION_KEY]: {
        artifact: "storybook.tokens",
        version: 2,
        stats: {
          tokenCount: tokens.length,
          themeCount: themes.length,
          byType,
          diagnosticCount: diagnostics.length,
          errorCount: diagnostics.filter((diagnostic) => diagnostic.severity === "error").length
        },
        diagnostics: toSanitizedDiagnostics(diagnostics),
        themes: toThemeSummaries(themes)
      }
    }
  };
};

const buildThemesArtifact = ({
  themes,
  diagnostics
}: {
  themes: StorybookExtractedTheme[];
  diagnostics: StorybookThemeDiagnostic[];
}): StorybookPublicThemesArtifact => {
  const sets: Record<string, { sources: Array<{ $ref: string }> }> = {};
  const contexts: Record<string, Array<{ $ref: string }>> = {};

  for (const theme of themes) {
    const setName = theme.id;
    sets[setName] = {
      sources: [{ $ref: `./${STORYBOOK_PUBLIC_TOKENS_FILE_NAME}#/${THEME_CONTEXT_PREFIX}/${theme.id}` }]
    };
    contexts[theme.context] = [{ $ref: `#/sets/${setName}` }];
  }

  const defaultThemeContext = themes.find((theme) => theme.context === "default")?.context ?? themes[0]?.context ?? "default";

  return {
    $schema: DTCG_RESOLVER_SCHEMA_URL,
    name: "storybook.themes",
    version: "2025.10",
    sets,
    modifiers: {
      theme: {
        default: defaultThemeContext,
        contexts
      }
    },
    resolutionOrder: [{ $ref: "#/modifiers/theme" }],
    $extensions: {
      [STORYBOOK_PUBLIC_EXTENSION_KEY]: {
        artifact: "storybook.themes",
        version: 2,
        stats: {
          themeCount: themes.length,
          contextCount: Object.keys(contexts).length,
          diagnosticCount: diagnostics.length,
          errorCount: diagnostics.filter((diagnostic) => diagnostic.severity === "error").length
        },
        diagnostics: toSanitizedDiagnostics(diagnostics),
        themes: toThemeSummaries(themes)
      }
    }
  };
};

export const getStorybookPublicArtifactFileNames = (): StorybookPublicArtifactFilePaths => {
  return {
    tokens: STORYBOOK_PUBLIC_TOKENS_FILE_NAME,
    themes: STORYBOOK_PUBLIC_THEMES_FILE_NAME,
    components: STORYBOOK_PUBLIC_COMPONENTS_FILE_NAME
  };
};

export const getDefaultStorybookPublicOutputDir = (): string => {
  return path.resolve(process.cwd(), "reference", "storybook");
};

export const buildStorybookPublicArtifacts = async ({
  buildDir
}: {
  buildDir: string;
}): Promise<StorybookPublicArtifacts> => {
  const evidenceArtifact = await buildStorybookEvidenceArtifact({ buildDir });
  const themeCatalog = await buildStorybookThemeCatalog({
    buildDir,
    evidenceItems: evidenceArtifact.evidence
  });

  return {
    tokensArtifact: buildTokensArtifact({
      tokens: themeCatalog.tokenGraph,
      themes: themeCatalog.themes,
      diagnostics: themeCatalog.diagnostics
    }),
    themesArtifact: buildThemesArtifact({
      themes: themeCatalog.themes,
      diagnostics: themeCatalog.diagnostics
    }),
    componentsArtifact: buildComponentsArtifact({
      entryCount: evidenceArtifact.stats.entryCount,
      evidenceItems: evidenceArtifact.evidence
    })
  };
};

export const writeStorybookPublicArtifacts = async ({
  artifacts,
  outputDirPath
}: {
  artifacts: StorybookPublicArtifacts;
  outputDirPath?: string;
}): Promise<{ outputDir: string; writtenFiles: StorybookPublicArtifactFilePaths }> => {
  const outputDir = outputDirPath ?? getDefaultStorybookPublicOutputDir();
  const fileNames = getStorybookPublicArtifactFileNames();
  const writtenFiles: StorybookPublicArtifactFilePaths = {
    tokens: path.join(outputDir, fileNames.tokens),
    themes: path.join(outputDir, fileNames.themes),
    components: path.join(outputDir, fileNames.components)
  };

  await mkdir(outputDir, { recursive: true });
  await writeFile(writtenFiles.tokens, toStableJsonString(artifacts.tokensArtifact as unknown as JsonValue), "utf8");
  await writeFile(writtenFiles.themes, toStableJsonString(artifacts.themesArtifact as unknown as JsonValue), "utf8");
  await writeFile(
    writtenFiles.components,
    toStableJsonString(artifacts.componentsArtifact as unknown as JsonValue),
    "utf8"
  );

  return {
    outputDir,
    writtenFiles
  };
};

export const generateStorybookPublicArtifacts = async ({
  buildDir,
  outputDirPath
}: {
  buildDir: string;
  outputDirPath?: string;
}): Promise<{
  artifacts: StorybookPublicArtifacts;
  outputDir: string;
  writtenFiles: StorybookPublicArtifactFilePaths;
}> => {
  const artifacts = await buildStorybookPublicArtifacts({ buildDir });
  const { outputDir, writtenFiles } = await writeStorybookPublicArtifacts({
    artifacts,
    ...(outputDirPath ? { outputDirPath } : {})
  });
  return {
    artifacts,
    outputDir,
    writtenFiles
  };
};
