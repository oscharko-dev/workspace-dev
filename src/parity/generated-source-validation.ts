import path from "node:path";
import ts from "typescript";

const GENERATED_SOURCE_COMPILER_OPTIONS: ts.CompilerOptions = {
  target: ts.ScriptTarget.ES2023,
  module: ts.ModuleKind.NodeNext,
  moduleResolution: ts.ModuleResolutionKind.NodeNext,
  isolatedModules: true,
  verbatimModuleSyntax: true
};

const toCompilerOptions = ({
  filePath,
  forceJsx
}: {
  filePath: string;
  forceJsx?: boolean;
}): ts.CompilerOptions => {
  const compilerOptions: ts.CompilerOptions = {
    ...GENERATED_SOURCE_COMPILER_OPTIONS
  };
  if (forceJsx || path.extname(filePath).toLowerCase() === ".tsx") {
    compilerOptions.jsx = ts.JsxEmit.ReactJSX;
  }
  return compilerOptions;
};

const collectErrorDiagnostics = ({
  sourceText,
  filePath,
  forceJsx
}: {
  sourceText: string;
  filePath: string;
  forceJsx?: boolean;
}): ts.Diagnostic[] => {
  const result = ts.transpileModule(sourceText, {
    fileName: filePath,
    reportDiagnostics: true,
    compilerOptions: toCompilerOptions({
      filePath,
      ...(forceJsx !== undefined ? { forceJsx } : {})
    })
  });
  return (result.diagnostics ?? []).filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error);
};

const formatDiagnostic = ({
  diagnostic,
  lineOffset,
  filePath
}: {
  diagnostic: ts.Diagnostic;
  lineOffset?: number;
  filePath: string;
}): string => {
  const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n");
  if (!diagnostic.file || diagnostic.start === undefined) {
    return `${filePath} - ${message}`;
  }
  const { line, character } = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start);
  const adjustedLine = Math.max(1, line + 1 - (lineOffset ?? 0));
  return `${filePath}:${adjustedLine}:${character + 1} - ${message}`;
};

const formatDiagnostics = ({
  diagnostics,
  lineOffset,
  filePath
}: {
  diagnostics: ts.Diagnostic[];
  lineOffset?: number;
  filePath: string;
}): string => {
  return diagnostics
    .map((diagnostic) =>
      formatDiagnostic({
        diagnostic,
        filePath,
        ...(lineOffset !== undefined ? { lineOffset } : {})
      })
    )
    .join("; ");
};

export interface GeneratedJsxFragmentValidationContext {
  screenName: string;
  nodeId: string;
  nodeName: string;
  nodeType: string;
  renderSource: string;
}

export interface GeneratedSourceFileValidationContext {
  screenName?: string;
}

const GENERATED_FRAGMENT_FILE_PATH = "__generated_fragment__.tsx";
const GENERATED_FRAGMENT_PREFIX = [
  "export default function __GeneratedFragmentValidation() {",
  "  return (",
  "    <>"
].join("\n");
const GENERATED_FRAGMENT_SUFFIX = [
  "    </>",
  "  );",
  "}"
].join("\n");
const GENERATED_FRAGMENT_LINE_OFFSET = 3;

export const collectGeneratedJsxFragmentDiagnostics = ({
  raw
}: {
  raw: string;
}): string[] => {
  const diagnostics = collectErrorDiagnostics({
    sourceText: `${GENERATED_FRAGMENT_PREFIX}\n${raw}\n${GENERATED_FRAGMENT_SUFFIX}\n`,
    filePath: GENERATED_FRAGMENT_FILE_PATH,
    forceJsx: true
  });
  if (diagnostics.length === 0) {
    return [];
  }
  return diagnostics.map((diagnostic) =>
    formatDiagnostic({
      diagnostic,
      lineOffset: GENERATED_FRAGMENT_LINE_OFFSET,
      filePath: GENERATED_FRAGMENT_FILE_PATH
    })
  );
};

export const validateGeneratedJsxFragment = ({
  raw,
  context
}: {
  raw: string;
  context: GeneratedJsxFragmentValidationContext;
}): void => {
  const diagnostics = collectGeneratedJsxFragmentDiagnostics({
    raw
  });
  if (diagnostics.length === 0) {
    return;
  }
  throw new Error(
    `Invalid generated JSX fragment in screen '${context.screenName}' for node '${context.nodeId}' (${context.nodeName}, ${context.nodeType}) during ${context.renderSource}: ${diagnostics.join("; ")}`
  );
};

export const collectGeneratedSourceFileDiagnostics = ({
  filePath,
  content
}: {
  filePath: string;
  content: string;
}): string[] => {
  const diagnostics = collectErrorDiagnostics({
    sourceText: content,
    filePath
  });
  if (diagnostics.length === 0) {
    return [];
  }
  return diagnostics.map((diagnostic) =>
    formatDiagnostic({
      diagnostic,
      filePath
    })
  );
};

export const validateGeneratedSourceFile = ({
  filePath,
  content,
  context
}: {
  filePath: string;
  content: string;
  context?: GeneratedSourceFileValidationContext;
}): void => {
  const diagnostics = collectErrorDiagnostics({
    sourceText: content,
    filePath
  });
  if (diagnostics.length === 0) {
    return;
  }
  const prefix = context?.screenName
    ? `Invalid generated source file '${filePath}' for screen '${context.screenName}'`
    : `Invalid generated source file '${filePath}'`;
  throw new Error(
    `${prefix}: ${formatDiagnostics({
      diagnostics,
      filePath
    })}`
  );
};
