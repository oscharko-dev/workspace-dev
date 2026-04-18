import assert from "node:assert/strict";
import test from "node:test";
import { scanSourceText } from "./check-job-engine-catch-logging.mjs";

test("scanSourceText flags a bare catch block", () => {
  const findings = scanSourceText({
    filePath: "src/job-engine/example.ts",
    sourceText: [
      "export const run = () => {",
      "  try {",
      "    doWork();",
      "  } catch {",
      "  }",
      "};"
    ].join("\n")
  });

  assert.equal(findings.length, 1);
  assert.equal(findings[0].line, 4);
  assert.equal(findings[0].reason, "bare catch block");
});

test("scanSourceText flags catch blocks that only return undefined without logging", () => {
  const findings = scanSourceText({
    filePath: "src/job-engine/example.ts",
    sourceText: [
      "export const run = () => {",
      "  try {",
      "    doWork();",
      "  } catch (error) {",
      "    if (isTransient(error)) {",
      "      return undefined;",
      "    }",
      "    return undefined;",
      "  }",
      "};"
    ].join("\n")
  });

  assert.equal(findings.length, 1);
  assert.equal(findings[0].line, 4);
  assert.equal(findings[0].reason, "catch block returns nullish value without logging");
});

test("scanSourceText allows catch blocks that log before returning undefined", () => {
  const findings = scanSourceText({
    filePath: "src/job-engine/example.ts",
    sourceText: [
      "export const run = (onLog: (message: string) => void) => {",
      "  try {",
      "    doWork();",
      "  } catch (error) {",
      "    onLog(`failed: ${String(error)}`);",
      "    return undefined;",
      "  }",
      "};"
    ].join("\n")
  });

  assert.deepEqual(findings, []);
});

test("scanSourceText allows catch blocks that call a diagnostic logging helper", () => {
  const findings = scanSourceText({
    filePath: "src/job-engine/example.ts",
    sourceText: [
      "const logExampleDiagnostic = () => {};",
      "export const run = () => {",
      "  try {",
      "    doWork();",
      "  } catch (error) {",
      "    logExampleDiagnostic({ error });",
      "    return undefined;",
      "  }",
      "};"
    ].join("\n")
  });

  assert.deepEqual(findings, []);
});

test("scanSourceText allows catch blocks that rethrow", () => {
  const findings = scanSourceText({
    filePath: "src/job-engine/example.ts",
    sourceText: [
      "export const run = () => {",
      "  try {",
      "    doWork();",
      "  } catch (error) {",
      "    if (error instanceof Error) {",
      "      throw error;",
      "    }",
      "    return undefined;",
      "  }",
      "};"
    ].join("\n")
  });

  assert.deepEqual(findings, []);
});
