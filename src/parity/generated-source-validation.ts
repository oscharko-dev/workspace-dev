import path from "node:path";
import { createRequire } from "node:module";
import type * as TypeScript from "typescript";

let cachedTypescriptModule: typeof TypeScript | null | undefined;
let missingTypescriptWarningEmitted = false;
let resolveTypescriptModuleOverride: (() => typeof TypeScript | null) | undefined;

export const __setTypescriptModuleResolverForTests = (
  resolver?: (() => typeof TypeScript | null)
): void => {
  resolveTypescriptModuleOverride = resolver;
  cachedTypescriptModule = undefined;
  missingTypescriptWarningEmitted = false;
};

export const __resetTypescriptModuleResolverForTests = (): void => {
  __setTypescriptModuleResolverForTests(undefined);
};

const resolveTypescriptModule = (): typeof TypeScript | null => {
  if (resolveTypescriptModuleOverride) {
    return resolveTypescriptModuleOverride();
  }
  if (cachedTypescriptModule !== undefined) {
    return cachedTypescriptModule;
  }

  try {
    const requireFromModule = createRequire(import.meta.url);
    cachedTypescriptModule = requireFromModule("typescript") as typeof TypeScript;
  } catch {
    cachedTypescriptModule = null;
  }

  return cachedTypescriptModule;
};

const getTypescriptModule = (): typeof TypeScript | null => {
  const typescriptModule = resolveTypescriptModule();
  if (typescriptModule || missingTypescriptWarningEmitted) {
    return typescriptModule;
  }

  process.emitWarning(
    "Generated source validation is unavailable because the optional 'typescript' runtime is not installed. Generated source files will skip parser validation.",
    {
      code: "WORKSPACE_DEV_MISSING_TYPESCRIPT_VALIDATION"
    }
  );
  missingTypescriptWarningEmitted = true;
  return null;
};

const toCompilerOptions = ({
  filePath,
  forceJsx,
  typescriptModule
}: {
  filePath: string;
  forceJsx?: boolean;
  typescriptModule: typeof TypeScript;
}): TypeScript.CompilerOptions => {
  const compilerOptions: TypeScript.CompilerOptions = {
    target: typescriptModule.ScriptTarget.ES2023,
    module: typescriptModule.ModuleKind.NodeNext,
    moduleResolution: typescriptModule.ModuleResolutionKind.NodeNext,
    isolatedModules: true,
    verbatimModuleSyntax: true
  };
  if (forceJsx || path.extname(filePath).toLowerCase() === ".tsx") {
    compilerOptions.jsx = typescriptModule.JsxEmit.ReactJSX;
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
}): TypeScript.Diagnostic[] => {
  const typescriptModule = getTypescriptModule();
  if (!typescriptModule) {
    return [];
  }

  const result = typescriptModule.transpileModule(sourceText, {
    fileName: filePath,
    reportDiagnostics: true,
    compilerOptions: toCompilerOptions({
      filePath,
      typescriptModule,
      ...(forceJsx !== undefined ? { forceJsx } : {})
    })
  });
  return (result.diagnostics ?? []).filter(
    (diagnostic) => diagnostic.category === typescriptModule.DiagnosticCategory.Error
  );
};

const formatDiagnostic = ({
  diagnostic,
  lineOffset,
  filePath,
  typescriptModule
}: {
  diagnostic: TypeScript.Diagnostic;
  lineOffset?: number;
  filePath: string;
  typescriptModule: typeof TypeScript;
}): string => {
  const message = typescriptModule.flattenDiagnosticMessageText(diagnostic.messageText, "\n");
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
  filePath,
  typescriptModule
}: {
  diagnostics: TypeScript.Diagnostic[];
  lineOffset?: number;
  filePath: string;
  typescriptModule: typeof TypeScript;
}): string => {
  return diagnostics
    .map((diagnostic) =>
      formatDiagnostic({
        diagnostic,
        filePath,
        typescriptModule,
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
  const typescriptModule = getTypescriptModule();
  if (!typescriptModule) {
    return [];
  }

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
      filePath: GENERATED_FRAGMENT_FILE_PATH,
      typescriptModule
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
  const typescriptModule = getTypescriptModule();
  if (!typescriptModule) {
    return [];
  }

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
      filePath,
      typescriptModule
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
  const typescriptModule = getTypescriptModule();
  if (!typescriptModule) {
    return;
  }

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
      filePath,
      typescriptModule
    })}`
  );
};
