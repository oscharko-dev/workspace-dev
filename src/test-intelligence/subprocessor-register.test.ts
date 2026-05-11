import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  SUBPROCESSOR_REGISTER_ARTIFACT_FILENAME,
  SUBPROCESSOR_REGISTER_SCHEMA_VERSION,
  SUBPROCESSOR_REGISTER_VERSION,
} from "../contracts/index.js";
import {
  buildSubprocessorRegister,
  renderSubprocessorRegisterMarkdown,
  serializeSubprocessorRegister,
  SUBPROCESSOR_REGISTER_DOC_LAST_REVIEWED,
} from "./subprocessor-register.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..", "..");

const PINNED_GENERATED_AT =
  `${SUBPROCESSOR_REGISTER_DOC_LAST_REVIEWED}T00:00:00Z` as const;

test("subprocessor-register: artifact filename is the canonical name", () => {
  assert.equal(SUBPROCESSOR_REGISTER_ARTIFACT_FILENAME, "subprocessor-register.json");
});

test("subprocessor-register: builder embeds schema + register versions", () => {
  const register = buildSubprocessorRegister({
    generatedAt: PINNED_GENERATED_AT,
  });
  assert.equal(register.schemaVersion, SUBPROCESSOR_REGISTER_SCHEMA_VERSION);
  assert.equal(register.registerVersion, SUBPROCESSOR_REGISTER_VERSION);
  assert.equal(register.generatedAt, PINNED_GENERATED_AT);
});

test("subprocessor-register: canonical JSON output is byte-stable", () => {
  const a = buildSubprocessorRegister({ generatedAt: PINNED_GENERATED_AT });
  const b = buildSubprocessorRegister({ generatedAt: PINNED_GENERATED_AT });
  assert.equal(
    serializeSubprocessorRegister(a),
    serializeSubprocessorRegister(b),
    "two builds with identical inputs must serialise to identical bytes",
  );
});

test("subprocessor-register: matches the pinned canonical-JSON fixture", async () => {
  const fixture = await readFile(
    join(
      repoRoot,
      "fixtures",
      "test-intelligence",
      "subprocessor-register",
      "expected-register.json",
    ),
    "utf8",
  );
  const observed = serializeSubprocessorRegister(
    buildSubprocessorRegister({ generatedAt: PINNED_GENERATED_AT }),
  );
  assert.equal(
    observed,
    fixture,
    "canonical register bytes drifted from the pinned fixture; " +
      "regenerate `fixtures/test-intelligence/subprocessor-register/expected-register.json` " +
      "after a deliberate audit-trail review.",
  );
});

test("subprocessor-register: subprocessor list is sorted by stable id", () => {
  const register = buildSubprocessorRegister({
    generatedAt: PINNED_GENERATED_AT,
  });
  const ids = register.subprocessors.map((entry) => entry.subprocessorId);
  const sorted = [...ids].sort((left, right) => left.localeCompare(right));
  assert.deepEqual(ids, sorted, "subprocessor ids must serialise in sorted order");
});

test("subprocessor-register: cross-border transfers are sorted by transfer id", () => {
  const register = buildSubprocessorRegister({
    generatedAt: PINNED_GENERATED_AT,
  });
  const ids = register.crossBorderTransfers.map((entry) => entry.transferId);
  const sorted = [...ids].sort((left, right) => left.localeCompare(right));
  assert.deepEqual(ids, sorted, "transfer ids must serialise in sorted order");
});

test("subprocessor-register: register entries are deeply frozen", () => {
  const register = buildSubprocessorRegister({
    generatedAt: PINNED_GENERATED_AT,
  });
  assert.ok(Object.isFrozen(register));
  assert.ok(Object.isFrozen(register.subprocessors));
  assert.ok(Object.isFrozen(register.crossBorderTransfers));
  for (const entry of register.subprocessors) {
    assert.ok(Object.isFrozen(entry));
    assert.ok(Object.isFrozen(entry.dataCategories));
    assert.ok(Object.isFrozen(entry.contractualSafeguards));
  }
  for (const entry of register.crossBorderTransfers) {
    assert.ok(Object.isFrozen(entry));
  }
});

test("subprocessor-register: every entry covers an Azure / Mistral region from #2099 routing", () => {
  const register = buildSubprocessorRegister({
    generatedAt: PINNED_GENERATED_AT,
  });
  // Issue #2174 acceptance criterion: at least one entry per current
  // Azure / Mistral deployment in the #2099 routing surface.
  const required = ["llm-gateway-text-generation", "visual-sidecar-vision", "document-ai-mistral"];
  for (const subprocessorId of required) {
    assert.ok(
      register.subprocessors.some(
        (entry) => entry.subprocessorId === subprocessorId,
      ),
      `register must include an entry for ${subprocessorId}`,
    );
  }
});

test("subprocessor-register: merkle root changes when a subprocessor entry mutates", () => {
  const baseline = buildSubprocessorRegister({
    generatedAt: PINNED_GENERATED_AT,
  });
  const mutated = buildSubprocessorRegister({
    generatedAt: PINNED_GENERATED_AT,
    subprocessors: [
      ...baseline.subprocessors.map((entry) =>
        entry.subprocessorId === "llm-gateway-text-generation"
          ? { ...entry, hostingRegion: "northeurope" as const }
          : entry,
      ),
    ],
  });
  assert.notEqual(
    baseline.merkleRoot,
    mutated.merkleRoot,
    "mutating any subprocessor entry must invalidate the register merkle root",
  );
});

test("subprocessor-register: merkle root is a 64-character hex digest", () => {
  const register = buildSubprocessorRegister({
    generatedAt: PINNED_GENERATED_AT,
  });
  assert.match(register.merkleRoot, /^[0-9a-f]{64}$/u);
});

test("subprocessor-register: Markdown renderer is deterministic", () => {
  const register = buildSubprocessorRegister({
    generatedAt: PINNED_GENERATED_AT,
  });
  assert.equal(
    renderSubprocessorRegisterMarkdown(register),
    renderSubprocessorRegisterMarkdown(register),
    "the Markdown renderer must be deterministic",
  );
});

test("subprocessor-register: on-disk Markdown matches the canonical TS source", async () => {
  // Mirrors the CI quality-gate check; if this test fails, run
  // `pnpm run docs:render-subprocessor-register` to regenerate the
  // committed Markdown.
  const docPath = join(repoRoot, "docs", "dora", "subprocessor-register.md");
  const observed = await readFile(docPath, "utf8");
  const register = buildSubprocessorRegister({
    generatedAt: PINNED_GENERATED_AT,
  });
  const expected = `${renderSubprocessorRegisterMarkdown(register)}\n`;
  assert.equal(
    observed,
    expected,
    "docs/dora/subprocessor-register.md drifted from the canonical TS source; " +
      "run `pnpm run docs:render-subprocessor-register`.",
  );
});
