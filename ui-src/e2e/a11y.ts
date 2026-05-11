import { AxeBuilder } from "@axe-core/playwright";
import { expect, type Page } from "@playwright/test";

const WCAG_21_AA_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

function toSelectorList(selector?: string | string[]): string[] {
  if (selector === undefined) {
    return [];
  }

  return Array.isArray(selector) ? selector : [selector];
}

function formatViolations(
  violations: Array<{
    id: string;
    impact?: string | null;
    help: string;
    nodes: Array<{ target: string[] }>;
  }>,
): string {
  return violations
    .map((violation) => {
      const targets = violation.nodes
        .flatMap((node) => node.target)
        .join(", ");
      return `${violation.impact ?? "unknown"} ${violation.id}: ${violation.help}${targets ? ` [${targets}]` : ""}`;
    })
    .join("\n");
}

export async function expectNoBlockingAccessibilityViolations({
  page,
  include,
  exclude,
}: {
  page: Page;
  include?: string | string[];
  exclude?: string | string[];
}): Promise<void> {
  let builder = new AxeBuilder({ page }).withTags(WCAG_21_AA_TAGS);

  for (const selector of toSelectorList(include)) {
    builder = builder.include(selector);
  }

  for (const selector of toSelectorList(exclude)) {
    builder = builder.exclude(selector);
  }

  const results = await builder.analyze();
  const blockingViolations = results.violations.filter((violation) => {
    return violation.impact === "serious" || violation.impact === "critical";
  });

  expect(blockingViolations, formatViolations(blockingViolations)).toEqual([]);
}
