import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import {
  changelogMentionsVersion,
  evaluatePromptTemplateVersionContract,
  extractVersionFromContractsSource,
  hashSource,
  parseLockJson,
  pathsForRoot,
  runCheck,
  VERSION_CONST_REGEX,
} from "./check-prompt-template-version.mjs";

// ── Pure helpers ───────────────────────────────────────────────────────────

test("hashSource: normalizes CRLF to LF before hashing", () => {
  const lf = "alpha\nbeta\n";
  const crlf = "alpha\r\nbeta\r\n";
  assert.equal(hashSource(lf), hashSource(crlf));
});

test("hashSource: returns 64-hex SHA-256", () => {
  const out = hashSource("hello");
  assert.match(out, /^[0-9a-f]{64}$/);
});

test("VERSION_CONST_REGEX: matches the canonical declaration", () => {
  const source = `export const TEST_INTELLIGENCE_PROMPT_TEMPLATE_VERSION = "1.4.0" as const;`;
  const match = source.match(VERSION_CONST_REGEX);
  assert.ok(match);
  assert.equal(match[1], "1.4.0");
});

test("extractVersionFromContractsSource: returns null when constant absent", () => {
  assert.equal(extractVersionFromContractsSource("nothing here"), null);
});

test("extractVersionFromContractsSource: ignores other constants ending in _VERSION", () => {
  const source = `export const SOME_OTHER_VERSION = "9.9.9" as const;\nexport const TEST_INTELLIGENCE_PROMPT_TEMPLATE_VERSION = "2.0.1" as const;\n`;
  assert.equal(extractVersionFromContractsSource(source), "2.0.1");
});

test("changelogMentionsVersion: matches `## 1.4.0` heading", () => {
  const source = "# title\n\n## 1.4.0 — Issue #1942\nbody\n";
  assert.equal(changelogMentionsVersion(source, "1.4.0"), true);
  assert.equal(changelogMentionsVersion(source, "1.5.0"), false);
});

// ── parseLockJson ──────────────────────────────────────────────────────────

test("parseLockJson: rejects non-JSON", () => {
  assert.throws(
    () => parseLockJson("{not-json", { lockPathLabel: "lock" }),
    /not valid JSON/,
  );
});

test("parseLockJson: rejects missing semver version", () => {
  const raw = JSON.stringify({
    version: "1",
    promptCompilerSha256: "a".repeat(64),
  });
  assert.throws(
    () => parseLockJson(raw, { lockPathLabel: "lock" }),
    /missing a semver `version` field/,
  );
});

test("parseLockJson: rejects non-hex hash", () => {
  const raw = JSON.stringify({
    version: "1.0.0",
    promptCompilerSha256: "ZZZ",
  });
  assert.throws(
    () => parseLockJson(raw, { lockPathLabel: "lock" }),
    /missing a 64-hex `promptCompilerSha256` field/,
  );
});

test("parseLockJson: returns parsed values on a valid lock", () => {
  const raw = JSON.stringify({
    version: "1.4.0",
    promptCompilerSha256: "0".repeat(64),
  });
  const parsed = parseLockJson(raw, { lockPathLabel: "lock" });
  assert.equal(parsed.version, "1.4.0");
  assert.equal(parsed.promptCompilerSha256, "0".repeat(64));
});

// ── evaluatePromptTemplateVersionContract ──────────────────────────────────

const baseInputs = {
  currentVersion: "1.4.0",
  currentHash: "a".repeat(64),
  lockVersion: "1.4.0",
  lockHash: "a".repeat(64),
};

test("evaluate: clean state yields no issues", () => {
  assert.deepEqual(evaluatePromptTemplateVersionContract(baseInputs), []);
});

test("evaluate: file changed without version bump fails with content-drift", () => {
  const issues = evaluatePromptTemplateVersionContract({
    ...baseInputs,
    currentHash: "b".repeat(64),
  });
  assert.equal(issues.length, 1);
  assert.match(issues[0], /Content drift/);
});

test("evaluate: version bumped without lock update fails with version-mismatch", () => {
  const issues = evaluatePromptTemplateVersionContract({
    ...baseInputs,
    currentVersion: "1.5.0",
  });
  assert.ok(issues.some((i) => /Version mismatch/.test(i)));
});

test("evaluate: both version and hash drift surfaces both issues", () => {
  const issues = evaluatePromptTemplateVersionContract({
    ...baseInputs,
    currentVersion: "1.5.0",
    currentHash: "b".repeat(64),
  });
  assert.equal(issues.length, 2);
  assert.ok(issues.some((i) => /Version mismatch/.test(i)));
  assert.ok(issues.some((i) => /Content drift/.test(i)));
});

test("evaluate: version + lock bumped together passes", () => {
  const issues = evaluatePromptTemplateVersionContract({
    currentVersion: "1.5.0",
    currentHash: "c".repeat(64),
    lockVersion: "1.5.0",
    lockHash: "c".repeat(64),
  });
  assert.deepEqual(issues, []);
});

// ── runCheck (filesystem integration in a temp dir) ────────────────────────

async function buildFakeRoot({
  promptCompilerBody,
  versionConstant,
  lockBody,
  changelogBody,
}) {
  const root = await mkdtemp(path.join(tmpdir(), "prompt-template-guard-"));
  await mkdir(path.join(root, "src/test-intelligence"), { recursive: true });
  await mkdir(path.join(root, "src/contracts"), { recursive: true });
  await mkdir(path.join(root, "docs"), { recursive: true });
  const paths = pathsForRoot(root);
  await writeFile(paths.promptCompiler, promptCompilerBody, "utf8");
  await writeFile(
    paths.contracts,
    `export const TEST_INTELLIGENCE_PROMPT_TEMPLATE_VERSION = "${versionConstant}" as const;\n`,
    "utf8",
  );
  await writeFile(paths.lock, lockBody, "utf8");
  await writeFile(paths.changelog, changelogBody, "utf8");
  return root;
}

test("runCheck: clean state returns ok", async () => {
  const body = "// prompt-compiler v1.4.0";
  const hash = hashSource(body);
  const root = await buildFakeRoot({
    promptCompilerBody: body,
    versionConstant: "1.4.0",
    lockBody: JSON.stringify({ version: "1.4.0", promptCompilerSha256: hash }),
    changelogBody: "## 1.4.0\n",
  });
  const result = await runCheck({ packageRoot: root });
  assert.equal(result.ok, true, JSON.stringify(result.issues));
  assert.equal(result.currentVersion, "1.4.0");
  assert.equal(result.currentHash, hash);
});

test("runCheck: drifted hash without bump returns failure", async () => {
  const body = "// prompt-compiler v1.4.0";
  const root = await buildFakeRoot({
    promptCompilerBody: body,
    versionConstant: "1.4.0",
    lockBody: JSON.stringify({
      version: "1.4.0",
      promptCompilerSha256: "0".repeat(64),
    }),
    changelogBody: "## 1.4.0\n",
  });
  const result = await runCheck({ packageRoot: root });
  assert.equal(result.ok, false);
  assert.ok(result.issues.some((i) => /Content drift/.test(i)));
});

test("runCheck: missing version constant throws", async () => {
  const body = "// prompt-compiler";
  const hash = hashSource(body);
  const root = await mkdtemp(path.join(tmpdir(), "prompt-template-guard-"));
  await mkdir(path.join(root, "src/test-intelligence"), { recursive: true });
  await mkdir(path.join(root, "src/contracts"), { recursive: true });
  await mkdir(path.join(root, "docs"), { recursive: true });
  const paths = pathsForRoot(root);
  await writeFile(paths.promptCompiler, body, "utf8");
  await writeFile(paths.contracts, "// no constant here\n", "utf8");
  await writeFile(
    paths.lock,
    JSON.stringify({ version: "1.4.0", promptCompilerSha256: hash }),
    "utf8",
  );
  await writeFile(paths.changelog, "## 1.4.0\n", "utf8");
  await assert.rejects(
    () => runCheck({ packageRoot: root }),
    /Could not locate/,
  );
});

test("runCheck: missing changelog file errors out (defensive)", async () => {
  const body = "// prompt-compiler v1.4.0";
  const hash = hashSource(body);
  const root = await mkdtemp(path.join(tmpdir(), "prompt-template-guard-"));
  await mkdir(path.join(root, "src/test-intelligence"), { recursive: true });
  await mkdir(path.join(root, "src/contracts"), { recursive: true });
  await mkdir(path.join(root, "docs"), { recursive: true });
  const paths = pathsForRoot(root);
  await writeFile(paths.promptCompiler, body, "utf8");
  await writeFile(
    paths.contracts,
    `export const TEST_INTELLIGENCE_PROMPT_TEMPLATE_VERSION = "1.4.0" as const;\n`,
    "utf8",
  );
  await writeFile(
    paths.lock,
    JSON.stringify({ version: "1.4.0", promptCompilerSha256: hash }),
    "utf8",
  );
  // Intentionally do not create the changelog file.
  await assert.rejects(() => runCheck({ packageRoot: root }), /ENOENT/);
});
