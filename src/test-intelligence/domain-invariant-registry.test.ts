/**
 * Unit tests for the domain-invariant registry (Issue #2040). These cover
 * the DSL contract (`{ id, scope, forall, holds, severity, source }`),
 * the active-dataset invariant set, and the deterministic ordering
 * guarantees the validation pipeline relies on.
 */

import assert from "node:assert/strict";
import test from "node:test";
import {
  GENERATED_TEST_CASE_SCHEMA_VERSION,
  TEST_INTELLIGENCE_CONTRACT_VERSION,
  TEST_INTELLIGENCE_PROMPT_TEMPLATE_VERSION,
  type BusinessTestIntentIr,
  type GeneratedTestCase,
  type TestDesignModel,
} from "../contracts/index.js";
import {
  buildActiveDatasetInvariantRegistry,
  computeInvariantCoverageRatio,
  createInvariantRegistry,
  evaluateInvariants,
  type DomainInvariant,
} from "./domain-invariant-registry.js";
import { buildTestDesignModel } from "./test-design-model.js";

const ZERO_HASH =
  "0000000000000000000000000000000000000000000000000000000000000000";
const GENERATED_AT = "2026-04-25T10:00:00.000Z";

const buildIntentWithFinancing = (): BusinessTestIntentIr => ({
  version: "1.0.0",
  source: { kind: "figma_local_json", contentHash: ZERO_HASH },
  screens: [
    {
      screenId: "s-loan",
      screenName: "Loan",
      trace: { nodeId: "s-loan" },
    },
  ],
  detectedFields: [
    {
      id: "s-loan::field::n-principal",
      screenId: "s-loan",
      trace: { nodeId: "n-principal" },
      provenance: "figma_node",
      confidence: 0.9,
      label: "Principal",
      type: "text",
    },
    {
      id: "s-loan::field::n-financing-need",
      screenId: "s-loan",
      trace: { nodeId: "n-financing-need" },
      provenance: "figma_node",
      confidence: 0.9,
      label: "Financing need",
      type: "text",
    },
  ],
  detectedActions: [],
  detectedValidations: [],
  detectedNavigation: [],
  inferredBusinessObjects: [],
  risks: [],
  assumptions: [],
  openQuestions: ["Die MwSt. ist nicht Teil des Finanzierungsbedarfs."],
  piiIndicators: [],
  redactions: [],
});

const buildIntentNoFinancing = (): BusinessTestIntentIr => ({
  version: "1.0.0",
  source: { kind: "figma_local_json", contentHash: ZERO_HASH },
  screens: [
    {
      screenId: "s-form",
      screenName: "Simple Form",
      trace: { nodeId: "s-form" },
    },
  ],
  detectedFields: [],
  detectedActions: [],
  detectedValidations: [],
  detectedNavigation: [],
  inferredBusinessObjects: [],
  risks: [],
  assumptions: [],
  openQuestions: [],
  piiIndicators: [],
  redactions: [],
});

const buildCase = (
  overrides: Partial<GeneratedTestCase> = {},
): GeneratedTestCase => ({
  id: "tc-1",
  sourceJobId: "job-1",
  contractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
  schemaVersion: GENERATED_TEST_CASE_SCHEMA_VERSION,
  promptTemplateVersion: TEST_INTELLIGENCE_PROMPT_TEMPLATE_VERSION,
  title: "Submit loan",
  objective: "Submit a loan application",
  level: "system",
  type: "functional",
  priority: "p1",
  riskCategory: "financial_transaction",
  technique: "use_case",
  preconditions: [],
  testData: [],
  steps: [
    { index: 1, action: "Open the loan form" },
    {
      index: 2,
      action: "Submit the form",
      expected: "Confirmation displayed",
    },
  ],
  expectedResults: ["Confirmation displayed"],
  figmaTraceRefs: [{ screenId: "s-loan" }],
  assumptions: [],
  openQuestions: [],
  qcMappingPreview: { exportable: true },
  qualitySignals: {
    coveredFieldIds: [],
    coveredActionIds: [],
    coveredValidationIds: [],
    coveredNavigationIds: [],
    confidence: 0.8,
  },
  reviewState: "draft",
  audit: {
    jobId: "job-1",
    generatedAt: GENERATED_AT,
    contractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
    schemaVersion: GENERATED_TEST_CASE_SCHEMA_VERSION,
    promptTemplateVersion: TEST_INTELLIGENCE_PROMPT_TEMPLATE_VERSION,
    redactionPolicyVersion: "1.0.0",
    visualSidecarSchemaVersion: "1.0.0",
    cacheHit: false,
    cacheKey: "k",
    inputHash: ZERO_HASH,
    promptHash: ZERO_HASH,
    schemaHash: ZERO_HASH,
  },
  ...overrides,
});

const buildContext = (
  intent: BusinessTestIntentIr,
): { intent: BusinessTestIntentIr; model: TestDesignModel } => {
  const model = buildTestDesignModel({ jobId: "job-1", intent });
  return { intent, model };
};

test("registry: rejects malformed invariant ids", () => {
  const registry = createInvariantRegistry();
  assert.throws(() =>
    registry.register({
      id: "not-following-pattern",
      scope: "scope",
      description: "desc",
      source: "test",
      severity: "error",
      forall: () => false,
      holds: () => true,
    }),
  );
});

test("registry: refuses duplicate invariant ids", () => {
  const registry = createInvariantRegistry();
  const invariant: DomainInvariant = {
    id: "INV-TEST-01",
    scope: "test",
    description: "desc",
    source: "test",
    severity: "error",
    forall: () => true,
    holds: () => true,
  };
  registry.register(invariant);
  assert.throws(() => registry.register(invariant));
});

test("registry: list() and ids() are alphabetically sorted", () => {
  const registry = createInvariantRegistry();
  for (const id of ["INV-Z-01", "INV-A-01", "INV-M-01"]) {
    registry.register({
      id,
      scope: "test",
      description: id,
      source: "test",
      severity: "warning",
      forall: () => false,
      holds: () => true,
    });
  }
  assert.deepEqual(registry.ids(), ["INV-A-01", "INV-M-01", "INV-Z-01"]);
  assert.deepEqual(
    registry.list().map((entry) => entry.id),
    ["INV-A-01", "INV-M-01", "INV-Z-01"],
  );
});

test("active-dataset registry exposes the documented invariant ids", () => {
  const registry = buildActiveDatasetInvariantRegistry();
  assert.deepEqual(registry.ids(), [
    "INV-AML-CUMUL-01",
    "INV-DORA-ICT-01",
    "INV-EAA-KBD-01",
    "INV-FINANCING-NEED-01",
    "INV-FX-MARGIN-01",
    "INV-GDPR-ART15-01",
    "INV-GDPR-ART9-01",
    "INV-GWG-PEP-01",
    "INV-IDD-DEMANDS-01",
    "INV-KYC-AGE-01",
    "INV-MIFID-APPROP-01",
    "INV-MIFID-COSTS-01",
    "INV-MIFID-SUITAB-01",
    "INV-NETTO-BRUTTO-01",
    "INV-OPTIONAL-COST-01",
    "INV-PSD2-DYNLINK-01",
    "INV-PSD2-SCA-01",
    "INV-SOLV2-COOLOFF-01",
    "INV-VAG-BERATUNG-01",
    "INV-VAT-01",
  ]);
});

test("active-dataset registry has at least 20 invariants for Issue #2108", () => {
  const registry = buildActiveDatasetInvariantRegistry();
  assert.ok(
    registry.ids().length >= 20,
    `expected ≥ 20 invariants registered, got ${registry.ids().length}`,
  );
});

test("Issue #2108 compliance invariants all carry a non-empty legalSource citation", () => {
  const registry = buildActiveDatasetInvariantRegistry();
  const compliance = registry
    .list()
    .filter((invariant) => invariant.source === "Issue #2108 (registered)");
  assert.ok(
    compliance.length >= 16,
    `expected ≥ 16 Issue #2108 invariants, got ${compliance.length}`,
  );
  for (const invariant of compliance) {
    assert.ok(
      invariant.legalSource !== undefined,
      `${invariant.id} must declare a legalSource citation`,
    );
    assert.ok(
      invariant.legalSource.framework.length > 0,
      `${invariant.id}.legalSource.framework must not be empty`,
    );
    assert.ok(
      invariant.legalSource.citation.length > 0,
      `${invariant.id}.legalSource.citation must not be empty`,
    );
  }
});

test("evaluateInvariants: case touching VAT-financing rule fires INV-VAT-01 violation", () => {
  const intent = buildIntentWithFinancing();
  const context = buildContext(intent);
  const offending = buildCase({
    title: "Verify financing need with VAT",
    objective:
      "Submit the loan form and confirm the financing need including VAT.",
    expectedResults: [
      "Financing need equals 1.000,00 € including VAT.",
    ],
    steps: [
      {
        index: 1,
        action: "Open the financing screen",
        expected: "Financing need with VAT plus shown.",
      },
    ],
  });
  const evaluation = evaluateInvariants({
    registry: buildActiveDatasetInvariantRegistry(),
    testCases: [offending],
    context,
  });
  assert.ok(
    evaluation.violations.some(
      (violation) => violation.invariantId === "INV-VAT-01",
    ),
    "INV-VAT-01 violation must fire when the case includes VAT in the financing-need result",
  );
  assert.ok(evaluation.exercisedInvariants.includes("INV-VAT-01"));
});

test("evaluateInvariants: brutto/netto exclusivity is rejected on a single string", () => {
  const intent = buildIntentNoFinancing();
  const context = buildContext(intent);
  const offending = buildCase({
    expectedResults: [
      "The total Netto and Brutto amounts both equal 1.000,00 €.",
    ],
  });
  const ok = buildCase({
    id: "tc-2",
    expectedResults: ["The Netto total is 1.000,00 €."],
  });
  const evaluation = evaluateInvariants({
    registry: buildActiveDatasetInvariantRegistry(),
    testCases: [offending, ok],
    context,
  });
  assert.equal(
    evaluation.violations.filter(
      (violation) => violation.invariantId === "INV-NETTO-BRUTTO-01",
    ).length,
    1,
  );
  const offendingEval = evaluation.cases.find(
    (entry) => entry.testCaseId === offending.id,
  );
  assert.ok(offendingEval);
  assert.ok(offendingEval.exercises.includes("INV-NETTO-BRUTTO-01"));
});

test("evaluateInvariants: netto/brutto option-label accessibility text is not a financial-result violation", () => {
  const intent = buildIntentNoFinancing();
  const context = buildContext(intent);
  const optionLabelCase = buildCase({
    id: "tc-option-label",
    type: "accessibility",
    expectedResults: [
      "Screen-Reader reads both options Netto and Brutto correctly.",
    ],
    steps: [
      {
        index: 1,
        action: "Navigate to the price-basis options",
        expected: "Screen-Reader announces both options Netto and Brutto.",
      },
    ],
  });
  const evaluation = evaluateInvariants({
    registry: buildActiveDatasetInvariantRegistry(),
    testCases: [optionLabelCase],
    context,
  });
  assert.equal(
    evaluation.violations.some(
      (violation) => violation.invariantId === "INV-NETTO-BRUTTO-01",
    ),
    false,
  );
  assert.ok(
    evaluation.cases
      .find((entry) => entry.testCaseId === optionLabelCase.id)
      ?.exercises.includes("INV-NETTO-BRUTTO-01"),
  );
});

test("evaluateInvariants: netto/brutto focus order with financial field labels is not a result conflation", () => {
  const intent = buildIntentNoFinancing();
  const context = buildContext(intent);
  const focusOrderCase = buildCase({
    id: "tc-focus-order",
    type: "accessibility",
    expectedResults: [
      "Alle Elemente erhalten sichtbaren Fokus, Beschriftungen werden korrekt per Screen-Reader angekündigt.",
    ],
    steps: [
      {
        index: 1,
        action: "Tab-Taste wiederholt drücken, um durch alle interaktiven Elemente zu navigieren",
        expected:
          "Fokus bewegt sich in folgender Reihenfolge: Netto-Option -> Brutto-Option -> Feld Kaufpreis (Netto) -> Feld Nebenkosten (Brutto). Jeder Fokus ist sichtbar und wird vom Screen-Reader vorgelesen.",
      },
    ],
  });
  const evaluation = evaluateInvariants({
    registry: buildActiveDatasetInvariantRegistry(),
    testCases: [focusOrderCase],
    context,
  });
  assert.equal(
    evaluation.violations.some(
      (violation) => violation.invariantId === "INV-NETTO-BRUTTO-01",
    ),
    false,
  );
  assert.ok(
    evaluation.cases
      .find((entry) => entry.testCaseId === focusOrderCase.id)
      ?.exercises.includes("INV-NETTO-BRUTTO-01"),
  );
});

test("evaluateInvariants: optional-cost expectation without selection is a violation", () => {
  const intent = buildIntentNoFinancing();
  const context = buildContext(intent);
  const offending = buildCase({
    expectedResults: [
      "The total includes the optional fee Versandgebühr and equals 105,00 €.",
    ],
  });
  const evaluation = evaluateInvariants({
    registry: buildActiveDatasetInvariantRegistry(),
    testCases: [offending],
    context,
  });
  assert.equal(
    evaluation.violations.filter(
      (violation) => violation.invariantId === "INV-OPTIONAL-COST-01",
    ).length,
    1,
  );
});

test("evaluateInvariants: optional-cost selection in preconditions clears the case", () => {
  const intent = buildIntentNoFinancing();
  const context = buildContext(intent);
  const ok = buildCase({
    preconditions: [
      "The optional fee Versandgebühr is selected with value 5,00 €.",
    ],
    expectedResults: [
      "The total includes the optional fee Versandgebühr and equals 105,00 €.",
    ],
  });
  const evaluation = evaluateInvariants({
    registry: buildActiveDatasetInvariantRegistry(),
    testCases: [ok],
    context,
  });
  assert.equal(
    evaluation.violations.filter(
      (violation) => violation.invariantId === "INV-OPTIONAL-COST-01",
    ).length,
    0,
  );
});

test("evaluateInvariants: violations are sorted deterministically", () => {
  const intent = buildIntentWithFinancing();
  const context = buildContext(intent);
  const cases = [
    buildCase({
      id: "tc-z",
      expectedResults: ["Financing need equals 1.000,00 € VAT plus."],
    }),
    buildCase({
      id: "tc-a",
      expectedResults: ["Financing need equals 1.000,00 € VAT plus."],
    }),
  ];
  const evaluation = evaluateInvariants({
    registry: buildActiveDatasetInvariantRegistry(),
    testCases: cases,
    context,
  });
  const ids = evaluation.violations.map((violation) => violation.testCaseId);
  assert.deepEqual(ids, [...ids].sort((left, right) => left.localeCompare(right)));
});

test("computeInvariantCoverageRatio: empty registry yields zeros", () => {
  const ratio = computeInvariantCoverageRatio({
    registered: [],
    cases: [],
    exercisedInvariants: [],
    violations: [],
  });
  assert.deepEqual(ratio, { total: 0, exercised: 0, ratio: 0 });
});

test("computeInvariantCoverageRatio: rounds to six digits", () => {
  const ratio = computeInvariantCoverageRatio({
    registered: ["a", "b", "c"],
    cases: [],
    exercisedInvariants: ["a"],
    violations: [],
  });
  assert.deepEqual(ratio, {
    total: 3,
    exercised: 1,
    ratio: Math.round((1 / 3) * 1_000_000) / 1_000_000,
  });
});

test("evaluateInvariants: registry with no scope match leaves invariantCoverage at zero", () => {
  const intent = buildIntentNoFinancing();
  const context = buildContext(intent);
  const evaluation = evaluateInvariants({
    registry: buildActiveDatasetInvariantRegistry(),
    testCases: [buildCase({ expectedResults: ["Confirmation displayed."] })],
    context,
  });
  assert.deepEqual(evaluation.exercisedInvariants, []);
  assert.equal(evaluation.violations.length, 0);
  assert.ok(evaluation.registered.length >= 20);
});

/* -------------------------------------------------------------------- */
/*  Issue #2108 — EU banking + insurance compliance invariants          */
/* -------------------------------------------------------------------- */

const buildComplianceCase = (
  id: string,
  text: {
    title?: string;
    objective?: string;
    preconditions?: string[];
    expectedResults?: string[];
    steps?: GeneratedTestCase["steps"];
  },
): GeneratedTestCase =>
  buildCase({
    id,
    title: text.title ?? "Compliance scenario",
    objective: text.objective ?? "Exercise compliance invariant",
    preconditions: text.preconditions ?? [],
    expectedResults: text.expectedResults ?? [],
    steps: text.steps ?? [{ index: 1, action: "Open the form" }],
  });

const expectInvariantViolation = (
  invariantId: string,
  testCase: GeneratedTestCase,
  intent: BusinessTestIntentIr = buildIntentNoFinancing(),
): void => {
  const evaluation = evaluateInvariants({
    registry: buildActiveDatasetInvariantRegistry(),
    testCases: [testCase],
    context: buildContext(intent),
  });
  assert.ok(
    evaluation.exercisedInvariants.includes(invariantId),
    `${invariantId} must be exercised by the negative case`,
  );
  assert.ok(
    evaluation.violations.some(
      (violation) => violation.invariantId === invariantId,
    ),
    `${invariantId} must record a violation for the negative case`,
  );
};

const expectInvariantSatisfied = (
  invariantId: string,
  testCase: GeneratedTestCase,
  intent: BusinessTestIntentIr = buildIntentNoFinancing(),
): void => {
  const evaluation = evaluateInvariants({
    registry: buildActiveDatasetInvariantRegistry(),
    testCases: [testCase],
    context: buildContext(intent),
  });
  assert.ok(
    evaluation.exercisedInvariants.includes(invariantId),
    `${invariantId} must be exercised by the positive case`,
  );
  assert.equal(
    evaluation.violations.filter((v) => v.invariantId === invariantId).length,
    0,
    `${invariantId} must not record a violation for the positive case`,
  );
};

test("INV-PSD2-SCA-01: high-value payment without 2FA fires; with SCA passes", () => {
  expectInvariantViolation(
    "INV-PSD2-SCA-01",
    buildComplianceCase("tc-psd2-sca-neg", {
      title: "Hochbetrag SEPA payment",
      objective:
        "Submit a high-value payment exceeding the regulatory threshold",
      expectedResults: [
        "Payment is executed when the amount exceeds the limit.",
      ],
    }),
  );
  expectInvariantSatisfied(
    "INV-PSD2-SCA-01",
    buildComplianceCase("tc-psd2-sca-pos", {
      title: "Hochbetrag SEPA payment with 2FA",
      objective:
        "Submit a high-value payment; SCA via pushTAN required before execution",
      preconditions: ["The user has registered a pushTAN device for 2FA."],
      expectedResults: [
        "Payment requests strong-customer-authentication (SCA) before execution; 2FA pushTAN dynamically linked to amount and payee.",
      ],
    }),
  );
});

test("INV-PSD2-DYNLINK-01: SCA without dynamic linking to amount and payee fires", () => {
  expectInvariantViolation(
    "INV-PSD2-DYNLINK-01",
    buildComplianceCase("tc-dynlink-neg", {
      title: "High-value payment with 2FA",
      objective: "Authorise a high-value payment via 2FA",
      expectedResults: ["A 2FA prompt is shown and the payment is approved."],
    }),
  );
  expectInvariantSatisfied(
    "INV-PSD2-DYNLINK-01",
    buildComplianceCase("tc-dynlink-pos", {
      title: "High-value payment with dynamically linked SCA",
      objective: "Authorise a high-value payment via 2FA",
      expectedResults: [
        "Payment 2FA challenge is dynamically linked to amount and payee.",
      ],
    }),
  );
});

test("INV-MIFID-SUITAB-01: securities order without suitability fires", () => {
  expectInvariantViolation(
    "INV-MIFID-SUITAB-01",
    buildComplianceCase("tc-mifid-suit-neg", {
      title: "Place a Wertpapierorder",
      objective: "Submit a securities order with ISIN DE000BAY0017",
      expectedResults: ["The order is forwarded to the broker."],
    }),
  );
  expectInvariantSatisfied(
    "INV-MIFID-SUITAB-01",
    buildComplianceCase("tc-mifid-suit-pos", {
      title: "Place a Wertpapierorder with completed suitability",
      objective:
        "Submit a Wertpapierorder after the suitability questionnaire is complete",
      preconditions: ["Suitability assessment (Geeignetheitsprüfung) is complete."],
      expectedResults: ["Order is accepted and the suitability statement is referenced."],
    }),
  );
});

test("INV-MIFID-APPROP-01: complex product warning required for execution-only", () => {
  expectInvariantViolation(
    "INV-MIFID-APPROP-01",
    buildComplianceCase("tc-mifid-appr-neg", {
      title: "Wertpapierorder CFD",
      objective: "Submit an execution-only order for a CFD complex product",
      expectedResults: ["Order is executed without further interaction."],
    }),
  );
  expectInvariantSatisfied(
    "INV-MIFID-APPROP-01",
    buildComplianceCase("tc-mifid-appr-pos", {
      title: "Wertpapierorder CFD with appropriateness warning",
      objective: "Submit an execution-only order for a CFD complex product",
      expectedResults: [
        "Appropriateness warning (Angemessenheitsprüfung) is displayed before order submission for the complex product.",
      ],
    }),
  );
});

test("INV-MIFID-COSTS-01: order without ex-ante costs disclosure fires", () => {
  expectInvariantViolation(
    "INV-MIFID-COSTS-01",
    buildComplianceCase("tc-mifid-costs-neg", {
      title: "Securities order missing costs disclosure",
      objective: "Submit a Wertpapierorder",
      expectedResults: ["Order confirmation is displayed."],
    }),
  );
  expectInvariantSatisfied(
    "INV-MIFID-COSTS-01",
    buildComplianceCase("tc-mifid-costs-pos", {
      title: "Securities order with ex-ante costs disclosure",
      objective: "Submit a Wertpapierorder",
      expectedResults: [
        "Ex-ante costs and charges disclosure (Kosten und Gebühren) is shown before order execution.",
      ],
    }),
  );
});

test("INV-GWG-PEP-01: high-value transfer without PEP screening fires", () => {
  expectInvariantViolation(
    "INV-GWG-PEP-01",
    buildComplianceCase("tc-pep-neg", {
      title: "High-value transfer / Hochbetragsüberweisung",
      objective: "Initiate the high-value transfer",
      expectedResults: ["The transfer is queued for processing."],
    }),
  );
  expectInvariantSatisfied(
    "INV-GWG-PEP-01",
    buildComplianceCase("tc-pep-pos", {
      title: "High-value transfer / Hochbetragsüberweisung with PEP screening",
      objective: "Initiate the high-value transfer; PEP screening completes first",
      preconditions: ["PEP (politically exposed person) screening returned no match."],
      expectedResults: ["Transfer is approved after PEP screening."],
    }),
  );
});

test("INV-AML-CUMUL-01: AML threshold checked on cumulative amount, not single", () => {
  expectInvariantViolation(
    "INV-AML-CUMUL-01",
    buildComplianceCase("tc-aml-neg", {
      title: "AML threshold check / Hochbetragsüberweisung",
      objective:
        "Initiate a high-value transfer; AML threshold compared against the single transaction",
      expectedResults: ["Transfer is approved when the single amount stays below the AML threshold."],
    }),
  );
  expectInvariantSatisfied(
    "INV-AML-CUMUL-01",
    buildComplianceCase("tc-aml-pos", {
      title: "AML threshold check on Hochbetragsüberweisung with session aggregation",
      objective: "Initiate the transfer; AML threshold compared against the cumulative amount",
      expectedResults: [
        "Cumulative amount aggregation across the session is compared against the AML threshold before approval.",
      ],
    }),
  );
});

test("INV-DORA-ICT-01: outsourced workflow without ICT-third-party flag fires", () => {
  expectInvariantViolation(
    "INV-DORA-ICT-01",
    buildComplianceCase("tc-dora-neg", {
      title: "Cloud-anbieter outsourcing of payment processing",
      objective: "Process a payment whose engine runs on an outsourced cloud provider",
      expectedResults: ["The payment is processed via the cloud-provider engine."],
    }),
  );
  expectInvariantSatisfied(
    "INV-DORA-ICT-01",
    buildComplianceCase("tc-dora-pos", {
      title: "Cloud-anbieter outsourcing flagged on the DORA register",
      objective: "Process a payment via an outsourced cloud provider with DORA flag",
      preconditions: [
        "The outsourced cloud-anbieter is registered on the DORA ICT third-party register of information.",
      ],
      expectedResults: [
        "Outsourced workflow is processed; DORA third-party register flag is asserted.",
      ],
    }),
  );
});

test("INV-GDPR-ART9-01: special-category data without explicit consent fires", () => {
  expectInvariantViolation(
    "INV-GDPR-ART9-01",
    buildComplianceCase("tc-gdpr9-neg", {
      title: "BU-Antrag with health data",
      objective: "Submit health-data answers (special-category personal data)",
      expectedResults: ["The application is submitted."],
    }),
  );
  expectInvariantSatisfied(
    "INV-GDPR-ART9-01",
    buildComplianceCase("tc-gdpr9-pos", {
      title: "BU-Antrag with health data and explicit consent",
      objective: "Submit health-data answers with explicit consent",
      preconditions: [
        "The applicant has provided explicit consent (ausdrückliche Einwilligung) to special-category data processing.",
      ],
      expectedResults: ["Application accepted; explicit consent recorded for sensitive personal data."],
    }),
  );
});

test("INV-GDPR-ART15-01: account screen without Auskunftsrecht entry fires", () => {
  expectInvariantViolation(
    "INV-GDPR-ART15-01",
    buildComplianceCase("tc-gdpr15-neg", {
      title: "Kontoübersicht main screen",
      objective: "Display the account overview to the customer",
      expectedResults: ["Balance and transactions are displayed."],
    }),
  );
  expectInvariantSatisfied(
    "INV-GDPR-ART15-01",
    buildComplianceCase("tc-gdpr15-pos", {
      title: "Kontoübersicht main screen with Auskunftsrecht link",
      objective: "Display the account overview with a right-of-access entry point",
      expectedResults: [
        "Balance and transactions are displayed alongside the Auskunftsrecht (right of access) link.",
      ],
    }),
  );
});

test("INV-IDD-DEMANDS-01: insurance contract without demands-and-needs fires", () => {
  expectInvariantViolation(
    "INV-IDD-DEMANDS-01",
    buildComplianceCase("tc-idd-neg", {
      title: "Versicherungsvertrag conclusion",
      objective: "Conclude the insurance contract",
      expectedResults: ["The Police is issued to the customer."],
    }),
  );
  expectInvariantSatisfied(
    "INV-IDD-DEMANDS-01",
    buildComplianceCase("tc-idd-pos", {
      title: "Versicherungsvertrag conclusion with Bedarfsanalyse",
      objective: "Conclude the insurance contract after the demands-and-needs analysis",
      preconditions: ["Bedarfsanalyse / demands-and-needs assessment is complete."],
      expectedResults: ["Police is issued referencing the demands-and-needs assessment."],
    }),
  );
});

test("INV-SOLV2-COOLOFF-01: long-term contract without cooling-off period fires", () => {
  expectInvariantViolation(
    "INV-SOLV2-COOLOFF-01",
    buildComplianceCase("tc-solv2-neg", {
      title: "Lebensversicherung antrag",
      objective: "Conclude the long-term contract",
      expectedResults: ["The long-term contract is bound on submission."],
    }),
  );
  expectInvariantSatisfied(
    "INV-SOLV2-COOLOFF-01",
    buildComplianceCase("tc-solv2-pos", {
      title: "Lebensversicherung antrag with Widerrufsbelehrung",
      objective: "Conclude the long-term contract with cooling-off period",
      expectedResults: [
        "The long-term contract is bound after the customer is shown the cooling-off / Widerrufsrecht period.",
      ],
    }),
  );
});

test("INV-FX-MARGIN-01: FX conversion with markup but no disclosure fires", () => {
  expectInvariantViolation(
    "INV-FX-MARGIN-01",
    buildComplianceCase("tc-fx-neg", {
      title: "Cross-currency transfer with FX markup",
      objective: "Process the transfer applying an FX markup",
      expectedResults: ["The transfer is processed at the converted amount."],
    }),
  );
  expectInvariantSatisfied(
    "INV-FX-MARGIN-01",
    buildComplianceCase("tc-fx-pos", {
      title: "Cross-currency transfer with FX markup disclosure",
      objective: "Process the transfer applying an FX markup with disclosure",
      expectedResults: [
        "The transfer applies an FX markup and the FX-margin disclosure is shown before confirmation.",
      ],
    }),
  );
});

test("INV-KYC-AGE-01: KYC onboarding without age-gate fires", () => {
  expectInvariantViolation(
    "INV-KYC-AGE-01",
    buildComplianceCase("tc-kyc-age-neg", {
      title: "Konto KYC onboarding",
      objective: "Onboard a new customer via the KYC wizard",
      expectedResults: ["The account is opened on submission."],
    }),
  );
  expectInvariantSatisfied(
    "INV-KYC-AGE-01",
    buildComplianceCase("tc-kyc-age-pos", {
      title: "Konto KYC onboarding with age-gate",
      objective: "Onboard a new customer via the KYC wizard; under-18 path",
      preconditions: ["Geburtsdatum is collected and the under-18 branch is exercised."],
      expectedResults: ["Account opening completes after the age-gate (Altersprüfung) is exercised."],
    }),
  );
});

test("INV-EAA-KBD-01: payment flow without keyboard-only assertion fires", () => {
  expectInvariantViolation(
    "INV-EAA-KBD-01",
    buildComplianceCase("tc-eaa-neg", {
      title: "Payment flow accessibility",
      objective: "Verify the payment journey",
      expectedResults: ["Payment journey completes for the customer."],
    }),
  );
  expectInvariantSatisfied(
    "INV-EAA-KBD-01",
    buildComplianceCase("tc-eaa-pos", {
      title: "Payment flow keyboard-only completability",
      objective: "Verify the payment journey is keyboard-only completable",
      expectedResults: [
        "The full payment flow is completable using the keyboard only (no pointer required).",
      ],
    }),
  );
});

test("INV-VAG-BERATUNG-01: Anlagevermittlung without Beratungsprotokoll fires", () => {
  expectInvariantViolation(
    "INV-VAG-BERATUNG-01",
    buildComplianceCase("tc-vag-neg", {
      title: "Anlagevermittlung session",
      objective: "Conclude the Anlagevermittlung",
      expectedResults: ["The Anlagevermittlung order is forwarded."],
    }),
  );
  expectInvariantSatisfied(
    "INV-VAG-BERATUNG-01",
    buildComplianceCase("tc-vag-pos", {
      title: "Anlagevermittlung session with Beratungsprotokoll",
      objective: "Conclude the Anlagevermittlung handing the customer a Beratungsprotokoll",
      expectedResults: [
        "The Anlagevermittlung concludes after the Beratungsprotokoll is handed to the customer.",
      ],
    }),
  );
});
