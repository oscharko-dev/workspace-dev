/**
 * Post-gen Review Nudges — Issue #993.
 *
 * Scans generated file contents for common accessibility and semantic-HTML
 * smells and returns non-invasive suggestions. Rules are intentionally
 * regex-based so they run in the browser without pulling an AST parser.
 *
 * Nudges never modify generated code — they surface hints next to the code
 * viewer. Disabled rule ids are filtered out before analysis.
 */

import type { WorkspaceA11yPolicy } from "./workspace-policy";

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

export interface GeneratedFileScanInput {
  path: string;
  /**
   * Optional file contents. When absent the module can still run against
   * metadata-only listings (no nudges are produced).
   */
  contents?: string;
}

export interface DeriveA11yNudgesInput {
  files: GeneratedFileScanInput[];
  policy?: WorkspaceA11yPolicy;
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

export type A11yNudgeSeverity = "high" | "medium" | "low";

export interface A11yNudge {
  ruleId: string;
  severity: A11yNudgeSeverity;
  filePath: string;
  line?: number;
  label: string;
  detail: string;
  wcag?: string;
}

export interface A11yNudgeSummary {
  total: number;
  bySeverity: Record<A11yNudgeSeverity, number>;
  byFile: number;
}

export interface A11yNudgeResult {
  nudges: A11yNudge[];
  summary: A11yNudgeSummary;
}

// ---------------------------------------------------------------------------
// Rule registry
// ---------------------------------------------------------------------------

interface A11yRule {
  id: string;
  label: string;
  severity: A11yNudgeSeverity;
  wcag?: string;
  /**
   * Whether the rule promotes its severity under AAA. Optional so rules
   * stay scoped by default and only upgrade when the policy asks for AAA.
   */
  aaaSeverity?: A11yNudgeSeverity;
  /** Regex that, if matched, yields a nudge. */
  pattern: RegExp;
  /** Optional post-match predicate to filter false positives. */
  postFilter?: (match: RegExpExecArray, contents: string) => boolean;
  buildDetail: (match: RegExpExecArray) => string;
}

const IMG_ALT_RULE: A11yRule = {
  id: "img-missing-alt",
  label: "Image without alt text",
  severity: "high",
  wcag: "WCAG 2.2 – 1.1.1",
  pattern: /<img\b(?![^>]*\balt\s*=)[^>]*>/gi,
  buildDetail: (match) =>
    `Image element '${truncate(match[0], 80)}' is missing an \`alt\` attribute. Add a descriptive alt or \`alt=""\` for decorative images.`,
};

const BUTTON_EMPTY_RULE: A11yRule = {
  id: "button-empty-label",
  label: "Button without accessible name",
  severity: "high",
  wcag: "WCAG 2.2 – 4.1.2",
  pattern:
    /<button\b(?![^>]*\baria-label\s*=)(?![^>]*\baria-labelledby\s*=)[^>]*>\s*<\/button>/gi,
  buildDetail: () =>
    "A `<button>` has no visible text and no `aria-label` / `aria-labelledby`. Screen reader users won't know what it does.",
};

const ANCHOR_HREF_RULE: A11yRule = {
  id: "anchor-missing-href",
  label: "Anchor without href",
  severity: "medium",
  wcag: "WCAG 2.2 – 2.1.1",
  pattern: /<a\b(?![^>]*\bhref\s*=)[^>]*>/gi,
  buildDetail: () =>
    "Anchor elements without `href` are not keyboard-focusable. Use a `<button>` if this is an action or add an `href`.",
};

const FORM_LABEL_RULE: A11yRule = {
  id: "input-without-label",
  label: "Input without label",
  severity: "medium",
  wcag: "WCAG 2.2 – 3.3.2",
  pattern:
    /<input\b(?![^>]*\baria-label\s*=)(?![^>]*\baria-labelledby\s*=)(?![^>]*\bid\s*=)[^>]*>/gi,
  buildDetail: () =>
    "`<input>` elements should be paired with a `<label htmlFor>` or carry an `aria-label`.",
};

const DIV_ONCLICK_RULE: A11yRule = {
  id: "div-onclick-no-role",
  label: "Clickable <div> without role",
  severity: "high",
  wcag: "WCAG 2.2 – 4.1.2",
  pattern:
    /<div\b(?=[^>]*\bonClick\s*=)(?![^>]*\brole\s*=)(?![^>]*\btabIndex\s*=)[^>]*>/g,
  buildDetail: () =>
    "`<div>` has an `onClick` handler but no `role` or `tabIndex`. Use a `<button>` or add `role='button'` + `tabIndex={0}` + keyboard handlers.",
};

const HEADING_ORDER_RULE: A11yRule = {
  id: "missing-h1",
  label: "Screen is missing an <h1>",
  severity: "low",
  aaaSeverity: "medium",
  wcag: "WCAG 2.2 – 2.4.6",
  pattern: /<h2\b/i,
  postFilter: (_match, contents) => !/<h1\b/i.test(contents),
  buildDetail: () =>
    "File uses `<h2>` but has no `<h1>`. Add a top-level heading so assistive tech can announce the page structure.",
};

const DIALOG_LABEL_RULE: A11yRule = {
  id: "dialog-missing-label",
  label: "Dialog without accessible name",
  severity: "medium",
  wcag: "WCAG 2.2 – 4.1.2",
  pattern: /<(?:Dialog|dialog)\b(?![^>]*\baria-label(?:ledby)?\s*=)[^>]*>/g,
  buildDetail: () =>
    "Dialog element has no `aria-label` or `aria-labelledby`. Add a descriptive name so users of screen readers can identify it.",
};

const TABLE_CAPTION_RULE: A11yRule = {
  id: "table-missing-caption",
  label: "<table> without caption or summary",
  severity: "low",
  aaaSeverity: "medium",
  wcag: "WCAG 2.2 – 1.3.1",
  pattern: /<table\b[^>]*>/g,
  postFilter: (_match, contents) =>
    !/<caption\b/i.test(contents) && !/aria-describedby/i.test(contents),
  buildDetail: () =>
    "`<table>` has no `<caption>` or `aria-describedby`. Provide a short description of the table contents.",
};

const ALL_RULES: readonly A11yRule[] = Object.freeze([
  IMG_ALT_RULE,
  BUTTON_EMPTY_RULE,
  ANCHOR_HREF_RULE,
  FORM_LABEL_RULE,
  DIV_ONCLICK_RULE,
  HEADING_ORDER_RULE,
  DIALOG_LABEL_RULE,
  TABLE_CAPTION_RULE,
]);

export function listA11yRules(): readonly {
  id: string;
  label: string;
  severity: A11yNudgeSeverity;
  wcag?: string | undefined;
}[] {
  return ALL_RULES.map((rule) => ({
    id: rule.id,
    label: rule.label,
    severity: rule.severity,
    ...(rule.wcag ? { wcag: rule.wcag } : {}),
  }));
}

// ---------------------------------------------------------------------------
// Derivation
// ---------------------------------------------------------------------------

export function deriveA11yNudges(
  input: DeriveA11yNudgesInput,
): A11yNudgeResult {
  const disabled = new Set(input.policy?.disabledRules ?? []);
  const aaa = input.policy?.wcagLevel === "AAA";
  const rules = ALL_RULES.filter((rule) => !disabled.has(rule.id));
  const nudges: A11yNudge[] = [];
  const filesWithNudges = new Set<string>();

  for (const file of input.files) {
    if (!file.contents || !isJsxLike(file.path)) continue;
    for (const rule of rules) {
      const matches = findMatches(rule, file.contents);
      for (const match of matches) {
        const severity = resolveSeverity(rule, aaa);
        nudges.push({
          ruleId: rule.id,
          severity,
          filePath: file.path,
          line: lineOfMatch(file.contents, match.index),
          label: rule.label,
          detail: rule.buildDetail(match),
          ...(rule.wcag ? { wcag: rule.wcag } : {}),
        });
        filesWithNudges.add(file.path);
      }
    }
  }

  const bySeverity: Record<A11yNudgeSeverity, number> = {
    high: 0,
    medium: 0,
    low: 0,
  };
  for (const nudge of nudges) {
    bySeverity[nudge.severity] += 1;
  }

  return {
    nudges: sortNudges(nudges),
    summary: {
      total: nudges.length,
      bySeverity,
      byFile: filesWithNudges.size,
    },
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isJsxLike(path: string): boolean {
  return /\.(tsx|jsx|html|mdx)$/i.test(path);
}

function findMatches(rule: A11yRule, contents: string): RegExpExecArray[] {
  const out: RegExpExecArray[] = [];
  const flags = rule.pattern.flags.includes("g")
    ? rule.pattern.flags
    : `${rule.pattern.flags}g`;
  const pattern = new RegExp(rule.pattern.source, flags);
  let match = pattern.exec(contents);
  while (match !== null) {
    if (!rule.postFilter || rule.postFilter(match, contents)) {
      out.push(match);
    }
    if (match.index === pattern.lastIndex) pattern.lastIndex += 1;
    match = pattern.exec(contents);
  }
  return out;
}

function resolveSeverity(rule: A11yRule, aaa: boolean): A11yNudgeSeverity {
  if (aaa && rule.aaaSeverity) return rule.aaaSeverity;
  return rule.severity;
}

function lineOfMatch(contents: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index && i < contents.length; i += 1) {
    if (contents.charCodeAt(i) === 10) line += 1;
  }
  return line;
}

function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, Math.max(0, max - 1))}…`;
}

function sortNudges(nudges: A11yNudge[]): A11yNudge[] {
  const severityRank: Record<A11yNudgeSeverity, number> = {
    high: 0,
    medium: 1,
    low: 2,
  };
  return [...nudges].sort((a, b) => {
    if (severityRank[a.severity] !== severityRank[b.severity]) {
      return severityRank[a.severity] - severityRank[b.severity];
    }
    if (a.filePath !== b.filePath) {
      return a.filePath.localeCompare(b.filePath);
    }
    return (a.line ?? 0) - (b.line ?? 0);
  });
}
