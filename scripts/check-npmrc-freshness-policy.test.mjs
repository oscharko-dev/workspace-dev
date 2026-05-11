import { test } from "node:test";
import assert from "node:assert";
import {
  parseMinimumReleaseAge,
  checkNpmrcContent,
  runGuard,
} from "./check-npmrc-freshness-policy.mjs";

// ── parseMinimumReleaseAge ───────────────────────────────────────────────────

test("parseMinimumReleaseAge: returns value for a present key", () => {
  assert.strictEqual(
    parseMinimumReleaseAge("minimum-release-age=10080"),
    10080,
  );
});

test("parseMinimumReleaseAge: returns null when key is absent", () => {
  assert.strictEqual(
    parseMinimumReleaseAge("ignore-scripts=true\nsave-exact=true"),
    null,
  );
});

test("parseMinimumReleaseAge: ignores comment lines", () => {
  const content = [
    "# minimum-release-age=9999",
    "minimum-release-age=4320",
  ].join("\n");
  assert.strictEqual(parseMinimumReleaseAge(content), 4320);
});

test("parseMinimumReleaseAge: handles inline comment after value", () => {
  assert.strictEqual(
    parseMinimumReleaseAge("minimum-release-age=10080 # 7 days in minutes"),
    10080,
  );
});

test("parseMinimumReleaseAge: handles whitespace around equals sign", () => {
  assert.strictEqual(
    parseMinimumReleaseAge("minimum-release-age = 2880"),
    2880,
  );
});

test("parseMinimumReleaseAge: returns NaN for a non-numeric value", () => {
  assert.ok(Number.isNaN(parseMinimumReleaseAge("minimum-release-age=foo")));
});

test("parseMinimumReleaseAge: returns 0 for explicit zero", () => {
  assert.strictEqual(parseMinimumReleaseAge("minimum-release-age=0"), 0);
});

test("parseMinimumReleaseAge: returns null for empty content", () => {
  assert.strictEqual(parseMinimumReleaseAge(""), null);
});

// ── checkNpmrcContent ────────────────────────────────────────────────────────

test("checkNpmrcContent: returns null for a compliant file", () => {
  const content = [
    "ignore-scripts=true",
    "save-exact=true",
    "minimum-release-age=10080",
  ].join("\n");
  assert.strictEqual(checkNpmrcContent(content, ".npmrc"), null);
});

test("checkNpmrcContent: returns violation string when key is absent", () => {
  const violation = checkNpmrcContent("ignore-scripts=true", ".npmrc");
  assert.ok(typeof violation === "string" && violation.includes(".npmrc"));
  assert.ok(violation.includes("missing"));
});

test("checkNpmrcContent: returns violation string when value is zero", () => {
  const violation = checkNpmrcContent("minimum-release-age=0", ".npmrc");
  assert.ok(typeof violation === "string");
  assert.ok(violation.includes("positive integer"));
});

test("checkNpmrcContent: returns violation string when value is negative", () => {
  const violation = checkNpmrcContent("minimum-release-age=-1", ".npmrc");
  assert.ok(typeof violation === "string");
  assert.ok(violation.includes("positive integer"));
});

test("checkNpmrcContent: returns violation string for non-numeric value", () => {
  const violation = checkNpmrcContent("minimum-release-age=never", ".npmrc");
  assert.ok(typeof violation === "string");
  assert.ok(violation.includes("positive integer"));
});

test("checkNpmrcContent: includes file path in violation message", () => {
  const violation = checkNpmrcContent(
    "ignore-scripts=true",
    "template/react-mui-app/.npmrc",
  );
  assert.ok(violation?.includes("template/react-mui-app/.npmrc"));
});

test("checkNpmrcContent: accepts minimum value of 1", () => {
  assert.strictEqual(
    checkNpmrcContent("minimum-release-age=1", ".npmrc"),
    null,
  );
});

// ── runGuard: integration-style ──────────────────────────────────────────────

test("runGuard: returns 0 when all targets are compliant", async () => {
  const logs = [];
  const errs = [];
  const exitCode = await runGuard({
    packageRoot: "/unused",
    readTextFile: async () => "minimum-release-age=10080\n",
    targets: [".npmrc", "template/react-mui-app/.npmrc"],
    stdout: (msg) => logs.push(msg),
    stderr: (msg) => errs.push(msg),
  });
  assert.strictEqual(exitCode, 0);
  assert.strictEqual(errs.length, 0);
  assert.ok(logs[0]?.includes("Passed"));
});

test("runGuard: returns 1 when a target is missing the key", async () => {
  const errs = [];
  const exitCode = await runGuard({
    packageRoot: "/unused",
    readTextFile: async () => "ignore-scripts=true\n",
    targets: [".npmrc"],
    stdout: () => {},
    stderr: (msg) => errs.push(msg),
  });
  assert.strictEqual(exitCode, 1);
  assert.ok(errs.some((e) => e.includes(".npmrc")));
});

test("runGuard: returns 1 when a target file is not found", async () => {
  const errs = [];
  const exitCode = await runGuard({
    packageRoot: "/unused",
    readTextFile: async () => {
      const err = new Error("not found");
      Object.assign(err, { code: "ENOENT" });
      throw err;
    },
    targets: ["missing/.npmrc"],
    stdout: () => {},
    stderr: (msg) => errs.push(msg),
  });
  assert.strictEqual(exitCode, 1);
  assert.ok(errs.some((e) => e.includes("missing/.npmrc")));
});

test("runGuard: reports all violations before returning 1", async () => {
  const errs = [];
  const exitCode = await runGuard({
    packageRoot: "/unused",
    readTextFile: async () => "ignore-scripts=true\n",
    targets: [".npmrc", "template/react-mui-app/.npmrc"],
    stdout: () => {},
    stderr: (msg) => errs.push(msg),
  });
  assert.strictEqual(exitCode, 1);
  const violationLines = errs.filter((e) => e.startsWith(" - "));
  assert.strictEqual(violationLines.length, 2);
});

test("runGuard: re-throws unexpected read errors", async () => {
  await assert.rejects(
    () =>
      runGuard({
        packageRoot: "/unused",
        readTextFile: async () => {
          throw new Error("disk failure");
        },
        targets: [".npmrc"],
        stdout: () => {},
        stderr: () => {},
      }),
    /disk failure/,
  );
});
