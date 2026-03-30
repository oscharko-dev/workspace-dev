import {
  extractTopLevelObjectKeys,
  extractTopLevelArrayStringLiterals,
  findArrayLiteralValuesByFieldName,
  findObjectLiteralValuesByFieldName,
  findStringLiteralValuesByFieldName,
  normalizeWhitespace,
  stripStringsAndComments,
  uniqueSorted
} from "./text.js";
import type { StorybookCssCustomPropertyDefinition } from "./types.js";

const DOCS_IMAGE_EXTENSIONS = /\.(?:png|jpg|jpeg|gif|webp|svg)(?:[?#].*)?$/iu;

const THEME_MARKER_PATTERNS: Array<{ marker: string; pattern: RegExp }> = [
  { marker: "createTheme", pattern: /\bcreateTheme\s*\(/u },
  { marker: "extendTheme", pattern: /\bextendTheme\s*\(/u },
  { marker: "ThemeProvider", pattern: /ThemeProvider\b/u },
  { marker: "CssVarsProvider", pattern: /\bCssVarsProvider\b/u },
  { marker: "McdThemeProvider", pattern: /\bMcdThemeProvider\b/u },
  { marker: "ThemeProviderWrapper", pattern: /ThemeProviderWrapper\b/u }
];

const looksLikeDocsImageSource = (value: string): boolean => {
  return value.startsWith("static/assets/images/") || DOCS_IMAGE_EXTENSIONS.test(value);
};

const looksLikeCodeSnippet = (value: string): boolean => {
  return (
    /(?:^|\s)(?:import|export|return|const|let|var|function)\s/iu.test(value) ||
    value.includes("=>") ||
    value.includes("</") ||
    /<[A-Za-z]/u.test(value) ||
    value.includes("{...") ||
    value.includes("};") ||
    value.includes("className=")
  );
};

const looksLikeDocsText = (value: string): boolean => {
  if (value.length === 0) {
    return false;
  }
  if (!/[\p{L}\p{N}]/u.test(value)) {
    return false;
  }
  if (value.startsWith("./") || value.endsWith(".js") || value.endsWith(".mdx") || value.endsWith(".tsx")) {
    return false;
  }
  if (value === "Module" || value === "link" || value.startsWith("__")) {
    return false;
  }
  return !looksLikeCodeSnippet(value);
};

export const collectTopLevelFieldKeys = ({
  bundleText,
  fieldName
}: {
  bundleText: string;
  fieldName: string;
}): string[] => {
  const keys = new Set<string>();
  for (const objectLiteral of findObjectLiteralValuesByFieldName({ source: bundleText, fieldName })) {
    for (const key of extractTopLevelObjectKeys(objectLiteral)) {
      keys.add(key);
    }
  }
  return [...keys].sort((left, right) => left.localeCompare(right));
};

export const extractStoryDesignUrls = (bundleText: string): string[] => {
  const urls = new Set<string>();
  for (const designObject of findObjectLiteralValuesByFieldName({ source: bundleText, fieldName: "design" })) {
    for (const url of findStringLiteralValuesByFieldName({ source: designObject, fieldName: "url" })) {
      const normalized = normalizeWhitespace(url);
      if (normalized.length > 0) {
        urls.add(normalized);
      }
    }
  }
  return [...urls].sort((left, right) => left.localeCompare(right));
};

export const extractMdxLinks = (bundleText: string): string[] => {
  return uniqueSorted(
    findStringLiteralValuesByFieldName({ source: bundleText, fieldName: "href" })
      .map((value) => normalizeWhitespace(value))
      .filter((value) => value.startsWith("/docs/") || value.startsWith("http://") || value.startsWith("https://"))
  );
};

export const extractMdxImageSources = (bundleText: string): string[] => {
  return uniqueSorted(
    findStringLiteralValuesByFieldName({ source: bundleText, fieldName: "src" })
      .map((value) => normalizeWhitespace(value))
      .filter((value) => looksLikeDocsImageSource(value))
  );
};

export const extractMdxTextBlocks = (bundleText: string): string[] => {
  const textBlocks: string[] = [];
  for (const literal of findStringLiteralValuesByFieldName({ source: bundleText, fieldName: "children" })) {
    const normalized = normalizeWhitespace(literal);
    if (looksLikeDocsText(normalized)) {
      textBlocks.push(normalized);
    }
  }

  for (const arrayLiteral of findArrayLiteralValuesByFieldName({ source: bundleText, fieldName: "children" })) {
    const normalized = normalizeWhitespace(extractTopLevelArrayStringLiterals(arrayLiteral).join(" "));
    if (looksLikeDocsText(normalized)) {
      textBlocks.push(normalized);
    }
  }

  return uniqueSorted(textBlocks);
};

export const extractThemeMarkers = (bundleText: string): string[] => {
  const strippedText = stripStringsAndComments(bundleText);
  return THEME_MARKER_PATTERNS.filter(({ pattern }) => pattern.test(strippedText))
    .map(({ marker }) => marker)
    .sort((left, right) => left.localeCompare(right));
};

export const extractCssCustomProperties = (cssText: string): string[] => {
  const propertyMatches = cssText.matchAll(/--([A-Za-z0-9_-]+)\s*:/gu);
  const properties = new Set<string>();
  for (const match of propertyMatches) {
    properties.add(`--${match[1]}`);
  }
  return [...properties].sort((left, right) => left.localeCompare(right));
};

export const extractCssCustomPropertyDefinitions = (cssText: string): StorybookCssCustomPropertyDefinition[] => {
  const definitionsByName = new Map<string, Set<string>>();
  const propertyMatches = cssText.matchAll(/(--[A-Za-z0-9_-]+)\s*:\s*([^;{}]+?)\s*;/gu);

  for (const match of propertyMatches) {
    const propertyName = normalizeWhitespace(match[1] ?? "");
    const propertyValue = normalizeWhitespace(match[2] ?? "");
    if (propertyName.length === 0 || propertyValue.length === 0) {
      continue;
    }

    const existingValues = definitionsByName.get(propertyName) ?? new Set<string>();
    existingValues.add(propertyValue);
    definitionsByName.set(propertyName, existingValues);
  }

  const definitions: StorybookCssCustomPropertyDefinition[] = [];
  for (const [name, values] of definitionsByName.entries()) {
    for (const value of uniqueSorted(values)) {
      definitions.push({ name, value });
    }
  }

  return definitions.sort((left, right) => {
    const byName = left.name.localeCompare(right.name);
    if (byName !== 0) {
      return byName;
    }
    return left.value.localeCompare(right.value);
  });
};
