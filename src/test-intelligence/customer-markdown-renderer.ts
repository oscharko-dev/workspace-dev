/**
 * Customer-format Markdown renderer (Issue #1733).
 *
 * Format derived from the customer brief in
 * `save/Testfall-eines-Anwendungstests.md`:
 *   - Each test case has a Title, a Beschreibung (description), and a list
 *     of Steps (Step N — Beschreibung / Erwartetes Ergebnis).
 *
 * The renderer is pure: identical inputs produce identical outputs. Customer
 * mode sorts cases deterministically, assigns stable customer-facing labels,
 * hides internal ids, and emits clean per-case filenames; technical mode
 * preserves the internal trace when explicitly requested.
 */

import type {
  GeneratedTestCase,
  GeneratedTestCaseList,
  WorkflowFieldLifecycleTransition,
  WorkflowTopology,
} from "../contracts/index.js";
import type { ComplianceCoverageReport } from "./compliance-coverage-report.js";
import {
  deriveGeneratedTestCaseClassification,
  renderGeneratedTestCasePolarityLabel,
} from "./test-case-classification.js";

export interface RenderCustomerMarkdownInput {
  list: GeneratedTestCaseList;
  /** Figma file display name, used in the combined-document header. */
  fileName: string;
  /** Source label (URL or "paste") shown in the combined-document header. */
  sourceLabel: string;
  /** ISO-8601 timestamp shown in the combined-document header. */
  generatedAt: string;
  /** Optional enumerated acceptance criteria for customer-facing mapping. */
  acceptanceCriteria?: readonly string[];
  /** Customer-facing mode hides internal ids; technical preserves them. */
  mode?: "customer" | "technical";
  /**
   * Render calibrated per-case confidence when enabled. Defaults to
   * `false` for customer mode and `true` for technical mode.
   */
  showConfidence?: boolean;
  /**
   * Optional compliance-coverage report (Issue #2042). When supplied,
   * the combined Markdown gains a "Compliance coverage" section listing
   * coverage ratio per active framework and per-rule outcome.
   */
  complianceCoverage?: ComplianceCoverageReport;
  /** Optional workflow topology for field-lifecycle step rendering. */
  workflowTopology?: WorkflowTopology;
  /**
   * Issue #2170 — optional set of test-case ids whose cross-modal
   * faithfulness verdict population is majority `evidence_partial`.
   * When supplied, each matching case gets a short partial-evidence
   * footer note so reviewers see which cases need a manual evidence
   * confirmation pass. Sourced from
   * {@link FaithfulnessTierReport.partialMajorityCaseIds}; the
   * companion policy gate raises a warning-severity case-level
   * violation, so the case still ships.
   */
  faithfulnessPartialMajorityCaseIds?: ReadonlySet<string>;
}

export interface RenderedCustomerMarkdown {
  combinedMarkdown: string;
  perCaseFiles: ReadonlyArray<{ filename: string; body: string }>;
}

// eslint-disable-next-line no-control-regex
const FORBIDDEN_FILENAME_CHARS = /[\\/:*?"<>|\x00-\x1f]/gu;
const COLLAPSE_WHITESPACE = /\s+/gu;
const CUSTOMER_PROVENANCE_PREFIX_PATTERN =
  /^(?:[a-z0-9]+(?:[_./-][a-z0-9]+)*:\s*)+/u;
const CUSTOMER_CLARIFICATION_LABEL_PATTERN =
  /^(?:(?:annahmen?\s*\/\s*)?klärungsbedarf|offene frage|open question|question)\s*[:.-]?\s*/iu;
const NON_ASCII_HYPHEN_PATTERN = /[\u00ad\u2010-\u2015\u2212]/gu;
const KEYWORD_SELECTABLE_HINT_PATTERN =
  /\b(select|dropdown|checkbox|radio|option|auswahl|choice|picker)\b/i;
const KEYWORD_RESULT_HINT_PATTERN =
  /\b(result|summary|status|total|balance|output|confirmation|receipt|preview|overview|message|ergebnis)\b/i;
const TEST_CASE_NUMBER_PATTERN =
  /\bTC[\s_-]*0*(\d{1,4})\b/iu;
const LEADING_TEST_CASE_LABEL_PATTERN =
  /^\s*TC[\s_-]*0*\d{1,4}\s*(?:[:-]\s*)?/iu;
const WORKFLOW_ACTION_ID_PATTERN = /\bACT-\d{3}\b/u;
const STOP_WORDS = new Set([
  "aber",
  "ac",
  "als",
  "am",
  "an",
  "and",
  "auch",
  "bei",
  "case",
  "customer",
  "das",
  "dem",
  "den",
  "der",
  "die",
  "ein",
  "eine",
  "einer",
  "eines",
  "einem",
  "for",
  "from",
  "fuer",
  "für",
  "im",
  "in",
  "ist",
  "mit",
  "nach",
  "oder",
  "screen",
  "soll",
  "sowie",
  "test",
  "the",
  "und",
  "user",
  "von",
  "when",
  "wird",
  "with",
  "zu",
]);

interface PreparedCustomerCase {
  tc: GeneratedTestCase;
  displayLabel: string;
  customerTitle: string;
  filename: string;
  classification: string;
  coverageTheme: string;
  reviewNotes: string;
  customerTraceLabel: string;
  matchedAcceptanceCriteria: string[];
}

interface ClarificationReference {
  id: string;
  text: string;
}

interface SuiteClarificationRegistry {
  ordered: readonly ClarificationReference[];
  byCaseId: ReadonlyMap<string, readonly ClarificationReference[]>;
}

export const renderCustomerMarkdown = (
  input: RenderCustomerMarkdownInput,
): RenderedCustomerMarkdown => {
  const mode = input.mode ?? "customer";
  const showConfidence = input.showConfidence ?? mode === "technical";
  const acceptanceCriteria = normalizeAcceptanceCriteria(input.acceptanceCriteria);
  const preparedCases = prepareCustomerCases(
    input.list.testCases,
    acceptanceCriteria,
    mode,
  );
  const suiteClarifications =
    mode === "customer"
      ? buildSuiteClarificationRegistry(preparedCases)
      : EMPTY_SUITE_CLARIFICATION_REGISTRY;
  const fieldLifecycleTransitions = buildFieldLifecycleTransitionLookup(
    input.workflowTopology,
  );
  const partialMajorityCaseIds =
    input.faithfulnessPartialMajorityCaseIds ?? EMPTY_PARTIAL_MAJORITY_SET;
  const perCaseFiles = preparedCases.map((entry) => ({
    filename: entry.filename,
    body: renderSingleCase(
      entry,
      mode,
      suiteClarifications.byCaseId.get(entry.tc.id) ?? [],
      fieldLifecycleTransitions,
      showConfidence,
      partialMajorityCaseIds.has(entry.tc.id),
    ),
  }));
  const combinedMarkdown = renderCombined(
    input,
    preparedCases,
    acceptanceCriteria,
    mode,
    suiteClarifications,
    fieldLifecycleTransitions,
    showConfidence,
    partialMajorityCaseIds,
  );
  return { combinedMarkdown, perCaseFiles };
};

const EMPTY_PARTIAL_MAJORITY_SET: ReadonlySet<string> = new Set<string>();

export const extractAcceptanceCriteriaFromMarkdown = (
  markdown: string,
): string[] => {
  const lines = markdown.split(/\r?\n/u);
  const extracted: string[] = [];
  let inAcceptanceSection = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length === 0) {
      if (inAcceptanceSection && extracted.length > 0) {
        inAcceptanceSection = false;
      }
      continue;
    }
    if (/^#{1,6}\s+(acceptance criteria|akzeptanzkriterien)\b/iu.test(trimmed)) {
      inAcceptanceSection = true;
      continue;
    }
    const prefixedMatch = trimmed.match(
      /^(AC[\s._-]*\d+|Akzeptanzkriterium[\s._-]*\d+|Acceptance Criterion[\s._-]*\d+)\s*[:-]\s*(.+)$/iu,
    );
    if (prefixedMatch?.[2] !== undefined) {
      extracted.push(prefixedMatch[2].trim());
      continue;
    }
    if (!inAcceptanceSection) continue;
    const listMatch = trimmed.match(
      /^(?:[-*+]\s+|\d+[.)]\s+|\[\s?[xX ]?\]\s+)(.+)$/u,
    );
    if (listMatch?.[1] !== undefined) {
      extracted.push(listMatch[1].trim());
      continue;
    }
    if (/^#{1,6}\s+/u.test(trimmed)) {
      inAcceptanceSection = false;
    }
  }
  return normalizeAcceptanceCriteria(extracted);
};

const renderCombined = (
  input: RenderCustomerMarkdownInput,
  preparedCases: readonly PreparedCustomerCase[],
  acceptanceCriteria: readonly string[],
  mode: "customer" | "technical",
  suiteClarifications: SuiteClarificationRegistry,
  fieldLifecycleTransitions: ReadonlyMap<string, WorkflowFieldLifecycleTransition>,
  showConfidence: boolean,
  partialMajorityCaseIds: ReadonlySet<string>,
): string => {
  const lines: string[] = [];
  lines.push(`# Testfälle: ${renderMarkdownText(input.fileName, mode)}`);
  lines.push("");
  lines.push(`Quelle: ${input.sourceLabel}`);
  lines.push(`Generiert am: ${input.generatedAt}`);
  lines.push(`Anzahl Testfälle: ${preparedCases.length}`);
  lines.push(
    `Exportmodus: ${mode === "customer" ? "customer" : "technical"}`,
  );
  lines.push("");
  lines.push("---");
  lines.push("");
  if (preparedCases.length === 0) {
    lines.push(
      "Keine Testfälle generiert. Prüfen Sie die Eingaben oder konsultieren Sie das Validierungs- und Policy-Reporting im Job-Verzeichnis.",
    );
    return `${lines.join("\n")}\n`;
  }
  lines.push("## Überblick");
  lines.push("");
  lines.push(
    "| Testfall | Zweck | Klasse | Abdeckung | Hinweise |",
  );
  lines.push("| --- | --- | --- | --- | --- |");
  for (const entry of preparedCases) {
    lines.push(
      `| ${entry.displayLabel} | ${escapeTableCell(renderMarkdownText(entry.tc.objective, mode))} | ${escapeTableCell(renderMarkdownText(entry.classification, mode))} | ${escapeTableCell(renderMarkdownText(entry.customerTraceLabel, mode))} | ${escapeTableCell(renderMarkdownText(entry.reviewNotes, mode))} |`,
    );
  }
  lines.push("");
  if (acceptanceCriteria.length > 0) {
    lines.push("## Akzeptanzkriterien");
    lines.push("");
    lines.push("| AC | Inhalt | Zugeordnete Testfälle |");
    lines.push("| --- | --- | --- |");
    for (let i = 0; i < acceptanceCriteria.length; i += 1) {
      const acLabel = formatAcceptanceCriterionLabel(i + 1);
      const matchedCases = preparedCases
        .filter((entry) =>
          entry.matchedAcceptanceCriteria.some((value) => value.startsWith(acLabel)),
        )
        .map((entry) => entry.displayLabel);
      lines.push(
        `| ${acLabel} | ${escapeTableCell(renderMarkdownText(acceptanceCriteria[i] ?? "", mode))} | ${matchedCases.length > 0 ? matchedCases.join(", ") : "—"} |`,
      );
    }
    lines.push("");
  }
  if (input.complianceCoverage !== undefined) {
    appendComplianceCoverageSection(lines, input.complianceCoverage);
  }
  if (mode === "customer") {
    appendSuiteClarificationsSection(lines, suiteClarifications);
  }
  for (let i = 0; i < preparedCases.length; i += 1) {
    const entry = preparedCases[i];
    if (entry === undefined) continue;
    lines.push(
      renderSingleCase(
        entry,
        mode,
        suiteClarifications.byCaseId.get(entry.tc.id) ?? [],
        fieldLifecycleTransitions,
        showConfidence,
        partialMajorityCaseIds.has(entry.tc.id),
      ),
    );
    if (i < preparedCases.length - 1) {
      lines.push("");
      lines.push("---");
      lines.push("");
    }
  }
  return `${lines.join("\n")}\n`;
};

const renderSingleCase = (
  entry: PreparedCustomerCase,
  mode: "customer" | "technical",
  customerClarifications: readonly ClarificationReference[],
  fieldLifecycleTransitions: ReadonlyMap<string, WorkflowFieldLifecycleTransition>,
  showConfidence: boolean,
  hasPartialEvidenceMajority: boolean,
): string => {
  const { tc } = entry;
  const lines: string[] = [];
  lines.push(
    `## ${entry.displayLabel}${mode === "customer" ? " - " : " — "}${renderMarkdownText(entry.customerTitle, mode)}`,
  );
  lines.push("");
  lines.push("**Beschreibung:**");
  lines.push("");
  lines.push(renderMarkdownText(tc.objective, mode));
  lines.push("");
  lines.push(
    `**Klasse:** ${renderMarkdownText(entry.classification, mode)} · **Priorität:** ${tc.priority} · **Risiko:** ${tc.riskCategory} · **Technik:** ${tc.technique}`,
  );
  lines.push("");
  if (showConfidence && typeof tc.confidence === "number") {
    lines.push(`**Konfidenz:** ${formatConfidence(tc.confidence)}`);
    lines.push("");
  }
  const workflowRefs = [
    ...new Set(
      tc.qualitySignals.coveredActionIds.filter((id) =>
        WORKFLOW_ACTION_ID_PATTERN.test(id),
      ),
    ),
  ].sort((left, right) => left.localeCompare(right));
  if (workflowRefs.length > 0) {
    lines.push(`**Workflow-Aktionen:** ${workflowRefs.join(", ")}`);
    lines.push("");
  }
  if (mode === "customer" && customerClarifications.length > 0) {
    lines.push(
      `**Klärbedarf:** ${customerClarifications.map((item) => item.id).join(", ")}`,
    );
    lines.push("");
  }
  const customerAssumptions = tc.assumptions
    .map((value) => sanitizeCustomerVisibleText(value))
    .filter((value) => value.length > 0);
  if (mode === "customer" && customerAssumptions.length > 0) {
    lines.push("**Annahmen:**");
    for (const assumption of customerAssumptions) {
      lines.push(`- ${renderMarkdownText(assumption, mode)}`);
    }
    lines.push("");
  }
  if (mode === "technical" && (tc.assumptions.length > 0 || tc.openQuestions.length > 0)) {
    lines.push("> [!IMPORTANT]");
    lines.push("> **Klärbedarf vor Freigabe**");
    for (const assumption of tc.assumptions) {
      lines.push(`> Annahme: ${assumption}`);
    }
    for (const question of tc.openQuestions) {
      lines.push(`> Offene Frage: ${question}`);
    }
    lines.push("");
  }
  if (tc.preconditions.length > 0) {
    lines.push("**Vorbedingungen:**");
    for (const p of tc.preconditions) {
      lines.push(`- ${renderMarkdownText(p, mode)}`);
    }
    lines.push("");
  }
  if (tc.testData.length > 0) {
    lines.push("**Testdaten:**");
    for (const d of tc.testData) {
      lines.push(`- ${renderMarkdownText(d, mode)}`);
    }
    lines.push("");
  }
  lines.push("**Schritte:**");
  lines.push("");
  for (const step of tc.steps) {
    lines.push(`### Step ${step.index}`);
    lines.push("");
    lines.push("**Beschreibung:**");
    lines.push("");
    lines.push(renderMarkdownText(step.action, mode));
    const lifecycleTransition =
      step.fieldLifecycleTransitionId === undefined
        ? undefined
        : fieldLifecycleTransitions.get(step.fieldLifecycleTransitionId);
    if (lifecycleTransition !== undefined) {
      lines.push("");
      lines.push(
        renderMarkdownText(
          `→ Feld erreicht Zustand "${formatFieldLifecycleStateLabel(lifecycleTransition.to)}"`,
          mode,
        ),
      );
    }
    lines.push("");
    const expected =
      typeof step.expected === "string" && step.expected.length > 0
        ? step.expected
        : "—";
    lines.push("**Erwartetes Ergebnis:**");
    lines.push("");
    lines.push(renderMarkdownText(expected, mode));
    lines.push("");
  }
  if (tc.expectedResults.length > 0) {
    lines.push("**Gesamterwartung:**");
    for (const r of tc.expectedResults) {
      lines.push(`- ${renderMarkdownText(r, mode)}`);
    }
    lines.push("");
  }
  const coverageMapping = buildCoverageMapping(entry, mode);
  if (coverageMapping.length > 0) {
    lines.push("**Abdeckung & Nachvollziehbarkeit:**");
    for (const coverageEntry of coverageMapping) {
      lines.push(`- ${coverageEntry}`);
    }
    lines.push("");
  }
  if (tc.regulatoryRelevance !== undefined) {
    lines.push(
      `**Regulatorische Relevanz:** ${renderMarkdownText(tc.regulatoryRelevance.domain, mode)}${mode === "customer" ? " - " : " — "}${renderMarkdownText(tc.regulatoryRelevance.rationale, mode)}`,
    );
    lines.push("");
  }
  if (mode === "technical") {
    lines.push(`*Test-ID:* \`${tc.id}\``);
    lines.push("");
    const technicalRefs = tc.figmaTraceRefs
      .map((ref) =>
        [ref.screenId, ref.nodeId, ref.nodeName, ref.nodePath]
          .filter((part): part is string => typeof part === "string" && part.length > 0)
          .join(" · "),
      )
      .filter((value) => value.length > 0);
    if (technicalRefs.length > 0) {
      lines.push("**Technische Referenzen:**");
      for (const ref of technicalRefs) {
        lines.push(`- ${ref}`);
      }
    }
  }
  if (hasPartialEvidenceMajority) {
    if (lines[lines.length - 1] !== "") lines.push("");
    lines.push(
      "> _Hinweis (Cross-Modal-Faithfulness): Mehrheit der Schritte mit partieller visueller Evidenz — bitte Reviewer-Bestätigung der Schrittbeschreibungen vor Freigabe._",
    );
  }
  return lines.join("\n");
};

const formatConfidence = (value: number): string =>
  clampConfidence(value).toFixed(2);

const clampConfidence = (value: number): number => {
  if (!Number.isFinite(value)) return 0;
  if (value <= 0) return 0;
  if (value >= 1) return 1;
  return value;
};

const buildCoverageMapping = (
  entry: PreparedCustomerCase,
  mode: "customer" | "technical",
): string[] => {
  const { tc } = entry;
  const objective = tc.objective.trim();
  const expected =
    tc.expectedResults.length > 0
      ? tc.expectedResults.join("; ")
      : objective.length > 0
        ? objective
        : "Nicht angegeben";
  const evidenceParts: string[] = [];
  if (tc.preconditions.length > 0) {
    evidenceParts.push(`Vorbedingungen: ${tc.preconditions.join("; ")}`);
  }
  if (tc.testData.length > 0) {
    evidenceParts.push(`Testdaten: ${tc.testData.join("; ")}`);
  }
  if (tc.steps.length > 0) {
    evidenceParts.push(
      `Schritte: ${tc.steps.map((step) => step.action).join(" -> ")}`,
    );
  }
  const coverage: string[] = [];
  if (entry.matchedAcceptanceCriteria.length > 0) {
    coverage.push(
      `Akzeptanzkriterien: ${entry.matchedAcceptanceCriteria.join("; ")}`,
    );
  } else {
    coverage.push(`Prüfziel: ${expected}`);
  }
  coverage.push(`Abgedeckte Semantik: ${entry.coverageTheme}`);
  if (entry.customerTraceLabel.length > 0) {
    coverage.push(`UI-/Fachbezug: ${entry.customerTraceLabel}`);
  }
  if (evidenceParts.length > 0) {
    coverage.push(`Evidenz: ${evidenceParts.join(" · ")}`);
  }
  return coverage.map((value) => renderMarkdownText(value, mode));
};

const inferCoverageTheme = (tc: GeneratedTestCase): string => {
  const combinedText = normalizeText(
    [
      tc.title,
      tc.objective,
      ...tc.preconditions,
      ...tc.testData,
      ...tc.steps.flatMap((step) => [step.action, step.expected ?? "", step.data ?? ""]),
      ...tc.expectedResults,
    ].join(" "),
  );
  if (
    tc.type === "boundary" ||
    tc.technique === "boundary_value_analysis"
  ) {
    return "Grenzwerte";
  }
  if (tc.type === "validation" || tc.technique === "decision_table") {
    return "Validierung / Regelprüfung";
  }
  if (tc.type === "navigation" || tc.technique === "state_transition") {
    return "Navigation / Zustandswechsel";
  }
  if (KEYWORD_SELECTABLE_HINT_PATTERN.test(combinedText)) {
    return "Auswahloptionen";
  }
  if (KEYWORD_RESULT_HINT_PATTERN.test(combinedText)) {
    return "Ergebnisanzeige";
  }
  if (tc.type === "negative" || tc.priority === "p0") {
    return "Negativ- bzw. Fehlerpfad";
  }
  return "Standardfluss";
};

const normalizeText = (value: string): string =>
  value
    .toLowerCase()
    .replace(NON_ASCII_HYPHEN_PATTERN, "-")
    .replace(/[\p{P}\p{S}]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();

const sanitizeCustomerVisibleText = (value: string): string =>
  value
    .replace(CUSTOMER_PROVENANCE_PREFIX_PATTERN, "")
    .replace(CUSTOMER_CLARIFICATION_LABEL_PATTERN, "")
    .replace(NON_ASCII_HYPHEN_PATTERN, "-")
    .replace(COLLAPSE_WHITESPACE, " ")
    .trim();

const normalizeCustomerMarkdownText = (value: string): string =>
  value.replace(NON_ASCII_HYPHEN_PATTERN, "-");

const renderMarkdownText = (
  value: string,
  mode: "customer" | "technical",
): string => (mode === "customer" ? normalizeCustomerMarkdownText(value) : value);

const buildClarificationFingerprint = (value: string): string => {
  const sanitized = sanitizeCustomerVisibleText(value);
  const tokens = tokenizeForMatching(sanitized).sort();
  if (tokens.length > 0) {
    return tokens.join("|");
  }
  return normalizeText(sanitized);
};

const CUSTOMER_UNSAFE_TRACE_LABELS = new Set([
  "content",
  "label",
  "typography",
  "value",
]);
const FIGMA_ID_FRAGMENT_PATTERN = /\b\d+:\d+\b/u;

const isCustomerSafeTraceLabel = (
  value: string | undefined,
): value is string => {
  if (value === undefined) return false;
  const trimmed = value.trim();
  if (trimmed.length === 0) return false;
  if (FIGMA_ID_FRAGMENT_PATTERN.test(trimmed)) return false;
  if (/^<[^>]+>$/u.test(trimmed)) return false;
  if (CUSTOMER_UNSAFE_TRACE_LABELS.has(trimmed.toLowerCase())) return false;
  return true;
};

const buildPreparedFilename = (
  entry: PreparedCustomerCase,
  mode: "customer" | "technical",
): string => {
  const titleSlug = slugify(entry.customerTitle);
  const prefix =
    mode === "customer"
      ? entry.displayLabel.toLowerCase()
      : `${entry.displayLabel.toLowerCase()}-${slugify(entry.tc.id)}`;
  const base =
    titleSlug.length > 0 ? `${prefix}-${titleSlug}` : prefix;
  return `${base.slice(0, 96)}.md`;
};

const prepareCustomerCases = (
  testCases: readonly GeneratedTestCase[],
  acceptanceCriteria: readonly string[],
  mode: "customer" | "technical",
): PreparedCustomerCase[] => {
  const sorted = testCases
    .map((tc) => ({
      tc,
      explicitNumber: extractExplicitCaseNumber(tc),
      customerTitle: stripLeadingCaseLabel(tc.title),
    }))
    .slice()
    .sort((left, right) => compareCustomerCases(left, right));
  return sorted.map((item, index) => {
    const displayLabel = formatTestCaseLabel(index + 1);
    const customerTraceLabel = buildCustomerTraceLabel(item.tc);
    const coverageTheme = inferCoverageTheme(item.tc);
    const matchedAcceptanceCriteria = matchAcceptanceCriteria(
      item.tc,
      acceptanceCriteria,
    );
    const prepared: PreparedCustomerCase = {
      tc: item.tc,
      displayLabel,
      customerTitle:
        item.customerTitle.length > 0 ? item.customerTitle : item.tc.title,
      filename: "placeholder.md",
      classification: classifyCustomerCase(item.tc),
      coverageTheme,
      reviewNotes: summarizeReviewNotes(item.tc),
      customerTraceLabel:
        matchedAcceptanceCriteria.length > 0
          ? matchedAcceptanceCriteria.join("; ")
          : customerTraceLabel.length > 0
            ? customerTraceLabel
            : coverageTheme,
      matchedAcceptanceCriteria,
    };
    prepared.filename = buildPreparedFilename(prepared, mode);
    return prepared;
  });
};

const compareCustomerCases = (
  left: {
    tc: GeneratedTestCase;
    explicitNumber: number | undefined;
    customerTitle: string;
  },
  right: {
    tc: GeneratedTestCase;
    explicitNumber: number | undefined;
    customerTitle: string;
  },
): number => {
  if (left.explicitNumber !== undefined && right.explicitNumber !== undefined) {
    return left.explicitNumber - right.explicitNumber;
  }
  if (left.explicitNumber !== undefined) return -1;
  if (right.explicitNumber !== undefined) return 1;
  const priority = comparePriority(left.tc.priority, right.tc.priority);
  if (priority !== 0) return priority;
  const titleCompare = left.customerTitle.localeCompare(right.customerTitle, "de");
  if (titleCompare !== 0) return titleCompare;
  return left.tc.id.localeCompare(right.tc.id, "en");
};

const comparePriority = (
  left: GeneratedTestCase["priority"],
  right: GeneratedTestCase["priority"],
): number => {
  const order = new Map([
    ["p0", 0],
    ["p1", 1],
    ["p2", 2],
    ["p3", 3],
  ]);
  return (order.get(left) ?? 99) - (order.get(right) ?? 99);
};

const extractExplicitCaseNumber = (tc: GeneratedTestCase): number | undefined => {
  const titleMatch = tc.title.match(TEST_CASE_NUMBER_PATTERN);
  if (titleMatch?.[1] !== undefined) {
    return Number.parseInt(titleMatch[1], 10);
  }
  const idMatch = tc.id.match(/^tc[\s_-]*0*(\d{1,4})$/iu);
  if (idMatch?.[1] !== undefined) {
    return Number.parseInt(idMatch[1], 10);
  }
  return undefined;
};

const stripLeadingCaseLabel = (value: string): string =>
  value.replace(LEADING_TEST_CASE_LABEL_PATTERN, "").trim();

const formatTestCaseLabel = (index: number): string =>
  `TC${String(index).padStart(2, "0")}`;

const formatClarificationLabel = (index: number): string =>
  `FQ-${String(index).padStart(3, "0")}`;

const formatAcceptanceCriterionLabel = (index: number): string =>
  `AC${String(index).padStart(2, "0")}`;

const normalizeAcceptanceCriteria = (
  criteria: readonly string[] | undefined,
): string[] =>
  Array.from(
    new Set(
      (criteria ?? [])
        .map((value) => value.trim())
        .filter((value) => value.length > 0),
    ),
  );

const buildCustomerTraceLabel = (tc: GeneratedTestCase): string => {
  const refs = Array.from(
    new Set(
      tc.figmaTraceRefs
        .map((r) => r.nodeName)
        .filter((name): name is string => isCustomerSafeTraceLabel(name)),
    ),
  );
  return refs.join("; ");
};

const classifyCustomerCase = (tc: GeneratedTestCase): string => {
  const polarity =
    tc.polarity ??
    deriveGeneratedTestCaseClassification(tc).polarity;
  return renderGeneratedTestCasePolarityLabel(polarity);
};

const summarizeReviewNotes = (tc: GeneratedTestCase): string => {
  const notes: string[] = [];
  if (tc.openQuestions.length > 0) {
    notes.push(`Offene Fragen: ${tc.openQuestions.length}`);
  }
  if (tc.assumptions.length > 0) {
    notes.push(`Annahmen: ${tc.assumptions.length}`);
  }
  return notes.length > 0 ? notes.join(" · ") : "—";
};

const EMPTY_SUITE_CLARIFICATION_REGISTRY: SuiteClarificationRegistry = {
  ordered: [],
  byCaseId: new Map(),
};

const buildSuiteClarificationRegistry = (
  preparedCases: readonly PreparedCustomerCase[],
): SuiteClarificationRegistry => {
  const ordered: ClarificationReference[] = [];
  const byFingerprint = new Map<string, ClarificationReference>();
  const byCaseId = new Map<string, readonly ClarificationReference[]>();
  for (const entry of preparedCases) {
    const caseReferences: ClarificationReference[] = [];
    const seenFingerprints = new Set<string>();
    for (const question of entry.tc.openQuestions) {
      const text = sanitizeCustomerVisibleText(question);
      if (text.length === 0) continue;
      const fingerprint = buildClarificationFingerprint(text);
      if (fingerprint.length === 0 || seenFingerprints.has(fingerprint)) {
        continue;
      }
      seenFingerprints.add(fingerprint);
      let reference = byFingerprint.get(fingerprint);
      if (reference === undefined) {
        reference = {
          id: formatClarificationLabel(ordered.length + 1),
          text,
        };
        byFingerprint.set(fingerprint, reference);
        ordered.push(reference);
      }
      caseReferences.push(reference);
    }
    if (caseReferences.length > 0) {
      byCaseId.set(entry.tc.id, caseReferences);
    }
  }
  return { ordered, byCaseId };
};

const appendSuiteClarificationsSection = (
  lines: string[],
  registry: SuiteClarificationRegistry,
): void => {
  if (registry.ordered.length === 0) return;
  lines.push("## Übergreifender Klärbedarf vor Freigabe");
  lines.push("");
  for (const clarification of registry.ordered) {
    lines.push(`- ${clarification.id}: ${clarification.text}`);
  }
  lines.push("");
};

const matchAcceptanceCriteria = (
  tc: GeneratedTestCase,
  acceptanceCriteria: readonly string[],
): string[] => {
  if (acceptanceCriteria.length === 0) return [];
  const caseTokens = tokenizeForMatching(
    [
      tc.title,
      tc.objective,
      ...tc.expectedResults,
      ...tc.steps.flatMap((step) => [step.action, step.expected ?? ""]),
      ...tc.figmaTraceRefs.flatMap((ref) => [ref.nodeName ?? ""]),
    ].join(" "),
  );
  const matched: string[] = [];
  for (let i = 0; i < acceptanceCriteria.length; i += 1) {
    const criterion = acceptanceCriteria[i];
    if (criterion === undefined) continue;
    const criterionTokens = tokenizeForMatching(criterion);
    if (criterionTokens.length === 0) continue;
    const overlap = criterionTokens.filter((token) => caseTokens.includes(token));
    if (overlap.length < Math.min(2, criterionTokens.length)) continue;
    matched.push(
      `${formatAcceptanceCriterionLabel(i + 1)}: ${criterion}`,
    );
  }
  return matched;
};

const tokenizeForMatching = (value: string): string[] =>
  Array.from(
    new Set(
      normalizeText(value)
        .split(" ")
        .map((token) => token.trim())
        .filter((token) => token.length >= 3 && !STOP_WORDS.has(token)),
    ),
  );

const escapeTableCell = (value: string): string =>
  value
    .replace(/\\/gu, "\\\\")
    .replace(/\|/gu, "\\|")
    .replace(/\r?\n/gu, " ")
    .trim() || "—";

const formatCoverageRatioPercent = (ratio: number): string => {
  const clamped = Math.max(0, Math.min(1, ratio));
  return `${(clamped * 100).toFixed(1)}%`;
};

const buildFieldLifecycleTransitionLookup = (
  workflowTopology: WorkflowTopology | undefined,
): ReadonlyMap<string, WorkflowFieldLifecycleTransition> =>
  new Map(
    workflowTopology?.fieldLifecycles.flatMap((lifecycle) =>
      lifecycle.transitions.map((transition) => [
        transition.transitionId,
        transition,
      ] as const),
    ) ?? [],
  );

const formatFieldLifecycleStateLabel = (
  state: WorkflowFieldLifecycleTransition["to"],
): string => {
  switch (state) {
    case "initial":
      return "initial";
    case "focused":
      return "fokussiert";
    case "in_progress":
      return "in Bearbeitung";
    case "validated":
      return "validiert";
    case "error":
      return "fehler";
    case "terminal":
      return "terminal";
  }
};

const appendComplianceCoverageSection = (
  lines: string[],
  report: ComplianceCoverageReport,
): void => {
  lines.push("## Compliance coverage");
  lines.push("");
  if (report.activeFrameworks.length === 0) {
    lines.push(
      "Keine aktiven Regelwerke konfiguriert (Issue #2042 — `--compliance-frameworks`).",
    );
    lines.push("");
    return;
  }
  lines.push(
    `Aktive Regelwerke: ${report.activeFrameworks.join(", ")} · Gesamtabdeckung: ${formatCoverageRatioPercent(report.overallCoverageRatio)}`,
  );
  lines.push("");
  lines.push("| Regelwerk | Abdeckung | Erfüllt | Offen |");
  lines.push("| --- | --- | --- | --- |");
  for (const framework of report.frameworks) {
    lines.push(
      `| ${escapeTableCell(framework.title)} | ${formatCoverageRatioPercent(framework.coverageRatio)} | ${framework.coveredRules}/${framework.totalRules} | ${framework.uncoveredRules} |`,
    );
  }
  lines.push("");
  lines.push("| Artikel | Schweregrad | Abgedeckt |");
  lines.push("| --- | --- | --- |");
  for (const framework of report.frameworks) {
    for (const rule of framework.rules) {
      const coveredLabel = rule.covered ? "ja" : "nein";
      lines.push(
        `| ${escapeTableCell(rule.ruleId)} — ${escapeTableCell(rule.citation)} | ${rule.severity} | ${coveredLabel} |`,
      );
    }
  }
  lines.push("");
};

const slugify = (raw: string): string => {
  const lowered = raw.toLowerCase();
  // Map common German diacritics back to ASCII before stripping.
  const folded = lowered
    .replace(/ä/gu, "ae")
    .replace(/ö/gu, "oe")
    .replace(/ü/gu, "ue")
    .replace(/ß/gu, "ss")
    .normalize("NFKD")
    // Strip remaining combining marks left over by NFKD on other latin
    // letters (é, ñ, etc.).
    .replace(/[̀-ͯ]/gu, "")
    .replace(FORBIDDEN_FILENAME_CHARS, " ")
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(COLLAPSE_WHITESPACE, " ")
    .trim();
  return folded.replace(/^-+|-+$/gu, "");
};
