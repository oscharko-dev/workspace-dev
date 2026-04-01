import { readFile } from "node:fs/promises";
import type { WorkspaceBrandTheme } from "./contracts/index.js";
import type { DesignSystemConfig, DesignSystemMappingEntry } from "./design-system.js";
import type { ComponentMatchReportArtifact, ComponentMatchReportResolvedImport } from "./storybook/types.js";

const CUSTOMER_PROFILE_VERSION = 1 as const;
const JS_IDENTIFIER_PATTERN = /^[A-Za-z_$][\w$]*$/;
const PROFILE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;
const PACKAGE_NAME_PATTERN = /^(?:@[\w.-]+\/)?[\w.-]+(?:\/[\w.-]+)*$/;
const SOURCE_IMPORT_PATTERN = /import\s+([^;]+?)\s+from\s+["']([^"']+)["'];?/g;
const NAMED_IMPORT_CLAUSE_PATTERN = /\{([\s\S]*?)\}/;

export type CustomerProfileStrictness = "off" | "warn" | "error";
export type CustomerProfileMuiFallbackPolicy = "allow" | "deny";

export interface CustomerProfileParseIssue {
  path: string;
  message: string;
}

interface CustomerProfileFamilyAliases {
  figma: string[];
  storybook: string[];
  code: string[];
}

export interface CustomerProfileConfigSnapshot {
  version: typeof CUSTOMER_PROFILE_VERSION;
  families: Array<{
    id: string;
    tierPriority: number;
    aliases: CustomerProfileFamilyAliases;
  }>;
  brandMappings: Array<{
    id: string;
    aliases: string[];
    brandTheme: WorkspaceBrandTheme;
    storybookThemes: {
      light: string;
      dark?: string;
    };
  }>;
  imports: {
    components: Record<
      string,
      {
        family: string;
        package: string;
        export: string;
        importAlias: string;
        propMappings: Record<string, string>;
      }
    >;
  };
  fallbacks: {
    mui: {
      defaultPolicy: CustomerProfileMuiFallbackPolicy;
      components: Record<string, CustomerProfileMuiFallbackPolicy>;
    };
  };
  template: {
    dependencies: Record<string, string>;
    devDependencies: Record<string, string>;
    importAliases: Record<string, string>;
  };
  strictness: {
    match: CustomerProfileStrictness;
    token: CustomerProfileStrictness;
    import: CustomerProfileStrictness;
  };
}

export interface ResolvedCustomerProfileFamily {
  id: string;
  tierPriority: number;
  aliases: CustomerProfileFamilyAliases;
}

export interface ResolvedCustomerProfileBrandMapping {
  id: string;
  aliases: string[];
  brandTheme: WorkspaceBrandTheme;
  storybookThemes: {
    light: string;
    dark?: string;
  };
}

export interface ResolvedCustomerProfileComponentImport {
  componentKey: string;
  family: string;
  package: string;
  exportName: string;
  localName: string;
  propMappings: Record<string, string>;
}

export interface ResolvedCustomerProfileTemplate {
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
  importAliases: Record<string, string>;
}

export interface ResolvedCustomerProfileStrictness {
  match: CustomerProfileStrictness;
  token: CustomerProfileStrictness;
  import: CustomerProfileStrictness;
}

export interface ResolvedCustomerProfile {
  version: typeof CUSTOMER_PROFILE_VERSION;
  families: readonly ResolvedCustomerProfileFamily[];
  brandMappings: readonly ResolvedCustomerProfileBrandMapping[];
  imports: {
    readonly components: Readonly<Record<string, ResolvedCustomerProfileComponentImport>>;
  };
  fallbacks: {
    readonly mui: {
      readonly defaultPolicy: CustomerProfileMuiFallbackPolicy;
      readonly components: Readonly<Record<string, CustomerProfileMuiFallbackPolicy>>;
    };
  };
  template: Readonly<ResolvedCustomerProfileTemplate>;
  strictness: Readonly<ResolvedCustomerProfileStrictness>;
  familyById: ReadonlyMap<string, ResolvedCustomerProfileFamily>;
  familyByAlias: ReadonlyMap<string, ResolvedCustomerProfileFamily>;
  brandByAlias: ReadonlyMap<string, ResolvedCustomerProfileBrandMapping>;
  componentImportsByKey: ReadonlyMap<string, ResolvedCustomerProfileComponentImport>;
  allowedExportsByPackage: ReadonlyMap<string, ReadonlySet<string>>;
}

export type CustomerProfileParseResult =
  | {
      success: true;
      config: ResolvedCustomerProfile;
      issues: [];
    }
  | {
      success: false;
      issues: CustomerProfileParseIssue[];
    };

export interface CustomerProfileImportIssue {
  code: "E_CUSTOMER_PROFILE_MUI_FALLBACK" | "E_CUSTOMER_PROFILE_IMPORT_EXPORT";
  filePath: string;
  modulePath: string;
  message: string;
}

export interface ComponentMatchReportDesignSystemConfigResult {
  config?: DesignSystemConfig;
  warnings: string[];
}

interface ParsedSourceImport {
  modulePath: string;
  namedSpecifiers: Array<{
    imported: string;
    local: string;
  }>;
}

const isPlainRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null && !Array.isArray(value);
};

const isValidIdentifier = (value: string): boolean => {
  return JS_IDENTIFIER_PATTERN.test(value);
};

const isValidProfileId = (value: string): boolean => {
  return PROFILE_ID_PATTERN.test(value);
};

const isValidPackageName = (value: string): boolean => {
  return PACKAGE_NAME_PATTERN.test(value);
};

const normalizeAlias = (value: string): string => {
  return value.trim().toLowerCase();
};

const normalizeComponentKey = (value: string): string => {
  return value.trim();
};

const toSortedRecord = <T>(input: Record<string, T>): Record<string, T> => {
  return Object.fromEntries(
    Object.entries(input).sort((left, right) => left[0].localeCompare(right[0]))
  );
};

const toSortedPropMappings = (propMappings: Record<string, string>): Record<string, string> | undefined => {
  const entries = Object.entries(propMappings).sort((left, right) => left[0].localeCompare(right[0]));
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
};

const toResolvedImportSignature = ({ resolvedImport }: { resolvedImport: ComponentMatchReportResolvedImport }): string => {
  return JSON.stringify({
    package: resolvedImport.package,
    exportName: resolvedImport.exportName,
    localName: resolvedImport.localName,
    ...(resolvedImport.propMappings ? { propMappings: toSortedRecord(resolvedImport.propMappings) } : {})
  });
};

const pushIssue = ({
  issues,
  path,
  message
}: {
  issues: CustomerProfileParseIssue[];
  path: string;
  message: string;
}): void => {
  issues.push({ path, message });
};

const normalizeStringArray = ({
  input,
  path,
  issues
}: {
  input: unknown;
  path: string;
  issues: CustomerProfileParseIssue[];
}): string[] => {
  if (!Array.isArray(input)) {
    pushIssue({
      issues,
      path,
      message: "Expected an array of strings."
    });
    return [];
  }

  const aliases = [...new Set(
    input
      .map((entry) => (typeof entry === "string" ? normalizeAlias(entry) : ""))
      .filter((entry) => entry.length > 0)
  )].sort((left, right) => left.localeCompare(right));

  if (aliases.length !== input.filter((entry) => typeof entry === "string" && normalizeAlias(entry).length > 0).length) {
    const invalidEntryPresent = input.some((entry) => typeof entry !== "string" || normalizeAlias(entry).length === 0);
    if (invalidEntryPresent) {
      pushIssue({
        issues,
        path,
        message: "Aliases must be non-empty strings."
      });
    }
  }

  return aliases;
};

const normalizeStringRecord = ({
  input,
  path,
  issues,
  validateKey,
  validateValue
}: {
  input: unknown;
  path: string;
  issues: CustomerProfileParseIssue[];
  validateKey: (value: string) => boolean;
  validateValue: (value: string) => boolean;
}): Record<string, string> => {
  if (!isPlainRecord(input)) {
    pushIssue({
      issues,
      path,
      message: "Expected an object with string values."
    });
    return {};
  }

  const normalized: Record<string, string> = {};
  for (const [rawKey, rawValue] of Object.entries(input)) {
    const key = rawKey.trim();
    const value = typeof rawValue === "string" ? rawValue.trim() : "";
    if (!validateKey(key)) {
      pushIssue({
        issues,
        path: `${path}.${rawKey}`,
        message: "Key must be a valid identifier."
      });
      continue;
    }
    if (!validateValue(value)) {
      pushIssue({
        issues,
        path: `${path}.${rawKey}`,
        message: "Value must be a non-empty valid identifier."
      });
      continue;
    }
    normalized[key] = value;
  }

  return toSortedRecord(normalized);
};

const normalizeDependencyRecord = ({
  input,
  path,
  issues
}: {
  input: unknown;
  path: string;
  issues: CustomerProfileParseIssue[];
}): Record<string, string> => {
  if (input === undefined) {
    return {};
  }
  if (!isPlainRecord(input)) {
    pushIssue({
      issues,
      path,
      message: "Expected an object with dependency versions."
    });
    return {};
  }

  const normalized: Record<string, string> = {};
  for (const [rawName, rawVersion] of Object.entries(input)) {
    const name = rawName.trim();
    const version = typeof rawVersion === "string" ? rawVersion.trim() : "";
    if (!isValidPackageName(name)) {
      pushIssue({
        issues,
        path: `${path}.${rawName}`,
        message: "Dependency name must be a valid package name."
      });
      continue;
    }
    if (!version) {
      pushIssue({
        issues,
        path: `${path}.${rawName}`,
        message: "Dependency version must be a non-empty string."
      });
      continue;
    }
    normalized[name] = version;
  }

  return toSortedRecord(normalized);
};

const normalizeImportAliasRecord = ({
  input,
  path,
  issues
}: {
  input: unknown;
  path: string;
  issues: CustomerProfileParseIssue[];
}): Record<string, string> => {
  if (input === undefined) {
    return {};
  }
  if (!isPlainRecord(input)) {
    pushIssue({
      issues,
      path,
      message: "Expected an object mapping alias keys to package targets."
    });
    return {};
  }

  const normalized: Record<string, string> = {};
  for (const [rawAlias, rawTarget] of Object.entries(input)) {
    const alias = rawAlias.trim();
    const target = typeof rawTarget === "string" ? rawTarget.trim() : "";
    if (!isValidPackageName(alias)) {
      pushIssue({
        issues,
        path: `${path}.${rawAlias}`,
        message: "Import alias key must be a valid package name."
      });
      continue;
    }
    if (!target || !isValidPackageName(target)) {
      pushIssue({
        issues,
        path: `${path}.${rawAlias}`,
        message: "Import alias target must be a valid non-empty package name."
      });
      continue;
    }
    normalized[alias] = target;
  }

  return toSortedRecord(normalized);
};

const parseStrictnessValue = ({
  input,
  path,
  issues
}: {
  input: unknown;
  path: string;
  issues: CustomerProfileParseIssue[];
}): CustomerProfileStrictness => {
  if (typeof input !== "string") {
    pushIssue({
      issues,
      path,
      message: "Strictness must be one of: off, warn, error."
    });
    return "warn";
  }
  const normalized = input.trim().toLowerCase();
  if (normalized === "off" || normalized === "warn" || normalized === "error") {
    return normalized;
  }
  pushIssue({
    issues,
    path,
    message: "Strictness must be one of: off, warn, error."
  });
  return "warn";
};

const parseMuiFallbackPolicy = ({
  input,
  path,
  issues
}: {
  input: unknown;
  path: string;
  issues: CustomerProfileParseIssue[];
}): CustomerProfileMuiFallbackPolicy => {
  if (typeof input !== "string") {
    pushIssue({
      issues,
      path,
      message: "Fallback policy must be one of: allow, deny."
    });
    return "allow";
  }
  const normalized = input.trim().toLowerCase();
  if (normalized === "allow" || normalized === "deny") {
    return normalized;
  }
  pushIssue({
    issues,
    path,
    message: "Fallback policy must be one of: allow, deny."
  });
  return "allow";
};

const parseNamedImportSpecifiers = (clause: string): Array<{ imported: string; local: string }> => {
  const match = clause.match(NAMED_IMPORT_CLAUSE_PATTERN);
  if (!match) {
    return [];
  }

  return (match[1] ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .map((entry) => entry.replace(/^type\s+/, "").trim())
    .map((entry) => {
      const aliasParts = entry.split(/\s+as\s+/i).map((part) => part.trim());
      if (aliasParts.length === 2 && isValidIdentifier(aliasParts[0] ?? "") && isValidIdentifier(aliasParts[1] ?? "")) {
        return {
          imported: aliasParts[0]!,
          local: aliasParts[1]!
        };
      }
      if (isValidIdentifier(entry)) {
        return {
          imported: entry,
          local: entry
        };
      }
      return undefined;
    })
    .filter((entry): entry is { imported: string; local: string } => entry !== undefined);
};

const collectSourceImports = ({ content }: { content: string }): ParsedSourceImport[] => {
  const imports: ParsedSourceImport[] = [];
  for (const match of content.matchAll(SOURCE_IMPORT_PATTERN)) {
    const clause = match[1]?.trim();
    const modulePath = match[2]?.trim();
    if (!clause || !modulePath) {
      continue;
    }
    imports.push({
      modulePath,
      namedSpecifiers: parseNamedImportSpecifiers(clause)
    });
  }
  return imports;
};

export const safeParseCustomerProfileConfig = ({ input }: { input: unknown }): CustomerProfileParseResult => {
  const issues: CustomerProfileParseIssue[] = [];
  if (!isPlainRecord(input)) {
    return {
      success: false,
      issues: [
        {
          path: "(root)",
          message: "Expected a customer profile object."
        }
      ]
    };
  }

  const version = input.version;
  if (version !== CUSTOMER_PROFILE_VERSION) {
    pushIssue({
      issues,
      path: "version",
      message: "version must be 1."
    });
  }

  const rawFamilies = input.families;
  const families: ResolvedCustomerProfileFamily[] = [];
  const familyIdSet = new Set<string>();
  if (!Array.isArray(rawFamilies)) {
    pushIssue({
      issues,
      path: "families",
      message: "families must be an array."
    });
  } else {
    for (const [index, rawFamily] of rawFamilies.entries()) {
      const pathPrefix = `families[${index}]`;
      if (!isPlainRecord(rawFamily)) {
        pushIssue({
          issues,
          path: pathPrefix,
          message: "Family entry must be an object."
        });
        continue;
      }

      const id = typeof rawFamily.id === "string" ? rawFamily.id.trim() : "";
      if (!isValidProfileId(id)) {
        pushIssue({
          issues,
          path: `${pathPrefix}.id`,
          message: "Family id must match /^[A-Za-z0-9][A-Za-z0-9_-]*$/."
        });
      } else if (familyIdSet.has(id)) {
        pushIssue({
          issues,
          path: `${pathPrefix}.id`,
          message: `Duplicate family id '${id}'.`
        });
      } else {
        familyIdSet.add(id);
      }

      const tierPriority =
        typeof rawFamily.tierPriority === "number" && Number.isFinite(rawFamily.tierPriority)
          ? Math.trunc(rawFamily.tierPriority)
          : Number.NaN;
      if (!Number.isFinite(tierPriority)) {
        pushIssue({
          issues,
          path: `${pathPrefix}.tierPriority`,
          message: "tierPriority must be a finite integer."
        });
      }

      const aliases = isPlainRecord(rawFamily.aliases) ? rawFamily.aliases : undefined;
      if (!aliases) {
        pushIssue({
          issues,
          path: `${pathPrefix}.aliases`,
          message: "aliases must be an object."
        });
      }

      families.push({
        id,
        tierPriority: Number.isFinite(tierPriority) ? tierPriority : 0,
        aliases: {
          figma: normalizeStringArray({
            input: aliases?.figma ?? [],
            path: `${pathPrefix}.aliases.figma`,
            issues
          }),
          storybook: normalizeStringArray({
            input: aliases?.storybook ?? [],
            path: `${pathPrefix}.aliases.storybook`,
            issues
          }),
          code: normalizeStringArray({
            input: aliases?.code ?? [],
            path: `${pathPrefix}.aliases.code`,
            issues
          })
        }
      });
    }
  }

  const rawBrandMappings = input.brandMappings;
  const brandMappings: ResolvedCustomerProfileBrandMapping[] = [];
  const brandIdSet = new Set<string>();
  if (!Array.isArray(rawBrandMappings)) {
    pushIssue({
      issues,
      path: "brandMappings",
      message: "brandMappings must be an array."
    });
  } else {
    for (const [index, rawBrand] of rawBrandMappings.entries()) {
      const pathPrefix = `brandMappings[${index}]`;
      if (!isPlainRecord(rawBrand)) {
        pushIssue({
          issues,
          path: pathPrefix,
          message: "Brand mapping entry must be an object."
        });
        continue;
      }

      const id = typeof rawBrand.id === "string" ? rawBrand.id.trim() : "";
      if (!isValidProfileId(id)) {
        pushIssue({
          issues,
          path: `${pathPrefix}.id`,
          message: "Brand mapping id must match /^[A-Za-z0-9][A-Za-z0-9_-]*$/."
        });
      } else if (brandIdSet.has(id)) {
        pushIssue({
          issues,
          path: `${pathPrefix}.id`,
          message: `Duplicate brand mapping id '${id}'.`
        });
      } else {
        brandIdSet.add(id);
      }

      const brandTheme = typeof rawBrand.brandTheme === "string" ? rawBrand.brandTheme.trim().toLowerCase() : "";
      if (brandTheme !== "derived" && brandTheme !== "sparkasse") {
        pushIssue({
          issues,
          path: `${pathPrefix}.brandTheme`,
          message: "brandTheme must be one of: derived, sparkasse."
        });
      }

      const rawStorybookThemes = isPlainRecord(rawBrand.storybookThemes) ? rawBrand.storybookThemes : undefined;
      if (!rawStorybookThemes) {
        pushIssue({
          issues,
          path: `${pathPrefix}.storybookThemes`,
          message: "storybookThemes must be an object."
        });
      }
      const lightThemeId =
        rawStorybookThemes && typeof rawStorybookThemes.light === "string" ? rawStorybookThemes.light.trim() : "";
      if (!lightThemeId) {
        pushIssue({
          issues,
          path: `${pathPrefix}.storybookThemes.light`,
          message: "storybookThemes.light must be a non-empty string."
        });
      }
      const darkThemeId =
        rawStorybookThemes && typeof rawStorybookThemes.dark === "string" ? rawStorybookThemes.dark.trim() : undefined;
      if (rawStorybookThemes && rawStorybookThemes.dark !== undefined && !darkThemeId) {
        pushIssue({
          issues,
          path: `${pathPrefix}.storybookThemes.dark`,
          message: "storybookThemes.dark must be a non-empty string when provided."
        });
      }

      brandMappings.push({
        id,
        aliases: normalizeStringArray({
          input: rawBrand.aliases ?? [],
          path: `${pathPrefix}.aliases`,
          issues
        }),
        brandTheme: brandTheme === "sparkasse" ? "sparkasse" : "derived",
        storybookThemes: {
          light: lightThemeId,
          ...(darkThemeId ? { dark: darkThemeId } : {})
        }
      });
    }
  }

  const familyById = new Map<string, ResolvedCustomerProfileFamily>();
  for (const family of families) {
    if (family.id) {
      familyById.set(family.id, family);
    }
  }

  const aliasOwners = new Map<string, string>();
  for (const family of families) {
    for (const source of ["figma", "storybook", "code"] as const) {
      for (const alias of family.aliases[source]) {
        const owner = aliasOwners.get(alias);
        if (owner && owner !== family.id) {
          pushIssue({
            issues,
            path: `families.${family.id}.aliases.${source}`,
            message: `Alias '${alias}' is already assigned to '${owner}'.`
          });
          continue;
        }
        aliasOwners.set(alias, family.id);
      }
    }
  }

  for (const brandMapping of brandMappings) {
    for (const alias of brandMapping.aliases) {
      const owner = aliasOwners.get(alias);
      if (owner && owner !== brandMapping.id) {
        pushIssue({
          issues,
          path: `brandMappings.${brandMapping.id}.aliases`,
          message: `Alias '${alias}' is already assigned to '${owner}'.`
        });
        continue;
      }
      aliasOwners.set(alias, brandMapping.id);
    }
  }

  const rawImports = isPlainRecord(input.imports) ? input.imports : undefined;
  if (!rawImports) {
    pushIssue({
      issues,
      path: "imports",
      message: "imports must be an object."
    });
  }
  const rawImportComponentsInput = rawImports === undefined ? undefined : rawImports.components;
  const rawImportComponents = isPlainRecord(rawImportComponentsInput) ? rawImportComponentsInput : undefined;
  if (!rawImportComponents) {
    pushIssue({
      issues,
      path: "imports.components",
      message: "imports.components must be an object."
    });
  }

  const resolvedComponentImports: Record<string, ResolvedCustomerProfileComponentImport> = {};
  const bindingOwners = new Map<string, string>();
  if (rawImportComponents) {
    for (const [rawComponentKey, rawImportEntry] of Object.entries(rawImportComponents)) {
      const componentKey = rawComponentKey.trim();
      const pathPrefix = `imports.components.${rawComponentKey}`;
      if (!isValidIdentifier(componentKey)) {
        pushIssue({
          issues,
          path: pathPrefix,
          message: "Component key must be a valid identifier."
        });
        continue;
      }
      if (!isPlainRecord(rawImportEntry)) {
        pushIssue({
          issues,
          path: pathPrefix,
          message: "Component import entry must be an object."
        });
        continue;
      }

      const family = typeof rawImportEntry.family === "string" ? rawImportEntry.family.trim() : "";
      if (!familyById.has(family)) {
        pushIssue({
          issues,
          path: `${pathPrefix}.family`,
          message: `Unknown family '${family}'.`
        });
      }

      const packageName = typeof rawImportEntry.package === "string" ? rawImportEntry.package.trim() : "";
      if (!isValidPackageName(packageName)) {
        pushIssue({
          issues,
          path: `${pathPrefix}.package`,
          message: "package must be a valid package name."
        });
      }

      const exportName = typeof rawImportEntry.export === "string" ? rawImportEntry.export.trim() : "";
      if (!isValidIdentifier(exportName)) {
        pushIssue({
          issues,
          path: `${pathPrefix}.export`,
          message: "export must be a valid identifier."
        });
      }

      const importAlias =
        typeof rawImportEntry.importAlias === "string" && rawImportEntry.importAlias.trim().length > 0
          ? rawImportEntry.importAlias.trim()
          : exportName;
      if (!isValidIdentifier(importAlias)) {
        pushIssue({
          issues,
          path: `${pathPrefix}.importAlias`,
          message: "importAlias must be a valid identifier."
        });
      }

      const propMappings = normalizeStringRecord({
        input: rawImportEntry.propMappings ?? {},
        path: `${pathPrefix}.propMappings`,
        issues,
        validateKey: isValidIdentifier,
        validateValue: isValidIdentifier
      });

      const bindingKey = `${packageName}::${exportName}`;
      const bindingOwner = bindingOwners.get(bindingKey);
      if (bindingOwner && bindingOwner !== componentKey) {
        pushIssue({
          issues,
          path: pathPrefix,
          message: `Import binding '${bindingKey}' is already assigned to '${bindingOwner}'.`
        });
      } else if (packageName && exportName) {
        bindingOwners.set(bindingKey, componentKey);
      }

      resolvedComponentImports[componentKey] = {
        componentKey,
        family,
        package: packageName,
        exportName,
        localName: importAlias,
        propMappings
      };
    }
  }

  const rawFallbacks = isPlainRecord(input.fallbacks) ? input.fallbacks : undefined;
  if (!rawFallbacks) {
    pushIssue({
      issues,
      path: "fallbacks",
      message: "fallbacks must be an object."
    });
  }
  const rawMuiFallbacksInput = rawFallbacks === undefined ? undefined : rawFallbacks.mui;
  const rawMuiFallbacks = isPlainRecord(rawMuiFallbacksInput) ? rawMuiFallbacksInput : undefined;
  if (!rawMuiFallbacks) {
    pushIssue({
      issues,
      path: "fallbacks.mui",
      message: "fallbacks.mui must be an object."
    });
  }

  const defaultPolicy = parseMuiFallbackPolicy({
    input: rawMuiFallbacks?.defaultPolicy,
    path: "fallbacks.mui.defaultPolicy",
    issues
  });

  const muiComponentPolicies: Record<string, CustomerProfileMuiFallbackPolicy> = {};
  if (rawMuiFallbacks?.components !== undefined) {
    if (!isPlainRecord(rawMuiFallbacks.components)) {
      pushIssue({
        issues,
        path: "fallbacks.mui.components",
        message: "fallbacks.mui.components must be an object."
      });
    } else {
      for (const [rawComponentKey, rawPolicy] of Object.entries(rawMuiFallbacks.components)) {
        const componentKey = rawComponentKey.trim();
        if (!isValidIdentifier(componentKey)) {
          pushIssue({
            issues,
            path: `fallbacks.mui.components.${rawComponentKey}`,
            message: "Fallback component key must be a valid identifier."
          });
          continue;
        }
        muiComponentPolicies[componentKey] = parseMuiFallbackPolicy({
          input: rawPolicy,
          path: `fallbacks.mui.components.${rawComponentKey}`,
          issues
        });
      }
    }
  }

  const rawTemplate = isPlainRecord(input.template) ? input.template : undefined;
  if (!rawTemplate) {
    pushIssue({
      issues,
      path: "template",
      message: "template must be an object."
    });
  }

  const template: ResolvedCustomerProfileTemplate = {
    dependencies: normalizeDependencyRecord({
      input: rawTemplate?.dependencies ?? {},
      path: "template.dependencies",
      issues
    }),
    devDependencies: normalizeDependencyRecord({
      input: rawTemplate?.devDependencies,
      path: "template.devDependencies",
      issues
    }),
    importAliases: normalizeImportAliasRecord({
      input: rawTemplate?.importAliases,
      path: "template.importAliases",
      issues
    })
  };

  const rawStrictness = isPlainRecord(input.strictness) ? input.strictness : undefined;
  if (!rawStrictness) {
    pushIssue({
      issues,
      path: "strictness",
      message: "strictness must be an object."
    });
  }

  const strictness: ResolvedCustomerProfileStrictness = {
    match: parseStrictnessValue({
      input: rawStrictness?.match,
      path: "strictness.match",
      issues
    }),
    token: parseStrictnessValue({
      input: rawStrictness?.token,
      path: "strictness.token",
      issues
    }),
    import: parseStrictnessValue({
      input: rawStrictness?.import,
      path: "strictness.import",
      issues
    })
  };

  if (issues.length > 0) {
    return {
      success: false,
      issues
    };
  }

  const sortedFamilies = [...families].sort((left, right) => {
    if (left.tierPriority !== right.tierPriority) {
      return left.tierPriority - right.tierPriority;
    }
    return left.id.localeCompare(right.id);
  });
  const sortedBrandMappings = [...brandMappings].sort((left, right) => left.id.localeCompare(right.id));
  const sortedComponentImports = toSortedRecord(resolvedComponentImports);
  const sortedMuiComponentPolicies = toSortedRecord(muiComponentPolicies);

  const resolvedFamilyById = new Map<string, ResolvedCustomerProfileFamily>();
  const resolvedFamilyByAlias = new Map<string, ResolvedCustomerProfileFamily>();
  for (const family of sortedFamilies) {
    resolvedFamilyById.set(family.id, family);
    for (const source of ["figma", "storybook", "code"] as const) {
      for (const alias of family.aliases[source]) {
        resolvedFamilyByAlias.set(alias, family);
      }
    }
  }

  const resolvedBrandByAlias = new Map<string, ResolvedCustomerProfileBrandMapping>();
  for (const brandMapping of sortedBrandMappings) {
    for (const alias of brandMapping.aliases) {
      resolvedBrandByAlias.set(alias, brandMapping);
    }
  }

  const componentImportsByKey = new Map<string, ResolvedCustomerProfileComponentImport>();
  const allowedExportsByPackage = new Map<string, Set<string>>();
  for (const [componentKey, importEntry] of Object.entries(sortedComponentImports)) {
    componentImportsByKey.set(componentKey, importEntry);
    const existingExports = allowedExportsByPackage.get(importEntry.package) ?? new Set<string>();
    existingExports.add(importEntry.exportName);
    allowedExportsByPackage.set(importEntry.package, existingExports);
  }

  return {
    success: true,
    config: {
      version: CUSTOMER_PROFILE_VERSION,
      families: sortedFamilies,
      brandMappings: sortedBrandMappings,
      imports: {
        components: sortedComponentImports
      },
      fallbacks: {
        mui: {
          defaultPolicy,
          components: sortedMuiComponentPolicies
        }
      },
      template,
      strictness,
      familyById: resolvedFamilyById,
      familyByAlias: resolvedFamilyByAlias,
      brandByAlias: resolvedBrandByAlias,
      componentImportsByKey,
      allowedExportsByPackage
    },
    issues: []
  };
};

export const parseCustomerProfileConfig = ({ input }: { input: unknown }): ResolvedCustomerProfile | undefined => {
  const result = safeParseCustomerProfileConfig({ input });
  return result.success ? result.config : undefined;
};

export const loadCustomerProfileConfigFile = async ({
  customerProfileFilePath,
  onLog
}: {
  customerProfileFilePath: string;
  onLog: (message: string) => void;
}): Promise<ResolvedCustomerProfile | undefined> => {
  try {
    const raw = await readFile(customerProfileFilePath, "utf8");
    const parsedJson: unknown = JSON.parse(raw);
    const parsed = safeParseCustomerProfileConfig({ input: parsedJson });
    if (!parsed.success) {
      const firstIssue = parsed.issues[0];
      onLog(
        `Customer profile config at '${customerProfileFilePath}' is invalid` +
          `${firstIssue ? ` (${firstIssue.path}: ${firstIssue.message})` : ""}; using generic defaults.`
      );
      return undefined;
    }
    return parsed.config;
  } catch (error) {
    const typedError = error as NodeJS.ErrnoException;
    if (typedError.code === "ENOENT") {
      return undefined;
    }
    const message = error instanceof Error ? error.message : String(error);
    onLog(`Failed to load customer profile config at '${customerProfileFilePath}': ${message}; using generic defaults.`);
    return undefined;
  }
};

export const toCustomerProfileConfigSnapshot = ({
  profile
}: {
  profile: ResolvedCustomerProfile;
}): CustomerProfileConfigSnapshot => {
  return {
    version: profile.version,
    families: profile.families.map((family) => ({
      id: family.id,
      tierPriority: family.tierPriority,
      aliases: {
        figma: [...family.aliases.figma],
        storybook: [...family.aliases.storybook],
        code: [...family.aliases.code]
      }
    })),
    brandMappings: profile.brandMappings.map((brandMapping) => ({
      id: brandMapping.id,
      aliases: [...brandMapping.aliases],
      brandTheme: brandMapping.brandTheme,
      storybookThemes: {
        light: brandMapping.storybookThemes.light,
        ...(brandMapping.storybookThemes.dark ? { dark: brandMapping.storybookThemes.dark } : {})
      }
    })),
    imports: {
      components: Object.fromEntries(
        Object.entries(profile.imports.components).map(([componentKey, componentImport]) => [
          componentKey,
          {
            family: componentImport.family,
            package: componentImport.package,
            export: componentImport.exportName,
            importAlias: componentImport.localName,
            propMappings: { ...componentImport.propMappings }
          }
        ])
      )
    },
    fallbacks: {
      mui: {
        defaultPolicy: profile.fallbacks.mui.defaultPolicy,
        components: { ...profile.fallbacks.mui.components }
      }
    },
    template: {
      dependencies: { ...profile.template.dependencies },
      devDependencies: { ...profile.template.devDependencies },
      importAliases: { ...profile.template.importAliases }
    },
    strictness: {
      match: profile.strictness.match,
      token: profile.strictness.token,
      import: profile.strictness.import
    }
  };
};

export const resolveCustomerProfileFamily = ({
  profile,
  candidate
}: {
  profile: ResolvedCustomerProfile;
  candidate: string;
}): ResolvedCustomerProfileFamily | undefined => {
  return profile.familyByAlias.get(normalizeAlias(candidate));
};

export const getCustomerProfileFamiliesByPriority = ({
  profile
}: {
  profile: ResolvedCustomerProfile;
}): readonly ResolvedCustomerProfileFamily[] => {
  return profile.families;
};

export const resolveCustomerProfileBrandMapping = ({
  profile,
  candidate
}: {
  profile: ResolvedCustomerProfile;
  candidate: string;
}): ResolvedCustomerProfileBrandMapping | undefined => {
  return profile.brandByAlias.get(normalizeAlias(candidate));
};

export const resolveCustomerProfileComponentImport = ({
  profile,
  componentKey,
  familyId
}: {
  profile: ResolvedCustomerProfile;
  componentKey: string;
  familyId?: string;
}): ResolvedCustomerProfileComponentImport | undefined => {
  const resolvedImport = profile.componentImportsByKey.get(normalizeComponentKey(componentKey));
  if (!resolvedImport) {
    return undefined;
  }
  if (familyId && resolvedImport.family !== familyId.trim()) {
    return undefined;
  }
  return resolvedImport;
};

export const isCustomerProfileMuiFallbackAllowed = ({
  profile,
  componentKey
}: {
  profile: ResolvedCustomerProfile;
  componentKey: string;
}): boolean => {
  const explicitPolicy = profile.fallbacks.mui.components[normalizeComponentKey(componentKey)];
  if (explicitPolicy !== undefined) {
    return explicitPolicy === "allow";
  }
  return profile.fallbacks.mui.defaultPolicy === "allow";
};

export const toCustomerProfileDesignSystemConfig = ({
  profile
}: {
  profile: ResolvedCustomerProfile;
}): DesignSystemConfig | undefined => {
  if (Object.keys(profile.imports.components).length === 0) {
    return undefined;
  }

  return {
    library: "__customer_profile__",
    mappings: Object.fromEntries(
      Object.entries(profile.imports.components).map(([componentKey, importEntry]) => [
        componentKey,
        {
          import: importEntry.package,
          export: importEntry.exportName,
          component: importEntry.localName,
          ...(Object.keys(importEntry.propMappings).length > 0 ? { propMappings: importEntry.propMappings } : {})
        }
      ])
    )
  };
};

export const toCustomerProfileDesignSystemConfigFromComponentMatchReport = ({
  artifact
}: {
  artifact: ComponentMatchReportArtifact;
}): ComponentMatchReportDesignSystemConfigResult => {
  const mappingCandidates = new Map<
    string,
    {
      resolvedImport: ComponentMatchReportResolvedImport;
      signature: string;
    }
  >();
  const conflictedComponentKeys = new Set<string>();
  const warnings: string[] = [];

  for (const entry of artifact.entries) {
    if (entry.libraryResolution.status !== "resolved_import") {
      continue;
    }
    const componentKey = entry.libraryResolution.componentKey?.trim();
    const resolvedImport = entry.libraryResolution.import;
    if (!componentKey || !resolvedImport) {
      warnings.push(
        `Component match report entry '${entry.figma.familyKey}' is marked as resolved_import but is missing componentKey/import details.`
      );
      continue;
    }

    const signature = toResolvedImportSignature({
      resolvedImport
    });
    const existing = mappingCandidates.get(componentKey);
    if (!existing) {
      mappingCandidates.set(componentKey, {
        resolvedImport,
        signature
      });
      continue;
    }

    if (existing.signature === signature) {
      continue;
    }

    if (!conflictedComponentKeys.has(componentKey)) {
      warnings.push(
        `Component match report resolved multiple customer-profile imports for component key '${componentKey}'; excluding it from storybook-first design-system mappings.`
      );
      conflictedComponentKeys.add(componentKey);
    }
  }

  const mappings: Record<string, DesignSystemMappingEntry> = Object.fromEntries(
    [...mappingCandidates.entries()]
      .filter(([componentKey]) => !conflictedComponentKeys.has(componentKey))
      .sort((left, right) => left[0].localeCompare(right[0]))
      .map(([componentKey, { resolvedImport }]) => {
        const propMappings = resolvedImport.propMappings
          ? toSortedPropMappings(resolvedImport.propMappings)
          : undefined;
        return [
          componentKey,
          {
            import: resolvedImport.package,
            export: resolvedImport.exportName,
            component: resolvedImport.localName,
            ...(propMappings ? { propMappings } : {})
          } satisfies DesignSystemMappingEntry
        ] as const;
      })
  );

  return {
    ...(Object.keys(mappings).length > 0
      ? {
          config: {
            library: "__customer_profile__",
            mappings
          }
        }
      : {}),
    warnings
  };
};

export const collectCustomerProfileImportIssuesFromSource = ({
  content,
  filePath,
  profile
}: {
  content: string;
  filePath: string;
  profile: ResolvedCustomerProfile;
}): CustomerProfileImportIssue[] => {
  const issues: CustomerProfileImportIssue[] = [];
  const importAliases = profile.template.importAliases;

  for (const sourceImport of collectSourceImports({ content })) {
    if (sourceImport.modulePath === "@mui/material") {
      for (const specifier of sourceImport.namedSpecifiers) {
        if (isCustomerProfileMuiFallbackAllowed({ profile, componentKey: specifier.imported })) {
          continue;
        }
        issues.push({
          code: "E_CUSTOMER_PROFILE_MUI_FALLBACK",
          filePath,
          modulePath: sourceImport.modulePath,
          message: `MUI fallback import '${specifier.imported}' is not allowed by the customer profile.`
        });
      }
      continue;
    }

    const resolvedModulePath = importAliases[sourceImport.modulePath] ?? sourceImport.modulePath;
    const allowedExports = profile.allowedExportsByPackage.get(resolvedModulePath);
    if (!allowedExports) {
      continue;
    }

    for (const specifier of sourceImport.namedSpecifiers) {
      if (allowedExports.has(specifier.imported)) {
        continue;
      }
      issues.push({
        code: "E_CUSTOMER_PROFILE_IMPORT_EXPORT",
        filePath,
        modulePath: sourceImport.modulePath,
        message:
          `Import '${specifier.imported}' from '${sourceImport.modulePath}' is not part of the customer profile export matrix.`
      });
    }
  }

  return issues;
};
