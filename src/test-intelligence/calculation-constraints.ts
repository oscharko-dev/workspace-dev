import type {
  GeneratedTestCase,
  TestDesignCalculationConstraint,
  TestDesignModel,
} from "../contracts/index.js";

const FINANCING_NEED_RE =
  /\b(financing need|finance need|loan amount|funding need|finanzierungsbedarf(?:es|s|e)?)\b/i;
const VAT_RE =
  /\b(vat|value added tax|mwst\.?|mehrwertsteuer(?:n|s)?|umsatzsteuer(?:n|s)?)\b/i;
// Issue #2013 — exclusion/inclusion vocabulary now covers German Jira phrasing
// such as "Die MwSt. ist nicht Teil des Finanzierungsbedarfs." so the
// calculation constraint detector keeps working on German source material.
const EXCLUSION_RE =
  /\b(not part of|is not part of|isn't part of|excluded from|must not be part of|must not be included|without|nicht teil|kein bestandteil|nicht enthalten|ausgenommen|ohne)\b/i;
const INCLUSION_RE =
  /\b(part of|included in|must be included|including vat|plus vat|teil von|teil des|enthält|enthalten|inklusive|zuzüglich|plus mwst|plus umsatzsteuer)\b/i;
const UNRESOLVED_RE =
  /\b(tbd|to be defined|to be specified|unspecified|unclear|open question|unknown|noch zu spezifizieren|noch nicht spezifiziert|nicht spezifiziert|nicht vollständig spezifiziert|noch zu definieren|noch zu klären|fachlich zu klären|ist zu klären|noch unklar|unklar|offene frage|klärbedarf|klärungsbedarf)\b/i;
const VAT_FORMULA_RE =
  /\bvat\b.*(?:\+|plus|included)|(?:\+|plus|included).*\bvat\b/i;
const MONEY_AMOUNT_RE =
  /(?<![\d])(?:\d{1,3}(?:[.,]\d{3})+|\d+)(?:[.,]\d{2})?\s*(?:€|eur)\b/giu;

interface ConstraintEvidence {
  text: string;
  screenId?: string;
}

export interface CalculationConstraintViolation {
  path: string;
  message: string;
  instruction: string;
}

const normalizeWhitespace = (value: string): string =>
  value.normalize("NFKC").replace(/\s+/gu, " ").trim();

const stableId = (prefix: string, text: string): string => {
  let hash = 0;
  for (const ch of text) {
    hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  }
  return `${prefix}-${hash.toString(16).padStart(8, "0")}`;
};

// Issue #2013 — avoid splitting on German abbreviations like "MwSt." that
// mid-sentence sentence terminators would otherwise treat as boundaries,
// dropping the calculation context (e.g. "Die MwSt. ist nicht Teil des
// Finanzierungsbedarfs.").
const GERMAN_ABBREVIATIONS: readonly string[] = [
  "mwst",
  "bzw",
  "ggf",
  "ca",
  "evtl",
  "u.a",
  "z.b",
  "d.h",
  "vgl",
  "inkl",
  "exkl",
];

const sentenceBoundaryRe = /(?<=[.!?])\s+(?=\S)/gu;

const splitStatements = (value: string): string[] => {
  const normalized = normalizeWhitespace(value);
  const statements: string[] = [];
  for (const block of normalized.split(/\n+/u)) {
    const trimmedBlock = block.trim();
    if (trimmedBlock.length === 0) continue;
    let cursor = 0;
    sentenceBoundaryRe.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = sentenceBoundaryRe.exec(trimmedBlock)) !== null) {
      const periodPos = match.index;
      const left = trimmedBlock.slice(cursor, periodPos + 1);
      // Skip the boundary if the token immediately preceding the period
      // is a known abbreviation (case-insensitive) — keeping it attached
      // to the rest of the sentence.
      const tokenBeforePeriod = left
        .replace(/[\s.!?]+$/u, "")
        .split(/[\s,;:()/\\\\]/u)
        .pop()
        ?.toLowerCase();
      if (
        tokenBeforePeriod !== undefined &&
        GERMAN_ABBREVIATIONS.includes(tokenBeforePeriod)
      ) {
        continue;
      }
      statements.push(trimmedBlock.slice(cursor, periodPos + 1).trim());
      cursor = match.index + match[0].length;
    }
    const tail = trimmedBlock.slice(cursor).trim();
    if (tail.length > 0) statements.push(tail);
  }
  return statements.filter((entry) => entry.length > 0);
};

const parseLocalizedNumber = (value: string): number | undefined => {
  const trimmed = value.trim();
  if (trimmed.length === 0) return undefined;
  if (trimmed === "<computed>") return undefined;

  const sanitized = trimmed.replace(/[^\d,.-]/g, "");
  if (!/\d/u.test(sanitized)) return undefined;

  const lastComma = sanitized.lastIndexOf(",");
  const lastDot = sanitized.lastIndexOf(".");
  let canonical = sanitized;
  if (lastComma >= 0 && lastDot >= 0) {
    canonical =
      lastComma > lastDot
        ? sanitized.replace(/\./g, "").replace(",", ".")
        : sanitized.replace(/,/g, "");
  } else if (lastComma >= 0) {
    canonical = sanitized.replace(/\./g, "").replace(",", ".");
  } else {
    canonical = sanitized.replace(/,/g, "");
  }

  const parsed = Number(canonical);
  return Number.isFinite(parsed) ? parsed : undefined;
};

const parseMoneyAmount = (value: string): number | undefined => {
  const match = value.match(MONEY_AMOUNT_RE);
  if (match === null || match.length === 0) return undefined;
  return parseLocalizedNumber(match[0]);
};

const collectConstraintEvidence = (
  model: TestDesignModel,
): ConstraintEvidence[] => [
  ...model.businessRules.map((rule) => ({
    text: rule.description,
    ...(rule.screenId !== undefined ? { screenId: rule.screenId } : {}),
  })),
  ...model.assumptions.map((assumption) => ({ text: assumption.text })),
  ...model.openQuestions.map((question) => ({ text: question.text })),
];

export const extractCalculationConstraints = (
  model: TestDesignModel,
): TestDesignCalculationConstraint[] => {
  const constraints = new Map<string, TestDesignCalculationConstraint>();

  for (const evidence of collectConstraintEvidence(model)) {
    for (const statement of splitStatements(evidence.text)) {
      if (!FINANCING_NEED_RE.test(statement) || !VAT_RE.test(statement)) {
        continue;
      }

      const kind = EXCLUSION_RE.test(statement)
        ? "exclude_component"
        : INCLUSION_RE.test(statement)
          ? "include_component"
          : undefined;
      if (kind === undefined) continue;

      const key = JSON.stringify([
        kind,
        "financing_need",
        "vat",
        evidence.screenId ?? "",
        statement,
      ]);
      constraints.set(key, {
        constraintId: stableId("calc-constraint", key),
        kind,
        subject: "financing_need",
        component: "vat",
        evidenceText: statement,
        ...(evidence.screenId !== undefined
          ? { screenId: evidence.screenId }
          : {}),
      });
    }
  }

  return [...constraints.values()].sort((left, right) =>
    left.constraintId.localeCompare(right.constraintId),
  );
};

const collectCaseTextEntries = (
  testCase: GeneratedTestCase,
): Array<{ path: string; text: string }> => [
  { path: "title", text: testCase.title },
  { path: "objective", text: testCase.objective },
  ...testCase.expectedResults.map((text, index) => ({
    path: `expectedResults[${index}]`,
    text,
  })),
  ...testCase.steps.flatMap((step, index) => [
    { path: `steps[${index}].action`, text: step.action },
    ...(typeof step.expected === "string"
      ? [{ path: `steps[${index}].expected`, text: step.expected }]
      : []),
  ]),
];

const buildScreenLookup = (
  model: TestDesignModel,
): Map<string, TestDesignModel["screens"][number]> =>
  new Map(model.screens.map((screen) => [screen.screenId, screen] as const));

const caseTouchesFinancingNeed = (
  testCase: GeneratedTestCase,
  model: TestDesignModel,
  constraint: TestDesignCalculationConstraint,
): boolean => {
  const textEntries = collectCaseTextEntries(testCase);
  if (textEntries.some((entry) => FINANCING_NEED_RE.test(entry.text))) {
    return true;
  }

  const relevantScreenIds = new Set(
    testCase.figmaTraceRefs.map((trace) => trace.screenId),
  );
  const screenLookup = buildScreenLookup(model);
  if (
    constraint.screenId !== undefined &&
    relevantScreenIds.has(constraint.screenId)
  ) {
    const screen = screenLookup.get(constraint.screenId);
    return (
      screen?.elements.some((element) =>
        FINANCING_NEED_RE.test(element.label),
      ) ?? false
    );
  }

  for (const screenId of relevantScreenIds) {
    const screen = screenLookup.get(screenId);
    if (
      screen?.elements.some((element) => FINANCING_NEED_RE.test(element.label))
    ) {
      return true;
    }
  }

  return false;
};

const findFinancingNeedScreen = (
  model: TestDesignModel,
  constraint: TestDesignCalculationConstraint,
  testCase: GeneratedTestCase,
): TestDesignModel["screens"][number] | undefined => {
  const screenLookup = buildScreenLookup(model);
  if (constraint.screenId !== undefined) {
    return screenLookup.get(constraint.screenId);
  }

  for (const trace of testCase.figmaTraceRefs) {
    const screen = screenLookup.get(trace.screenId);
    if (
      screen !== undefined &&
      screen.elements.some((element) => FINANCING_NEED_RE.test(element.label))
    ) {
      return screen;
    }
  }

  return model.screens.find((screen) =>
    screen.elements.some((element) => FINANCING_NEED_RE.test(element.label)),
  );
};

const computeVatExcludedFinancingNeedAmount = (
  screen: TestDesignModel["screens"][number],
): number | undefined => {
  const resultElement = screen.elements.find((element) =>
    FINANCING_NEED_RE.test(element.label),
  );
  if (resultElement === undefined) return undefined;

  const calculation = screen.calculations.find(
    (candidate) =>
      candidate.resultElementId === resultElement.elementId ||
      FINANCING_NEED_RE.test(candidate.name),
  );
  if (calculation === undefined) return undefined;

  const includedAmounts: number[] = [];
  let excludedVatFieldSeen = false;
  for (const elementId of calculation.inputElementIds) {
    const element = screen.elements.find(
      (candidate) => candidate.elementId === elementId,
    );
    if (element === undefined) continue;
    if (VAT_RE.test(element.label)) {
      excludedVatFieldSeen = true;
      continue;
    }
    const numeric = parseLocalizedNumber(element.defaultValue ?? "");
    if (numeric === undefined) return undefined;
    includedAmounts.push(numeric);
  }

  if (!excludedVatFieldSeen || includedAmounts.length === 0) {
    return undefined;
  }
  return includedAmounts.reduce((sum, value) => sum + value, 0);
};

const findExactMoneyExpectation = (
  testCase: GeneratedTestCase,
): { path: string; text: string; amount: number } | undefined => {
  for (const entry of collectCaseTextEntries(testCase)) {
    const amount = parseMoneyAmount(entry.text);
    if (amount !== undefined) {
      return { ...entry, amount };
    }
  }
  return undefined;
};

export const detectCalculationConstraintViolation = (input: {
  model: TestDesignModel;
  testCase: GeneratedTestCase;
}): CalculationConstraintViolation | undefined => {
  const seenConstraintKeys = new Set<string>();
  const constraints = [
    ...input.model.calculationConstraints,
    ...extractCalculationConstraints(input.model),
  ].filter((constraint) => {
    const key = JSON.stringify([
      constraint.kind,
      constraint.evidenceText,
      constraint.screenId ?? "",
    ]);
    if (seenConstraintKeys.has(key)) {
      return false;
    }
    seenConstraintKeys.add(key);
    return true;
  });
  const financingVatExclusions = constraints.filter(
    (constraint) => constraint.kind === "exclude_component",
  );
  if (financingVatExclusions.length === 0) return undefined;

  const financingVatInclusions = constraints.filter(
    (constraint) => constraint.kind === "include_component",
  );

  if (financingVatInclusions.length > 0) {
    return {
      path: "expectedResults",
      message:
        "Financial calculation evidence conflicts on whether VAT belongs to the financing need; exact numeric expectations are unsafe.",
      instruction:
        "Remove the concrete financing-need amount, preserve the conflicting source evidence in openQuestions, and keep the expected result generic until the calculation rule is resolved.",
    };
  }

  const matchingConstraint = financingVatExclusions.find((constraint) =>
    caseTouchesFinancingNeed(input.testCase, input.model, constraint),
  );
  if (matchingConstraint === undefined) return undefined;

  const textEntries = collectCaseTextEntries(input.testCase);
  const vatFormulaEntry = textEntries.find((entry) =>
    VAT_FORMULA_RE.test(entry.text),
  );
  if (vatFormulaEntry !== undefined) {
    return {
      path: vatFormulaEntry.path,
      message:
        'The expected result includes VAT even though the evidence says "VAT is not part of the financing need."',
      instruction:
        "Remove VAT from the financing-need formula/result. If the remaining bounded inputs still do not determine one exact amount, replace the numeric result with a generic expectation and add an openQuestion.",
    };
  }

  const screen = findFinancingNeedScreen(
    input.model,
    matchingConstraint,
    input.testCase,
  );
  const expectedAmount = screen
    ? computeVatExcludedFinancingNeedAmount(screen)
    : undefined;
  const exactExpectation = findExactMoneyExpectation(input.testCase);
  if (exactExpectation === undefined) return undefined;

  if (expectedAmount === undefined) {
    return {
      path: exactExpectation.path,
      message:
        "The case asserts an exact financing-need amount, but the bounded inputs do not justify a deterministic VAT-excluded calculation.",
      instruction:
        "Replace the exact financing-need amount with a generic expected result and surface the missing calculation rule in openQuestions.",
    };
  }

  if (UNRESOLVED_RE.test(matchingConstraint.evidenceText)) {
    return {
      path: exactExpectation.path,
      message:
        "The financing-need rule is explicitly unresolved, so an exact numeric expectation is not allowed.",
      instruction:
        "Remove the exact amount, keep the expected result generic, and carry the unresolved financing-need rule into openQuestions.",
    };
  }

  if (Math.abs(exactExpectation.amount - expectedAmount) > 0.009) {
    return {
      path: exactExpectation.path,
      message: `The expected financing need ${exactExpectation.amount.toFixed(2)} contradicts the VAT-excluded evidence; bounded inputs imply ${expectedAmount.toFixed(2)}.`,
      instruction: `Recompute the financing need without VAT. The bounded inputs support ${expectedAmount.toFixed(2)} as the VAT-excluded amount; otherwise keep the result generic and add an openQuestion.`,
    };
  }

  return undefined;
};

export const buildSourceScopedCalculationAssumptions = (input: {
  sourceLabel: string;
  text: string;
}): string[] =>
  splitStatements(input.text)
    .filter(
      (statement) =>
        FINANCING_NEED_RE.test(statement) &&
        VAT_RE.test(statement) &&
        (EXCLUSION_RE.test(statement) || INCLUSION_RE.test(statement)),
    )
    .map((statement) => `${input.sourceLabel}: ${statement}`);
