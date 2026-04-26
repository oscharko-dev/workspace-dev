/**
 * Backward-compatibility regression suite for Issue #1431.
 *
 * Wave 4.A introduces additive multi-source envelope contracts. This file
 * pins three guarantees that single-source Figma jobs MUST keep:
 *
 *   1. The Wave-1-style {@link deriveBusinessTestIntentIr} pipeline keeps
 *      emitting `BusinessTestIntentIr.source` populated and does NOT set
 *      the new optional `sourceEnvelope` field.
 *   2. The legacy IR is byte-stable across runs (canonical-JSON
 *      serialization is deterministic) — so replay-cache hits remain
 *      valid.
 *   3. Adding a multi-source envelope to an IR is purely additive: the
 *      legacy `source` field is unchanged when the envelope is absent.
 */

import assert from "node:assert/strict";
import test from "node:test";
import {
  type BusinessTestIntentIr,
  type MultiSourceTestIntentEnvelope,
} from "../contracts/index.js";
import { canonicalJson, sha256Hex } from "./content-hash.js";
import {
  deriveBusinessTestIntentIr,
  type IntentDerivationFigmaInput,
} from "./intent-derivation.js";
import {
  buildMultiSourceTestIntentEnvelope,
  legacySourceFromMultiSourceEnvelope,
} from "./multi-source-envelope.js";

const ISO = "2026-04-26T00:00:00.000Z";

const figmaInput: IntentDerivationFigmaInput = {
  source: { kind: "figma_local_json" },
  screens: [
    {
      screenId: "screen-login",
      screenName: "Login",
      nodes: [
        {
          nodeId: "node-username",
          nodeName: "Username",
          nodeType: "TEXT_INPUT",
          text: "Username",
        },
        {
          nodeId: "node-submit",
          nodeName: "Submit",
          nodeType: "BUTTON",
          text: "Submit",
        },
      ],
    },
  ],
};

test("Wave-1-style single-source IR has no sourceEnvelope field", () => {
  const ir = deriveBusinessTestIntentIr({ figma: figmaInput });
  assert.equal(ir.source.kind, "figma_local_json");
  assert.equal(typeof ir.source.contentHash, "string");
  // Per #1431: optional and additive. Wave 1 derivation MUST NOT populate
  // it so artifacts and replay-cache keys stay byte-identical.
  assert.equal(
    Object.prototype.hasOwnProperty.call(ir, "sourceEnvelope"),
    false,
    "single-source Wave-1 IR must not carry sourceEnvelope",
  );
});

test("single-source Wave-1 IR is canonically deterministic across two derivations", () => {
  const a = deriveBusinessTestIntentIr({ figma: figmaInput });
  const b = deriveBusinessTestIntentIr({ figma: figmaInput });
  assert.equal(canonicalJson(a), canonicalJson(b));
  assert.equal(sha256Hex(a), sha256Hex(b));
});

test("attaching a sourceEnvelope to the IR is additive: existing fields stay byte-stable", () => {
  const baseline = deriveBusinessTestIntentIr({ figma: figmaInput });
  const envelope = buildMultiSourceTestIntentEnvelope({
    sources: [
      {
        sourceId: "src.0",
        kind: "figma_local_json",
        contentHash: baseline.source.contentHash,
        capturedAt: ISO,
      },
    ],
    conflictResolutionPolicy: "keep_both",
  });
  const augmented: BusinessTestIntentIr = {
    ...baseline,
    sourceEnvelope: envelope,
  };
  // Only the new optional field appears.
  const baselineKeys = Object.keys(baseline).sort();
  const augmentedKeys = Object.keys(augmented).sort();
  assert.deepEqual(augmentedKeys, [...baselineKeys, "sourceEnvelope"].sort());
  // Stripping the envelope returns to the byte-stable baseline.
  const { sourceEnvelope: _ignored, ...stripped } = augmented;
  void _ignored;
  assert.equal(canonicalJson(stripped), canonicalJson(baseline));
});

test("identical envelopes produce identical aggregate hashes (replay-cache stability)", () => {
  const sources = [
    {
      sourceId: "src.0",
      kind: "figma_local_json" as const,
      contentHash: sha256Hex({ seed: "first" }),
      capturedAt: ISO,
    },
    {
      sourceId: "src.1",
      kind: "jira_rest" as const,
      contentHash: sha256Hex({ seed: "second" }),
      capturedAt: ISO,
    },
  ];
  const a = buildMultiSourceTestIntentEnvelope({
    sources,
    conflictResolutionPolicy: "reviewer_decides",
  });
  const b = buildMultiSourceTestIntentEnvelope({
    sources,
    conflictResolutionPolicy: "reviewer_decides",
  });
  assert.equal(a.aggregateContentHash, b.aggregateContentHash);
  assert.equal(canonicalJson(a), canonicalJson(b));
});

test("legacySourceFromMultiSourceEnvelope projects to the existing source shape", () => {
  const envelope: MultiSourceTestIntentEnvelope =
    buildMultiSourceTestIntentEnvelope({
      sources: [
        {
          sourceId: "src.0",
          kind: "figma_rest",
          contentHash: sha256Hex({ seed: "rest" }),
          capturedAt: ISO,
        },
      ],
      conflictResolutionPolicy: "keep_both",
    });
  const legacy = legacySourceFromMultiSourceEnvelope(envelope);
  assert.ok(legacy);
  assert.equal(legacy?.kind, "figma_rest");
  assert.equal(legacy?.contentHash, envelope.sources[0]?.contentHash);
});
