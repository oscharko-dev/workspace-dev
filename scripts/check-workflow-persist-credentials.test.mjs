import { test } from "node:test";
import assert from "node:assert";
import { scanWorkflowContent } from "./check-workflow-persist-credentials.mjs";

// ── scanWorkflowContent: clean cases ────────────────────────────────────────

test("scanWorkflowContent: no findings for checkout with persist-credentials: false", () => {
  const content = [
    "    steps:",
    "      - uses: actions/checkout@abc123  # v6",
    "        with:",
    "          persist-credentials: false",
    "      - uses: pnpm/action-setup@abc123  # v6",
  ].join("\n");

  assert.deepStrictEqual(scanWorkflowContent(content), []);
});

test("scanWorkflowContent: no findings when file has no checkout step", () => {
  const content = [
    "    steps:",
    "      - uses: actions/setup-node@abc123",
    "        with:",
    "          node-version: 22",
    "      - run: pnpm install --frozen-lockfile --ignore-scripts",
  ].join("\n");

  assert.deepStrictEqual(scanWorkflowContent(content), []);
});

test("scanWorkflowContent: multiple compliant checkouts return no findings", () => {
  const content = [
    "    steps:",
    "      - uses: actions/checkout@abc123",
    "        with:",
    "          persist-credentials: false",
    "      - uses: actions/checkout@abc123",
    "        with:",
    "          persist-credentials: false",
    "          fetch-depth: 0",
  ].join("\n");

  assert.deepStrictEqual(scanWorkflowContent(content), []);
});

// ── scanWorkflowContent: violation cases ────────────────────────────────────

test("scanWorkflowContent: flags checkout with no with block", () => {
  const content = [
    "    steps:",
    "      - uses: actions/checkout@abc123  # v6",
    "",
    "      - uses: pnpm/action-setup@abc123",
  ].join("\n");

  const findings = scanWorkflowContent(content);
  assert.strictEqual(findings.length, 1);
  assert.strictEqual(findings[0].line, 2);
  assert.strictEqual(
    findings[0].reason,
    "missing explicit persist-credentials: false",
  );
});

test("scanWorkflowContent: flags checkout with with block missing persist-credentials", () => {
  const content = [
    "    steps:",
    "      - uses: actions/checkout@abc123",
    "        with:",
    "          fetch-depth: 0",
    "      - run: pnpm install",
  ].join("\n");

  const findings = scanWorkflowContent(content);
  assert.strictEqual(findings.length, 1);
  assert.strictEqual(
    findings[0].reason,
    "missing explicit persist-credentials: false",
  );
});

test("scanWorkflowContent: flags checkout with persist-credentials: true in non-allowlisted file", () => {
  const content = [
    "    steps:",
    "      - uses: actions/checkout@abc123",
    "        with:",
    "          persist-credentials: true",
  ].join("\n");

  const findings = scanWorkflowContent(content, "some-other-workflow.yml");
  assert.strictEqual(findings.length, 1);
  assert.strictEqual(
    findings[0].reason,
    "persist-credentials: true requires explicit allowlist entry",
  );
});

test("scanWorkflowContent: reports 1-indexed line number", () => {
  const content = [
    "name: sample",
    "jobs:",
    "  a:",
    "    steps:",
    "      - uses: actions/checkout@abc123",
    "",
    "      - run: echo done",
  ].join("\n");

  const findings = scanWorkflowContent(content);
  assert.strictEqual(findings.length, 1);
  assert.strictEqual(findings[0].line, 5);
});

test("scanWorkflowContent: reports trimmed content", () => {
  const content = [
    "      - uses: actions/checkout@de0fac2e4500  # v6",
    "",
    "      - uses: pnpm/action-setup@abc123",
  ].join("\n");

  const findings = scanWorkflowContent(content);
  assert.strictEqual(findings.length, 1);
  assert.strictEqual(
    findings[0].content,
    "- uses: actions/checkout@de0fac2e4500  # v6",
  );
});

test("scanWorkflowContent: counts multiple violations in one file", () => {
  const content = [
    "    steps:",
    "      - uses: actions/checkout@abc123",
    "",
    "      - run: first",
    "    steps2:",
    "      - uses: actions/checkout@abc123",
    "",
    "      - run: second",
  ].join("\n");

  const findings = scanWorkflowContent(content);
  assert.strictEqual(findings.length, 2);
});

test("scanWorkflowContent: ignores yaml comment lines containing checkout", () => {
  const content = [
    "    steps:",
    "      # - uses: actions/checkout@abc123",
    "      - uses: actions/checkout@abc123",
    "        with:",
    "          persist-credentials: false",
  ].join("\n");

  assert.deepStrictEqual(scanWorkflowContent(content), []);
});

// ── scanWorkflowContent: allowlist cases ────────────────────────────────────

test("scanWorkflowContent: allows persist-credentials: true in allowlisted file", () => {
  const content = [
    "    steps:",
    "      - uses: actions/checkout@abc123",
    "        with:",
    "          persist-credentials: true",
  ].join("\n");

  assert.deepStrictEqual(
    scanWorkflowContent(content, ".github/workflows/changesets-release.yml"),
    [],
  );
});

test("scanWorkflowContent: still flags missing key even in allowlisted file", () => {
  const content = [
    "    steps:",
    "      - uses: actions/checkout@abc123",
    "",
    "      - run: echo done",
  ].join("\n");

  const findings = scanWorkflowContent(
    content,
    ".github/workflows/changesets-release.yml",
  );
  assert.strictEqual(findings.length, 1);
  assert.strictEqual(
    findings[0].reason,
    "missing explicit persist-credentials: false",
  );
});
