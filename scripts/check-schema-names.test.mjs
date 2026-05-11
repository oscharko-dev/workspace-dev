import assert from "node:assert/strict";
import test from "node:test";
import { analyzeSourceText } from "./check-schema-names.mjs";

test("analyzeSourceText accepts dash-and-underscore names within 64 chars", () => {
  const findings = analyzeSourceText({
    filePath: "sample.ts",
    text: `
      export const VISUAL_SIDECAR_RESPONSE_SCHEMA_NAME = "workspace-dev-visual-sidecar-v1" as const;
      export const SELF_VERIFY_RUBRIC_RESPONSE_SCHEMA_NAME = "SelfVerifyRubricReport" as const;
    `,
  });
  assert.deepEqual(findings, []);
});

test("analyzeSourceText flags dotted names (regression for #1676)", () => {
  const findings = analyzeSourceText({
    filePath: "sample.ts",
    text: `
      export const VISUAL_SIDECAR_RESPONSE_SCHEMA_NAME =
        "workspace-dev.test-intelligence.visual-sidecar.v1" as const;
    `,
  });
  assert.equal(findings.length, 1);
  assert.equal(findings[0].name, "VISUAL_SIDECAR_RESPONSE_SCHEMA_NAME");
  assert.match(findings[0].literalOnly, /workspace-dev\./);
});

test("analyzeSourceText flags template literals whose static portion is invalid", () => {
  const findings = analyzeSourceText({
    filePath: "sample.ts",
    text:
      "export const GENERATED_TEST_CASE_LIST_SCHEMA_NAME: string = " +
      "`workspace-dev.test-intelligence.generated-test-case-list.v${V}`;",
  });
  assert.equal(findings.length, 1);
  assert.equal(findings[0].name, "GENERATED_TEST_CASE_LIST_SCHEMA_NAME");
});

test("analyzeSourceText accepts template literals whose static portion is valid", () => {
  const findings = analyzeSourceText({
    filePath: "sample.ts",
    text:
      "export const GENERATED_TEST_CASE_LIST_SCHEMA_NAME: string = " +
      "`workspace-dev-generated-test-case-list-v${V}`;",
  });
  assert.deepEqual(findings, []);
});

test("analyzeSourceText flags names exceeding 64 characters", () => {
  const longName = "a".repeat(65);
  const findings = analyzeSourceText({
    filePath: "sample.ts",
    text: `export const LONG_SCHEMA_NAME = "${longName}" as const;`,
  });
  assert.equal(findings.length, 1);
});

test("analyzeSourceText ignores non-SCHEMA_NAME constants", () => {
  const findings = analyzeSourceText({
    filePath: "sample.ts",
    text: `
      export const SOMETHING_ELSE = "has.dots.but.does.not.match";
      export const VISUAL_SIDECAR_SCHEMA_VERSION = "1.0.0";
    `,
  });
  assert.deepEqual(findings, []);
});
