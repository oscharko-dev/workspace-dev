import assert from "node:assert/strict";
import test from "node:test";
import fc from "fast-check";
import { ALLOWED_LLM_CODEGEN_MODES } from "./contracts/index.js";
import {
  CreatePrRequestSchema,
  SubmitRequestSchema,
  SyncRequestSchema,
  formatZodError,
} from "./schemas.js";

const TOKEN_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,23}$/;
const PATH_PATTERN = /^[A-Za-z0-9./_-]{1,32}$/;

const textTokenArb = fc.stringMatching(TOKEN_PATTERN);
const pathTokenArb = fc.stringMatching(PATH_PATTERN);
const localeArb = fc.constantFrom("de-DE", "en-US", "ar-EG", "ar-SA");
const importIntentArb = fc.constantFrom(
  "FIGMA_JSON_NODE_BATCH",
  "FIGMA_JSON_DOC",
  "FIGMA_PLUGIN_ENVELOPE",
  "RAW_CODE_OR_TEXT",
  "UNKNOWN",
);
const nonEmptyStringArrayArb = fc.uniqueArray(textTokenArb, {
  minLength: 1,
  maxLength: 3,
});

const MINIMAL_FIGMA_DOCUMENT_JSON = JSON.stringify({
  name: "Test",
  document: { id: "0:0", type: "DOCUMENT", children: [] },
});

const omitUndefined = <T extends Record<string, unknown>>(value: T): T => {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined),
  ) as T;
};

const repoUrlArb = fc
  .tuple(textTokenArb, textTokenArb)
  .map(([owner, repo]) => `https://github.com/${owner}/${repo}`);

const submitDecorationsArb = fc.record({
  llmCodegenMode: fc.option(fc.constant(ALLOWED_LLM_CODEGEN_MODES[0]), {
    nil: undefined,
  }),
  projectName: fc.option(textTokenArb, { nil: undefined }),
  targetPath: fc.option(pathTokenArb, { nil: undefined }),
  customerBrandId: fc.option(textTokenArb, { nil: undefined }),
  brandTheme: fc.option(fc.constantFrom("derived", "sparkasse"), {
    nil: undefined,
  }),
  generationLocale: fc.option(localeArb, { nil: undefined }),
  formHandlingMode: fc.option(
    fc.constantFrom("react_hook_form", "legacy_use_state"),
    { nil: undefined },
  ),
  importIntent: fc.option(importIntentArb, { nil: undefined }),
  originalIntent: fc.option(importIntentArb, { nil: undefined }),
  intentCorrected: fc.option(fc.boolean(), { nil: undefined }),
  importMode: fc.option(fc.constantFrom("full", "delta", "auto"), {
    nil: undefined,
  }),
  selectedNodeIds: fc.option(nonEmptyStringArrayArb, { nil: undefined }),
  figmaNodeId: fc.option(textTokenArb, { nil: undefined }),
  enableGitPr: fc.boolean(),
  repoUrl: repoUrlArb,
  repoToken: textTokenArb,
});

const decorateSubmitArbitrary = (
  baseArb: fc.Arbitrary<Record<string, unknown>>,
): fc.Arbitrary<Record<string, unknown>> => {
  return fc.tuple(baseArb, submitDecorationsArb).map(([base, decorations]) => {
    return omitUndefined({
      ...base,
      llmCodegenMode: decorations.llmCodegenMode,
      projectName: decorations.projectName,
      targetPath: decorations.targetPath,
      customerBrandId: decorations.customerBrandId,
      brandTheme: decorations.brandTheme,
      generationLocale: decorations.generationLocale,
      formHandlingMode: decorations.formHandlingMode,
      importIntent: decorations.importIntent,
      originalIntent: decorations.originalIntent,
      intentCorrected: decorations.intentCorrected,
      importMode: decorations.importMode,
      selectedNodeIds: decorations.selectedNodeIds,
      figmaNodeId: decorations.figmaNodeId,
      enableGitPr: decorations.enableGitPr,
      ...(decorations.enableGitPr
        ? {
            repoUrl: decorations.repoUrl,
            repoToken: decorations.repoToken,
          }
        : {}),
    });
  });
};

const validSubmitRequestArb = fc.oneof(
  decorateSubmitArbitrary(
    fc.record({
      figmaSourceMode: fc.constant("rest"),
      figmaFileKey: textTokenArb,
      figmaAccessToken: textTokenArb,
    }),
  ),
  decorateSubmitArbitrary(
    fc.record({
      figmaSourceMode: fc.constant("hybrid"),
      figmaFileKey: textTokenArb,
      figmaAccessToken: textTokenArb,
    }),
  ),
  decorateSubmitArbitrary(
    fc.record({
      figmaSourceMode: fc.constant("local_json"),
      figmaJsonPath: pathTokenArb,
    }),
  ),
  decorateSubmitArbitrary(
    fc.record({
      figmaSourceMode: fc.constant("figma_paste"),
      figmaJsonPayload: fc.constant(MINIMAL_FIGMA_DOCUMENT_JSON),
      figmaFileKey: fc.option(textTokenArb, { nil: undefined }),
    }).map(omitUndefined),
  ),
  decorateSubmitArbitrary(
    fc.record({
      figmaSourceMode: fc.constant("figma_plugin"),
      figmaJsonPayload: fc.constant(MINIMAL_FIGMA_DOCUMENT_JSON),
      figmaFileKey: fc.option(textTokenArb, { nil: undefined }),
    }).map(omitUndefined),
  ),
);

const withoutRequiredSubmitField = (
  input: Record<string, unknown>,
): Record<string, unknown> => {
  const mutated = { ...input };
  switch (input.figmaSourceMode) {
    case "rest":
    case "hybrid":
      delete mutated.figmaFileKey;
      break;
    case "local_json":
      delete mutated.figmaJsonPath;
      break;
    case "figma_paste":
    case "figma_plugin":
      delete mutated.figmaJsonPayload;
      break;
    default:
      break;
  }
  return mutated;
};

const invalidSubmitRequestArb = fc.oneof(
  validSubmitRequestArb.map((input) => ({
    ...input,
    unexpectedField: true,
  })),
  validSubmitRequestArb.map((input) => ({
    ...input,
    llmCodegenMode: 123,
  })),
  validSubmitRequestArb.map(withoutRequiredSubmitField),
);

const validSyncRequestArb = fc.oneof(
  fc
    .record({
      mode: fc.constant("dry_run"),
      targetPath: fc.option(pathTokenArb, { nil: undefined }),
    })
    .map(omitUndefined),
  fc
    .record({
      mode: fc.constant("apply"),
      confirmationToken: textTokenArb,
      confirmOverwrite: fc.constant(true),
      fileDecisions: fc.uniqueArray(
        fc.record({
          path: pathTokenArb,
          decision: fc.constantFrom("write", "skip"),
        }),
        {
          minLength: 1,
          maxLength: 3,
          selector: (entry) => entry.path,
        },
      ),
      reviewerNote: fc.option(textTokenArb, { nil: undefined }),
    })
    .map(omitUndefined),
);

const invalidSyncRequestArb = fc.oneof(
  validSyncRequestArb.map((input) => ({ ...input, unexpectedField: true })),
  fc.constant({
    mode: "apply",
    confirmOverwrite: true,
    fileDecisions: [{ path: "src/index.ts", decision: "write" }],
  }),
  fc.constant({
    mode: "dry_run",
    targetPath: 42,
  }),
);

const validCreatePrRequestArb = fc
  .record({
    repoUrl: repoUrlArb,
    repoToken: textTokenArb,
    targetPath: fc.option(pathTokenArb, { nil: undefined }),
    reviewerNote: fc.option(textTokenArb, { nil: undefined }),
  })
  .map(omitUndefined);

const invalidCreatePrRequestArb = fc.oneof(
  validCreatePrRequestArb.map((input) => ({
    ...input,
    unexpectedField: true,
  })),
  fc.constant({ repoUrl: 42, repoToken: "token-value" }),
  fc.constant({ repoToken: "token-value" }),
);

const assertValidationFailure = (
  result: ReturnType<typeof SubmitRequestSchema.safeParse>,
): void => {
  assert.equal(result.success, false);
  if (result.success) {
    return;
  }
  assert.equal(formatZodError(result.error).error, "VALIDATION_ERROR");
};

test("fuzz: valid schema request shapes parse successfully across submit mode and optional-field combinations", () => {
  fc.assert(
    fc.property(validSubmitRequestArb, (input) => {
      const result = SubmitRequestSchema.safeParse(input);
      assert.equal(
        result.success,
        true,
        `Expected submit input to parse: ${JSON.stringify(input)}`,
      );
    }),
    { numRuns: 100 },
  );
});

test("fuzz: invalid submit request shapes never throw and always format as VALIDATION_ERROR", () => {
  fc.assert(
    fc.property(invalidSubmitRequestArb, (input) => {
      assert.doesNotThrow(() => SubmitRequestSchema.safeParse(input));
      const result = SubmitRequestSchema.safeParse(input);
      assertValidationFailure(result);
    }),
    { numRuns: 100 },
  );
});

test("fuzz: valid sync requests parse successfully across apply and dry-run modes", () => {
  fc.assert(
    fc.property(validSyncRequestArb, (input) => {
      const result = SyncRequestSchema.safeParse(input);
      assert.equal(
        result.success,
        true,
        `Expected sync input to parse: ${JSON.stringify(input)}`,
      );
    }),
    { numRuns: 100 },
  );
});

test("fuzz: invalid sync requests never throw and always format as VALIDATION_ERROR", () => {
  fc.assert(
    fc.property(invalidSyncRequestArb, (input) => {
      assert.doesNotThrow(() => SyncRequestSchema.safeParse(input));
      const result = SyncRequestSchema.safeParse(input);
      assert.equal(result.success, false);
      if (result.success) {
        return;
      }
      assert.equal(formatZodError(result.error).error, "VALIDATION_ERROR");
    }),
    { numRuns: 100 },
  );
});

test("fuzz: valid create-pr requests parse successfully", () => {
  fc.assert(
    fc.property(validCreatePrRequestArb, (input) => {
      const result = CreatePrRequestSchema.safeParse(input);
      assert.equal(
        result.success,
        true,
        `Expected create-pr input to parse: ${JSON.stringify(input)}`,
      );
    }),
    { numRuns: 100 },
  );
});

test("fuzz: invalid create-pr requests never throw and always format as VALIDATION_ERROR", () => {
  fc.assert(
    fc.property(invalidCreatePrRequestArb, (input) => {
      assert.doesNotThrow(() => CreatePrRequestSchema.safeParse(input));
      const result = CreatePrRequestSchema.safeParse(input);
      assert.equal(result.success, false);
      if (result.success) {
        return;
      }
      assert.equal(formatZodError(result.error).error, "VALIDATION_ERROR");
    }),
    { numRuns: 100 },
  );
});
