import path from "node:path";
import { createRequire } from "node:module";
import type * as TypeScript from "typescript";
import { PARITY_WORKFLOW_ERROR_CODES, WorkflowError } from "./workflow-error.js";

let cachedTypescriptModule: typeof TypeScript | null | undefined;
let missingTypescriptWarningEmitted = false;
let resolveTypescriptModuleOverride: (() => typeof TypeScript | null) | undefined;

export const GENERATED_SOURCE_VALIDATION_MISSING_TYPESCRIPT_CODE =
  "WORKSPACE_DEV_MISSING_TYPESCRIPT_VALIDATION";
export const GENERATED_SOURCE_VALIDATION_MISSING_TYPESCRIPT_MESSAGE =
  "Generated source validation is unavailable because the optional 'typescript' runtime is not installed. Generated source files will skip parser validation.";

export interface GeneratedSourceValidationValidatedState {
  status: "validated";
}

export interface GeneratedSourceValidationSkippedState {
  status: "skipped";
  reason: "missing_typescript_runtime";
  code: typeof GENERATED_SOURCE_VALIDATION_MISSING_TYPESCRIPT_CODE;
  message: typeof GENERATED_SOURCE_VALIDATION_MISSING_TYPESCRIPT_MESSAGE;
}

export type GeneratedSourceValidationResult =
  | GeneratedSourceValidationValidatedState
  | GeneratedSourceValidationSkippedState;

export interface GeneratedSourceValidationSkippedSummary
  extends GeneratedSourceValidationSkippedState {
  skippedCount: number;
}

const GENERATED_SOURCE_VALIDATION_VALIDATED_RESULT: GeneratedSourceValidationValidatedState =
  {
    status: "validated"
  };

const GENERATED_SOURCE_VALIDATION_SKIPPED_RESULT: GeneratedSourceValidationSkippedState =
  {
    status: "skipped",
    reason: "missing_typescript_runtime",
    code: GENERATED_SOURCE_VALIDATION_MISSING_TYPESCRIPT_CODE,
    message: GENERATED_SOURCE_VALIDATION_MISSING_TYPESCRIPT_MESSAGE
  };

export const summarizeGeneratedSourceValidationSkips = (
  results: readonly GeneratedSourceValidationSkippedState[]
): GeneratedSourceValidationSkippedSummary | undefined => {
  const [firstResult] = results;
  if (!firstResult) {
    return undefined;
  }
  return {
    ...firstResult,
    skippedCount: results.length
  };
};

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

const getTypescriptValidationRuntime = ():
  | {
      typescriptModule: typeof TypeScript;
      result: GeneratedSourceValidationValidatedState;
    }
  | {
      typescriptModule: null;
      result: GeneratedSourceValidationSkippedState;
    } => {
  const typescriptModule = resolveTypescriptModule();
  if (typescriptModule) {
    return {
      typescriptModule,
      result: GENERATED_SOURCE_VALIDATION_VALIDATED_RESULT
    };
  }
  if (!missingTypescriptWarningEmitted) {
    process.emitWarning(GENERATED_SOURCE_VALIDATION_MISSING_TYPESCRIPT_MESSAGE, {
      code: GENERATED_SOURCE_VALIDATION_MISSING_TYPESCRIPT_CODE
    });
    missingTypescriptWarningEmitted = true;
  }
  return {
    typescriptModule: null,
    result: GENERATED_SOURCE_VALIDATION_SKIPPED_RESULT
  };
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
}): {
  diagnostics: TypeScript.Diagnostic[];
  result: GeneratedSourceValidationResult;
} => {
  const runtime = getTypescriptValidationRuntime();
  if (!runtime.typescriptModule) {
    return {
      diagnostics: [],
      result: runtime.result
    };
  }

  const result = runtime.typescriptModule.transpileModule(sourceText, {
    fileName: filePath,
    reportDiagnostics: true,
    compilerOptions: toCompilerOptions({
      filePath,
      typescriptModule: runtime.typescriptModule,
      ...(forceJsx !== undefined ? { forceJsx } : {})
    })
  });
  return {
    diagnostics: (result.diagnostics ?? []).filter(
      (diagnostic) =>
        diagnostic.category === runtime.typescriptModule.DiagnosticCategory.Error
    ),
    result: runtime.result
  };
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
  const runtime = getTypescriptValidationRuntime();
  if (!runtime.typescriptModule) {
    return [];
  }

  const { diagnostics } = collectErrorDiagnostics({
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
      typescriptModule: runtime.typescriptModule
    })
  );
};

export const validateGeneratedJsxFragment = ({
  raw,
  context
}: {
  raw: string;
  context: GeneratedJsxFragmentValidationContext;
}): GeneratedSourceValidationResult => {
  const runtime = getTypescriptValidationRuntime();
  if (!runtime.typescriptModule) {
    return runtime.result;
  }

  const { diagnostics } = collectErrorDiagnostics({
    sourceText: `${GENERATED_FRAGMENT_PREFIX}\n${raw}\n${GENERATED_FRAGMENT_SUFFIX}\n`,
    filePath: GENERATED_FRAGMENT_FILE_PATH,
    forceJsx: true
  });
  if (diagnostics.length === 0) {
    return runtime.result;
  }
  throw new WorkflowError({
    code: PARITY_WORKFLOW_ERROR_CODES.invalidGeneratedJsxFragment,
    message: `Invalid generated JSX fragment in screen '${context.screenName}' for node '${context.nodeId}' (${context.nodeName}, ${context.nodeType}) during ${context.renderSource}: ${diagnostics
      .map((diagnostic) =>
        formatDiagnostic({
          diagnostic,
          lineOffset: GENERATED_FRAGMENT_LINE_OFFSET,
          filePath: GENERATED_FRAGMENT_FILE_PATH,
          typescriptModule: runtime.typescriptModule
        })
      )
      .join("; ")}`,
    stage: "codegen.generate"
  });
};

export const collectGeneratedSourceFileDiagnostics = ({
  filePath,
  content
}: {
  filePath: string;
  content: string;
}): string[] => {
  const runtime = getTypescriptValidationRuntime();
  if (!runtime.typescriptModule) {
    return [];
  }

  const { diagnostics } = collectErrorDiagnostics({
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
      typescriptModule: runtime.typescriptModule
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
}): GeneratedSourceValidationResult => {
  const runtime = getTypescriptValidationRuntime();
  if (!runtime.typescriptModule) {
    return runtime.result;
  }

  const { diagnostics } = collectErrorDiagnostics({
    sourceText: content,
    filePath
  });
  if (diagnostics.length === 0) {
    return runtime.result;
  }
  const prefix = context?.screenName
    ? `Invalid generated source file '${filePath}' for screen '${context.screenName}'`
    : `Invalid generated source file '${filePath}'`;
  throw new WorkflowError({
    code: PARITY_WORKFLOW_ERROR_CODES.invalidGeneratedSourceFile,
    message: `${prefix}: ${formatDiagnostics({
      diagnostics,
      filePath,
      typescriptModule: runtime.typescriptModule
    })}`,
    stage: "codegen.generate"
  });
};
