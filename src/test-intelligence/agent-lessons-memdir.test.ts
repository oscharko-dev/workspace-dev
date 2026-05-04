import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  AGENT_LESSON_FRESHNESS_THRESHOLD_MS,
  AGENT_LESSON_FRONTMATTER_SCHEMA_VERSION,
  AGENT_LESSON_REVIEW_STATE_APPROVED,
  AGENT_LESSON_STORAGE_BACKENDS,
  AGENT_LESSON_STORAGE_DEFAULT,
  AGENT_LESSON_STORAGE_DEPRECATED_BACKENDS,
  ensureLessonsDir,
  freshnessNote,
  getAgentLessonPath,
  isAgentLessonStorageDeprecated,
  parseAgentLessonFrontmatter,
  scanLessons,
  selectRelevantLessons,
  serializeAgentLessonFrontmatter,
  validateLessonWritePath,
  writeAgentLesson,
  type AgentLessonFrontmatter,
  type AgentLessonRecord,
} from "./agent-lessons-memdir.js";

const sha256Hex = (value: string): string =>
  createHash("sha256").update(value).digest("hex");

const NOW = Date.parse("2026-05-04T12:00:00.000Z");

const withRunDir = async (
  fn: (runDir: string) => Promise<void>,
): Promise<void> => {
  const runDir = await mkdtemp(
    join(tmpdir(), "wd-lesson-memdir-test-1789-"),
  );
  try {
    await fn(runDir);
  } finally {
    await rm(runDir, { recursive: true, force: true });
  }
};

const baseInput = (id: string, name: string, body: string) => ({
  id,
  name,
  description: `description for ${name}`,
  type: "feedback" as const,
  policyProfileScope: ["banking-eu"],
  approvedBy: ["reviewer-1"],
  body,
  nowMs: NOW,
});

// ---------------------------------------------------------------------------
// Storage backend constants
// ---------------------------------------------------------------------------

test("lessonsStorage memdir is the default; flat_json is deprecated", () => {
  assert.equal(AGENT_LESSON_STORAGE_DEFAULT, "memdir");
  assert.deepEqual([...AGENT_LESSON_STORAGE_BACKENDS].sort(), [
    "flat_json",
    "memdir",
  ]);
  assert.deepEqual([...AGENT_LESSON_STORAGE_DEPRECATED_BACKENDS], ["flat_json"]);
  assert.equal(isAgentLessonStorageDeprecated("flat_json"), true);
  assert.equal(isAgentLessonStorageDeprecated("memdir"), false);
});

// ---------------------------------------------------------------------------
// validateLessonWritePath — AT-033 path-traversal refusal
// ---------------------------------------------------------------------------

test("validateLessonWritePath refuses parent-directory traversal", async () => {
  await withRunDir(async (runDir) => {
    const dir = await ensureLessonsDir(runDir);
    const result = await validateLessonWritePath({
      lessonsDir: dir,
      name: "../etc/passwd",
    });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, "lesson_path_traversal_refused");
  });
});

test("validateLessonWritePath refuses null bytes", async () => {
  await withRunDir(async (runDir) => {
    const dir = await ensureLessonsDir(runDir);
    const result = await validateLessonWritePath({
      lessonsDir: dir,
      name: "lesson\0.md",
    });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, "lesson_path_null_byte_refused");
  });
});

test("validateLessonWritePath refuses %2e (percent-encoded dot)", async () => {
  await withRunDir(async (runDir) => {
    const dir = await ensureLessonsDir(runDir);
    const result = await validateLessonWritePath({
      lessonsDir: dir,
      name: "%2e%2e/passwd",
    });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, "lesson_path_percent_encoded_refused");
  });
});

test("validateLessonWritePath refuses full-width Unicode dot/slash", async () => {
  await withRunDir(async (runDir) => {
    const dir = await ensureLessonsDir(runDir);
    const result = await validateLessonWritePath({
      lessonsDir: dir,
      name: "\u{ff0e}\u{ff0e}\u{ff0f}etc",
    });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, "lesson_path_unicode_traversal_refused");
  });
});

test("validateLessonWritePath refuses backslashes", async () => {
  await withRunDir(async (runDir) => {
    const dir = await ensureLessonsDir(runDir);
    const result = await validateLessonWritePath({
      lessonsDir: dir,
      name: "..\\etc\\passwd",
    });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, "lesson_path_backslash_refused");
  });
});

test("validateLessonWritePath refuses absolute paths", async () => {
  await withRunDir(async (runDir) => {
    const dir = await ensureLessonsDir(runDir);
    const result = await validateLessonWritePath({
      lessonsDir: dir,
      name: "/etc/passwd",
    });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, "lesson_path_absolute_refused");
  });
});

test("validateLessonWritePath refuses windows-style drive prefix", async () => {
  await withRunDir(async (runDir) => {
    const dir = await ensureLessonsDir(runDir);
    const result = await validateLessonWritePath({
      lessonsDir: dir,
      name: "C:lesson.md",
    });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, "lesson_path_absolute_refused");
  });
});

test("validateLessonWritePath refuses empty names", async () => {
  await withRunDir(async (runDir) => {
    const dir = await ensureLessonsDir(runDir);
    const result = await validateLessonWritePath({ lessonsDir: dir, name: "" });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, "lesson_path_empty_refused");
  });
});

test("validateLessonWritePath catches symlink escape via realpath walk", async () => {
  await withRunDir(async (runDir) => {
    const dir = await ensureLessonsDir(runDir);
    // Plant a symlink inside the lessons dir that points outside.
    const escape = await mkdtemp(join(tmpdir(), "wd-lesson-escape-"));
    try {
      await symlink(escape, join(dir, "esc"));
      const result = await validateLessonWritePath({
        lessonsDir: dir,
        name: "esc/lesson.md",
      });
      assert.equal(result.ok, false);
      if (result.ok) return;
      assert.equal(result.code, "lesson_path_symlink_escape_refused");
    } finally {
      await rm(escape, { recursive: true, force: true });
    }
  });
});

test("validateLessonWritePath accepts well-formed names", async () => {
  await withRunDir(async (runDir) => {
    const dir = await ensureLessonsDir(runDir);
    const result = await validateLessonWritePath({
      lessonsDir: dir,
      name: "ok-lesson.md",
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.ok(result.resolvedPath.endsWith("ok-lesson.md"));
  });
});

// ---------------------------------------------------------------------------
// Frontmatter round-trip and validation
// ---------------------------------------------------------------------------

test("frontmatter round-trip is byte-stable", () => {
  const frontmatter: AgentLessonFrontmatter = {
    schemaVersion: AGENT_LESSON_FRONTMATTER_SCHEMA_VERSION,
    id: "lesson-001",
    name: "auth-token-redaction",
    description: "Always redact session tokens before persisting findings",
    type: "regulatory",
    policyProfileScope: ["banking-eu", "banking-uk"],
    mtimeMs: NOW,
    reviewState: AGENT_LESSON_REVIEW_STATE_APPROVED,
    approvedBy: ["reviewer-a", "reviewer-b"],
    contentHash: sha256Hex("body content"),
  };
  const text = `${serializeAgentLessonFrontmatter(frontmatter)}body content\n`;
  const parsed = parseAgentLessonFrontmatter(text);
  assert.deepEqual(parsed.frontmatter, frontmatter);
  // Re-serialise and confirm bytes match.
  const reserialised = serializeAgentLessonFrontmatter(parsed.frontmatter);
  assert.equal(
    reserialised,
    serializeAgentLessonFrontmatter(frontmatter),
  );
});

test("frontmatter parser rejects missing closing fence", () => {
  assert.throws(() => {
    parseAgentLessonFrontmatter(`---\nid: foo\n`);
  }, /missing closing/);
});

test("frontmatter parser rejects unknown schemaVersion", () => {
  const text = [
    "---",
    'schemaVersion: "9.0.0"',
    "id: x",
    "name: y",
    'description: ""',
    "type: feedback",
    "policyProfileScope:",
    "  - banking-eu",
    "mtimeMs: 1",
    "reviewState: reviewer_approved",
    "approvedBy:",
    "  - reviewer",
    `contentHash: ${sha256Hex("a")}`,
    "---",
    "",
  ].join("\n");
  assert.throws(() => parseAgentLessonFrontmatter(text), /schemaVersion/);
});

test("frontmatter parser rejects CR characters", () => {
  assert.throws(() => {
    parseAgentLessonFrontmatter(`---\r\nid: x\r\n---\r\n`);
  }, /CR characters/);
});

// ---------------------------------------------------------------------------
// writeAgentLesson + scanLessons happy path
// ---------------------------------------------------------------------------

test("writeAgentLesson persists a lesson and scanLessons reads it back", async () => {
  await withRunDir(async (runDir) => {
    const result = await writeAgentLesson({
      runDir,
      ...baseInput("lesson-001", "redact-tokens", "Redact session tokens.\n"),
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    const lexical = getAgentLessonPath(runDir, "lesson-001");
    // realpath may resolve macOS /var → /private/var; assert by suffix.
    assert.ok(
      result.filePath.endsWith(
        lexical.replace(/^\/private/, ""),
      ) || result.filePath === lexical,
    );
    assert.equal(
      result.frontmatter.contentHash,
      sha256Hex("Redact session tokens.\n"),
    );
    const manifest = await scanLessons({ runDir, nowMs: NOW });
    assert.equal(manifest.length, 1);
    const first = manifest[0] as AgentLessonRecord;
    assert.equal(first.frontmatter.id, "lesson-001");
    assert.equal(first.frontmatter.name, "redact-tokens");
    assert.equal(first.bodyTruncated, false);
    assert.equal(first.freshnessNote, undefined);
  });
});

test("scanLessons reads at most 30 lines per file", async () => {
  await withRunDir(async (runDir) => {
    // Persist a lesson via writeAgentLesson so we get valid frontmatter,
    // then append additional lines manually.
    const persisted = await writeAgentLesson({
      runDir,
      ...baseInput(
        "lesson-long",
        "long-lesson",
        Array.from({ length: 200 }, (_, i) => `body line ${i}`).join("\n") +
          "\n",
      ),
    });
    assert.equal(persisted.ok, true);
    if (!persisted.ok) return;
    const manifest = await scanLessons({ runDir, nowMs: NOW });
    const first = manifest[0] as AgentLessonRecord;
    // First 30 lines include opening fence + frontmatter + closing fence +
    // at most a handful of body lines. Total lines <= 30.
    const totalScannedLines = first.bodyPreviewLines.length;
    assert.ok(totalScannedLines <= 30 - 0);
    assert.equal(first.bodyTruncated, true);
  });
});

// ---------------------------------------------------------------------------
// supersedes enforcement (mutation requires prior contentHash)
// ---------------------------------------------------------------------------

test("writing the same name twice without supersedes is refused", async () => {
  await withRunDir(async (runDir) => {
    const first = await writeAgentLesson({
      runDir,
      ...baseInput("lesson-001", "auth-rule", "first body\n"),
    });
    assert.equal(first.ok, true);
    if (!first.ok) return;
    const second = await writeAgentLesson({
      runDir,
      ...baseInput("lesson-002", "auth-rule", "second body\n"),
    });
    assert.equal(second.ok, false);
    if (second.ok) return;
    assert.equal(second.code, "lesson_supersedes_required");
  });
});

test("writing the same name with the wrong supersedes is refused", async () => {
  await withRunDir(async (runDir) => {
    const first = await writeAgentLesson({
      runDir,
      ...baseInput("lesson-001", "auth-rule", "first body\n"),
    });
    assert.equal(first.ok, true);
    if (!first.ok) return;
    const second = await writeAgentLesson({
      runDir,
      ...baseInput("lesson-002", "auth-rule", "second body\n"),
      supersedes: "0".repeat(64),
    });
    assert.equal(second.ok, false);
    if (second.ok) return;
    assert.equal(second.code, "lesson_supersedes_unknown_predecessor");
  });
});

test("writing the same name with the correct supersedes succeeds", async () => {
  await withRunDir(async (runDir) => {
    const first = await writeAgentLesson({
      runDir,
      ...baseInput("lesson-001", "auth-rule", "first body\n"),
    });
    assert.equal(first.ok, true);
    if (!first.ok) return;
    const second = await writeAgentLesson({
      runDir,
      ...baseInput("lesson-002", "auth-rule", "second body\n"),
      supersedes: first.frontmatter.contentHash,
    });
    assert.equal(second.ok, true);
    if (!second.ok) return;
    assert.equal(second.frontmatter.supersedes, first.frontmatter.contentHash);
  });
});

// ---------------------------------------------------------------------------
// freshnessNote
// ---------------------------------------------------------------------------

test("freshnessNote is undefined for fresh lessons (<24h)", () => {
  const now = NOW;
  assert.equal(
    freshnessNote({ mtimeMs: now - 1000, nowMs: now }),
    undefined,
  );
  assert.equal(
    freshnessNote({
      mtimeMs: now - AGENT_LESSON_FRESHNESS_THRESHOLD_MS + 60_000,
      nowMs: now,
    }),
    undefined,
  );
});

test("freshnessNote wraps lessons older than 24h", () => {
  const now = NOW;
  const note = freshnessNote({
    mtimeMs: now - AGENT_LESSON_FRESHNESS_THRESHOLD_MS - 1000,
    nowMs: now,
  });
  assert.ok(note !== undefined);
  assert.match(note ?? "", /freshness/);
  assert.match(note ?? "", /\d+h old/);
});

test("scanLessons attaches freshnessNote when stale", async () => {
  await withRunDir(async (runDir) => {
    const old = NOW - AGENT_LESSON_FRESHNESS_THRESHOLD_MS - 60_000;
    const persisted = await writeAgentLesson({
      runDir,
      ...baseInput("lesson-old", "old-lesson", "stale\n"),
      nowMs: old,
    });
    assert.equal(persisted.ok, true);
    const manifest = await scanLessons({ runDir, nowMs: NOW });
    const record = manifest[0] as AgentLessonRecord;
    assert.ok(record.freshnessNote !== undefined);
  });
});

// ---------------------------------------------------------------------------
// selectRelevantLessons (deterministic)
// ---------------------------------------------------------------------------

test("selectRelevantLessons is deterministic and respects max", async () => {
  await withRunDir(async (runDir) => {
    const ids = ["a", "b", "c", "d", "e", "f"];
    for (const id of ids) {
      const result = await writeAgentLesson({
        runDir,
        ...baseInput(`lesson-${id}`, `name-${id}`, `body ${id}\n`),
      });
      assert.equal(result.ok, true);
    }
    const manifest = await scanLessons({ runDir, nowMs: NOW });
    const picks1 = selectRelevantLessons({
      query: { tokens: ["name", "lesson"] },
      manifest,
      max: 3,
    });
    const picks2 = selectRelevantLessons({
      query: { tokens: ["name", "lesson"] },
      manifest,
      max: 3,
    });
    assert.equal(picks1.length, 3);
    assert.deepEqual(
      picks1.map((p) => p.frontmatter.id),
      picks2.map((p) => p.frontmatter.id),
    );
  });
});

test("selectRelevantLessons filters by policyProfileId when provided", async () => {
  await withRunDir(async (runDir) => {
    const persisted1 = await writeAgentLesson({
      runDir,
      ...baseInput("a", "alpha", "body a\n"),
    });
    assert.equal(persisted1.ok, true);
    const persisted2 = await writeAgentLesson({
      runDir,
      id: "b",
      name: "beta",
      description: "second",
      type: "feedback",
      policyProfileScope: ["banking-uk"],
      approvedBy: ["reviewer-1"],
      body: "body b\n",
      nowMs: NOW,
    });
    assert.equal(persisted2.ok, true);
    const manifest = await scanLessons({ runDir, nowMs: NOW });
    const ukPicks = selectRelevantLessons({
      query: { tokens: ["alpha", "beta"], policyProfileId: "banking-uk" },
      manifest,
      max: 5,
    });
    assert.deepEqual(
      ukPicks.map((p) => p.frontmatter.id),
      ["b"],
    );
  });
});

// ---------------------------------------------------------------------------
// AT-033: full-system path-traversal refusal at the write helper
// ---------------------------------------------------------------------------

test("AT-033: writeAgentLesson refuses traversal-named id", async () => {
  await withRunDir(async (runDir) => {
    // Force an unsafe id to confirm the lessonFilename guard fires.
    await assert.rejects(async () => {
      await writeAgentLesson({
        runDir,
        ...baseInput(
          "../../../etc/passwd",
          "name-x",
          "body\n",
        ),
      });
    }, /unsafe characters/);
  });
});
