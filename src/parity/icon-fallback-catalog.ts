import catalogData from "./data/icon-fallback-catalog.json" with { type: "json" };

export interface IconFallbackCatalogEntry {
  iconName: string;
  aliases?: string[];
}

export interface IconFallbackCatalog {
  version: 1;
  entries: IconFallbackCatalogEntry[];
  synonyms: Record<string, string>;
}

export const ICON_FALLBACK_MAP_VERSION = 1 as const;

export const BUILTIN_ICON_FALLBACK_CATALOG: IconFallbackCatalog = catalogData as IconFallbackCatalog;
