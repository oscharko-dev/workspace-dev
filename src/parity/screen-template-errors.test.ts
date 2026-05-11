import assert from "node:assert/strict";
import test from "node:test";
import {
  buildFallbackRenderState,
  prepareFallbackScreenModel,
  renderElement,
  statefulVariantScreenFile,
} from "./templates/screen-template.js";
import type {
  ScreenElementIR,
  ScreenIR,
  ScreenVariantFamilyIR,
} from "./types-ir.js";
import {
  PARITY_WORKFLOW_ERROR_CODES,
  WorkflowError,
} from "./workflow-error.js";

const createTextElement = (overrides: Partial<ScreenElementIR> = {}): ScreenElementIR => ({
  id: "text-1",
  name: "Headline",
  nodeType: "TEXT",
  type: "text",
  text: "Hello",
  ...(overrides as Partial<ScreenElementIR>),
});

const createScreen = (overrides: Partial<ScreenIR> = {}): ScreenIR => ({
  id: "screen-1",
  name: "Primary Screen",
  layoutMode: "VERTICAL",
  gap: 16,
  width: 390,
  height: 844,
  padding: {
    top: 24,
    right: 24,
    bottom: 24,
    left: 24,
  },
  children: [createTextElement()],
  ...overrides,
});

const createFamily = (
  overrides: Partial<ScreenVariantFamilyIR> = {},
): ScreenVariantFamilyIR => ({
  familyId: "family-1",
  canonicalScreenId: "screen-1",
  memberScreenIds: ["screen-1"],
  axes: ["validation-state"],
  scenarios: [
    {
      screenId: "screen-1",
      contentScreenId: "content-screen-1",
      initialState: {},
    },
  ],
  ...overrides,
});

test("renderElement throws WorkflowError when render traversal exceeds the safety limit", () => {
  const prepared = prepareFallbackScreenModel({
    screen: createScreen(),
    mappingByNodeId: new Map(),
  });
  const renderState = buildFallbackRenderState({ prepared });
  renderState.renderContext.renderNodeVisitCount = 200_000;

  assert.throws(
    () => {
      renderElement(
        prepared.screen.children[0]!,
        1,
        prepared.rootParent,
        renderState.renderContext,
      );
    },
    (error: unknown) => {
      assert.equal(error instanceof WorkflowError, true);
      assert.equal(
        (error as WorkflowError).code,
        PARITY_WORKFLOW_ERROR_CODES.renderTraversalLimitExceeded,
      );
      assert.equal((error as WorkflowError).stage, "codegen.generate");
      assert.match(
        (error as WorkflowError).message,
        /Render traversal exceeded safety limit for screen 'Primary Screen'/,
      );
      return true;
    },
  );
});

test("statefulVariantScreenFile throws WorkflowError when a scenario content screen is missing", () => {
  assert.throws(
    () => {
      statefulVariantScreenFile({
        screen: createScreen(),
        family: createFamily(),
        scenarioScreensById: new Map(),
        mappingByNodeId: new Map(),
      });
    },
    (error: unknown) => {
      assert.equal(error instanceof WorkflowError, true);
      assert.equal(
        (error as WorkflowError).code,
        PARITY_WORKFLOW_ERROR_CODES.missingStatefulVariantContentScreen,
      );
      assert.equal((error as WorkflowError).stage, "codegen.generate");
      assert.match(
        (error as WorkflowError).message,
        /missing content screen 'content-screen-1' for family 'family-1'/,
      );
      return true;
    },
  );
});

test("statefulVariantScreenFile throws WorkflowError when the canonical scenario is missing", () => {
  assert.throws(
    () => {
      statefulVariantScreenFile({
        screen: createScreen(),
        family: createFamily({
          canonicalScreenId: "screen-canonical",
          scenarios: [
            {
              screenId: "screen-1",
              contentScreenId: "screen-1",
              initialState: {},
            },
          ],
        }),
        scenarioScreensById: new Map([["screen-1", createScreen()]]),
        mappingByNodeId: new Map(),
      });
    },
    (error: unknown) => {
      assert.equal(error instanceof WorkflowError, true);
      assert.equal(
        (error as WorkflowError).code,
        PARITY_WORKFLOW_ERROR_CODES.missingStatefulVariantCanonicalScenario,
      );
      assert.equal((error as WorkflowError).stage, "codegen.generate");
      assert.match(
        (error as WorkflowError).message,
        /missing the canonical scenario 'screen-canonical'/,
      );
      return true;
    },
  );
});
