import assert from "node:assert/strict";
import test from "node:test";
import {
  PR_AUTOCLOSE_WARNING_MARKER,
  buildAutoCloseWarningComment,
  extractAutoCloseReferences,
  extractIssueReferences,
  findMissingAutoCloseReferences,
  runPrAutocloseWarning,
} from "./pr-autoclose-warning.mjs";

test("extractIssueReferences deduplicates bare issue references", () => {
  assert.deepEqual(
    extractIssueReferences("Touches #12, #7, and mentions #12 again."),
    [7, 12],
  );
});

test("extractAutoCloseReferences matches GitHub close keywords", () => {
  assert.deepEqual(
    extractAutoCloseReferences("Fixes #12, closes: #7, and resolved #9."),
    [7, 9, 12],
  );
});

test("findMissingAutoCloseReferences excludes auto-close references", () => {
  assert.deepEqual(
    findMissingAutoCloseReferences({
      title: "Addresses #10",
      body: "Fixes #12 and keeps #14 informational.",
    }),
    [10, 14],
  );
});

test("buildAutoCloseWarningComment includes marker and missing issues", () => {
  const body = buildAutoCloseWarningComment([7, 12]);

  assert.match(body, new RegExp(PR_AUTOCLOSE_WARNING_MARKER));
  assert.match(body, /- #7/);
  assert.match(body, /- #12/);
});

test("runPrAutocloseWarning summary mode emits warning without github writes", async () => {
  const warnings = [];
  const summaryLines = [];
  const core = {
    notice() {},
    warning(message) {
      warnings.push(message);
    },
    summary: {
      addHeading(value) {
        summaryLines.push(`# ${value}`);
        return this;
      },
      addRaw(value) {
        summaryLines.push(value);
        return this;
      },
      async write() {},
    },
  };

  await runPrAutocloseWarning({
    core,
    context: {
      payload: {
        action: "opened",
        pull_request: {
          title: "Addresses #7",
          body: "Also relates to #12.",
        },
      },
    },
    commentMode: "summary",
  });

  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /#7, #12/);
  assert.match(summaryLines.join("\n"), /PR auto-close warning/);
  assert.doesNotMatch(
    summaryLines.join("\n"),
    /workspace-dev:pr-autoclose-warning/,
  );
});
