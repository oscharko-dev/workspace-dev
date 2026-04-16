import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  loadInspectorPolicy,
  parseInspectorPolicy,
} from "./inspector-policy.js";

test("parseInspectorPolicy accepts governance alongside other policy sections", () => {
  const parsed = parseInspectorPolicy({
    quality: {
      maxAcceptableNodes: 8,
    },
    governance: {
      minQualityScoreToApply: 75,
      securitySensitivePatterns: ["password", "(auth)", "C++"],
      requireNoteOnOverride: false,
    },
  });

  assert.deepEqual(parsed, {
    quality: {
      maxAcceptableNodes: 8,
    },
    governance: {
      minQualityScoreToApply: 75,
      securitySensitivePatterns: ["password", "(auth)", "C++"],
      requireNoteOnOverride: false,
    },
  });
});

test("parseInspectorPolicy rejects governance with invalid shapes", () => {
  assert.equal(
    parseInspectorPolicy({
      governance: {
        securitySensitivePatterns: ["/admin", 42],
      },
    }),
    null,
  );
  assert.equal(
    parseInspectorPolicy({
      governance: {
        requireNoteOnOverride: "yes",
      },
    }),
    null,
  );
});

test("parseInspectorPolicy rejects likely regex-style governance patterns", () => {
  for (const pattern of [
    "(a+)+$",
    "^admin$",
    "auth.",
    "foo\\s+bar",
    "[a-z]+",
    "user|admin",
    ".*secret.*",
  ]) {
    assert.equal(
      parseInspectorPolicy({
        governance: {
          securitySensitivePatterns: [pattern],
        },
      }),
      null,
      `Expected '${pattern}' to be rejected`,
    );
  }
});

test("loadInspectorPolicy returns governance from the workspace policy file", async () => {
  const workspaceRoot = await mkdtemp(
    path.join(os.tmpdir(), "workspace-inspector-policy-"),
  );
  try {
    await writeFile(
      path.join(workspaceRoot, ".workspace-inspector-policy.json"),
      JSON.stringify({
        governance: {
          minQualityScoreToApply: null,
          securitySensitivePatterns: ["auth", "(auth)", "C++"],
          requireNoteOnOverride: true,
        },
      }),
      "utf8",
    );

    const loaded = await loadInspectorPolicy({ workspaceRoot });
    assert.deepEqual(loaded, {
      policy: {
        governance: {
          minQualityScoreToApply: null,
          securitySensitivePatterns: ["auth", "(auth)", "C++"],
          requireNoteOnOverride: true,
        },
      },
    });
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("loadInspectorPolicy ignores regex-style governance patterns", async () => {
  const workspaceRoot = await mkdtemp(
    path.join(os.tmpdir(), "workspace-inspector-policy-invalid-"),
  );
  try {
    await writeFile(
      path.join(workspaceRoot, ".workspace-inspector-policy.json"),
      JSON.stringify({
        governance: {
          securitySensitivePatterns: ["auth."],
        },
      }),
      "utf8",
    );

    const loaded = await loadInspectorPolicy({ workspaceRoot });
    assert.deepEqual(loaded, {
      policy: null,
      warning:
        "Inspector policy '.workspace-inspector-policy.json' has an invalid shape and was ignored.",
    });
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});
