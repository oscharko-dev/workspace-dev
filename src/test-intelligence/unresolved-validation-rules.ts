import type { GeneratedTestCase, TestDesignModel } from "../contracts/index.js";

const UNRESOLVED_VALIDATION_MARKERS: readonly RegExp[] = [
  /\btbd\b/i,
  /\bto be specified\b/i,
  /\bneeds? to be specified\b/i,
  /\bstill needs? to be specified\b/i,
  /\bnot yet specified\b/i,
  /\bunspecified\b/i,
  /\bnot specified\b/i,
  /\bto be defined\b/i,
  /\bto be clarified\b/i,
  /\bopen question\b/i,
  /\bsee policy\b/i,
  /\bask compliance\b/i,
  // Issue #2013 — German equivalents. The customer Jira stories are
  // authored in German and previously slipped past the English-only
  // markers, leaving validation gaps un-flagged as openQuestions.
  /\bnoch zu spezifizieren\b/i,
  /\bnoch nicht spezifiziert\b/i,
  /\bnicht spezifiziert\b/i,
  /\bnicht vollständig spezifiziert\b/i,
  /\bnoch zu definieren\b/i,
  /\bnoch zu klären\b/i,
  /\bzu klären\b/i,
  /\bfachlich zu klären\b/i,
  /\bist zu klären\b/i,
  /\bnoch unklar\b/i,
  /\bunklar(?:e|er|es|en)?\b/i,
  /\boffene\s+frage(?:n)?\b/i,
  /\bklärbedarf\b/i,
  /\bklärungsbedarf\b/i,
] as const;

const VALIDATION_TOPIC_MARKERS: readonly RegExp[] = [
  /\bvalidation\b/i,
  /\berror\b/i,
  /\bmessage\b/i,
  /\bamount\b/i,
  /\bvat\b/i,
  /\bselect(?:ion)?\b/i,
  /\bfield(?:s)?\b/i,
  /\bthreshold\b/i,
  /\blimit\b/i,
  /\bboundar(?:y|ies)\b/i,
  /\bminimum\b/i,
  /\bmaximum\b/i,
  /\bmin\b/i,
  /\bmax\b/i,
  /\bformat\b/i,
  // Issue #2013 — German topic markers. Mirrors the English vocabulary so
  // German source statements can pair with the unresolved markers above.
  /\bvalidierung(?:s\w*)?\b/i,
  /\bvalidierungsregel(?:n)?\b/i,
  /\bfehler(?:meldung(?:en)?)?\b/i,
  /\bnachricht(?:en)?\b/i,
  /\bbetrag(?:s\w*)?\b/i,
  /\bbeträge\b/i,
  /\bbetragsfeld(?:er)?\b/i,
  /\bmwst\.?\b/i,
  /\bmehrwertsteuer\b/i,
  /\bumsatzsteuer\b/i,
  /\bauswahl(?:feld)?\b/i,
  /\bfeld(?:er|s)?\b/i,
  /\bpflichtfeld(?:er)?\b/i,
  /\beingabe(?:feld(?:er)?)?\b/i,
  /\bgrenzwert(?:e)?\b/i,
  /\bschwellenwert(?:e)?\b/i,
  /\bmindest\w*\b/i,
  /\bhöchst\w*\b/i,
  /\bberechnung(?:s\w*)?\b/i,
  /\bvorbelegung\b/i,
  /\bfeldbezeichnung(?:en)?\b/i,
  /\bnetto\b/i,
  /\bbrutto\b/i,
  /\bfinanzierungsbedarf\b/i,
] as const;

const EXACT_VALIDATION_DETAIL_PATTERNS: readonly {
  pattern: RegExp;
  reason: string;
}[] = [
  {
    pattern: /\bis required\b/i,
    reason: "exact required-message expectation",
  },
  {
    pattern: /\bsubmit is blocked\b/i,
    reason: "exact blocking behavior expectation",
  },
  {
    pattern: /\binline validation error\b/i,
    reason: "exact validation-surface expectation",
  },
  {
    pattern: /\brejects? an empty\b/i,
    reason: "exact empty-input validation expectation",
  },
  {
    pattern: /\bleave .+ empty\b/i,
    reason: "exact empty-input validation expectation",
  },
  {
    pattern: /\bprovide an invalid\b/i,
    reason: "exact invalid-input validation expectation",
  },
  {
    pattern: /\bclear message\b/i,
    reason: "exact message-quality expectation",
  },
  {
    pattern: /\bminimum boundary value\b/i,
    reason: "invented minimum boundary",
  },
  {
    pattern: /\bmaximum boundary value\b/i,
    reason: "invented maximum boundary",
  },
  {
    pattern: /\bmin\/max boundar(?:y|ies)\b/i,
    reason: "invented min/max boundary behavior",
  },
  {
    pattern: /\bgreater than\b/i,
    reason: "invented numeric threshold",
  },
  {
    pattern: /\bless than\b/i,
    reason: "invented numeric threshold",
  },
  {
    pattern: /\bexceeds?(?: [\w-]+)? limit\b/i,
    reason: "invented maximum limit",
  },
] as const;

const NUMERIC_DETAIL_RE = /\b\d[\d.,]*(?:%|[A-Za-z]+)?\b/;

export const GENERIC_VALIDATION_EXPECTED_RESULT =
  "A validation response is shown according to the specified validation concept.";

export interface UnresolvedValidationConstraint {
  screenId?: string;
  fieldIds: string[];
  validationIds: string[];
  evidenceText: string;
}

export interface UnsupportedExactValidationClaim {
  path: string;
  message: string;
}

const normalizeText = (value: string): string =>
  value.normalize("NFKC").replace(/\s+/gu, " ").trim();

const uniqueSorted = (values: Iterable<string>): string[] =>
  [...new Set(values)]
    .map((value) => normalizeText(value))
    .filter((value) => value.length > 0)
    .sort((left, right) => left.localeCompare(right));

const includesAny = (value: string, patterns: readonly RegExp[]): boolean =>
  patterns.some((pattern) => pattern.test(value));

export const isUnresolvedValidationText = (value: string): boolean => {
  const normalized = normalizeText(value);
  if (normalized.length === 0) return false;
  return (
    includesAny(normalized, UNRESOLVED_VALIDATION_MARKERS) &&
    includesAny(normalized, VALIDATION_TOPIC_MARKERS)
  );
};

export const extractUnresolvedValidationStatements = (
  text: string,
): string[] => {
  const statements = normalizeText(text)
    .split(/(?:\n+|(?<=[.!?])\s+)/u)
    .map((statement) => statement.trim())
    .filter(
      (statement) =>
        statement.length > 0 && isUnresolvedValidationText(statement),
    );
  return uniqueSorted(statements);
};

export const buildSourceScopedValidationOpenQuestions = (input: {
  sourceLabel: string;
  text: string;
}): string[] => {
  return extractUnresolvedValidationStatements(input.text).map(
    (statement) => `${input.sourceLabel}: ${statement}`,
  );
};

const LABEL_TOKEN_RE = /[\p{L}\p{N}]+/giu;

// Issue #2013 — when an openQuestion paraphrases a field rather than quoting
// its exact label (e.g. mentions "Netto" rather than "Höhe des Kaufpreises
// (Netto)"), we still need to attribute it to the right screen so the
// downstream stabiliser injects the negative/clarification probe. Treat
// distinctive label tokens (length ≥ 4, not stop-words) as scope hints.
const SCOPE_TOKEN_STOPWORDS: ReadonlySet<string> = new Set([
  "des",
  "der",
  "die",
  "das",
  "den",
  "dem",
  "und",
  "oder",
  "the",
  "and",
  "with",
  "for",
  "von",
  "vom",
  "zum",
  "zur",
  "eine",
  "einer",
  "feld",
  "label",
  "input",
  "field",
]);

const distinctiveTokens = (value: string): string[] => {
  const tokens: string[] = [];
  for (const match of value.toLowerCase().matchAll(LABEL_TOKEN_RE)) {
    const token = match[0];
    if (token.length < 4) continue;
    if (SCOPE_TOKEN_STOPWORDS.has(token)) continue;
    tokens.push(token);
  }
  return tokens;
};

const STEM_PREFIX_LEN = 5;

const tokensShareStem = (left: string, right: string): boolean => {
  if (left === right) return true;
  const minLen = Math.min(left.length, right.length);
  if (minLen < STEM_PREFIX_LEN) return false;
  return left.slice(0, STEM_PREFIX_LEN) === right.slice(0, STEM_PREFIX_LEN);
};

const labelMatchesText = (
  textTokens: readonly string[],
  label: string,
): boolean => {
  const labelTokens = distinctiveTokens(label);
  if (labelTokens.length === 0) return false;
  for (const labelToken of labelTokens) {
    for (const textToken of textTokens) {
      if (tokensShareStem(labelToken, textToken)) return true;
    }
  }
  return false;
};

const collectFieldIdsForText = (
  text: string,
  model: TestDesignModel,
): { fieldIds: string[]; validationIds: string[]; screenId?: string } => {
  const normalized = text.toLowerCase();
  const textTokens = distinctiveTokens(text);
  const fieldIds = new Set<string>();
  const validationIds = new Set<string>();
  let screenId: string | undefined;

  for (const screen of model.screens) {
    if (
      normalized.includes(screen.screenId.toLowerCase()) ||
      normalized.includes(screen.name.toLowerCase()) ||
      labelMatchesText(textTokens, screen.name)
    ) {
      screenId = screen.screenId;
    }
    for (const element of screen.elements ?? []) {
      const labelLower = element.label.toLowerCase();
      const matched =
        (labelLower.length > 0 && normalized.includes(labelLower)) ||
        labelMatchesText(textTokens, element.label);
      if (matched) {
        fieldIds.add(element.elementId);
        screenId ??= screen.screenId;
      }
    }
    for (const validation of screen.validations ?? []) {
      if (normalized.includes(validation.rule.toLowerCase())) {
        validationIds.add(validation.validationId);
        screenId ??= screen.screenId;
      }
    }
  }

  return {
    fieldIds: [...fieldIds].sort(),
    validationIds: [...validationIds].sort(),
    ...(screenId !== undefined ? { screenId } : {}),
  };
};

export const deriveUnresolvedValidationConstraints = (
  model: TestDesignModel,
): UnresolvedValidationConstraint[] => {
  const constraints: UnresolvedValidationConstraint[] = [];

  for (const screen of model.screens) {
    for (const validation of screen.validations ?? []) {
      if (!isUnresolvedValidationText(validation.rule)) continue;
      constraints.push({
        screenId: screen.screenId,
        fieldIds:
          validation.targetElementId !== undefined
            ? [validation.targetElementId]
            : [],
        validationIds: [validation.validationId],
        evidenceText: validation.rule,
      });
    }
  }

  for (const question of model.openQuestions ?? []) {
    if (!isUnresolvedValidationText(question.text)) continue;
    const scope = collectFieldIdsForText(question.text, model);
    if (
      scope.screenId === undefined &&
      scope.fieldIds.length === 0 &&
      scope.validationIds.length === 0
    ) {
      continue;
    }
    constraints.push({
      ...(scope.screenId !== undefined ? { screenId: scope.screenId } : {}),
      fieldIds: scope.fieldIds,
      validationIds: scope.validationIds,
      evidenceText: question.text,
    });
  }

  return constraints.sort((left, right) =>
    left.evidenceText.localeCompare(right.evidenceText),
  );
};

/**
 * Issue #2013 — like {@link deriveUnresolvedValidationConstraints} but with
 * a soft fallback: when the model has openQuestions that match the
 * unresolved/topic vocabulary yet name no specific field, validation, or
 * screen, anchor them to the first screen anyway. The result is intended
 * for probe-injection callers that just need *somewhere* to attach a
 * clarification probe; the strict variant remains the source of truth for
 * "case X violates an unresolved rule for field Y" detection so generic
 * notes never cross-block unrelated specified validations.
 */
export const deriveUnresolvedValidationConstraintsWithScreenFallback = (
  model: TestDesignModel,
): UnresolvedValidationConstraint[] => {
  const scoped = deriveUnresolvedValidationConstraints(model);
  const fallbackScreenId = model.screens[0]?.screenId;
  if (fallbackScreenId === undefined) return scoped;

  const seenEvidence = new Set(scoped.map((entry) => entry.evidenceText));
  const augmented: UnresolvedValidationConstraint[] = [...scoped];
  for (const question of model.openQuestions ?? []) {
    if (!isUnresolvedValidationText(question.text)) continue;
    if (seenEvidence.has(question.text)) continue;
    augmented.push({
      screenId: fallbackScreenId,
      fieldIds: [],
      validationIds: [],
      evidenceText: question.text,
    });
    seenEvidence.add(question.text);
  }

  return augmented.sort((left, right) =>
    left.evidenceText.localeCompare(right.evidenceText),
  );
};

const testCaseTouchesConstraint = (
  testCase: GeneratedTestCase,
  constraint: UnresolvedValidationConstraint,
): boolean => {
  if (
    constraint.fieldIds.some((fieldId) =>
      testCase.qualitySignals.coveredFieldIds.includes(fieldId),
    )
  ) {
    return true;
  }
  if (
    constraint.validationIds.some((validationId) =>
      testCase.qualitySignals.coveredValidationIds.includes(validationId),
    )
  ) {
    return true;
  }
  if (
    constraint.screenId !== undefined &&
    testCase.figmaTraceRefs.some(
      (trace) => trace.screenId === constraint.screenId,
    )
  ) {
    return true;
  }
  return false;
};

const findExactValidationReason = (text: string): string | undefined => {
  for (const candidate of EXACT_VALIDATION_DETAIL_PATTERNS) {
    if (candidate.pattern.test(text)) {
      return candidate.reason;
    }
  }
  if (
    NUMERIC_DETAIL_RE.test(text) &&
    includesAny(text, VALIDATION_TOPIC_MARKERS)
  ) {
    return "invented numeric example or threshold";
  }
  return undefined;
};

const collectClaimTexts = (
  testCase: GeneratedTestCase,
): Array<{ path: string; text: string }> => {
  const claims: Array<{ path: string; text: string }> = [
    { path: "title", text: testCase.title },
    { path: "objective", text: testCase.objective },
  ];
  for (let index = 0; index < testCase.testData.length; index += 1) {
    claims.push({
      path: `testData[${index}]`,
      text: testCase.testData[index] ?? "",
    });
  }
  for (let index = 0; index < testCase.expectedResults.length; index += 1) {
    claims.push({
      path: `expectedResults[${index}]`,
      text: testCase.expectedResults[index] ?? "",
    });
  }
  for (let index = 0; index < testCase.steps.length; index += 1) {
    const step = testCase.steps[index];
    if (step === undefined) continue;
    claims.push({
      path: `steps[${index}].action`,
      text: step.action,
    });
    if (step.expected !== undefined) {
      claims.push({
        path: `steps[${index}].expected`,
        text: step.expected,
      });
    }
  }
  return claims;
};

export const detectUnsupportedExactValidationClaim = (input: {
  testCase: GeneratedTestCase;
  model: TestDesignModel;
}): UnsupportedExactValidationClaim | undefined => {
  const constraints = deriveUnresolvedValidationConstraints(input.model).filter(
    (constraint) => testCaseTouchesConstraint(input.testCase, constraint),
  );
  if (constraints.length === 0) return undefined;

  for (const claim of collectClaimTexts(input.testCase)) {
    const reason = findExactValidationReason(claim.text);
    if (reason === undefined) continue;
    const evidence =
      constraints[0]?.evidenceText ?? "unspecified validation rule";
    return {
      path: claim.path,
      message:
        `${reason} is unsupported while the source marks validation behavior as unresolved: ` +
        `"${truncateEvidence(evidence)}"`,
    };
  }

  return undefined;
};

const truncateEvidence = (value: string): string =>
  value.length <= 140 ? value : `${value.slice(0, 137)}...`;
