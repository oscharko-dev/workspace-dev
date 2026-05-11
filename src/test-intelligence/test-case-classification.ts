import type {
  GeneratedTestCase,
  GeneratedTestCaseCategory,
  GeneratedTestCasePolarity,
} from "../contracts/index.js";

const A11Y_HINT_PATTERN =
  /\b(a11y|accessibility|barriere|screen[\s-]?reader|focus|fokus|tab(?:-)?reihenfolge|tastatur)\b/iu;

type ClassificationSource = Pick<
  GeneratedTestCase,
  "type" | "title" | "objective" | "expectedResults" | "steps"
>;

export interface GeneratedTestCaseClassification {
  polarity: GeneratedTestCasePolarity;
  category: GeneratedTestCaseCategory;
}

const ACCESSIBILITY_CLASSIFICATION: GeneratedTestCaseClassification = {
  polarity: "accessibility",
  category: "accessibility",
};

export const deriveGeneratedTestCaseClassification = (
  input: ClassificationSource,
): GeneratedTestCaseClassification => {
  const combined = [
    input.title,
    input.objective,
    ...input.expectedResults,
    ...input.steps.flatMap((step) => [step.action, step.expected ?? ""]),
  ].join(" ");

  if (input.type === "accessibility" || A11Y_HINT_PATTERN.test(combined)) {
    return ACCESSIBILITY_CLASSIFICATION;
  }

  switch (input.type) {
    case "negative":
      return { polarity: "negative", category: "negative_path" };
    case "validation":
      return { polarity: "validation", category: "validation_rule" };
    case "boundary":
      return { polarity: "boundary", category: "boundary_value" };
    case "navigation":
      return { polarity: "navigation", category: "navigation_flow" };
    default:
      return { polarity: "positive", category: "positive_path" };
  }
};

export const renderGeneratedTestCasePolarityLabel = (
  polarity: GeneratedTestCasePolarity,
): string => {
  switch (polarity) {
    case "negative":
      return "Negativ";
    case "boundary":
      return "Grenzwert";
    case "validation":
      return "Validierung";
    case "navigation":
      return "Navigation";
    case "accessibility":
      return "Barrierefreiheit";
    default:
      return "Positiv";
  }
};
