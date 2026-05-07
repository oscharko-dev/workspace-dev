/**
 * Customer-format Markdown renderer (Issue #1733).
 *
 * Format derived from the customer brief in
 * `save/Testfall-eines-Anwendungstests.md`:
 *   - Each test case has a Title, a Beschreibung (description), and a list
 *     of Steps (Step N — Beschreibung / Erwartetes Ergebnis).
 *
 * The renderer is pure: identical inputs produce identical outputs. Each
 * per-case Markdown file uses a deterministic, filename-safe slug derived
 * from the case id; the combined `testfaelle.md` lists every case in the
 * order returned by the generator.
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
}

export interface RenderedCustomerMarkdown {
  combinedMarkdown: string;
  perCaseFiles: ReadonlyArray<{ filename: string; body: string }>;
}

// eslint-disable-next-line no-control-regex
const FORBIDDEN_FILENAME_CHARS = /[\\/:*?"<>|\x00-\x1f]/gu;
const COLLAPSE_WHITESPACE = /\s+/gu;

export const renderCustomerMarkdown = (
  input: RenderCustomerMarkdownInput,
): RenderedCustomerMarkdown => {
  const perCaseFiles = input.list.testCases.map((tc) => ({
    filename: buildFilename(tc),
    body: renderSingleCase(tc),
  }));
  const combinedMarkdown = renderCombined(input);
  return { combinedMarkdown, perCaseFiles };
};

const renderCombined = (input: RenderCustomerMarkdownInput): string => {
  const lines: string[] = [];
  lines.push(`# Testfälle: ${input.fileName}`);
  lines.push("");
  lines.push(`Quelle: ${input.sourceLabel}`);
  lines.push(`Generiert am: ${input.generatedAt}`);
  lines.push(`Anzahl Testfälle: ${input.list.testCases.length}`);
  lines.push("");
  lines.push("---");
  lines.push("");
  if (input.list.testCases.length === 0) {
    lines.push(
      "Keine Testfälle generiert. Prüfen Sie die Eingaben oder konsultieren Sie das Validierungs- und Policy-Reporting im Job-Verzeichnis.",
    );
    return `${lines.join("\n")}\n`;
  }
  for (let i = 0; i < input.list.testCases.length; i += 1) {
    const tc = input.list.testCases[i];
    if (tc === undefined) continue;
    lines.push(renderSingleCase(tc));
    if (i < input.list.testCases.length - 1) {
      lines.push("");
      lines.push("---");
      lines.push("");
    }
  }
  return `${lines.join("\n")}\n`;
};

const renderSingleCase = (tc: GeneratedTestCase): string => {
  const lines: string[] = [];
  lines.push(`## ${tc.title}`);
  lines.push("");
  lines.push("**Beschreibung:**");
  lines.push("");
  lines.push(tc.objective);
  lines.push("");
  lines.push(
    `**Typ:** ${tc.type} · **Priorität:** ${tc.priority} · **Risiko:** ${tc.riskCategory} · **Technik:** ${tc.technique}`,
  );
  lines.push("");
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
  if (tc.assumptions.length > 0) {
    lines.push("**Annahmen:**");
    for (const a of tc.assumptions) {
      lines.push(`- ${a}`);
    }
    lines.push("");
  }
  if (tc.openQuestions.length > 0) {
    lines.push("**Offene Fragen:**");
    for (const q of tc.openQuestions) {
      lines.push(`- ${q}`);
    }
    lines.push("");
  }
  if (tc.figmaTraceRefs.length > 0) {
    const refs = Array.from(
      new Set(
        tc.figmaTraceRefs
          .map((r) => r.nodeName)
          .filter((name): name is string => isCustomerSafeTraceLabel(name)),
      ),
    );
    if (refs.length > 0) {
      lines.push(`**Fachlicher Bezug:** ${refs.join("; ")}`);
      lines.push("");
    }
  }
  if (tc.regulatoryRelevance !== undefined) {
    lines.push(
      `**Regulatorische Relevanz:** ${tc.regulatoryRelevance.domain} — ${tc.regulatoryRelevance.rationale}`,
    );
    lines.push("");
  }
  lines.push(`*Test-ID:* \`${tc.id}\``);
  return lines.join("\n");
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

const buildFilename = (tc: GeneratedTestCase): string => {
  const titleSlug = slugify(tc.title);
  const base =
    titleSlug.length > 0 ? `${slugify(tc.id)}_${titleSlug}` : slugify(tc.id);
  const trimmed = base.length > 96 ? base.slice(0, 96) : base;
  return `${trimmed}.md`;
};

const slugify = (raw: string): string => {
  const lowered = raw.toLowerCase().normalize("NFKD");
  // Map common German diacritics back to ASCII before stripping.
  const folded = lowered
    .replace(/ä/gu, "ae")
    .replace(/ö/gu, "oe")
    .replace(/ü/gu, "ue")
    .replace(/ß/gu, "ss")
    // Strip remaining combining marks left over by NFKD on other latin
    // letters (é, ñ, etc.).
    .replace(/[̀-ͯ]/gu, "")
    .replace(FORBIDDEN_FILENAME_CHARS, " ")
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(COLLAPSE_WHITESPACE, " ")
    .trim();
  return folded.replace(/^-+|-+$/gu, "");
};
