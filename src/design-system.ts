import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

export interface DesignSystemMappingEntry {
  import?: string;
  component: string;
  propMappings?: Record<string, string>;
}

export interface DesignSystemConfig {
  library: string;
  mappings: Record<string, DesignSystemMappingEntry>;
}

export interface DesignSystemScanResult {
  config: DesignSystemConfig;
  scannedFiles: number;
  selectedLibrary: string;
}

const JS_IDENTIFIER_PATTERN = /^[A-Za-z_$][\w$]*$/;
const SUPPORTED_SCAN_EXTENSIONS = new Set<string>([".ts", ".tsx", ".js", ".jsx"]);
const SCAN_EXCLUDE_DIRECTORIES = new Set<string>(["node_modules", "dist", ".workspace-dev", ".git"]);
const IMPORT_LINE_PATTERN = /^import\s+.+?;$/gm;
const IMPORT_FROM_PATTERN = /^import\s+(.+?)\s+from\s+["']([^"']+)["'];$/;
const NAMED_CLAUSE_PATTERN = /^\{([\s\S]+)\}$/;

const isPlainRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null && !Array.isArray(value);
};

const isValidIdentifier = (value: string): boolean => {
  return JS_IDENTIFIER_PATTERN.test(value);
};

const escapeRegex = (value: string): string => {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
};

const normalizeRelativePath = (value: string): string => {
  return value.replace(/\\/g, "/");
};

const toSafeIdentifier = ({
  value,
  fallback
}: {
  value: string;
  fallback: string;
}): string => {
  const sanitized = value.replace(/[^A-Za-z0-9_$]+/g, "_").replace(/^(\d)/, "_$1");
  return isValidIdentifier(sanitized) ? sanitized : fallback;
};

interface ParsedNamedSpecifier {
  imported: string;
  local: string;
}

const parseNamedSpecifiers = ({
  rawClause
}: {
  rawClause: string;
}): ParsedNamedSpecifier[] => {
  const match = rawClause.match(NAMED_CLAUSE_PATTERN);
  if (!match) {
    return [];
  }

  const clausePayload = match[1] ?? "";
  return clausePayload
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
        } satisfies ParsedNamedSpecifier;
      }
      if (isValidIdentifier(entry)) {
        return {
          imported: entry,
          local: entry
        } satisfies ParsedNamedSpecifier;
      }
      return undefined;
    })
    .filter((entry): entry is ParsedNamedSpecifier => entry !== undefined);
};

const parseImportIdentifiers = ({
  importLine
}: {
  importLine: string;
}): string[] => {
  const match = importLine.match(IMPORT_FROM_PATTERN);
  if (!match) {
    return [];
  }

  const clause = match[1]!.trim();
  const identifiers = new Set<string>();

  const namedStart = clause.indexOf("{");
  const namedEnd = clause.lastIndexOf("}");
  if (namedStart >= 0 && namedEnd > namedStart) {
    const namedClause = clause.slice(namedStart, namedEnd + 1);
    for (const specifier of parseNamedSpecifiers({ rawClause: namedClause })) {
      identifiers.add(specifier.local);
    }
    const defaultCandidate = clause.slice(0, namedStart).replace(/,$/, "").replace(/^type\s+/, "").trim();
    if (defaultCandidate.startsWith("* as ")) {
      const namespaceLocal = defaultCandidate.replace("* as ", "").trim();
      if (isValidIdentifier(namespaceLocal)) {
        identifiers.add(namespaceLocal);
      }
    } else if (defaultCandidate.length > 0 && isValidIdentifier(defaultCandidate)) {
      identifiers.add(defaultCandidate);
    }
    return [...identifiers];
  }

  const normalizedClause = clause.replace(/^type\s+/, "").trim();
  if (normalizedClause.startsWith("* as ")) {
    const namespaceLocal = normalizedClause.replace("* as ", "").trim();
    if (isValidIdentifier(namespaceLocal)) {
      identifiers.add(namespaceLocal);
    }
    return [...identifiers];
  }

  if (isValidIdentifier(normalizedClause)) {
    identifiers.add(normalizedClause);
  }

  return [...identifiers];
};

const parseImportLine = ({
  importLine
}: {
  importLine: string;
}): { clause: string; modulePath: string } | undefined => {
  const match = importLine.match(IMPORT_FROM_PATTERN);
  if (!match) {
    return undefined;
  }

  return {
    clause: match[1]!.trim(),
    modulePath: match[2]!.trim()
  };
};

const isTargetFileForDesignSystemTransform = ({
  filePath
}: {
  filePath: string;
}): boolean => {
  const normalized = normalizeRelativePath(filePath);
  if (/^src\/screens\/[^/]+\.tsx$/i.test(normalized)) {
    return true;
  }
  return /^src\/components\/[^/]*Pattern\d+\.tsx$/i.test(normalized);
};

const normalizePropMappings = ({
  input
}: {
  input: unknown;
}): Record<string, string> | undefined => {
  if (!isPlainRecord(input)) {
    return undefined;
  }

  const normalizedEntries = Object.entries(input)
    .map(([source, target]) => {
      if (!isValidIdentifier(source) || typeof target !== "string") {
        return undefined;
      }
      const normalizedTarget = target.trim();
      if (!isValidIdentifier(normalizedTarget)) {
        return undefined;
      }
      return [source, normalizedTarget] as const;
    })
    .filter((entry): entry is readonly [string, string] => entry !== undefined)
    .sort((left, right) => left[0].localeCompare(right[0]));

  if (normalizedEntries.length === 0) {
    return undefined;
  }

  return Object.fromEntries(normalizedEntries);
};

export const parseDesignSystemConfig = ({
  input
}: {
  input: unknown;
}): DesignSystemConfig | undefined => {
  if (!isPlainRecord(input)) {
    return undefined;
  }

  const library = typeof input.library === "string" ? input.library.trim() : "";
  if (!library) {
    return undefined;
  }

  const rawMappings = input.mappings;
  if (!isPlainRecord(rawMappings)) {
    return undefined;
  }

  const mappingEntries = Object.entries(rawMappings)
    .map(([muiComponentName, rawMapping]) => {
      if (!isValidIdentifier(muiComponentName) || !isPlainRecord(rawMapping)) {
        return undefined;
      }

      const component = typeof rawMapping.component === "string" ? rawMapping.component.trim() : "";
      if (!component || !isValidIdentifier(component)) {
        return undefined;
      }

      const importPath =
        typeof rawMapping.import === "string" && rawMapping.import.trim().length > 0 ? rawMapping.import.trim() : undefined;
      const propMappings = normalizePropMappings({ input: rawMapping.propMappings });

      return [
        muiComponentName,
        {
          ...(importPath ? { import: importPath } : {}),
          component,
          ...(propMappings ? { propMappings } : {})
        } satisfies DesignSystemMappingEntry
      ] as const;
    })
    .filter((entry): entry is readonly [string, DesignSystemMappingEntry] => entry !== undefined)
    .sort((left, right) => left[0].localeCompare(right[0]));

  return {
    library,
    mappings: Object.fromEntries(mappingEntries)
  };
};

export const loadDesignSystemConfigFile = async ({
  designSystemFilePath,
  onLog
}: {
  designSystemFilePath: string;
  onLog: (message: string) => void;
}): Promise<DesignSystemConfig | undefined> => {
  try {
    const raw = await readFile(designSystemFilePath, "utf8");
    const parsedJson = JSON.parse(raw);
    const parsedConfig = parseDesignSystemConfig({ input: parsedJson });
    if (!parsedConfig) {
      onLog(`Design system config at '${designSystemFilePath}' is invalid; using MUI defaults.`);
      return undefined;
    }
    return parsedConfig;
  } catch (error) {
    const typedError = error as NodeJS.ErrnoException;
    if (typedError.code === "ENOENT") {
      return undefined;
    }
    const errorMessage = error instanceof Error ? error.message : String(error);
    onLog(`Failed to load design system config at '${designSystemFilePath}': ${errorMessage}; using MUI defaults.`);
    return undefined;
  }
};

interface PendingMuiReplacement {
  muiImportedName: string;
  muiLocalName: string;
  mapping: DesignSystemMappingEntry;
}

interface ResolvedMuiReplacement {
  muiImportedName: string;
  muiLocalName: string;
  designImportedName: string;
  designLocalName: string;
  modulePath: string;
  propMappings: Record<string, string>;
}

export const applyDesignSystemMappingsToGeneratedTsx = ({
  filePath,
  content,
  config
}: {
  filePath: string;
  content: string;
  config: DesignSystemConfig;
}): string => {
  if (!isTargetFileForDesignSystemTransform({ filePath }) || Object.keys(config.mappings).length === 0) {
    return content;
  }

  const pendingReplacements: PendingMuiReplacement[] = [];
  const contentWithoutMappedMuiImports = content.replace(
    /^import\s+(\{[^\n]+?\})\s+from\s+["']@mui\/material["'];\s*$/gm,
    (fullLine, rawClause: string) => {
      const namedSpecifiers = parseNamedSpecifiers({ rawClause });
      if (namedSpecifiers.length === 0) {
        return fullLine;
      }

      const keptSpecifiers: ParsedNamedSpecifier[] = [];
      for (const specifier of namedSpecifiers) {
        const mapping = config.mappings[specifier.imported];
        if (!mapping) {
          keptSpecifiers.push(specifier);
          continue;
        }
        pendingReplacements.push({
          muiImportedName: specifier.imported,
          muiLocalName: specifier.local,
          mapping
        });
      }

      if (keptSpecifiers.length === 0) {
        return "";
      }

      const clause = keptSpecifiers
        .map((specifier) => (specifier.imported === specifier.local ? specifier.imported : `${specifier.imported} as ${specifier.local}`))
        .join(", ");
      return `import { ${clause} } from "@mui/material";`;
    }
  );

  if (pendingReplacements.length === 0) {
    return content;
  }

  const existingImportIdentifiers = new Set<string>();
  for (const importMatch of contentWithoutMappedMuiImports.matchAll(IMPORT_LINE_PATTERN)) {
    const importLine = importMatch[0];
    for (const identifier of parseImportIdentifiers({ importLine })) {
      existingImportIdentifiers.add(identifier);
    }
  }

  const replacementByMuiLocalName = new Map<string, ResolvedMuiReplacement>();
  const assignedDesignLocals = new Map<string, string>();

  for (const pending of [...pendingReplacements].sort((left, right) => left.muiLocalName.localeCompare(right.muiLocalName))) {
    if (replacementByMuiLocalName.has(pending.muiLocalName)) {
      continue;
    }

    const modulePath = pending.mapping.import?.trim() || config.library;
    if (!modulePath) {
      continue;
    }

    const designImportedName = pending.mapping.component;
    const importedKey = `${modulePath}::${designImportedName}`;
    const existingAssignedLocal = assignedDesignLocals.get(importedKey);
    let designLocalName = existingAssignedLocal;
    if (!designLocalName) {
      const preferredName = toSafeIdentifier({ value: designImportedName, fallback: "DesignSystemComponent" });
      let candidate = preferredName;
      let suffix = 2;
      while (existingImportIdentifiers.has(candidate)) {
        candidate = `${preferredName}${suffix}`;
        suffix += 1;
      }
      designLocalName = candidate;
      existingImportIdentifiers.add(designLocalName);
      assignedDesignLocals.set(importedKey, designLocalName);
    }

    replacementByMuiLocalName.set(pending.muiLocalName, {
      muiImportedName: pending.muiImportedName,
      muiLocalName: pending.muiLocalName,
      designImportedName,
      designLocalName,
      modulePath,
      propMappings: pending.mapping.propMappings ?? {}
    });
  }

  if (replacementByMuiLocalName.size === 0) {
    return content;
  }

  let transformedContent = contentWithoutMappedMuiImports;
  const orderedReplacements = [...replacementByMuiLocalName.values()].sort(
    (left, right) => right.muiLocalName.length - left.muiLocalName.length || left.muiLocalName.localeCompare(right.muiLocalName)
  );

  for (const replacement of orderedReplacements) {
    transformedContent = transformedContent
      .replace(
        new RegExp(`<${escapeRegex(replacement.muiLocalName)}(?=[\\s>/])`, "g"),
        `<${replacement.designLocalName}`
      )
      .replace(
        new RegExp(`</${escapeRegex(replacement.muiLocalName)}(?=\\s*>)`, "g"),
        `</${replacement.designLocalName}`
      );

    if (Object.keys(replacement.propMappings).length === 0) {
      continue;
    }

    const openingTagPattern = new RegExp(`<${escapeRegex(replacement.designLocalName)}(?=[\\s>])[^>]*>`, "gs");
    transformedContent = transformedContent.replace(openingTagPattern, (tag) => {
      let nextTag = tag;
      for (const [sourceProp, targetProp] of Object.entries(replacement.propMappings).sort((left, right) => left[0].localeCompare(right[0]))) {
        nextTag = nextTag.replace(new RegExp(`\\b${escapeRegex(sourceProp)}(?=\\s*=)`, "g"), targetProp);
      }
      return nextTag;
    });
  }

  const designImportsByModule = new Map<string, Array<{ imported: string; local: string }>>();
  for (const replacement of replacementByMuiLocalName.values()) {
    const current = designImportsByModule.get(replacement.modulePath) ?? [];
    if (!current.some((entry) => entry.imported === replacement.designImportedName && entry.local === replacement.designLocalName)) {
      current.push({
        imported: replacement.designImportedName,
        local: replacement.designLocalName
      });
    }
    designImportsByModule.set(replacement.modulePath, current);
  }

  if (designImportsByModule.size === 0) {
    return transformedContent;
  }

  const existingImportLines = new Set((transformedContent.match(IMPORT_LINE_PATTERN) ?? []).map((line) => line.trim()));
  const designImportLines = [...designImportsByModule.entries()]
    .sort((left, right) => left[0].localeCompare(right[0]))
    .map(([modulePath, specifiers]) => {
      const sortedSpecifiers = [...specifiers].sort(
        (left, right) => left.imported.localeCompare(right.imported) || left.local.localeCompare(right.local)
      );
      const clause = sortedSpecifiers
        .map((specifier) => (specifier.imported === specifier.local ? specifier.imported : `${specifier.imported} as ${specifier.local}`))
        .join(", ");
      return `import { ${clause} } from "${modulePath}";`;
    })
    .filter((line) => !existingImportLines.has(line));

  if (designImportLines.length === 0) {
    return transformedContent;
  }

  const allImportMatches = [...transformedContent.matchAll(IMPORT_LINE_PATTERN)];
  if (allImportMatches.length === 0) {
    return `${designImportLines.join("\n")}\n\n${transformedContent.replace(/^\n+/, "")}`;
  }

  const lastImportMatch = allImportMatches.at(-1);
  if (!lastImportMatch || typeof lastImportMatch.index !== "number") {
    return transformedContent;
  }

  const insertionIndex = lastImportMatch.index + lastImportMatch[0].length;
  const prefix = transformedContent.slice(0, insertionIndex);
  const suffix = transformedContent.slice(insertionIndex);
  return `${prefix}\n${designImportLines.join("\n")}${suffix}`;
};

interface ScanImportCandidate {
  modulePath: string;
  importedName: string;
}

const isRelativeModulePath = (modulePath: string): boolean => {
  return modulePath.startsWith(".") || modulePath.startsWith("/");
};

const hasJsxUsage = ({
  content,
  componentLocalName
}: {
  content: string;
  componentLocalName: string;
}): boolean => {
  if (!isValidIdentifier(componentLocalName)) {
    return false;
  }
  const escaped = escapeRegex(componentLocalName);
  const pattern = new RegExp(`<${escaped}(?=[\\s>/])|</${escaped}(?=\\s*>)`, "g");
  return pattern.test(content);
};

const deriveMuiBaseComponent = ({
  componentName
}: {
  componentName: string;
}): string | undefined => {
  if (!componentName) {
    return undefined;
  }

  const exactMatchCandidates = ["Button", "Card", "TextField"];
  if (exactMatchCandidates.includes(componentName)) {
    return componentName;
  }

  if (componentName.endsWith("Button")) {
    return "Button";
  }
  if (componentName.endsWith("Card")) {
    return "Card";
  }
  if (componentName.endsWith("TextField") || componentName.endsWith("Input")) {
    return "TextField";
  }

  return undefined;
};

const collectSourceFilesForScan = async ({
  projectRoot
}: {
  projectRoot: string;
}): Promise<string[]> => {
  const results: string[] = [];
  const pending = [projectRoot];

  while (pending.length > 0) {
    const current = pending.pop();
    if (!current) {
      continue;
    }

    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const absolutePath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (SCAN_EXCLUDE_DIRECTORIES.has(entry.name)) {
          continue;
        }
        pending.push(absolutePath);
        continue;
      }
      if (!entry.isFile()) {
        continue;
      }
      if (SUPPORTED_SCAN_EXTENSIONS.has(path.extname(entry.name))) {
        results.push(absolutePath);
      }
    }
  }

  return results.sort((left, right) => left.localeCompare(right));
};

export const inferDesignSystemConfigFromProject = async ({
  projectRoot,
  libraryOverride
}: {
  projectRoot: string;
  libraryOverride?: string;
}): Promise<DesignSystemScanResult> => {
  const resolvedRoot = path.resolve(projectRoot);
  const sourceFiles = await collectSourceFilesForScan({ projectRoot: resolvedRoot });
  const moduleUsageCount = new Map<string, number>();
  const componentCandidates: ScanImportCandidate[] = [];

  for (const sourceFile of sourceFiles) {
    const content = await readFile(sourceFile, "utf8");
    for (const importMatch of content.matchAll(IMPORT_LINE_PATTERN)) {
      const parsedImportLine = parseImportLine({ importLine: importMatch[0] });
      if (!parsedImportLine || isRelativeModulePath(parsedImportLine.modulePath)) {
        continue;
      }

      const namedStart = parsedImportLine.clause.indexOf("{");
      const namedEnd = parsedImportLine.clause.lastIndexOf("}");
      const namedClause =
        namedStart >= 0 && namedEnd > namedStart ? parsedImportLine.clause.slice(namedStart, namedEnd + 1) : undefined;
      if (!namedClause) {
        continue;
      }

      for (const specifier of parseNamedSpecifiers({ rawClause: namedClause })) {
        if (!hasJsxUsage({ content, componentLocalName: specifier.local })) {
          continue;
        }
        moduleUsageCount.set(parsedImportLine.modulePath, (moduleUsageCount.get(parsedImportLine.modulePath) ?? 0) + 1);
        componentCandidates.push({
          modulePath: parsedImportLine.modulePath,
          importedName: specifier.imported
        });
      }
    }
  }

  const selectedLibrary =
    libraryOverride?.trim() && libraryOverride.trim().length > 0
      ? libraryOverride.trim()
      : [...moduleUsageCount.entries()]
          .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
          .at(0)?.[0] ?? "@company/ui";

  const candidatesForLibrary = componentCandidates
    .filter((candidate) => candidate.modulePath === selectedLibrary)
    .map((candidate) => candidate.importedName);

  const candidatesByMuiComponent = new Map<string, string[]>();
  for (const importedName of candidatesForLibrary) {
    const muiComponentName = deriveMuiBaseComponent({ componentName: importedName });
    if (!muiComponentName) {
      continue;
    }
    const current = candidatesByMuiComponent.get(muiComponentName) ?? [];
    current.push(importedName);
    candidatesByMuiComponent.set(muiComponentName, current);
  }

  const mappingsEntries = [...candidatesByMuiComponent.entries()]
    .map(([muiComponentName, candidates]) => {
      const selectedComponent = [...new Set(candidates)].sort((left, right) => {
        const leftExact = left === muiComponentName ? 1 : 0;
        const rightExact = right === muiComponentName ? 1 : 0;
        if (leftExact !== rightExact) {
          return rightExact - leftExact;
        }
        if (left.length !== right.length) {
          return left.length - right.length;
        }
        return left.localeCompare(right);
      })[0];
      if (!selectedComponent) {
        return undefined;
      }
      return [
        muiComponentName,
        {
          component: selectedComponent
        } satisfies DesignSystemMappingEntry
      ] as const;
    })
    .filter((entry): entry is readonly [string, DesignSystemMappingEntry] => entry !== undefined)
    .sort((left, right) => left[0].localeCompare(right[0]));

  return {
    config: {
      library: selectedLibrary,
      mappings: Object.fromEntries(mappingsEntries)
    },
    scannedFiles: sourceFiles.length,
    selectedLibrary
  };
};

export const writeDesignSystemConfigFile = async ({
  outputFilePath,
  config,
  force
}: {
  outputFilePath: string;
  config: DesignSystemConfig;
  force: boolean;
}): Promise<void> => {
  const resolvedOutputPath = path.resolve(outputFilePath);

  try {
    const existing = await stat(resolvedOutputPath);
    if (existing.isFile() && !force) {
      throw new Error(`Design system config already exists at '${resolvedOutputPath}'. Use --force to overwrite.`);
    }
  } catch (error) {
    const typedError = error as NodeJS.ErrnoException;
    if (typedError.code !== "ENOENT") {
      throw error;
    }
  }

  await mkdir(path.dirname(resolvedOutputPath), { recursive: true });
  const normalizedConfig = {
    library: config.library,
    mappings: Object.fromEntries(
      Object.entries(config.mappings)
        .map(([muiName, mapping]) => [
          muiName,
          {
            ...(mapping.import ? { import: mapping.import } : {}),
            component: mapping.component,
            ...(mapping.propMappings
              ? {
                  propMappings: Object.fromEntries(
                    Object.entries(mapping.propMappings).sort((left, right) => left[0].localeCompare(right[0]))
                  )
                }
              : {})
          }
        ] as const)
        .sort((left, right) => left[0].localeCompare(right[0]))
    )
  } satisfies DesignSystemConfig;

  await writeFile(resolvedOutputPath, `${JSON.stringify(normalizedConfig, null, 2)}\n`, "utf8");
};

export const getDefaultDesignSystemConfigPath = ({
  outputRoot
}: {
  outputRoot: string;
}): string => {
  return path.resolve(outputRoot, "design-system.json");
};
