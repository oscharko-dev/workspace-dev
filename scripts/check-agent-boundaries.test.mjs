import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { analyzeAgentBoundaries } from "./check-agent-boundaries.mjs";

const setupTempRepo = async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "ti-agent-boundaries-"));
  await mkdir(path.join(dir, "src/test-intelligence"), { recursive: true });
  await mkdir(
    path.join(dir, "ui-src/src/features/workspace/inspector/test-intelligence"),
    { recursive: true },
  );
  await mkdir(path.join(dir, "src/other"), { recursive: true });
  return dir;
};

const writeFileAt = async (root, relPosix, body) => {
  const abs = path.join(root, ...relPosix.split("/"));
  await mkdir(path.dirname(abs), { recursive: true });
  await writeFile(abs, body, "utf8");
};

const ROLE_MODULE_REL = "src/test-intelligence/semantic-judge-panel.ts";
const ROLE_MODULES = new Set([ROLE_MODULE_REL]);
const SCAN_ROOTS = ["src", "ui-src/src", "scripts"];

test("analyzeAgentBoundaries flags llm-gateway import in LLM-role module", async () => {
  const root = await setupTempRepo();
  try {
    await writeFileAt(
      root,
      ROLE_MODULE_REL,
      [
        'import { foo } from "./llm-gateway.js";',
        "export const x = 1;",
      ].join("\n"),
    );
    const result = await analyzeAgentBoundaries({
      repoRoot: root,
      scanRoots: SCAN_ROOTS,
      llmRoleModulePaths: ROLE_MODULES,
    });
    const llmGw = result.violations.find(
      (v) =>
        v.type === "role-module-import" &&
        v.message.includes("llm-gateway"),
    );
    assert.ok(llmGw, "expected llm-gateway role-module-import violation");
    assert.equal(llmGw.file, ROLE_MODULE_REL);
    assert.equal(llmGw.line, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("analyzeAgentBoundaries flags raw fs and node:fs imports in role module", async () => {
  const root = await setupTempRepo();
  try {
    await writeFileAt(
      root,
      ROLE_MODULE_REL,
      [
        'import { readFileSync } from "fs";',
        'import * as fs2 from "node:fs";',
      ].join("\n"),
    );
    const result = await analyzeAgentBoundaries({
      repoRoot: root,
      scanRoots: SCAN_ROOTS,
      llmRoleModulePaths: ROLE_MODULES,
    });
    const fsViolations = result.violations.filter(
      (v) =>
        v.type === "role-module-import" && v.message.includes("raw fs"),
    );
    assert.equal(fsViolations.length, 2, "expected two raw fs violations");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("analyzeAgentBoundaries permits node:fs/promises in role module", async () => {
  const root = await setupTempRepo();
  try {
    await writeFileAt(
      root,
      ROLE_MODULE_REL,
      'import { writeFile } from "node:fs/promises";\n',
    );
    const result = await analyzeAgentBoundaries({
      repoRoot: root,
      scanRoots: SCAN_ROOTS,
      llmRoleModulePaths: ROLE_MODULES,
    });
    assert.equal(
      result.violations.filter((v) => v.type === "role-module-import").length,
      0,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("analyzeAgentBoundaries flags review-store and evidence module imports", async () => {
  const root = await setupTempRepo();
  try {
    await writeFileAt(
      root,
      ROLE_MODULE_REL,
      [
        'import { x } from "../workspace/review-store.js";',
        'import { y } from "./evidence-attestation.js";',
        'import { z } from "./evidence-manifest.js";',
        'import { q } from "./evidence-verify.js";',
      ].join("\n"),
    );
    const result = await analyzeAgentBoundaries({
      repoRoot: root,
      scanRoots: SCAN_ROOTS,
      llmRoleModulePaths: ROLE_MODULES,
    });
    const reviewStore = result.violations.find((v) =>
      v.message.includes("review-store"),
    );
    const evidenceCount = result.violations.filter((v) =>
      v.message.includes("evidence module"),
    ).length;
    assert.ok(reviewStore, "expected review-store violation");
    assert.equal(evidenceCount, 3, "expected three evidence module violations");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("analyzeAgentBoundaries flags direct fetch() call in role module", async () => {
  const root = await setupTempRepo();
  try {
    await writeFileAt(
      root,
      ROLE_MODULE_REL,
      [
        "export async function bad() {",
        "  return await fetch('https://example.com');",
        "}",
      ].join("\n"),
    );
    const result = await analyzeAgentBoundaries({
      repoRoot: root,
      scanRoots: SCAN_ROOTS,
      llmRoleModulePaths: ROLE_MODULES,
    });
    const fetchViolation = result.violations.find(
      (v) => v.type === "role-module-fetch",
    );
    assert.ok(fetchViolation, "expected role-module-fetch violation");
    assert.equal(fetchViolation.line, 2);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("analyzeAgentBoundaries does not flag method-style .fetch( in role module", async () => {
  const root = await setupTempRepo();
  try {
    await writeFileAt(
      root,
      ROLE_MODULE_REL,
      "export async function ok(client) { return client.fetch('x'); }\n",
    );
    const result = await analyzeAgentBoundaries({
      repoRoot: root,
      scanRoots: SCAN_ROOTS,
      llmRoleModulePaths: ROLE_MODULES,
    });
    assert.equal(
      result.violations.filter((v) => v.type === "role-module-fetch").length,
      0,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("analyzeAgentBoundaries flags string-concatenation of finding text into prompts", async () => {
  const root = await setupTempRepo();
  try {
    await writeFileAt(
      root,
      "src/test-intelligence/some-prompt-builder.ts",
      [
        "export const block = {",
        '  kind: "findings",',
        '  body: `Findings:\\n${findings.map((f) => f.text).join("\\n")}`,',
        "};",
      ].join("\n"),
    );
    const result = await analyzeAgentBoundaries({
      repoRoot: root,
      scanRoots: SCAN_ROOTS,
      llmRoleModulePaths: ROLE_MODULES,
    });
    const concat = result.violations.find(
      (v) => v.type === "prompt-finding-concat",
    );
    assert.ok(concat, "expected prompt-finding-concat violation");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("analyzeAgentBoundaries does not flag finding-concat pattern in test files", async () => {
  const root = await setupTempRepo();
  try {
    await writeFileAt(
      root,
      "src/test-intelligence/some-prompt-builder.test.ts",
      [
        "// Negative fixture: this is what we forbid in production code.",
        "const block = {",
        '  kind: "findings",',
        '  body: `${finding.text}`,',
        "};",
      ].join("\n"),
    );
    const result = await analyzeAgentBoundaries({
      repoRoot: root,
      scanRoots: SCAN_ROOTS,
      llmRoleModulePaths: ROLE_MODULES,
    });
    assert.equal(
      result.violations.filter((v) => v.type === "prompt-finding-concat").length,
      0,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("analyzeAgentBoundaries flags harness-related file outside allowed roots (AT-029)", async () => {
  const root = await setupTempRepo();
  try {
    await writeFileAt(
      root,
      "src/other/agent-harness-shadow.ts",
      "export const x = 1;\n",
    );
    const result = await analyzeAgentBoundaries({
      repoRoot: root,
      scanRoots: SCAN_ROOTS,
      llmRoleModulePaths: ROLE_MODULES,
    });
    const v = result.violations.find(
      (entry) => entry.type === "harness-path-out-of-bounds",
    );
    assert.ok(v, "expected harness-path-out-of-bounds violation");
    assert.equal(v.file, "src/other/agent-harness-shadow.ts");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("analyzeAgentBoundaries permits harness modules under src/test-intelligence/", async () => {
  const root = await setupTempRepo();
  try {
    await writeFileAt(
      root,
      "src/test-intelligence/agent-harness-shadow.ts",
      "export const x = 1;\n",
    );
    await writeFileAt(
      root,
      "ui-src/src/features/workspace/inspector/test-intelligence/judge-panel-view.ts",
      "export const y = 1;\n",
    );
    const result = await analyzeAgentBoundaries({
      repoRoot: root,
      scanRoots: SCAN_ROOTS,
      llmRoleModulePaths: ROLE_MODULES,
    });
    assert.equal(
      result.violations.filter(
        (v) => v.type === "harness-path-out-of-bounds",
      ).length,
      0,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("analyzeAgentBoundaries returns no violations for an empty repo", async () => {
  const root = await setupTempRepo();
  try {
    const result = await analyzeAgentBoundaries({
      repoRoot: root,
      scanRoots: SCAN_ROOTS,
      llmRoleModulePaths: ROLE_MODULES,
    });
    assert.equal(result.violations.length, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("analyzeAgentBoundaries does not flag forbidden imports in non-role files", async () => {
  const root = await setupTempRepo();
  try {
    await writeFileAt(
      root,
      "src/test-intelligence/some-orchestrator.ts",
      [
        'import { Client } from "./llm-gateway.js";',
        'import * as fs from "node:fs";',
        "export const ok = true;",
      ].join("\n"),
    );
    const result = await analyzeAgentBoundaries({
      repoRoot: root,
      scanRoots: SCAN_ROOTS,
      llmRoleModulePaths: ROLE_MODULES,
    });
    assert.equal(
      result.violations.filter((v) => v.type === "role-module-import").length,
      0,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
