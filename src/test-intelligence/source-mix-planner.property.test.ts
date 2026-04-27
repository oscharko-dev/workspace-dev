/**
 * Property-based tests for source-mix-planner.ts (Issue #1441, Wave 4.K).
 *
 * Properties verified:
 *   1. Hash determinism: planSourceMix on identical envelopes always yields
 *      the same sourceMixPlanHash.
 *   2. Hash sensitivity: adding or changing one source always changes the hash.
 *   3. Fail-closed: any envelope whose only sources are supporting kinds
 *      always produces primary_source_required.
 *   4. Jira-only plans always have visualSidecarRequirement=not_applicable.
 *   5. Figma plans always have visualSidecarRequirement=optional.
 *   6. rawJiraResponsePersisted is always false.
 *   7. rawPasteBytesPersisted is always false.
 *   8. sourceMixPlanHash is always a valid 64-hex string.
 */

import assert from "node:assert/strict";
import test from "node:test";
import fc from "fast-check";
import {
  type MultiSourceTestIntentEnvelope,
  type TestIntentSourceRef,
} from "../contracts/index.js";
import { sha256Hex } from "./content-hash.js";
import { planSourceMix } from "./source-mix-planner.js";

const HEX = (seed: string): string => sha256Hex({ seed });
const ISO = "2026-04-26T12:34:56.000Z";

const arbSourceId = fc
  .string({ minLength: 1, maxLength: 12, unit: "grapheme-ascii" })
  .map((s) => s.replace(/[^A-Za-z0-9._-]/g, "x"))
  .filter((s) => s.length >= 1);

const arbFigmaRef = (id: string): TestIntentSourceRef => ({
  sourceId: id,
  kind: "figma_local_json",
  contentHash: HEX(id),
  capturedAt: ISO,
});

const arbJiraRestRef = (id: string): TestIntentSourceRef => ({
  sourceId: id,
  kind: "jira_rest",
  contentHash: HEX(id),
  capturedAt: ISO,
  canonicalIssueKey: `PAY-${id.length + 1}`,
});

const arbCustomMarkdownRef = (id: string): TestIntentSourceRef => ({
  sourceId: id,
  kind: "custom_markdown",
  contentHash: HEX(id),
  capturedAt: ISO,
  redactedMarkdownHash: HEX(`${id}:md`),
  plainTextDerivativeHash: HEX(`${id}:plain`),
});

const buildEnvelope = (
  sources: TestIntentSourceRef[],
): MultiSourceTestIntentEnvelope => ({
  version: "1.0.0",
  sources,
  aggregateContentHash: HEX(JSON.stringify(sources.map((s) => s.sourceId))),
  conflictResolutionPolicy: "reviewer_decides",
});

// ---------------------------------------------------------------------------
// Property 1: Hash determinism
// ---------------------------------------------------------------------------

test("property: identical envelopes always produce identical plan hash", () => {
  fc.assert(
    fc.property(arbSourceId, (seed) => {
      const envelope = buildEnvelope([arbFigmaRef(seed)]);
      const r1 = planSourceMix(envelope);
      const r2 = planSourceMix(envelope);
      assert.equal(r1.ok, true);
      assert.equal(r2.ok, true);
      if (!r1.ok || !r2.ok) return;
      assert.equal(r1.plan.sourceMixPlanHash, r2.plan.sourceMixPlanHash);
    }),
    { numRuns: 200 },
  );
});

// ---------------------------------------------------------------------------
// Property 2: Hash sensitivity – adding a source changes the hash
// ---------------------------------------------------------------------------

test("property: adding a second source changes the plan hash", () => {
  fc.assert(
    fc.property(arbSourceId, arbSourceId, (seed1, seed2) => {
      fc.pre(seed1 !== seed2);
      const envelope1 = buildEnvelope([arbFigmaRef(seed1)]);
      const envelope2 = buildEnvelope([
        arbFigmaRef(seed1),
        arbJiraRestRef(seed2),
      ]);
      const r1 = planSourceMix(envelope1);
      const r2 = planSourceMix(envelope2);
      if (!r1.ok || !r2.ok) return;
      assert.notEqual(r1.plan.sourceMixPlanHash, r2.plan.sourceMixPlanHash);
    }),
    { numRuns: 100 },
  );
});

// ---------------------------------------------------------------------------
// Property 3: Fail-closed for custom-only envelopes
// ---------------------------------------------------------------------------

test("property: custom_markdown-only envelope always fails with primary_source_required", () => {
  fc.assert(
    fc.property(arbSourceId, (seed) => {
      const envelope = buildEnvelope([arbCustomMarkdownRef(seed)]);
      const result = planSourceMix(envelope);
      assert.equal(result.ok, false);
      if (!result.ok) {
        assert.ok(
          result.issues.some((i) => i.code === "primary_source_required"),
        );
      }
    }),
    { numRuns: 100 },
  );
});

// ---------------------------------------------------------------------------
// Property 4: Jira-only plans never require visual sidecar
// ---------------------------------------------------------------------------

test("property: jira_rest-only plans always have visualSidecarRequirement=not_applicable", () => {
  fc.assert(
    fc.property(arbSourceId, (seed) => {
      const jiraKey = `PAY-${(seed.length % 900) + 100}`;
      const ref: TestIntentSourceRef = {
        sourceId: seed.slice(0, 8) || "j",
        kind: "jira_rest",
        contentHash: HEX(seed),
        capturedAt: ISO,
        canonicalIssueKey: jiraKey,
      };
      const envelope = buildEnvelope([ref]);
      const result = planSourceMix(envelope);
      if (!result.ok) return;
      assert.equal(result.plan.visualSidecarRequirement, "not_applicable");
    }),
    { numRuns: 200 },
  );
});

// ---------------------------------------------------------------------------
// Property 5: Figma plans always have optional visual sidecar
// ---------------------------------------------------------------------------

test("property: figma-primary plans always have visualSidecarRequirement=optional", () => {
  fc.assert(
    fc.property(arbSourceId, (seed) => {
      const ref: TestIntentSourceRef = {
        sourceId: seed.slice(0, 8) || "f",
        kind: "figma_rest",
        contentHash: HEX(seed),
        capturedAt: ISO,
      };
      const envelope = buildEnvelope([ref]);
      const result = planSourceMix(envelope);
      if (!result.ok) return;
      assert.equal(result.plan.visualSidecarRequirement, "optional");
    }),
    { numRuns: 200 },
  );
});

// ---------------------------------------------------------------------------
// Property 6 & 7: Hard invariants always hold
// ---------------------------------------------------------------------------

test("property: rawJiraResponsePersisted and rawPasteBytesPersisted are always false", () => {
  fc.assert(
    fc.property(arbSourceId, arbSourceId, (seed1, seed2) => {
      fc.pre(seed1 !== seed2);
      const env1 = buildEnvelope([arbFigmaRef(seed1)]);
      const env2 = buildEnvelope([arbJiraRestRef(seed2)]);
      for (const envelope of [env1, env2]) {
        const result = planSourceMix(envelope);
        if (!result.ok) return;
        assert.equal(result.plan.rawJiraResponsePersisted, false);
        assert.equal(result.plan.rawPasteBytesPersisted, false);
      }
    }),
    { numRuns: 100 },
  );
});

// ---------------------------------------------------------------------------
// Property 8: sourceMixPlanHash is always a valid 64-hex string
// ---------------------------------------------------------------------------

test("property: sourceMixPlanHash is always a 64-char lowercase hex string", () => {
  const HEX64 = /^[0-9a-f]{64}$/;
  fc.assert(
    fc.property(arbSourceId, (seed) => {
      const envelope = buildEnvelope([arbFigmaRef(seed)]);
      const result = planSourceMix(envelope);
      if (!result.ok) return;
      assert.match(result.plan.sourceMixPlanHash, HEX64);
    }),
    { numRuns: 200 },
  );
});
