import { test } from "node:test";
import assert from "node:assert";
import {
  BLOCKED_EXTENSIONS,
  SECRET_PATTERNS,
  classifyPath,
  isPragmaAllowlisted,
  parseStagedDiff,
  runGuard,
  scanContent,
} from "./check-secrets.mjs";

// ── classifyPath ────────────────────────────────────────────────────────────

test("classifyPath: allows ordinary source files", () => {
  assert.strictEqual(classifyPath("src/server/index.ts"), null);
  assert.strictEqual(classifyPath("README.md"), null);
  assert.strictEqual(classifyPath("package.json"), null);
});

test("classifyPath: blocks .env but allows .env.example and .env.sample", () => {
  assert.ok(classifyPath(".env"));
  assert.ok(classifyPath(".env.production"));
  assert.ok(classifyPath("apps/api/.env.local"));
  assert.strictEqual(classifyPath(".env.example"), null);
  assert.strictEqual(classifyPath(".env.sample"), null);
  assert.strictEqual(classifyPath("apps/api/.env.example"), null);
});

test("classifyPath: blocks tenant-metadata directories", () => {
  for (const blocked of [
    "infra/main.tf",
    ".codex/session.json",
    ".claude/settings.json",
    ".intent/plan.md",
    ".playwright-mcp/config.yaml",
    ".vscode/settings.json",
    ".idea/workspace.xml",
    "sandbox/notes.txt",
    "testdata/tenant.json",
  ]) {
    const result = classifyPath(blocked);
    assert.ok(result, `expected ${blocked} to be blocked`);
    assert.match(result.reason, /tenant-metadata directory/);
  }
});

test("classifyPath: blocks known secret filenames anywhere in tree", () => {
  for (const basename of [
    "id_rsa",
    "id_ed25519",
    "credentials",
    "credentials.json",
    "secrets.yaml",
    "service-account.json",
    "AGENTS.md",
    "CLAUDE.md",
    "mcp.json",
    ".mcp.json",
  ]) {
    assert.ok(classifyPath(basename), `${basename} should be blocked at root`);
    assert.ok(
      classifyPath(`some/dir/${basename}`),
      `${basename} should be blocked in subdir`,
    );
  }
});

test("classifyPath: blocks extensions reserved for keys/certs", () => {
  for (const ext of BLOCKED_EXTENSIONS) {
    const result = classifyPath(`certs/server${ext}`);
    assert.ok(result, `${ext} should be blocked`);
    assert.match(result.reason, /extension/);
  }
});

test("classifyPath: is case-insensitive for extensions", () => {
  assert.ok(classifyPath("certs/server.PEM"));
  assert.ok(classifyPath("certs/server.Key"));
});

test("classifyPath: handles empty / invalid input gracefully", () => {
  assert.strictEqual(classifyPath(""), null);
  assert.strictEqual(classifyPath(undefined), null);
  assert.strictEqual(classifyPath(null), null);
});

// ── isPragmaAllowlisted ─────────────────────────────────────────────────────

test("isPragmaAllowlisted: recognises comment styles", () => {
  assert.strictEqual(
    isPragmaAllowlisted(
      "const token = 'AKIA000000000000EXMP'; // pragma: allowlist secret",
    ),
    true,
  );
  assert.strictEqual(
    isPragmaAllowlisted(
      "TOKEN=AKIA000000000000EXMP # pragma: allowlist secret",
    ),
    true,
  );
  assert.strictEqual(
    isPragmaAllowlisted("/* pragma: allowlist secret */"),
    true,
  );
  assert.strictEqual(
    isPragmaAllowlisted("<!-- pragma: allowlist secret -->"),
    true,
  );
  assert.strictEqual(
    isPragmaAllowlisted("const token = 'AKIA000000000000EXMP';"), // pragma: allowlist secret
    false,
  );
});

// ── scanContent: credential patterns ────────────────────────────────────────

test("scanContent: detects AWS access key IDs", () => {
  const findings = scanContent("const k = 'AKIAIOSFODNN7EXAMPLE';"); // pragma: allowlist secret
  assert.strictEqual(findings.length, 1);
  assert.strictEqual(findings[0].patternId, "aws-access-key-id");
});

test("scanContent: detects GitHub PATs", () => {
  const pat = `ghp_${"A".repeat(40)}`;
  const findings = scanContent(`export GITHUB_TOKEN=${pat}`);
  assert.strictEqual(findings.length, 1);
  assert.strictEqual(findings[0].patternId, "github-pat");
});

test("scanContent: detects Figma PATs", () => {
  const pat = `figd_${"A1b2C3d4E5f6G7h8".repeat(2)}`;
  const findings = scanContent(`FIGMA_TOKEN=${pat}`);
  assert.strictEqual(findings.length, 1);
  assert.strictEqual(findings[0].patternId, "figma-pat");
});

test("scanContent: detects Google API keys", () => {
  const key = `AIza${"B".repeat(35)}`;
  const findings = scanContent(`apiKey: "${key}"`);
  assert.strictEqual(findings.length, 1);
  assert.strictEqual(findings[0].patternId, "google-api-key");
});

test("scanContent: detects GCP service-account JSON marker", () => {
  const findings = scanContent(
    '{ "type": "service_account", "project_id": "x" }', // pragma: allowlist secret
  );
  assert.strictEqual(findings.length, 1);
  assert.strictEqual(findings[0].patternId, "gcp-service-account");
});

test("scanContent: detects Slack tokens", () => {
  const findings = scanContent('SLACK="xoxb-1234567890-abcdefghij"'); // pragma: allowlist secret
  assert.strictEqual(findings.length, 1);
  assert.strictEqual(findings[0].patternId, "slack-token");
});

test("scanContent: detects Anthropic API keys", () => {
  const key = `sk-ant-api03-${"A".repeat(90)}`;
  const findings = scanContent(`ANTHROPIC_API_KEY=${key}`);
  assert.ok(findings.some((f) => f.patternId === "anthropic-api-key"));
});

test("scanContent: detects Stripe secret keys", () => {
  const findings = scanContent(`const k = "sk_live_${"A".repeat(24)}";`);
  assert.strictEqual(findings.length, 1);
  assert.strictEqual(findings[0].patternId, "stripe-secret-key");
});

test("scanContent: detects JWTs", () => {
  const jwt =
    "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c"; // pragma: allowlist secret
  const findings = scanContent(`Authorization: Bearer ${jwt}`);
  assert.ok(findings.some((f) => f.patternId === "jwt"));
});

test("scanContent: detects PEM private keys", () => {
  const findings = scanContent("-----BEGIN OPENSSH PRIVATE KEY-----"); // pragma: allowlist secret
  assert.strictEqual(findings.length, 1);
  assert.strictEqual(findings[0].patternId, "private-key-pem");
});

test("scanContent: detects basic-auth URLs", () => {
  const findings = scanContent(
    "DATABASE_URL=postgres://admin:hunter2@db.example.com:5432/prod", // pragma: allowlist secret
  );
  assert.ok(findings.some((f) => f.patternId === "basic-auth-url"));
});

test("scanContent: detects Azure storage keys", () => {
  const conn =
    "DefaultEndpointsProtocol=https;AccountName=foo;AccountKey=abcdefghijklmnopqrstuvwxyz0123456789=="; // pragma: allowlist secret
  const findings = scanContent(conn);
  assert.ok(findings.some((f) => f.patternId === "azure-storage-key"));
});

test("scanContent: detects npm tokens", () => {
  const token = `npm_${"A".repeat(36)}`;
  const findings = scanContent(`//registry.npmjs.org/:_authToken=${token}`);
  assert.ok(findings.some((f) => f.patternId === "npm-token"));
});

test("scanContent: respects per-line pragma allowlist", () => {
  const line = `AWS_KEY=AKIAIOSFODNN7EXAMPLE # pragma: allowlist secret`;
  assert.deepStrictEqual(scanContent(line), []);
});

test("scanContent: ignores public Figma presigned thumbnail credential scope", () => {
  const line =
    '"thumbnailUrl": "https://s3-alpha.figma.com/thumbnails/example?X-Amz-Credential=AKIAQ4GOSFWCYKED6IIG%2F20260412%2Fus-west-2%2Fs3%2Faws4_request"';
  assert.deepStrictEqual(scanContent(line), []);
});

test("scanContent: reports 1-indexed line numbers relative to startLine", () => {
  const content = "ok\nok\nAKIAIOSFODNN7EXAMPLE"; // pragma: allowlist secret
  const findings = scanContent(content, { filename: "x", startLine: 10 });
  assert.strictEqual(findings.length, 1);
  assert.strictEqual(findings[0].line, 12);
  assert.strictEqual(findings[0].file, "x");
});

test("scanContent: ignores empty input", () => {
  assert.deepStrictEqual(scanContent(""), []);
  assert.deepStrictEqual(scanContent(null), []);
});

test("SECRET_PATTERNS: every entry has id, description, pattern", () => {
  for (const entry of SECRET_PATTERNS) {
    assert.ok(typeof entry.id === "string" && entry.id.length > 0);
    assert.ok(
      typeof entry.description === "string" && entry.description.length > 0,
    );
    assert.ok(entry.pattern instanceof RegExp);
  }
});

test("runGuard: --all scans tracked file content", () => {
  const stderr = [];
  const exitCode = runGuard({
    all: true,
    cwd: "/repo",
    env: {},
    execFile(command, args) {
      assert.strictEqual(command, "git");
      assert.deepStrictEqual(args, ["ls-files", "-z"]);
      return "src/clean.ts\0src/leak.ts\0";
    },
    readTextFile(filePath) {
      if (filePath.endsWith("src/clean.ts")) {
        return "export const ok = true;\n";
      }
      if (filePath.endsWith("src/leak.ts")) {
        return "export const token = 'AKIAIOSFODNN7EXAMPLE';\n"; // pragma: allowlist secret
      }
      throw new Error(`unexpected read: ${filePath}`);
    },
    stdout() {},
    stderr(message) {
      stderr.push(message);
    },
  });

  assert.strictEqual(exitCode, 1);
  assert.ok(stderr.some((line) => line.includes("src/leak.ts:1")));
});

test("runGuard: --all reports blocked tracked paths", () => {
  const stderr = [];
  const exitCode = runGuard({
    all: true,
    cwd: "/repo",
    env: {},
    execFile() {
      return ".env\0src/index.ts\0";
    },
    readTextFile() {
      return "export const ok = true;\n";
    },
    stdout() {},
    stderr(message) {
      stderr.push(message);
    },
  });

  assert.strictEqual(exitCode, 1);
  assert.ok(stderr.some((line) => line.includes(".env")));
});

// ── parseStagedDiff ─────────────────────────────────────────────────────────

test("parseStagedDiff: extracts only added lines with file and line number", () => {
  const diff = [
    "diff --git a/src/a.ts b/src/a.ts",
    "index 1111111..2222222 100644",
    "--- a/src/a.ts",
    "+++ b/src/a.ts",
    "@@ -0,0 +1,2 @@",
    "+const x = 1;",
    "+const y = 2;",
    "diff --git a/src/b.ts b/src/b.ts",
    "index 3333333..4444444 100644",
    "--- a/src/b.ts",
    "+++ b/src/b.ts",
    "@@ -10,0 +11 @@",
    "+const z = 3;",
    "",
  ].join("\n");

  const added = parseStagedDiff(diff);
  assert.deepStrictEqual(added, [
    { file: "src/a.ts", line: 1, content: "const x = 1;" },
    { file: "src/a.ts", line: 2, content: "const y = 2;" },
    { file: "src/b.ts", line: 11, content: "const z = 3;" },
  ]);
});

test("parseStagedDiff: discards removed lines and context", () => {
  const diff = [
    "diff --git a/f b/f",
    "--- a/f",
    "+++ b/f",
    "@@ -1,2 +1,2 @@",
    "-old line",
    "+new line",
    " context line",
    "",
  ].join("\n");
  const added = parseStagedDiff(diff);
  assert.strictEqual(added.length, 1);
  assert.strictEqual(added[0].content, "new line");
  assert.strictEqual(added[0].line, 1);
});

test("parseStagedDiff: ignores file deletions (+++ /dev/null)", () => {
  const diff = [
    "diff --git a/gone.txt b/gone.txt",
    "deleted file mode 100644",
    "--- a/gone.txt",
    "+++ /dev/null",
    "@@ -1 +0,0 @@",
    "-bye",
    "",
  ].join("\n");
  assert.deepStrictEqual(parseStagedDiff(diff), []);
});

test("parseStagedDiff: returns [] for empty or non-string input", () => {
  assert.deepStrictEqual(parseStagedDiff(""), []);
  assert.deepStrictEqual(parseStagedDiff(undefined), []);
});

// ── runGuard: end-to-end with injected execFile ─────────────────────────────

const makeExecFile = ({ files = "", diff = "" } = {}) => {
  return (cmd, args) => {
    if (cmd !== "git") {
      throw new Error(`unexpected command ${cmd}`);
    }
    if (args[0] === "diff" && args.includes("--name-only")) {
      return files;
    }
    if (args[0] === "diff") {
      return diff;
    }
    throw new Error(`unexpected git invocation: ${args.join(" ")}`);
  };
};

test("runGuard: exits 0 when no staged files", () => {
  const out = [];
  const err = [];
  const code = runGuard({
    cwd: "/tmp",
    env: {},
    execFile: makeExecFile({ files: "" }),
    stdout: (m) => out.push(m),
    stderr: (m) => err.push(m),
  });
  assert.strictEqual(code, 0);
  assert.strictEqual(err.length, 0);
});

test("runGuard: exits 0 when clean diff", () => {
  const diff = [
    "diff --git a/src/a.ts b/src/a.ts",
    "--- a/src/a.ts",
    "+++ b/src/a.ts",
    "@@ -0,0 +1 @@",
    "+const x = 1;",
    "",
  ].join("\n");
  const code = runGuard({
    cwd: "/tmp",
    env: {},
    execFile: makeExecFile({ files: "src/a.ts\0", diff }),
    stdout: () => {},
    stderr: () => {},
  });
  assert.strictEqual(code, 0);
});

test("runGuard: exits 1 on blocked path", () => {
  const err = [];
  const code = runGuard({
    cwd: "/tmp",
    env: {},
    execFile: makeExecFile({ files: "infra/main.tf\0" }),
    stdout: () => {},
    stderr: (m) => err.push(m),
  });
  assert.strictEqual(code, 1);
  assert.ok(err.some((m) => m.includes("infra/main.tf")));
});

test("runGuard: exits 1 on credential in staged diff", () => {
  const diff = [
    "diff --git a/src/config.ts b/src/config.ts",
    "--- a/src/config.ts",
    "+++ b/src/config.ts",
    "@@ -0,0 +1 @@",
    "+export const awsKey = 'AKIAIOSFODNN7EXAMPLE';", // pragma: allowlist secret
    "",
  ].join("\n");
  const err = [];
  const code = runGuard({
    cwd: "/tmp",
    env: {},
    execFile: makeExecFile({ files: "src/config.ts\0", diff }),
    stdout: () => {},
    stderr: (m) => err.push(m),
  });
  assert.strictEqual(code, 1);
  assert.ok(err.some((m) => m.includes("aws-access-key-id")));
});

test("runGuard: allows credentials inside .env.example", () => {
  const diff = [
    "diff --git a/.env.example b/.env.example",
    "--- a/.env.example",
    "+++ b/.env.example",
    "@@ -0,0 +1 @@",
    "+AWS_KEY=AKIAIOSFODNN7EXAMPLE", // pragma: allowlist secret
    "",
  ].join("\n");
  const code = runGuard({
    cwd: "/tmp",
    env: {},
    execFile: makeExecFile({ files: ".env.example\0", diff }),
    stdout: () => {},
    stderr: () => {},
  });
  assert.strictEqual(code, 0);
});

test("runGuard: skipped via env flag", () => {
  const out = [];
  const code = runGuard({
    cwd: "/tmp",
    env: { WORKSPACE_DEV_SKIP_SECRET_SCAN: "true" },
    execFile: () => {
      throw new Error("must not be called");
    },
    stdout: (m) => out.push(m),
    stderr: () => {},
  });
  assert.strictEqual(code, 0);
  assert.ok(out.some((m) => m.includes("Skipped")));
});

test("runGuard: returns 1 when git listing fails", () => {
  const err = [];
  const code = runGuard({
    cwd: "/tmp",
    env: {},
    execFile: () => {
      throw new Error("git not available");
    },
    stdout: () => {},
    stderr: (m) => err.push(m),
  });
  assert.strictEqual(code, 1);
  assert.ok(err.some((m) => m.includes("Unable to list staged files")));
});
