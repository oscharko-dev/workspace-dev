import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import type * as TypeScript from "typescript";

export type RetryableValidationStage = "lint" | "typecheck" | "build";

export interface ValidationDiagnostic {
  stage: RetryableValidationStage;
  filePath?: string;
  line?: number;
  column?: number;
  code?: string;
  rule?: string;
  message: string;
}

export interface ValidationFileCorrection {
  filePath: string;
  editCount: number;
  descriptions: string[];
}

export interface ValidationFeedbackResult {
  diagnostics: ValidationDiagnostic[];
  changedFiles: string[];
  correctionsApplied: number;
  fileCorrections: ValidationFileCorrection[];
  summary: string;
}

const SUPPORTED_SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"]);
const MAX_SUMMARY_DIAGNOSTICS = 5;
const MAX_LOGGED_FILE_CORRECTIONS = 20;
const SAFE_CODEFIX_CODES = new Set([
  1003, // Identifier expected
  1005, // ',' expected
  1109, // Expression expected
  1128, // Declaration or statement expected
  2300, // Duplicate identifier
  2304, // Cannot find name
  2552, // Cannot find name, did you mean
  6133, // declared but never read
  6192 // all imports in import declaration are unused
]);

const toPosixPath = (value: string): string => {
  return value.split(path.sep).join("/");
};

const toRelativeProjectPath = ({
  absolutePath,
  generatedProjectDir
}: {
  absolutePath: string;
  generatedProjectDir: string;
}): string => {
  return toPosixPath(path.relative(generatedProjectDir, absolutePath));
};

const toResolvedProjectPath = ({
  filePath,
  generatedProjectDir
}: {
  filePath: string;
  generatedProjectDir: string;
}): string => {
  if (path.isAbsolute(filePath)) {
    return path.normalize(filePath);
  }
  return path.normalize(path.resolve(generatedProjectDir, filePath));
};

const isWithinProjectRoot = ({
  candidatePath,
  generatedProjectDir
}: {
  candidatePath: string;
  generatedProjectDir: string;
}): boolean => {
  const normalizedRoot = path.normalize(generatedProjectDir);
  const normalizedCandidate = path.normalize(candidatePath);
  const relativePath = path.relative(normalizedRoot, normalizedCandidate);
  if (relativePath.length === 0) {
    return true;
  }
  return !relativePath.startsWith("..") && !path.isAbsolute(relativePath);
};

const isSupportedSourceFile = ({ filePath }: { filePath: string }): boolean => {
  return SUPPORTED_SOURCE_EXTENSIONS.has(path.extname(filePath).toLowerCase());
};

const normalizeDiagnosticFilePath = ({
  candidate,
  generatedProjectDir
}: {
  candidate: string;
  generatedProjectDir: string;
}): string | undefined => {
  const trimmed = candidate.trim();
  if (trimmed.length === 0) {
    return undefined;
  }

  const resolved = toResolvedProjectPath({ filePath: trimmed, generatedProjectDir });
  if (!isWithinProjectRoot({ candidatePath: resolved, generatedProjectDir })) {
    return undefined;
  }
  if (!isSupportedSourceFile({ filePath: resolved })) {
    return undefined;
  }
  return resolved;
};

const parseLintDiagnostics = ({
  output,
  generatedProjectDir
}: {
  output: string;
  generatedProjectDir: string;
}): ValidationDiagnostic[] => {
  const lines = output.split(/\r?\n/);
  const diagnostics: ValidationDiagnostic[] = [];
  const fileLineRegex = /^\s*(.+\.(?:[cm]?jsx?|[cm]?tsx?))\s*$/;
  const detailLineRegex = /^\s*(\d+):(\d+)\s+error\s+(.+?)(?:\s{2,}([^\s].+))?\s*$/;
  let currentFile: string | undefined;

  for (const line of lines) {
    const detail = detailLineRegex.exec(line);
    if (detail && currentFile) {
      const lineRaw = detail[1];
      const columnRaw = detail[2];
      const messageRaw = detail[3];
      if (!lineRaw || !columnRaw || !messageRaw) {
        continue;
      }
      diagnostics.push({
        stage: "lint",
        filePath: currentFile,
        line: Number.parseInt(lineRaw, 10),
        column: Number.parseInt(columnRaw, 10),
        message: messageRaw.trim(),
        ...(detail[4] ? { rule: detail[4].trim() } : {})
      });
      continue;
    }

    const fileMatch = fileLineRegex.exec(line);
    if (!fileMatch) {
      continue;
    }
    const normalized = normalizeDiagnosticFilePath({ candidate: fileMatch[1] ?? "", generatedProjectDir });
    if (!normalized) {
      continue;
    }
    currentFile = normalized;
  }

  return diagnostics;
};

const parseTypescriptDiagnostics = ({
  output,
  generatedProjectDir,
  stage
}: {
  output: string;
  generatedProjectDir: string;
  stage: "typecheck" | "build";
}): ValidationDiagnostic[] => {
  const diagnostics: ValidationDiagnostic[] = [];
  const lines = output.split(/\r?\n/);
  const tsRegex = /^(.+?)\((\d+),(\d+)\):\s*error\s+TS(\d+):\s*(.+)$/;

  for (const line of lines) {
    const match = tsRegex.exec(line.trim());
    if (!match) {
      continue;
    }
    const lineRaw = match[2];
    const columnRaw = match[3];
    const codeRaw = match[4];
    const messageRaw = match[5];
    if (!lineRaw || !columnRaw || !codeRaw || !messageRaw) {
      continue;
    }

    const normalizedPath = normalizeDiagnosticFilePath({ candidate: match[1] ?? "", generatedProjectDir });
    if (!normalizedPath) {
      continue;
    }

    diagnostics.push({
      stage,
      filePath: normalizedPath,
      line: Number.parseInt(lineRaw, 10),
      column: Number.parseInt(columnRaw, 10),
      code: `TS${codeRaw}`,
      message: messageRaw.trim()
    });
  }

  return diagnostics;
};

const parseBuildDiagnostics = ({
  output,
  generatedProjectDir
}: {
  output: string;
  generatedProjectDir: string;
}): ValidationDiagnostic[] => {
  const diagnostics = parseTypescriptDiagnostics({ output, generatedProjectDir, stage: "build" });
  const lines = output.split(/\r?\n/);
  const esbuildRegex = /^(.+?):(\d+):(\d+):\s+ERROR:\s+(.+)$/;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    const match = esbuildRegex.exec(line);
    if (!match) {
      continue;
    }
    const lineRaw = match[2];
    const columnRaw = match[3];
    const messageRaw = match[4];
    if (!lineRaw || !columnRaw || !messageRaw) {
      continue;
    }
    const normalizedPath = normalizeDiagnosticFilePath({ candidate: match[1] ?? "", generatedProjectDir });
    if (!normalizedPath) {
      continue;
    }

    diagnostics.push({
      stage: "build",
      filePath: normalizedPath,
      line: Number.parseInt(lineRaw, 10),
      column: Number.parseInt(columnRaw, 10),
      message: messageRaw.trim()
    });
  }

  return diagnostics;
};

export const parseValidationDiagnostics = ({
  stage,
  output,
  generatedProjectDir
}: {
  stage: RetryableValidationStage;
  output: string;
  generatedProjectDir: string;
}): ValidationDiagnostic[] => {
  if (stage === "lint") {
    return parseLintDiagnostics({ output, generatedProjectDir });
  }
  if (stage === "typecheck") {
    return parseTypescriptDiagnostics({ output, generatedProjectDir, stage: "typecheck" });
  }
  return parseBuildDiagnostics({ output, generatedProjectDir });
};

const toDiagnosticSummary = ({
  diagnostics,
  generatedProjectDir
}: {
  diagnostics: ValidationDiagnostic[];
  generatedProjectDir: string;
}): string => {
  if (diagnostics.length === 0) {
    return "No structured diagnostics parsed from command output.";
  }

  const formatted = diagnostics.slice(0, MAX_SUMMARY_DIAGNOSTICS).map((diagnostic) => {
    const location =
      diagnostic.filePath && diagnostic.line && diagnostic.column
        ? `${toRelativeProjectPath({ absolutePath: diagnostic.filePath, generatedProjectDir })}:${diagnostic.line}:${diagnostic.column}`
        : diagnostic.filePath
          ? toRelativeProjectPath({ absolutePath: diagnostic.filePath, generatedProjectDir })
          : "unknown";
    const codeOrRule = diagnostic.code ?? diagnostic.rule ?? "validation";
    return `[${codeOrRule}] ${location} ${diagnostic.message}`;
  });

  const overflow = diagnostics.length - formatted.length;
  if (overflow > 0) {
    formatted.push(`(+${overflow} more diagnostics)`);
  }
  return formatted.join(" | ");
};

const loadProjectTypescript = ({ generatedProjectDir }: { generatedProjectDir: string }): typeof TypeScript | undefined => {
  try {
    const requireFromProject = createRequire(path.join(generatedProjectDir, "package.json"));
    const loaded = requireFromProject("typescript") as typeof TypeScript;
    if (typeof loaded.createLanguageService !== "function") {
      return undefined;
    }
    return loaded;
  } catch {
    return undefined;
  }
};

const toLanguageService = ({
  ts,
  generatedProjectDir
}: {
  ts: typeof TypeScript;
  generatedProjectDir: string;
}): {
  languageService: TypeScript.LanguageService;
  dispose: () => void;
  fileNames: string[];
} | null => {
  const fileExists = (filePath: string): boolean => ts.sys.fileExists(filePath);
  const readFile = (filePath: string): string | undefined => ts.sys.readFile(filePath);
  const readDirectory = (
    rootDir: string,
    extensions: readonly string[] | undefined,
    excludes: readonly string[] | undefined,
    includes: readonly string[] | undefined,
    depth?: number
  ): string[] => ts.sys.readDirectory(rootDir, extensions, excludes, includes, depth);
  const directoryExists = (directoryPath: string): boolean => ts.sys.directoryExists(directoryPath);
  const getDirectories = (directoryPath: string): string[] => ts.sys.getDirectories(directoryPath);

  const configPath = ts.findConfigFile(generatedProjectDir, fileExists, "tsconfig.json");
  if (!configPath) {
    return null;
  }

  const configFile = ts.readConfigFile(configPath, readFile);
  if (configFile.error) {
    return null;
  }

  const parsed = ts.parseJsonConfigFileContent(
    configFile.config,
    {
      ...ts.sys,
      fileExists,
      readFile,
      readDirectory,
      directoryExists,
      getDirectories
    },
    path.dirname(configPath),
    undefined,
    configPath
  );
  if (parsed.errors.length > 0) {
    return null;
  }

  const normalizedFileNames = parsed.fileNames.map((fileName) => path.normalize(fileName));
  const fileVersionByPath = new Map<string, number>();
  for (const fileName of normalizedFileNames) {
    fileVersionByPath.set(fileName, 0);
  }

  const host: TypeScript.LanguageServiceHost = {
    getCompilationSettings: () => parsed.options,
    getScriptFileNames: () => normalizedFileNames,
    getScriptVersion: (fileName) => String(fileVersionByPath.get(path.normalize(fileName)) ?? 0),
    getScriptSnapshot: (fileName) => {
      const normalized = path.normalize(fileName);
      if (!fileExists(normalized)) {
        return undefined;
      }
      const content = readFile(normalized);
      if (content === undefined) {
        return undefined;
      }
      return ts.ScriptSnapshot.fromString(content);
    },
    getCurrentDirectory: () => generatedProjectDir,
    getDefaultLibFileName: (options) => ts.getDefaultLibFilePath(options),
    fileExists,
    readFile,
    readDirectory,
    directoryExists,
    getDirectories
  };

  const languageService = ts.createLanguageService(host, ts.createDocumentRegistry());
  return {
    languageService,
    dispose: () => languageService.dispose(),
    fileNames: normalizedFileNames
  };
};

const toPosition = ({
  sourceFile,
  line,
  column
}: {
  sourceFile: TypeScript.SourceFile;
  line: number;
  column: number;
}): number => {
  const normalizedLine = Math.max(0, line - 1);
  const normalizedColumn = Math.max(0, column - 1);
  const lineStarts = sourceFile.getLineStarts();
  if (lineStarts.length === 0) {
    return 0;
  }

  const maxLineIndex = lineStarts.length - 1;
  const lineIndex = Math.min(normalizedLine, maxLineIndex);
  const lineStart = lineStarts[lineIndex] ?? 0;
  const nextLineStart = lineIndex + 1 < lineStarts.length ? (lineStarts[lineIndex + 1] ?? sourceFile.end) : sourceFile.end;
  const maxColumnPosition = Math.max(lineStart, nextLineStart - 1);
  const position = lineStart + normalizedColumn;
  return Math.max(0, Math.min(position, maxColumnPosition));
};

const dedupeTextChanges = ({
  textChanges
}: {
  textChanges: TypeScript.TextChange[];
}): TypeScript.TextChange[] => {
  const seen = new Set<string>();
  const unique: TypeScript.TextChange[] = [];

  for (const textChange of textChanges) {
    const key = `${textChange.span.start}:${textChange.span.length}:${textChange.newText}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    unique.push(textChange);
  }

  unique.sort((first, second) => second.span.start - first.span.start);
  return unique;
};

const applyTextChanges = ({
  source,
  textChanges
}: {
  source: string;
  textChanges: TypeScript.TextChange[];
}): string => {
  let content = source;
  for (const textChange of textChanges) {
    const start = textChange.span.start;
    const end = textChange.span.start + textChange.span.length;
    content = `${content.slice(0, start)}${textChange.newText}${content.slice(end)}`;
  }
  return content;
};

const applyFileTextChanges = async ({
  fileChanges,
  generatedProjectDir,
  description,
  correctionMap
}: {
  fileChanges: readonly TypeScript.FileTextChanges[];
  generatedProjectDir: string;
  description: string;
  correctionMap: Map<string, { editCount: number; descriptions: Set<string> }>;
}): Promise<number> => {
  const changesByFile = new Map<string, TypeScript.TextChange[]>();

  for (const fileChange of fileChanges) {
    const normalizedFilePath = path.normalize(fileChange.fileName);
    if (!isWithinProjectRoot({ candidatePath: normalizedFilePath, generatedProjectDir })) {
      continue;
    }
    if (!isSupportedSourceFile({ filePath: normalizedFilePath })) {
      continue;
    }
    const existing = changesByFile.get(normalizedFilePath) ?? [];
    existing.push(...fileChange.textChanges);
    changesByFile.set(normalizedFilePath, existing);
  }

  let editsApplied = 0;
  for (const [filePath, rawTextChanges] of changesByFile.entries()) {
    const uniqueChanges = dedupeTextChanges({ textChanges: rawTextChanges });
    if (uniqueChanges.length === 0) {
      continue;
    }

    const existingContent = await readFile(filePath, "utf8");
    const nextContent = applyTextChanges({ source: existingContent, textChanges: uniqueChanges });
    if (nextContent === existingContent) {
      continue;
    }

    await writeFile(filePath, nextContent, "utf8");
    editsApplied += uniqueChanges.length;

    const entry = correctionMap.get(filePath) ?? { editCount: 0, descriptions: new Set<string>() };
    entry.editCount += uniqueChanges.length;
    entry.descriptions.add(description);
    correctionMap.set(filePath, entry);
  }

  return editsApplied;
};

const toFileCandidates = ({
  diagnostics,
  generatedProjectDir,
  fallbackFileNames
}: {
  diagnostics: ValidationDiagnostic[];
  generatedProjectDir: string;
  fallbackFileNames: string[];
}): string[] => {
  const candidateSet = new Set<string>();

  for (const diagnostic of diagnostics) {
    if (!diagnostic.filePath) {
      continue;
    }
    if (!isWithinProjectRoot({ candidatePath: diagnostic.filePath, generatedProjectDir })) {
      continue;
    }
    if (!isSupportedSourceFile({ filePath: diagnostic.filePath })) {
      continue;
    }
    candidateSet.add(path.normalize(diagnostic.filePath));
  }

  if (candidateSet.size > 0) {
    return [...candidateSet].sort((first, second) => first.localeCompare(second));
  }

  return fallbackFileNames
    .filter((fileName) => isWithinProjectRoot({ candidatePath: fileName, generatedProjectDir }))
    .filter((fileName) => isSupportedSourceFile({ filePath: fileName }))
    .sort((first, second) => first.localeCompare(second));
};

const toFileCorrections = ({
  correctionMap,
  generatedProjectDir
}: {
  correctionMap: Map<string, { editCount: number; descriptions: Set<string> }>;
  generatedProjectDir: string;
}): ValidationFileCorrection[] => {
  return [...correctionMap.entries()]
    .map(([filePath, value]) => {
      return {
        filePath,
        editCount: value.editCount,
        descriptions: [...value.descriptions].sort((first, second) => first.localeCompare(second))
      };
    })
    .sort((first, second) => first.filePath.localeCompare(second.filePath))
    .map((entry) => ({
      ...entry,
      filePath: toRelativeProjectPath({ absolutePath: entry.filePath, generatedProjectDir })
    }));
};

const extractNumericCode = ({ code }: { code: string | undefined }): number | undefined => {
  if (!code) {
    return undefined;
  }
  const normalized = code.trim().toUpperCase().startsWith("TS") ? code.trim().slice(2) : code.trim();
  const numeric = Number.parseInt(normalized, 10);
  if (!Number.isFinite(numeric)) {
    return undefined;
  }
  return numeric;
};

export const runValidationFeedback = async ({
  generatedProjectDir,
  stage,
  output,
  onLog
}: {
  generatedProjectDir: string;
  stage: RetryableValidationStage;
  output: string;
  onLog: (message: string) => void;
}): Promise<ValidationFeedbackResult> => {
  const diagnostics = parseValidationDiagnostics({ stage, output, generatedProjectDir });
  const summary = toDiagnosticSummary({ diagnostics, generatedProjectDir });

  const typescript = loadProjectTypescript({ generatedProjectDir });
  if (!typescript) {
    onLog("Validation feedback skipped: generated project does not provide a local TypeScript runtime.");
    return {
      diagnostics,
      changedFiles: [],
      correctionsApplied: 0,
      fileCorrections: [],
      summary
    };
  }

  const language = toLanguageService({ ts: typescript, generatedProjectDir });
  if (!language) {
    onLog("Validation feedback skipped: unable to initialize TypeScript language service from generated project.");
    return {
      diagnostics,
      changedFiles: [],
      correctionsApplied: 0,
      fileCorrections: [],
      summary
    };
  }

  const correctionMap = new Map<string, { editCount: number; descriptions: Set<string> }>();
  const formatOptions = typescript.getDefaultFormatCodeSettings();
  const preferences: TypeScript.UserPreferences = {
    allowTextChangesInNewFiles: false,
    includePackageJsonAutoImports: "off"
  };

  const candidateFiles = toFileCandidates({
    diagnostics,
    generatedProjectDir,
    fallbackFileNames: language.fileNames
  });

  let correctionsApplied = 0;

  const program = language.languageService.getProgram();
  if (program) {
    for (const diagnostic of diagnostics) {
      if (!diagnostic.filePath || !diagnostic.line || !diagnostic.column) {
        continue;
      }
      const numericCode = extractNumericCode({ code: diagnostic.code });
      if (numericCode === undefined || !SAFE_CODEFIX_CODES.has(numericCode)) {
        continue;
      }
      if (!candidateFiles.includes(path.normalize(diagnostic.filePath))) {
        continue;
      }

      const sourceFile = program.getSourceFile(path.normalize(diagnostic.filePath));
      if (!sourceFile) {
        continue;
      }

      const position = toPosition({
        sourceFile,
        line: diagnostic.line,
        column: diagnostic.column
      });

      const fixes = language.languageService.getCodeFixesAtPosition(
        path.normalize(diagnostic.filePath),
        position,
        position,
        [numericCode],
        formatOptions,
        preferences
      );

      if (fixes.length === 0) {
        continue;
      }

      for (const fix of fixes) {
        correctionsApplied += await applyFileTextChanges({
          fileChanges: fix.changes,
          generatedProjectDir,
          description: fix.description,
          correctionMap
        });
      }
    }
  }

  language.dispose();

  const languageForImports = toLanguageService({ ts: typescript, generatedProjectDir });
  if (languageForImports) {
    for (const filePath of candidateFiles) {
      const importChanges = languageForImports.languageService.organizeImports(
        { type: "file", fileName: filePath },
        formatOptions,
        preferences
      );
      correctionsApplied += await applyFileTextChanges({
        fileChanges: importChanges,
        generatedProjectDir,
        description: "Organized imports",
        correctionMap
      });
    }
    languageForImports.dispose();
  }

  const fileCorrections = toFileCorrections({ correctionMap, generatedProjectDir });
  for (const fileCorrection of fileCorrections.slice(0, MAX_LOGGED_FILE_CORRECTIONS)) {
    onLog(
      `Auto-correction ${fileCorrection.filePath}: ${fileCorrection.editCount} edit(s) (${fileCorrection.descriptions.join(", "
      )})`
    );
  }
  if (fileCorrections.length > MAX_LOGGED_FILE_CORRECTIONS) {
    onLog(`Auto-correction: +${fileCorrections.length - MAX_LOGGED_FILE_CORRECTIONS} additional file(s) updated.`);
  }

  return {
    diagnostics,
    changedFiles: fileCorrections.map((entry) => entry.filePath),
    correctionsApplied,
    fileCorrections,
    summary
  };
};
