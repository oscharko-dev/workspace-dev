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
      bandThresholds: {
        excellent: 100,
        good: 80,
        fair: 0,
      },
      weights: {
        structure: 0,
        semantic: 0.5,
        codegen: 1,
      },
      maxAcceptableDepth: 0,
      maxAcceptableNodes: 8,
    },
    tokens: {
      autoAcceptConfidence: 100,
      maxConflictDelta: 2,
    },
    governance: {
      minQualityScoreToApply: 75,
      securitySensitivePatterns: ["password", "(auth)", "C++"],
      requireNoteOnOverride: false,
    },
  });

  assert.deepEqual(parsed, {
    quality: {
      bandThresholds: {
        excellent: 100,
        good: 80,
        fair: 0,
      },
      weights: {
        structure: 0,
        semantic: 0.5,
        codegen: 1,
      },
      maxAcceptableDepth: 0,
      maxAcceptableNodes: 8,
    },
    tokens: {
      autoAcceptConfidence: 100,
      maxConflictDelta: 2,
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

test("parseInspectorPolicy rejects out-of-range numeric fields", () => {
  for (const value of [
    {
      quality: {
        bandThresholds: {
          excellent: -1,
        },
      },
    },
    {
      quality: {
        bandThresholds: {
          good: 101,
        },
      },
    },
    {
      quality: {
        weights: {
          structure: -0.01,
        },
      },
    },
    {
      quality: {
        maxAcceptableDepth: -1,
      },
    },
    {
      quality: {
        maxAcceptableNodes: -1,
      },
    },
    {
      tokens: {
        autoAcceptConfidence: -1,
      },
    },
    {
      tokens: {
        autoAcceptConfidence: 101,
      },
    },
    {
      governance: {
        minQualityScoreToApply: -1,
      },
    },
    {
      governance: {
        minQualityScoreToApply: 101,
      },
    },
  ]) {
    assert.equal(parseInspectorPolicy(value), null);
  }
});

test("parseInspectorPolicy drops likely regex-style governance patterns per entry", () => {
  const parsed = parseInspectorPolicy({
    governance: {
      minQualityScoreToApply: 80,
      securitySensitivePatterns: [
        "password",
        "(a+)+$",
        "(auth)",
        "^admin$",
        "C++",
        ".*secret.*",
      ],
      requireNoteOnOverride: true,
    },
  });

  assert.deepEqual(parsed, {
    governance: {
      minQualityScoreToApply: 80,
      securitySensitivePatterns: ["password", "(auth)", "C++"],
      requireNoteOnOverride: true,
    },
  });
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

test("parseInspectorPolicy still parses known fields when unknown keys are present", () => {
  const parsed = parseInspectorPolicy({
    quality: {
      bandThresholds: { excellent: 90, typoThreshold: 1 },
      weights: { structure: 1, typoWeight: 2 },
      typoQualityField: true,
    },
    tokens: {
      autoAcceptConfidence: 80,
      typoTokensField: "x",
    },
    a11y: { wcagLevel: "AA", typoA11yField: [] },
    governance: {
      minQualityScoreToApply: 70,
      securitysensitivepatterns: ["auth"],
    },
    bandthresholds: {},
  });

  assert.deepEqual(parsed, {
    quality: {
      bandThresholds: { excellent: 90 },
      weights: { structure: 1 },
    },
    tokens: { autoAcceptConfidence: 80 },
    a11y: { wcagLevel: "AA" },
    governance: { minQualityScoreToApply: 70 },
  });
});

test("loadInspectorPolicy warns on unknown keys at every nesting level", async () => {
  const workspaceRoot = await mkdtemp(
    path.join(os.tmpdir(), "workspace-inspector-policy-unknown-"),
  );
  try {
    await writeFile(
      path.join(workspaceRoot, ".workspace-inspector-policy.json"),
      JSON.stringify({
        quality: {
          bandThresholds: { excellent: 90, typoThreshold: 1 },
          weights: { structure: 1, typoWeight: 2 },
        },
        governance: {
          minQualityScoreToApply: 70,
          securitysensitivepatterns: ["auth"],
        },
        bandthresholds: {},
      }),
      "utf8",
    );

    const loaded = await loadInspectorPolicy({ workspaceRoot });
    assert.deepEqual(loaded.policy, {
      quality: {
        bandThresholds: { excellent: 90 },
        weights: { structure: 1 },
      },
      governance: { minQualityScoreToApply: 70 },
    });
    assert.match(String(loaded.warning ?? ""), /ignored unknown keys/);
    const warning = String(loaded.warning);
    for (const expectedPath of [
      '"bandthresholds"',
      '"quality.bandThresholds.typoThreshold"',
      '"quality.weights.typoWeight"',
      '"governance.securitysensitivepatterns"',
    ]) {
      assert.ok(
        warning.includes(expectedPath),
        `warning should include ${expectedPath}, got: ${warning}`,
      );
    }
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("loadInspectorPolicy combines unknown-key and regex-drop warnings", async () => {
  const workspaceRoot = await mkdtemp(
    path.join(os.tmpdir(), "workspace-inspector-policy-combined-"),
  );
  try {
    await writeFile(
      path.join(workspaceRoot, ".workspace-inspector-policy.json"),
      JSON.stringify({
        governance: {
          securitySensitivePatterns: ["auth", "^admin$"],
          typoGovField: true,
        },
      }),
      "utf8",
    );

    const loaded = await loadInspectorPolicy({ workspaceRoot });
    const warning = String(loaded.warning ?? "");
    assert.match(warning, /ignored unknown keys/);
    assert.match(warning, /dropped regex-style/);
    assert.ok(warning.includes('"governance.typoGovField"'));
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("loadInspectorPolicy drops regex-style governance patterns and warns", async () => {
  const workspaceRoot = await mkdtemp(
    path.join(os.tmpdir(), "workspace-inspector-policy-invalid-"),
  );
  try {
    await writeFile(
      path.join(workspaceRoot, ".workspace-inspector-policy.json"),
      JSON.stringify({
        governance: {
          minQualityScoreToApply: 60,
          securitySensitivePatterns: ["auth", "auth.", "(auth)", "^admin$"],
          requireNoteOnOverride: true,
        },
      }),
      "utf8",
    );

    const loaded = await loadInspectorPolicy({ workspaceRoot });
    assert.deepEqual(loaded, {
      policy: {
        governance: {
          minQualityScoreToApply: 60,
          securitySensitivePatterns: ["auth", "(auth)"],
          requireNoteOnOverride: true,
        },
      },
      warning:
        'Inspector policy \'.workspace-inspector-policy.json\' dropped regex-style governance.securitySensitivePatterns entries: [1] "auth.", [3] "^admin$".',
    });
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});
