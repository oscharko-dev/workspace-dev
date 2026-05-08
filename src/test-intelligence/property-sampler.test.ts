/**
 * Tests for the deterministic property-based sampler (Issue #2040).
 */

import assert from "node:assert/strict";
import test from "node:test";
import {
  buildActiveDatasetInvariantRegistry,
  createInvariantRegistry,
} from "./domain-invariant-registry.js";
import {
  findInvariantsMissingSamplerFactory,
  sampleInvariantSeeds,
} from "./property-sampler.js";

test("sampler: every active-dataset invariant has a registered factory", () => {
  const registry = buildActiveDatasetInvariantRegistry();
  const missing = findInvariantsMissingSamplerFactory(registry.list());
  assert.deepEqual(
    missing,
    [],
    `every active-dataset invariant must have a sampler factory; missing: ${missing.join(", ")}`,
  );
});

test("sampler: produces deterministic seeds for the active-dataset registry", () => {
  const registry = buildActiveDatasetInvariantRegistry();
  const a = sampleInvariantSeeds({ registry });
  const b = sampleInvariantSeeds({ registry });
  assert.deepEqual(a, b, "sampler must be byte-identical across runs");
  assert.ok(a.seeds.length > 0);
  for (const seed of a.seeds) {
    assert.ok(seed.invariantId.startsWith("INV-"));
    assert.ok(seed.precondition.length > 0);
    assert.ok(seed.expected.length > 0);
  }
});

test("sampler: seeds carry every active-dataset invariant id", () => {
  const registry = buildActiveDatasetInvariantRegistry();
  const result = sampleInvariantSeeds({ registry });
  assert.deepEqual(result.invariantIds, [
    "INV-FINANCING-NEED-01",
    "INV-NETTO-BRUTTO-01",
    "INV-OPTIONAL-COST-01",
    "INV-VAT-01",
  ]);
});

test("sampler: rejects out-of-range run counts", () => {
  const registry = buildActiveDatasetInvariantRegistry();
  assert.throws(() => sampleInvariantSeeds({ registry, runs: 0 }), RangeError);
  assert.throws(() => sampleInvariantSeeds({ registry, runs: 65 }), RangeError);
});

test("sampler: skips invariants without a registered factory", () => {
  const registry = createInvariantRegistry();
  registry.register({
    id: "INV-UNKNOWN-01",
    scope: "test",
    description: "unsamplable",
    source: "Issue #2040",
    severity: "warning",
    forall: () => false,
    holds: () => true,
  });
  const result = sampleInvariantSeeds({ registry });
  assert.deepEqual(result.seeds, []);
  assert.deepEqual(result.invariantIds, []);
});
