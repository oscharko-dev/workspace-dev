import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
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
      validation: {
        state: "loaded",
        diagnostics: [],
      },
    });
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("loadInspectorPolicy rejects invalid JSON with validation diagnostics", async () => {
  const workspaceRoot = await mkdtemp(
    path.join(os.tmpdir(), "workspace-inspector-policy-invalid-"),
  );
  try {
    await writeFile(
      path.join(workspaceRoot, ".workspace-inspector-policy.json"),
      "{not-valid-json",
      "utf8",
    );

    const loaded = await loadInspectorPolicy({ workspaceRoot });
    assert.deepEqual(loaded, {
      policy: null,
      validation: {
        state: "rejected",
        diagnostics: [
          {
            severity: "error",
            code: "invalid_json",
            path: "$",
            message: "The file contains invalid JSON.",
          },
        ],
      },
      warning:
        "Inspector policy '.workspace-inspector-policy.json' is not valid JSON and was ignored.",
    });
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("loadInspectorPolicy reports invalid enum diagnostics with field context", async () => {
  const workspaceRoot = await mkdtemp(
    path.join(os.tmpdir(), "workspace-inspector-policy-invalid-enum-"),
  );
  try {
    await writeFile(
      path.join(workspaceRoot, ".workspace-inspector-policy.json"),
      JSON.stringify({
        quality: {
          riskSeverityOverrides: {
            "large-subtree": "urgent",
          },
        },
      }),
      "utf8",
    );

    const loaded = await loadInspectorPolicy({ workspaceRoot });
    assert.deepEqual(loaded, {
      policy: null,
      validation: {
        state: "rejected",
        diagnostics: [
          {
            severity: "error",
            code: "invalid_enum",
            path: "quality.riskSeverityOverrides.large-subtree",
            message: "Expected one of: high, medium, low.",
            valuePreview: '"urgent"',
          },
        ],
      },
      warning:
        'Inspector policy \'.workspace-inspector-policy.json\' was rejected at quality.riskSeverityOverrides.large-subtree: Expected one of: high, medium, low. Received "urgent".',
    });
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("loadInspectorPolicy returns no warning for an empty policy object", async () => {
  const workspaceRoot = await mkdtemp(
    path.join(os.tmpdir(), "workspace-inspector-policy-empty-"),
  );
  try {
    await writeFile(
      path.join(workspaceRoot, ".workspace-inspector-policy.json"),
      JSON.stringify({}),
      "utf8",
    );

    const loaded = await loadInspectorPolicy({ workspaceRoot });
    assert.deepEqual(loaded, {
      policy: {},
      validation: {
        state: "loaded",
        diagnostics: [],
      },
    });
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("loadInspectorPolicy warns only at the root for a lone top-level unknown key", async () => {
  const workspaceRoot = await mkdtemp(
    path.join(os.tmpdir(), "workspace-inspector-policy-root-unknown-"),
  );
  try {
    await writeFile(
      path.join(workspaceRoot, ".workspace-inspector-policy.json"),
      JSON.stringify({ typoTopLevel: 1 }),
      "utf8",
    );

    const loaded = await loadInspectorPolicy({ workspaceRoot });
    assert.deepEqual(loaded, {
      policy: {},
      validation: {
        state: "degraded",
        diagnostics: [
          {
            severity: "warning",
            code: "unknown_key_ignored",
            path: "typoTopLevel",
            message: "Ignored unknown inspector policy key.",
          },
        ],
      },
      warning:
        "Inspector policy '.workspace-inspector-policy.json' ignored unknown keys: \"typoTopLevel\".",
    });
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("loadInspectorPolicy formats a deeply nested unknown-key path correctly", async () => {
  const workspaceRoot = await mkdtemp(
    path.join(os.tmpdir(), "workspace-inspector-policy-deep-"),
  );
  try {
    await writeFile(
      path.join(workspaceRoot, ".workspace-inspector-policy.json"),
      JSON.stringify({
        quality: { bandThresholds: { excelent: 90 } },
      }),
      "utf8",
    );

    const loaded = await loadInspectorPolicy({ workspaceRoot });
    assert.deepEqual(loaded, {
      policy: {
        quality: { bandThresholds: {} },
      },
      validation: {
        state: "degraded",
        diagnostics: [
          {
            severity: "warning",
            code: "unknown_key_ignored",
            path: "quality.bandThresholds.excelent",
            message: "Ignored unknown inspector policy key.",
          },
        ],
      },
      warning:
        'Inspector policy \'.workspace-inspector-policy.json\' ignored unknown keys: "quality.bandThresholds.excelent".',
    });
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("loadInspectorPolicy does not flag arbitrary rule IDs in riskSeverityOverrides", async () => {
  const workspaceRoot = await mkdtemp(
    path.join(os.tmpdir(), "workspace-inspector-policy-risk-overrides-"),
  );
  try {
    await writeFile(
      path.join(workspaceRoot, ".workspace-inspector-policy.json"),
      JSON.stringify({
        quality: {
          riskSeverityOverrides: {
            "some.arbitrary.rule": "high",
            "totally-made-up-id": "low",
          },
        },
      }),
      "utf8",
    );

    const loaded = await loadInspectorPolicy({ workspaceRoot });
    assert.deepEqual(loaded, {
      policy: {
        quality: {
          riskSeverityOverrides: {
            "some.arbitrary.rule": "high",
            "totally-made-up-id": "low",
          },
        },
      },
      validation: {
        state: "loaded",
        diagnostics: [],
      },
    });
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("loadInspectorPolicy does not leak unknown-key warnings when policy is invalid", async () => {
  const workspaceRoot = await mkdtemp(
    path.join(os.tmpdir(), "workspace-inspector-policy-invalid-"),
  );
  try {
    await writeFile(
      path.join(workspaceRoot, ".workspace-inspector-policy.json"),
      JSON.stringify({
        typoTopLevel: true,
        quality: { weights: { structure: -1, typoWeight: 5 } },
      }),
      "utf8",
    );

    const loaded = await loadInspectorPolicy({ workspaceRoot });
    assert.equal(loaded.policy, null);
    assert.equal(loaded.validation.state, "rejected");
    assert.equal(
      loaded.warning,
      "Inspector policy '.workspace-inspector-policy.json' was rejected at quality.weights.structure: Expected a finite number greater than or equal to 0. Received -1.",
    );
    assert.ok(
      !String(loaded.warning).includes("ignored unknown keys"),
      "invalid-shape rejection must not also emit unknown-key warning",
    );
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
    assert.deepEqual(loaded, {
      policy: {
        quality: {
          bandThresholds: { excellent: 90 },
          weights: { structure: 1 },
        },
        governance: { minQualityScoreToApply: 70 },
      },
      validation: {
        state: "degraded",
        diagnostics: [
          {
            severity: "warning",
            code: "unknown_key_ignored",
            path: "bandthresholds",
            message: "Ignored unknown inspector policy key.",
          },
          {
            severity: "warning",
            code: "unknown_key_ignored",
            path: "quality.bandThresholds.typoThreshold",
            message: "Ignored unknown inspector policy key.",
          },
          {
            severity: "warning",
            code: "unknown_key_ignored",
            path: "quality.weights.typoWeight",
            message: "Ignored unknown inspector policy key.",
          },
          {
            severity: "warning",
            code: "unknown_key_ignored",
            path: "governance.securitysensitivepatterns",
            message: "Ignored unknown inspector policy key.",
          },
        ],
      },
      warning:
        'Inspector policy \'.workspace-inspector-policy.json\' ignored unknown keys: "bandthresholds", "quality.bandThresholds.typoThreshold", "quality.weights.typoWeight", "governance.securitysensitivepatterns".',
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
    assert.deepEqual(loaded.validation, {
      state: "degraded",
      diagnostics: [
        {
          severity: "warning",
          code: "unknown_key_ignored",
          path: "governance.typoGovField",
          message: "Ignored unknown inspector policy key.",
        },
        {
          severity: "warning",
          code: "regex_like_pattern_dropped",
          path: "governance.securitySensitivePatterns[1]",
          message:
            "Dropped regex-like governance pattern; only literal string matches are allowed.",
          valuePreview: '"^admin$"',
        },
      ],
    });
    const warning = String(loaded.warning ?? "");
    assert.match(warning, /ignored unknown keys/);
    assert.match(warning, /dropped regex-style/);
    assert.ok(warning.includes('"governance.typoGovField"'));
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("loadInspectorPolicy reports out-of-range numeric diagnostics with field context", async () => {
  const workspaceRoot = await mkdtemp(
    path.join(os.tmpdir(), "workspace-inspector-policy-out-of-range-"),
  );
  try {
    await writeFile(
      path.join(workspaceRoot, ".workspace-inspector-policy.json"),
      JSON.stringify({
        quality: {
          bandThresholds: {
            excellent: 101,
          },
        },
      }),
      "utf8",
    );

    const loaded = await loadInspectorPolicy({ workspaceRoot });
    assert.deepEqual(loaded, {
      policy: null,
      validation: {
        state: "rejected",
        diagnostics: [
          {
            severity: "error",
            code: "out_of_range",
            path: "quality.bandThresholds.excellent",
            message: "Expected a finite number between 0 and 100.",
            valuePreview: "101",
          },
        ],
      },
      warning:
        "Inspector policy '.workspace-inspector-policy.json' was rejected at quality.bandThresholds.excellent: Expected a finite number between 0 and 100. Received 101.",
    });
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("loadInspectorPolicy captures dropped governance entries when a later fatal validation rejects the policy", async () => {
  const workspaceRoot = await mkdtemp(
    path.join(os.tmpdir(), "workspace-inspector-policy-rejected-governance-"),
  );
  try {
    await writeFile(
      path.join(workspaceRoot, ".workspace-inspector-policy.json"),
      JSON.stringify({
        governance: {
          securitySensitivePatterns: ["password", "auth.", "(auth)", "^admin$"],
          requireNoteOnOverride: "yes",
        },
      }),
      "utf8",
    );

    const loaded = await loadInspectorPolicy({ workspaceRoot });
    assert.deepEqual(loaded, {
      policy: null,
      validation: {
        state: "rejected",
        diagnostics: [
          {
            severity: "error",
            code: "invalid_type",
            path: "governance.requireNoteOnOverride",
            message: "Expected a boolean.",
            valuePreview: '"yes"',
          },
          {
            severity: "warning",
            code: "regex_like_pattern_dropped",
            path: "governance.securitySensitivePatterns[1]",
            message:
              "Dropped regex-like governance pattern; only literal string matches are allowed.",
            valuePreview: '"auth."',
          },
          {
            severity: "warning",
            code: "regex_like_pattern_dropped",
            path: "governance.securitySensitivePatterns[3]",
            message:
              "Dropped regex-like governance pattern; only literal string matches are allowed.",
            valuePreview: '"^admin$"',
          },
        ],
      },
      warning:
        'Inspector policy \'.workspace-inspector-policy.json\' was rejected at governance.requireNoteOnOverride: Expected a boolean. Received "yes". Dropped regex-style governance.securitySensitivePatterns entries before rejection: [1] "auth.", [3] "^admin$".',
    });
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("loadInspectorPolicy rejects unreadable policy files with file diagnostics", async () => {
  const workspaceRoot = await mkdtemp(
    path.join(os.tmpdir(), "workspace-inspector-policy-unreadable-"),
  );
  try {
    await mkdir(path.join(workspaceRoot, ".workspace-inspector-policy.json"));

    const loaded = await loadInspectorPolicy({ workspaceRoot });
    assert.equal(loaded.policy, null);
    assert.equal(loaded.validation.state, "rejected");
    assert.equal(loaded.validation.diagnostics[0]?.code, "file_unreadable");
    assert.equal(loaded.validation.diagnostics[0]?.path, "$");
    assert.match(String(loaded.warning ?? ""), /Failed to load inspector policy/);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("loadInspectorPolicy drops regex-style governance patterns and warns", async () => {
  const workspaceRoot = await mkdtemp(
    path.join(os.tmpdir(), "workspace-inspector-policy-degraded-"),
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
      validation: {
        state: "degraded",
        diagnostics: [
          {
            severity: "warning",
            code: "regex_like_pattern_dropped",
            path: "governance.securitySensitivePatterns[1]",
            message:
              "Dropped regex-like governance pattern; only literal string matches are allowed.",
            valuePreview: '"auth."',
          },
          {
            severity: "warning",
            code: "regex_like_pattern_dropped",
            path: "governance.securitySensitivePatterns[3]",
            message:
              "Dropped regex-like governance pattern; only literal string matches are allowed.",
            valuePreview: '"^admin$"',
          },
        ],
      },
      warning:
        'Inspector policy \'.workspace-inspector-policy.json\' dropped regex-style governance.securitySensitivePatterns entries: [1] "auth.", [3] "^admin$".',
    });
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});
