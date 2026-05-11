import assert from "node:assert/strict";
import test from "node:test";
import {
  diffRangeArgs,
  evaluateContractChangelogGuard,
  extractIssueNumbers,
  parseArgs,
} from "./check-contract-changelog.mjs";

test("extractIssueNumbers parses Issue # and bare # references once", () => {
  assert.deepEqual(
    extractIssueNumbers("Issue #2173, follow-up (#2173), and #2101."),
    [2101, 2173],
  );
});

test("parseArgs accepts base/head/merge-base flags", () => {
  assert.deepEqual(parseArgs(["--base", "origin/dev", "--head", "HEAD"]), {
    base: "origin/dev",
    head: "HEAD",
    mergeBase: false,
  });
  assert.deepEqual(diffRangeArgs({ base: "origin/dev", head: "HEAD" }), [
    "origin/dev",
    "HEAD",
  ]);
  assert.deepEqual(
    diffRangeArgs({ base: "origin/dev", head: "HEAD", mergeBase: true }),
    ["origin/dev...HEAD"],
  );
});

test("guard passes when no relevant public contract files changed", () => {
  const result = evaluateContractChangelogGuard({
    changedFiles: ["README.md"],
    commitIssueNumbers: [],
    changelogIssueNumbers: [],
  });

  assert.equal(result.ok, true);
});

test("guard ignores governance-only contract tests", () => {
  const result = evaluateContractChangelogGuard({
    changedFiles: ["src/contract-version.test.ts"],
    commitIssueNumbers: [2173],
    changelogIssueNumbers: [],
  });

  assert.equal(result.ok, true);
});

test("guard fails when public contract files change without changelog update", () => {
  const result = evaluateContractChangelogGuard({
    changedFiles: ["src/contracts/index.ts"],
    commitIssueNumbers: [2173],
    changelogIssueNumbers: [],
  });

  assert.equal(result.ok, false);
  assert.match(result.reason, /without updating CONTRACT_CHANGELOG\.md/);
});

test("guard treats exported test-intelligence implementation files as relevant", () => {
  const result = evaluateContractChangelogGuard({
    changedFiles: ["src/test-intelligence/migrations.ts"],
    commitIssueNumbers: [2173],
    changelogIssueNumbers: [],
  });

  assert.equal(result.ok, false);
  assert.match(result.reason, /without updating CONTRACT_CHANGELOG\.md/);
});

test("guard fails when commit issue numbers do not match changelog issue numbers", () => {
  const result = evaluateContractChangelogGuard({
    changedFiles: ["src/contracts/index.ts", "CONTRACT_CHANGELOG.md"],
    commitIssueNumbers: [2173],
    changelogIssueNumbers: [2101],
  });

  assert.equal(result.ok, false);
  assert.match(result.reason, /do not match any issue number/);
});

test("guard passes when commit issue numbers match added changelog issue numbers", () => {
  const result = evaluateContractChangelogGuard({
    changedFiles: ["src/contracts/index.ts", "CONTRACT_CHANGELOG.md"],
    commitIssueNumbers: [2173],
    changelogIssueNumbers: [2101, 2173],
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.matchingIssueNumbers, [2173]);
});
