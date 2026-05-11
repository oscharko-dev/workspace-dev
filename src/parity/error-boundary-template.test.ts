// ---------------------------------------------------------------------------
// error-boundary-template.test.ts — regression coverage for issue #626
// Verifies that the generated ErrorBoundary scaffold does not emit raw error
// payloads through an unconditional console.error in production builds.
// ---------------------------------------------------------------------------
import assert from "node:assert/strict";
import test from "node:test";
import { makeErrorBoundaryFile } from "./templates/error-boundary-template.js";

test("generated ErrorBoundary does not contain an unconditional console.error", () => {
  const { content } = makeErrorBoundaryFile();

  // Any console.error call must be guarded by a DEV check.
  // A bare `console.error(` that is not preceded by a DEV guard on the same
  // logical path would violate the production-safety requirement.
  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (!line.includes("console.error(")) {
      continue;
    }
    // Walk backwards to find the nearest conditional guard within the same block.
    const guardFound = lines
      .slice(Math.max(0, i - 5), i)
      .some((l) => l.includes("import.meta.env.DEV"));
    assert.equal(
      guardFound,
      true,
      `Line ${i + 1}: console.error must be guarded by import.meta.env.DEV:\n  ${line.trim()}`
    );
  }
});

test("generated ErrorBoundary logs error details in development via componentDidCatch", () => {
  const { content } = makeErrorBoundaryFile();

  assert.ok(
    content.includes("componentDidCatch"),
    "generated template should implement componentDidCatch"
  );
  assert.ok(
    content.includes("import.meta.env.DEV"),
    "generated template should guard logging with import.meta.env.DEV"
  );
  assert.ok(
    content.includes('console.error("ErrorBoundary caught:"'),
    "generated template should log error details in development"
  );
});

test("generated ErrorBoundary imports ErrorInfo from react", () => {
  const { content } = makeErrorBoundaryFile();

  assert.ok(
    content.includes("ErrorInfo"),
    "generated template should import ErrorInfo for componentDidCatch signature"
  );
});
