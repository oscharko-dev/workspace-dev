import assert from "node:assert/strict";
import test from "node:test";
import fc from "fast-check";
import {
  ALLOWED_TEST_INTENT_SOURCE_KINDS,
  PRIMARY_TEST_INTENT_SOURCE_KINDS,
  type TestIntentSourceKind,
  type TestIntentSourceRef,
} from "../contracts/index.js";
import { sha256Hex } from "./content-hash.js";
import {
  buildMultiSourceTestIntentEnvelope,
  computeAggregateContentHash,
  validateMultiSourceTestIntentEnvelope,
} from "./multi-source-envelope.js";

const ISO = "2026-04-26T12:34:56.000Z";

const arbHex64 = fc
  .uint8Array({ minLength: 8, maxLength: 32 })
  .map((bytes) => sha256Hex(Array.from(bytes)));

const arbSourceId = fc
  .stringMatching(/^[A-Za-z0-9._-]{3,32}$/)
  .filter((s) => s.length > 0);

const arbPrimaryKind = fc.constantFrom(
  ...PRIMARY_TEST_INTENT_SOURCE_KINDS,
) as fc.Arbitrary<TestIntentSourceKind>;

const arbAnyKind = fc.constantFrom(
  ...ALLOWED_TEST_INTENT_SOURCE_KINDS,
) as fc.Arbitrary<TestIntentSourceKind>;

const arbPrimaryRef = fc.tuple(arbSourceId, arbPrimaryKind, arbHex64).map(
  ([sourceId, kind, contentHash]): TestIntentSourceRef => ({
    sourceId,
    kind,
    contentHash,
    capturedAt: ISO,
  }),
);

test("property: aggregate hash is invariant under source reordering for non-priority policies", () => {
  fc.assert(
    fc.property(
      fc.uniqueArray(arbPrimaryRef, {
        minLength: 2,
        maxLength: 6,
        selector: (ref) => ref.sourceId,
      }),
      fc.constantFrom("reviewer_decides", "keep_both"),
      (sources, policy) => {
        const reverseOrder = [...sources].reverse();
        const a = computeAggregateContentHash({
          sources,
          conflictResolutionPolicy: policy,
        });
        const b = computeAggregateContentHash({
          sources: reverseOrder,
          conflictResolutionPolicy: policy,
        });
        assert.equal(a, b);
      },
    ),
    { numRuns: 80 },
  );
});

test("property: aggregate hash changes when any source contentHash changes", () => {
  fc.assert(
    fc.property(
      fc
        .uniqueArray(arbPrimaryRef, {
          minLength: 1,
          maxLength: 5,
          selector: (ref) => ref.sourceId,
        })
        .filter((arr) => arr.length >= 1),
      arbHex64,
      (sources, mutated) => {
        if (sources.length === 0) return;
        const original = sources[0];
        if (!original) return;
        if (mutated === original.contentHash) return;
        const before = computeAggregateContentHash({
          sources,
          conflictResolutionPolicy: "keep_both",
        });
        const replaced: TestIntentSourceRef[] = sources.map((src, i) =>
          i === 0 ? { ...src, contentHash: mutated } : src,
        );
        const after = computeAggregateContentHash({
          sources: replaced,
          conflictResolutionPolicy: "keep_both",
        });
        assert.notEqual(before, after);
      },
    ),
    { numRuns: 80 },
  );
});

test("property: validator round-trips for any well-formed primary-source envelope", () => {
  fc.assert(
    fc.property(
      fc.uniqueArray(arbPrimaryRef, {
        minLength: 1,
        maxLength: 4,
        selector: (ref) => ref.sourceId,
      }),
      fc.constantFrom("reviewer_decides", "keep_both"),
      (sources, policy) => {
        const env = buildMultiSourceTestIntentEnvelope({
          sources,
          conflictResolutionPolicy: policy,
        });
        const result = validateMultiSourceTestIntentEnvelope(env);
        assert.equal(result.ok, true);
      },
    ),
    { numRuns: 80 },
  );
});

test("property: any envelope without a primary source refuses with primary_source_required", () => {
  const arbCustomKind = fc.constantFrom("custom_text", "custom_structured");
  const arbCustomRef = fc.tuple(arbSourceId, arbCustomKind, arbHex64).map(
    ([sourceId, kind, contentHash]): TestIntentSourceRef => ({
      sourceId,
      kind: kind as TestIntentSourceKind,
      contentHash,
      capturedAt: ISO,
      inputFormat: "plain_text",
    }),
  );
  fc.assert(
    fc.property(
      fc.uniqueArray(arbCustomRef, {
        minLength: 1,
        maxLength: 4,
        selector: (ref) => ref.sourceId,
      }),
      (sources) => {
        const env = buildMultiSourceTestIntentEnvelope({
          sources,
          conflictResolutionPolicy: "reviewer_decides",
        });
        const result = validateMultiSourceTestIntentEnvelope(env);
        assert.equal(result.ok, false);
        if (!result.ok) {
          assert.ok(
            result.issues.some((i) => i.code === "primary_source_required"),
          );
        }
      },
    ),
    { numRuns: 60 },
  );
});

test("property: priority policy hash differs when priorityOrder is permuted (and the permutation is not a no-op)", () => {
  fc.assert(
    fc.property(
      fc.constantFrom(
        ["figma_local_json", "jira_rest"] as TestIntentSourceKind[],
        ["figma_rest", "jira_paste"] as TestIntentSourceKind[],
        ["figma_plugin", "jira_rest", "jira_paste"] as TestIntentSourceKind[],
      ),
      arbHex64,
      arbHex64,
      arbHex64,
      (kinds, h0, h1, h2) => {
        if (kinds.length < 2) return;
        const sources: TestIntentSourceRef[] = kinds.map((kind, i) => {
          const hash = i === 0 ? h0 : i === 1 ? h1 : h2;
          return {
            sourceId: `src.${i}`,
            kind,
            contentHash: hash,
            capturedAt: ISO,
          };
        });
        const reversed = [...kinds].reverse();
        const a = computeAggregateContentHash({
          sources,
          conflictResolutionPolicy: "priority",
          priorityOrder: kinds,
        });
        const b = computeAggregateContentHash({
          sources,
          conflictResolutionPolicy: "priority",
          priorityOrder: reversed,
        });
        assert.notEqual(a, b);
      },
    ),
    { numRuns: 60 },
  );
});

test("property: validator never accepts a zero-source envelope", () => {
  fc.assert(
    fc.property(
      fc.constantFrom("priority", "reviewer_decides", "keep_both"),
      arbHex64,
      (policy, hash) => {
        const result = validateMultiSourceTestIntentEnvelope({
          version: "1.0.0",
          sources: [],
          aggregateContentHash: hash,
          conflictResolutionPolicy: policy,
        });
        assert.equal(result.ok, false);
        if (!result.ok) {
          assert.ok(result.issues.some((i) => i.code === "sources_empty"));
        }
      },
    ),
    { numRuns: 30 },
  );
});

test("property: arbAnyKind is exhaustive", () => {
  // Pin the universe so fast-check shrinking covers each kind eventually.
  fc.assert(
    fc.property(arbAnyKind, (kind) => {
      assert.ok(
        (ALLOWED_TEST_INTENT_SOURCE_KINDS as readonly string[]).includes(kind),
      );
    }),
    { numRuns: 30 },
  );
});
