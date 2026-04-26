import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  BUSINESS_TEST_INTENT_IR_SCHEMA_VERSION,
  CUSTOM_CONTEXT_ARTIFACT_FILENAME,
  CUSTOM_CONTEXT_MARKDOWN_SOURCE_ID,
  CUSTOM_CONTEXT_STRUCTURED_SOURCE_ID,
  type BusinessTestIntentIr,
} from "../contracts/index.js";
import { canonicalJson, sha256Hex } from "./content-hash.js";
import { persistCustomContext } from "./custom-context-store.js";

const intent = (): BusinessTestIntentIr => ({
  version: BUSINESS_TEST_INTENT_IR_SCHEMA_VERSION,
  source: { kind: "figma_local_json", contentHash: "a".repeat(64) },
  screens: [],
  detectedFields: [],
  detectedActions: [],
  detectedValidations: [],
  detectedNavigation: [],
  inferredBusinessObjects: [],
  risks: [],
  assumptions: [],
  openQuestions: [],
  piiIndicators: [],
  redactions: [],
});

test("persistCustomContext refuses custom-only jobs before writing artifacts", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "custom-context-store-"));
  try {
    const result = await persistCustomContext({
      runDir: dir,
      authorHandle: "alice",
      capturedAt: "2026-04-26T12:00:00.000Z",
      markdown: "# Supporting note",
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "primary_source_required");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("persistCustomContext rejects bare unsafe Markdown URLs without writing custom artifacts", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "custom-context-store-"));
  try {
    await writeFile(
      path.join(dir, "business-intent-ir.json"),
      canonicalJson(intent()),
      "utf8",
    );
    const result = await persistCustomContext({
      runDir: dir,
      authorHandle: "alice",
      capturedAt: "2026-04-26T12:00:00.000Z",
      markdown: "bare http://169.254.169.254/latest/meta-data",
    });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.code, "custom_context_markdown_invalid");
    }
    await assert.rejects(
      () =>
        readFile(
          path.join(
            dir,
            "sources",
            CUSTOM_CONTEXT_MARKDOWN_SOURCE_ID,
            CUSTOM_CONTEXT_ARTIFACT_FILENAME,
          ),
          "utf8",
        ),
      /ENOENT/u,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("persistCustomContext writes redacted Markdown and structured artifacts with deterministic source refs", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "custom-context-store-"));
  try {
    await writeFile(
      path.join(dir, "business-intent-ir.json"),
      canonicalJson(intent()),
      "utf8",
    );
    const result = await persistCustomContext({
      runDir: dir,
      authorHandle: "alice",
      capturedAt: "2026-04-26T12:00:00.000Z",
      markdown: "# Customer Max Mustermann",
      attributes: [
        {
          key: "data_class",
          value: "PCI-DSS-3 Max Mustermann 4111111111111111",
        },
      ],
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.result.sourceRefs.length, 2);
    assert.equal(
      result.result.sourceEnvelope.sources.some(
        (source) => source.kind === "figma_local_json",
      ),
      true,
    );
    assert.equal(
      result.result.policySignals[0]?.riskCategory,
      "regulated_data",
    );

    const markdownRaw = await readFile(
      path.join(
        dir,
        "sources",
        CUSTOM_CONTEXT_MARKDOWN_SOURCE_ID,
        CUSTOM_CONTEXT_ARTIFACT_FILENAME,
      ),
      "utf8",
    );
    assert.equal(markdownRaw.includes("Max Mustermann"), false);
    assert.equal(markdownRaw.includes("[REDACTED:FULL_NAME]"), true);
    const structuredRaw = await readFile(
      path.join(
        dir,
        "sources",
        CUSTOM_CONTEXT_STRUCTURED_SOURCE_ID,
        CUSTOM_CONTEXT_ARTIFACT_FILENAME,
      ),
      "utf8",
    );
    assert.equal(structuredRaw.includes("PCI-DSS-3"), true);
    assert.equal(structuredRaw.includes("Max Mustermann"), false);
    assert.equal(structuredRaw.includes("4111111111111111"), false);

    const replay = await persistCustomContext({
      runDir: dir,
      authorHandle: "alice",
      capturedAt: "2026-04-26T12:00:00.000Z",
      markdown: "# Customer Max Mustermann",
      attributes: [
        {
          key: "data_class",
          value: "PCI-DSS-3 Max Mustermann 4111111111111111",
        },
      ],
    });
    assert.equal(replay.ok, true);
    if (!replay.ok) return;
    assert.equal(
      replay.result.sourceEnvelope.aggregateContentHash,
      result.result.sourceEnvelope.aggregateContentHash,
    );

    const reversed = await persistCustomContext({
      runDir: dir,
      authorHandle: "alice",
      capturedAt: "2026-04-26T12:00:00.000Z",
      attributes: [
        { key: "priority_hint", value: "p1" },
        { key: "data_class", value: "PCI-DSS-3" },
      ],
    });
    assert.equal(reversed.ok, true);
    if (!reversed.ok) return;
    const ordered = await persistCustomContext({
      runDir: dir,
      authorHandle: "alice",
      capturedAt: "2026-04-26T12:00:00.000Z",
      attributes: [
        { key: "data_class", value: "PCI-DSS-3" },
        { key: "priority_hint", value: "p1" },
      ],
    });
    assert.equal(ordered.ok, true);
    if (!ordered.ok) return;
    assert.equal(
      reversed.result.sourceRefs[0]?.contentHash,
      ordered.result.sourceRefs[0]?.contentHash,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("sha256Hex remains available for source fixture hashes", () => {
  assert.match(sha256Hex({ fixture: "custom-context" }), /^[0-9a-f]{64}$/u);
});
