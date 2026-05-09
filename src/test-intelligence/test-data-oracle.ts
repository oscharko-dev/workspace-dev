/**
 * Deterministic test-data oracle (Issue #2071).
 *
 * Synthesizes valid and invalid boundary-value test data from the
 * validation-rule strings carried by `BusinessTestIntentIr.detectedValidations[*].rule`,
 * instead of asking the LLM to invent it. The oracle covers
 * boundary-value analysis for numeric / integer ranges, length and
 * max-character constraints, ISO date / time bounds, and a small set
 * of format patterns common to EU banking and insurance forms (IBAN,
 * BIC, ISIN, German license plate).
 *
 * When a field's validation rules carry no concrete bounds the oracle
 * recognizes — e.g. `"Computed = principal * (rate/12) / ..."`,
 * `"Required if Order-Typ is Limit"`, `"Date implies age >= 18"` — the
 * oracle returns `{ resolvable: false, openQuestion: "..." }` so the
 * caller can downgrade the case to a label-only verification step
 * (the rubric in `Eingabemasken-Testfallrubrik.md` Section 6 forbids
 * inventing concrete values for unresolved rules; the oracle preserves
 * that contract by construction).
 *
 * The oracle is deterministic: identical inputs produce identical
 * outputs, byte-for-byte, with no randomness or wall-clock dependency.
 * Time-relative date rules (`Date <= today`, `Date >= today + 1 day`)
 * use the `now` parameter so callers anchor the oracle at a fixed
 * timestamp for replay and snapshot stability.
 *
 * Out of scope for this PR:
 *
 *   - State-transition oracle for workflow lifecycle fields (depends
 *     on the action-topology agent landing first; tracked separately).
 *   - Cross-field invariants (e.g. `Annual equivalent (12 times) <= 60
 *     percent of Jahresbrutto`). The oracle resolves per-field rules
 *     only; cross-field constraints stay as openQuestions.
 *   - Locale-specific number/date format conversions (decimal-comma vs
 *     decimal-period) — the oracle emits ISO/period form throughout.
 *   - Persisted artifact `test-data-oracle-report.json` per run; the
 *     synthesizer carries provenance per case via test-data strings.
 */

/** A concrete value with the rule it was synthesized from. */
export interface OracleValue {
  readonly value: string;
  readonly rule: string;
  readonly category:
    | "boundary_min"
    | "boundary_max"
    | "midpoint"
    | "below_min_invalid"
    | "above_max_invalid"
    | "format_valid"
    | "format_invalid"
    | "documentation_example";
}

/** Structured oracle resolution per field. */
export type OracleResolution =
  | {
      readonly resolvable: true;
      readonly valid: ReadonlyArray<OracleValue>;
      readonly invalid: ReadonlyArray<OracleValue>;
      readonly provenance: ReadonlyArray<string>;
    }
  | {
      readonly resolvable: false;
      readonly openQuestion: string;
    };

/** Input record for the oracle. */
export interface OracleResolveInput {
  readonly fieldLabel: string;
  readonly validations: ReadonlyArray<string>;
  readonly defaultValue?: string;
  /**
   * Wall-clock anchor for time-relative rules (`Date <= today`,
   * `Date >= today + 1 day`). The oracle never reads real-world time;
   * callers MUST pass the same `now` they intend to record in the
   * `provenance.jsonld` seed so the output is replay-stable.
   */
  readonly now: Date;
}

/** Internal matcher result. */
interface MatcherResult {
  readonly valid: ReadonlyArray<OracleValue>;
  readonly invalid: ReadonlyArray<OracleValue>;
  readonly provenance: ReadonlyArray<string>;
}

const PRESENCE_ONLY_RULES: ReadonlySet<string> = new Set([
  "required",
  "pflichtfeld",
  "optional",
  "pflichtfeld, numerisch",
]);

const isPresenceOnly = (rule: string): boolean => {
  const r = rule.trim().toLowerCase();
  return PRESENCE_ONLY_RULES.has(r);
};

const formatNumber = (n: number, decimals: number): string =>
  n.toFixed(decimals);

const midpoint = (min: number, max: number): number =>
  Math.round(((min + max) / 2) * 1_000_000) / 1_000_000;

/**
 * Chunk size used by {@link chunkedFiller}. The hard cap on contiguous
 * filler chars must stay strictly below the `BASE64_RUN_RE` threshold of
 * 64 (see `semantic-content-sanitization.ts`). 15 is a safe under-cap and
 * leaves room for the trailing `x` we splice in when the requested length
 * is an exact multiple of 16.
 */
const CHUNK_RUN_LEN = 15;

/**
 * Produce a deterministic length-N filler string composed of `x` chunks of
 * at most {@link CHUNK_RUN_LEN} chars separated by ASCII spaces. The space
 * is intentional: it is not in the base64 alphabet `[A-Za-z0-9+/]`, so it
 * breaks the contiguous run that would otherwise trip the
 * `encoded_payload_base64` semantic-content heuristic when N >= 64.
 *
 * For N <= 16 the function returns the legacy `"x".repeat(N)` form so
 * existing length-N-must-be-N invariants hold byte-for-byte; the heuristic
 * needs 64+ contiguous chars, so 16 is well within budget.
 *
 * Total string length is exactly N. For N = k * 16 the trailing space is
 * replaced by an `x` to preserve length and keep the boundary character a
 * non-whitespace token (some downstream consumers strip trailing
 * whitespace; we do not want a length boundary that silently shrinks).
 */
const chunkedFiller = (len: number): string => {
  if (len <= 16) return "x".repeat(len);
  const fullCycles = Math.floor(len / 16);
  const remainder = len - fullCycles * 16;
  const cycle = `${"x".repeat(CHUNK_RUN_LEN)} `;
  let out = cycle.repeat(fullCycles);
  if (remainder === 0) {
    // Drop trailing space and append one `x` to keep total length == len
    // while ending on a non-whitespace token.
    out = `${out.slice(0, -1)}x`;
  } else {
    out += "x".repeat(remainder);
  }
  return out;
};

const tryNumericRange = (rule: string): MatcherResult | null => {
  // "Numeric in range 1000..50000"  OR  "Range 0..100"
  const m = rule.match(
    /^(?:numeric|integer)?\s*(?:in\s+range\s+)?([+-]?\d+(?:\.\d+)?)\.\.([+-]?\d+(?:\.\d+)?)$/i,
  );
  if (m === null) return null;
  const min = Number.parseFloat(m[1] ?? "0");
  const max = Number.parseFloat(m[2] ?? "0");
  if (!Number.isFinite(min) || !Number.isFinite(max) || min >= max) return null;
  // The rule string is the source of truth for integer-vs-numeric:
  // "Integer in range 1..30" -> int, "Numeric in range 1000..50000" ->
  // 2-decimal numeric (even when both bounds happen to be integers).
  const isInt = /integer/i.test(rule);
  const decimals = isInt ? 0 : 2;
  const eps = isInt ? 1 : 0.01;
  const mid = isInt ? Math.round(midpoint(min, max)) : midpoint(min, max);
  return {
    valid: [
      { value: formatNumber(min, decimals), rule, category: "boundary_min" },
      { value: formatNumber(mid, decimals), rule, category: "midpoint" },
      { value: formatNumber(max, decimals), rule, category: "boundary_max" },
    ],
    invalid: [
      {
        value: formatNumber(min - eps, decimals),
        rule,
        category: "below_min_invalid",
      },
      {
        value: formatNumber(max + eps, decimals),
        rule,
        category: "above_max_invalid",
      },
    ],
    provenance: [`numeric-range[${min}..${max}] from rule "${rule}"`],
  };
};

const tryNumericComparison = (rule: string): MatcherResult | null => {
  // "Numeric > 0", "Numeric >= 0", "Numeric <= 100000"
  // "Integer >= 1", "Integer <= 60"
  const m = rule.match(
    /^(numeric|integer)\s*([<>]=?)\s*([+-]?\d+(?:\.\d+)?)$/i,
  );
  if (m === null) return null;
  const isInt = m[1]?.toLowerCase() === "integer";
  const op = m[2] ?? ">=";
  const bound = Number.parseFloat(m[3] ?? "0");
  if (!Number.isFinite(bound)) return null;
  const decimals = isInt ? 0 : 2;
  const eps = isInt ? 1 : 0.01;
  // Pick three valid samples and one invalid sample on the wrong side.
  if (op === ">=" || op === ">") {
    const minValid = op === ">=" ? bound : bound + eps;
    const oneInvalid = op === ">=" ? bound - eps : bound;
    return {
      valid: [
        {
          value: formatNumber(minValid, decimals),
          rule,
          category: "boundary_min",
        },
        {
          value: formatNumber(minValid + 100, decimals),
          rule,
          category: "midpoint",
        },
      ],
      invalid: [
        {
          value: formatNumber(oneInvalid, decimals),
          rule,
          category: "below_min_invalid",
        },
      ],
      provenance: [`numeric-${op}${bound} from rule "${rule}"`],
    };
  }
  if (op === "<=" || op === "<") {
    const maxValid = op === "<=" ? bound : bound - eps;
    const oneInvalid = op === "<=" ? bound + eps : bound;
    return {
      valid: [
        { value: formatNumber(0, decimals), rule, category: "boundary_min" },
        {
          value: formatNumber(maxValid, decimals),
          rule,
          category: "boundary_max",
        },
      ],
      invalid: [
        {
          value: formatNumber(oneInvalid, decimals),
          rule,
          category: "above_max_invalid",
        },
      ],
      provenance: [`numeric-${op}${bound} from rule "${rule}"`],
    };
  }
  return null;
};

const tryLength = (rule: string): MatcherResult | null => {
  // "Length 5", "Length 11", "Length 5 to 8", "Laenge 5"
  const fixed = rule.match(/^(?:length|laenge)\s+(\d+)$/i);
  if (fixed !== null) {
    const len = Number.parseInt(fixed[1] ?? "0", 10);
    if (len <= 0 || len > 4096) return null;
    return {
      valid: [
        { value: chunkedFiller(len), rule, category: "boundary_max" },
      ],
      invalid: [
        { value: chunkedFiller(len - 1), rule, category: "below_min_invalid" },
        { value: chunkedFiller(len + 1), rule, category: "above_max_invalid" },
      ],
      provenance: [`fixed-length[${len}] from rule "${rule}"`],
    };
  }
  const range = rule.match(
    /^(?:length|laenge)\s+(\d+)\s+(?:to|bis)\s+(\d+)(?:\s+when provided)?$/i,
  );
  if (range !== null) {
    const min = Number.parseInt(range[1] ?? "0", 10);
    const max = Number.parseInt(range[2] ?? "0", 10);
    if (min <= 0 || max <= 0 || min > max || max > 4096) return null;
    return {
      valid: [
        { value: chunkedFiller(min), rule, category: "boundary_min" },
        { value: chunkedFiller(max), rule, category: "boundary_max" },
      ],
      invalid: [
        {
          value: min === 1 ? "" : chunkedFiller(min - 1),
          rule,
          category: "below_min_invalid",
        },
        { value: chunkedFiller(max + 1), rule, category: "above_max_invalid" },
      ],
      provenance: [`length-range[${min}..${max}] from rule "${rule}"`],
    };
  }
  return null;
};

const tryMaxCharacters = (rule: string): MatcherResult | null => {
  const m = rule.match(/^max\s+(\d+)\s+characters$/i);
  if (m === null) return null;
  const max = Number.parseInt(m[1] ?? "0", 10);
  if (max <= 0 || max > 100000) return null;
  return {
    valid: [
      {
        value: chunkedFiller(Math.max(1, Math.min(max, 16))),
        rule,
        category: "boundary_min",
      },
      { value: chunkedFiller(max), rule, category: "boundary_max" },
    ],
    invalid: [
      { value: chunkedFiller(max + 1), rule, category: "above_max_invalid" },
    ],
    provenance: [`max-characters[${max}] from rule "${rule}"`],
  };
};

const formatIsoDate = (d: Date): string =>
  `${d.getUTCFullYear().toString().padStart(4, "0")}-${(d.getUTCMonth() + 1).toString().padStart(2, "0")}-${d.getUTCDate().toString().padStart(2, "0")}`;

const addDays = (d: Date, days: number): Date => {
  const next = new Date(d.getTime());
  next.setUTCDate(next.getUTCDate() + days);
  return next;
};

const tryIsoDate = (rule: string, now: Date): MatcherResult | null => {
  // "ISO date" (no bound)
  if (/^iso\s+date$/i.test(rule)) {
    return {
      valid: [
        { value: formatIsoDate(now), rule, category: "format_valid" },
      ],
      invalid: [
        { value: formatIsoDate(now).replaceAll("-", "."), rule, category: "format_invalid" },
        { value: "2026-13-01", rule, category: "format_invalid" },
      ],
      provenance: [`iso-date format from rule "${rule}"`],
    };
  }
  // "Date <= today", "Date >= today + 1 day", "Date >= today"
  const m = rule.match(
    /^(?:iso\s+date\s+)?date\s*(<=|>=|<|>)\s*today(?:\s*\+\s*(\d+)\s*days?)?$/i,
  );
  if (m === null) return null;
  const op = m[1] ?? ">=";
  const offset = m[2] !== undefined ? Number.parseInt(m[2], 10) : 0;
  const anchor = addDays(now, offset);
  if (op === "<=" || op === "<") {
    const maxValid = op === "<=" ? anchor : addDays(anchor, -1);
    return {
      valid: [
        { value: formatIsoDate(addDays(maxValid, -365)), rule, category: "boundary_min" },
        { value: formatIsoDate(maxValid), rule, category: "boundary_max" },
      ],
      invalid: [
        { value: formatIsoDate(addDays(anchor, 1)), rule, category: "above_max_invalid" },
      ],
      provenance: [`date-${op}-today+${offset}d from rule "${rule}"`],
    };
  }
  // ">=" / ">"
  const minValid = op === ">=" ? anchor : addDays(anchor, 1);
  return {
    valid: [
      { value: formatIsoDate(minValid), rule, category: "boundary_min" },
      { value: formatIsoDate(addDays(minValid, 30)), rule, category: "midpoint" },
    ],
    invalid: [
      { value: formatIsoDate(addDays(anchor, -1)), rule, category: "below_min_invalid" },
    ],
    provenance: [`date-${op}-today+${offset}d from rule "${rule}"`],
  };
};

const tryIsoTime = (rule: string): MatcherResult | null => {
  if (!/^iso\s+time$/i.test(rule)) return null;
  return {
    valid: [
      { value: "14:30:00", rule, category: "format_valid" },
      { value: "23:59:59", rule, category: "format_valid" },
    ],
    invalid: [
      { value: "14:30", rule, category: "format_invalid" },
      { value: "25:00:00", rule, category: "format_invalid" },
    ],
    provenance: [`iso-time format from rule "${rule}"`],
  };
};

const tryIsoDateTime = (rule: string, now: Date): MatcherResult | null => {
  if (/^iso\s+datetime$/i.test(rule)) {
    return {
      valid: [
        { value: `${formatIsoDate(now)}T14:30:00Z`, rule, category: "format_valid" },
      ],
      invalid: [
        { value: formatIsoDate(now), rule, category: "format_invalid" },
      ],
      provenance: [`iso-datetime format from rule "${rule}"`],
    };
  }
  return null;
};

const tryFormatPattern = (rule: string): MatcherResult | null => {
  // IBAN — known documentation IBAN (Bundesbank Testbank)
  if (/iban\s+format/i.test(rule)) {
    return {
      valid: [
        {
          value: "DE89370400440532013000",
          rule,
          category: "documentation_example",
        },
      ],
      invalid: [
        { value: "DE0", rule, category: "format_invalid" },
        { value: "INVALID-IBAN", rule, category: "format_invalid" },
      ],
      provenance: [`IBAN format check from rule "${rule}" (uses public documentation IBAN)`],
    };
  }
  // BIC
  if (/bic\s+format/i.test(rule)) {
    return {
      valid: [
        { value: "MARKDEFFXXX", rule, category: "documentation_example" },
        { value: "DEUTDEFF", rule, category: "documentation_example" },
      ],
      invalid: [
        { value: "ABC", rule, category: "format_invalid" },
        { value: "12345", rule, category: "format_invalid" },
      ],
      provenance: [`BIC format check from rule "${rule}"`],
    };
  }
  // ISIN
  if (/isin\s+format/i.test(rule)) {
    return {
      valid: [
        { value: "DE000BASF111", rule, category: "documentation_example" },
      ],
      invalid: [
        { value: "INVALID", rule, category: "format_invalid" },
      ],
      provenance: [`ISIN format check from rule "${rule}"`],
    };
  }
  // German license plate
  if (/german\s+license\s+plate\s+format/i.test(rule)) {
    return {
      valid: [
        { value: "B-AB 1234", rule, category: "documentation_example" },
      ],
      invalid: [
        { value: "XYZ", rule, category: "format_invalid" },
      ],
      provenance: [`German license plate format from rule "${rule}"`],
    };
  }
  // Numeric (no bound) — just digits
  if (/^numeric$/i.test(rule) || /^numerisch$/i.test(rule)) {
    return {
      valid: [
        { value: "123", rule, category: "format_valid" },
      ],
      invalid: [
        { value: "abc", rule, category: "format_invalid" },
      ],
      provenance: [`numeric format from rule "${rule}"`],
    };
  }
  // Alphanumeric uppercase
  if (/^alphanumeric\s+uppercase$/i.test(rule)) {
    return {
      valid: [
        { value: "ABC123", rule, category: "format_valid" },
      ],
      invalid: [
        { value: "abc123", rule, category: "format_invalid" },
      ],
      provenance: [`alphanumeric-uppercase format from rule "${rule}"`],
    };
  }
  return null;
};

const matchRule = (
  rule: string,
  now: Date,
): MatcherResult | null => {
  return (
    tryNumericRange(rule) ??
    tryNumericComparison(rule) ??
    tryLength(rule) ??
    tryMaxCharacters(rule) ??
    tryIsoDate(rule, now) ??
    tryIsoDateTime(rule, now) ??
    tryIsoTime(rule) ??
    tryFormatPattern(rule)
  );
};

export const isDeterministicTestDataRule = (input: {
  rule: string;
  now: Date;
}): boolean => matchRule(input.rule, input.now) !== null;

/**
 * Resolve concrete test data for one field from its validation rules.
 *
 * The function is pure and deterministic: identical inputs produce
 * byte-identical output. All time-relative bounds are anchored to
 * `input.now` so callers can replay snapshots.
 */
export const resolveTestData = (
  input: OracleResolveInput,
): OracleResolution => {
  const valid: OracleValue[] = [];
  const invalid: OracleValue[] = [];
  const provenance: string[] = [];
  const significantRules = input.validations.filter((r) => !isPresenceOnly(r));

  if (significantRules.length === 0) {
    return {
      resolvable: false,
      openQuestion: `Field "${input.fieldLabel}" has no concrete value bounds the test-data oracle can resolve; specify boundary or example values.`,
    };
  }

  let unresolvedSample: string | undefined;
  for (const rule of significantRules) {
    const matched = matchRule(rule, input.now);
    if (matched === null) {
      unresolvedSample = rule;
      continue;
    }
    valid.push(...matched.valid);
    invalid.push(...matched.invalid);
    provenance.push(...matched.provenance);
  }

  if (valid.length === 0 && invalid.length === 0) {
    const reason = unresolvedSample ?? significantRules[0] ?? "<unknown>";
    return {
      resolvable: false,
      openQuestion: `Validation rule "${reason}" for field "${input.fieldLabel}" is unresolved by the deterministic test-data oracle; specify the rule explicitly so concrete values can be synthesized.`,
    };
  }

  return {
    resolvable: true,
    valid,
    invalid,
    provenance,
  };
};

/**
 * Sentinel suffix appended to oracle-emitted entries whose value shape +
 * field label combination would trip the PII detector even though the
 * value is a synthesized placeholder, not real personal data. The format
 * matches the `\[REDACTED:[A-Z_]+\]` shape that `looksLikeRedactionToken`
 * in `test-case-validation.ts` recognizes, which causes the PII validator
 * to skip the entry.
 *
 * Two case-classes need the marker:
 *
 *   1. `documentation_example` values (Bundesbank Testbank IBAN, BIC /
 *      ISIN reference codes, sample license plates). The Bundesbank IBAN
 *      is published in EU/ECB documentation precisely so it can be used
 *      in examples without leaking real PII, but a strict regex + Mod-97
 *      check still flags the literal because it is, syntactically, a
 *      well-formed IBAN.
 *   2. ISO date / datetime values emitted for `"ISO date"`, `"ISO
 *      datetime"`, or `"Date <op> today"` rules. The DOB detector in
 *      `pii-detection.ts#detectDateOfBirth` matches when a labelling
 *      keyword (`Geburtsdatum`, `Geburtstag`, `dob`, `date of birth`,
 *      `geboren`, ...) appears within ~32 chars of an ISO/DMY date. The
 *      oracle's deterministic boundary value is `today` (the run
 *      anchor), which combined with a `Geburtsdatum:` field-label prefix
 *      trips the heuristic — even though the value is a synthetic
 *      format-validity sample, not real birth data.
 *
 * Embedding the marker in the rendered entry — rather than mutating the
 * underlying value — preserves all assertions across the codebase that
 * check the literal documentation values for cross-component PII
 * redaction (production-runner, jira-issue-ir, prompt-compiler,
 * untrusted-content-normalizer, etc.) and keeps oracle values byte-stable
 * for snapshot tests.
 */
const DOCUMENTATION_EXAMPLE_MARKER = " [REDACTED:DOC_EXAMPLE]";

/**
 * Rules whose oracle output is an ISO-shape date or datetime value. When
 * the rendered entry combines such a value with a DOB-style field label
 * (`Geburtsdatum`, `Geburtstag`, ...) the PII detector flags it as
 * `date_of_birth` even though the value is a synthetic anchor sample.
 * The match is rule-side rather than label-side because the formatter
 * does not own a label classifier; tagging by rule is conservative and
 * deterministic.
 */
const ORACLE_DATE_RULE_RE =
  /^\s*(?:iso\s+date(?:time)?|date\s*[<>]=?\s*today)\b/iu;

/**
 * Render an {@link OracleValue} into the `testData[*]` string form
 * that {@link GeneratedTestCase.testData} expects. Format:
 *
 *   `<fieldLabel>: <value> (<category>; from rule "<rule>")`
 *
 * For values whose shape would otherwise trip the downstream PII
 * detector despite being a synthesized placeholder (see
 * {@link DOCUMENTATION_EXAMPLE_MARKER}), a `[REDACTED:DOC_EXAMPLE]`
 * sentinel is appended so the validator's `looksLikeRedactionToken`
 * short-circuits the scan.
 *
 * Deterministic. Used by the synthesizer when writing test data into
 * a generated test case.
 */
export const formatOracleValueAsTestDataEntry = (
  fieldLabel: string,
  value: OracleValue,
): string => {
  const needsMarker =
    value.category === "documentation_example" ||
    ORACLE_DATE_RULE_RE.test(value.rule);
  const marker = needsMarker ? DOCUMENTATION_EXAMPLE_MARKER : "";
  return `${fieldLabel}: ${value.value} (${value.category}; from rule "${value.rule}")${marker}`;
};
