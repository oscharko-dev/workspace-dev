import assert from "node:assert/strict";
import test, { afterEach } from "node:test";
import type * as TypeScript from "typescript";
import {
  __resetTypescriptModuleResolverForTests,
  __setTypescriptModuleResolverForTests,
  collectGeneratedSourceFileDiagnostics,
  collectGeneratedJsxFragmentDiagnostics,
  GENERATED_SOURCE_VALIDATION_MISSING_TYPESCRIPT_CODE,
  GENERATED_SOURCE_VALIDATION_MISSING_TYPESCRIPT_MESSAGE,
  validateGeneratedJsxFragment,
  validateGeneratedSourceFile
} from "./generated-source-validation.js";
import {
  PARITY_WORKFLOW_ERROR_CODES,
  WorkflowError
} from "./workflow-error.js";

afterEach(() => {
  __resetTypescriptModuleResolverForTests();
});

const createStubTypescriptModule = ({
  diagnostics
}: {
  diagnostics?: TypeScript.Diagnostic[];
}): typeof TypeScript =>
  ({
    ScriptTarget: {
      ES2023: 99
    },
    ModuleKind: {
      NodeNext: 99
    },
    ModuleResolutionKind: {
      NodeNext: 99
    },
    JsxEmit: {
      ReactJSX: 99
    },
    DiagnosticCategory: {
      Error: 1
    },
    transpileModule: () => ({
      diagnostics
    }),
    flattenDiagnosticMessageText: (messageText: string | { messageText: string }) =>
      typeof messageText === "string" ? messageText : messageText.messageText
  }) as unknown as typeof TypeScript;

test("validateGeneratedJsxFragment accepts multiple sibling roots in a valid JSX context", () => {
  assert.deepEqual(
    validateGeneratedJsxFragment({
      raw: "      <AppBar />\n      <Stack />",
      context: {
        screenName: "Sample Screen",
        nodeId: "node-1",
        nodeName: "Header",
        nodeType: "appbar",
        renderSource: "render strategy 'appbar'"
      }
    }),
    { status: "validated" }
  );
});

test("validateGeneratedJsxFragment rejects stray closing tags with node context", () => {
  assert.throws(
    () => {
      validateGeneratedJsxFragment({
        raw: "      </AppBar>",
        context: {
          screenName: "Broken Screen",
          nodeId: "node-2",
          nodeName: "Broken Header",
          nodeType: "appbar",
          renderSource: "pre-dispatch strategy"
        }
      });
    },
    (error: unknown) => {
      assert.equal(error instanceof WorkflowError, true);
      assert.equal(
        (error as WorkflowError).code,
        PARITY_WORKFLOW_ERROR_CODES.invalidGeneratedJsxFragment
      );
      assert.match(
        (error as WorkflowError).message,
        /Invalid generated JSX fragment in screen 'Broken Screen' for node 'node-2' \(Broken Header, appbar\) during pre-dispatch strategy: __generated_fragment__\.tsx:1:\d+ - Expected corresponding closing tag for JSX fragment\./
      );
      return true;
    }
  );
});

test("collectGeneratedJsxFragmentDiagnostics reports mismatched JSX pairs relative to the fragment", () => {
  const diagnostics = collectGeneratedJsxFragmentDiagnostics({
    raw: "      <Box>\n        </Stack>\n      </Box>"
  });
  assert.equal(diagnostics.length > 0, true);
  assert.match(diagnostics.join("; "), /__generated_fragment__\.tsx:2:\d+ -/);
});

test("validateGeneratedSourceFile rejects malformed TSX modules with file path context", () => {
  assert.throws(
    () => {
      validateGeneratedSourceFile({
        filePath: "src/screens/Broken.tsx",
        content: `export default function BrokenScreen() {\n  return (\n    <Box>\n  );\n}\n`
      });
    },
    (error: unknown) => {
      assert.equal(error instanceof WorkflowError, true);
      assert.equal(
        (error as WorkflowError).code,
        PARITY_WORKFLOW_ERROR_CODES.invalidGeneratedSourceFile
      );
      assert.match(
        (error as WorkflowError).message,
        /Invalid generated source file 'src\/screens\/Broken\.tsx': src\/screens\/Broken\.tsx:\d+:\d+ - JSX element 'Box' has no corresponding closing tag\./
      );
      return true;
    }
  );
});

test("collectGeneratedSourceFileDiagnostics returns an empty list for valid TypeScript modules", () => {
  const diagnostics = collectGeneratedSourceFileDiagnostics({
    filePath: "src/screens/Valid.ts",
    content: "export const answer = 42;\n"
  });

  assert.deepEqual(diagnostics, []);
});

test("collectGeneratedSourceFileDiagnostics reports malformed TypeScript modules with file path context", () => {
  const diagnostics = collectGeneratedSourceFileDiagnostics({
    filePath: "src/screens/Broken.ts",
    content: "export const broken = ;\n"
  });

  assert.equal(diagnostics.length > 0, true);
  assert.match(
    diagnostics.join("; "),
    /src\/screens\/Broken\.ts:\d+:\d+ - Expression expected\./
  );
});

test("validateGeneratedSourceFile includes screen context when provided", () => {
  assert.throws(
    () => {
      validateGeneratedSourceFile({
        filePath: "src/screens/Checkout.tsx",
        content: `export default function CheckoutScreen() {\n  return (\n    <Stack>\n  );\n}\n`,
        context: {
          screenName: "Checkout"
        }
      });
    },
    (error: unknown) => {
      assert.equal(error instanceof WorkflowError, true);
      assert.equal(
        (error as WorkflowError).code,
        PARITY_WORKFLOW_ERROR_CODES.invalidGeneratedSourceFile
      );
      assert.match(
        (error as WorkflowError).message,
        /Invalid generated source file 'src\/screens\/Checkout\.tsx' for screen 'Checkout': src\/screens\/Checkout\.tsx:\d+:\d+ - JSX element 'Stack' has no corresponding closing tag\./
      );
      return true;
    }
  );
});

test("generated source validation skips parser checks and warns once when the optional TypeScript runtime is unavailable", () => {
  __setTypescriptModuleResolverForTests(() => null);
  const warnings: Array<{ message: string; code?: string }> = [];
  const emitWarningMock = test.mock.method(
    process,
    "emitWarning",
    (warning: string | Error, options?: { code?: string }) => {
      warnings.push({
        message: String(warning),
        code: options?.code
      });
    }
  );

  try {
    assert.deepEqual(
      collectGeneratedSourceFileDiagnostics({
        filePath: "src/screens/MissingRuntime.ts",
        content: "export const broken = ;\n"
      }),
      []
    );
    assert.deepEqual(
      collectGeneratedJsxFragmentDiagnostics({
        raw: "</Stack>"
      }),
      []
    );
    assert.deepEqual(
      validateGeneratedSourceFile({
        filePath: "src/screens/MissingRuntime.tsx",
        content: `export default function MissingRuntimeScreen() {\n  return (\n    <Stack>\n  );\n}\n`
      }),
      {
        status: "skipped",
        reason: "missing_typescript_runtime",
        code: GENERATED_SOURCE_VALIDATION_MISSING_TYPESCRIPT_CODE,
        message: GENERATED_SOURCE_VALIDATION_MISSING_TYPESCRIPT_MESSAGE
      }
    );
    assert.deepEqual(
      validateGeneratedJsxFragment({
        raw: "</Stack>",
        context: {
          screenName: "Missing Runtime Screen",
          nodeId: "node-missing-runtime",
          nodeName: "Broken Node",
          nodeType: "stack",
          renderSource: "test"
        }
      }),
      {
        status: "skipped",
        reason: "missing_typescript_runtime",
        code: GENERATED_SOURCE_VALIDATION_MISSING_TYPESCRIPT_CODE,
        message: GENERATED_SOURCE_VALIDATION_MISSING_TYPESCRIPT_MESSAGE
      }
    );

    assert.equal(warnings.length, 1);
    assert.equal(
      warnings[0]?.message.includes("optional 'typescript' runtime is not installed"),
      true
    );
    assert.equal(warnings[0]?.code, "WORKSPACE_DEV_MISSING_TYPESCRIPT_VALIDATION");
  } finally {
    emitWarningMock.mock.restore();
  }
});

test("collectGeneratedSourceFileDiagnostics tolerates transpile results without diagnostics", () => {
  __setTypescriptModuleResolverForTests(() =>
    createStubTypescriptModule({
      diagnostics: undefined
    })
  );

  assert.deepEqual(
    collectGeneratedSourceFileDiagnostics({
      filePath: "src/screens/NoDiagnostics.ts",
      content: "export const answer = 42;\n"
    }),
    []
  );
});

test("collectGeneratedSourceFileDiagnostics formats diagnostics without file positions deterministically", () => {
  __setTypescriptModuleResolverForTests(() =>
    createStubTypescriptModule({
      diagnostics: [
        {
          category: 1,
          messageText: "Synthetic parse failure"
        } as TypeScript.Diagnostic
      ]
    })
  );

  assert.deepEqual(
    collectGeneratedSourceFileDiagnostics({
      filePath: "src/screens/Synthetic.ts",
      content: "export const broken = ;\n"
    }),
    ["src/screens/Synthetic.ts - Synthetic parse failure"]
  );
});
