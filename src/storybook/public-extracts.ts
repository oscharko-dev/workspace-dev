import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { extractCssCustomPropertyDefinitions } from "./bundle-analysis.js";
import { buildStorybookEvidenceArtifact } from "./evidence.js";
import { uniqueSorted } from "./text.js";
import type {
  StorybookEvidenceItem,
  StorybookPublicArtifactFilePaths,
  StorybookPublicArtifacts,
  StorybookPublicComponent,
  StorybookPublicComponentsArtifact,
  StorybookPublicTheme,
  StorybookPublicThemesArtifact,
  StorybookPublicToken,
  StorybookPublicTokenCategory,
  StorybookPublicTokensArtifact
} from "./types.js";

const STORYBOOK_PUBLIC_TOKENS_FILE_NAME = "tokens.json";
const STORYBOOK_PUBLIC_THEMES_FILE_NAME = "themes.json";
const STORYBOOK_PUBLIC_COMPONENTS_FILE_NAME = "components.json";

const STORYBOOK_PUBLIC_TOKEN_CATEGORIES: StorybookPublicTokenCategory[] = [
  "color",
  "spacing",
  "font",
  "size",
  "radius",
  "shadow",
  "motion",
  "zIndex",
  "other"
];

type JsonPrimitive = boolean | number | string | null;
type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

interface ThemeAccumulator {
  markers: string[];
  occurrenceCount: number;
  componentTitles: Set<string>;
}

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
    const stableRecord: Record<string, JsonValue> = {};
    for (const [key, nestedValue] of Object.entries(value).sort(([left], [right]) => left.localeCompare(right))) {
      stableRecord[key] = toStableJsonValue(nestedValue);
    }
    return stableRecord;
  }
  return value;
};

const toStableJsonString = (value: JsonValue): string => {
  return `${JSON.stringify(toStableJsonValue(value), null, 2)}\n`;
};

const buildStableId = (prefix: string, keyMaterial: unknown): string => {
  const hash = createHash("sha256").update(JSON.stringify(keyMaterial)).digest("hex").slice(0, 16);
  return `${prefix}:${hash}`;
};

const addValuesToSet = (target: Set<string>, values: Iterable<string>): void => {
  for (const value of values) {
    target.add(value);
  }
};

const getOrCreateSet = <T>(map: Map<string, Set<T>>, key: string): Set<T> => {
  const existing = map.get(key);
  if (existing) {
    return existing;
  }
  const created = new Set<T>();
  map.set(key, created);
  return created;
};

const stripFileExtension = (value: string): string => {
  return value.replace(/\.[^.\/]+$/u, "");
};

const slugify = (value: string): string => {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "");
  return slug.length > 0 ? slug : "item";
};

const deriveComponentName = ({
  title,
  componentPath
}: {
  title: string;
  componentPath?: string;
}): string => {
  if (componentPath) {
    return stripFileExtension(path.basename(componentPath));
  }
  const titleSegments = title.split("/").map((segment) => segment.trim()).filter((segment) => segment.length > 0);
  return titleSegments.at(-1) ?? title;
};

const looksLikeColorValue = (value: string): boolean => {
  return /^(?:#(?:[0-9a-f]{3,8})|(?:rgb|rgba|hsl|hsla|lab|lch|oklab|oklch)\()/iu.test(value);
};

const looksLikeFontValue = (value: string): boolean => {
  return /(?:["'][^"']+["']|serif|sans-serif|monospace|cursive|fantasy|system-ui)/iu.test(value);
};

const inferTokenCategory = ({
  name,
  values
}: {
  name: string;
  values: string[];
}): StorybookPublicTokenCategory => {
  const normalizedName = name.toLowerCase();
  const normalizedValues = values.map((value) => value.toLowerCase());

  if (normalizedName.includes("color") || normalizedValues.some((value) => looksLikeColorValue(value))) {
    return "color";
  }
  if (
    normalizedName.includes("font") ||
    normalizedName.includes("type") ||
    normalizedName.includes("family") ||
    normalizedValues.some((value) => looksLikeFontValue(value))
  ) {
    return "font";
  }
  if (
    normalizedName.includes("space") ||
    normalizedName.includes("spacing") ||
    normalizedName.includes("gap") ||
    normalizedName.includes("padding") ||
    normalizedName.includes("margin") ||
    normalizedName.includes("inset")
  ) {
    return "spacing";
  }
  if (normalizedName.includes("radius") || normalizedName.includes("rounded")) {
    return "radius";
  }
  if (normalizedName.includes("shadow") || normalizedName.includes("elevation")) {
    return "shadow";
  }
  if (
    normalizedName.includes("motion") ||
    normalizedName.includes("duration") ||
    normalizedName.includes("timing") ||
    normalizedName.includes("easing") ||
    normalizedName.includes("transition") ||
    normalizedName.includes("animation")
  ) {
    return "motion";
  }
  if (normalizedName.includes("z-index") || normalizedName.includes("zindex") || normalizedName.includes("layer")) {
    return "zIndex";
  }
  if (
    normalizedName.includes("size") ||
    normalizedName.includes("width") ||
    normalizedName.includes("height") ||
    normalizedName.includes("icon")
  ) {
    return "size";
  }
  return "other";
};

const compareTokens = (left: StorybookPublicToken, right: StorybookPublicToken): number => {
  return left.name.localeCompare(right.name);
};

const compareThemes = (left: StorybookPublicTheme, right: StorybookPublicTheme): number => {
  return left.id.localeCompare(right.id);
};

const compareComponents = (left: StorybookPublicComponent, right: StorybookPublicComponent): number => {
  const byTitle = left.title.localeCompare(right.title);
  if (byTitle !== 0) {
    return byTitle;
  }
  return left.name.localeCompare(right.name);
};

const buildTokensArtifact = async ({
  buildDir,
  entryCount,
  evidenceItems
}: {
  buildDir: string;
  entryCount: number;
  evidenceItems: StorybookEvidenceItem[];
}): Promise<StorybookPublicTokensArtifact> => {
  const stylesheetPaths = uniqueSorted(
    evidenceItems
      .filter((item) => item.type === "css")
      .map((item) => item.source.stylesheetPath)
      .filter((stylesheetPath): stylesheetPath is string => typeof stylesheetPath === "string")
  );

  const valuesByTokenName = new Map<string, Set<string>>();
  for (const stylesheetPath of stylesheetPaths) {
    const cssText = await readFile(path.join(buildDir, stylesheetPath), "utf8");
    for (const definition of extractCssCustomPropertyDefinitions(cssText)) {
      const existingValues = valuesByTokenName.get(definition.name) ?? new Set<string>();
      existingValues.add(definition.value);
      valuesByTokenName.set(definition.name, existingValues);
    }
  }

  const tokens = [...valuesByTokenName.entries()]
    .map(([name, valuesSet]) => {
      const values = uniqueSorted(valuesSet);
      return {
        id: buildStableId("token", { name, values }),
        name,
        category: inferTokenCategory({ name, values }),
        values
      } satisfies StorybookPublicToken;
    })
    .sort(compareTokens);

  const byCategory = Object.fromEntries(
    STORYBOOK_PUBLIC_TOKEN_CATEGORIES.map((category) => [category, 0])
  ) as Record<StorybookPublicTokenCategory, number>;

  for (const token of tokens) {
    byCategory[token.category] += 1;
  }

  return {
    artifact: "storybook.tokens",
    version: 1,
    stats: {
      entryCount,
      tokenCount: tokens.length,
      byCategory
    },
    tokens
  };
};

const buildThemesArtifact = ({
  entryCount,
  evidenceItems
}: {
  entryCount: number;
  evidenceItems: StorybookEvidenceItem[];
}): StorybookPublicThemesArtifact => {
  const componentTitlesByBundlePath = new Map<string, Set<string>>();
  for (const item of evidenceItems) {
    if (item.type !== "story_componentPath") {
      continue;
    }
    const bundlePath = item.source.bundlePath;
    const title = item.source.title;
    if (typeof bundlePath !== "string" || typeof title !== "string") {
      continue;
    }
    getOrCreateSet(componentTitlesByBundlePath, bundlePath).add(title);
  }

  const themesByMarkerKey = new Map<string, ThemeAccumulator>();
  for (const item of evidenceItems) {
    if (item.type !== "theme_bundle") {
      continue;
    }

    const markers = uniqueSorted(item.summary.themeMarkers ?? []);
    if (markers.length === 0) {
      continue;
    }

    const markerKey = markers.join("|");
    const existing = themesByMarkerKey.get(markerKey) ?? {
      markers,
      occurrenceCount: 0,
      componentTitles: new Set<string>()
    };
    existing.occurrenceCount += 1;

    const bundlePath = item.source.bundlePath;
    if (typeof bundlePath === "string") {
      addValuesToSet(existing.componentTitles, componentTitlesByBundlePath.get(bundlePath) ?? []);
    }

    themesByMarkerKey.set(markerKey, existing);
  }

  const themes = [...themesByMarkerKey.values()]
    .map((themeGroup) => {
      const componentTitles = uniqueSorted(themeGroup.componentTitles);
      return {
        id: buildStableId("theme", {
          markers: themeGroup.markers,
          componentTitles
        }),
        markers: themeGroup.markers,
        occurrenceCount: themeGroup.occurrenceCount,
        componentCount: componentTitles.length,
        componentTitles
      } satisfies StorybookPublicTheme;
    })
    .sort(compareThemes);

  const uniqueMarkers = new Set<string>();
  for (const theme of themes) {
    addValuesToSet(uniqueMarkers, theme.markers);
  }

  return {
    artifact: "storybook.themes",
    version: 1,
    stats: {
      entryCount,
      themeCount: themes.length,
      markerCount: uniqueMarkers.size,
      componentLinkedThemeCount: themes.filter((theme) => theme.componentCount > 0).length
    },
    themes
  };
};

const buildComponentsArtifact = ({
  entryCount,
  evidenceItems
}: {
  entryCount: number;
  evidenceItems: StorybookEvidenceItem[];
}): StorybookPublicComponentsArtifact => {
  const componentsByKey = new Map<string, ComponentAccumulator>();
  const componentKeysByImportPath = new Map<string, Set<string>>();

  for (const item of evidenceItems) {
    if (item.type !== "story_componentPath") {
      continue;
    }

    const title = item.source.title;
    const componentPath = item.summary.componentPath;
    if (typeof title !== "string" || typeof componentPath !== "string") {
      continue;
    }

    const componentKey = JSON.stringify({ title, componentPath });
    const existing = componentsByKey.get(componentKey) ?? {
      title,
      componentPath,
      storyIds: new Set<string>(),
      propKeys: new Set<string>(),
      hasDesignReference: false
    };

    if (typeof item.source.entryId === "string") {
      existing.storyIds.add(item.source.entryId);
    }

    const importPath = item.source.importPath;
    if (typeof importPath === "string") {
      getOrCreateSet(componentKeysByImportPath, importPath).add(componentKey);
    }

    componentsByKey.set(componentKey, existing);
  }

  for (const item of evidenceItems) {
    const importPath = item.source.importPath;
    if (typeof importPath !== "string") {
      continue;
    }

    const componentKeys = componentKeysByImportPath.get(importPath);
    if (!componentKeys || componentKeys.size === 0) {
      continue;
    }

    if (item.type === "story_argTypes" || item.type === "story_args") {
      const keys = item.summary.keys ?? [];
      for (const componentKey of componentKeys) {
        const component = componentsByKey.get(componentKey);
        if (!component) {
          continue;
        }
        addValuesToSet(component.propKeys, keys);
      }
    }

    if (item.type === "story_design_link") {
      for (const componentKey of componentKeys) {
        const component = componentsByKey.get(componentKey);
        if (component) {
          component.hasDesignReference = true;
        }
      }
    }
  }

  const uniquePropKeys = new Set<string>();
  const components = [...componentsByKey.values()]
    .map((component) => {
      const propKeys = uniqueSorted(component.propKeys);
      addValuesToSet(uniquePropKeys, propKeys);

      const name = deriveComponentName({
        title: component.title,
        ...(component.componentPath ? { componentPath: component.componentPath } : {})
      });

      return {
        id: buildStableId("component", {
          slug: slugify(component.title),
          componentPath: component.componentPath ?? "",
          propKeys
        }),
        name,
        title: component.title,
        ...(component.componentPath ? { componentPath: component.componentPath } : {}),
        propKeys,
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
      propKeyCount: uniquePropKeys.size
    },
    components
  };
};

export const buildStorybookPublicArtifacts = async ({
  buildDir
}: {
  buildDir: string;
}): Promise<StorybookPublicArtifacts> => {
  const evidenceArtifact = await buildStorybookEvidenceArtifact({ buildDir });
  const entryCount = evidenceArtifact.stats.entryCount;

  return {
    tokensArtifact: await buildTokensArtifact({
      buildDir,
      entryCount,
      evidenceItems: evidenceArtifact.evidence
    }),
    themesArtifact: buildThemesArtifact({
      entryCount,
      evidenceItems: evidenceArtifact.evidence
    }),
    componentsArtifact: buildComponentsArtifact({
      entryCount,
      evidenceItems: evidenceArtifact.evidence
    })
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
  return path.resolve(process.cwd(), "artifacts", "storybook");
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
  await writeFile(
    writtenFiles.tokens,
    toStableJsonString(artifacts.tokensArtifact as unknown as JsonValue),
    "utf8"
  );
  await writeFile(
    writtenFiles.themes,
    toStableJsonString(artifacts.themesArtifact as unknown as JsonValue),
    "utf8"
  );
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
