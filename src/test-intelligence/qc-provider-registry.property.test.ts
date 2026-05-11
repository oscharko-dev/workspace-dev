/**
 * QC provider registry property tests (Issue #1374).
 *
 * Properties asserted:
 *   1. Every builtin descriptor has exactly six boolean capability flags.
 *   2. Every builtin descriptor has a non-empty label and a semver-shaped
 *      version.
 *   3. The provider id on the descriptor is one of the eight allowed
 *      adapter providers.
 *   4. `resolveQcProviderAdapter` returns a non-null `QcAdapter` exactly
 *      when the descriptor's `dryRun` capability is `true`.
 *   5. The descriptor returned by `getQcProviderDescriptor` is independent
 *      from the registry — mutating the returned object does not change
 *      what the next read sees.
 */

import assert from "node:assert/strict";
import test from "node:test";
import fc from "fast-check";
import {
  ALLOWED_QC_ADAPTER_PROVIDERS,
  type QcAdapterProvider,
} from "../contracts/index.js";
import {
  BUILTIN_QC_PROVIDER_DESCRIPTORS,
  createQcProviderRegistry,
  getQcProviderDescriptor,
  resolveQcProviderAdapter,
} from "./qc-provider-registry.js";

const SEMVER_REGEX = /^\d+\.\d+\.\d+$/;

const providerArb = fc.constantFrom(
  ...(ALLOWED_QC_ADAPTER_PROVIDERS as readonly QcAdapterProvider[]),
);

test("property: every builtin descriptor has six boolean capability flags", () => {
  for (const descriptor of BUILTIN_QC_PROVIDER_DESCRIPTORS) {
    const caps = descriptor.capabilities;
    const keys = Object.keys(caps);
    assert.equal(
      keys.length,
      6,
      `descriptor ${descriptor.provider} has ${keys.length} capability flags, expected 6`,
    );
    for (const k of keys) {
      const v = caps[k as keyof typeof caps];
      assert.equal(
        typeof v,
        "boolean",
        `descriptor ${descriptor.provider}.capabilities.${k} is ${typeof v}, expected boolean`,
      );
    }
  }
});

test("property: every builtin descriptor has non-empty label and semver version", () => {
  for (const descriptor of BUILTIN_QC_PROVIDER_DESCRIPTORS) {
    assert.ok(
      descriptor.label.length > 0,
      `descriptor ${descriptor.provider} has empty label`,
    );
    assert.match(
      descriptor.version,
      SEMVER_REGEX,
      `descriptor ${descriptor.provider} version ${descriptor.version} is not semver`,
    );
  }
});

test("property: descriptor.provider is in ALLOWED_QC_ADAPTER_PROVIDERS", () => {
  const allowed = new Set(ALLOWED_QC_ADAPTER_PROVIDERS);
  for (const descriptor of BUILTIN_QC_PROVIDER_DESCRIPTORS) {
    assert.ok(
      allowed.has(descriptor.provider),
      `descriptor.provider ${descriptor.provider} not in allowed list`,
    );
  }
});

test("property: adapter presence matches capabilities.dryRun, except for custom slot", () => {
  const registry = createQcProviderRegistry();
  fc.assert(
    fc.property(providerArb, (provider) => {
      const descriptor = getQcProviderDescriptor(registry, provider);
      assert.ok(descriptor);
      const adapter = resolveQcProviderAdapter(registry, provider);
      if (provider === "custom") {
        // Reserved slot has dryRun=false and adapter=null until registered.
        assert.equal(adapter, null);
        assert.equal(descriptor?.capabilities.dryRun, false);
        return;
      }
      // Every non-custom builtin slot has dryRun=true and an adapter.
      assert.equal(descriptor?.capabilities.dryRun, true);
      assert.ok(adapter);
      assert.equal(adapter?.provider, provider);
    }),
    { numRuns: 64 },
  );
});

test("property: getQcProviderDescriptor returns an independent copy", () => {
  const registry = createQcProviderRegistry();
  fc.assert(
    fc.property(providerArb, (provider) => {
      const a = getQcProviderDescriptor(registry, provider);
      assert.ok(a);
      // Mutate the returned label and capability flag.
      const mutable = a as { label: string; capabilities: { dryRun: boolean } };
      mutable.label = "MUTATED";
      mutable.capabilities.dryRun = !mutable.capabilities.dryRun;
      const b = getQcProviderDescriptor(registry, provider);
      assert.ok(b);
      assert.notEqual(b?.label, "MUTATED");
    }),
    { numRuns: 32 },
  );
});

test("property: only the custom slot has registerCustom=true", () => {
  for (const descriptor of BUILTIN_QC_PROVIDER_DESCRIPTORS) {
    const expected = descriptor.provider === "custom";
    assert.equal(
      descriptor.capabilities.registerCustom,
      expected,
      `registerCustom mismatch on ${descriptor.provider}`,
    );
  }
});

test("property: opentext_alm is the only provider with apiTransfer=true", () => {
  for (const descriptor of BUILTIN_QC_PROVIDER_DESCRIPTORS) {
    const expected = descriptor.provider === "opentext_alm";
    assert.equal(
      descriptor.capabilities.apiTransfer,
      expected,
      `apiTransfer mismatch on ${descriptor.provider}`,
    );
  }
});
