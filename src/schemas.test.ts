import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  CreatePrRequestSchema,
  ErrorResponseSchema,
  RegenerationRequestSchema,
  SubmitRequestSchema,
  SyncRequestSchema,
  WorkspaceStatusSchema,
  formatZodError,
} from "./schemas.js";
import {
  DEFAULT_FIGMA_PASTE_MAX_BYTES,
  MAX_SUBMIT_BODY_BYTES,
  resolveFigmaPasteMaxBytes,
} from "./server/constants.js";
import { DEFAULT_FIGMA_PASTE_MAX_SELECTION_COUNT } from "./clipboard-envelope.js";
import {
  DEFAULT_FIGMA_PASTE_MAX_NODE_COUNT,
  DEFAULT_FIGMA_PASTE_MAX_ROOT_COUNT,
} from "./figma-payload-validation.js";

const pasteFixtureRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../integration/fixtures/figma-paste-pipeline",
);

function readPasteFixture<T>(relativePath: string): T {
  return JSON.parse(
    readFileSync(path.join(pasteFixtureRoot, relativePath), "utf8"),
  ) as T;
}

// ---------------------------------------------------------------------------
// SubmitRequestSchema
// ---------------------------------------------------------------------------

test("schema: valid submit body parses correctly", () => {
  const result = SubmitRequestSchema.safeParse({
    pipelineId: "rocket",
    figmaFileKey: "abc123",
    figmaAccessToken: "figd_xxx",
    storybookStaticDir: " ./storybook-static/customer ",
    customerProfilePath: " ./profiles/acme.json ",
    customerBrandId: " sparkasse-retail ",
    brandTheme: " Sparkasse ",
    generationLocale: "en-US",
    formHandlingMode: " react_hook_form ",
    figmaSourceMode: "rest",
    llmCodegenMode: "deterministic",
  });
  assert.equal(result.success, true);
  if (result.success) {
    assert.equal(result.data.pipelineId, "rocket");
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
        enabled: true,
      },
      {
        boardKey: " board-1 ",
        canonicalComponentName: " Button ",
        storybookTier: " Components ",
        componentName: " PatternButton ",
        importPath: " @pattern/ui ",
        priority: 2,
        source: "code_connect_import",
        enabled: false,
      },
    ],
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
        enabled: true,
      },
      {
        boardKey: "board-1",
        canonicalComponentName: "Button",
        storybookTier: "Components",
        componentName: "PatternButton",
        importPath: "@pattern/ui",
        priority: 2,
        source: "code_connect_import",
        enabled: false,
      },
    ]);
  }
});

test("schema: valid local_json submit body parses correctly", () => {
  const result = SubmitRequestSchema.safeParse({
    figmaSourceMode: "local_json",
    figmaJsonPath: "./fixtures/figma.json",
    llmCodegenMode: "deterministic",
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
    llmCodegenMode: "deterministic",
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
    llmCodegenMode: " Deterministic ",
  });
  assert.equal(result.success, true);
  if (result.success) {
    assert.equal(result.data.generationLocale, "en-US");
    assert.equal(result.data.llmCodegenMode, "deterministic");
  }
});

test("schema: local_json mode is inferred from figmaJsonPath when figmaSourceMode is omitted", () => {
  const result = SubmitRequestSchema.safeParse({
    figmaJsonPath: "./fixtures/figma.json",
  });
  assert.equal(result.success, true);
  if (result.success) {
    assert.equal(result.data.figmaSourceMode, "local_json");
    assert.equal(result.data.figmaJsonPath, "./fixtures/figma.json");
  }
});

test("schema: missing required fields fails validation", () => {
  const result = SubmitRequestSchema.safeParse({
    figmaFileKey: "abc123",
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
        message: "Expected an object body.",
      },
    ]);
  }
});

test("schema: empty required values fail validation", () => {
  const result = SubmitRequestSchema.safeParse({
    figmaFileKey: "",
    figmaAccessToken: "",
  });
  assert.equal(result.success, false);
});

test("schema: local_json mode rejects missing figmaJsonPath", () => {
  const result = SubmitRequestSchema.safeParse({
    figmaSourceMode: "local_json",
  });
  assert.equal(result.success, false);
});

test("schema: local_json mode rejects rest credentials", () => {
  const result = SubmitRequestSchema.safeParse({
    figmaSourceMode: "local_json",
    figmaJsonPath: "./fixtures/figma.json",
    figmaFileKey: "abc123",
    figmaAccessToken: "figd_xxx",
  });
  assert.equal(result.success, false);
});

test("schema: rest mode rejects figmaJsonPath", () => {
  const result = SubmitRequestSchema.safeParse({
    figmaSourceMode: "rest",
    figmaFileKey: "abc123",
    figmaAccessToken: "figd_xxx",
    figmaJsonPath: "./fixtures/figma.json",
  });
  assert.equal(result.success, false);
});

test("schema: non-string values fail validation", () => {
  const result = SubmitRequestSchema.safeParse({
    figmaFileKey: 12345,
    figmaAccessToken: 12345,
  });
  assert.equal(result.success, false);
});

test("schema: extra unknown fields are rejected (strict mode)", () => {
  const result = SubmitRequestSchema.safeParse({
    figmaFileKey: "key-1",
    figmaAccessToken: "token",
    unknownField: "unexpected",
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
    formHandlingMode: 7,
  });
  assert.equal(result.success, false);
});

test("schema: brandTheme must be a supported enum value", () => {
  const result = SubmitRequestSchema.safeParse({
    figmaFileKey: "key-1",
    figmaAccessToken: "token",
    brandTheme: "enterprise",
  });
  assert.equal(result.success, false);
});

test("schema: formHandlingMode must be a supported enum value", () => {
  const result = SubmitRequestSchema.safeParse({
    figmaFileKey: "key-1",
    figmaAccessToken: "token",
    formHandlingMode: "formik",
  });
  assert.equal(result.success, false);
});

test("schema: invalid llmCodegenMode reports exact field path issue", () => {
  const result = SubmitRequestSchema.safeParse({
    figmaFileKey: "key-1",
    figmaAccessToken: "token",
    llmCodegenMode: "hybrid",
  });
  assert.equal(result.success, false);
  if (!result.success) {
    assert.deepEqual(result.error.issues, [
      {
        path: ["llmCodegenMode"],
        message: "llmCodegenMode must equal 'deterministic'",
      },
    ]);
  }
});

test("schema: invalid generationLocale syntax reports exact field path issue", () => {
  const result = SubmitRequestSchema.safeParse({
    figmaFileKey: "key-1",
    figmaAccessToken: "token",
    generationLocale: "en-XYZ",
  });
  assert.equal(result.success, false);
  if (!result.success) {
    assert.deepEqual(result.error.issues, [
      {
        path: ["generationLocale"],
        message: "generationLocale must be a valid supported locale",
      },
    ]);
  }
});

test("schema: unsupported generationLocale reports exact field path issue", () => {
  const result = SubmitRequestSchema.safeParse({
    figmaFileKey: "key-1",
    figmaAccessToken: "token",
    generationLocale: "zz-ZZ",
  });
  assert.equal(result.success, false);
  if (!result.success) {
    assert.deepEqual(result.error.issues, [
      {
        path: ["generationLocale"],
        message: "generationLocale must be a valid supported locale",
      },
    ]);
  }
});

test("schema: combined invalid llmCodegenMode and generationLocale reports both field path issues", () => {
  const result = SubmitRequestSchema.safeParse({
    figmaFileKey: "key-1",
    figmaAccessToken: "token",
    llmCodegenMode: "hybrid",
    generationLocale: "not-a-locale",
  });
  assert.equal(result.success, false);
  if (!result.success) {
    const paths = result.error.issues.map((i) => i.path.join("."));
    assert.ok(
      paths.includes("llmCodegenMode"),
      "expected llmCodegenMode issue",
    );
    assert.ok(
      paths.includes("generationLocale"),
      "expected generationLocale issue",
    );
    assert.equal(result.error.issues.length, 2);
  }
});

test("schema: empty string llmCodegenMode is rejected at field level", () => {
  const result = SubmitRequestSchema.safeParse({
    figmaFileKey: "key-1",
    figmaAccessToken: "token",
    llmCodegenMode: "",
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
    generationLocale: "",
  });
  assert.equal(result.success, false);
  if (!result.success) {
    assert.deepEqual(result.error.issues[0]?.path, ["generationLocale"]);
  }
});

test("schema: omitted llmCodegenMode and generationLocale produce valid parse with undefined fields", () => {
  const result = SubmitRequestSchema.safeParse({
    figmaFileKey: "key-1",
    figmaAccessToken: "token",
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
    enableGitPr: true,
  });
  assert.equal(invalid.success, false);

  const valid = SubmitRequestSchema.safeParse({
    figmaFileKey: "key-1",
    figmaAccessToken: "token",
    enableGitPr: true,
    repoUrl: "https://github.com/example/repo.git",
    repoToken: "repo-token",
  });
  assert.equal(valid.success, true);
});

test("schema: invalid enableGitPr types report exact issue paths", () => {
  const result = SubmitRequestSchema.safeParse({
    figmaFileKey: "key-1",
    figmaAccessToken: "token",
    enableGitPr: "yes",
  });
  assert.equal(result.success, false);
  if (!result.success) {
    assert.deepEqual(result.error.issues, [
      {
        path: ["enableGitPr"],
        message: "enableGitPr must be a boolean",
      },
    ]);
  }
});

test("schema: selectedNodeIds accepts non-empty string arrays for import-capable submits", () => {
  const result = SubmitRequestSchema.safeParse({
    figmaSourceMode: "hybrid",
    figmaFileKey: "key-1",
    figmaAccessToken: "token",
    selectedNodeIds: ["frame-1", " child-2 "],
  });
  assert.equal(result.success, true);
  if (result.success) {
    assert.deepEqual(result.data.selectedNodeIds, ["frame-1", "child-2"]);
  }
});

test("schema: selectedNodeIds rejects malformed arrays", () => {
  const result = SubmitRequestSchema.safeParse({
    figmaSourceMode: "hybrid",
    figmaFileKey: "key-1",
    figmaAccessToken: "token",
    selectedNodeIds: ["frame-1", ""],
  });
  assert.equal(result.success, false);
  if (!result.success) {
    assert.deepEqual(result.error.issues, [
      {
        path: ["selectedNodeIds", 1],
        message: "selectedNodeIds entries must be non-empty strings",
      },
    ]);
  }
});

test("schema: rest mode missing credentials report exact required-field issues", () => {
  const result = SubmitRequestSchema.safeParse({
    figmaSourceMode: "rest",
  });
  assert.equal(result.success, false);
  if (!result.success) {
    assert.deepEqual(result.error.issues, [
      {
        path: ["figmaFileKey"],
        message: "figmaFileKey is required when figmaSourceMode=rest",
      },
      {
        path: ["figmaAccessToken"],
        message: "figmaAccessToken is required when figmaSourceMode=rest",
      },
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
        enabled: true,
      },
    ],
  });

  assert.equal(result.success, false);
  if (!result.success) {
    assert.deepEqual(result.error.issues, [
      {
        path: ["componentMappings", 0],
        message:
          "component mapping rules must be either exact (nodeId only) or pattern-based (selectors only).",
      },
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
        enabled: true,
      },
    ],
  });

  assert.equal(result.success, false);
  if (!result.success) {
    assert.deepEqual(result.error.issues, [
      {
        path: ["componentMappings", 0, "nodeNamePattern"],
        message: "nodeNamePattern must be a valid regular expression source.",
      },
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
        enabled: true,
      },
    ],
  });

  assert.equal(result.success, false);
  if (!result.success) {
    assert.deepEqual(result.error.issues, [
      {
        path: ["componentMappings", 0, "nodeNamePattern"],
        message:
          "nodeNamePattern must not contain nested quantifiers (potential ReDoS).",
      },
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
        enabled: true,
      },
    ],
  });

  assert.equal(result.success, false);
  if (!result.success) {
    assert.deepEqual(result.error.issues, [
      {
        path: ["componentMappings", 0, "nodeNamePattern"],
        message:
          "nodeNamePattern must not contain alternation groups followed by quantifiers (potential ReDoS).",
      },
    ]);
  }
});

test("schema: submit request preserves optional componentMappings metadata fields", () => {
  const result = SubmitRequestSchema.safeParse({
    figmaFileKey: "abc123",
    figmaAccessToken: "figd_xxx",
    componentMappings: [
      {
        id: 7,
        boardKey: " board-1 ",
        canonicalComponentName: " Button ",
        figmaLibrary: " core-library ",
        componentName: " FancyButton ",
        importPath: " @fancy/ui ",
        propContract: { size: "lg" },
        priority: 3,
        source: "code_connect_import",
        enabled: true,
        createdAt: " 2026-04-01T10:00:00.000Z ",
        updatedAt: " 2026-04-02T10:00:00.000Z ",
      },
    ],
  });

  assert.equal(result.success, true);
  if (result.success) {
    assert.deepEqual(result.data.componentMappings, [
      {
        id: 7,
        boardKey: "board-1",
        canonicalComponentName: "Button",
        figmaLibrary: "core-library",
        componentName: "FancyButton",
        importPath: "@fancy/ui",
        propContract: { size: "lg" },
        priority: 3,
        source: "code_connect_import",
        enabled: true,
        createdAt: "2026-04-01T10:00:00.000Z",
        updatedAt: "2026-04-02T10:00:00.000Z",
      },
    ]);
  }
});

test("schema: submit request rejects malformed componentMappings entries with exact field issues", () => {
  const nonArray = SubmitRequestSchema.safeParse({
    figmaFileKey: "key-1",
    figmaAccessToken: "token",
    componentMappings: true,
  });

  assert.equal(nonArray.success, false);
  if (!nonArray.success) {
    assert.deepEqual(nonArray.error.issues, [
      {
        path: ["componentMappings"],
        message: "componentMappings must be an array when provided.",
      },
    ]);
  }

  const malformed = SubmitRequestSchema.safeParse({
    figmaFileKey: "key-1",
    figmaAccessToken: "token",
    componentMappings: [
      null,
      {
        id: 1.5,
        boardKey: "   ",
        nodeId: "button-node-1",
        figmaLibrary: "   ",
        componentName: "   ",
        importPath: "   ",
        propContract: "invalid-contract",
        priority: Number.POSITIVE_INFINITY,
        source: "remote",
        enabled: "yes",
        createdAt: "   ",
        updatedAt: "   ",
        unexpected: true,
      },
    ],
  });

  assert.equal(malformed.success, false);
  if (!malformed.success) {
    assert.deepEqual(
      malformed.error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })),
      [
        {
          path: "componentMappings.0",
          message: "Each component mapping rule must be an object.",
        },
        {
          path: "componentMappings.1.unexpected",
          message: "Unexpected property 'unexpected'.",
        },
        {
          path: "componentMappings.1.boardKey",
          message: "boardKey must be a non-empty string when provided.",
        },
        {
          path: "componentMappings.1.figmaLibrary",
          message: "figmaLibrary must be a non-empty string when provided.",
        },
        {
          path: "componentMappings.1.componentName",
          message: "componentName must be a non-empty string when provided.",
        },
        {
          path: "componentMappings.1.importPath",
          message: "importPath must be a non-empty string when provided.",
        },
        {
          path: "componentMappings.1.createdAt",
          message: "createdAt must be a non-empty string when provided.",
        },
        {
          path: "componentMappings.1.updatedAt",
          message: "updatedAt must be a non-empty string when provided.",
        },
        {
          path: "componentMappings.1.id",
          message: "id must be an integer when provided.",
        },
        {
          path: "componentMappings.1.priority",
          message: "priority must be a finite number.",
        },
        {
          path: "componentMappings.1.source",
          message:
            "source must be either 'local_override' or 'code_connect_import'.",
        },
        {
          path: "componentMappings.1.enabled",
          message: "enabled must be a boolean.",
        },
        {
          path: "componentMappings.1.propContract",
          message: "propContract must be an object when provided.",
        },
      ],
    );
  }
});

test("schema: submit request parses visualAudit configuration deeply", () => {
  const result = SubmitRequestSchema.safeParse({
    figmaFileKey: "abc123",
    figmaAccessToken: "figd_xxx",
    visualAudit: {
      baselineImagePath: " ./snapshots/home.png ",
      capture: {
        viewport: {
          width: 1440,
          height: 900,
          deviceScaleFactor: 2,
        },
        waitForNetworkIdle: true,
        waitForFonts: false,
        waitForAnimations: true,
        timeoutMs: 5000,
        fullPage: false,
      },
      diff: {
        threshold: 0.1,
        includeAntialiasing: true,
        alpha: 0.5,
      },
      regions: [
        {
          name: " hero ",
          x: 0,
          y: 10,
          width: 1200,
          height: 400,
        },
      ],
    },
  });

  assert.equal(result.success, true);
  if (result.success) {
    assert.deepEqual(result.data.visualAudit, {
      baselineImagePath: "./snapshots/home.png",
      capture: {
        viewport: {
          width: 1440,
          height: 900,
          deviceScaleFactor: 2,
        },
        waitForNetworkIdle: true,
        waitForFonts: false,
        waitForAnimations: true,
        timeoutMs: 5000,
        fullPage: false,
      },
      diff: {
        threshold: 0.1,
        includeAntialiasing: true,
        alpha: 0.5,
      },
      regions: [
        {
          name: "hero",
          x: 0,
          y: 10,
          width: 1200,
          height: 400,
        },
      ],
    });
  }
});

test("schema: submit request rejects non-object and malformed visualAudit payloads with exact issues", () => {
  const nonObject = SubmitRequestSchema.safeParse({
    figmaFileKey: "abc123",
    figmaAccessToken: "figd_xxx",
    visualAudit: true,
  });

  assert.equal(nonObject.success, false);
  if (!nonObject.success) {
    assert.deepEqual(nonObject.error.issues, [
      {
        path: ["visualAudit"],
        message: "visualAudit must be an object when provided.",
      },
    ]);
  }

  const malformed = SubmitRequestSchema.safeParse({
    figmaFileKey: "abc123",
    figmaAccessToken: "figd_xxx",
    visualAudit: {
      baselineImagePath: "   ",
      unexpected: true,
      capture: {
        viewport: {
          width: 0,
          height: 1.5,
          deviceScaleFactor: 0,
          extra: true,
        },
        waitForNetworkIdle: "yes",
        waitForFonts: 1,
        waitForAnimations: null,
        timeoutMs: 0,
        fullPage: "full",
        extra: true,
      },
      diff: {
        threshold: 1.5,
        includeAntialiasing: "yes",
        alpha: -0.1,
        extra: true,
      },
      regions: [
        null,
        {
          name: "   ",
          x: -1,
          y: 1.2,
          width: 0,
          height: "tall",
          extra: true,
        },
      ],
    },
  });

  assert.equal(malformed.success, false);
  if (!malformed.success) {
    assert.deepEqual(
      malformed.error.issues.map((issue) => issue.path.join(".")),
      [
        "visualAudit.unexpected",
        "visualAudit.baselineImagePath",
        "visualAudit.capture.extra",
        "visualAudit.capture.viewport.extra",
        "visualAudit.capture.viewport.width",
        "visualAudit.capture.viewport.height",
        "visualAudit.capture.viewport.deviceScaleFactor",
        "visualAudit.capture.timeoutMs",
        "visualAudit.capture.waitForNetworkIdle",
        "visualAudit.capture.waitForFonts",
        "visualAudit.capture.waitForAnimations",
        "visualAudit.capture.fullPage",
        "visualAudit.diff.extra",
        "visualAudit.diff.includeAntialiasing",
        "visualAudit.diff.threshold",
        "visualAudit.diff.alpha",
        "visualAudit.regions.0",
        "visualAudit.regions.1.extra",
        "visualAudit.regions.1.name",
        "visualAudit.regions.1.x",
        "visualAudit.regions.1.y",
        "visualAudit.regions.1.width",
        "visualAudit.regions.1.height",
      ],
    );
    assert.deepEqual(
      malformed.error.issues
        .filter((issue) =>
          [
            "visualAudit.capture.viewport.height",
            "visualAudit.capture.waitForNetworkIdle",
            "visualAudit.diff.includeAntialiasing",
            "visualAudit.regions.1.width",
          ].includes(issue.path.join(".")),
        )
        .map((issue) => issue.message),
      [
        "height must be an integer when provided.",
        "waitForNetworkIdle must be a boolean when provided.",
        "includeAntialiasing must be a boolean when provided.",
        "width must be greater than 0.",
      ],
    );
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
    previewEnabled: true,
    testIntelligenceEnabled: true,
    testIntelligenceMultiSourceEnabled: false,
  });
  assert.equal(result.success, true);
  if (result.success) {
    assert.deepEqual(result.data, {
      running: true,
      url: "http://127.0.0.1:1983",
      host: "127.0.0.1",
      port: 1983,
      figmaSourceMode: "rest",
      llmCodegenMode: "deterministic",
      uptimeMs: 1234,
      outputRoot: "/tmp/.workspace-dev",
      previewEnabled: true,
      testIntelligenceEnabled: true,
      testIntelligenceMultiSourceEnabled: false,
    });
  }
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
    previewEnabled: true,
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
    previewEnabled: true,
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
    previewEnabled: true,
  });
  assert.equal(result.success, true);
});

test("schema: workspace status allows figma_paste figmaSourceMode", () => {
  const result = WorkspaceStatusSchema.safeParse({
    running: true,
    url: "http://127.0.0.1:1983",
    host: "127.0.0.1",
    port: 1983,
    figmaSourceMode: "figma_paste",
    llmCodegenMode: "deterministic",
    uptimeMs: 1234,
    outputRoot: "/tmp/.workspace-dev",
    previewEnabled: true,
  });
  assert.equal(result.success, true);
});

test("schema: workspace status allows figma_plugin figmaSourceMode", () => {
  const result = WorkspaceStatusSchema.safeParse({
    running: true,
    url: "http://127.0.0.1:1983",
    host: "127.0.0.1",
    port: 1983,
    figmaSourceMode: "figma_plugin",
    llmCodegenMode: "deterministic",
    uptimeMs: 1234,
    outputRoot: "/tmp/.workspace-dev",
    previewEnabled: true,
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
    uptimeMs: 1234,
  });
  assert.equal(result.success, false);
});

test("schema: workspace status rejects non-object and invalid field types with exact issues", () => {
  const notObject = WorkspaceStatusSchema.safeParse(null);
  assert.equal(notObject.success, false);
  if (!notObject.success) {
    assert.deepEqual(notObject.error.issues, [
      {
        path: [],
        message: "Expected an object body.",
      },
    ]);
  }

  const invalid = WorkspaceStatusSchema.safeParse({
    running: "yes",
    url: 123,
    host: false,
    port: 0,
    figmaSourceMode: "mcp",
    llmCodegenMode: "hybrid",
    uptimeMs: -1,
    outputRoot: "",
    previewEnabled: "no",
    testIntelligenceEnabled: "yes",
    testIntelligenceMultiSourceEnabled: 1,
  });
  assert.equal(invalid.success, false);
  if (!invalid.success) {
    assert.deepEqual(invalid.error.issues, [
      {
        path: ["running"],
        message: "running must be a boolean",
      },
      {
        path: ["url"],
        message: "url must be a string",
      },
      {
        path: ["host"],
        message: "host must be a string",
      },
      {
        path: ["port"],
        message: "port must be a positive integer",
      },
      {
        path: ["figmaSourceMode"],
        message:
          "figmaSourceMode must be one of: rest, hybrid, local_json, figma_paste, figma_plugin",
      },
      {
        path: ["llmCodegenMode"],
        message: "llmCodegenMode must equal 'deterministic'",
      },
      {
        path: ["uptimeMs"],
        message: "uptimeMs must be a non-negative number",
      },
      {
        path: ["outputRoot"],
        message: "outputRoot must be a non-empty string",
      },
      {
        path: ["previewEnabled"],
        message: "previewEnabled must be a boolean",
      },
      {
        path: ["testIntelligenceEnabled"],
        message: "testIntelligenceEnabled must be a boolean",
      },
      {
        path: ["testIntelligenceMultiSourceEnabled"],
        message: "testIntelligenceMultiSourceEnabled must be a boolean",
      },
    ]);
  }
});

test("schema: error envelope requires message and error strings", () => {
  const result = ErrorResponseSchema.safeParse({
    error: "X",
    message: "Y",
  });
  assert.equal(result.success, true);

  const invalid = ErrorResponseSchema.safeParse({ error: "X", message: 1 });
  assert.equal(invalid.success, false);

  const notObject = ErrorResponseSchema.safeParse(undefined);
  assert.equal(notObject.success, false);
});

test("schema: error envelope returns exact data and field issues", () => {
  const result = ErrorResponseSchema.safeParse({
    error: "VALIDATION_ERROR",
    message: "Request validation failed.",
  });
  assert.equal(result.success, true);
  if (result.success) {
    assert.deepEqual(result.data, {
      error: "VALIDATION_ERROR",
      message: "Request validation failed.",
    });
  }

  const invalid = ErrorResponseSchema.safeParse({
    error: 404,
    message: false,
  });
  assert.equal(invalid.success, false);
  if (!invalid.success) {
    assert.deepEqual(invalid.error.issues, [
      {
        path: ["error"],
        message: "error must be a string",
      },
      {
        path: ["message"],
        message: "message must be a string",
      },
    ]);
  }

  const notObject = ErrorResponseSchema.safeParse("bad-envelope");
  assert.equal(notObject.success, false);
  if (!notObject.success) {
    assert.deepEqual(notObject.error.issues, [
      {
        path: [],
        message: "Expected an object body.",
      },
    ]);
  }
});

// ---------------------------------------------------------------------------
// RegenerationRequestSchema
// ---------------------------------------------------------------------------

test("schema: valid regeneration request accepts layout overrides", () => {
  const result = RegenerationRequestSchema.safeParse({
    overrides: [
      { nodeId: "node-1", field: "width", value: 420 },
      { nodeId: "node-1", field: "layoutMode", value: "horizontal" },
      {
        nodeId: "node-1",
        field: "primaryAxisAlignItems",
        value: "space_between",
      },
    ],
    draftId: "draft-1",
    baseFingerprint: "fp-1",
    customerBrandId: " sparkasse-retail ",
  });

  assert.equal(result.success, true);
  if (result.success) {
    assert.deepEqual(result.data.overrides, [
      { nodeId: "node-1", field: "width", value: 420 },
      { nodeId: "node-1", field: "layoutMode", value: "HORIZONTAL" },
      {
        nodeId: "node-1",
        field: "primaryAxisAlignItems",
        value: "SPACE_BETWEEN",
      },
    ]);
    assert.equal(result.data.draftId, "draft-1");
    assert.equal(result.data.baseFingerprint, "fp-1");
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
        enabled: true,
      },
    ],
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
        enabled: true,
      },
    ]);
  }
});

test("schema: regeneration request rejects empty customerBrandId", () => {
  const result = RegenerationRequestSchema.safeParse({
    overrides: [],
    customerBrandId: "   ",
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
        enabled: true,
      },
    ],
  });

  assert.equal(result.success, false);
  if (!result.success) {
    assert.deepEqual(result.error.issues, [
      {
        path: ["componentMappings", 0],
        message:
          "pattern component mapping rules must define at least one selector: nodeNamePattern, canonicalComponentName, storybookTier, figmaLibrary, or semanticType.",
      },
    ]);
  }
});

test("schema: regeneration request rejects unsupported layout fields", () => {
  const result = RegenerationRequestSchema.safeParse({
    overrides: [{ nodeId: "node-1", field: "maxWidth", value: 480 }],
  });

  assert.equal(result.success, false);
});

test("schema: regeneration request rejects invalid layout values", () => {
  const result = RegenerationRequestSchema.safeParse({
    overrides: [
      { nodeId: "node-1", field: "width", value: 0 },
      { nodeId: "node-1", field: "layoutMode", value: "row" },
      { nodeId: "node-1", field: "counterAxisAlignItems", value: "stretch" },
    ],
  });

  assert.equal(result.success, false);
});

test("schema: regeneration request rejects unexpected top-level properties", () => {
  const result = RegenerationRequestSchema.safeParse({
    overrides: [{ nodeId: "node-1", field: "width", value: 320 }],
    unexpected: true,
  });

  assert.equal(result.success, false);
  if (!result.success) {
    assert.deepEqual(result.error.issues, [
      {
        path: ["unexpected"],
        message: "Unexpected property 'unexpected'.",
      },
    ]);
  }
});

test("schema: regeneration request rejects non-object bodies and non-array overrides exactly", () => {
  const notObject = RegenerationRequestSchema.safeParse(undefined);
  assert.equal(notObject.success, false);
  if (!notObject.success) {
    assert.deepEqual(notObject.error.issues, [
      {
        path: [],
        message: "Expected an object body.",
      },
    ]);
  }

  const nonArrayOverrides = RegenerationRequestSchema.safeParse({
    overrides: true,
  });
  assert.equal(nonArrayOverrides.success, false);
  if (!nonArrayOverrides.success) {
    assert.deepEqual(nonArrayOverrides.error.issues, [
      {
        path: ["overrides"],
        message: "overrides must be an array.",
      },
    ]);
  }
});

test("schema: regeneration request rejects malformed overrides and optional string fields with exact issues", () => {
  const result = RegenerationRequestSchema.safeParse({
    overrides: [
      null,
      { nodeId: "   ", field: "width", value: 320 },
      { nodeId: "node-2", field: "   ", value: 320 },
      { nodeId: "node-3", field: "width", value: 0 },
    ],
    draftId: "   ",
    baseFingerprint: "",
    customerBrandId: false,
  });

  assert.equal(result.success, false);
  if (!result.success) {
    assert.deepEqual(result.error.issues, [
      {
        path: ["overrides", 0],
        message: "Each override entry must be an object.",
      },
      {
        path: ["overrides", 1, "nodeId"],
        message: "nodeId must be a non-empty string.",
      },
      {
        path: ["overrides", 2, "field"],
        message: "field must be a non-empty string.",
      },
      {
        path: ["overrides", 3, "value"],
        message: "width must be a finite positive number.",
      },
      {
        path: ["draftId"],
        message: "draftId must be a non-empty string when provided.",
      },
      {
        path: ["baseFingerprint"],
        message: "baseFingerprint must be a non-empty string when provided.",
      },
      {
        path: ["customerBrandId"],
        message: "customerBrandId must be a non-empty string when provided.",
      },
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
    issues: [{ path: [], message: "root issue" }],
  });
  assert.equal(formatted.issues[0]?.path, "(root)");
});

test("schema: formatZodError joins nested issue paths with dots", () => {
  const formatted = formatZodError({
    issues: [
      { path: ["componentMappings", 0, "source"], message: "bad source" },
    ],
  });
  assert.deepEqual(formatted.issues, [
    {
      path: "componentMappings.0.source",
      message: "bad source",
    },
  ]);
});

test("schema: sync dry_run parses with optional targetPath", () => {
  const result = SyncRequestSchema.safeParse({
    mode: "dry_run",
    targetPath: "apps/generated",
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
        message: "Expected an object body.",
      },
    ]);
  }
});

test("schema: sync request rejects unsupported modes with an exact mode issue", () => {
  const result = SyncRequestSchema.safeParse({
    mode: "preview",
  });
  assert.equal(result.success, false);
  if (!result.success) {
    assert.deepEqual(result.error.issues, [
      {
        path: ["mode"],
        message: "mode must be one of: dry_run, apply.",
      },
    ]);
  }
});

test("schema: sync dry_run preserves a non-empty targetPath verbatim", () => {
  const result = SyncRequestSchema.safeParse({
    mode: "dry_run",
    targetPath: "  apps/generated  ",
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
    targetPath: "   ",
  });
  assert.equal(blank.success, false);
  if (!blank.success) {
    assert.deepEqual(blank.error.issues, [
      {
        path: ["targetPath"],
        message: "targetPath must be a non-empty string when provided.",
      },
    ]);
  }

  const nonString = SyncRequestSchema.safeParse({
    mode: "dry_run",
    targetPath: 123,
  });
  assert.equal(nonString.success, false);
  if (!nonString.success) {
    assert.deepEqual(nonString.error.issues, [
      {
        path: ["targetPath"],
        message: "targetPath must be a non-empty string when provided.",
      },
    ]);
  }
});

test("schema: sync apply requires token and explicit confirmation", () => {
  const invalid = SyncRequestSchema.safeParse({
    mode: "apply",
    confirmationToken: "",
    confirmOverwrite: false,
    fileDecisions: [],
  });
  assert.equal(invalid.success, false);

  const valid = SyncRequestSchema.safeParse({
    mode: "apply",
    confirmationToken: "token-123",
    confirmOverwrite: true,
    fileDecisions: [
      {
        path: "src/App.tsx",
        decision: "write",
      },
    ],
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
        decision: "write",
      },
      {
        path: "\tsrc/Skip.tsx\t",
        decision: "skip",
      },
    ],
  });
  assert.equal(result.success, true);
  if (result.success) {
    assert.equal(result.data.confirmationToken, "token-123");
    assert.equal(result.data.confirmOverwrite, true);
    assert.deepEqual(result.data.fileDecisions, [
      {
        path: "src/App.tsx",
        decision: "write",
      },
      {
        path: "src/Skip.tsx",
        decision: "skip",
      },
    ]);
  }
});

test("schema: sync apply trims reviewerNote when provided", () => {
  const result = SyncRequestSchema.safeParse({
    mode: "apply",
    confirmationToken: "token-123",
    confirmOverwrite: true,
    fileDecisions: [
      {
        path: "src/App.tsx",
        decision: "write",
      },
    ],
    reviewerNote: "  Approved after review.  ",
  });
  assert.equal(result.success, true);
  if (result.success) {
    assert.equal(result.data.reviewerNote, "Approved after review.");
  }
});

test("schema: sync apply reports exact token, overwrite, and file decision issues", () => {
  const result = SyncRequestSchema.safeParse({
    mode: "apply",
    confirmationToken: "",
    confirmOverwrite: false,
    fileDecisions: [],
  });
  assert.equal(result.success, false);
  if (!result.success) {
    assert.deepEqual(result.error.issues, [
      {
        path: ["confirmationToken"],
        message: "confirmationToken must be a non-empty string.",
      },
      {
        path: ["confirmOverwrite"],
        message: "confirmOverwrite must be true for apply mode.",
      },
      {
        path: ["fileDecisions"],
        message: "fileDecisions must be a non-empty array.",
      },
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
        decision: "overwrite",
      },
    ],
  });
  assert.equal(result.success, false);
  if (!result.success) {
    assert.deepEqual(result.error.issues, [
      {
        path: ["fileDecisions", 0],
        message: "Each fileDecisions entry must be an object.",
      },
      {
        path: ["fileDecisions", 1, "path"],
        message: "path must be a non-empty string.",
      },
      {
        path: ["fileDecisions", 1, "decision"],
        message: "decision must be one of: write, skip.",
      },
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
        decision: "write",
      },
      {
        path: "  src/App.tsx  ",
        decision: "skip",
      },
    ],
  });
  assert.equal(result.success, false);
  if (!result.success) {
    assert.deepEqual(result.error.issues, [
      {
        path: ["fileDecisions", 1, "path"],
        message: "Duplicate decision for 'src/App.tsx'.",
      },
    ]);
  }
});

test("schema: sync dry_run rejects unexpected properties", () => {
  const result = SyncRequestSchema.safeParse({
    mode: "dry_run",
    targetPath: "apps/generated",
    unexpected: true,
  });

  assert.equal(result.success, false);
  if (!result.success) {
    assert.deepEqual(result.error.issues, [
      {
        path: ["unexpected"],
        message: "Unexpected property 'unexpected'.",
      },
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
        decision: "write",
      },
    ],
    unexpected: true,
  });

  assert.equal(result.success, false);
  if (!result.success) {
    assert.deepEqual(result.error.issues, [
      {
        path: ["unexpected"],
        message: "Unexpected property 'unexpected'.",
      },
    ]);
  }
});

test("schema: sync apply rejects blank reviewerNote values", () => {
  const result = SyncRequestSchema.safeParse({
    mode: "apply",
    confirmationToken: "token-123",
    confirmOverwrite: true,
    fileDecisions: [
      {
        path: "src/App.tsx",
        decision: "write",
      },
    ],
    reviewerNote: "   ",
  });

  assert.equal(result.success, false);
  if (!result.success) {
    assert.deepEqual(result.error.issues, [
      {
        path: ["reviewerNote"],
        message: "reviewerNote must be a non-empty string when provided.",
      },
    ]);
  }
});

// ---------------------------------------------------------------------------
// CreatePrRequestSchema
// ---------------------------------------------------------------------------

test("schema: create-pr requires repoUrl and repoToken", () => {
  const missing = CreatePrRequestSchema.safeParse({});
  assert.equal(missing.success, false);

  const emptyUrl = CreatePrRequestSchema.safeParse({
    repoUrl: "",
    repoToken: "tok",
  });
  assert.equal(emptyUrl.success, false);

  const emptyToken = CreatePrRequestSchema.safeParse({
    repoUrl: "https://github.com/acme/repo",
    repoToken: "",
  });
  assert.equal(emptyToken.success, false);
});

test("schema: create-pr rejects non-object bodies and reports exact required-field issues", () => {
  const notObject = CreatePrRequestSchema.safeParse("bad-body");
  assert.equal(notObject.success, false);
  if (!notObject.success) {
    assert.deepEqual(notObject.error.issues, [
      {
        path: [],
        message: "Expected an object body.",
      },
    ]);
  }

  const missing = CreatePrRequestSchema.safeParse({});
  assert.equal(missing.success, false);
  if (!missing.success) {
    assert.deepEqual(missing.error.issues, [
      {
        path: ["repoUrl"],
        message: "repoUrl must be a non-empty string.",
      },
      {
        path: ["repoToken"],
        message: "repoToken must be a non-empty string.",
      },
    ]);
  }
});

test("schema: create-pr parses valid input with optional targetPath", () => {
  const result = CreatePrRequestSchema.safeParse({
    repoUrl: "https://github.com/acme/repo",
    repoToken: "ghp_abc123",
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
    targetPath: "generated",
  });
  assert.equal(withTarget.success, true);
  if (withTarget.success) {
    assert.equal(withTarget.data.targetPath, "generated");
  }

  const withReviewerNote = CreatePrRequestSchema.safeParse({
    repoUrl: "https://github.com/acme/repo",
    repoToken: "ghp_abc123",
    reviewerNote: "  Approved for PR.  ",
  });
  assert.equal(withReviewerNote.success, true);
  if (withReviewerNote.success) {
    assert.equal(withReviewerNote.data.reviewerNote, "Approved for PR.");
  }
});

test("schema: create-pr targetPath preserves non-empty strings and rejects blank ones", () => {
  const preserved = CreatePrRequestSchema.safeParse({
    repoUrl: "https://github.com/acme/repo",
    repoToken: "ghp_abc123",
    targetPath: "  generated/subdir  ",
  });
  assert.equal(preserved.success, true);
  if (preserved.success) {
    assert.equal(preserved.data.targetPath, "  generated/subdir  ");
  }

  const blank = CreatePrRequestSchema.safeParse({
    repoUrl: "https://github.com/acme/repo",
    repoToken: "ghp_abc123",
    targetPath: "   ",
  });
  assert.equal(blank.success, false);
  if (!blank.success) {
    assert.deepEqual(blank.error.issues, [
      {
        path: ["targetPath"],
        message: "targetPath must be a non-empty string when provided.",
      },
    ]);
  }
});

test("schema: create-pr rejects unexpected properties", () => {
  const result = CreatePrRequestSchema.safeParse({
    repoUrl: "https://github.com/acme/repo",
    repoToken: "tok",
    extraField: "nope",
  });
  assert.equal(result.success, false);
  if (!result.success) {
    assert.deepEqual(result.error.issues, [
      {
        path: ["extraField"],
        message: "Unexpected property 'extraField'.",
      },
    ]);
  }
});

test("schema: create-pr rejects blank reviewerNote values", () => {
  const result = CreatePrRequestSchema.safeParse({
    repoUrl: "https://github.com/acme/repo",
    repoToken: "tok",
    reviewerNote: "   ",
  });
  assert.equal(result.success, false);
  if (!result.success) {
    assert.deepEqual(result.error.issues, [
      {
        path: ["reviewerNote"],
        message: "reviewerNote must be a non-empty string when provided.",
      },
    ]);
  }
});

// ---------------------------------------------------------------------------
// SubmitRequestSchema — figma_paste mode
// ---------------------------------------------------------------------------

test("schema: figma_paste mode accepts a valid JSON payload", () => {
  const result = SubmitRequestSchema.safeParse({
    figmaSourceMode: "figma_paste",
    figmaJsonPayload: JSON.stringify({
      name: "Test",
      document: { id: "0:0", type: "DOCUMENT", children: [] },
    }),
  });
  assert.equal(result.success, true);
  if (result.success) {
    assert.equal(result.data.figmaSourceMode, "figma_paste");
    assert.ok(typeof result.data.figmaJsonPayload === "string");
  }
});

test("schema: figma_paste mode rejects missing figmaJsonPayload with INVALID_PAYLOAD", () => {
  const result = SubmitRequestSchema.safeParse({
    figmaSourceMode: "figma_paste",
  });
  assert.equal(result.success, false);
  if (!result.success) {
    const issue = result.error.issues.find((i) =>
      i.message.startsWith("INVALID_PAYLOAD:"),
    );
    assert.ok(issue, "Expected an INVALID_PAYLOAD issue");
  }
});

test("schema: figma_paste mode rejects malformed JSON payload with SCHEMA_MISMATCH", () => {
  const result = SubmitRequestSchema.safeParse({
    figmaSourceMode: "figma_paste",
    figmaJsonPayload: "{ not valid json }",
  });
  assert.equal(result.success, false);
  if (!result.success) {
    const issue = result.error.issues.find((i) =>
      i.message.startsWith("SCHEMA_MISMATCH:"),
    );
    assert.ok(issue, "Expected a SCHEMA_MISMATCH issue");
  }
});

test("schema: figma_paste mode rejects structurally invalid JSON payload with SCHEMA_MISMATCH", () => {
  const result = SubmitRequestSchema.safeParse({
    figmaSourceMode: "figma_paste",
    figmaJsonPayload: JSON.stringify({ name: "bad-payload" }),
  });
  assert.equal(result.success, false);
  if (!result.success) {
    const issue = result.error.issues.find((i) =>
      i.message.startsWith("SCHEMA_MISMATCH:"),
    );
    assert.ok(issue, "Expected a SCHEMA_MISMATCH issue");
  }
});

test("schema: figma_paste mode rejects oversize payload with TOO_LARGE", () => {
  const oversizePayload = "x".repeat(DEFAULT_FIGMA_PASTE_MAX_BYTES + 1);
  const result = SubmitRequestSchema.safeParse({
    figmaSourceMode: "figma_paste",
    figmaJsonPayload: oversizePayload,
  });
  assert.equal(result.success, false);
  if (!result.success) {
    const issue = result.error.issues.find((i) =>
      i.message.startsWith("TOO_LARGE:"),
    );
    assert.ok(issue, "Expected a TOO_LARGE issue");
  }
});

test("schema: figma_paste accepts a whole-view-sized payload under the 6 MiB limit", () => {
  // 5 MiB valid JSON string — below the 6 MiB figma-paste cap.
  const filler = "a".repeat(5 * 1024 * 1024);
  const wholeViewPayload = JSON.stringify({
    name: "whole-view",
    document: { id: "0:0", type: "DOCUMENT", children: [] },
    filler,
  });
  const result = SubmitRequestSchema.safeParse({
    figmaSourceMode: "figma_paste",
    figmaJsonPayload: wholeViewPayload,
  });
  assert.equal(result.success, true);
});

test("schema: figma_paste rejects payloads that exceed the submit transport budget", () => {
  const original = process.env.WORKSPACE_FIGMA_PASTE_MAX_BYTES;
  process.env.WORKSPACE_FIGMA_PASTE_MAX_BYTES = String(
    MAX_SUBMIT_BODY_BYTES + 1024,
  );

  try {
    const wholeViewPayload = JSON.stringify({
      name: "whole-view",
      document: { id: "0:0", type: "DOCUMENT", children: [] },
      filler: "x".repeat(MAX_SUBMIT_BODY_BYTES),
    });
    const result = SubmitRequestSchema.safeParse({
      figmaSourceMode: "figma_paste",
      figmaJsonPayload: wholeViewPayload,
    });
    assert.equal(result.success, false);
    if (!result.success) {
      const issue = result.error.issues.find((i) =>
        i.message.startsWith("TOO_LARGE:"),
      );
      assert.ok(issue, "Expected a TOO_LARGE issue");
    }
  } finally {
    if (original === undefined) {
      delete process.env.WORKSPACE_FIGMA_PASTE_MAX_BYTES;
    } else {
      process.env.WORKSPACE_FIGMA_PASTE_MAX_BYTES = original;
    }
  }
});

// ---------------------------------------------------------------------------
// SubmitRequestSchema — figma_paste mode with clipboard envelope
// ---------------------------------------------------------------------------

test("schema: figma_paste mode accepts a valid ClipboardEnvelope payload", () => {
  const envelope = readPasteFixture<Record<string, unknown>>(
    "envelopes/single-selection-envelope.json",
  );
  const result = SubmitRequestSchema.safeParse({
    figmaSourceMode: "figma_paste",
    figmaJsonPayload: JSON.stringify(envelope),
  });
  assert.equal(result.success, true);
  if (result.success) {
    assert.equal(result.data.figmaSourceMode, "figma_paste");
    assert.ok(typeof result.data.figmaJsonPayload === "string");
  }
});

test("schema: figma_paste mode rejects invalid ClipboardEnvelope with SCHEMA_MISMATCH", () => {
  const badEnvelope = readPasteFixture<Record<string, unknown>>(
    "envelopes/invalid-empty-selections-envelope.json",
  );
  const result = SubmitRequestSchema.safeParse({
    figmaSourceMode: "figma_paste",
    figmaJsonPayload: JSON.stringify(badEnvelope),
  });
  assert.equal(result.success, false);
  if (!result.success) {
    const issue = result.error.issues.find((i) =>
      i.message.startsWith("SCHEMA_MISMATCH:"),
    );
    assert.ok(issue, "Expected a SCHEMA_MISMATCH issue for empty selections");
  }
});

test("schema: figma_paste mode rejects unknown envelope kind with UNSUPPORTED_CLIPBOARD_KIND", () => {
  const unknownEnvelope = readPasteFixture<Record<string, unknown>>(
    "envelopes/unsupported-version-envelope.json",
  );
  const result = SubmitRequestSchema.safeParse({
    figmaSourceMode: "figma_paste",
    figmaJsonPayload: JSON.stringify(unknownEnvelope),
  });
  assert.equal(result.success, false);
  if (!result.success) {
    const issue = result.error.issues.find((i) =>
      i.message.startsWith("UNSUPPORTED_CLIPBOARD_KIND:"),
    );
    assert.ok(
      issue,
      "Expected an UNSUPPORTED_CLIPBOARD_KIND issue for unknown envelope kind",
    );
  }
});

test("schema: figma_plugin mode rejects unknown envelope kind with UNSUPPORTED_FORMAT", () => {
  const unknownEnvelope = readPasteFixture<Record<string, unknown>>(
    "envelopes/unsupported-version-envelope.json",
  );
  const result = SubmitRequestSchema.safeParse({
    figmaSourceMode: "figma_plugin",
    figmaJsonPayload: JSON.stringify(unknownEnvelope),
  });
  assert.equal(result.success, false);
  if (!result.success) {
    const issue = result.error.issues.find((i) =>
      i.message.startsWith("UNSUPPORTED_FORMAT:"),
    );
    assert.ok(issue, "Expected an UNSUPPORTED_FORMAT issue for figma_plugin");
  }
});

test("schema: figma_plugin mode rejects missing figmaJsonPayload with INVALID_PAYLOAD", () => {
  const result = SubmitRequestSchema.safeParse({
    figmaSourceMode: "figma_plugin",
  });
  assert.equal(result.success, false);
  if (!result.success) {
    const issue = result.error.issues.find((i) =>
      i.message.startsWith("INVALID_PAYLOAD:"),
    );
    assert.ok(issue, "Expected an INVALID_PAYLOAD issue for figma_plugin");
  }
});

test("schema: figma_plugin mode rejects malformed JSON payload with SCHEMA_MISMATCH", () => {
  const result = SubmitRequestSchema.safeParse({
    figmaSourceMode: "figma_plugin",
    figmaJsonPayload: "{ not valid json }",
  });
  assert.equal(result.success, false);
  if (!result.success) {
    const issue = result.error.issues.find((i) =>
      i.message.startsWith("SCHEMA_MISMATCH:"),
    );
    assert.ok(issue, "Expected a SCHEMA_MISMATCH issue for figma_plugin");
  }
});

test("schema: figma_plugin mode rejects oversize payload with TOO_LARGE", () => {
  const oversizePayload = "x".repeat(DEFAULT_FIGMA_PASTE_MAX_BYTES + 1);
  const result = SubmitRequestSchema.safeParse({
    figmaSourceMode: "figma_plugin",
    figmaJsonPayload: oversizePayload,
  });
  assert.equal(result.success, false);
  if (!result.success) {
    const issue = result.error.issues.find((i) =>
      i.message.startsWith("TOO_LARGE:"),
    );
    assert.ok(issue, "Expected a TOO_LARGE issue for figma_plugin");
  }
});

test("schema: figma_paste mode accepts multi-selection ClipboardEnvelope", () => {
  const envelope = readPasteFixture<Record<string, unknown>>(
    "envelopes/composite-selection-envelope.json",
  );
  const result = SubmitRequestSchema.safeParse({
    figmaSourceMode: "figma_paste",
    figmaJsonPayload: JSON.stringify(envelope),
  });
  assert.equal(result.success, true);
});

test("schema: figma_paste mode rejects under-cap envelopes with too many selections", () => {
  const envelope = {
    kind: "workspace-dev/figma-selection@1",
    pluginVersion: "1.0.0",
    copiedAt: "2026-04-18T12:00:00.000Z",
    selections: Array.from(
      { length: DEFAULT_FIGMA_PASTE_MAX_SELECTION_COUNT + 1 },
      (_, index) => ({
        document: {
          id: `selection-${index}`,
          type: "FRAME",
          name: `Selection ${index + 1}`,
        },
        components: {},
        componentSets: {},
        styles: {},
      }),
    ),
  };
  const result = SubmitRequestSchema.safeParse({
    figmaSourceMode: "figma_paste",
    figmaJsonPayload: JSON.stringify(envelope),
  });
  assert.equal(result.success, false);
  if (!result.success) {
    const issue = result.error.issues.find((entry) =>
      entry.message.startsWith("TOO_LARGE:"),
    );
    assert.ok(issue, "Expected a TOO_LARGE issue for selection count");
    assert.match(issue.message, /selection count budget/i);
  }
});

test("schema: figma_paste mode rejects envelopes whose normalized wrapper nodes exceed the node budget", () => {
  const selectionChildCount = DEFAULT_FIGMA_PASTE_MAX_NODE_COUNT / 2 - 1;
  const envelope = {
    kind: "workspace-dev/figma-selection@1",
    pluginVersion: "1.0.0",
    copiedAt: "2026-04-18T12:00:00.000Z",
    selections: Array.from({ length: 2 }, (_, selectionIndex) => ({
      document: {
        id: `selection-${selectionIndex}`,
        type: "FRAME",
        name: `Selection ${selectionIndex + 1}`,
        children: Array.from(
          { length: selectionChildCount },
          (_, childIndex) => ({
            id: `${selectionIndex}:${childIndex + 1}`,
            type: "FRAME",
            name: `Child ${childIndex + 1}`,
            children: [],
          }),
        ),
      },
      components: {},
      componentSets: {},
      styles: {},
    })),
  };
  const result = SubmitRequestSchema.safeParse({
    figmaSourceMode: "figma_paste",
    figmaJsonPayload: JSON.stringify(envelope),
  });
  assert.equal(result.success, false);
  if (!result.success) {
    const issue = result.error.issues.find((entry) =>
      entry.message.startsWith("TOO_LARGE:"),
    );
    assert.ok(issue, "Expected a TOO_LARGE issue for normalized wrapper nodes");
    assert.match(issue.message, /node count budget/i);
  }
});

test("schema: figma_paste mode rejects under-cap documents with too many roots", () => {
  const payload = {
    name: "Too many roots",
    document: {
      id: "0:0",
      type: "DOCUMENT",
      children: Array.from(
        { length: DEFAULT_FIGMA_PASTE_MAX_ROOT_COUNT + 1 },
        (_, index) => ({
          id: `1:${index + 1}`,
          type: "CANVAS",
          name: `Root ${index + 1}`,
          children: [],
        }),
      ),
    },
  };
  const result = SubmitRequestSchema.safeParse({
    figmaSourceMode: "figma_paste",
    figmaJsonPayload: JSON.stringify(payload),
  });
  assert.equal(result.success, false);
  if (!result.success) {
    const issue = result.error.issues.find((entry) =>
      entry.message.startsWith("TOO_LARGE:"),
    );
    assert.ok(issue, "Expected a TOO_LARGE issue for root count");
    assert.match(issue.message, /root count budget/i);
  }
});

test("schema: figma_paste mode rejects under-cap documents with too many nodes", () => {
  const payload = {
    name: "Too many nodes",
    document: {
      id: "0:0",
      type: "DOCUMENT",
      children: [
        {
          id: "1:1",
          type: "CANVAS",
          name: "Page 1",
          children: Array.from(
            { length: DEFAULT_FIGMA_PASTE_MAX_NODE_COUNT },
            (_, index) => ({
              id: `2:${index + 1}`,
              type: "FRAME",
              name: `Frame ${index + 1}`,
              children: [],
            }),
          ),
        },
      ],
    },
  };
  const result = SubmitRequestSchema.safeParse({
    figmaSourceMode: "figma_paste",
    figmaJsonPayload: JSON.stringify(payload),
  });
  assert.equal(result.success, false);
  if (!result.success) {
    const issue = result.error.issues.find((entry) =>
      entry.message.startsWith("TOO_LARGE:"),
    );
    assert.ok(issue, "Expected a TOO_LARGE issue for node count");
    assert.match(issue.message, /node count budget/i);
  }
});

// ---------------------------------------------------------------------------
// SubmitRequestSchema — importIntent with FIGMA_PLUGIN_ENVELOPE
// ---------------------------------------------------------------------------

test("schema: importIntent=FIGMA_PLUGIN_ENVELOPE is accepted", () => {
  const result = SubmitRequestSchema.safeParse({
    figmaSourceMode: "figma_paste",
    figmaJsonPayload: JSON.stringify({
      name: "Test",
      document: { id: "0:0", type: "DOCUMENT", children: [] },
    }),
    importIntent: "FIGMA_PLUGIN_ENVELOPE",
  });
  assert.equal(result.success, true);
  if (result.success) {
    assert.equal(result.data.importIntent, "FIGMA_PLUGIN_ENVELOPE");
  }
});

test("schema: originalIntent=FIGMA_PLUGIN_ENVELOPE is accepted", () => {
  const result = SubmitRequestSchema.safeParse({
    figmaSourceMode: "figma_paste",
    figmaJsonPayload: JSON.stringify({
      name: "Test",
      document: { id: "0:0", type: "DOCUMENT", children: [] },
    }),
    importIntent: "FIGMA_JSON_DOC",
    originalIntent: "FIGMA_PLUGIN_ENVELOPE",
    intentCorrected: true,
  });
  assert.equal(result.success, true);
  if (result.success) {
    assert.equal(result.data.originalIntent, "FIGMA_PLUGIN_ENVELOPE");
    assert.equal(result.data.intentCorrected, true);
  }
});

test("schema: importMode=auto is accepted and invalid importMode is rejected", () => {
  const accepted = SubmitRequestSchema.safeParse({
    figmaSourceMode: "figma_paste",
    figmaJsonPayload: JSON.stringify({
      name: "Test",
      document: { id: "0:0", type: "DOCUMENT", children: [] },
    }),
    importMode: "auto",
  });
  assert.equal(accepted.success, true);
  if (accepted.success) {
    assert.equal(accepted.data.importMode, "auto");
  }

  const rejected = SubmitRequestSchema.safeParse({
    figmaSourceMode: "figma_paste",
    figmaJsonPayload: JSON.stringify({
      name: "Test",
      document: { id: "0:0", type: "DOCUMENT", children: [] },
    }),
    importMode: "nonsense",
  });
  assert.equal(rejected.success, false);
  if (!rejected.success) {
    assert.ok(
      rejected.error.issues.some(
        (issue) => issue.path.join(".") === "importMode",
      ),
    );
  }
});

test("schema: figma_paste accepts figmaFileKey alongside figmaJsonPayload and preserves it", () => {
  const result = SubmitRequestSchema.safeParse({
    figmaSourceMode: "figma_paste",
    figmaJsonPayload: JSON.stringify({
      name: "Test",
      document: { id: "0:0", type: "DOCUMENT", children: [] },
    }),
    figmaFileKey: "abc123",
  });
  assert.equal(result.success, true);
  if (result.success) {
    assert.equal(result.data.figmaSourceMode, "figma_paste");
    assert.equal(result.data.figmaFileKey, "abc123");
  }
});

test("schema: figma_plugin accepts plain Figma document JSON (not a ClipboardEnvelope)", () => {
  const rawFigmaDocument = readPasteFixture<Record<string, unknown>>(
    "envelopes/raw-figma-document.json",
  );
  const result = SubmitRequestSchema.safeParse({
    figmaSourceMode: "figma_plugin",
    figmaJsonPayload: JSON.stringify(rawFigmaDocument),
  });
  assert.equal(result.success, true);
  if (result.success) {
    assert.equal(result.data.figmaSourceMode, "figma_plugin");
    assert.ok(typeof result.data.figmaJsonPayload === "string");
  }
});

test("schema: figma_paste rejects when figmaJsonPath is also set", () => {
  const result = SubmitRequestSchema.safeParse({
    figmaSourceMode: "figma_paste",
    figmaJsonPayload: JSON.stringify({
      name: "Test",
      document: { id: "0:0", type: "DOCUMENT", children: [] },
    }),
    figmaJsonPath: "./fixtures/figma.json",
  });
  assert.equal(result.success, false);
  if (!result.success) {
    const issue = result.error.issues.find(
      (entry) => entry.path.join(".") === "figmaJsonPath",
    );
    assert.ok(issue, "Expected a figmaJsonPath issue in figma_paste mode");
    assert.match(
      issue!.message,
      /figmaJsonPath must be omitted when figmaSourceMode=figma_paste/i,
    );
  }
});

test("resolveFigmaPasteMaxBytes: env override, invalid env, default fallback", () => {
  assert.equal(
    resolveFigmaPasteMaxBytes({ WORKSPACE_FIGMA_PASTE_MAX_BYTES: "10485760" }),
    10485760,
  );
  assert.equal(
    resolveFigmaPasteMaxBytes({
      WORKSPACE_FIGMA_PASTE_MAX_BYTES: "not-a-number",
    }),
    DEFAULT_FIGMA_PASTE_MAX_BYTES,
  );
  assert.equal(
    resolveFigmaPasteMaxBytes({ WORKSPACE_FIGMA_PASTE_MAX_BYTES: "0" }),
    DEFAULT_FIGMA_PASTE_MAX_BYTES,
  );
  assert.equal(
    resolveFigmaPasteMaxBytes({ WORKSPACE_FIGMA_PASTE_MAX_BYTES: "" }),
    DEFAULT_FIGMA_PASTE_MAX_BYTES,
  );
  assert.equal(resolveFigmaPasteMaxBytes({}), DEFAULT_FIGMA_PASTE_MAX_BYTES);
});
