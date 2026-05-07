import type {
  GeneratedTestCase,
  TestDesignModel,
} from "../contracts/index.js";

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
  value
    .normalize("NFKC")
    .replace(/\s+/gu, " ")
    .trim();

const uniqueSorted = (values: Iterable<string>): string[] =>
  [...new Set(values)]
    .map((value) => normalizeText(value))
    .filter((value) => value.length > 0)
    .sort((left, right) => left.localeCompare(right));

const includesAny = (
  value: string,
  patterns: readonly RegExp[],
): boolean => patterns.some((pattern) => pattern.test(value));

export const isUnresolvedValidationText = (value: string): boolean => {
  const normalized = normalizeText(value);
  if (normalized.length === 0) return false;
  return (
    includesAny(normalized, UNRESOLVED_VALIDATION_MARKERS) &&
    includesAny(normalized, VALIDATION_TOPIC_MARKERS)
  );
};

export const extractUnresolvedValidationStatements = (text: string): string[] => {
  const statements = normalizeText(text)
    .split(/(?:\n+|(?<=[.!?])\s+)/u)
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0 && isUnresolvedValidationText(statement));
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

const collectFieldIdsForText = (
  text: string,
  model: TestDesignModel,
): { fieldIds: string[]; validationIds: string[]; screenId?: string } => {
  const normalized = text.toLowerCase();
  const fieldIds = new Set<string>();
  const validationIds = new Set<string>();
  let screenId: string | undefined;

  for (const screen of model.screens) {
    if (
      normalized.includes(screen.screenId.toLowerCase()) ||
      normalized.includes(screen.name.toLowerCase())
    ) {
      screenId = screen.screenId;
    }
    for (const element of screen.elements) {
      if (normalized.includes(element.label.toLowerCase())) {
        fieldIds.add(element.elementId);
        screenId ??= screen.screenId;
      }
    }
    for (const validation of screen.validations) {
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
    for (const validation of screen.validations) {
      if (!isUnresolvedValidationText(validation.rule)) continue;
      constraints.push({
        screenId: screen.screenId,
        fieldIds:
          validation.targetElementId !== undefined ? [validation.targetElementId] : [],
        validationIds: [validation.validationId],
        evidenceText: validation.rule,
      });
    }
  }

  for (const question of model.openQuestions) {
    if (!isUnresolvedValidationText(question.text)) continue;
    const scope = collectFieldIdsForText(question.text, model);
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
    testCase.figmaTraceRefs.some((trace) => trace.screenId === constraint.screenId)
  ) {
    return true;
  }
  return constraint.fieldIds.length === 0 && constraint.validationIds.length === 0;
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
    const evidence = constraints[0]?.evidenceText ?? "unspecified validation rule";
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
