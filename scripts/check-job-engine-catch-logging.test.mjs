import assert from "node:assert/strict";
import test from "node:test";
import { analyzeSourceText } from "./check-job-engine-catch-logging.mjs";

test("analyzeSourceText ignores catch blocks with obvious logging calls", () => {
  const findings = analyzeSourceText({
    filePath: "sample.ts",
    text: `
      try {
        work();
      } catch (error) {
        onLog("handled");
        return undefined;
      }
    `,
  });

  assert.deepEqual(findings, []);
});

test("analyzeSourceText flags empty catch blocks", () => {
  const findings = analyzeSourceText({
    filePath: "sample.ts",
    text: `
      try {
        work();
      } catch {
      }
    `,
  });

  assert.equal(findings.length, 1);
  assert.match(findings[0].reason, /empty catch block/);
});

test("analyzeSourceText flags nullish returns without logging", () => {
  const findings = analyzeSourceText({
    filePath: "sample.ts",
    text: `
      try {
        work();
      } catch (error) {
        return undefined;
      }
    `,
  });

  assert.equal(findings.length, 1);
  assert.match(findings[0].reason, /returns nullish value/);
});

test("analyzeSourceText flags swallowed catches that only conditionally rethrow", () => {
  const findings = analyzeSourceText({
    filePath: "sample.ts",
    text: `
      try {
        work();
      } catch (error) {
        if (!(error instanceof Error)) {
          throw error;
        }
      }
    `,
  });

  assert.equal(findings.length, 1);
  assert.match(findings[0].reason, /swallows errors without logging/);
});

test("analyzeSourceText ignores nested helper logging when the catch still swallows", () => {
  const findings = analyzeSourceText({
    filePath: "sample.ts",
    text: `
      try {
        work();
      } catch (error) {
        const later = () => {
          onLog("deferred");
        };
        return undefined;
      }
    `,
  });

  assert.equal(findings.length, 1);
  assert.match(findings[0].reason, /returns nullish value/);
});
