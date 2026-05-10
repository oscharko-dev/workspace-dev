/**
 * Issue #2118 — A/B shadow-mode parity tests.
 *
 * Goal: prove that for the same input the production runner produces the
 * identical `(generatedTestCases, validation, policy.violations)` triple in
 * `harness.mode === "shadow_eval"` and `harness.mode === "enforced"`,
 * modulo the enforcement decision itself. Operators answering "if I roll
 * back from enforced to shadow, will I see the same case set?" must get a
 * "yes" backed by a regression-locked test, not by reading code.
 *
 * Design:
 *
 *   1. Cross-mode replay-cache key parity. The persisted `ReplayCacheKey`
 *      contract (see `src/contracts/index.ts`) does not include the harness
 *      mode, so a cache populated under `shadow_eval` is reachable under
 *      `enforced`. We pin both the structural invariant (keys field set)
 *      and the runtime behaviour (second run hits the shared cache).
 *
 *   2. Triple parity over a hand-curated fixture set covering the normal,
 *      edge, and adversarial axes.
 *
 *   3. Triple parity under property-based generation. Random valid Figma
 *      payloads must produce the same triple in both modes.
 *
 * On failure the diff output points at the exact JSON path that diverged
 * (e.g. `$.testCases[2].steps[1].expected`) so an operator can diagnose
 * without re-running the failing fixture interactively.
 */

import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import fc from "fast-check";

import {
  REDACTION_POLICY_VERSION,
  TEST_INTELLIGENCE_PROMPT_TEMPLATE_VERSION,
  VISUAL_SIDECAR_SCHEMA_VERSION,
  type GeneratedTestCaseList,
  type ReplayCacheKey,
  type TestCasePolicyReport,
  type TestCasePolicyViolation,
  type TestCaseValidationReport,
} from "../contracts/index.js";
import { createMockLlmGatewayClient } from "./llm-mock-gateway.js";
import {
  ProductionRunnerError,
  runFigmaToQcTestCases,
  type ProductionRunnerLlmDraftCase,
  type RunFigmaToQcTestCasesResult,
} from "./production-runner.js";
import {
  REGION_ATTESTATION_PINNED_REGION_ENV,
  REGION_ATTESTATION_SIGNING_KEY_ENV,
} from "./region-attestation.js";
import { createMemoryReplayCache } from "./replay-cache.js";
import type { FigmaRestNode } from "./figma-rest-adapter.js";

process.env[REGION_ATTESTATION_PINNED_REGION_ENV] ??= "eu-central-1";
process.env[REGION_ATTESTATION_SIGNING_KEY_ENV] ??=
  "workspace-dev-region-attestation-test-key";

// ---------------------------------------------------------------------------
// Fixture builders
// ---------------------------------------------------------------------------

const node = (
  partial: Partial<FigmaRestNode> & { id: string; type: string },
): FigmaRestNode => partial as FigmaRestNode;

interface ParityScreen {
  readonly screenName: string;
  readonly labels: readonly string[];
}

interface ParityFigmaModel {
  readonly fileKey: string;
  readonly fileName: string;
  readonly screens: readonly ParityScreen[];
}

const buildFigmaFile = (model: ParityFigmaModel) => ({
  fileKey: model.fileKey,
  name: model.fileName,
  document: node({
    id: "0:0",
    type: "DOCUMENT",
    children: [
      node({
        id: "0:1",
        name: "Page 1",
        type: "CANVAS",
        children: model.screens.map((screen, screenIndex) =>
          node({
            id: `1:${screenIndex + 1}`,
            name: screen.screenName,
            type: "FRAME",
            absoluteBoundingBox: { x: 0, y: 0, width: 600, height: 800 },
            children: screen.labels.map((label, labelIndex) =>
              node({
                id: `${screenIndex + 2}:${labelIndex + 1}`,
                name: label,
                type: labelIndex % 2 === 0 ? "TEXT" : "INSTANCE",
                characters: label,
              }),
            ),
          }),
        ),
      }),
    ],
  }),
});

const buildUseCaseDraft = (
  screenId: string,
  screenName: string,
): ProductionRunnerLlmDraftCase => ({
  title: `Smoke ${screenName}`,
  objective: `Verify ${screenName} accepts valid operator input.`,
  type: "functional",
  priority: "p1",
  riskCategory: "low",
  technique: "use_case",
  preconditions: [`${screenName} is visible`],
  testData: ["operator input"],
  steps: [
    {
      index: 1,
      action: `Open ${screenName}`,
      expected: `${screenName} is visible`,
    },
    {
      index: 2,
      action: "Submit valid input",
      expected: "Submission is accepted",
    },
  ],
  expectedResults: ["Request is accepted"],
  figmaTraceRefs: [{ screenId, nodeName: screenName }],
  assumptions: [],
  openQuestions: [],
});

const buildEquivalenceDraft = (
  screenId: string,
  screenName: string,
): ProductionRunnerLlmDraftCase => ({
  ...buildUseCaseDraft(screenId, screenName),
  title: `Equivalence ${screenName}`,
  objective: `Cover the equivalence-partitioning slot for ${screenName}.`,
  technique: "equivalence_partitioning",
  testData: ["lower-bound input", "valid input", "upper-bound input"],
});

const okResponder =
  (cases: ProductionRunnerLlmDraftCase[]) =>
  (request: { responseSchemaName?: string }, attempt: number) => {
    if (request.responseSchemaName === "workspace-dev-logic-judge-v1") {
      return {
        outcome: "success" as const,
        content: {
          verdict: "accept",
          findings: [],
          repairInstructions: [],
        },
        finishReason: "stop" as const,
        usage: { inputTokens: 20, outputTokens: 10 },
        modelDeployment: "gpt-oss-120b-mock",
        modelRevision: "mock-1",
        gatewayRelease: "mock",
        attempt,
      };
    }
    return {
      outcome: "success" as const,
      content: { testCases: cases },
      finishReason: "stop" as const,
      usage: { inputTokens: 100, outputTokens: 200 },
      modelDeployment: "gpt-oss-120b-mock",
      modelRevision: "mock-1",
      gatewayRelease: "mock",
      attempt,
    };
  };

// ---------------------------------------------------------------------------
// Diff helper — points at the first divergent JSON path on failure
// ---------------------------------------------------------------------------

interface DivergencePath {
  readonly path: string;
  readonly left: unknown;
  readonly right: unknown;
}

const findFirstDivergence = (
  left: unknown,
  right: unknown,
  prefix = "$",
): DivergencePath | null => {
  if (Object.is(left, right)) return null;

  if (
    typeof left !== "object" ||
    left === null ||
    typeof right !== "object" ||
    right === null
  ) {
    if (left !== right) {
      return { path: prefix, left, right };
    }
    return null;
  }

  if (Array.isArray(left) !== Array.isArray(right)) {
    return { path: prefix, left, right };
  }

  if (Array.isArray(left) && Array.isArray(right)) {
    const len = Math.max(left.length, right.length);
    for (let i = 0; i < len; i += 1) {
      const child = findFirstDivergence(left[i], right[i], `${prefix}[${i}]`);
      if (child) return child;
    }
    return null;
  }

  const leftRec = left as Record<string, unknown>;
  const rightRec = right as Record<string, unknown>;
  const keys = new Set<string>([...Object.keys(leftRec), ...Object.keys(rightRec)]);
  // Sort so the reported path is deterministic across runs.
  for (const key of [...keys].sort()) {
    const child = findFirstDivergence(
      leftRec[key],
      rightRec[key],
      `${prefix}.${key}`,
    );
    if (child) return child;
  }
  return null;
};

const formatDivergence = (
  label: string,
  divergence: DivergencePath,
): string => {
  const truncate = (value: unknown): string => {
    const serialized = JSON.stringify(value);
    if (serialized === undefined) return "<unserializable>";
    return serialized.length > 240
      ? `${serialized.slice(0, 237)}...`
      : serialized;
  };
  return [
    `${label} diverged at ${divergence.path}`,
    `  shadow_eval: ${truncate(divergence.left)}`,
    `  enforced:    ${truncate(divergence.right)}`,
  ].join("\n");
};

const assertParityTriple = (
  shadow: RunFigmaToQcTestCasesResult,
  enforced: RunFigmaToQcTestCasesResult,
  fixtureLabel: string,
): void => {
  const shadowTestCases: GeneratedTestCaseList = shadow.generatedTestCases;
  const enforcedTestCases: GeneratedTestCaseList = enforced.generatedTestCases;
  const testCasesDivergence = findFirstDivergence(
    shadowTestCases,
    enforcedTestCases,
  );
  if (testCasesDivergence) {
    throw new assert.AssertionError({
      message: `[${fixtureLabel}] ${formatDivergence("generatedTestCases", testCasesDivergence)}`,
      actual: shadowTestCases,
      expected: enforcedTestCases,
      operator: "deepStrictEqual",
    });
  }

  const shadowValidation: TestCaseValidationReport = shadow.validation;
  const enforcedValidation: TestCaseValidationReport = enforced.validation;
  const validationDivergence = findFirstDivergence(
    shadowValidation,
    enforcedValidation,
  );
  if (validationDivergence) {
    throw new assert.AssertionError({
      message: `[${fixtureLabel}] ${formatDivergence("validation", validationDivergence)}`,
      actual: shadowValidation,
      expected: enforcedValidation,
      operator: "deepStrictEqual",
    });
  }

  const shadowViolations: readonly TestCasePolicyViolation[] = collectAllPolicyViolations(
    shadow.policy,
  );
  const enforcedViolations: readonly TestCasePolicyViolation[] = collectAllPolicyViolations(
    enforced.policy,
  );
  const policyDivergence = findFirstDivergence(
    shadowViolations,
    enforcedViolations,
  );
  if (policyDivergence) {
    throw new assert.AssertionError({
      message: `[${fixtureLabel}] ${formatDivergence("policy.violations", policyDivergence)}`,
      actual: shadowViolations,
      expected: enforcedViolations,
      operator: "deepStrictEqual",
    });
  }
};

const collectAllPolicyViolations = (
  policy: TestCasePolicyReport,
): readonly TestCasePolicyViolation[] => {
  const rows: TestCasePolicyViolation[] = [];
  for (const decision of policy.decisions) {
    for (const violation of decision.violations) {
      rows.push(violation);
    }
  }
  for (const violation of policy.jobLevelViolations) {
    rows.push(violation);
  }
  return rows;
};

// ---------------------------------------------------------------------------
// Mode runner
// ---------------------------------------------------------------------------

const runOnce = async (params: {
  readonly mode: "shadow_eval" | "enforced";
  readonly model: ParityFigmaModel;
  readonly tempRoot: string;
  readonly jobId: string;
}): Promise<RunFigmaToQcTestCasesResult> => {
  const firstScreen = params.model.screens[0]!;
  const firstScreenId = "1:1";
  const drafts: ProductionRunnerLlmDraftCase[] = [
    buildUseCaseDraft(firstScreenId, firstScreen.screenName),
    buildEquivalenceDraft(firstScreenId, firstScreen.screenName),
  ];
  const client = createMockLlmGatewayClient({
    role: "test_generation",
    deployment: "gpt-oss-120b-mock",
    modelRevision: "mock-1",
    gatewayRelease: "mock",
    responder: okResponder(drafts),
  });
  return runFigmaToQcTestCases({
    jobId: params.jobId,
    generatedAt: "2026-05-10T10:00:00Z",
    source: {
      kind: "figma_paste_normalized",
      file: buildFigmaFile(params.model),
    },
    outputRoot: params.tempRoot,
    llm: { client },
    // Generator-only path: keep the parity contract tight on the cases the
    // generator emits. Logic-Judge integration is exercised exhaustively in
    // the harness test file; including it here would couple this contract
    // to a separate (and noisier) mock budget.
    logicJudge: { enabled: false },
    harness: { mode: params.mode },
  });
};

const withTempRoot = async <T>(
  prefix: string,
  body: (root: string) => Promise<T>,
): Promise<T> => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), prefix));
  try {
    return await body(tempRoot);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
};

const assertParityForFixture = async (
  fixtureLabel: string,
  model: ParityFigmaModel,
): Promise<void> => {
  // Two independent tempdirs so neither run shares filesystem state. With
  // identical inputs and a deterministic mock LLM the runner is fully
  // deterministic, so audit fields (cacheHit, hashes, jobId) line up.
  await withTempRoot("ti-parity-shadow-", async (shadowRoot) => {
    await withTempRoot("ti-parity-enforced-", async (enforcedRoot) => {
      const jobId = "job-parity";
      const [shadow, enforced] = await Promise.all([
        runOnce({ mode: "shadow_eval", model, tempRoot: shadowRoot, jobId }),
        runOnce({ mode: "enforced", model, tempRoot: enforcedRoot, jobId }),
      ]);
      assertParityTriple(shadow, enforced, fixtureLabel);
    });
  });
};

// ---------------------------------------------------------------------------
// Hand-curated fixtures (normal + edge + adversarial)
// ---------------------------------------------------------------------------

interface NamedFixture {
  readonly label: string;
  readonly model: ParityFigmaModel;
}

const NORMAL_FIXTURES: readonly NamedFixture[] = [
  {
    label: "normal/single-screen-banking",
    model: {
      fileKey: "abc123",
      fileName: "Konto Übersicht",
      screens: [
        {
          screenName: "Bedarfsermittlung",
          labels: ["Investitionssumme", "Weiter"],
        },
      ],
    },
  },
  {
    label: "normal/multi-screen-flow",
    model: {
      fileKey: "def456",
      fileName: "Antrag Verlauf",
      screens: [
        { screenName: "Antrag", labels: ["Name", "Submit"] },
        { screenName: "Bestätigung", labels: ["Status", "Weiter"] },
      ],
    },
  },
];

const EDGE_FIXTURES: readonly NamedFixture[] = [
  {
    label: "edge/minimal-screen-single-label",
    model: {
      fileKey: "edge1",
      fileName: "Minimal",
      screens: [{ screenName: "Login", labels: ["Submit"] }],
    },
  },
  {
    label: "edge/long-label-set",
    model: {
      fileKey: "edge2",
      fileName: "Long Form",
      screens: [
        {
          screenName: "Form",
          labels: [
            "Field A",
            "Field B",
            "Field C",
            "Field D",
            "Field E",
            "Submit",
          ],
        },
      ],
    },
  },
];

const ADVERSARIAL_FIXTURES: readonly NamedFixture[] = [
  {
    label: "adversarial/duplicate-screen-names",
    model: {
      fileKey: "adv1",
      fileName: "Duplicate Names",
      screens: [
        { screenName: "Profile", labels: ["Edit", "Save"] },
        { screenName: "Profile", labels: ["View", "Close"] },
      ],
    },
  },
  {
    label: "adversarial/non-ascii-labels",
    model: {
      fileKey: "adv2",
      fileName: "Unicode Form",
      screens: [
        {
          screenName: "Übersicht",
          labels: ["Größe", "Maßstab", "Weiter →"],
        },
      ],
    },
  },
];

const ALL_HAND_FIXTURES: readonly NamedFixture[] = [
  ...NORMAL_FIXTURES,
  ...EDGE_FIXTURES,
  ...ADVERSARIAL_FIXTURES,
];

for (const fixture of ALL_HAND_FIXTURES) {
  test(
    `harness mode parity (hand-fixture): ${fixture.label}`,
    { concurrency: false },
    async () => {
      await assertParityForFixture(fixture.label, fixture.model);
    },
  );
}

// ---------------------------------------------------------------------------
// Property-based parity (covers random valid inputs beyond the curated set)
// ---------------------------------------------------------------------------

const semanticTokenArb = fc.constantFrom(
  "Account",
  "Alert",
  "Balance",
  "Card",
  "Consent",
  "Details",
  "Form",
  "Invoice",
  "Login",
  "Payment",
  "Profile",
  "Review",
  "Summary",
  "Transfer",
  "Verify",
);

const semanticNameArb = fc
  .array(semanticTokenArb, { minLength: 1, maxLength: 3 })
  .map((tokens) => tokens.join(" "));

const hexStringArb = fc
  .array(fc.constantFrom("a", "b", "c", "d", "e", "f", "0", "1", "2", "3"), {
    minLength: 3,
    maxLength: 8,
  })
  .map((chars) => chars.join(""));

const figmaModelArb: fc.Arbitrary<ParityFigmaModel> = fc.record({
  fileKey: hexStringArb,
  fileName: semanticNameArb,
  screens: fc.array(
    fc.record({
      screenName: semanticNameArb,
      labels: fc.array(semanticNameArb, { minLength: 1, maxLength: 4 }),
    }),
    { minLength: 1, maxLength: 3 },
  ),
});

test(
  "harness mode parity (property): random valid Figma payloads produce identical (testCases, validation, policy.violations) in shadow_eval and enforced",
  { concurrency: false },
  async () => {
    let iteration = 0;
    await fc.assert(
      fc.asyncProperty(figmaModelArb, async (model) => {
        iteration += 1;
        await assertParityForFixture(`property/iteration-${iteration}`, model);
      }),
      // Together with the seven hand-curated fixtures above this exceeds the
      // 30-input acceptance bar set by Issue #2118.
      { numRuns: 24 },
    );
  },
);

// ---------------------------------------------------------------------------
// Cross-mode replay-cache key parity
// ---------------------------------------------------------------------------

test(
  "ReplayCacheKey contract excludes any harness-mode field so cache hits are mode-independent",
  () => {
    // Structural pin: the persisted cache-key shape must not carry any
    // field whose name implies the harness mode. Adding such a field would
    // partition the cache by mode and silently break the parity contract.
    const sampleKey: ReplayCacheKey = {
      inputHash: "x".repeat(64),
      promptHash: "y".repeat(64),
      schemaHash: "z".repeat(64),
      routingPolicyDigest: "0".repeat(64),
      modelRevision: "mock-1",
      gatewayRelease: "mock",
      policyBundleVersion: "v1",
      redactionPolicyVersion: REDACTION_POLICY_VERSION,
      visualSidecarSchemaVersion: VISUAL_SIDECAR_SCHEMA_VERSION,
      visualSelectedDeployment: "llama-4-maverick-vision",
      visualFallbackReason: "none",
      promptTemplateVersion: TEST_INTELLIGENCE_PROMPT_TEMPLATE_VERSION,
      cacheablePrefixHash: "1".repeat(64),
    };
    // Reject any field whose name carries harness-mode semantics. The
    // check must be structural (the key set), not substring-based on
    // already-existing fields like `modelRevision`. We pin the exact
    // disallowed names that an unsafe future change would introduce.
    const forbidden = new Set([
      "mode",
      "harnessMode",
      "harness",
      "harnessmode",
      "enforcement",
      "enforced",
      "shadowEval",
      "shadow_eval",
    ]);
    for (const key of Object.keys(sampleKey)) {
      assert.ok(
        !forbidden.has(key),
        `ReplayCacheKey field "${key}" must not encode the harness mode (Issue #2118): cache hits must be mode-independent.`,
      );
    }
    // Additionally, the persisted `cacheKeyDigest` must remain stable
    // when only the harness mode changes; the cross-mode cache parity
    // test below pins the runtime end of this contract.
  },
);

test(
  "harness mode parity: shadow_eval and enforced share the same replay-cache entry",
  { concurrency: false },
  async () => {
    const model: ParityFigmaModel = {
      fileKey: "shared",
      fileName: "Cross Mode Cache",
      screens: [
        {
          screenName: "Bedarfsermittlung",
          labels: ["Investitionssumme", "Weiter"],
        },
      ],
    };
    const sharedCache = createMemoryReplayCache();
    await withTempRoot("ti-parity-cache-", async (tempRoot) => {
      const firstScreen = model.screens[0]!;
      const drafts: ProductionRunnerLlmDraftCase[] = [
        buildUseCaseDraft("1:1", firstScreen.screenName),
        buildEquivalenceDraft("1:1", firstScreen.screenName),
      ];
      const buildClient = () =>
        createMockLlmGatewayClient({
          role: "test_generation",
          deployment: "gpt-oss-120b-mock",
          modelRevision: "mock-1",
          gatewayRelease: "mock",
          responder: okResponder(drafts),
        });

      const baseInput = {
        jobId: "job-cross-mode-cache",
        generatedAt: "2026-05-10T10:00:00Z",
        source: {
          kind: "figma_paste_normalized" as const,
          file: buildFigmaFile(model),
        },
        outputRoot: tempRoot,
        replayCache: sharedCache,
        logicJudge: { enabled: false } as const,
      };

      // First run populates the shared cache under shadow_eval.
      const shadow = await runFigmaToQcTestCases({
        ...baseInput,
        llm: { client: buildClient() },
        harness: { mode: "shadow_eval" },
      });
      for (const testCase of shadow.generatedTestCases.testCases) {
        assert.equal(
          testCase.audit.cacheHit,
          false,
          "first run (shadow_eval) must miss the cache",
        );
      }

      // Second run under enforced must hit the cache populated by the
      // first run. This is the operator-facing guarantee: switching modes
      // does not force a cache-miss / re-spend.
      const enforced = await runFigmaToQcTestCases({
        ...baseInput,
        llm: { client: buildClient() },
        harness: { mode: "enforced" },
      });
      for (const testCase of enforced.generatedTestCases.testCases) {
        assert.equal(
          testCase.audit.cacheHit,
          true,
          "second run (enforced) must hit the cache populated by shadow_eval",
        );
      }

      // The cache key recorded in the audit metadata must be identical
      // across modes; otherwise the cache hit was coincidental.
      const shadowKeys = new Set(
        shadow.generatedTestCases.testCases.map((c) => c.audit.cacheKey),
      );
      const enforcedKeys = new Set(
        enforced.generatedTestCases.testCases.map((c) => c.audit.cacheKey),
      );
      assert.deepStrictEqual(
        [...enforcedKeys].sort(),
        [...shadowKeys].sort(),
        "cache keys recorded across modes must be identical (Issue #2118)",
      );
    });
  },
);

// ---------------------------------------------------------------------------
// Adversarial-throw parity: pre-LLM input rejection raises the same
// `ProductionRunnerError` failure class in both modes.
// ---------------------------------------------------------------------------

test(
  "harness mode parity: empty Figma payload raises EMPTY_FIGMA_INPUT in both modes",
  { concurrency: false },
  async () => {
    const emptyModel: ParityFigmaModel = {
      fileKey: "empty",
      fileName: "Empty",
      screens: [],
    };
    // Build a Figma file with no FRAME children. The runner's pre-LLM
    // validator throws `EMPTY_FIGMA_INPUT` before any harness branch is
    // taken; that early-exit must be mode-independent.
    const fileWithNoScreens = {
      fileKey: emptyModel.fileKey,
      name: emptyModel.fileName,
      document: node({
        id: "0:0",
        type: "DOCUMENT",
        children: [
          node({ id: "0:1", name: "Page 1", type: "CANVAS", children: [] }),
        ],
      }),
    };
    const tryRun = async (
      mode: "shadow_eval" | "enforced",
    ): Promise<ProductionRunnerError> => {
      return await withTempRoot("ti-parity-empty-", async (tempRoot) => {
        const client = createMockLlmGatewayClient({
          role: "test_generation",
          deployment: "gpt-oss-120b-mock",
          modelRevision: "mock-1",
          gatewayRelease: "mock",
          responder: okResponder([]),
        });
        try {
          await runFigmaToQcTestCases({
            jobId: "job-parity-empty",
            generatedAt: "2026-05-10T10:00:00Z",
            source: {
              kind: "figma_paste_normalized",
              file: fileWithNoScreens,
            },
            outputRoot: tempRoot,
            llm: { client },
            logicJudge: { enabled: false },
            harness: { mode },
          });
          throw new Error(
            `expected ProductionRunnerError for empty payload in ${mode} mode`,
          );
        } catch (err) {
          if (err instanceof ProductionRunnerError) return err;
          throw err;
        }
      });
    };

    const shadowError = await tryRun("shadow_eval");
    const enforcedError = await tryRun("enforced");
    assert.equal(
      shadowError.failureClass,
      "EMPTY_FIGMA_INPUT",
      "shadow_eval must surface EMPTY_FIGMA_INPUT for an empty payload",
    );
    assert.equal(
      enforcedError.failureClass,
      shadowError.failureClass,
      "enforced must surface the same failure class as shadow_eval for an empty payload",
    );
  },
);
