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
import { renderCustomerMarkdown } from "./customer-markdown-renderer.js";

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
      buildCase({ id: "tc-a", title: "Login mit gültigen Daten" }),
      buildCase({ id: "tc-b", title: "Login mit leerem Passwort" }),
    ],
  };
  const result = renderCustomerMarkdown({
    list,
    fileName: "Test View 03",
    sourceLabel: "https://www.figma.com/design/M7FGS79qLfr3O4OXEYbxy0",
    generatedAt: "2026-05-02T10:00:00Z",
  });
  assert.match(result.combinedMarkdown, /^# Testfälle/u);
  assert.match(result.combinedMarkdown, /Login mit gültigen Daten/u);
  assert.match(result.combinedMarkdown, /Login mit leerem Passwort/u);
  // Each case has its own per-case file.
  assert.equal(result.perCaseFiles.length, 2);
  assert.ok(result.perCaseFiles[0]?.filename.endsWith(".md"));
});

test("renderCustomerMarkdown renders steps with Beschreibung + Erwartetes Ergebnis", () => {
  const list: GeneratedTestCaseList = {
    schemaVersion: GENERATED_TEST_CASE_SCHEMA_VERSION,
    jobId: "job-1",
    testCases: [buildCase()],
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
