import assert from "node:assert/strict";
import test from "node:test";
import {
  ALLOWED_FIGMA_SOURCE_MODES,
  type WorkspaceJobRetryStage,
} from "../../contracts/index.js";
import { RocketTemplatePrepareService } from "../services/rocket-template-prepare-service.js";
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

const RETRY_STAGES: readonly WorkspaceJobRetryStage[] = [
  "figma.source",
  "ir.derive",
  "template.prepare",
  "codegen.generate",
];

const SUPPORTED_SCOPES = ["board", "node", "selection"] as const;

const EXPECTED_PIPELINE_MANIFESTS = {
  rocket: {
    id: "rocket",
    displayName: "Rocket",
    description:
      "Compatibility pipeline for the existing WorkspaceDev generator.",
    visibility: "customer",
    deterministic: true,
    template: {
      bundleId: "react-mui-app",
      path: "template/react-mui-app",
      stack: {
        framework: "react",
        language: "typescript",
        styling: "mui",
        bundler: "vite",
      },
    },
    supportedSourceModes: ALLOWED_FIGMA_SOURCE_MODES,
    supportedScopes: SUPPORTED_SCOPES,
  },
} as const;

const toStageNames = (
  plan: ReturnType<PipelineDefinition["buildSubmissionPlan"]>,
) => plan.map((entry) => entry.service.stageName);

const assertNoDuplicates = (values: readonly string[], label: string): void => {
  assert.equal(
    new Set(values).size,
    values.length,
    `${label} must not contain duplicates`,
  );
};

const assertCanonicalPlan = (
  pipeline: PipelineDefinition,
  label: string,
  plan: ReturnType<PipelineDefinition["buildSubmissionPlan"]>,
): void => {
  assert.deepEqual(
    toStageNames(plan),
    STAGE_ORDER,
    `${pipeline.id} ${label} plan must preserve canonical stage order`,
  );
};

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

test("pipeline selection is deterministic for default-only, rocket-only, and combined bundles", () => {
  const defaultOnlyRegistry = new PipelineRegistry({
    definitions: [createDefinition({ id: "default" })],
  });
  const rocketOnlyRegistry = new PipelineRegistry({
    definitions: [createDefinition({ id: "rocket" })],
  });
  const registry = new PipelineRegistry({
    definitions: [
      createDefinition({ id: "rocket" }),
      createDefinition({ id: "default" }),
    ],
  });

  assert.equal(
    selectPipelineDefinition({
      registry: defaultOnlyRegistry,
      sourceMode: "local_json",
      scope: "board",
    }).id,
    "default",
  );
  assert.equal(
    selectPipelineDefinition({
      registry: rocketOnlyRegistry,
      sourceMode: "local_json",
      scope: "board",
    }).id,
    "rocket",
  );
  assert.equal(
    selectPipelineDefinition({
      registry,
      sourceMode: "local_json",
      scope: "board",
    }).id,
    "default",
  );
  assert.equal(
    selectPipelineDefinition({
      registry,
      requestedPipelineId: "rocket",
      sourceMode: "local_json",
      scope: "board",
    }).id,
    "rocket",
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
      assert.equal(
        (error as PipelineRequestError).code,
        "PIPELINE_UNAVAILABLE",
      );
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

test("registered pipelines expose complete manifest metadata", () => {
  const registry = createDefaultPipelineRegistry();
  const pipelines = registry.list();
  assert.ok(pipelines.length > 0, "registry must expose at least one pipeline");
  assertNoDuplicates(
    pipelines.map((pipeline) => pipeline.id),
    "registered pipeline ids",
  );

  for (const pipeline of pipelines) {
    const expected =
      EXPECTED_PIPELINE_MANIFESTS[
        pipeline.id as keyof typeof EXPECTED_PIPELINE_MANIFESTS
      ];
    assert.ok(expected, `unexpected registered pipeline '${pipeline.id}'`);
    assert.match(pipeline.id, /^[a-z][a-z0-9-]*$/);
    assertNoDuplicates(
      pipeline.supportedSourceModes,
      `${pipeline.id} supported source modes`,
    );
    assertNoDuplicates(
      pipeline.supportedScopes,
      `${pipeline.id} supported scopes`,
    );
    assert.deepEqual(
      {
        id: pipeline.id,
        displayName: pipeline.displayName,
        description: pipeline.description,
        visibility: pipeline.visibility,
        deterministic: pipeline.deterministic,
        template: pipeline.template,
        supportedSourceModes: pipeline.supportedSourceModes,
        supportedScopes: pipeline.supportedScopes,
      },
      expected,
    );
  }
});

test("registered pipeline descriptors preserve public manifest integrity", () => {
  const registry = createDefaultPipelineRegistry();

  assert.deepEqual(
    registry.listDescriptors(),
    registry.list().map((pipeline) => ({
      id: pipeline.id,
      displayName: pipeline.displayName,
      description: pipeline.description,
      visibility: pipeline.visibility,
      deterministic: pipeline.deterministic,
      template: pipeline.template,
      supportedSourceModes: [...pipeline.supportedSourceModes],
      supportedScopes: [...pipeline.supportedScopes],
    })),
  );
});

test("registered pipelines preserve canonical stage order for every execution plan", () => {
  const registry = createDefaultPipelineRegistry();

  for (const pipeline of registry.list()) {
    assertCanonicalPlan(
      pipeline,
      "submission",
      pipeline.buildSubmissionPlan({ mode: "submission" }),
    );
    assertCanonicalPlan(
      pipeline,
      "regeneration",
      pipeline.buildRegenerationPlan({ mode: "regeneration" }),
    );
    for (const retryStage of RETRY_STAGES) {
      assertCanonicalPlan(
        pipeline,
        `retry from ${retryStage}`,
        pipeline.buildRetryPlan({ mode: "retry", retryStage }),
      );
    }
  }
});

test("rocket pipeline uses the rocket template prepare delegate for every plan", () => {
  const plans = [
    ROCKET_PIPELINE_DEFINITION.buildSubmissionPlan({ mode: "submission" }),
    ROCKET_PIPELINE_DEFINITION.buildRegenerationPlan({ mode: "regeneration" }),
    ROCKET_PIPELINE_DEFINITION.buildRetryPlan({
      mode: "retry",
      retryStage: "codegen.generate",
    }),
  ];

  for (const plan of plans) {
    const templatePrepareEntry = plan.find(
      (entry) => entry.service.stageName === "template.prepare",
    );
    assert.equal(templatePrepareEntry?.service, RocketTemplatePrepareService);
  }
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
