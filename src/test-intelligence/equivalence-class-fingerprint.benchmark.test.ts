/**
 * Eingabemasken benchmark gate for Issue #2123.
 *
 * Synthesizes deterministic generated test cases for each of the
 * fifteen archetype fixtures via {@link synthesizeGeneratedTestCases}
 * (the same path the baseline-eval suite uses) and asserts the
 * intra-equivalence-class redundancy ratio stays below 5 %. The
 * benchmark is fully air-gapped — no LLM is invoked.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  GENERATED_TEST_CASE_SCHEMA_VERSION,
  REDACTION_POLICY_VERSION,
  TEST_INTELLIGENCE_CONTRACT_VERSION,
  TEST_INTELLIGENCE_PROMPT_TEMPLATE_VERSION,
  VISUAL_SIDECAR_SCHEMA_VERSION,
  type GeneratedTestCaseAuditMetadata,
} from "../contracts/index.js";
import {
  EINGABEMASKEN_ARCHETYPE_FIXTURE_IDS,
  loadEingabemaskenArchetypeFixture,
  type EingabemaskenArchetypeFixtureId,
} from "./eingabemasken-fixtures.js";
import { detectIntraClassRedundancy } from "./equivalence-class-fingerprint.js";
import { deriveBusinessTestIntentIr } from "./intent-derivation.js";
import { synthesizeGeneratedTestCases } from "./validation-harness.js";

const BENCHMARK_GENERATED_AT = "2026-05-09T00:00:00.000Z" as const;
const REDUNDANCY_BUDGET = 0.05;
const ZERO_HASH =
  "0000000000000000000000000000000000000000000000000000000000000000";

const buildAudit = (
  archetypeId: EingabemaskenArchetypeFixtureId,
): GeneratedTestCaseAuditMetadata => ({
  jobId: `equivalence-class-benchmark-${archetypeId}`,
  generatedAt: BENCHMARK_GENERATED_AT,
  contractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
  schemaVersion: GENERATED_TEST_CASE_SCHEMA_VERSION,
  promptTemplateVersion: TEST_INTELLIGENCE_PROMPT_TEMPLATE_VERSION,
  redactionPolicyVersion: REDACTION_POLICY_VERSION,
  visualSidecarSchemaVersion: VISUAL_SIDECAR_SCHEMA_VERSION,
  cacheHit: false,
  cacheKey: "benchmark",
  inputHash: ZERO_HASH,
  promptHash: ZERO_HASH,
  schemaHash: ZERO_HASH,
});

describe("Issue #2123: Eingabemasken benchmark — equivalence redundancy < 5%", () => {
  for (const archetypeId of EINGABEMASKEN_ARCHETYPE_FIXTURE_IDS) {
    test(`${archetypeId}: redundancyRatio < ${REDUNDANCY_BUDGET}`, async () => {
      const fixture = await loadEingabemaskenArchetypeFixture(archetypeId);
      const intent = deriveBusinessTestIntentIr({ figma: fixture.figma });
      const list = synthesizeGeneratedTestCases({
        jobId: `equivalence-class-benchmark-${archetypeId}`,
        generatedAt: BENCHMARK_GENERATED_AT,
        intent,
        audit: buildAudit(archetypeId),
      });
      assert.ok(
        list.testCases.length > 0,
        `synthesizer produced no cases for ${archetypeId}`,
      );
      const outcome = detectIntraClassRedundancy({
        testCases: list.testCases,
      });
      assert.ok(
        outcome.redundancyRatio < REDUNDANCY_BUDGET,
        `${archetypeId}: redundancyRatio ${outcome.redundancyRatio} ` +
          `must be below ${REDUNDANCY_BUDGET} ` +
          `(redundant=${outcome.redundantCount}/${outcome.totalCases}, ` +
          `classes=${outcome.classCount})`,
      );
    });
  }
});
