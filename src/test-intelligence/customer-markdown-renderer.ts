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
} from "../contracts/index.js";

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
}

export interface RenderedCustomerMarkdown {
  combinedMarkdown: string;
  perCaseFiles: ReadonlyArray<{ filename: string; body: string }>;
}

// eslint-disable-next-line no-control-regex
const FORBIDDEN_FILENAME_CHARS = /[\\/:*?"<>|\x00-\x1f]/gu;
const COLLAPSE_WHITESPACE = /\s+/gu;
const KEYWORD_SELECTABLE_HINT_PATTERN =
  /\b(select|dropdown|checkbox|radio|option|auswahl|choice|picker)\b/i;
const KEYWORD_RESULT_HINT_PATTERN =
  /\b(result|summary|status|total|balance|output|confirmation|receipt|preview|overview|message|ergebnis)\b/i;
const A11Y_HINT_PATTERN =
  /\b(a11y|accessibility|barriere|screen[\s-]?reader|focus|fokus|tab(?:-)?reihenfolge|tastatur)\b/i;
const TEST_CASE_NUMBER_PATTERN =
  /\bTC[\s_-]*0*(\d{1,4})\b/iu;
const LEADING_TEST_CASE_LABEL_PATTERN =
  /^\s*TC[\s_-]*0*\d{1,4}\s*(?:[:-]\s*)?/iu;
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

export const renderCustomerMarkdown = (
  input: RenderCustomerMarkdownInput,
): RenderedCustomerMarkdown => {
  const mode = input.mode ?? "customer";
  const acceptanceCriteria = normalizeAcceptanceCriteria(input.acceptanceCriteria);
  const preparedCases = prepareCustomerCases(
    input.list.testCases,
    acceptanceCriteria,
    mode,
  );
  const perCaseFiles = preparedCases.map((entry) => ({
    filename: entry.filename,
    body: renderSingleCase(entry, mode),
  }));
  const combinedMarkdown = renderCombined(
    input,
    preparedCases,
    acceptanceCriteria,
    mode,
  );
  return { combinedMarkdown, perCaseFiles };
};

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
): string => {
  const lines: string[] = [];
  lines.push(`# Testfälle: ${input.fileName}`);
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
      `| ${entry.displayLabel} | ${escapeTableCell(entry.tc.objective)} | ${escapeTableCell(entry.classification)} | ${escapeTableCell(entry.customerTraceLabel)} | ${escapeTableCell(entry.reviewNotes)} |`,
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
        `| ${acLabel} | ${escapeTableCell(acceptanceCriteria[i] ?? "")} | ${matchedCases.length > 0 ? matchedCases.join(", ") : "—"} |`,
      );
    }
    lines.push("");
  }
  for (let i = 0; i < preparedCases.length; i += 1) {
    const entry = preparedCases[i];
    if (entry === undefined) continue;
    lines.push(renderSingleCase(entry, mode));
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
): string => {
  const { tc } = entry;
  const lines: string[] = [];
  lines.push(`## ${entry.displayLabel} — ${entry.customerTitle}`);
  lines.push("");
  lines.push("**Beschreibung:**");
  lines.push("");
  lines.push(tc.objective);
  lines.push("");
  lines.push(
    `**Klasse:** ${entry.classification} · **Priorität:** ${tc.priority} · **Risiko:** ${tc.riskCategory} · **Technik:** ${tc.technique}`,
  );
  lines.push("");
  if (tc.assumptions.length > 0 || tc.openQuestions.length > 0) {
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
      lines.push(`- ${p}`);
    }
    lines.push("");
  }
  if (tc.testData.length > 0) {
    lines.push("**Testdaten:**");
    for (const d of tc.testData) {
      lines.push(`- ${d}`);
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
    lines.push(step.action);
    lines.push("");
    const expected =
      typeof step.expected === "string" && step.expected.length > 0
        ? step.expected
        : "—";
    lines.push("**Erwartetes Ergebnis:**");
    lines.push("");
    lines.push(expected);
    lines.push("");
  }
  if (tc.expectedResults.length > 0) {
    lines.push("**Gesamterwartung:**");
    for (const r of tc.expectedResults) {
      lines.push(`- ${r}`);
    }
    lines.push("");
  }
  const coverageMapping = buildCoverageMapping(entry);
  if (coverageMapping.length > 0) {
    lines.push("**Abdeckung & Nachvollziehbarkeit:**");
    for (const entry of coverageMapping) {
      lines.push(`- ${entry}`);
    }
    lines.push("");
  }
  if (tc.regulatoryRelevance !== undefined) {
    lines.push(
      `**Regulatorische Relevanz:** ${tc.regulatoryRelevance.domain} — ${tc.regulatoryRelevance.rationale}`,
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
  return lines.join("\n");
};

const buildCoverageMapping = (entry: PreparedCustomerCase): string[] => {
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
  return coverage;
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
    .replace(/[\p{P}\p{S}]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();

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
    const displayLabel = formatTestCaseLabel(item.explicitNumber ?? index + 1);
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
  const combined = [
    tc.id,
    tc.title,
    tc.objective,
    ...tc.expectedResults,
    ...tc.steps.flatMap((step) => [step.action, step.expected ?? ""]),
  ].join(" ");
  if (A11Y_HINT_PATTERN.test(combined)) {
    return "Barrierefreiheit";
  }
  switch (tc.type) {
    case "negative":
      return "Negativ";
    case "validation":
      return "Validierung";
    case "boundary":
      return "Grenzwert";
    case "navigation":
      return "Navigation";
    default:
      return "Positiv";
  }
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
  value.replace(/\|/gu, "\\|").replace(/\n/gu, " ").trim() || "—";

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
