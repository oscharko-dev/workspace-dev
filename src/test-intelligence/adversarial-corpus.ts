/**
 * Adversarial corpus loader + CI gate (Issue #2122).
 *
 * Reads the curated catalogue at `fixtures/adversarial-corpus/catalog.json`,
 * validates the schema, dispatches every entry to the appropriate defense
 * layer (`normalizeUntrustedContent` for input-side carriers,
 * `detectSuspiciousContent` for output-side carriers), and asserts the
 * observed report matches the entry's `expectedOutcome`.
 *
 * The loader is pure and deterministic: identical `catalog.json` content
 * always produces the same `AdversarialCorpusGateReport`. No model is
 * invoked at gate time — `mistral-large-3` is the design-time generator
 * and only its committed output (the catalog) participates here.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import type { UntrustedContentNormalizationOutcome } from "../contracts/index.js";
import {
  SEMANTIC_SUSPICION_CATEGORIES,
  detectSuspiciousContent,
  type SemanticSuspicionCategory,
} from "./semantic-content-sanitization.js";
import {
  normalizeUntrustedContent,
  type UntrustedContentDropCounts,
  type UntrustedContentNormalizationReport,
} from "./untrusted-content-normalizer.js";

export const ADVERSARIAL_CORPUS_SCHEMA_VERSION = "1.0.0" as const;

export const ADVERSARIAL_CORPUS_RELATIVE_PATH =
  "fixtures/adversarial-corpus/catalog.json" as const;

export const ADVERSARIAL_CORPUS_MIN_ENTRY_COUNT = 50 as const;

/** Closed enum of attack categories required by the AC. */
export const ADVERSARIAL_CORPUS_CATEGORIES = [
  "prompt_injection_direct",
  "prompt_injection_indirect_figma",
  "prompt_injection_indirect_jira",
  "prompt_injection_indirect_markdown",
  "data_exfiltration",
  "instruction_following_hijack",
  "role_confusion",
  "output_side_shell",
  "output_side_jndi",
  "output_side_xss",
  "oracle_bypass",
  "ranking_manipulation",
  "context_stuffing",
  "charset_tricks_zero_width",
  "charset_tricks_rtl_override",
] as const;

export type AdversarialCorpusCategory =
  (typeof ADVERSARIAL_CORPUS_CATEGORIES)[number];

export const ADVERSARIAL_CORPUS_PAYLOAD_KINDS = [
  "markdown",
  "text-field",
  "jira-adf",
  "figma-document",
  "output-string",
] as const;

export type AdversarialCorpusPayloadKind =
  (typeof ADVERSARIAL_CORPUS_PAYLOAD_KINDS)[number];

export type AdversarialCorpusDropCountKey = keyof UntrustedContentDropCounts;

const DROP_COUNT_KEYS: ReadonlySet<AdversarialCorpusDropCountKey> = new Set([
  "figmaHiddenLayers",
  "figmaZeroOpacityLayers",
  "figmaOffCanvasLayers",
  "figmaZeroFontSizeLayers",
  "sentinelLayerNames",
  "zeroWidthCharacters",
  "adfCollapsedNodes",
  "elementsTruncated",
  "piiMatches",
  "secretMatches",
  "markdownInjectionMatches",
]);

export interface AdversarialCorpusInputExpectedOutcome {
  readonly surface: "input";
  readonly outcome: UntrustedContentNormalizationOutcome;
  readonly nonZeroCounts: ReadonlyArray<AdversarialCorpusDropCountKey>;
}

export interface AdversarialCorpusOutputExpectedOutcome {
  readonly surface: "output";
  readonly category: SemanticSuspicionCategory;
}

export type AdversarialCorpusExpectedOutcome =
  | AdversarialCorpusInputExpectedOutcome
  | AdversarialCorpusOutputExpectedOutcome;

export interface AdversarialCorpusEntry {
  readonly id: string;
  readonly category: AdversarialCorpusCategory;
  readonly title: string;
  readonly payloadKind: AdversarialCorpusPayloadKind;
  readonly payload: unknown;
  /** Optional: when set, the runner inflates the payload string to this many UTF-8 bytes. */
  readonly payloadRepeatBytes?: number;
  /** Optional: when set, the runner replaces `__REPEAT__` inside an ADF payload with X-padding to this byte count. */
  readonly payloadAdfTextRepeatBytes?: number;
  readonly expectedOutcome: AdversarialCorpusExpectedOutcome;
  readonly citation: string;
}

export interface AdversarialCorpusCategoryDefinition {
  readonly id: AdversarialCorpusCategory;
  readonly title: string;
  readonly description: string;
}

export interface AdversarialCorpus {
  readonly schemaVersion: typeof ADVERSARIAL_CORPUS_SCHEMA_VERSION;
  readonly version: string;
  readonly generatedAt: string;
  readonly lastReviewedAt: string;
  readonly nextReviewDue: string;
  readonly reviewCadence: "quarterly";
  readonly issueRef: string;
  readonly epicRef: string;
  readonly generatedBy: {
    readonly model: string;
    readonly modelIssueRef: string;
    readonly designTime: true;
    readonly smeReviewed: true;
    readonly smeReviewers: ReadonlyArray<string>;
  };
  readonly categories: ReadonlyArray<AdversarialCorpusCategoryDefinition>;
  readonly entries: ReadonlyArray<AdversarialCorpusEntry>;
}

// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------

export interface LoadAdversarialCorpusInput {
  /** Repository root. Defaults to `process.cwd()`. */
  readonly repoRoot?: string;
}

/**
 * Load and validate the corpus. Pure: parses, type-checks, and returns
 * a deeply-readonly view. Throws `AdversarialCorpusValidationError` on
 * any structural defect so callers cannot accidentally consume a half-
 * formed catalog.
 */
export const loadAdversarialCorpus = async (
  input: LoadAdversarialCorpusInput = {},
): Promise<AdversarialCorpus> => {
  const repoRoot = input.repoRoot ?? process.cwd();
  const path = join(repoRoot, ADVERSARIAL_CORPUS_RELATIVE_PATH);
  const raw = await readFile(path, "utf8");
  const parsed = JSON.parse(raw) as unknown;
  return validateAdversarialCorpus(parsed);
};

export class AdversarialCorpusValidationError extends Error {
  readonly path: string;
  constructor(message: string, path: string) {
    super(`adversarial-corpus: ${message} (at ${path})`);
    this.name = "AdversarialCorpusValidationError";
    this.path = path;
  }
}

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  return (
    typeof value === "object" && value !== null && !Array.isArray(value)
  );
};

const requireString = (
  value: unknown,
  path: string,
): string => {
  if (typeof value !== "string") {
    throw new AdversarialCorpusValidationError("expected string", path);
  }
  return value;
};

const requireOneOf = <T extends string>(
  value: unknown,
  path: string,
  allowed: ReadonlyArray<T>,
): T => {
  const s = requireString(value, path);
  if (!(allowed as ReadonlyArray<string>).includes(s)) {
    throw new AdversarialCorpusValidationError(
      `expected one of ${allowed.join(", ")}, got ${s}`,
      path,
    );
  }
  return s as T;
};

export const validateAdversarialCorpus = (raw: unknown): AdversarialCorpus => {
  if (!isPlainObject(raw)) {
    throw new AdversarialCorpusValidationError("expected object", "$");
  }
  if (raw.schemaVersion !== ADVERSARIAL_CORPUS_SCHEMA_VERSION) {
    throw new AdversarialCorpusValidationError(
      `expected schemaVersion=${ADVERSARIAL_CORPUS_SCHEMA_VERSION}, got ${String(raw.schemaVersion)}`,
      "$.schemaVersion",
    );
  }
  const version = requireString(raw.version, "$.version");
  const generatedAt = requireString(raw.generatedAt, "$.generatedAt");
  const lastReviewedAt = requireString(raw.lastReviewedAt, "$.lastReviewedAt");
  const nextReviewDue = requireString(raw.nextReviewDue, "$.nextReviewDue");
  if (raw.reviewCadence !== "quarterly") {
    throw new AdversarialCorpusValidationError(
      "expected reviewCadence=quarterly",
      "$.reviewCadence",
    );
  }
  const issueRef = requireString(raw.issueRef, "$.issueRef");
  const epicRef = requireString(raw.epicRef, "$.epicRef");
  if (!isPlainObject(raw.generatedBy)) {
    throw new AdversarialCorpusValidationError(
      "expected object",
      "$.generatedBy",
    );
  }
  const generatedBy = {
    model: requireString(raw.generatedBy.model, "$.generatedBy.model"),
    modelIssueRef: requireString(
      raw.generatedBy.modelIssueRef,
      "$.generatedBy.modelIssueRef",
    ),
    designTime: true as const,
    smeReviewed: true as const,
    smeReviewers: requireStringArray(
      raw.generatedBy.smeReviewers,
      "$.generatedBy.smeReviewers",
    ),
  };
  if (raw.generatedBy.designTime !== true) {
    throw new AdversarialCorpusValidationError(
      "expected designTime=true",
      "$.generatedBy.designTime",
    );
  }
  if (raw.generatedBy.smeReviewed !== true) {
    throw new AdversarialCorpusValidationError(
      "expected smeReviewed=true",
      "$.generatedBy.smeReviewed",
    );
  }
  if (!Array.isArray(raw.categories)) {
    throw new AdversarialCorpusValidationError(
      "expected array",
      "$.categories",
    );
  }
  const categories = raw.categories.map(
    (c, idx): AdversarialCorpusCategoryDefinition => {
      const cPath = `$.categories[${idx}]`;
      if (!isPlainObject(c)) {
        throw new AdversarialCorpusValidationError("expected object", cPath);
      }
      return {
        id: requireOneOf(
          c.id,
          `${cPath}.id`,
          ADVERSARIAL_CORPUS_CATEGORIES,
        ),
        title: requireString(c.title, `${cPath}.title`),
        description: requireString(c.description, `${cPath}.description`),
      };
    },
  );
  if (!Array.isArray(raw.entries)) {
    throw new AdversarialCorpusValidationError("expected array", "$.entries");
  }
  const entries = raw.entries.map(
    (e, idx): AdversarialCorpusEntry => validateEntry(e, `$.entries[${idx}]`),
  );
  return Object.freeze({
    schemaVersion: ADVERSARIAL_CORPUS_SCHEMA_VERSION,
    version,
    generatedAt,
    lastReviewedAt,
    nextReviewDue,
    reviewCadence: "quarterly" as const,
    issueRef,
    epicRef,
    generatedBy: Object.freeze(generatedBy),
    categories: Object.freeze(categories),
    entries: Object.freeze(entries),
  });
};

const requireStringArray = (
  value: unknown,
  path: string,
): ReadonlyArray<string> => {
  if (!Array.isArray(value)) {
    throw new AdversarialCorpusValidationError("expected array", path);
  }
  return value.map((v, idx) => requireString(v, `${path}[${idx}]`));
};

const validateEntry = (
  raw: unknown,
  path: string,
): AdversarialCorpusEntry => {
  if (!isPlainObject(raw)) {
    throw new AdversarialCorpusValidationError("expected object", path);
  }
  const id = requireString(raw.id, `${path}.id`);
  const category = requireOneOf(
    raw.category,
    `${path}.category`,
    ADVERSARIAL_CORPUS_CATEGORIES,
  );
  const title = requireString(raw.title, `${path}.title`);
  const payloadKind = requireOneOf(
    raw.payloadKind,
    `${path}.payloadKind`,
    ADVERSARIAL_CORPUS_PAYLOAD_KINDS,
  );
  const citation = requireString(raw.citation, `${path}.citation`);
  if (raw.payload === undefined) {
    throw new AdversarialCorpusValidationError(
      "expected payload",
      `${path}.payload`,
    );
  }
  const expectedOutcome = validateExpectedOutcome(
    raw.expectedOutcome,
    `${path}.expectedOutcome`,
    payloadKind,
  );
  const entry: AdversarialCorpusEntry = {
    id,
    category,
    title,
    payloadKind,
    payload: raw.payload,
    expectedOutcome,
    citation,
    ...(typeof raw.payloadRepeatBytes === "number"
      ? { payloadRepeatBytes: raw.payloadRepeatBytes }
      : {}),
    ...(typeof raw.payloadAdfTextRepeatBytes === "number"
      ? { payloadAdfTextRepeatBytes: raw.payloadAdfTextRepeatBytes }
      : {}),
  };
  return entry;
};

const validateExpectedOutcome = (
  raw: unknown,
  path: string,
  payloadKind: AdversarialCorpusPayloadKind,
): AdversarialCorpusExpectedOutcome => {
  if (!isPlainObject(raw)) {
    throw new AdversarialCorpusValidationError("expected object", path);
  }
  const surface = requireOneOf(raw.surface, `${path}.surface`, [
    "input",
    "output",
  ] as const);
  if (surface === "input") {
    if (payloadKind === "output-string") {
      throw new AdversarialCorpusValidationError(
        "input-side outcome incompatible with output-string payload",
        path,
      );
    }
    const outcome = requireOneOf(raw.outcome, `${path}.outcome`, [
      "ok",
      "needs_review",
    ] as const);
    if (!Array.isArray(raw.nonZeroCounts)) {
      throw new AdversarialCorpusValidationError(
        "expected array",
        `${path}.nonZeroCounts`,
      );
    }
    const nonZeroCounts = raw.nonZeroCounts.map(
      (k, i): AdversarialCorpusDropCountKey => {
        const s = requireString(k, `${path}.nonZeroCounts[${i}]`);
        if (!DROP_COUNT_KEYS.has(s as AdversarialCorpusDropCountKey)) {
          throw new AdversarialCorpusValidationError(
            `unknown drop-count key ${s}`,
            `${path}.nonZeroCounts[${i}]`,
          );
        }
        return s as AdversarialCorpusDropCountKey;
      },
    );
    if (nonZeroCounts.length === 0) {
      throw new AdversarialCorpusValidationError(
        "input-side outcome must list at least one nonZeroCounts key",
        `${path}.nonZeroCounts`,
      );
    }
    return { surface: "input", outcome, nonZeroCounts };
  }
  if (payloadKind !== "output-string") {
    throw new AdversarialCorpusValidationError(
      "output-side outcome requires payloadKind=output-string",
      path,
    );
  }
  const category = requireOneOf(
    raw.category,
    `${path}.category`,
    SEMANTIC_SUSPICION_CATEGORIES,
  );
  return { surface: "output", category };
};

// ---------------------------------------------------------------------------
// Gate runner
// ---------------------------------------------------------------------------

export interface AdversarialCorpusEntryFinding {
  readonly id: string;
  readonly category: AdversarialCorpusCategory;
  readonly reason: string;
}

export interface AdversarialCorpusGateReport {
  readonly schemaVersion: typeof ADVERSARIAL_CORPUS_SCHEMA_VERSION;
  readonly corpusVersion: string;
  readonly entryCount: number;
  readonly passCount: number;
  readonly failCount: number;
  readonly failures: ReadonlyArray<AdversarialCorpusEntryFinding>;
}

export const runAdversarialCorpusGate = (
  corpus: AdversarialCorpus,
): AdversarialCorpusGateReport => {
  const failures: AdversarialCorpusEntryFinding[] = [];
  for (const entry of corpus.entries) {
    const reason = checkEntry(entry);
    if (reason !== null) {
      failures.push({ id: entry.id, category: entry.category, reason });
    }
  }
  return {
    schemaVersion: ADVERSARIAL_CORPUS_SCHEMA_VERSION,
    corpusVersion: corpus.version,
    entryCount: corpus.entries.length,
    passCount: corpus.entries.length - failures.length,
    failCount: failures.length,
    failures,
  };
};

const checkEntry = (entry: AdversarialCorpusEntry): string | null => {
  if (entry.expectedOutcome.surface === "output") {
    return checkOutputEntry(entry, entry.expectedOutcome);
  }
  return checkInputEntry(entry, entry.expectedOutcome);
};

const checkOutputEntry = (
  entry: AdversarialCorpusEntry,
  expected: AdversarialCorpusOutputExpectedOutcome,
): string | null => {
  if (typeof entry.payload !== "string") {
    return "output-string payload must be a string";
  }
  const match = detectSuspiciousContent(entry.payload);
  if (match === null) {
    return `expected output category=${expected.category} but detector returned no match`;
  }
  if (match.category !== expected.category) {
    return `expected output category=${expected.category} but detector returned ${match.category}`;
  }
  return null;
};

const checkInputEntry = (
  entry: AdversarialCorpusEntry,
  expected: AdversarialCorpusInputExpectedOutcome,
): string | null => {
  let report: UntrustedContentNormalizationReport;
  try {
    report = runInputDefense(entry);
  } catch (err) {
    return `defense layer threw: ${(err as Error).message}`;
  }
  if (report.outcome !== expected.outcome) {
    return `expected outcome=${expected.outcome} but normalizer returned ${report.outcome}`;
  }
  for (const key of expected.nonZeroCounts) {
    if (report.counts[key] === 0) {
      return `expected counts.${key} > 0 but was 0`;
    }
  }
  return null;
};

const runInputDefense = (
  entry: AdversarialCorpusEntry,
): UntrustedContentNormalizationReport => {
  switch (entry.payloadKind) {
    case "markdown": {
      const markdown = inflateRepeat(asString(entry.payload), entry.payloadRepeatBytes);
      return normalizeUntrustedContent({ markdown }).report;
    }
    case "text-field": {
      const text = inflateRepeat(asString(entry.payload), entry.payloadRepeatBytes);
      return normalizeUntrustedContent({
        textFields: [{ id: entry.id, text }],
      }).report;
    }
    case "jira-adf": {
      const jiraAdf = applyAdfRepeat(
        asString(entry.payload),
        entry.payloadAdfTextRepeatBytes,
      );
      return normalizeUntrustedContent({ jiraAdf }).report;
    }
    case "figma-document": {
      return normalizeUntrustedContent({
        figma: { document: entry.payload },
      }).report;
    }
    case "output-string":
      throw new Error(
        "output-string payloadKind is not valid for input-side defense",
      );
  }
};

const asString = (payload: unknown): string => {
  if (typeof payload !== "string") {
    throw new Error("expected string payload");
  }
  return payload;
};

const inflateRepeat = (
  payload: string,
  targetBytes: number | undefined,
): string => {
  if (targetBytes === undefined) return payload;
  if (payload.length === 0) return "X".repeat(targetBytes);
  // Use a single ASCII char so byte count == char count regardless of the
  // payload's first character. Deterministic and fast.
  return "X".repeat(targetBytes);
};

const applyAdfRepeat = (
  payload: string,
  targetBytes: number | undefined,
): string => {
  if (targetBytes === undefined) return payload;
  return payload.replace("__REPEAT__", "X".repeat(targetBytes));
};

/**
 * Convenience wrapper: load + run the gate. Used by the CI test.
 */
export const loadAndRunAdversarialCorpusGate = async (
  input: LoadAdversarialCorpusInput = {},
): Promise<{
  corpus: AdversarialCorpus;
  report: AdversarialCorpusGateReport;
}> => {
  const corpus = await loadAdversarialCorpus(input);
  const report = runAdversarialCorpusGate(corpus);
  return { corpus, report };
};

/**
 * True when every required category has at least one entry. Used by the
 * shape test to assert the AC's category coverage is preserved through
 * future corpus edits.
 */
export const adversarialCorpusCoversAllRequiredCategories = (
  corpus: AdversarialCorpus,
): boolean => {
  const seen = new Set<AdversarialCorpusCategory>();
  for (const entry of corpus.entries) seen.add(entry.category);
  return ADVERSARIAL_CORPUS_CATEGORIES.every((c) => seen.has(c));
};

/**
 * Parse `lastReviewedAt`/`nextReviewDue` and return whether the next
 * review checkpoint has passed. Pure; no clock IO. The caller supplies
 * `today` so the test can assert behaviour deterministically.
 */
export const isAdversarialCorpusReviewOverdue = (
  corpus: AdversarialCorpus,
  today: Date,
): boolean => {
  const due = Date.parse(corpus.nextReviewDue);
  if (Number.isNaN(due)) return true;
  return due < today.getTime();
};
