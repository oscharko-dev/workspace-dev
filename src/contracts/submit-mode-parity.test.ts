/**
 * Compile-time ↔ runtime parity for public submit-mode enums.
 *
 * These tests guard Issue #1104: every literal value in the contract enum
 * types `WorkspaceFigmaSourceMode` and `WorkspaceLlmCodegenMode` must be
 * accepted by the runtime submit parser in `src/schemas.ts`, and vice
 * versa. Drift in either direction is a contract bug.
 */

import assert from "node:assert/strict";
import test from "node:test";
import {
  ALLOWED_FIGMA_SOURCE_MODES,
  ALLOWED_LLM_CODEGEN_MODES,
  ALLOWED_TEST_INTELLIGENCE_MODES,
  ALLOWED_WORKSPACE_JOB_TYPES,
  type WorkspaceFigmaSourceMode,
  type WorkspaceJobType,
  type WorkspaceLlmCodegenMode,
  type WorkspaceTestIntelligenceMode,
} from "./index.js";
import { SubmitRequestSchema } from "../schemas.js";

// Type-level exhaustiveness check: if either contract type grows or shrinks
// and the runtime source-of-truth array is not updated, this `satisfies`
// clause fails at compile time.
const FIGMA_SOURCE_MODE_EXHAUSTIVE = {
  rest: true,
  hybrid: true,
  local_json: true,
  figma_paste: true,
  figma_plugin: true,
} as const satisfies Record<WorkspaceFigmaSourceMode, true>;

const LLM_CODEGEN_MODE_EXHAUSTIVE = {
  deterministic: true,
} as const satisfies Record<WorkspaceLlmCodegenMode, true>;

const TEST_INTELLIGENCE_MODE_EXHAUSTIVE = {
  deterministic_llm: true,
  offline_eval: true,
  dry_run: true,
} as const satisfies Record<WorkspaceTestIntelligenceMode, true>;

const WORKSPACE_JOB_TYPE_EXHAUSTIVE = {
  figma_to_code: true,
  figma_to_qc_test_cases: true,
} as const satisfies Record<WorkspaceJobType, true>;

// The reverse direction: the runtime allowlist must only contain values
// that the contract type accepts. `satisfies` on the array element type
// enforces this at compile time.
const ALLOWED_FIGMA_SOURCE_MODES_TYPED =
  ALLOWED_FIGMA_SOURCE_MODES satisfies readonly WorkspaceFigmaSourceMode[];
const ALLOWED_LLM_CODEGEN_MODES_TYPED =
  ALLOWED_LLM_CODEGEN_MODES satisfies readonly WorkspaceLlmCodegenMode[];
const ALLOWED_TEST_INTELLIGENCE_MODES_TYPED =
  ALLOWED_TEST_INTELLIGENCE_MODES satisfies readonly WorkspaceTestIntelligenceMode[];
const ALLOWED_WORKSPACE_JOB_TYPES_TYPED =
  ALLOWED_WORKSPACE_JOB_TYPES satisfies readonly WorkspaceJobType[];

test("submit-mode parity: every WorkspaceFigmaSourceMode is accepted by SubmitRequestSchema", () => {
  for (const mode of Object.keys(FIGMA_SOURCE_MODE_EXHAUSTIVE) as Array<
    keyof typeof FIGMA_SOURCE_MODE_EXHAUSTIVE
  >) {
    // Build a minimally valid submit body per mode so the parser does not
    // reject it for unrelated reasons (e.g., missing figmaFileKey on rest).
    const body = buildMinimalSubmitBodyForFigmaMode(mode);
    const result = SubmitRequestSchema.safeParse(body);
    assert.equal(
      result.success,
      true,
      `SubmitRequestSchema rejected figmaSourceMode='${mode}': ${
        result.success ? "" : JSON.stringify(result.error.issues)
      }`,
    );
    if (result.success) {
      assert.equal(result.data.figmaSourceMode, mode);
    }
  }
});

test("submit-mode parity: every ALLOWED_FIGMA_SOURCE_MODES value is in WorkspaceFigmaSourceMode", () => {
  const allowed = new Set<string>(ALLOWED_FIGMA_SOURCE_MODES_TYPED);
  const typed = new Set<string>(Object.keys(FIGMA_SOURCE_MODE_EXHAUSTIVE));
  assert.deepEqual(
    [...allowed].sort(),
    [...typed].sort(),
    `ALLOWED_FIGMA_SOURCE_MODES drifted from WorkspaceFigmaSourceMode. Runtime=[${[
      ...allowed,
    ].join(", ")}] Type=[${[...typed].join(", ")}]`,
  );
});

test("submit-mode parity: SubmitRequestSchema rejects unknown figmaSourceMode values", () => {
  const result = SubmitRequestSchema.safeParse({
    figmaSourceMode: "not_a_real_mode",
    figmaFileKey: "abc123",
    figmaAccessToken: "figd_xxx",
  });
  assert.equal(result.success, false);
});

test("submit-mode parity: every WorkspaceLlmCodegenMode is accepted by SubmitRequestSchema", () => {
  for (const mode of Object.keys(LLM_CODEGEN_MODE_EXHAUSTIVE) as Array<
    keyof typeof LLM_CODEGEN_MODE_EXHAUSTIVE
  >) {
    const result = SubmitRequestSchema.safeParse({
      figmaFileKey: "abc123",
      figmaAccessToken: "figd_xxx",
      figmaSourceMode: "rest",
      llmCodegenMode: mode,
    });
    assert.equal(
      result.success,
      true,
      `SubmitRequestSchema rejected llmCodegenMode='${mode}': ${
        result.success ? "" : JSON.stringify(result.error.issues)
      }`,
    );
    if (result.success) {
      assert.equal(result.data.llmCodegenMode, mode);
    }
  }
});

test("submit-mode parity: every ALLOWED_LLM_CODEGEN_MODES value is in WorkspaceLlmCodegenMode", () => {
  const allowed = new Set<string>(ALLOWED_LLM_CODEGEN_MODES_TYPED);
  const typed = new Set<string>(Object.keys(LLM_CODEGEN_MODE_EXHAUSTIVE));
  assert.deepEqual(
    [...allowed].sort(),
    [...typed].sort(),
    `ALLOWED_LLM_CODEGEN_MODES drifted from WorkspaceLlmCodegenMode. Runtime=[${[
      ...allowed,
    ].join(", ")}] Type=[${[...typed].join(", ")}]`,
  );
});

test("submit-mode parity: SubmitRequestSchema rejects unknown llmCodegenMode values", () => {
  const result = SubmitRequestSchema.safeParse({
    figmaFileKey: "abc123",
    figmaAccessToken: "figd_xxx",
    figmaSourceMode: "rest",
    llmCodegenMode: "nondeterministic",
  });
  assert.equal(result.success, false);
});

test("submit-mode parity: every WorkspaceTestIntelligenceMode is accepted by SubmitRequestSchema", () => {
  for (const mode of Object.keys(TEST_INTELLIGENCE_MODE_EXHAUSTIVE) as Array<
    keyof typeof TEST_INTELLIGENCE_MODE_EXHAUSTIVE
  >) {
    const result = SubmitRequestSchema.safeParse({
      figmaFileKey: "abc123",
      figmaAccessToken: "figd_xxx",
      figmaSourceMode: "rest",
      jobType: "figma_to_qc_test_cases",
      testIntelligenceMode: mode,
    });
    assert.equal(
      result.success,
      true,
      `SubmitRequestSchema rejected testIntelligenceMode='${mode}': ${
        result.success ? "" : JSON.stringify(result.error.issues)
      }`,
    );
    if (result.success) {
      assert.equal(result.data.testIntelligenceMode, mode);
    }
  }
});

test("submit-mode parity: every ALLOWED_TEST_INTELLIGENCE_MODES value is in WorkspaceTestIntelligenceMode", () => {
  const allowed = new Set<string>(ALLOWED_TEST_INTELLIGENCE_MODES_TYPED);
  const typed = new Set<string>(Object.keys(TEST_INTELLIGENCE_MODE_EXHAUSTIVE));
  assert.deepEqual(
    [...allowed].sort(),
    [...typed].sort(),
    `ALLOWED_TEST_INTELLIGENCE_MODES drifted from WorkspaceTestIntelligenceMode. Runtime=[${[
      ...allowed,
    ].join(", ")}] Type=[${[...typed].join(", ")}]`,
  );
});

test("submit-mode parity: SubmitRequestSchema rejects unknown testIntelligenceMode values", () => {
  const result = SubmitRequestSchema.safeParse({
    figmaFileKey: "abc123",
    figmaAccessToken: "figd_xxx",
    figmaSourceMode: "rest",
    jobType: "figma_to_qc_test_cases",
    testIntelligenceMode: "not_a_real_mode",
  });
  assert.equal(result.success, false);
});

test("submit-mode parity: SubmitRequestSchema rejects testIntelligenceMode on figma_to_code jobs", () => {
  const result = SubmitRequestSchema.safeParse({
    figmaFileKey: "abc123",
    figmaAccessToken: "figd_xxx",
    figmaSourceMode: "rest",
    jobType: "figma_to_code",
    testIntelligenceMode: "dry_run",
  });
  assert.equal(result.success, false);
});

test("submit-mode parity: every WorkspaceJobType is accepted by SubmitRequestSchema", () => {
  for (const jobType of Object.keys(WORKSPACE_JOB_TYPE_EXHAUSTIVE) as Array<
    keyof typeof WORKSPACE_JOB_TYPE_EXHAUSTIVE
  >) {
    const result = SubmitRequestSchema.safeParse({
      figmaFileKey: "abc123",
      figmaAccessToken: "figd_xxx",
      figmaSourceMode: "rest",
      jobType,
    });
    assert.equal(
      result.success,
      true,
      `SubmitRequestSchema rejected jobType='${jobType}': ${
        result.success ? "" : JSON.stringify(result.error.issues)
      }`,
    );
    if (result.success) {
      assert.equal(result.data.jobType, jobType);
    }
  }
});

test("submit-mode parity: every ALLOWED_WORKSPACE_JOB_TYPES value is in WorkspaceJobType", () => {
  const allowed = new Set<string>(ALLOWED_WORKSPACE_JOB_TYPES_TYPED);
  const typed = new Set<string>(Object.keys(WORKSPACE_JOB_TYPE_EXHAUSTIVE));
  assert.deepEqual(
    [...allowed].sort(),
    [...typed].sort(),
    `ALLOWED_WORKSPACE_JOB_TYPES drifted from WorkspaceJobType. Runtime=[${[
      ...allowed,
    ].join(", ")}] Type=[${[...typed].join(", ")}]`,
  );
});

test("submit-mode parity: SubmitRequestSchema rejects unknown jobType values", () => {
  const result = SubmitRequestSchema.safeParse({
    figmaFileKey: "abc123",
    figmaAccessToken: "figd_xxx",
    figmaSourceMode: "rest",
    jobType: "not_a_real_job_type",
  });
  assert.equal(result.success, false);
});

function buildMinimalSubmitBodyForFigmaMode(
  mode: WorkspaceFigmaSourceMode,
): Record<string, unknown> {
  const figmaPlaceholderEnvelope = {
    kind: "workspace-dev/figma-selection@1",
    pluginVersion: "0.1.0",
    copiedAt: "2026-04-18T00:00:00.000Z",
    selections: [
      {
        document: { id: "1:1", type: "FRAME", name: "Parity" },
        components: {},
        componentSets: {},
        styles: {},
      },
    ],
  };
  switch (mode) {
    case "rest":
    case "hybrid":
      return {
        figmaSourceMode: mode,
        figmaFileKey: "abc123",
        figmaAccessToken: "figd_xxx",
      };
    case "local_json":
      return {
        figmaSourceMode: mode,
        figmaJsonPath: "./fixtures/figma.json",
      };
    case "figma_paste":
    case "figma_plugin":
      return {
        figmaSourceMode: mode,
        figmaJsonPayload: JSON.stringify(figmaPlaceholderEnvelope),
      };
  }
}
