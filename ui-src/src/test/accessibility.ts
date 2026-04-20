import { configureAxe } from "vitest-axe";
import { expect } from "vitest";

const WCAG_21_AA_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

const runAccessibilityAudit = configureAxe({
  runOnly: {
    type: "tag",
    values: WCAG_21_AA_TAGS,
  },
});

type AxeAuditResults = Awaited<ReturnType<typeof runAccessibilityAudit>>;

function toBlockingViolationsOnly(results: AxeAuditResults): AxeAuditResults {
  return {
    ...results,
    violations: results.violations.filter((violation) => {
      return violation.impact === "serious" || violation.impact === "critical";
    }),
  };
}

export async function expectNoBlockingAccessibilityViolations(
  node: Element,
  options?: Parameters<typeof runAccessibilityAudit>[1],
): Promise<AxeAuditResults> {
  const results = await runAccessibilityAudit(node, options);
  expect(toBlockingViolationsOnly(results)).toHaveNoViolations();
  return results;
}
