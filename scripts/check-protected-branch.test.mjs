import { test } from "node:test";
import assert from "node:assert";
import {
  buildProtectedBranchMessage,
  parseProtectedBranches,
  runGuard,
  shouldBlockBranch,
} from "./check-protected-branch.mjs";

test("parseProtectedBranches: defaults to dev", () => {
  assert.deepStrictEqual(parseProtectedBranches(undefined), ["dev"]);
  assert.deepStrictEqual(parseProtectedBranches(""), ["dev"]);
});

test("parseProtectedBranches: trims and drops empty entries", () => {
  assert.deepStrictEqual(
    parseProtectedBranches(" dev, main , ,release "),
    ["dev", "main", "release"],
  );
});

test("shouldBlockBranch: matches protected branches only", () => {
  assert.strictEqual(shouldBlockBranch("dev", ["dev"]), true);
  assert.strictEqual(shouldBlockBranch("feature/test", ["dev"]), false);
  assert.strictEqual(shouldBlockBranch("", ["dev"]), false);
});

test("buildProtectedBranchMessage: includes branch and guidance", () => {
  const message = buildProtectedBranchMessage({
    operation: "commits",
    branchName: "dev",
    protectedBranches: ["dev", "main"],
  });

  assert.match(message, /Direct commits to 'dev' are blocked\./);
  assert.match(message, /Protected branches: dev, main\./);
  assert.match(message, /Create a feature branch/);
});

test("runGuard: allows non-protected branches", () => {
  const logs = [];
  const errs = [];

  const exitCode = runGuard({
    operation: "commits",
    env: {},
    execFile: () => "feature/my-change\n",
    stdout: (message) => logs.push(message),
    stderr: (message) => errs.push(message),
  });

  assert.strictEqual(exitCode, 0);
  assert.strictEqual(errs.length, 0);
  assert.strictEqual(logs.length, 1);
  assert.match(logs[0], /Allowed commits on 'feature\/my-change'/);
});

test("runGuard: blocks protected branches", () => {
  const logs = [];
  const errs = [];

  const exitCode = runGuard({
    operation: "pushes",
    env: {},
    execFile: () => "dev\n",
    stdout: (message) => logs.push(message),
    stderr: (message) => errs.push(message),
  });

  assert.strictEqual(exitCode, 1);
  assert.strictEqual(logs.length, 0);
  assert.strictEqual(errs.length, 1);
  assert.match(errs[0], /Direct pushes to 'dev' are blocked\./);
});

test("runGuard: uses env override for protected branches", () => {
  const logs = [];

  const exitCode = runGuard({
    operation: "commits",
    env: {
      WORKSPACE_DEV_PROTECTED_BRANCHES: "main,release",
    },
    execFile: () => "dev\n",
    stdout: (message) => logs.push(message),
    stderr: () => {
      throw new Error("unexpected stderr");
    },
  });

  assert.strictEqual(exitCode, 0);
  assert.strictEqual(logs.length, 1);
});

test("runGuard: reports git lookup failures", () => {
  const errs = [];

  const exitCode = runGuard({
    execFile: () => {
      throw new Error("git failure");
    },
    stdout: () => {
      throw new Error("unexpected stdout");
    },
    stderr: (message) => errs.push(message),
  });

  assert.strictEqual(exitCode, 1);
  assert.strictEqual(errs.length, 1);
  assert.match(errs[0], /Unable to determine current branch: git failure/);
});
