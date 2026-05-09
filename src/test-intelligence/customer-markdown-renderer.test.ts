import assert from "node:assert/strict";
import test from "node:test";

import {
  GENERATED_TEST_CASE_SCHEMA_VERSION,
  REDACTION_POLICY_VERSION,
  TEST_INTELLIGENCE_CONTRACT_VERSION,
  TEST_INTELLIGENCE_PROMPT_TEMPLATE_VERSION,
  VISUAL_SIDECAR_SCHEMA_VERSION,
  type GeneratedTestCase,
  type GeneratedTestCaseList,
} from "../contracts/index.js";
import {
  extractAcceptanceCriteriaFromMarkdown,
  renderCustomerMarkdown,
} from "./customer-markdown-renderer.js";

const buildCase = (
  overrides: Partial<GeneratedTestCase> = {},
): GeneratedTestCase => ({
  id: "tc-default",
  sourceJobId: "job-1",
  contractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
  schemaVersion: GENERATED_TEST_CASE_SCHEMA_VERSION,
  promptTemplateVersion: TEST_INTELLIGENCE_PROMPT_TEMPLATE_VERSION,
  title: "Login mit gültigen Daten",
  objective:
    "Bestätigen, dass der Login mit korrekten Zugangsdaten funktioniert.",
  level: "system",
  type: "functional",
  priority: "p1",
  riskCategory: "low",
  technique: "use_case",
  preconditions: ["Browser ist geöffnet"],
  testData: ["Benutzer: alice", "Passwort: secret"],
  steps: [
    {
      index: 1,
      action: "Öffne die Login-Seite",
      expected: "Login-Maske ist sichtbar",
    },
    {
      index: 2,
      action: "Gib Benutzername und Passwort ein und klicke Anmelden",
      expected: "Startseite ist sichtbar",
    },
  ],
  expectedResults: ["Nutzer ist eingeloggt"],
  figmaTraceRefs: [{ screenId: "1:1", nodeName: "Login" }],
  assumptions: [],
  openQuestions: [],
  qcMappingPreview: { exportable: true },
  qualitySignals: {
    coveredFieldIds: [],
    coveredActionIds: [],
    coveredValidationIds: [],
    coveredNavigationIds: [],
    confidence: 0.9,
  },
  reviewState: "auto_approved",
  audit: {
    jobId: "job-1",
    generatedAt: "2026-05-02T10:00:00Z",
    contractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
    schemaVersion: GENERATED_TEST_CASE_SCHEMA_VERSION,
    promptTemplateVersion: TEST_INTELLIGENCE_PROMPT_TEMPLATE_VERSION,
    redactionPolicyVersion: REDACTION_POLICY_VERSION,
    visualSidecarSchemaVersion: VISUAL_SIDECAR_SCHEMA_VERSION,
    cacheHit: false,
    cacheKey: "k",
    inputHash: "i",
    promptHash: "p",
    schemaHash: "s",
  },
  ...overrides,
});

test("renderCustomerMarkdown emits a German-format combined document with one heading per case", () => {
  const list: GeneratedTestCaseList = {
    schemaVersion: GENERATED_TEST_CASE_SCHEMA_VERSION,
    jobId: "job-1",
    testCases: [
      buildCase({ id: "tc-a", title: "TC02 Login mit gültigen Daten" }),
      buildCase({ id: "tc-b", title: "TC01 Login mit leerem Passwort" }),
    ],
  };
  const result = renderCustomerMarkdown({
    list,
    fileName: "Test View 03",
    sourceLabel: "https://www.figma.com/design/M7FGS79qLfr3O4OXEYbxy0",
    generatedAt: "2026-05-02T10:00:00Z",
  });
  assert.match(result.combinedMarkdown, /^# Testfälle/u);
  assert.match(result.combinedMarkdown, /## Überblick/u);
  assert.match(result.combinedMarkdown, /## TC01 - Login mit leerem Passwort/u);
  assert.match(result.combinedMarkdown, /## TC02 - Login mit gültigen Daten/u);
  assert.ok(
    result.combinedMarkdown.indexOf("## TC01 - Login mit leerem Passwort") <
      result.combinedMarkdown.indexOf("## TC02 - Login mit gültigen Daten"),
  );
  // Each case has its own per-case file.
  assert.equal(result.perCaseFiles.length, 2);
  assert.deepEqual(
    result.perCaseFiles.map((file) => file.filename),
    [
      "tc01-login-mit-leerem-passwort.md",
      "tc02-login-mit-gueltigen-daten.md",
    ],
  );
});

test("renderCustomerMarkdown renders steps with Beschreibung + Erwartetes Ergebnis", () => {
  const list: GeneratedTestCaseList = {
    schemaVersion: GENERATED_TEST_CASE_SCHEMA_VERSION,
    jobId: "job-1",
    testCases: [
      buildCase({
        qualitySignals: {
          coveredFieldIds: [],
          coveredActionIds: ["ACT-001"],
          coveredValidationIds: [],
          coveredNavigationIds: [],
          confidence: 0.9,
        },
      }),
    ],
  };
  const result = renderCustomerMarkdown({
    list,
    fileName: "x",
    sourceLabel: "x",
    generatedAt: "2026-05-02T10:00:00Z",
  });
  const body = result.perCaseFiles[0]?.body ?? "";
  assert.match(body, /Step 1/u);
  assert.match(body, /Beschreibung/u);
  assert.match(body, /Erwartetes Ergebnis/u);
  assert.match(body, /Öffne die Login-Seite/u);
  assert.match(body, /Login-Maske ist sichtbar/u);
  assert.match(body, /\*\*Workflow-Aktionen:\*\* ACT-001/u);
  assert.match(body, /Abdeckung & Nachvollziehbarkeit/u);
  assert.match(body, /Abgedeckte Semantik/u);
});

test("renderCustomerMarkdown customer mode consolidates shared clarification questions and strips provenance prefixes", () => {
  const list: GeneratedTestCaseList = {
    schemaVersion: GENERATED_TEST_CASE_SCHEMA_VERSION,
    jobId: "job-1",
    testCases: [
      buildCase({
        id: "tc-1",
        title: "TC01 Kaufpreis mit Netto-Auswahl prüfen",
        figmaTraceRefs: [
          {
            screenId: "1:11309",
            nodeId: "1:11309::field::4:22888",
            nodeName: "Höhe des Kaufpreises",
          },
          {
            screenId: "1:11309",
            nodeId: "1:11309::field::4:22889",
            nodeName: "Typography",
          },
        ],
        assumptions: ["Die Validierungsregel für den Kaufpreis stammt aus dem Fachkonzept."],
        openQuestions: [
          "custom_context_markdown: Es ist fachlich zu klären, wie sich die Auswahl Netto ‑ Brutto konkret auf Feldbezeichnungen, Berechnung und Vorbelegung auswirkt.",
        ],
      }),
      buildCase({
        id: "tc-2",
        title: "TC02 Finanzierungsbedarf mit Brutto-Auswahl prüfen",
        openQuestions: [
          "custom_context_markdown: Es ist fachlich zu klären, wie sich die Auswahl Netto - Brutto konkret auf Feldbezeichnungen, Berechnung und Vorbelegung auswirkt.",
          "custom_context_markdown: Validierungsregeln für Betragsfelder und MwSt.-Auswahl sind noch zu spezifizieren.",
        ],
      }),
    ],
  };
  const result = renderCustomerMarkdown({
    list,
    fileName: "x",
    sourceLabel: "x",
    generatedAt: "2026-05-02T10:00:00Z",
  });
  const body = result.combinedMarkdown;
  const firstCaseBody = result.perCaseFiles[0]?.body ?? "";
  const secondCaseBody = result.perCaseFiles[1]?.body ?? "";
  assert.match(body, /## Überblick/u);
  assert.match(body, /## Übergreifender Klärbedarf vor Freigabe/u);
  assert.match(
    body,
    /FQ-001: Es ist fachlich zu klären, wie sich die Auswahl Netto - Brutto konkret auf Feldbezeichnungen, Berechnung und Vorbelegung auswirkt\./u,
  );
  assert.match(
    body,
    /FQ-002: Validierungsregeln für Betragsfelder und MwSt\.-Auswahl sind noch zu spezifizieren\./u,
  );
  assert.match(firstCaseBody, /\*\*Klärbedarf:\*\* FQ-001/u);
  assert.match(secondCaseBody, /\*\*Klärbedarf:\*\* FQ-001, FQ-002/u);
  assert.match(firstCaseBody, /\*\*Annahmen:\*\*/u);
  assert.doesNotMatch(body, /custom_context_markdown:/u);
  assert.doesNotMatch(firstCaseBody, /custom_context_markdown:/u);
  assert.doesNotMatch(firstCaseBody, /\[!IMPORTANT\]/u);
  assert.doesNotMatch(secondCaseBody, /\[!IMPORTANT\]/u);
  assert.doesNotMatch(body, /Netto ‑ Brutto/u);
  assert.match(body, /Höhe des Kaufpreises/u);
  assert.doesNotMatch(body, /Test-ID/u);
  assert.doesNotMatch(body, /job-1/u);
  assert.doesNotMatch(body, /tc-1/u);
  assert.doesNotMatch(body, /1:11309/u);
  assert.doesNotMatch(body, /4:22888/u);
  assert.doesNotMatch(body, /Typography/u);
});

test("renderCustomerMarkdown emits one clarification reference when a case repeats the same question", () => {
  const list: GeneratedTestCaseList = {
    schemaVersion: GENERATED_TEST_CASE_SCHEMA_VERSION,
    jobId: "job-1",
    testCases: [
      buildCase({
        id: "tc-1",
        title: "TC01 Klärbedarf deduplizieren",
        openQuestions: [
          "custom_context_markdown: Validierungsregeln für Betragsfelder sind noch zu spezifizieren.",
          "custom_context_markdown: Validierungsregeln für Betragsfelder sind noch zu spezifizieren.",
        ],
      }),
    ],
  };
  const result = renderCustomerMarkdown({
    list,
    fileName: "x",
    sourceLabel: "x",
    generatedAt: "2026-05-02T10:00:00Z",
  });
  const body = result.combinedMarkdown;
  const perCaseBody = result.perCaseFiles[0]?.body ?? "";
  assert.match(
    body,
    /FQ-001: Validierungsregeln für Betragsfelder sind noch zu spezifizieren\./u,
  );
  assert.equal(body.match(/FQ-001:/gu)?.length ?? 0, 1);
  assert.match(perCaseBody, /\*\*Klärbedarf:\*\* FQ-001/u);
  assert.doesNotMatch(perCaseBody, /FQ-001, FQ-001/u);
});

test("renderCustomerMarkdown produces filename-safe slugs", () => {
  const list: GeneratedTestCaseList = {
    schemaVersion: GENERATED_TEST_CASE_SCHEMA_VERSION,
    jobId: "job-1",
    testCases: [
      buildCase({
        id: "tc-1",
        title: "Login: gültige Daten / korrekt — passwort+OK",
      }),
    ],
  };
  const result = renderCustomerMarkdown({
    list,
    fileName: "x",
    sourceLabel: "x",
    generatedAt: "2026-05-02T10:00:00Z",
  });
  const filename = result.perCaseFiles[0]?.filename ?? "";
  assert.doesNotMatch(filename, /[/\\:*?"<>|]/u);
  assert.doesNotMatch(filename, /\s\s+/u);
  assert.match(filename, /^tc01-/u);
});

test("renderCustomerMarkdown gracefully handles an empty test-case list", () => {
  const list: GeneratedTestCaseList = {
    schemaVersion: GENERATED_TEST_CASE_SCHEMA_VERSION,
    jobId: "job-1",
    testCases: [],
  };
  const result = renderCustomerMarkdown({
    list,
    fileName: "x",
    sourceLabel: "x",
    generatedAt: "2026-05-02T10:00:00Z",
  });
  assert.equal(result.perCaseFiles.length, 0);
  assert.match(result.combinedMarkdown, /Testfälle/u);
  assert.doesNotMatch(result.combinedMarkdown, /Testfall \| Zweck/u);
});

test("renderCustomerMarkdown filenames are deterministic for stable input", () => {
  const list: GeneratedTestCaseList = {
    schemaVersion: GENERATED_TEST_CASE_SCHEMA_VERSION,
    jobId: "job-1",
    testCases: [
      buildCase({ id: "tc-a", title: "Eingabe Investitionssumme" }),
      buildCase({ id: "tc-b", title: "Validierung Laufzeit" }),
    ],
  };
  const a = renderCustomerMarkdown({
    list,
    fileName: "x",
    sourceLabel: "x",
    generatedAt: "2026-05-02T10:00:00Z",
  });
  const b = renderCustomerMarkdown({
    list,
    fileName: "x",
    sourceLabel: "x",
    generatedAt: "2026-05-02T10:00:00Z",
  });
  assert.equal(a.combinedMarkdown, b.combinedMarkdown);
  assert.deepEqual(
    a.perCaseFiles.map((f) => f.filename),
    b.perCaseFiles.map((f) => f.filename),
  );
});

test("renderCustomerMarkdown surfaces regulatoryRelevance domain + rationale when present (Issue #1735)", () => {
  const list: GeneratedTestCaseList = {
    schemaVersion: GENERATED_TEST_CASE_SCHEMA_VERSION,
    jobId: "job-1",
    testCases: [
      buildCase({
        id: "tc-banking",
        title: "Antrag mit Vier-Augen-Prinzip",
        regulatoryRelevance: {
          domain: "banking",
          rationale:
            "Statusverändernde Aktion (Antragsstellung) erfordert Vier-Augen-Prinzip und Audit-Trail.",
        },
      }),
      buildCase({
        id: "tc-other",
        title: "Generischer Testfall ohne Regelung",
      }),
    ],
  };
  const result = renderCustomerMarkdown({
    list,
    fileName: "x",
    sourceLabel: "x",
    generatedAt: "2026-05-02T10:00:00Z",
  });
  const bankingBody = result.perCaseFiles[0]?.body ?? "";
  const otherBody = result.perCaseFiles[1]?.body ?? "";
  assert.match(bankingBody, /Regulatorische Relevanz:\*\* banking/u);
  assert.match(bankingBody, /Vier-Augen-Prinzip/u);
  assert.doesNotMatch(otherBody, /Regulatorische Relevanz/u);
  // Combined doc surfaces it for the banking case as well.
  assert.match(
    result.combinedMarkdown,
    /Regulatorische Relevanz:\*\* banking/u,
  );
});

test("renderCustomerMarkdown maps enumerated acceptance criteria into the summary and case traceability", () => {
  const list: GeneratedTestCaseList = {
    schemaVersion: GENERATED_TEST_CASE_SCHEMA_VERSION,
    jobId: "job-1",
    testCases: [
      buildCase({
        id: "tc-ac-2",
        title: "TC02 Formular erfolgreich absenden",
        objective: "Bestätigen, dass der Antrag nach erfolgreicher Validierung abgesendet wird.",
        expectedResults: ["Der Antrag wird erfolgreich abgesendet und bestätigt."],
        steps: [
          {
            index: 1,
            action: "Fülle alle Pflichtfelder korrekt aus",
            expected: "Alle Felder sind valide",
          },
          {
            index: 2,
            action: "Sende den Antrag ab",
            expected: "Der Antrag wird bestätigt",
          },
        ],
      }),
      buildCase({
        id: "tc-ac-1",
        title: "TC01 Pflichtfelder validieren",
        objective: "Prüfen, dass fehlende Pflichtfelder eine verständliche Fehlermeldung anzeigen.",
        expectedResults: ["Eine verständliche Fehlermeldung wird angezeigt."],
        steps: [
          {
            index: 1,
            action: "Sende das Formular ohne Pflichtfelder ab",
            expected: "Eine verständliche Fehlermeldung wird angezeigt",
          },
        ],
      }),
    ],
  };
  const result = renderCustomerMarkdown({
    list,
    fileName: "x",
    sourceLabel: "x",
    generatedAt: "2026-05-02T10:00:00Z",
    acceptanceCriteria: [
      "Pflichtfelder zeigen verständliche Fehlermeldungen.",
      "Ein Antrag kann nach erfolgreicher Validierung abgesendet werden.",
    ],
  });
  assert.match(result.combinedMarkdown, /## Akzeptanzkriterien/u);
  assert.match(
    result.combinedMarkdown,
    /\| AC01 \| Pflichtfelder zeigen verständliche Fehlermeldungen\. \| TC01 \|/u,
  );
  assert.match(
    result.combinedMarkdown,
    /\| AC02 \| Ein Antrag kann nach erfolgreicher Validierung abgesendet werden\. \| TC02 \|/u,
  );
  assert.match(
    result.perCaseFiles[0]?.body ?? "",
    /Akzeptanzkriterien: AC01: Pflichtfelder zeigen verständliche Fehlermeldungen\./u,
  );
  assert.match(
    result.perCaseFiles[1]?.body ?? "",
    /Akzeptanzkriterien: AC02: Ein Antrag kann nach erfolgreicher Validierung abgesendet werden\./u,
  );
});

test("renderCustomerMarkdown technical mode preserves internal traceability on request", () => {
  const list: GeneratedTestCaseList = {
    schemaVersion: GENERATED_TEST_CASE_SCHEMA_VERSION,
    jobId: "job-1",
    testCases: [
      buildCase({
        id: "tc-4711",
        title: "TC01 Kaufpreis prüfen",
        openQuestions: [
          "custom_context_markdown: Es ist fachlich zu klären, wie sich die Auswahl Netto ‑ Brutto konkret auf Feldbezeichnungen, Berechnung und Vorbelegung auswirkt.",
        ],
        figmaTraceRefs: [
          {
            screenId: "1:11309",
            nodeId: "1:11309::field::4:22888",
            nodeName: "Höhe des Kaufpreises",
            nodePath: "Frame/Test View 03/Kaufpreis",
          },
        ],
      }),
    ],
  };
  const result = renderCustomerMarkdown({
    list,
    fileName: "x",
    sourceLabel: "x",
    generatedAt: "2026-05-02T10:00:00Z",
    mode: "technical",
  });
  const body = result.perCaseFiles[0]?.body ?? "";
  assert.match(body, /Test-ID/u);
  assert.match(body, /tc-4711/u);
  assert.match(body, /1:11309/u);
  assert.match(body, /4:22888/u);
  assert.match(body, /custom_context_markdown:/u);
  assert.match(body, /Netto ‑ Brutto/u);
  assert.match(body, /\[!IMPORTANT\]/u);
  assert.equal(
    result.perCaseFiles[0]?.filename,
    "tc01-tc-4711-kaufpreis-pruefen.md",
  );
});

test("renderCustomerMarkdown adds a Compliance coverage section when supplied (Issue #2042)", () => {
  const list: GeneratedTestCaseList = {
    schemaVersion: GENERATED_TEST_CASE_SCHEMA_VERSION,
    jobId: "job-1",
    testCases: [buildCase({ id: "tc-a" })],
  };
  const result = renderCustomerMarkdown({
    list,
    fileName: "Test View 03",
    sourceLabel: "https://www.figma.com/design/M7FGS79qLfr3O4OXEYbxy0",
    generatedAt: "2026-05-02T10:00:00Z",
    complianceCoverage: {
      schemaVersion: "1.0.0",
      jobId: "job-1",
      generatedAt: "2026-05-02T10:00:00Z",
      activeFrameworks: ["PSD2"],
      totalTestCases: 1,
      annotatedTestCases: 1,
      overallCoverageRatio: 0.5,
      hasUncoveredErrorRule: false,
      frameworks: [
        {
          framework: "PSD2",
          title: "Payment Services Directive 2 (PSD2)",
          citationRoot: "Directive (EU) 2015/2366",
          totalRules: 2,
          coveredRules: 1,
          uncoveredRules: 1,
          coverageRatio: 0.5,
          hasUncoveredErrorRule: false,
          rules: [
            {
              ruleId: "PSD2-SCA-Art-97",
              citation: "PSD2 Article 97",
              severity: "error",
              mandatoryTestClasses: ["functional"],
              applicableCases: 1,
              satisfyingCases: 1,
              covered: true,
            },
            {
              ruleId: "PSD2-Risk-Analysis-Art-18-RTS",
              citation: "EBA RTS Article 18",
              severity: "warning",
              mandatoryTestClasses: ["boundary"],
              applicableCases: 0,
              satisfyingCases: 0,
              covered: false,
            },
          ],
        },
      ],
    },
  });
  assert.match(result.combinedMarkdown, /## Compliance coverage/u);
  assert.match(result.combinedMarkdown, /Aktive Regelwerke: PSD2/u);
  assert.match(result.combinedMarkdown, /PSD2-SCA-Art-97/u);
  assert.match(result.combinedMarkdown, /PSD2-Risk-Analysis-Art-18-RTS/u);
  assert.match(result.combinedMarkdown, /Gesamtabdeckung: 50\.0%/u);
});

test("extractAcceptanceCriteriaFromMarkdown reads enumerated markdown sections", () => {
  const markdown = [
    "# Kontext",
    "",
    "## Akzeptanzkriterien",
    "1. Pflichtfelder werden validiert",
    "2. Erfolgreiche Eingaben koennen abgesendet werden",
    "",
    "## Offene Fragen",
    "- Nachgelagerte Freigabe?",
    "",
    "AC3: Fehler werden inline angezeigt",
  ].join("\n");
  assert.deepEqual(extractAcceptanceCriteriaFromMarkdown(markdown), [
    "Pflichtfelder werden validiert",
    "Erfolgreiche Eingaben koennen abgesendet werden",
    "Fehler werden inline angezeigt",
  ]);
});
