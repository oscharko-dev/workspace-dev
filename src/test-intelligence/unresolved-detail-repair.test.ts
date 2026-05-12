import assert from "node:assert/strict";
import test from "node:test";

import {
  GENERATED_TEST_CASE_SCHEMA_VERSION,
  TEST_INTELLIGENCE_CONTRACT_VERSION,
  TEST_INTELLIGENCE_PROMPT_TEMPLATE_VERSION,
  type BusinessTestIntentIr,
  type GeneratedTestCase,
  type GeneratedTestCaseList,
} from "../contracts/index.js";
import { repairUnresolvedValidationDetails } from "./unresolved-detail-repair.js";
import { runValidationPipeline } from "./validation-pipeline.js";

const ZERO = "0".repeat(64);
const GENERATED_AT = "2026-05-09T00:00:00.000Z";
const JOB_ID = "job-2032";

/**
 * Mirrors the H0 dataset (`T7l7m8T8501lxLZZFQrwJC` / 2026-05-07T19-01-29-456Z)
 * shape: a financing-need mask with a Netto/Brutto radio, a numeric
 * Kaufpreis field, an optional Nebenkosten field, and an `Anfallender
 * MwSt.-Satz` select. Source openQuestions explicitly mark Netto/Brutto
 * effects, the calculation formula, and validation rules as unresolved.
 */
const buildIntent = (): BusinessTestIntentIr => ({
  version: "1.0.0",
  source: { kind: "figma_local_json", contentHash: ZERO },
  screens: [
    {
      screenId: "s-financing",
      screenName: "Finanzierungsbedarf",
      trace: { nodeId: "s-financing" },
    },
  ],
  detectedFields: [
    {
      id: "s-financing::field::netto",
      screenId: "s-financing",
      trace: { nodeId: "n-netto" },
      provenance: "figma_node",
      confidence: 0.9,
      label: "Höhe des Kaufpreises (Netto)",
      type: "radio",
    },
    {
      id: "s-financing::field::nebenkosten",
      screenId: "s-financing",
      trace: { nodeId: "n-nebenkosten" },
      provenance: "figma_node",
      confidence: 0.9,
      label: "Höhe der Nebenkosten (Brutto) (optional)",
      type: "text",
    },
    {
      id: "s-financing::field::mwst",
      screenId: "s-financing",
      trace: { nodeId: "n-mwst" },
      provenance: "figma_node",
      confidence: 0.9,
      label: "Anfallender MwSt.-Satz bei Kauf",
      type: "select",
    },
  ],
  detectedActions: [],
  detectedValidations: [],
  detectedNavigation: [],
  inferredBusinessObjects: [],
  risks: [],
  assumptions: [],
  openQuestions: [
    "custom_context_markdown: Es ist fachlich zu klären, wie sich die Auswahl Netto / Brutto konkret auf Feldbezeichnungen, Berechnung und Vorbelegung auswirkt.",
    "custom_context_markdown: Validierungsregeln für Betragsfelder und MwSt.-Auswahl sind noch zu spezifizieren.",
  ],
  piiIndicators: [],
  redactions: [],
});

const baseCase = (overrides: Partial<GeneratedTestCase>): GeneratedTestCase => ({
  id: "tc-base",
  sourceJobId: JOB_ID,
  contractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
  schemaVersion: GENERATED_TEST_CASE_SCHEMA_VERSION,
  promptTemplateVersion: TEST_INTELLIGENCE_PROMPT_TEMPLATE_VERSION,
  title: "TC01 - Use Case: Auswahl Netto, Berechnung Finanzierungsbedarf",
  objective: "Bestimme den Finanzierungsbedarf bei Auswahl Netto.",
  level: "system",
  type: "functional",
  priority: "p1",
  riskCategory: "low",
  technique: "use_case",
  preconditions: [],
  testData: [
    "Option: Netto",
    "Kaufpreis: 100000 EUR",
    "Nebenkosten: 10000 EUR",
    "MwSt.-Satz: 19 %",
  ],
  steps: [
    {
      index: 1,
      action: 'Wähle die Radio-Option "Höhe des Kaufpreises (Netto)".',
      expected: "Die Option ist ausgewählt und erhält sichtbaren Fokus.",
    },
    {
      index: 2,
      action: "Gib den Kaufpreis 100000 in das zugehörige Eingabefeld ein.",
      expected: "Das Feld akzeptiert den Betrag und zeigt ihn formatiert an.",
    },
    {
      index: 3,
      action:
        'Gib die Nebenkosten 10000 in das Feld "Höhe der Nebenkosten (Brutto)" ein.',
      expected: "Das Feld akzeptiert den Betrag.",
    },
    {
      index: 4,
      action: "Bestätige die Eingaben (z. B. mit Enter).",
      expected:
        'Der Finanzierungsbedarf wird berechnet und im Feld "Finanzierungsbedarf des Investitionsobjekts" angezeigt.',
    },
  ],
  expectedResults: [
    "Finanzierungsbedarf wird korrekt berechnet und im Ergebnisfeld dargestellt.",
  ],
  figmaTraceRefs: [{ screenId: "s-financing" }],
  assumptions: [],
  openQuestions: [
    "custom_context_markdown: Es ist fachlich zu klären, wie sich die Auswahl Netto / Brutto konkret auf Feldbezeichnungen, Berechnung und Vorbelegung auswirkt.",
    "custom_context_markdown: Validierungsregeln für Betragsfelder und MwSt.-Auswahl sind noch zu spezifizieren.",
  ],
  qcMappingPreview: { exportable: true },
  qualitySignals: {
    coveredFieldIds: [
      "s-financing::field::netto",
      "s-financing::field::nebenkosten",
      "s-financing::field::mwst",
    ],
    coveredActionIds: [],
    coveredValidationIds: [],
    coveredNavigationIds: [],
    confidence: 0.85,
  },
  reviewState: "draft",
  audit: {
    jobId: JOB_ID,
    generatedAt: GENERATED_AT,
    contractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
    schemaVersion: GENERATED_TEST_CASE_SCHEMA_VERSION,
    promptTemplateVersion: TEST_INTELLIGENCE_PROMPT_TEMPLATE_VERSION,
    redactionPolicyVersion: "1.0.0",
    visualSidecarSchemaVersion: "1.0.0",
    cacheHit: false,
    cacheKey: "k",
    inputHash: ZERO,
    promptHash: ZERO,
    schemaHash: ZERO,
  },
  ...overrides,
});

const buildList = (testCases: GeneratedTestCase[]): GeneratedTestCaseList => ({
  schemaVersion: GENERATED_TEST_CASE_SCHEMA_VERSION,
  jobId: JOB_ID,
  testCases,
});

test("repairUnresolvedValidationDetails strips concrete numeric MwSt detail while preserving label-only entries (H0 shape, Issue #2032)", () => {
  // Mirrors the H0 testData shape but appends a sentence-terminator so
  // the post-#2078 NUMERIC_DETAIL_RE (which requires a trailing word
  // boundary or `.`/`)`) reliably fires. The repair must still strip
  // this entry deterministically.
  const original = baseCase({
    id: "tc-h0",
    testData: [
      "Option: Netto",
      "Kaufpreis: 100000 EUR",
      "Nebenkosten: 10000 EUR",
      "Anfallender MwSt.-Satz: 19,00 %.",
    ],
  });
  const list = buildList([original]);
  const result = repairUnresolvedValidationDetails({
    jobId: JOB_ID,
    list,
    intent: buildIntent(),
  });

  assert.equal(result.list.testCases.length, 1);
  const repaired = result.list.testCases[0];
  assert.ok(repaired);
  assert.ok(
    repaired.testData.includes("Option: Netto"),
    "label-only visual entries survive untouched",
  );
  assert.ok(
    !repaired.testData.some((entry) => entry.includes("19,00 %")),
    "concrete MwSt numeric is removed",
  );

  const removeChange = result.changes.find(
    (change) => change.kind === "removed_test_data",
  );
  assert.ok(removeChange, "a removed_test_data change is recorded");
  assert.equal(removeChange.testCaseId, "tc-h0");
  assert.equal(removeChange.path, "testData[3]");
  assert.match(removeChange.before, /19,00 %/);
});

test("repairUnresolvedValidationDetails strips concrete expectedResults and rewrites step expected", () => {
  const original = baseCase({
    id: "tc-expected",
    expectedResults: [
      "Validierungsfehler erscheint: 'Pflichtfeld muss > 0 sein'.",
      "Hinweistext bleibt unverändert sichtbar.",
    ],
    steps: [
      {
        index: 1,
        action: "Bestätige die Eingaben.",
        expected:
          "Validierung lehnt den Betrag mit Mindestgrenze 1.000,00 EUR ab.",
      },
    ],
  });
  const result = repairUnresolvedValidationDetails({
    jobId: JOB_ID,
    list: buildList([original]),
    intent: buildIntent(),
  });

  const repaired = result.list.testCases[0];
  assert.ok(repaired);
  assert.deepEqual(repaired.expectedResults, [
    "Hinweistext bleibt unverändert sichtbar.",
  ]);
  assert.equal(repaired.steps.length, 1);
  // Sequence preserved; expected text neutralized.
  assert.equal(
    repaired.steps[0]?.expected,
    "A validation response is shown according to the specified validation concept.",
  );
  assert.equal(repaired.steps[0]?.action, "Bestätige die Eingaben.");

  const stepChange = result.changes.find(
    (change) => change.kind === "rewrote_step_expected",
  );
  assert.ok(stepChange, "a rewrote_step_expected change is recorded");
  assert.equal(stepChange.path, "steps[0].expected");
  assert.match(stepChange.after ?? "", /validation concept/);
});

test("repairUnresolvedValidationDetails rewrites concrete title, objective, and step action claims", () => {
  const original = baseCase({
    id: "tc-scalar-action",
    title: 'Fehlermeldung "Pflichtfeld muss befüllt sein" für Betragsfeld',
    objective:
      "Prüft, dass die Validierung die konkrete Meldung 'Betrag ist ungültig' zeigt.",
    testData: [],
    steps: [
      {
        index: 1,
        action:
          "Gib Kaufpreis Netto 50.000 EUR ein und löse die Validierung aus.",
        expected: "Die Oberfläche bleibt prüfbar.",
      },
    ],
    expectedResults: ["Hinweistext bleibt sichtbar."],
  });
  const result = repairUnresolvedValidationDetails({
    jobId: JOB_ID,
    list: buildList([original]),
    intent: buildIntent(),
  });

  const repaired = result.list.testCases[0];
  assert.ok(repaired);
  assert.equal(repaired.title, "Generischer Negativpfad für offene Fachregel");
  assert.match(repaired.objective, /ohne konkrete Meldungen/);
  assert.equal(
    repaired.steps[0]?.action,
    "Führe den Prüfschritt mit fachlich geklärten Beispielwerten aus.",
  );
  assert.ok(
    result.changes.some(
      (change) => change.kind === "rewrote_title" && change.path === "title",
    ),
  );
  assert.ok(
    result.changes.some(
      (change) =>
        change.kind === "rewrote_objective" && change.path === "objective",
    ),
  );
  assert.ok(
    result.changes.some(
      (change) =>
        change.kind === "rewrote_step_action" &&
        change.path === "steps[0].action",
    ),
  );
});

test("repairUnresolvedValidationDetails leaves cases that do not touch unresolved constraints unchanged", () => {
  const intent = buildIntent();
  // Strip the unresolved openQuestions so no constraint applies.
  const noUnresolvedIntent: BusinessTestIntentIr = {
    ...intent,
    openQuestions: [],
  };
  const list = buildList([baseCase({ id: "tc-clean" })]);
  const result = repairUnresolvedValidationDetails({
    jobId: JOB_ID,
    list,
    intent: noUnresolvedIntent,
  });
  assert.equal(result.changes.length, 0);
  assert.equal(result.list, list);
});

test("repairUnresolvedValidationDetails populates openQuestions when missing on a repaired case", () => {
  const original = baseCase({
    id: "tc-no-oq",
    testData: [
      "Option: Netto",
      "Anfallender MwSt.-Satz: 19,00 %.",
    ],
    openQuestions: [],
  });
  const result = repairUnresolvedValidationDetails({
    jobId: JOB_ID,
    list: buildList([original]),
    intent: buildIntent(),
  });
  const repaired = result.list.testCases[0];
  assert.ok(repaired);
  assert.ok(
    repaired.openQuestions.length > 0,
    "open question is appended to repaired case",
  );
  assert.ok(
    result.changes.some((change) => change.kind === "added_open_question"),
    "an added_open_question change is recorded",
  );
});

test("repairUnresolvedValidationDetails does not mutate the input list", () => {
  const original = baseCase({ id: "tc-immutable" });
  const inputList = buildList([original]);
  const before = JSON.parse(JSON.stringify(inputList)) as GeneratedTestCaseList;
  repairUnresolvedValidationDetails({
    jobId: JOB_ID,
    list: inputList,
    intent: buildIntent(),
  });
  assert.deepEqual(
    inputList,
    before,
    "input list reference content remains untouched",
  );
});

test("validation pipeline emits zero unsupported_unresolved_validation_detail errors after repair (Issue #2032 H0 shape)", () => {
  const offending = baseCase({
    id: "tc-h0-pipeline",
    testData: [
      "Option: Netto",
      "Kaufpreis: 100000 EUR",
      "Nebenkosten: 10000 EUR",
      "Anfallender MwSt.-Satz: 19,00 %.",
    ],
  });
  const artifacts = runValidationPipeline({
    jobId: JOB_ID,
    generatedAt: GENERATED_AT,
    list: buildList([offending]),
    intent: buildIntent(),
  });

  const violatingIssues = artifacts.validation.issues.filter(
    (issue) => issue.code === "unsupported_unresolved_validation_detail",
  );
  assert.deepEqual(violatingIssues, []);
  // Hard-gate G4: validation-report.errorCount === 0 for this dataset.
  assert.equal(artifacts.validation.errorCount, 0);
  // The repair audit trail is exposed on the in-memory artifact bundle.
  assert.ok(artifacts.unresolvedDetailRepairChanges.length > 0);
  assert.ok(
    artifacts.unresolvedDetailRepairChanges.some(
      (change) =>
        change.kind === "removed_test_data" &&
        change.path === "testData[3]",
    ),
    "MwSt numeric is removed at the H0 path",
  );
});

test("validation pipeline running twice on the same input is byte-deterministic with repair active", () => {
  const list = buildList([baseCase({ id: "tc-determinism" })]);
  const a = runValidationPipeline({
    jobId: JOB_ID,
    generatedAt: GENERATED_AT,
    list,
    intent: buildIntent(),
  });
  const b = runValidationPipeline({
    jobId: JOB_ID,
    generatedAt: GENERATED_AT,
    list,
    intent: buildIntent(),
  });
  assert.deepEqual(a.generatedTestCases, b.generatedTestCases);
  assert.deepEqual(a.unresolvedDetailRepairChanges, b.unresolvedDetailRepairChanges);
  assert.deepEqual(a.validation, b.validation);
});

test("repair preserves visible source value when paired with non-normative observation", () => {
  // The visible UI value `19,00 %` (German formatting) used as a
  // visual/source observation must NOT be classified as concrete numeric
  // data when the surrounding text doesn't pair it with a validation
  // topic marker.
  const sample = "Im UI ist die Beschriftung '19,00 %' sichtbar.";
  const original = baseCase({
    id: "tc-visible-only",
    testData: [sample, "Option: Netto"],
  });
  const result = repairUnresolvedValidationDetails({
    jobId: JOB_ID,
    list: buildList([original]),
    intent: buildIntent(),
  });
  const repaired = result.list.testCases[0];
  assert.ok(repaired);
  assert.ok(
    repaired.testData.some((entry) => entry === sample),
    "visible source value retained when used as non-normative evidence",
  );
});
