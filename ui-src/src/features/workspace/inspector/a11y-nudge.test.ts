/**
 * Unit tests for post-gen accessibility nudges.
 *
 * @see https://github.com/oscharko-dev/workspace-dev/issues/993
 */

import { describe, expect, it } from "vitest";
import { deriveA11yNudges, listA11yRules } from "./a11y-nudge";

describe("deriveA11yNudges", () => {
  it("returns no nudges when there are no JSX/HTML files", () => {
    const result = deriveA11yNudges({
      files: [
        {
          path: "src/utils/math.ts",
          contents: "export const add = (a,b)=>a+b;",
        },
      ],
    });
    expect(result.nudges).toHaveLength(0);
    expect(result.summary.total).toBe(0);
  });

  it("flags images missing alt attributes as high severity", () => {
    const result = deriveA11yNudges({
      files: [
        {
          path: "src/screens/Home.tsx",
          contents: `<img src="a.png" />\n<img src="b.png" alt="logo" />`,
        },
      ],
    });
    const alt = result.nudges.find(
      (nudge) => nudge.ruleId === "img-missing-alt",
    );
    expect(alt?.severity).toBe("high");
    expect(alt?.line).toBe(1);
    expect(result.summary.bySeverity.high).toBeGreaterThan(0);
  });

  it("flags clickable <div> without role or tabIndex", () => {
    const result = deriveA11yNudges({
      files: [
        {
          path: "src/screens/Widget.tsx",
          contents: `<div onClick={handle}>Click me</div>`,
        },
      ],
    });
    expect(
      result.nudges.some((nudge) => nudge.ruleId === "div-onclick-no-role"),
    ).toBe(true);
  });

  it("flags missing <h1> but not when one is present", () => {
    const withoutH1 = deriveA11yNudges({
      files: [
        {
          path: "src/screens/Page.tsx",
          contents: `<h2>Section</h2>`,
        },
      ],
    });
    expect(
      withoutH1.nudges.some((nudge) => nudge.ruleId === "missing-h1"),
    ).toBe(true);

    const withH1 = deriveA11yNudges({
      files: [
        {
          path: "src/screens/Page.tsx",
          contents: `<h1>Page</h1><h2>Section</h2>`,
        },
      ],
    });
    expect(withH1.nudges.some((nudge) => nudge.ruleId === "missing-h1")).toBe(
      false,
    );
  });

  it("respects disabled rule ids from policy", () => {
    const result = deriveA11yNudges({
      files: [{ path: "a.tsx", contents: `<img src="a.png" />` }],
      policy: { disabledRules: ["img-missing-alt"] },
    });
    expect(
      result.nudges.some((nudge) => nudge.ruleId === "img-missing-alt"),
    ).toBe(false);
  });

  it("upgrades severity for AAA-sensitive rules under the AAA policy", () => {
    const aa = deriveA11yNudges({
      files: [{ path: "a.tsx", contents: `<h2>Title</h2>` }],
    });
    const aaa = deriveA11yNudges({
      files: [{ path: "a.tsx", contents: `<h2>Title</h2>` }],
      policy: { wcagLevel: "AAA" },
    });

    const aaSeverity = aa.nudges.find(
      (nudge) => nudge.ruleId === "missing-h1",
    )?.severity;
    const aaaSeverity = aaa.nudges.find(
      (nudge) => nudge.ruleId === "missing-h1",
    )?.severity;
    expect(aaSeverity).toBe("low");
    expect(aaaSeverity).toBe("medium");
  });

  it("sorts nudges by severity, file, then line", () => {
    const result = deriveA11yNudges({
      files: [
        {
          path: "b.tsx",
          contents: `<img src="x" />\n<a>no-href</a>`,
        },
        {
          path: "a.tsx",
          contents: `<img src="x" />`,
        },
      ],
    });
    expect(result.nudges[0]?.severity).toBe("high");
    if (result.nudges.length >= 2) {
      expect(result.nudges[0]!.severity <= result.nudges[1]!.severity).toBe(
        true,
      );
    }
  });
});

describe("listA11yRules", () => {
  it("returns the full registry with WCAG hints", () => {
    const rules = listA11yRules();
    expect(rules.length).toBeGreaterThan(3);
    expect(rules.every((rule) => rule.label.length > 0)).toBe(true);
  });
});
