import { readFile } from "node:fs/promises";
import type { WorkspaceBrandTheme } from "./contracts/index.js";
import type { DesignSystemConfig, DesignSystemMappingEntry } from "./design-system.js";
import { normalizeIconKey } from "./icon-library-resolution.js";
import type {
  ComponentMatchReportArtifact,
  ComponentMatchReportResolvedImport,
  ComponentMatchResolvedApi
} from "./storybook/types.js";

const CUSTOMER_PROFILE_VERSION = 1 as const;
const JS_IDENTIFIER_PATTERN = /^[A-Za-z_$][\w$]*$/;
const PROFILE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;
const PACKAGE_NAME_PATTERN = /^(?:@[\w.-]+\/)?[\w.-]+(?:\/[\w.-]+)*$/;
const UNSAFE_VERSION_PATTERN = /^(?:git\+|git:|github:|file:|https?:|link:)/i;
const PROTECTED_ALIAS_KEYS = new Set(["react", "react-dom", "react/jsx-runtime", "vite", "@vitejs/plugin-react"]);
const SOURCE_IMPORT_PATTERN = /import\s+([^;]+?)\s+from\s+["']([^"']+)["'];?/g;
const NAMED_IMPORT_CLAUSE_PATTERN = /\{([\s\S]*?)\}/;

export type CustomerProfileStrictness = "off" | "warn" | "error";
export type CustomerProfileMuiFallbackPolicy = "allow" | "deny";
export type CustomerProfilePrimitivePropValue = boolean | number | string;

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
    icons: Record<
      string,
      {
        package: string;
        export: string;
        importAlias: string;
      }
    >;
  };
  fallbacks: {
    mui: {
      defaultPolicy: CustomerProfileMuiFallbackPolicy;
      components: Record<string, CustomerProfileMuiFallbackPolicy>;
    };
    icons: {
      defaultPolicy: CustomerProfileMuiFallbackPolicy;
      icons: Record<string, CustomerProfileMuiFallbackPolicy>;
      wrapper?: {
        package: string;
        export: string;
        importAlias: string;
        iconProp?: string;
      };
    };
  };
  template: {
    dependencies: Record<string, string>;
    devDependencies: Record<string, string>;
    importAliases: Record<string, string>;
    providers?: {
      datePicker?: {
        package: string;
        export: string;
        importAlias?: string;
        adapter?: {
          package: string;
          export: string;
          importAlias?: string;
          propName?: string;
        };
        props?: Record<string, CustomerProfilePrimitivePropValue>;
      };
    };
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

export interface ResolvedCustomerProfileIconImport {
  iconKey: string;
  package: string;
  exportName: string;
  localName: string;
}

export interface ResolvedCustomerProfileIconFallbackWrapper {
  package: string;
  exportName: string;
  localName: string;
  iconPropName: string;
}

export interface ResolvedCustomerProfileTemplate {
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
  importAliases: Record<string, string>;
  providers: {
    datePicker?: ResolvedCustomerProfileTemplateDatePickerProvider;
  };
}

export interface ResolvedCustomerProfileTemplateImportBinding {
  package: string;
  exportName: string;
  localName: string;
}

export interface ResolvedCustomerProfileTemplateDatePickerProviderAdapter
  extends ResolvedCustomerProfileTemplateImportBinding {
  propName: string;
}

export interface ResolvedCustomerProfileTemplateDatePickerProvider extends ResolvedCustomerProfileTemplateImportBinding {
  adapter?: ResolvedCustomerProfileTemplateDatePickerProviderAdapter;
  props: Record<string, CustomerProfilePrimitivePropValue>;
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
    readonly icons: Readonly<Record<string, ResolvedCustomerProfileIconImport>>;
  };
  fallbacks: {
    readonly mui: {
      readonly defaultPolicy: CustomerProfileMuiFallbackPolicy;
      readonly components: Readonly<Record<string, CustomerProfileMuiFallbackPolicy>>;
    };
    readonly icons: {
      readonly defaultPolicy: CustomerProfileMuiFallbackPolicy;
      readonly icons: Readonly<Record<string, CustomerProfileMuiFallbackPolicy>>;
      readonly wrapper?: Readonly<ResolvedCustomerProfileIconFallbackWrapper>;
    };
  };
  template: Readonly<ResolvedCustomerProfileTemplate>;
  strictness: Readonly<ResolvedCustomerProfileStrictness>;
  familyById: ReadonlyMap<string, ResolvedCustomerProfileFamily>;
  familyByAlias: ReadonlyMap<string, ResolvedCustomerProfileFamily>;
  brandByAlias: ReadonlyMap<string, ResolvedCustomerProfileBrandMapping>;
  componentImportsByKey: ReadonlyMap<string, ResolvedCustomerProfileComponentImport>;
  iconImportsByKey: ReadonlyMap<string, ResolvedCustomerProfileIconImport>;
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

const isScopedPackageName = (value: string): boolean => {
  return value.startsWith("@") && PACKAGE_NAME_PATTERN.test(value);
};

const normalizeAlias = (value: string): string => {
  return value.trim().toLowerCase();
};

const normalizeComponentKey = (value: string): string => {
  return value.trim();
};

const normalizeIconProfileKey = (value: string): string | undefined => {
  return normalizeIconKey({ value });
};

const toSortedRecord = <T>(input: Record<string, T>): Record<string, T> => {
  return Object.fromEntries(
    Object.entries(input).sort((left, right) => left[0].localeCompare(right[0]))
  );
};

const sortUniqueStrings = (values: readonly string[]): string[] => [...new Set(values)].sort((left, right) => left.localeCompare(right));

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

const toResolvedApiDefaultPropsRecord = ({
  resolvedApi
}: {
  resolvedApi: ComponentMatchResolvedApi;
}): Record<string, boolean | number | string> | undefined => {
  if (resolvedApi.defaultProps.length === 0) {
    return undefined;
  }
  return Object.fromEntries(
    [...resolvedApi.defaultProps]
      .sort((left, right) => left.name.localeCompare(right.name))
      .map((entry) => [entry.name, entry.value] as const)
  );
};

const toResolvedApiSignature = ({
  resolvedApi
}: {
  resolvedApi: ComponentMatchResolvedApi;
}): string => {
  return JSON.stringify({
    allowedProps: resolvedApi.allowedProps.map((prop) => ({
      name: prop.name,
      kind: prop.kind,
      ...(prop.allowedValues ? { allowedValues: [...prop.allowedValues] } : {})
    })),
    children: resolvedApi.children,
    slots: resolvedApi.slots,
    ...(resolvedApi.defaultProps.length > 0 ? { defaultProps: toResolvedApiDefaultPropsRecord({ resolvedApi }) } : {})
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

  if (input.some((entry) => typeof entry !== "string")) {
    pushIssue({
      issues,
      path,
      message: "All alias entries must be strings."
    });
  }

  const validStrings = input.filter((entry): entry is string => typeof entry === "string");
  if (validStrings.some((entry) => normalizeAlias(entry).length === 0)) {
    pushIssue({
      issues,
      path,
      message: "Aliases must be non-empty strings."
    });
  }

  const aliases = [...new Set(
    validStrings
      .map((entry) => normalizeAlias(entry))
      .filter((entry) => entry.length > 0)
  )].sort((left, right) => left.localeCompare(right));

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
    if (!isScopedPackageName(name)) {
      pushIssue({
        issues,
        path: `${path}.${rawName}`,
        message: "Dependency name must be a scoped package name (e.g. @scope/package)."
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
    if (UNSAFE_VERSION_PATTERN.test(version)) {
      pushIssue({
        issues,
        path: `${path}.${rawName}`,
        message: "Dependency version must be a semver range or dist-tag, not a URL or file path."
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
    if (PROTECTED_ALIAS_KEYS.has(alias)) {
      pushIssue({
        issues,
        path: `${path}.${rawAlias}`,
        message: `Import alias '${alias}' targets a protected core package and cannot be overridden.`
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

const normalizePrimitivePropRecord = ({
  input,
  path,
  issues
}: {
  input: unknown;
  path: string;
  issues: CustomerProfileParseIssue[];
}): Record<string, CustomerProfilePrimitivePropValue> => {
  if (input === undefined) {
    return {};
  }
  if (!isPlainRecord(input)) {
    pushIssue({
      issues,
      path,
      message: "Expected an object with primitive prop values."
    });
    return {};
  }

  const normalized: Record<string, CustomerProfilePrimitivePropValue> = {};
  for (const [rawPropName, rawValue] of Object.entries(input)) {
    const propName = rawPropName.trim();
    if (!isValidIdentifier(propName)) {
      pushIssue({
        issues,
        path: `${path}.${rawPropName}`,
        message: "Prop name must be a valid identifier."
      });
      continue;
    }
    if (typeof rawValue !== "boolean" && typeof rawValue !== "number" && typeof rawValue !== "string") {
      pushIssue({
        issues,
        path: `${path}.${rawPropName}`,
        message: "Provider prop value must be a boolean, number, or string."
      });
      continue;
    }
    normalized[propName] = rawValue;
  }

  return toSortedRecord(normalized);
};

const parseTemplateImportBinding = ({
  input,
  path,
  issues
}: {
  input: unknown;
  path: string;
  issues: CustomerProfileParseIssue[];
}): ResolvedCustomerProfileTemplateImportBinding | undefined => {
  if (input === undefined) {
    return undefined;
  }
  if (!isPlainRecord(input)) {
    pushIssue({
      issues,
      path,
      message: "Provider import configuration must be an object."
    });
    return undefined;
  }

  const packageName = typeof input.package === "string" ? input.package.trim() : "";
  const packageValid = isValidPackageName(packageName);
  if (!packageValid) {
    pushIssue({
      issues,
      path: `${path}.package`,
      message: "package must be a valid package name."
    });
  }

  const exportName = typeof input.export === "string" ? input.export.trim() : "";
  const exportValid = isValidIdentifier(exportName);
  if (!exportValid) {
    pushIssue({
      issues,
      path: `${path}.export`,
      message: "export must be a valid identifier."
    });
  }

  const importAlias =
    typeof input.importAlias === "string" && input.importAlias.trim().length > 0 ? input.importAlias.trim() : exportName;
  const aliasValid = isValidIdentifier(importAlias);
  if (!aliasValid) {
    pushIssue({
      issues,
      path: `${path}.importAlias`,
      message: "importAlias must be a valid identifier."
    });
  }

  if (!packageValid || !exportValid) {
    return undefined;
  }

  return {
    package: packageName,
    exportName,
    localName: importAlias
  };
};

const parseDatePickerProvider = ({
  input,
  path,
  issues
}: {
  input: unknown;
  path: string;
  issues: CustomerProfileParseIssue[];
}): ResolvedCustomerProfileTemplateDatePickerProvider | undefined => {
  const binding = parseTemplateImportBinding({
    input,
    path,
    issues
  });
  if (!binding || !isPlainRecord(input)) {
    return binding
      ? {
          ...binding,
          props: {}
        }
      : undefined;
  }

  const rawAdapter = isPlainRecord(input.adapter) ? input.adapter : undefined;
  if (input.adapter !== undefined && !rawAdapter) {
    pushIssue({
      issues,
      path: `${path}.adapter`,
      message: "adapter must be an object."
    });
  }

  const adapterBinding = parseTemplateImportBinding({
    input: rawAdapter,
    path: `${path}.adapter`,
    issues
  });
  const adapterPropName =
    typeof rawAdapter?.propName === "string" && rawAdapter.propName.trim().length > 0
      ? rawAdapter.propName.trim()
      : "dateAdapter";
  if (adapterBinding && !isValidIdentifier(adapterPropName)) {
    pushIssue({
      issues,
      path: `${path}.adapter.propName`,
      message: "propName must be a valid identifier."
    });
  }

  const props = normalizePrimitivePropRecord({
    input: input.props,
    path: `${path}.props`,
    issues
  });

  return {
    ...binding,
    props,
    ...(adapterBinding
      ? {
          adapter: {
            ...adapterBinding,
            propName: adapterPropName
          }
        }
      : {})
  };
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

const parseIconFallbackWrapper = ({
  input,
  path,
  issues
}: {
  input: unknown;
  path: string;
  issues: CustomerProfileParseIssue[];
}): ResolvedCustomerProfileIconFallbackWrapper | undefined => {
  const binding = parseTemplateImportBinding({
    input,
    path,
    issues
  });
  if (!binding || !isPlainRecord(input)) {
    return binding
      ? {
          ...binding,
          iconPropName: "name"
        }
      : undefined;
  }

  const iconPropName =
    typeof input.iconProp === "string" && input.iconProp.trim().length > 0 ? input.iconProp.trim() : "name";
  if (!isValidIdentifier(iconPropName)) {
    pushIssue({
      issues,
      path: `${path}.iconProp`,
      message: "iconProp must be a valid identifier."
    });
  }

  return {
    ...binding,
    iconPropName
  };
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
  const rawImportIconsInput = rawImports === undefined ? undefined : rawImports.icons;
  const rawImportIcons = isPlainRecord(rawImportIconsInput) ? rawImportIconsInput : undefined;
  if (rawImportIconsInput !== undefined && !rawImportIcons) {
    pushIssue({
      issues,
      path: "imports.icons",
      message: "imports.icons must be an object."
    });
  }

  const resolvedComponentImports: Record<string, ResolvedCustomerProfileComponentImport> = {};
  const resolvedIconImports: Record<string, ResolvedCustomerProfileIconImport> = {};
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
  if (rawImportIcons) {
    for (const [rawIconKey, rawImportEntry] of Object.entries(rawImportIcons)) {
      const normalizedIconKey = normalizeIconProfileKey(rawIconKey);
      const pathPrefix = `imports.icons.${rawIconKey}`;
      if (!normalizedIconKey) {
        pushIssue({
          issues,
          path: pathPrefix,
          message: "Icon key must normalize to a non-empty deterministic icon key."
        });
        continue;
      }
      if (!isPlainRecord(rawImportEntry)) {
        pushIssue({
          issues,
          path: pathPrefix,
          message: "Icon import entry must be an object."
        });
        continue;
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

      const bindingKey = `${packageName}::${exportName}`;
      const bindingOwner = bindingOwners.get(bindingKey);
      if (bindingOwner && bindingOwner !== `icon:${normalizedIconKey}`) {
        pushIssue({
          issues,
          path: pathPrefix,
          message: `Import binding '${bindingKey}' is already assigned to '${bindingOwner}'.`
        });
      } else if (packageName && exportName) {
        bindingOwners.set(bindingKey, `icon:${normalizedIconKey}`);
      }

      resolvedIconImports[normalizedIconKey] = {
        iconKey: normalizedIconKey,
        package: packageName,
        exportName,
        localName: importAlias
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

  const rawIconFallbacksInput = rawFallbacks === undefined ? undefined : rawFallbacks.icons;
  const rawIconFallbacks = isPlainRecord(rawIconFallbacksInput) ? rawIconFallbacksInput : undefined;
  if (rawIconFallbacksInput !== undefined && !rawIconFallbacks) {
    pushIssue({
      issues,
      path: "fallbacks.icons",
      message: "fallbacks.icons must be an object."
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
  const defaultIconPolicy =
    rawIconFallbacksInput === undefined
      ? "deny"
      : parseMuiFallbackPolicy({
          input: rawIconFallbacks?.defaultPolicy,
          path: "fallbacks.icons.defaultPolicy",
          issues
        });

  const iconPolicies: Record<string, CustomerProfileMuiFallbackPolicy> = {};
  if (rawIconFallbacks?.icons !== undefined) {
    if (!isPlainRecord(rawIconFallbacks.icons)) {
      pushIssue({
        issues,
        path: "fallbacks.icons.icons",
        message: "fallbacks.icons.icons must be an object."
      });
    } else {
      for (const [rawIconKey, rawPolicy] of Object.entries(rawIconFallbacks.icons)) {
        const normalizedIconKey = normalizeIconProfileKey(rawIconKey);
        if (!normalizedIconKey) {
          pushIssue({
            issues,
            path: `fallbacks.icons.icons.${rawIconKey}`,
            message: "Fallback icon key must normalize to a non-empty deterministic icon key."
          });
          continue;
        }
        iconPolicies[normalizedIconKey] = parseMuiFallbackPolicy({
          input: rawPolicy,
          path: `fallbacks.icons.icons.${rawIconKey}`,
          issues
        });
      }
    }
  }

  const iconFallbackWrapper = parseIconFallbackWrapper({
    input: rawIconFallbacks?.wrapper,
    path: "fallbacks.icons.wrapper",
    issues
  });
  const requiresIconWrapper =
    defaultIconPolicy === "allow" || Object.values(iconPolicies).some((policy) => policy === "allow");
  if (requiresIconWrapper && !iconFallbackWrapper) {
    pushIssue({
      issues,
      path: "fallbacks.icons.wrapper",
      message: "fallbacks.icons.wrapper is required when any icon fallback policy allows wrapper fallback."
    });
  } else if (iconFallbackWrapper) {
    const bindingKey = `${iconFallbackWrapper.package}::${iconFallbackWrapper.exportName}`;
    const bindingOwner = bindingOwners.get(bindingKey);
    if (bindingOwner && bindingOwner !== "icon_wrapper") {
      pushIssue({
        issues,
        path: "fallbacks.icons.wrapper",
        message: `Import binding '${bindingKey}' is already assigned to '${bindingOwner}'.`
      });
    } else if (iconFallbackWrapper.package && iconFallbackWrapper.exportName) {
      bindingOwners.set(bindingKey, "icon_wrapper");
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
    }),
    providers: (() => {
      const rawProviders = rawTemplate?.providers;
      if (rawProviders !== undefined && !isPlainRecord(rawProviders)) {
        pushIssue({
          issues,
          path: "template.providers",
          message: "template.providers must be an object."
        });
      }
      const datePicker = parseDatePickerProvider({
        input: isPlainRecord(rawProviders) ? rawProviders.datePicker : undefined,
        path: "template.providers.datePicker",
        issues
      });
      return {
        ...(datePicker ? { datePicker } : {})
      };
    })()
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
  const sortedIconImports = toSortedRecord(resolvedIconImports);
  const sortedMuiComponentPolicies = toSortedRecord(muiComponentPolicies);
  const sortedIconPolicies = toSortedRecord(iconPolicies);

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
  const iconImportsByKey = new Map<string, ResolvedCustomerProfileIconImport>();
  const allowedExportsByPackage = new Map<string, Set<string>>();
  const registerAllowedExport = ({
    packageName,
    exportName
  }: {
    packageName: string;
    exportName: string;
  }): void => {
    if (!packageName || !exportName) {
      return;
    }
    const existingExports = allowedExportsByPackage.get(packageName) ?? new Set<string>();
    existingExports.add(exportName);
    allowedExportsByPackage.set(packageName, existingExports);
  };
  for (const [componentKey, importEntry] of Object.entries(sortedComponentImports)) {
    componentImportsByKey.set(componentKey, importEntry);
    registerAllowedExport({
      packageName: importEntry.package,
      exportName: importEntry.exportName
    });
  }
  for (const [iconKey, importEntry] of Object.entries(sortedIconImports)) {
    iconImportsByKey.set(iconKey, importEntry);
    registerAllowedExport({
      packageName: importEntry.package,
      exportName: importEntry.exportName
    });
  }
  if (iconFallbackWrapper) {
    registerAllowedExport({
      packageName: iconFallbackWrapper.package,
      exportName: iconFallbackWrapper.exportName
    });
  }
  if (template.providers.datePicker) {
    registerAllowedExport({
      packageName: template.providers.datePicker.package,
      exportName: template.providers.datePicker.exportName
    });
    if (template.providers.datePicker.adapter) {
      registerAllowedExport({
        packageName: template.providers.datePicker.adapter.package,
        exportName: template.providers.datePicker.adapter.exportName
      });
    }
  }

  return {
    success: true,
    config: {
      version: CUSTOMER_PROFILE_VERSION,
      families: sortedFamilies,
      brandMappings: sortedBrandMappings,
      imports: {
        components: sortedComponentImports,
        icons: sortedIconImports
      },
      fallbacks: {
        mui: {
          defaultPolicy,
          components: sortedMuiComponentPolicies
        },
        icons: {
          defaultPolicy: defaultIconPolicy,
          icons: sortedIconPolicies,
          ...(iconFallbackWrapper ? { wrapper: iconFallbackWrapper } : {})
        }
      },
      template,
      strictness,
      familyById: resolvedFamilyById,
      familyByAlias: resolvedFamilyByAlias,
      brandByAlias: resolvedBrandByAlias,
      componentImportsByKey,
      iconImportsByKey,
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
  const datePickerProviderSnapshot = profile.template.providers.datePicker
    ? {
        datePicker: {
          package: profile.template.providers.datePicker.package,
          export: profile.template.providers.datePicker.exportName,
          ...(profile.template.providers.datePicker.localName !== profile.template.providers.datePicker.exportName
            ? { importAlias: profile.template.providers.datePicker.localName }
            : {}),
          ...(profile.template.providers.datePicker.adapter
            ? {
                adapter: {
                  package: profile.template.providers.datePicker.adapter.package,
                  export: profile.template.providers.datePicker.adapter.exportName,
                  ...(profile.template.providers.datePicker.adapter.localName !==
                  profile.template.providers.datePicker.adapter.exportName
                    ? { importAlias: profile.template.providers.datePicker.adapter.localName }
                    : {}),
                  ...(profile.template.providers.datePicker.adapter.propName !== "dateAdapter"
                    ? { propName: profile.template.providers.datePicker.adapter.propName }
                    : {})
                }
              }
            : {}),
          ...(Object.keys(profile.template.providers.datePicker.props).length > 0
            ? { props: { ...profile.template.providers.datePicker.props } }
            : {})
        }
      }
    : undefined;

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
      ),
      icons: Object.fromEntries(
        Object.entries(profile.imports.icons).map(([iconKey, iconImport]) => [
          iconKey,
          {
            package: iconImport.package,
            export: iconImport.exportName,
            importAlias: iconImport.localName
          }
        ])
      )
    },
    fallbacks: {
      mui: {
        defaultPolicy: profile.fallbacks.mui.defaultPolicy,
        components: { ...profile.fallbacks.mui.components }
      },
      icons: {
        defaultPolicy: profile.fallbacks.icons.defaultPolicy,
        icons: { ...profile.fallbacks.icons.icons },
        ...(profile.fallbacks.icons.wrapper
          ? {
              wrapper: {
                package: profile.fallbacks.icons.wrapper.package,
                export: profile.fallbacks.icons.wrapper.exportName,
                importAlias: profile.fallbacks.icons.wrapper.localName,
                ...(profile.fallbacks.icons.wrapper.iconPropName !== "name"
                  ? { iconProp: profile.fallbacks.icons.wrapper.iconPropName }
                  : {})
              }
            }
          : {})
      }
    },
    template: {
      dependencies: { ...profile.template.dependencies },
      devDependencies: { ...profile.template.devDependencies },
      importAliases: { ...profile.template.importAliases },
      ...(datePickerProviderSnapshot ? { providers: datePickerProviderSnapshot } : {})
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

export const resolveCustomerProfileIconImport = ({
  profile,
  iconKey
}: {
  profile: ResolvedCustomerProfile;
  iconKey: string;
}): ResolvedCustomerProfileIconImport | undefined => {
  const normalizedIconKey = normalizeIconProfileKey(iconKey);
  if (!normalizedIconKey) {
    return undefined;
  }
  return profile.iconImportsByKey.get(normalizedIconKey);
};

export const isCustomerProfileIconFallbackAllowed = ({
  profile,
  iconKey
}: {
  profile: ResolvedCustomerProfile;
  iconKey: string;
}): boolean => {
  const normalizedIconKey = normalizeIconProfileKey(iconKey);
  if (!normalizedIconKey) {
    return false;
  }
  const explicitPolicy = profile.fallbacks.icons.icons[normalizedIconKey];
  if (explicitPolicy !== undefined) {
    return explicitPolicy === "allow";
  }
  return profile.fallbacks.icons.defaultPolicy === "allow";
};

export const resolveCustomerProfileIconFallbackWrapper = ({
  profile
}: {
  profile: ResolvedCustomerProfile;
}): ResolvedCustomerProfileIconFallbackWrapper | undefined => {
  return profile.fallbacks.icons.wrapper;
};

export const resolveCustomerProfileDatePickerProvider = ({
  profile
}: {
  profile: ResolvedCustomerProfile;
}): ResolvedCustomerProfileTemplateDatePickerProvider | undefined => {
  return profile.template.providers.datePicker;
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
  const warnings: string[] = [];
  const entriesByComponentKey = new Map<
    string,
    Array<{
      familyKey: string;
      resolvedImport: ComponentMatchReportResolvedImport;
      importSignature: string;
      resolvedApi?: NonNullable<(typeof artifact.entries)[number]["resolvedApi"]>;
      resolvedProps?: NonNullable<(typeof artifact.entries)[number]["resolvedProps"]>;
    }>
  >();

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
    const existingEntries = entriesByComponentKey.get(componentKey) ?? [];
    existingEntries.push({
      familyKey: entry.figma.familyKey,
      resolvedImport,
      importSignature: signature,
      ...(entry.resolvedApi ? { resolvedApi: entry.resolvedApi } : {}),
      ...(entry.resolvedProps ? { resolvedProps: entry.resolvedProps } : {})
    });
    entriesByComponentKey.set(componentKey, existingEntries);
  }

  const mappingEntries: Array<readonly [string, DesignSystemMappingEntry]> = [];
  for (const [componentKey, entries] of [...entriesByComponentKey.entries()].sort((left, right) =>
    left[0].localeCompare(right[0])
  )) {
    const importSignatures = new Set(entries.map((entry) => entry.importSignature));
    if (importSignatures.size > 1) {
      warnings.push(
        `Component match report resolved multiple customer-profile imports for component key '${componentKey}'; excluding it from storybook-first design-system mappings.`
      );
      continue;
    }

    const legacyEntries = entries.filter((entry) => !entry.resolvedApi || !entry.resolvedProps);
    const resolvedEntries = entries.filter(
      (entry): entry is typeof entry & {
        resolvedApi: NonNullable<typeof entry.resolvedApi>;
        resolvedProps: NonNullable<typeof entry.resolvedProps>;
      } => entry.resolvedApi !== undefined && entry.resolvedProps !== undefined
    );
    if (legacyEntries.length > 0 && resolvedEntries.length > 0) {
      warnings.push(
        `Component match report mixed legacy and resolved component-api records for component key '${componentKey}'; excluding it from storybook-first design-system mappings.`
      );
      continue;
    }

    if (
      resolvedEntries.some(
        (entry) =>
          entry.resolvedApi.status !== "resolved" ||
          entry.resolvedProps.status !== "resolved" ||
          !entry.resolvedProps.codegenCompatible
      )
    ) {
      warnings.push(
        `Component match report found incompatible component-api contracts for component key '${componentKey}'; excluding it from storybook-first design-system mappings.`
      );
      continue;
    }

    const resolvedApiSignatures = new Set(
      resolvedEntries.map((entry) => toResolvedApiSignature({ resolvedApi: entry.resolvedApi }))
    );
    if (resolvedApiSignatures.size > 1) {
      warnings.push(
        `Component match report resolved multiple component-api contracts for component key '${componentKey}'; excluding it from storybook-first design-system mappings.`
      );
      continue;
    }

    const representativeEntry = entries[0];
    const resolvedImport = representativeEntry?.resolvedImport;
    if (!resolvedImport) {
      continue;
    }
    const propMappings = resolvedImport.propMappings ? toSortedPropMappings(resolvedImport.propMappings) : undefined;
    const resolvedApi = resolvedEntries[0]?.resolvedApi;
    const omittedProps = sortUniqueStrings(
      [
        ...resolvedEntries.flatMap((entry) => entry.resolvedProps.omittedProps.map((item) => item.sourceProp)),
        ...(resolvedApi && !resolvedApi.allowedProps.some((prop) => prop.name === "sx") ? ["sx"] : [])
      ]
    );
    const defaultProps = resolvedApi ? toResolvedApiDefaultPropsRecord({ resolvedApi }) : undefined;
    if (legacyEntries.length > 0) {
      warnings.push(
        `Component match report for component key '${componentKey}' does not include resolved component-api data; applying legacy storybook-first import mapping.`
      );
    }

    mappingEntries.push([
      componentKey,
      {
        import: resolvedImport.package,
        export: resolvedImport.exportName,
        component: resolvedImport.localName,
        ...(propMappings ? { propMappings } : {}),
        ...(omittedProps.length > 0 ? { omittedProps } : {}),
        ...(defaultProps ? { defaultProps } : {})
      } satisfies DesignSystemMappingEntry
    ] as const);
  }

  const mappings: Record<string, DesignSystemMappingEntry> = Object.fromEntries(mappingEntries);

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
