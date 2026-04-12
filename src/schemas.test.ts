import assert from "node:assert/strict";
import test from "node:test";
import {
  CreatePrRequestSchema,
  ErrorResponseSchema,
  RegenerationRequestSchema,
  SubmitRequestSchema,
  SyncRequestSchema,
  WorkspaceStatusSchema,
  formatZodError
} from "./schemas.js";

// ---------------------------------------------------------------------------
// SubmitRequestSchema
// ---------------------------------------------------------------------------

test("schema: valid submit body parses correctly", () => {
  const result = SubmitRequestSchema.safeParse({
    figmaFileKey: "abc123",
    figmaAccessToken: "figd_xxx",
    storybookStaticDir: " ./storybook-static/customer ",
    customerProfilePath: " ./profiles/acme.json ",
    customerBrandId: " sparkasse-retail ",
    brandTheme: " Sparkasse ",
    generationLocale: "en-US",
    formHandlingMode: " react_hook_form ",
    figmaSourceMode: "rest",
    llmCodegenMode: "deterministic"
  });
  assert.equal(result.success, true);
  if (result.success) {
    assert.equal(result.data.figmaFileKey, "abc123");
    assert.equal(result.data.storybookStaticDir, "./storybook-static/customer");
    assert.equal(result.data.customerProfilePath, "./profiles/acme.json");
    assert.equal(result.data.customerBrandId, "sparkasse-retail");
    assert.equal(result.data.brandTheme, "sparkasse");
    assert.equal(result.data.generationLocale, "en-US");
    assert.equal(result.data.formHandlingMode, "react_hook_form");
    assert.equal(result.data.figmaSourceMode, "rest");
    assert.equal(result.data.llmCodegenMode, "deterministic");
    assert.equal(result.data.enableGitPr, false);
  }
});

test("schema: valid submit body accepts exact and pattern componentMappings", () => {
  const result = SubmitRequestSchema.safeParse({
    figmaFileKey: "abc123",
    figmaAccessToken: "figd_xxx",
    componentMappings: [
      {
        boardKey: " board-1 ",
        nodeId: " button-node-1 ",
        componentName: " ManualButton ",
        importPath: " @manual/ui ",
        priority: 1,
        source: "local_override",
        enabled: true
      },
      {
        boardKey: " board-1 ",
        canonicalComponentName: " Button ",
        storybookTier: " Components ",
        componentName: " PatternButton ",
        importPath: " @pattern/ui ",
        priority: 2,
        source: "code_connect_import",
        enabled: false
      }
    ]
  });

  assert.equal(result.success, true);
  if (result.success) {
    assert.deepEqual(result.data.componentMappings, [
      {
        boardKey: "board-1",
        nodeId: "button-node-1",
        componentName: "ManualButton",
        importPath: "@manual/ui",
        priority: 1,
        source: "local_override",
        enabled: true
      },
      {
        boardKey: "board-1",
        canonicalComponentName: "Button",
        storybookTier: "Components",
        componentName: "PatternButton",
        importPath: "@pattern/ui",
        priority: 2,
        source: "code_connect_import",
        enabled: false
      }
    ]);
  }
});

test("schema: valid local_json submit body parses correctly", () => {
  const result = SubmitRequestSchema.safeParse({
    figmaSourceMode: "local_json",
    figmaJsonPath: "./fixtures/figma.json",
    llmCodegenMode: "deterministic"
  });
  assert.equal(result.success, true);
  if (result.success) {
    assert.equal(result.data.figmaSourceMode, "local_json");
    assert.equal(result.data.figmaJsonPath, "./fixtures/figma.json");
    assert.equal(result.data.figmaFileKey, undefined);
    assert.equal(result.data.figmaAccessToken, undefined);
  }
});

test("schema: valid hybrid submit body parses correctly", () => {
  const result = SubmitRequestSchema.safeParse({
    figmaSourceMode: "hybrid",
    figmaFileKey: "abc123",
    figmaAccessToken: "figd_xxx",
    llmCodegenMode: "deterministic"
  });
  assert.equal(result.success, true);
  if (result.success) {
    assert.equal(result.data.figmaSourceMode, "hybrid");
  }
});

test("schema: submit canonicalizes llmCodegenMode and generationLocale", () => {
  const result = SubmitRequestSchema.safeParse({
    figmaFileKey: "abc123",
    figmaAccessToken: "figd_xxx",
    generationLocale: " EN-us ",
    llmCodegenMode: " Deterministic "
  });
  assert.equal(result.success, true);
  if (result.success) {
    assert.equal(result.data.generationLocale, "en-US");
    assert.equal(result.data.llmCodegenMode, "deterministic");
  }
});

test("schema: local_json mode is inferred from figmaJsonPath when figmaSourceMode is omitted", () => {
  const result = SubmitRequestSchema.safeParse({
    figmaJsonPath: "./fixtures/figma.json"
  });
  assert.equal(result.success, true);
  if (result.success) {
    assert.equal(result.data.figmaSourceMode, "local_json");
    assert.equal(result.data.figmaJsonPath, "./fixtures/figma.json");
  }
});

test("schema: missing required fields fails validation", () => {
  const result = SubmitRequestSchema.safeParse({
    figmaFileKey: "abc123"
  });
  assert.equal(result.success, false);
});

test("schema: non-object submit bodies report the root issue deterministically", () => {
  const result = SubmitRequestSchema.safeParse("bad-submit-body");
  assert.equal(result.success, false);
  if (!result.success) {
    assert.deepEqual(result.error.issues, [
      {
        path: [],
        message: "Expected an object body."
      }
    ]);
  }
});

test("schema: empty required values fail validation", () => {
  const result = SubmitRequestSchema.safeParse({
    figmaFileKey: "",
    figmaAccessToken: ""
  });
  assert.equal(result.success, false);
});

test("schema: local_json mode rejects missing figmaJsonPath", () => {
  const result = SubmitRequestSchema.safeParse({
    figmaSourceMode: "local_json"
  });
  assert.equal(result.success, false);
});

test("schema: local_json mode rejects rest credentials", () => {
  const result = SubmitRequestSchema.safeParse({
    figmaSourceMode: "local_json",
    figmaJsonPath: "./fixtures/figma.json",
    figmaFileKey: "abc123",
    figmaAccessToken: "figd_xxx"
  });
  assert.equal(result.success, false);
});

test("schema: rest mode rejects figmaJsonPath", () => {
  const result = SubmitRequestSchema.safeParse({
    figmaSourceMode: "rest",
    figmaFileKey: "abc123",
    figmaAccessToken: "figd_xxx",
    figmaJsonPath: "./fixtures/figma.json"
  });
  assert.equal(result.success, false);
});

test("schema: non-string values fail validation", () => {
  const result = SubmitRequestSchema.safeParse({
    figmaFileKey: 12345,
    figmaAccessToken: 12345
  });
  assert.equal(result.success, false);
});

test("schema: extra unknown fields are rejected (strict mode)", () => {
  const result = SubmitRequestSchema.safeParse({
    figmaFileKey: "key-1",
    figmaAccessToken: "token",
    unknownField: "unexpected"
  });
  assert.equal(result.success, false);
});

test("schema: optional fields must be strings when provided", () => {
  const result = SubmitRequestSchema.safeParse({
    figmaFileKey: "key-1",
    figmaAccessToken: "token",
    projectName: 123,
    storybookStaticDir: 42,
    customerProfilePath: true,
    customerBrandId: false,
    generationLocale: 5,
    formHandlingMode: 7
  });
  assert.equal(result.success, false);
});

test("schema: brandTheme must be a supported enum value", () => {
  const result = SubmitRequestSchema.safeParse({
    figmaFileKey: "key-1",
    figmaAccessToken: "token",
    brandTheme: "enterprise"
  });
  assert.equal(result.success, false);
});

test("schema: formHandlingMode must be a supported enum value", () => {
  const result = SubmitRequestSchema.safeParse({
    figmaFileKey: "key-1",
    figmaAccessToken: "token",
    formHandlingMode: "formik"
  });
  assert.equal(result.success, false);
});

test("schema: invalid llmCodegenMode reports exact field path issue", () => {
  const result = SubmitRequestSchema.safeParse({
    figmaFileKey: "key-1",
    figmaAccessToken: "token",
    llmCodegenMode: "hybrid"
  });
  assert.equal(result.success, false);
  if (!result.success) {
    assert.deepEqual(result.error.issues, [
      {
        path: ["llmCodegenMode"],
        message: "llmCodegenMode must equal 'deterministic'"
      }
    ]);
  }
});

test("schema: invalid generationLocale syntax reports exact field path issue", () => {
  const result = SubmitRequestSchema.safeParse({
    figmaFileKey: "key-1",
    figmaAccessToken: "token",
    generationLocale: "en-XYZ"
  });
  assert.equal(result.success, false);
  if (!result.success) {
    assert.deepEqual(result.error.issues, [
      {
        path: ["generationLocale"],
        message: "generationLocale must be a valid supported locale"
      }
    ]);
  }
});

test("schema: unsupported generationLocale reports exact field path issue", () => {
  const result = SubmitRequestSchema.safeParse({
    figmaFileKey: "key-1",
    figmaAccessToken: "token",
    generationLocale: "zz-ZZ"
  });
  assert.equal(result.success, false);
  if (!result.success) {
    assert.deepEqual(result.error.issues, [
      {
        path: ["generationLocale"],
        message: "generationLocale must be a valid supported locale"
      }
    ]);
  }
});

test("schema: combined invalid llmCodegenMode and generationLocale reports both field path issues", () => {
  const result = SubmitRequestSchema.safeParse({
    figmaFileKey: "key-1",
    figmaAccessToken: "token",
    llmCodegenMode: "hybrid",
    generationLocale: "not-a-locale"
  });
  assert.equal(result.success, false);
  if (!result.success) {
    const paths = result.error.issues.map((i) => i.path.join("."));
    assert.ok(paths.includes("llmCodegenMode"), "expected llmCodegenMode issue");
    assert.ok(paths.includes("generationLocale"), "expected generationLocale issue");
    assert.equal(result.error.issues.length, 2);
  }
});

test("schema: empty string llmCodegenMode is rejected at field level", () => {
  const result = SubmitRequestSchema.safeParse({
    figmaFileKey: "key-1",
    figmaAccessToken: "token",
    llmCodegenMode: ""
  });
  assert.equal(result.success, false);
  if (!result.success) {
    assert.deepEqual(result.error.issues[0]?.path, ["llmCodegenMode"]);
  }
});

test("schema: empty string generationLocale is rejected at field level", () => {
  const result = SubmitRequestSchema.safeParse({
    figmaFileKey: "key-1",
    figmaAccessToken: "token",
    generationLocale: ""
  });
  assert.equal(result.success, false);
  if (!result.success) {
    assert.deepEqual(result.error.issues[0]?.path, ["generationLocale"]);
  }
});

test("schema: omitted llmCodegenMode and generationLocale produce valid parse with undefined fields", () => {
  const result = SubmitRequestSchema.safeParse({
    figmaFileKey: "key-1",
    figmaAccessToken: "token"
  });
  assert.equal(result.success, true);
  if (result.success) {
    assert.equal(result.data.llmCodegenMode, undefined);
    assert.equal(result.data.generationLocale, undefined);
  }
});

test("schema: git fields required when enableGitPr=true", () => {
  const invalid = SubmitRequestSchema.safeParse({
    figmaFileKey: "key-1",
    figmaAccessToken: "token",
    enableGitPr: true
  });
  assert.equal(invalid.success, false);

  const valid = SubmitRequestSchema.safeParse({
    figmaFileKey: "key-1",
    figmaAccessToken: "token",
    enableGitPr: true,
    repoUrl: "https://github.com/example/repo.git",
    repoToken: "repo-token"
  });
  assert.equal(valid.success, true);
});

test("schema: invalid enableGitPr types report exact issue paths", () => {
  const result = SubmitRequestSchema.safeParse({
    figmaFileKey: "key-1",
    figmaAccessToken: "token",
    enableGitPr: "yes"
  });
  assert.equal(result.success, false);
  if (!result.success) {
    assert.deepEqual(result.error.issues, [
      {
        path: ["enableGitPr"],
        message: "enableGitPr must be a boolean"
      }
    ]);
  }
});

test("schema: rest mode missing credentials report exact required-field issues", () => {
  const result = SubmitRequestSchema.safeParse({
    figmaSourceMode: "rest"
  });
  assert.equal(result.success, false);
  if (!result.success) {
    assert.deepEqual(result.error.issues, [
      {
        path: ["figmaFileKey"],
        message: "figmaFileKey is required when figmaSourceMode=rest"
      },
      {
        path: ["figmaAccessToken"],
        message: "figmaAccessToken is required when figmaSourceMode=rest"
      }
    ]);
  }
});

test("schema: submit request rejects mixed exact and pattern componentMappings", () => {
  const result = SubmitRequestSchema.safeParse({
    figmaFileKey: "key-1",
    figmaAccessToken: "token",
    componentMappings: [
      {
        boardKey: "board-1",
        nodeId: "button-node-1",
        canonicalComponentName: "Button",
        componentName: "BrokenRule",
        importPath: "@broken/ui",
        priority: 0,
        source: "local_override",
        enabled: true
      }
    ]
  });

  assert.equal(result.success, false);
  if (!result.success) {
    assert.deepEqual(result.error.issues, [
      {
        path: ["componentMappings", 0],
        message: "component mapping rules must be either exact (nodeId only) or pattern-based (selectors only)."
      }
    ]);
  }
});

test("schema: submit request rejects invalid componentMappings regex sources", () => {
  const result = SubmitRequestSchema.safeParse({
    figmaFileKey: "key-1",
    figmaAccessToken: "token",
    componentMappings: [
      {
        boardKey: "board-1",
        nodeNamePattern: "[",
        componentName: "BrokenRule",
        importPath: "@broken/ui",
        priority: 0,
        source: "local_override",
        enabled: true
      }
    ]
  });

  assert.equal(result.success, false);
  if (!result.success) {
    assert.deepEqual(result.error.issues, [
      {
        path: ["componentMappings", 0, "nodeNamePattern"],
        message: "nodeNamePattern must be a valid regular expression source."
      }
    ]);
  }
});

test("schema: submit request rejects componentMappings with nested quantifier patterns (ReDoS)", () => {
  const result = SubmitRequestSchema.safeParse({
    figmaFileKey: "key-1",
    figmaAccessToken: "token",
    componentMappings: [
      {
        boardKey: "board-1",
        nodeNamePattern: "(a+)+",
        componentName: "ReDoSRule",
        importPath: "@redos/ui",
        priority: 0,
        source: "local_override",
        enabled: true
      }
    ]
  });

  assert.equal(result.success, false);
  if (!result.success) {
    assert.deepEqual(result.error.issues, [
      {
        path: ["componentMappings", 0, "nodeNamePattern"],
        message: "nodeNamePattern must not contain nested quantifiers (potential ReDoS)."
      }
    ]);
  }
});

test("schema: submit request rejects componentMappings with alternation quantifier patterns (ReDoS)", () => {
  const result = SubmitRequestSchema.safeParse({
    figmaFileKey: "key-1",
    figmaAccessToken: "token",
    componentMappings: [
      {
        boardKey: "board-1",
        nodeNamePattern: "(a|a)+",
        componentName: "AltReDoSRule",
        importPath: "@redos/ui",
        priority: 0,
        source: "local_override",
        enabled: true
      }
    ]
  });

  assert.equal(result.success, false);
  if (!result.success) {
    assert.deepEqual(result.error.issues, [
      {
        path: ["componentMappings", 0, "nodeNamePattern"],
        message: "nodeNamePattern must not contain alternation groups followed by quantifiers (potential ReDoS)."
      }
    ]);
  }
});

// ---------------------------------------------------------------------------
// WorkspaceStatusSchema
// ---------------------------------------------------------------------------

test("schema: valid workspace status parses", () => {
  const result = WorkspaceStatusSchema.safeParse({
    running: true,
    url: "http://127.0.0.1:1983",
    host: "127.0.0.1",
    port: 1983,
    figmaSourceMode: "rest",
    llmCodegenMode: "deterministic",
    uptimeMs: 1234,
    outputRoot: "/tmp/.workspace-dev",
    previewEnabled: true
  });
  assert.equal(result.success, true);
});

test("schema: workspace status rejects non-rest figmaSourceMode", () => {
  const result = WorkspaceStatusSchema.safeParse({
    running: true,
    url: "http://127.0.0.1:1983",
    host: "127.0.0.1",
    port: 1983,
    figmaSourceMode: "mcp",
    llmCodegenMode: "deterministic",
    uptimeMs: 1234,
    outputRoot: "/tmp/.workspace-dev",
    previewEnabled: true
  });
  assert.equal(result.success, false);
});

test("schema: workspace status allows hybrid figmaSourceMode", () => {
  const result = WorkspaceStatusSchema.safeParse({
    running: true,
    url: "http://127.0.0.1:1983",
    host: "127.0.0.1",
    port: 1983,
    figmaSourceMode: "hybrid",
    llmCodegenMode: "deterministic",
    uptimeMs: 1234,
    outputRoot: "/tmp/.workspace-dev",
    previewEnabled: true
  });
  assert.equal(result.success, true);
});

test("schema: workspace status allows local_json figmaSourceMode", () => {
  const result = WorkspaceStatusSchema.safeParse({
    running: true,
    url: "http://127.0.0.1:1983",
    host: "127.0.0.1",
    port: 1983,
    figmaSourceMode: "local_json",
    llmCodegenMode: "deterministic",
    uptimeMs: 1234,
    outputRoot: "/tmp/.workspace-dev",
    previewEnabled: true
  });
  assert.equal(result.success, true);
});

test("schema: workspace status requires outputRoot and previewEnabled", () => {
  const result = WorkspaceStatusSchema.safeParse({
    running: true,
    url: "http://127.0.0.1:1983",
    host: "127.0.0.1",
    port: 1983,
    figmaSourceMode: "rest",
    llmCodegenMode: "deterministic",
    uptimeMs: 1234
  });
  assert.equal(result.success, false);
});

test("schema: error envelope requires message and error strings", () => {
  const result = ErrorResponseSchema.safeParse({
    error: "X",
    message: "Y"
  });
  assert.equal(result.success, true);

  const invalid = ErrorResponseSchema.safeParse({ error: "X", message: 1 });
  assert.equal(invalid.success, false);

  const notObject = ErrorResponseSchema.safeParse(undefined);
  assert.equal(notObject.success, false);
});

// ---------------------------------------------------------------------------
// RegenerationRequestSchema
// ---------------------------------------------------------------------------

test("schema: valid regeneration request accepts layout overrides", () => {
  const result = RegenerationRequestSchema.safeParse({
    overrides: [
      { nodeId: "node-1", field: "width", value: 420 },
      { nodeId: "node-1", field: "layoutMode", value: "horizontal" },
      { nodeId: "node-1", field: "primaryAxisAlignItems", value: "space_between" }
    ],
    draftId: "draft-1",
    baseFingerprint: "fp-1",
    customerBrandId: " sparkasse-retail "
  });

  assert.equal(result.success, true);
  if (result.success) {
    assert.deepEqual(result.data.overrides, [
      { nodeId: "node-1", field: "width", value: 420 },
      { nodeId: "node-1", field: "layoutMode", value: "HORIZONTAL" },
      { nodeId: "node-1", field: "primaryAxisAlignItems", value: "SPACE_BETWEEN" }
    ]);
    assert.equal(result.data.customerBrandId, "sparkasse-retail");
  }
});

test("schema: valid regeneration request accepts componentMappings", () => {
  const result = RegenerationRequestSchema.safeParse({
    overrides: [],
    componentMappings: [
      {
        boardKey: " board-1 ",
        canonicalComponentName: " Button ",
        semanticType: " button ",
        componentName: " ManualButton ",
        importPath: " @manual/ui ",
        priority: 0,
        source: "local_override",
        enabled: true
      }
    ]
  });

  assert.equal(result.success, true);
  if (result.success) {
    assert.deepEqual(result.data.componentMappings, [
      {
        boardKey: "board-1",
        canonicalComponentName: "Button",
        semanticType: "button",
        componentName: "ManualButton",
        importPath: "@manual/ui",
        priority: 0,
        source: "local_override",
        enabled: true
      }
    ]);
  }
});

test("schema: regeneration request rejects empty customerBrandId", () => {
  const result = RegenerationRequestSchema.safeParse({
    overrides: [],
    customerBrandId: "   "
  });

  assert.equal(result.success, false);
});

test("schema: regeneration request rejects invalid componentMappings", () => {
  const result = RegenerationRequestSchema.safeParse({
    overrides: [],
    componentMappings: [
      {
        boardKey: "board-1",
        componentName: "BrokenRule",
        importPath: "@broken/ui",
        priority: 0,
        source: "local_override",
        enabled: true
      }
    ]
  });

  assert.equal(result.success, false);
  if (!result.success) {
    assert.deepEqual(result.error.issues, [
      {
        path: ["componentMappings", 0],
        message:
          "pattern component mapping rules must define at least one selector: nodeNamePattern, canonicalComponentName, storybookTier, figmaLibrary, or semanticType."
      }
    ]);
  }
});

test("schema: regeneration request rejects unsupported layout fields", () => {
  const result = RegenerationRequestSchema.safeParse({
    overrides: [
      { nodeId: "node-1", field: "maxWidth", value: 480 }
    ]
  });

  assert.equal(result.success, false);
});

test("schema: regeneration request rejects invalid layout values", () => {
  const result = RegenerationRequestSchema.safeParse({
    overrides: [
      { nodeId: "node-1", field: "width", value: 0 },
      { nodeId: "node-1", field: "layoutMode", value: "row" },
      { nodeId: "node-1", field: "counterAxisAlignItems", value: "stretch" }
    ]
  });

  assert.equal(result.success, false);
});

test("schema: regeneration request rejects unexpected top-level properties", () => {
  const result = RegenerationRequestSchema.safeParse({
    overrides: [{ nodeId: "node-1", field: "width", value: 320 }],
    unexpected: true
  });

  assert.equal(result.success, false);
  if (!result.success) {
    assert.deepEqual(result.error.issues, [
      {
        path: ["unexpected"],
        message: "Unexpected property 'unexpected'."
      }
    ]);
  }
});

// ---------------------------------------------------------------------------
// formatZodError
// ---------------------------------------------------------------------------

test("schema: formatZodError produces deterministic output", () => {
  const result = SubmitRequestSchema.safeParse({ figmaFileKey: 123 });
  assert.equal(result.success, false);
  if (!result.success) {
    const formatted = formatZodError(result.error);
    assert.equal(formatted.error, "VALIDATION_ERROR");
    assert.equal(formatted.message, "Request validation failed.");
    assert.ok(Array.isArray(formatted.issues));
    assert.ok(formatted.issues.length > 0);
    assert.equal(typeof formatted.issues[0]!.path, "string");
    assert.equal(typeof formatted.issues[0]!.message, "string");
  }
});

test("schema: formatZodError maps root-level paths correctly", () => {
  const formatted = formatZodError({
    issues: [{ path: [], message: "root issue" }]
  });
  assert.equal(formatted.issues[0]?.path, "(root)");
});

test("schema: sync dry_run parses with optional targetPath", () => {
  const result = SyncRequestSchema.safeParse({
    mode: "dry_run",
    targetPath: "apps/generated"
  });
  assert.equal(result.success, true);
});

test("schema: sync request rejects non-object bodies at the root", () => {
  const result = SyncRequestSchema.safeParse(null);
  assert.equal(result.success, false);
  if (!result.success) {
    assert.deepEqual(result.error.issues, [
      {
        path: [],
        message: "Expected an object body."
      }
    ]);
  }
});

test("schema: sync request rejects unsupported modes with an exact mode issue", () => {
  const result = SyncRequestSchema.safeParse({
    mode: "preview"
  });
  assert.equal(result.success, false);
  if (!result.success) {
    assert.deepEqual(result.error.issues, [
      {
        path: ["mode"],
        message: "mode must be one of: dry_run, apply."
      }
    ]);
  }
});

test("schema: sync dry_run preserves a non-empty targetPath verbatim", () => {
  const result = SyncRequestSchema.safeParse({
    mode: "dry_run",
    targetPath: "  apps/generated  "
  });
  assert.equal(result.success, true);
  if (result.success) {
    assert.equal(result.data.mode, "dry_run");
    assert.equal(result.data.targetPath, "  apps/generated  ");
  }
});

test("schema: sync dry_run rejects blank and non-string targetPath values", () => {
  const blank = SyncRequestSchema.safeParse({
    mode: "dry_run",
    targetPath: "   "
  });
  assert.equal(blank.success, false);
  if (!blank.success) {
    assert.deepEqual(blank.error.issues, [
      {
        path: ["targetPath"],
        message: "targetPath must be a non-empty string when provided."
      }
    ]);
  }

  const nonString = SyncRequestSchema.safeParse({
    mode: "dry_run",
    targetPath: 123
  });
  assert.equal(nonString.success, false);
  if (!nonString.success) {
    assert.deepEqual(nonString.error.issues, [
      {
        path: ["targetPath"],
        message: "targetPath must be a non-empty string when provided."
      }
    ]);
  }
});

test("schema: sync apply requires token and explicit confirmation", () => {
  const invalid = SyncRequestSchema.safeParse({
    mode: "apply",
    confirmationToken: "",
    confirmOverwrite: false,
    fileDecisions: []
  });
  assert.equal(invalid.success, false);

  const valid = SyncRequestSchema.safeParse({
    mode: "apply",
    confirmationToken: "token-123",
    confirmOverwrite: true,
    fileDecisions: [
      {
        path: "src/App.tsx",
        decision: "write"
      }
    ]
  });
  assert.equal(valid.success, true);
});

test("schema: sync apply trims confirmationToken and file decision paths", () => {
  const result = SyncRequestSchema.safeParse({
    mode: "apply",
    confirmationToken: "  token-123  ",
    confirmOverwrite: true,
    fileDecisions: [
      {
        path: "  src/App.tsx  ",
        decision: "write"
      },
      {
        path: "\tsrc/Skip.tsx\t",
        decision: "skip"
      }
    ]
  });
  assert.equal(result.success, true);
  if (result.success) {
    assert.equal(result.data.confirmationToken, "token-123");
    assert.deepEqual(result.data.fileDecisions, [
      {
        path: "src/App.tsx",
        decision: "write"
      },
      {
        path: "src/Skip.tsx",
        decision: "skip"
      }
    ]);
  }
});

test("schema: sync apply reports exact token, overwrite, and file decision issues", () => {
  const result = SyncRequestSchema.safeParse({
    mode: "apply",
    confirmationToken: "",
    confirmOverwrite: false,
    fileDecisions: []
  });
  assert.equal(result.success, false);
  if (!result.success) {
    assert.deepEqual(result.error.issues, [
      {
        path: ["confirmationToken"],
        message: "confirmationToken must be a non-empty string."
      },
      {
        path: ["confirmOverwrite"],
        message: "confirmOverwrite must be true for apply mode."
      },
      {
        path: ["fileDecisions"],
        message: "fileDecisions must be a non-empty array."
      }
    ]);
  }
});

test("schema: sync apply rejects malformed fileDecisions entries with exact field issues", () => {
  const result = SyncRequestSchema.safeParse({
    mode: "apply",
    confirmationToken: "token-123",
    confirmOverwrite: true,
    fileDecisions: [
      null,
      {
        path: "   ",
        decision: "overwrite"
      }
    ]
  });
  assert.equal(result.success, false);
  if (!result.success) {
    assert.deepEqual(result.error.issues, [
      {
        path: ["fileDecisions", 0],
        message: "Each fileDecisions entry must be an object."
      },
      {
        path: ["fileDecisions", 1, "path"],
        message: "path must be a non-empty string."
      },
      {
        path: ["fileDecisions", 1, "decision"],
        message: "decision must be one of: write, skip."
      }
    ]);
  }
});

test("schema: sync apply rejects duplicate decisions after trimming paths", () => {
  const result = SyncRequestSchema.safeParse({
    mode: "apply",
    confirmationToken: "token-123",
    confirmOverwrite: true,
    fileDecisions: [
      {
        path: "src/App.tsx",
        decision: "write"
      },
      {
        path: "  src/App.tsx  ",
        decision: "skip"
      }
    ]
  });
  assert.equal(result.success, false);
  if (!result.success) {
    assert.deepEqual(result.error.issues, [
      {
        path: ["fileDecisions", 1, "path"],
        message: "Duplicate decision for 'src/App.tsx'."
      }
    ]);
  }
});

test("schema: sync dry_run rejects unexpected properties", () => {
  const result = SyncRequestSchema.safeParse({
    mode: "dry_run",
    targetPath: "apps/generated",
    unexpected: true
  });

  assert.equal(result.success, false);
  if (!result.success) {
    assert.deepEqual(result.error.issues, [
      {
        path: ["unexpected"],
        message: "Unexpected property 'unexpected'."
      }
    ]);
  }
});

test("schema: sync apply rejects unexpected properties", () => {
  const result = SyncRequestSchema.safeParse({
    mode: "apply",
    confirmationToken: "token-123",
    confirmOverwrite: true,
    fileDecisions: [
      {
        path: "src/App.tsx",
        decision: "write"
      }
    ],
    unexpected: true
  });

  assert.equal(result.success, false);
  if (!result.success) {
    assert.deepEqual(result.error.issues, [
      {
        path: ["unexpected"],
        message: "Unexpected property 'unexpected'."
      }
    ]);
  }
});

// ---------------------------------------------------------------------------
// CreatePrRequestSchema
// ---------------------------------------------------------------------------

test("schema: create-pr requires repoUrl and repoToken", () => {
  const missing = CreatePrRequestSchema.safeParse({});
  assert.equal(missing.success, false);

  const emptyUrl = CreatePrRequestSchema.safeParse({ repoUrl: "", repoToken: "tok" });
  assert.equal(emptyUrl.success, false);

  const emptyToken = CreatePrRequestSchema.safeParse({ repoUrl: "https://github.com/acme/repo", repoToken: "" });
  assert.equal(emptyToken.success, false);
});

test("schema: create-pr rejects non-object bodies and reports exact required-field issues", () => {
  const notObject = CreatePrRequestSchema.safeParse("bad-body");
  assert.equal(notObject.success, false);
  if (!notObject.success) {
    assert.deepEqual(notObject.error.issues, [
      {
        path: [],
        message: "Expected an object body."
      }
    ]);
  }

  const missing = CreatePrRequestSchema.safeParse({});
  assert.equal(missing.success, false);
  if (!missing.success) {
    assert.deepEqual(missing.error.issues, [
      {
        path: ["repoUrl"],
        message: "repoUrl must be a non-empty string."
      },
      {
        path: ["repoToken"],
        message: "repoToken must be a non-empty string."
      }
    ]);
  }
});

test("schema: create-pr parses valid input with optional targetPath", () => {
  const result = CreatePrRequestSchema.safeParse({
    repoUrl: "https://github.com/acme/repo",
    repoToken: "ghp_abc123"
  });
  assert.equal(result.success, true);
  if (result.success) {
    assert.equal(result.data.repoUrl, "https://github.com/acme/repo");
    assert.equal(result.data.repoToken, "ghp_abc123");
    assert.equal(result.data.targetPath, undefined);
  }

  const withTarget = CreatePrRequestSchema.safeParse({
    repoUrl: "https://github.com/acme/repo",
    repoToken: "ghp_abc123",
    targetPath: "generated"
  });
  assert.equal(withTarget.success, true);
  if (withTarget.success) {
    assert.equal(withTarget.data.targetPath, "generated");
  }
});

test("schema: create-pr targetPath preserves non-empty strings and rejects blank ones", () => {
  const preserved = CreatePrRequestSchema.safeParse({
    repoUrl: "https://github.com/acme/repo",
    repoToken: "ghp_abc123",
    targetPath: "  generated/subdir  "
  });
  assert.equal(preserved.success, true);
  if (preserved.success) {
    assert.equal(preserved.data.targetPath, "  generated/subdir  ");
  }

  const blank = CreatePrRequestSchema.safeParse({
    repoUrl: "https://github.com/acme/repo",
    repoToken: "ghp_abc123",
    targetPath: "   "
  });
  assert.equal(blank.success, false);
  if (!blank.success) {
    assert.deepEqual(blank.error.issues, [
      {
        path: ["targetPath"],
        message: "targetPath must be a non-empty string when provided."
      }
    ]);
  }
});

test("schema: create-pr rejects unexpected properties", () => {
  const result = CreatePrRequestSchema.safeParse({
    repoUrl: "https://github.com/acme/repo",
    repoToken: "tok",
    extraField: "nope"
  });
  assert.equal(result.success, false);
});
