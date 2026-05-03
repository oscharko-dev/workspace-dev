import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createMockLlmGatewayClient } from "./llm-mock-gateway.js";
import { cloneEuBankingDefaultFinOpsBudget } from "./finops-budget.js";
import {
  PROMPT_MAX_ACTIONS_PER_SCREEN,
  PROMPT_MAX_FIELDS_PER_SCREEN,
  PROMPT_MAX_NAVIGATION_PER_SCREEN,
  PROMPT_MAX_VALIDATIONS_PER_SCREEN,
  PRODUCTION_RUNNER_FAILURE_CLASSES,
  ProductionRunnerError,
  boundIntentForLlm,
  detectBankingInsuranceScreens,
  runFigmaToQcTestCases,
  type ProductionRunnerLlmDraftCase,
} from "./production-runner.js";
import type { FigmaRestNode } from "./figma-rest-adapter.js";
import {
  BUSINESS_TEST_INTENT_IR_SCHEMA_VERSION,
  EU_BANKING_DEFAULT_POLICY_PROFILE_ID,
  GENEALOGY_ARTIFACT_FILENAME,
  type BusinessTestIntentIr,
  type DetectedAction,
  type DetectedField,
  type DetectedNavigation,
  type DetectedValidation,
} from "../contracts/index.js";

const node = (
  partial: Partial<FigmaRestNode> & { id: string; type: string },
): FigmaRestNode => partial as FigmaRestNode;

const SAMPLE_FILE = {
  fileKey: "ABC",
  name: "Test View 03",
  document: node({
    id: "0:0",
    type: "DOCUMENT",
    children: [
      node({
        id: "0:1",
        name: "Page 1",
        type: "CANVAS",
        children: [
          node({
            id: "1:1",
            name: "Bedarfsermittlung",
            type: "FRAME",
            absoluteBoundingBox: { x: 0, y: 0, width: 600, height: 800 },
            children: [
              node({
                id: "2:1",
                name: "Investitionssumme",
                type: "TEXT",
                characters: "Investitionssumme",
              }),
              node({
                id: "2:2",
                name: "Submit Button",
                type: "INSTANCE",
                characters: "Weiter",
              }),
            ],
          }),
        ],
      }),
    ],
  }),
};

const SAMPLE_DRAFT: ProductionRunnerLlmDraftCase = {
  title: "Eingabe einer gültigen Investitionssumme",
  objective:
    "Bestätigen, dass das Feld Investitionssumme einen gültigen Wert akzeptiert.",
  type: "functional",
  priority: "p1",
  riskCategory: "low",
  technique: "use_case",
  preconditions: ["Bedarfsermittlung Maske ist geöffnet"],
  testData: ["Investitionssumme: 100000"],
  steps: [
    {
      index: 1,
      action: "Öffne die Maske Bedarfsermittlung Investitionsfinanzierung",
      expected: "Maske ist sichtbar",
    },
    {
      index: 2,
      action: "Trage 100000 in das Feld Investitionssumme ein",
      expected: "Eingabe wird akzeptiert",
    },
    {
      index: 3,
      action: "Klicke auf Weiter",
      expected: "Folgemaske wird angezeigt",
    },
  ],
  expectedResults: [
    "Investitionssumme wird gespeichert",
    "Folgemaske erreichbar",
  ],
  figmaTraceRefs: [{ screenId: "1:1", nodeName: "Bedarfsermittlung" }],
  assumptions: [],
  openQuestions: [],
};

const okResponder = (cases: ProductionRunnerLlmDraftCase[]) => () => ({
  outcome: "success" as const,
  content: { testCases: cases },
  finishReason: "stop" as const,
  usage: { inputTokens: 100, outputTokens: 200 },
  modelDeployment: "gpt-oss-120b-mock",
  modelRevision: "mock-1",
  gatewayRelease: "mock",
  attempt: 1,
});

const refusalResponder = () => () => ({
  outcome: "error" as const,
  errorClass: "refusal" as const,
  message: "model refused to respond",
  retryable: false,
  attempt: 1,
});

const schemaInvalidResponder = () => () => ({
  outcome: "success" as const,
  // Wrong shape: testCases must be an array of objects
  content: { testCases: "not an array" },
  finishReason: "stop" as const,
  usage: { inputTokens: 10, outputTokens: 10 },
  modelDeployment: "gpt-oss-120b-mock",
  modelRevision: "mock-1",
  gatewayRelease: "mock",
  attempt: 1,
});

test("runFigmaToQcTestCases happy path persists artifacts and renders customer Markdown", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "ti-runner-"));
  try {
    const client = createMockLlmGatewayClient({
      role: "test_generation",
      deployment: "gpt-oss-120b-mock",
      modelRevision: "mock-1",
      gatewayRelease: "mock",
      responder: okResponder([SAMPLE_DRAFT]),
    });
    const result = await runFigmaToQcTestCases({
      jobId: "job-123",
      generatedAt: "2026-05-02T10:00:00Z",
      source: { kind: "figma_paste_normalized", file: SAMPLE_FILE },
      outputRoot: tempRoot,
      llm: { client },
    });
    assert.equal(result.jobId, "job-123");
    assert.equal(result.generatedTestCases.testCases.length, 1);
    const stamped = result.generatedTestCases.testCases[0];
    assert.ok(stamped);
    assert.equal(stamped.sourceJobId, "job-123");
    assert.equal(stamped.id.startsWith("tc-"), true);
    // Persisted artifact exists.
    const generatedJson = await readFile(
      result.artifactPaths.generatedTestCases,
      "utf8",
    );
    assert.match(generatedJson, /tc-/u);
    assert.ok(result.artifactPaths.genealogy.endsWith(GENEALOGY_ARTIFACT_FILENAME));
    const genealogy = await readFile(result.artifactPaths.genealogy, "utf8");
    assert.match(genealogy, /agent-role-runs\/test_generation\.json/u);
    // Customer markdown was written.
    assert.ok(result.customerMarkdownPaths.combined.endsWith("testfaelle.md"));
    const md = await readFile(result.customerMarkdownPaths.combined, "utf8");
    assert.match(md, /Testfälle/u);
    assert.match(md, /Investitionssumme/u);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("runFigmaToQcTestCases forwards maxInputTokens from the resolved FinOps budget", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "ti-runner-"));
  try {
    const client = createMockLlmGatewayClient({
      role: "test_generation",
      deployment: "gpt-oss-120b-mock",
      modelRevision: "mock-1",
      gatewayRelease: "mock",
      responder: okResponder([SAMPLE_DRAFT]),
    });
    const finopsBudget = cloneEuBankingDefaultFinOpsBudget();
    finopsBudget.roles.test_generation!.maxInputTokensPerRequest = 5_000;

    const result = await runFigmaToQcTestCases({
      jobId: "job-max-input",
      generatedAt: "2026-05-02T10:00:00Z",
      source: { kind: "figma_paste_normalized", file: SAMPLE_FILE },
      outputRoot: tempRoot,
      llm: { client },
      finopsBudget,
    });

    const recorded = client.recordedRequests();
    assert.equal(result.finopsBudget.roles.test_generation?.maxInputTokensPerRequest, 5_000);
    assert.equal(recorded.length, 1);
    assert.equal(recorded[0]?.maxInputTokens, 5_000);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("runFigmaToQcTestCases returns EMPTY_FIGMA_INPUT when the document has no screens", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "ti-runner-"));
  try {
    const client = createMockLlmGatewayClient({
      role: "test_generation",
      deployment: "gpt-oss-120b-mock",
      modelRevision: "mock-1",
      gatewayRelease: "mock",
      responder: okResponder([SAMPLE_DRAFT]),
    });
    await assert.rejects(
      () =>
        runFigmaToQcTestCases({
          jobId: "job-empty",
          generatedAt: "2026-05-02T10:00:00Z",
          source: {
            kind: "figma_paste_normalized",
            file: {
              fileKey: "ABC",
              name: "Empty",
              document: node({ id: "0:0", type: "DOCUMENT", children: [] }),
            },
          },
          outputRoot: tempRoot,
          llm: { client },
        }),
      (err: unknown): boolean =>
        err instanceof ProductionRunnerError &&
        err.failureClass === "EMPTY_FIGMA_INPUT",
    );
    // Failure must not have called the LLM client.
    assert.equal(client.callCount(), 0);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("runFigmaToQcTestCases surfaces LLM_REFUSAL when the gateway returns a refusal", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "ti-runner-"));
  try {
    const client = createMockLlmGatewayClient({
      role: "test_generation",
      deployment: "gpt-oss-120b-mock",
      modelRevision: "mock-1",
      gatewayRelease: "mock",
      responder: refusalResponder(),
    });
    await assert.rejects(
      () =>
        runFigmaToQcTestCases({
          jobId: "job-refusal",
          generatedAt: "2026-05-02T10:00:00Z",
          source: { kind: "figma_paste_normalized", file: SAMPLE_FILE },
          outputRoot: tempRoot,
          llm: { client },
        }),
      (err: unknown): boolean =>
        err instanceof ProductionRunnerError &&
        err.failureClass === "LLM_REFUSAL",
    );
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("runFigmaToQcTestCases surfaces LLM_RESPONSE_INVALID when the structured output is malformed", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "ti-runner-"));
  try {
    const client = createMockLlmGatewayClient({
      role: "test_generation",
      deployment: "gpt-oss-120b-mock",
      modelRevision: "mock-1",
      gatewayRelease: "mock",
      responder: schemaInvalidResponder(),
    });
    await assert.rejects(
      () =>
        runFigmaToQcTestCases({
          jobId: "job-bad",
          generatedAt: "2026-05-02T10:00:00Z",
          source: { kind: "figma_paste_normalized", file: SAMPLE_FILE },
          outputRoot: tempRoot,
          llm: { client },
        }),
      (err: unknown): boolean =>
        err instanceof ProductionRunnerError &&
        err.failureClass === "LLM_RESPONSE_INVALID",
    );
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("runFigmaToQcTestCases stamped output validates against the strict GeneratedTestCaseList schema", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "ti-runner-"));
  try {
    const client = createMockLlmGatewayClient({
      role: "test_generation",
      deployment: "gpt-oss-120b-mock",
      modelRevision: "mock-1",
      gatewayRelease: "mock",
      responder: okResponder([SAMPLE_DRAFT]),
    });
    const result = await runFigmaToQcTestCases({
      jobId: "job-validate",
      generatedAt: "2026-05-02T10:00:00Z",
      source: { kind: "figma_paste_normalized", file: SAMPLE_FILE },
      outputRoot: tempRoot,
      llm: { client },
    });
    // Re-import the validator to assert independence of the runner.
    const { validateGeneratedTestCaseList } =
      await import("./generated-test-case-schema.js");
    const validation = validateGeneratedTestCaseList(result.generatedTestCases);
    assert.equal(
      validation.valid,
      true,
      `validation errors: ${JSON.stringify(validation.errors)}`,
    );
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("runFigmaToQcTestCases rejects an SSRF-flavoured Figma URL with FIGMA_URL_REJECTED", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "ti-runner-"));
  try {
    const client = createMockLlmGatewayClient({
      role: "test_generation",
      deployment: "gpt-oss-120b-mock",
      modelRevision: "mock-1",
      gatewayRelease: "mock",
      responder: okResponder([SAMPLE_DRAFT]),
    });
    await assert.rejects(
      () =>
        runFigmaToQcTestCases({
          jobId: "job-ssrf",
          generatedAt: "2026-05-02T10:00:00Z",
          source: {
            kind: "figma_url",
            figmaUrl: "https://evil.example.com/design/ABC/X",
            accessToken: "figd_test",
          },
          outputRoot: tempRoot,
          llm: { client },
        }),
      (err: unknown): boolean =>
        err instanceof ProductionRunnerError &&
        err.failureClass === "FIGMA_URL_REJECTED",
    );
    assert.equal(client.callCount(), 0);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("PRODUCTION_RUNNER_FAILURE_CLASSES is the closed set used by the runner", () => {
  // Sanity: make sure callers can branch on a stable enum.
  assert.ok(PRODUCTION_RUNNER_FAILURE_CLASSES.includes("EMPTY_FIGMA_INPUT"));
  assert.ok(PRODUCTION_RUNNER_FAILURE_CLASSES.includes("LLM_REFUSAL"));
  assert.ok(PRODUCTION_RUNNER_FAILURE_CLASSES.includes("LLM_RESPONSE_INVALID"));
});

// ---------------------------------------------------------------------------
// boundIntentForLlm — Issue #1733 customer-demo follow-up. Real banking
// Figma files (the customer "Investitionsfinanzierung — Bedarfsermittlung"
// canvas has 5600 children) blow the LLM prompt past every gateway's body
// cap, so the runner ships a deterministic per-screen prefix to the model
// while persisting the full IR for reviewers.
// ---------------------------------------------------------------------------

const makeField = (id: string, screenId: string): DetectedField =>
  ({
    id,
    screenId,
    label: id,
    type: "text",
    confidence: 0.9,
    trace: { nodeId: id },
    provenance: { source: "figma_rest" },
  }) as unknown as DetectedField;

const makeAction = (id: string, screenId: string): DetectedAction =>
  ({
    id,
    screenId,
    label: id,
    kind: "submit",
    confidence: 0.9,
    trace: { nodeId: id },
    provenance: { source: "figma_rest" },
  }) as unknown as DetectedAction;

const makeValidation = (id: string, screenId: string): DetectedValidation =>
  ({
    id,
    screenId,
    rule: "required",
    confidence: 0.9,
    trace: { nodeId: id },
    provenance: { source: "figma_rest" },
  }) as unknown as DetectedValidation;

const makeNavigation = (id: string, screenId: string): DetectedNavigation =>
  ({
    id,
    screenId,
    targetScreenId: `${screenId}-next`,
    confidence: 0.9,
    trace: { nodeId: id },
    provenance: { source: "figma_rest" },
  }) as unknown as DetectedNavigation;

const makeIr = (input: {
  fields: ReadonlyArray<DetectedField>;
  actions?: ReadonlyArray<DetectedAction>;
  validations?: ReadonlyArray<DetectedValidation>;
  navigation?: ReadonlyArray<DetectedNavigation>;
  assumptions?: ReadonlyArray<string>;
}): BusinessTestIntentIr =>
  ({
    version: BUSINESS_TEST_INTENT_IR_SCHEMA_VERSION,
    source: { kind: "figma_rest", contentHash: "h" },
    screens: [],
    detectedFields: [...input.fields],
    detectedActions: [...(input.actions ?? [])],
    detectedValidations: [...(input.validations ?? [])],
    detectedNavigation: [...(input.navigation ?? [])],
    inferredBusinessObjects: [],
    risks: [],
    assumptions: [...(input.assumptions ?? [])],
    openQuestions: [],
    piiIndicators: [],
    redactions: [],
  }) as unknown as BusinessTestIntentIr;

const TINY_CAPS = {
  maxFieldsPerScreen: 2,
  maxActionsPerScreen: 2,
  maxValidationsPerScreen: 2,
  maxNavigationPerScreen: 2,
};

test("boundIntentForLlm: passes through when every screen is under cap", () => {
  const ir = makeIr({
    fields: [
      makeField("f1", "s1"),
      makeField("f2", "s1"),
      makeField("f3", "s2"),
    ],
  });
  const out = boundIntentForLlm(ir, TINY_CAPS);
  assert.equal(out.detectedFields.length, 3);
  assert.equal(out.assumptions.length, 0);
});

test("boundIntentForLlm: caps per-screen and notes truncation in assumptions", () => {
  const ir = makeIr({
    fields: [
      makeField("f1", "s1"),
      makeField("f2", "s1"),
      makeField("f3", "s1"),
      makeField("f4", "s1"),
      makeField("f5", "s2"),
    ],
  });
  const out = boundIntentForLlm(ir, TINY_CAPS);
  // s1 truncated to 2; s2 left alone.
  const s1 = out.detectedFields.filter((f) => f.screenId === "s1");
  const s2 = out.detectedFields.filter((f) => f.screenId === "s2");
  assert.equal(s1.length, 2);
  assert.equal(s2.length, 1);
  // Deterministic prefix: the first two of the original order survive.
  assert.deepEqual(
    s1.map((f) => f.id),
    ["f1", "f2"],
  );
  assert.equal(out.assumptions.length, 1);
  assert.match(out.assumptions[0] ?? "", /detectedFields truncated/);
  assert.match(out.assumptions[0] ?? "", /s1 \(4→2\)/);
  assert.match(
    out.assumptions[0] ?? "",
    /full IR persisted to business-intent-ir\.json/,
  );
});

test("boundIntentForLlm: independent caps per array; each emits its own assumption", () => {
  const ir = makeIr({
    fields: [
      makeField("f1", "s1"),
      makeField("f2", "s1"),
      makeField("f3", "s1"),
    ],
    actions: [
      makeAction("a1", "s1"),
      makeAction("a2", "s1"),
      makeAction("a3", "s1"),
    ],
    validations: [
      makeValidation("v1", "s1"),
      makeValidation("v2", "s1"),
      makeValidation("v3", "s1"),
    ],
    navigation: [
      makeNavigation("n1", "s1"),
      makeNavigation("n2", "s1"),
      makeNavigation("n3", "s1"),
    ],
  });
  const out = boundIntentForLlm(ir, TINY_CAPS);
  assert.equal(out.detectedFields.length, 2);
  assert.equal(out.detectedActions.length, 2);
  assert.equal(out.detectedValidations.length, 2);
  assert.equal(out.detectedNavigation.length, 2);
  assert.equal(out.assumptions.length, 4);
  const joined = out.assumptions.join("\n");
  assert.match(joined, /detectedFields truncated/);
  assert.match(joined, /detectedActions truncated/);
  assert.match(joined, /detectedValidations truncated/);
  assert.match(joined, /detectedNavigation truncated/);
});

test("boundIntentForLlm: preserves prior assumptions and appends new ones", () => {
  const ir = makeIr({
    fields: [
      makeField("f1", "s1"),
      makeField("f2", "s1"),
      makeField("f3", "s1"),
    ],
    assumptions: ["pre-existing assumption from intent derivation"],
  });
  const out = boundIntentForLlm(ir, TINY_CAPS);
  assert.equal(out.assumptions.length, 2);
  assert.equal(
    out.assumptions[0],
    "pre-existing assumption from intent derivation",
  );
  assert.match(out.assumptions[1] ?? "", /detectedFields truncated/);
});

test("boundIntentForLlm: returns a copy — input IR is not mutated", () => {
  const ir = makeIr({
    fields: [
      makeField("f1", "s1"),
      makeField("f2", "s1"),
      makeField("f3", "s1"),
    ],
  });
  const beforeLen = ir.detectedFields.length;
  const beforeAssumptions = ir.assumptions.length;
  boundIntentForLlm(ir, TINY_CAPS);
  assert.equal(ir.detectedFields.length, beforeLen);
  assert.equal(ir.assumptions.length, beforeAssumptions);
});

test("boundIntentForLlm: deterministic — same input + same caps → same wire IR (replay-cache safe)", () => {
  const fields = [
    makeField("f1", "s1"),
    makeField("f2", "s1"),
    makeField("f3", "s1"),
    makeField("f4", "s2"),
    makeField("f5", "s2"),
    makeField("f6", "s2"),
  ];
  const a = boundIntentForLlm(makeIr({ fields }), TINY_CAPS);
  const b = boundIntentForLlm(makeIr({ fields }), TINY_CAPS);
  assert.deepEqual(
    a.detectedFields.map((f) => f.id),
    b.detectedFields.map((f) => f.id),
  );
  assert.deepEqual(a.assumptions, b.assumptions);
});

test("boundIntentForLlm: production caps are positive integers", () => {
  for (const cap of [
    PROMPT_MAX_FIELDS_PER_SCREEN,
    PROMPT_MAX_ACTIONS_PER_SCREEN,
    PROMPT_MAX_VALIDATIONS_PER_SCREEN,
    PROMPT_MAX_NAVIGATION_PER_SCREEN,
  ]) {
    assert.equal(Number.isInteger(cap), true);
    assert.ok(cap > 0);
  }
});

// ---------------------------------------------------------------------------
// Banking / insurance prompt polish + regulatoryRelevance schema field
// (Issue #1735, contract bump 4.27.0).
// ---------------------------------------------------------------------------

const BANKING_FILE = {
  fileKey: "BANK",
  name: "Investitionsfinanzierung",
  document: node({
    id: "0:0",
    type: "DOCUMENT",
    children: [
      node({
        id: "0:1",
        name: "Page 1",
        type: "CANVAS",
        children: [
          node({
            id: "1:1",
            // The screen name carries a banking semantic keyword ("Antrag").
            name: "Kreditantrag — Bonität",
            type: "FRAME",
            absoluteBoundingBox: { x: 0, y: 0, width: 600, height: 800 },
            children: [
              node({
                id: "2:1",
                name: "IBAN",
                type: "TEXT",
                characters: "IBAN",
              }),
              node({
                id: "2:2",
                name: "Antrag absenden",
                type: "INSTANCE",
                characters: "Antrag absenden",
              }),
            ],
          }),
        ],
      }),
    ],
  }),
};

const BANKING_DRAFTS: ProductionRunnerLlmDraftCase[] = [
  {
    title: "Antrag absenden mit Vier-Augen-Prinzip",
    objective:
      "Statusverändernde Aktion (Antrag) erfordert Vier-Augen-Prinzip und Audit-Trail.",
    type: "functional",
    priority: "p0",
    riskCategory: "financial_transaction",
    technique: "use_case",
    preconditions: ["Antragsmaske geöffnet", "Zwei berechtigte Reviewer"],
    testData: ["Antragstyp: Investitionskredit"],
    steps: [
      {
        index: 1,
        action: "Antrag erfassen und absenden",
        expected: "Antrag liegt im Status 'Wartet auf 2. Freigabe'",
      },
      {
        index: 2,
        action: "Zweiter Reviewer bestätigt den Antrag",
        expected: "Audit-Trail-Eintrag mit beiden Reviewer-IDs vorhanden",
      },
    ],
    expectedResults: [
      "Vier-Augen-Prinzip erzwungen",
      "Audit-Trail-Eintrag vorhanden",
    ],
    figmaTraceRefs: [{ screenId: "1:1", nodeName: "Kreditantrag — Bonität" }],
    assumptions: [],
    openQuestions: [],
    regulatoryRelevance: {
      domain: "banking",
      rationale:
        "Statusverändernde Antragsaktion erfordert generisch Vier-Augen-Prinzip und Audit-Trail.",
    },
  },
  {
    title: "Negativtest — ungültige IBAN wird abgelehnt und maskiert",
    objective:
      "Ungültige IBAN wird abgelehnt; eingegebene IBAN wird im UI maskiert.",
    type: "negative",
    priority: "p0",
    riskCategory: "regulated_data",
    technique: "syntax_testing",
    preconditions: ["Kreditantrag-Maske geöffnet"],
    testData: ["IBAN: DE00 0000 0000 0000 0000 00"],
    steps: [
      {
        index: 1,
        action: "Ungültige IBAN in das IBAN-Feld eingeben",
        expected:
          "Validierungsfehler wird angezeigt; eingegebene IBAN wird maskiert dargestellt.",
      },
    ],
    expectedResults: ["Antrag kann nicht abgesendet werden"],
    figmaTraceRefs: [{ screenId: "1:1", nodeName: "IBAN" }],
    assumptions: [],
    openQuestions: [],
    regulatoryRelevance: {
      domain: "banking",
      rationale:
        "Personenbezogene Bankdaten (IBAN) müssen abgelehnt und maskiert werden.",
    },
  },
];

test("detectBankingInsuranceScreens flags screens whose name carries a banking/insurance keyword", () => {
  const intent = {
    screens: [
      { screenId: "s1", screenName: "Kreditantrag — Bonität" },
      { screenId: "s2", screenName: "Schadensfall melden" },
      { screenId: "s3", screenName: "Allgemeine Maske" },
    ],
  } as unknown as BusinessTestIntentIr;
  const matches = detectBankingInsuranceScreens(intent);
  // s1 matches "Antrag" (or "Bonität"); s2 matches "Schadensfall"; s3 unrelated.
  const matchedIds = matches.map((m) => m.screenId).sort();
  assert.deepEqual(matchedIds, ["s1", "s2"]);
});

test("runFigmaToQcTestCases (eu-banking-default profile) augments user prompt with regulatory rules and stamps regulatoryRelevance from drafts", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "ti-runner-"));
  try {
    let observedUserPrompt = "";
    const client = createMockLlmGatewayClient({
      role: "test_generation",
      deployment: "gpt-oss-120b-mock",
      modelRevision: "mock-1",
      gatewayRelease: "mock",
      responder: (request) => {
        observedUserPrompt = request.userPrompt;
        return {
          outcome: "success" as const,
          content: { testCases: BANKING_DRAFTS },
          finishReason: "stop" as const,
          usage: { inputTokens: 100, outputTokens: 200 },
          modelDeployment: "gpt-oss-120b-mock",
          modelRevision: "mock-1",
          gatewayRelease: "mock",
          attempt: 1,
        };
      },
    });
    const result = await runFigmaToQcTestCases({
      jobId: "job-banking",
      generatedAt: "2026-05-02T10:00:00Z",
      source: { kind: "figma_paste_normalized", file: BANKING_FILE },
      outputRoot: tempRoot,
      llm: { client },
      // Default policyProfileId is eu-banking-default — explicit here for clarity.
      policyProfileId: EU_BANKING_DEFAULT_POLICY_PROFILE_ID,
    });

    // (a) The user prompt was augmented with the banking compliance rules.
    assert.match(observedUserPrompt, /POLICY-PROFIL: eu-banking-default/u);
    assert.match(observedUserPrompt, /IBAN/u);
    assert.match(observedUserPrompt, /Vier-Augen-Prinzip/u);
    assert.match(observedUserPrompt, /Banking\/Versicherungs-Bildschirme/u);
    // The IR-derived screen "Kreditantrag — Bonität" surfaces in the
    // banking screen list (matched by "Antrag" or "Bonität" keyword).
    assert.match(observedUserPrompt, /Stichwort: (Antrag|Bonität)/u);
    // Forbids citing specific paragraphs.
    assert.match(observedUserPrompt, /KEINE Paragraphen/u);

    // (b) ≥ 1 case has regulatoryRelevance.domain === "banking"
    const cases = result.generatedTestCases.testCases;
    const bankingCases = cases.filter(
      (c) => c.regulatoryRelevance?.domain === "banking",
    );
    assert.ok(
      bankingCases.length >= 1,
      `expected ≥ 1 banking case, got ${bankingCases.length}`,
    );

    // (c) Negative test for IBAN field present.
    const ibanNegative = cases.find(
      (c) => c.type === "negative" && /IBAN/u.test(c.title + c.objective),
    );
    assert.ok(ibanNegative, "expected a negative case naming IBAN");

    // (d) Four-eyes case present when "Antrag" is in the screen.
    const fourEyes = cases.find((c) =>
      /Vier-Augen-Prinzip/u.test(c.title + c.objective),
    );
    assert.ok(fourEyes, "expected a four-eyes case for the Antrag screen");
    assert.equal(fourEyes.priority, "p0");
    assert.equal(fourEyes.riskCategory, "financial_transaction");

    // The customer markdown surfaces the regulatory-relevance line.
    const md = await readFile(result.customerMarkdownPaths.combined, "utf8");
    assert.match(md, /Regulatorische Relevanz:\*\* banking/u);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("runFigmaToQcTestCases skips banking augmentation when policyProfileId is not eu-banking-default", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "ti-runner-"));
  try {
    let observedUserPrompt = "";
    const client = createMockLlmGatewayClient({
      role: "test_generation",
      deployment: "gpt-oss-120b-mock",
      modelRevision: "mock-1",
      gatewayRelease: "mock",
      responder: (request) => {
        observedUserPrompt = request.userPrompt;
        return {
          outcome: "success" as const,
          content: { testCases: [SAMPLE_DRAFT] },
          finishReason: "stop" as const,
          usage: { inputTokens: 100, outputTokens: 200 },
          modelDeployment: "gpt-oss-120b-mock",
          modelRevision: "mock-1",
          gatewayRelease: "mock",
          attempt: 1,
        };
      },
    });
    await runFigmaToQcTestCases({
      jobId: "job-non-banking",
      generatedAt: "2026-05-02T10:00:00Z",
      source: { kind: "figma_paste_normalized", file: SAMPLE_FILE },
      outputRoot: tempRoot,
      llm: { client },
      policyProfileId: "non-banking-test-profile",
    });
    assert.doesNotMatch(
      observedUserPrompt,
      /POLICY-PROFIL: eu-banking-default/u,
    );
    assert.doesNotMatch(observedUserPrompt, /Vier-Augen-Prinzip/u);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// FinOps envelope (Issue #1740) + progress events (Issue #1738)
// ---------------------------------------------------------------------------

test("runFigmaToQcTestCases uses PRODUCTION_FINOPS_BUDGET_ENVELOPE by default", async () => {
  const { PRODUCTION_FINOPS_BUDGET_ENVELOPE } =
    await import("./finops-budget.js");
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "ti-runner-"));
  try {
    const client = createMockLlmGatewayClient({
      role: "test_generation",
      deployment: "gpt-oss-120b-mock",
      modelRevision: "mock-1",
      gatewayRelease: "mock",
      responder: okResponder([SAMPLE_DRAFT]),
    });
    const result = await runFigmaToQcTestCases({
      jobId: "job-finops-default",
      generatedAt: "2026-05-02T10:00:00Z",
      source: { kind: "figma_paste_normalized", file: SAMPLE_FILE },
      outputRoot: tempRoot,
      llm: { client },
    });
    assert.equal(result.finopsBudget.budgetId, "production-default");
    assert.deepEqual(
      result.finopsBudget.roles.test_generation,
      PRODUCTION_FINOPS_BUDGET_ENVELOPE.roles.test_generation,
    );
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("runFigmaToQcTestCases honours operator FinOps override (no merge with default)", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "ti-runner-"));
  try {
    const client = createMockLlmGatewayClient({
      role: "test_generation",
      deployment: "gpt-oss-120b-mock",
      modelRevision: "mock-1",
      gatewayRelease: "mock",
      responder: okResponder([SAMPLE_DRAFT]),
    });
    const override = {
      budgetId: "operator-supplied",
      budgetVersion: "9.9.9",
      roles: {
        test_generation: {
          maxOutputTokensPerRequest: 1234,
          maxWallClockMsPerRequest: 5000,
        },
      },
    };
    const result = await runFigmaToQcTestCases({
      jobId: "job-finops-override",
      generatedAt: "2026-05-02T10:00:00Z",
      source: { kind: "figma_paste_normalized", file: SAMPLE_FILE },
      outputRoot: tempRoot,
      llm: { client },
      finopsBudget: override,
    });
    // Operator override wins outright.
    assert.equal(result.finopsBudget.budgetId, "operator-supplied");
    assert.equal(result.finopsBudget.budgetVersion, "9.9.9");
    assert.equal(
      result.finopsBudget.roles.test_generation?.maxOutputTokensPerRequest,
      1234,
    );
    // Production defaults must NOT leak into the override.
    assert.equal(
      result.finopsBudget.roles.visual_primary,
      undefined,
      "no merge: visual_primary should be absent when override omits it",
    );
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("runFigmaToQcTestCases fails closed on invalid FinOps envelope", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "ti-runner-"));
  try {
    const client = createMockLlmGatewayClient({
      role: "test_generation",
      deployment: "gpt-oss-120b-mock",
      modelRevision: "mock-1",
      gatewayRelease: "mock",
      responder: okResponder([SAMPLE_DRAFT]),
    });
    const invalid = {
      budgetId: "",
      budgetVersion: "1.0.0",
      roles: {},
    };
    await assert.rejects(
      runFigmaToQcTestCases({
        jobId: "job-finops-invalid",
        generatedAt: "2026-05-02T10:00:00Z",
        source: { kind: "figma_paste_normalized", file: SAMPLE_FILE },
        outputRoot: tempRoot,
        llm: { client },
        finopsBudget: invalid,
      }),
      (err) => {
        assert.ok(err instanceof ProductionRunnerError);
        assert.equal(err.failureClass, "FINOPS_BUDGET_INVALID");
        assert.equal(err.retryable, false);
        return true;
      },
    );
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("runFigmaToQcTestCases emits progress events in expected order", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "ti-runner-"));
  try {
    const client = createMockLlmGatewayClient({
      role: "test_generation",
      deployment: "gpt-oss-120b-mock",
      modelRevision: "mock-1",
      gatewayRelease: "mock",
      responder: okResponder([SAMPLE_DRAFT]),
    });
    const observed: string[] = [];
    await runFigmaToQcTestCases({
      jobId: "job-events",
      generatedAt: "2026-05-02T10:00:00Z",
      source: { kind: "figma_paste_normalized", file: SAMPLE_FILE },
      outputRoot: tempRoot,
      llm: { client },
      events: (event) => observed.push(event.phase),
    });
    // Order matters for the UI timeline.
    assert.deepEqual(observed, [
      "intent_derivation_started",
      "intent_derivation_complete",
      "visual_sidecar_skipped",
      "prompt_compiled",
      "llm_gateway_request",
      "llm_gateway_response",
      "validation_started",
      "validation_complete",
      "policy_decision",
      "export_started",
      "export_complete",
      "evidence_sealed",
      "finops_recorded",
    ]);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("runFigmaToQcTestCases events carry no PII / no raw LLM body", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "ti-runner-"));
  try {
    const client = createMockLlmGatewayClient({
      role: "test_generation",
      deployment: "gpt-oss-120b-mock",
      modelRevision: "mock-1",
      gatewayRelease: "mock",
      responder: okResponder([SAMPLE_DRAFT]),
    });
    const events: Array<{ phase: string; details?: unknown }> = [];
    await runFigmaToQcTestCases({
      jobId: "job-events-pii",
      generatedAt: "2026-05-02T10:00:00Z",
      source: { kind: "figma_paste_normalized", file: SAMPLE_FILE },
      outputRoot: tempRoot,
      llm: { client },
      events: (event) =>
        events.push({ phase: event.phase, details: event.details }),
    });
    const blob = JSON.stringify(events);
    // No raw user-prompt, no raw LLM body, no Figma node data.
    assert.doesNotMatch(blob, /Investitionssumme/u);
    assert.doesNotMatch(blob, /Bedarfsermittlung/u);
    // Sink errors must not propagate.
    const throwingClient = createMockLlmGatewayClient({
      role: "test_generation",
      deployment: "gpt-oss-120b-mock",
      modelRevision: "mock-1",
      gatewayRelease: "mock",
      responder: okResponder([SAMPLE_DRAFT]),
    });
    await runFigmaToQcTestCases({
      jobId: "job-events-throw",
      generatedAt: "2026-05-02T10:00:00Z",
      source: { kind: "figma_paste_normalized", file: SAMPLE_FILE },
      outputRoot: tempRoot,
      llm: { client: throwingClient },
      events: () => {
        throw new Error("boom");
      },
    });
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("runFigmaToQcTestCases tolerates malformed regulatoryRelevance on a draft (silently drops)", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "ti-runner-"));
  try {
    const malformed = {
      ...SAMPLE_DRAFT,
      regulatoryRelevance: {
        domain: "not-a-real-domain",
        rationale: "x",
      },
    } as unknown as ProductionRunnerLlmDraftCase;
    const client = createMockLlmGatewayClient({
      role: "test_generation",
      deployment: "gpt-oss-120b-mock",
      modelRevision: "mock-1",
      gatewayRelease: "mock",
      responder: okResponder([malformed]),
    });
    const result = await runFigmaToQcTestCases({
      jobId: "job-bad-reg",
      generatedAt: "2026-05-02T10:00:00Z",
      source: { kind: "figma_paste_normalized", file: SAMPLE_FILE },
      outputRoot: tempRoot,
      llm: { client },
    });
    const stamped = result.generatedTestCases.testCases[0];
    assert.ok(stamped);
    assert.equal(stamped.regulatoryRelevance, undefined);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});
