/**
 * Property-based sampler (Issue #2040).
 *
 * Derives concrete seed test data and mutation-killer candidates from a
 * {@link DomainInvariantRegistry}. The sampler is the deterministic
 * pre-generation hook the validation pipeline relies on:
 *
 *   1. Iterate the registry. For each invariant we know how to derive
 *      property-seeds for, run a bounded `fast-check` arbitrary to
 *      generate concrete `(precondition, expected)` pairs.
 *   2. Each pair is annotated with the invariant id it exercises.
 *   3. The pair set is consumed by upstream callers — typically the
 *      property-sampler test that asserts the registry is well-formed,
 *      or by a downstream tooling integration that wants to feed the
 *      pairs to the LLM as worked examples.
 *
 * The sampler intentionally produces a small, deterministic set of pairs
 * (`runs ≤ 16`, fixed seed) so cache keys remain stable. The point is not
 * to fuzz the LLM — it is to anchor every invariant in concrete data that
 * the LLM must reproduce or extend.
 */

import fc from "fast-check";
import type {
  DomainInvariant,
  DomainInvariantRegistry,
} from "./domain-invariant-registry.js";

const DEFAULT_RUNS = 8;
const DEFAULT_SEED = 0x2040_a07a;

/** Single seed pair anchored to one invariant. */
export interface InvariantSeedPair {
  readonly invariantId: string;
  readonly precondition: string;
  readonly expected: string;
}

/** Aggregate sampler output. */
export interface InvariantSeedSet {
  readonly seeds: readonly InvariantSeedPair[];
  /** Sorted invariant ids the sampler emitted seeds for. */
  readonly invariantIds: readonly string[];
}

interface SeedFactory {
  readonly invariantId: string;
  readonly arbitrary: fc.Arbitrary<{ precondition: string; expected: string }>;
}

const VAT_RATE_ARB = fc.constantFrom(0.07, 0.16, 0.19, 0.2, 0.25);
const NETTO_AMOUNT_ARB = fc.integer({ min: 100, max: 10_000 });
const OPTIONAL_FEE_ARB = fc.integer({ min: 5, max: 250 });

const formatEuro = (value: number): string =>
  value.toLocaleString("de-DE", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

const buildVatExclusionSeed = (): SeedFactory => ({
  invariantId: "INV-VAT-01",
  arbitrary: fc
    .tuple(NETTO_AMOUNT_ARB, VAT_RATE_ARB)
    .map(([netto, vatRate]) => {
      const expectedTotal = netto;
      return {
        precondition: `Netto financing inputs total ${formatEuro(netto)} and the VAT rate is ${(vatRate * 100).toFixed(0)} %.`,
        expected: `The financing-need result equals ${formatEuro(expectedTotal)}; VAT is excluded from the financing-need calculation.`,
      };
    }),
});

const buildNettoBruttoExclusivitySeed = (): SeedFactory => ({
  invariantId: "INV-NETTO-BRUTTO-01",
  arbitrary: fc
    .tuple(NETTO_AMOUNT_ARB, VAT_RATE_ARB)
    .map(([netto, vatRate]) => {
      const brutto = Math.round(netto * (1 + vatRate) * 100) / 100;
      return {
        precondition: `Netto base ${formatEuro(netto)} and Brutto base ${formatEuro(brutto)} are presented as separate fields.`,
        expected: `Netto and Brutto results are surfaced in distinct expected-result lines; no single line conflates the two bases.`,
      };
    }),
});

const buildOptionalCostSeed = (): SeedFactory => ({
  invariantId: "INV-OPTIONAL-COST-01",
  arbitrary: fc
    .tuple(NETTO_AMOUNT_ARB, OPTIONAL_FEE_ARB, fc.boolean())
    .map(([netto, optionalFee, optionalSelected]) => {
      const total = optionalSelected ? netto + optionalFee : netto;
      return {
        precondition: optionalSelected
          ? `The optional cost field "Versandgebühr" is selected with value ${formatEuro(optionalFee)} alongside the base amount ${formatEuro(netto)}.`
          : `The optional cost field "Versandgebühr" remains unselected and the base amount is ${formatEuro(netto)}.`,
        expected: optionalSelected
          ? `The total includes the optional fee and equals ${formatEuro(total)}.`
          : `The total equals the base amount ${formatEuro(total)} because the optional cost field was not selected.`,
      };
    }),
});

const buildFinancingNeedFormulaSeed = (): SeedFactory => ({
  invariantId: "INV-FINANCING-NEED-01",
  arbitrary: fc
    .tuple(NETTO_AMOUNT_ARB, NETTO_AMOUNT_ARB)
    .map(([principal, downPayment]) => {
      const need = Math.max(principal - downPayment, 0);
      return {
        precondition: `Principal cost ${formatEuro(principal)} and down payment ${formatEuro(downPayment)} are bounded inputs on the financing screen.`,
        expected: `Financing need equals ${formatEuro(need)} (principal − down payment, VAT excluded).`,
      };
    }),
});

const SEED_FACTORIES: readonly SeedFactory[] = [
  buildVatExclusionSeed(),
  buildNettoBruttoExclusivitySeed(),
  buildOptionalCostSeed(),
  buildFinancingNeedFormulaSeed(),
];

const factoryById = (id: string): SeedFactory | undefined =>
  SEED_FACTORIES.find((factory) => factory.invariantId === id);

/**
 * Sample seed pairs for the invariants in `registry` that the sampler
 * knows how to derive concrete data for. Invariants without a registered
 * factory are skipped — the registry-driven validation still applies.
 *
 * The sampler is deterministic: same registry => same `runs` and
 * `seed` => byte-identical seed list. That property keeps replay caches
 * and cache keys stable across CI runs.
 */
export const sampleInvariantSeeds = (input: {
  readonly registry: DomainInvariantRegistry;
  readonly runs?: number;
  readonly seed?: number;
}): InvariantSeedSet => {
  const runs = input.runs ?? DEFAULT_RUNS;
  if (!Number.isInteger(runs) || runs <= 0 || runs > 64) {
    throw new RangeError(
      `property-sampler: runs must be a positive integer ≤ 64 (got ${runs})`,
    );
  }
  const seed = input.seed ?? DEFAULT_SEED;
  const seeds: InvariantSeedPair[] = [];
  const ids = new Set<string>();

  for (const invariant of input.registry.list()) {
    const factory = factoryById(invariant.id);
    if (factory === undefined) continue;
    ids.add(invariant.id);
    const samples = sampleArbitrary(factory.arbitrary, runs, seed);
    for (const sample of samples) {
      seeds.push({
        invariantId: invariant.id,
        precondition: sample.precondition,
        expected: sample.expected,
      });
    }
  }
  // Deterministic deduplicate-by-tuple; sample shape is small so a Set on
  // the canonical key is cheap and keeps emitted pairs stable.
  const dedup = new Map<string, InvariantSeedPair>();
  for (const pair of seeds) {
    const key = `${pair.invariantId}${pair.precondition}${pair.expected}`;
    if (!dedup.has(key)) dedup.set(key, pair);
  }
  const sortedSeeds = [...dedup.values()].sort((left, right) => {
    const byInvariant = left.invariantId.localeCompare(right.invariantId);
    if (byInvariant !== 0) return byInvariant;
    const byPrecondition = left.precondition.localeCompare(right.precondition);
    if (byPrecondition !== 0) return byPrecondition;
    return left.expected.localeCompare(right.expected);
  });
  return {
    seeds: sortedSeeds,
    invariantIds: [...ids].sort((left, right) => left.localeCompare(right)),
  };
};

const sampleArbitrary = <T>(
  arbitrary: fc.Arbitrary<T>,
  runs: number,
  seed: number,
): T[] => {
  return fc.sample(arbitrary, { numRuns: runs, seed });
};

/**
 * Helper exposed for tests: confirm that every supplied invariant has a
 * matching sampler factory. Returns the ids without a factory so the
 * caller can decide whether to skip or fail.
 */
export const findInvariantsMissingSamplerFactory = (
  invariants: ReadonlyArray<DomainInvariant>,
): readonly string[] => {
  const out: string[] = [];
  for (const invariant of invariants) {
    if (factoryById(invariant.id) === undefined) {
      out.push(invariant.id);
    }
  }
  return out.sort((left, right) => left.localeCompare(right));
};
