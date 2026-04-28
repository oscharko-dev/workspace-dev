import assert from "node:assert/strict";
import test from "node:test";
import { STAGE_ORDER } from "../stage-state.js";
import type { PipelineDefinition } from "./pipeline-definition.js";
import { PipelineRequestError } from "./pipeline-errors.js";
import { PipelineRegistry } from "./pipeline-registry.js";
import {
  ROCKET_PIPELINE_DEFINITION,
  createDefaultPipelineRegistry,
  inferPipelineScope,
  inferPipelineSourceMode,
  selectPipelineDefinition,
} from "./pipeline-selection.js";

const createDefinition = ({
  id,
  sourceModes = ["local_json"],
  scopes = ["board", "node", "selection"],
}: {
  id: "default" | "rocket";
  sourceModes?: PipelineDefinition["supportedSourceModes"];
  scopes?: PipelineDefinition["supportedScopes"];
}): PipelineDefinition => ({
  ...ROCKET_PIPELINE_DEFINITION,
  id,
  displayName: id,
  description: `${id} test pipeline`,
  supportedSourceModes: sourceModes,
  supportedScopes: scopes,
});

test("default registry exposes only the current build-profile pipeline", () => {
  const registry = createDefaultPipelineRegistry();
  assert.deepEqual(
    registry.listDescriptors().map((pipeline) => pipeline.id),
    ["rocket"],
  );
  assert.equal(
    selectPipelineDefinition({
      registry,
      sourceMode: "local_json",
      scope: "board",
    }).id,
    "rocket",
  );
});

test("pipeline selection prefers default when multiple pipelines are available", () => {
  const registry = new PipelineRegistry({
    definitions: [createDefinition({ id: "rocket" }), createDefinition({ id: "default" })],
  });

  assert.equal(
    selectPipelineDefinition({
      registry,
      sourceMode: "local_json",
      scope: "board",
    }).id,
    "default",
  );
});

test("pipeline selection distinguishes unknown and unavailable pipeline IDs", () => {
  const registry = createDefaultPipelineRegistry();

  assert.throws(
    () =>
      selectPipelineDefinition({
        registry,
        requestedPipelineId: "missing",
        sourceMode: "local_json",
        scope: "board",
      }),
    (error: unknown) => {
      assert.equal(error instanceof PipelineRequestError, true);
      assert.equal((error as PipelineRequestError).code, "INVALID_PIPELINE");
      return true;
    },
  );

  assert.throws(
    () =>
      selectPipelineDefinition({
        registry,
        requestedPipelineId: "default",
        sourceMode: "local_json",
        scope: "board",
      }),
    (error: unknown) => {
      assert.equal(error instanceof PipelineRequestError, true);
      assert.equal((error as PipelineRequestError).code, "PIPELINE_UNAVAILABLE");
      return true;
    },
  );
});

test("pipeline selection rejects unsupported source modes and scopes", () => {
  const registry = new PipelineRegistry({
    definitions: [
      createDefinition({
        id: "rocket",
        sourceModes: ["local_json"],
        scopes: ["board"],
      }),
    ],
  });

  assert.throws(
    () =>
      selectPipelineDefinition({
        registry,
        requestedPipelineId: "rocket",
        sourceMode: "figma_paste",
        scope: "board",
      }),
    (error: unknown) => {
      assert.equal(error instanceof PipelineRequestError, true);
      assert.equal(
        (error as PipelineRequestError).code,
        "PIPELINE_SOURCE_MODE_UNSUPPORTED",
      );
      return true;
    },
  );

  assert.throws(
    () =>
      selectPipelineDefinition({
        registry,
        requestedPipelineId: "rocket",
        sourceMode: "local_json",
        scope: "selection",
      }),
    (error: unknown) => {
      assert.equal(error instanceof PipelineRequestError, true);
      assert.equal(
        (error as PipelineRequestError).code,
        "PIPELINE_SCOPE_UNSUPPORTED",
      );
      return true;
    },
  );
});

test("registered rocket plan preserves canonical stage order", () => {
  const pipeline = selectPipelineDefinition({
    sourceMode: "local_json",
    scope: "board",
  });
  assert.deepEqual(
    pipeline
      .buildSubmissionPlan({ mode: "submission" })
      .map((entry) => entry.service.stageName),
    STAGE_ORDER,
  );
});

test("pipeline scope inference is deterministic", () => {
  assert.equal(inferPipelineScope({}), "board");
  assert.equal(inferPipelineScope({ figmaNodeId: "1:2" }), "node");
  assert.equal(inferPipelineScope({ selectedNodeIds: ["1:2"] }), "selection");
});

test("pipeline source-mode inference uses the public paste/plugin mode", () => {
  assert.equal(
    inferPipelineSourceMode({
      figmaSourceMode: "local_json",
      requestSourceMode: "figma_plugin",
    }),
    "figma_plugin",
  );
  assert.equal(
    inferPipelineSourceMode({
      figmaSourceMode: "hybrid",
      requestSourceMode: "figma_url",
    }),
    "hybrid",
  );
});
