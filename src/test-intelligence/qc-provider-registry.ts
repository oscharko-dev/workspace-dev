/**
 * QC provider registry (Issue #1374).
 *
 * The registry is a deterministic, in-memory lookup that turns a provider
 * id into:
 *   - a `QcProviderDescriptor` (capability matrix + label + version), and
 *   - an optional `QcAdapter` instance.
 *
 * Wave 3 wires up the eight builtin descriptors:
 *
 *   - `opentext_alm` — full matrix; concrete adapter from
 *     `qc-alm-dry-run.ts`.
 *   - `opentext_octane`, `opentext_valueedge`, `xray`, `testrail`,
 *     `azure_devops_test_plans`, `qtest` — `validateProfile` + `dryRun`
 *     only; adapter is the fail-closed stub from `qc-provider-stub.ts`.
 *   - `custom` — every flag false until the operator registers a real
 *     adapter via `registerQcProviderAdapter`. The capability for
 *     `register_custom` is intentionally only set on this slot.
 *
 * Hard invariants:
 *   - Pure: `createQcProviderRegistry` does no I/O. The adapter map is
 *     materialised eagerly and exposed through accessors only.
 *   - Deterministic: `listQcProviderDescriptors` is sorted by provider id;
 *     descriptor arrays are frozen.
 *   - Fail-closed: `registerQcProviderAdapter` refuses unknown ids and
 *     refuses to shadow already-registered adapters.
 *   - Provider-specific isolation: descriptors carry capability metadata
 *     only — they never embed provider-specific test-case shape.
 */

import type {
  QcAdapterProvider,
  QcProviderCapabilities,
  QcProviderDescriptor,
} from "../contracts/index.js";
import type { QcAdapter } from "./qc-adapter.js";
import { openTextAlmDryRunAdapter } from "./qc-alm-dry-run.js";
import {
  createDryRunStubAdapter,
  DRY_RUN_STUB_ADAPTER_VERSION,
} from "./qc-provider-stub.js";

/** Refusal codes surfaced by `registerQcProviderAdapter`. */
export const ALLOWED_QC_PROVIDER_REGISTRATION_REFUSAL_CODES = [
  "duplicate_provider_id",
  "unknown_provider_id",
  "provider_mismatch_on_adapter",
  "register_custom_not_supported",
] as const;
export type QcProviderRegistrationRefusalCode =
  (typeof ALLOWED_QC_PROVIDER_REGISTRATION_REFUSAL_CODES)[number];

/**
 * Combined descriptor + adapter slot returned by the registry.
 *
 * Lives in the test-intelligence module rather than in `contracts/index.ts`
 * because `QcAdapter` itself is defined in `qc-adapter.ts` (which depends
 * on contracts). Putting the entry type in contracts would form an import
 * cycle. The descriptor half (`QcProviderDescriptor`) lives in contracts;
 * the entry composes the descriptor with a concrete adapter at runtime.
 */
export interface QcProviderRegistryEntry {
  descriptor: QcProviderDescriptor;
  /** Adapter instance, or `null` for a slot the operator has not filled. */
  adapter: QcAdapter | null;
}

const ALM_CAPABILITIES: QcProviderCapabilities = Object.freeze({
  validateProfile: true,
  resolveTargetFolder: true,
  dryRun: true,
  exportOnly: true,
  apiTransfer: true,
  registerCustom: false,
});

const STUB_CAPABILITIES: QcProviderCapabilities = Object.freeze({
  validateProfile: true,
  resolveTargetFolder: false,
  dryRun: true,
  exportOnly: false,
  apiTransfer: false,
  registerCustom: false,
});

const CUSTOM_CAPABILITIES: QcProviderCapabilities = Object.freeze({
  validateProfile: false,
  resolveTargetFolder: false,
  dryRun: false,
  exportOnly: false,
  apiTransfer: false,
  registerCustom: true,
});

const buildBuiltinDescriptor = (
  provider: QcAdapterProvider,
  label: string,
  capabilities: QcProviderCapabilities,
  options: { mappingProfileSeedId?: string } = {},
): QcProviderDescriptor =>
  Object.freeze({
    provider,
    label,
    version: "1.0.0",
    builtin: true,
    capabilities,
    ...(options.mappingProfileSeedId !== undefined
      ? { mappingProfileSeedId: options.mappingProfileSeedId }
      : {}),
  });

const BUILTIN_DESCRIPTOR_DEFINITIONS: readonly QcProviderDescriptor[] =
  Object.freeze([
    buildBuiltinDescriptor("opentext_alm", "OpenText ALM", ALM_CAPABILITIES, {
      mappingProfileSeedId: "opentext-alm-default",
    }),
    buildBuiltinDescriptor(
      "opentext_octane",
      "OpenText Octane",
      STUB_CAPABILITIES,
    ),
    buildBuiltinDescriptor(
      "opentext_valueedge",
      "OpenText ValueEdge",
      STUB_CAPABILITIES,
    ),
    buildBuiltinDescriptor("xray", "Xray (Jira)", STUB_CAPABILITIES),
    buildBuiltinDescriptor("testrail", "TestRail", STUB_CAPABILITIES),
    buildBuiltinDescriptor(
      "azure_devops_test_plans",
      "Azure DevOps Test Plans",
      STUB_CAPABILITIES,
    ),
    buildBuiltinDescriptor("qtest", "Tricentis qTest", STUB_CAPABILITIES),
    buildBuiltinDescriptor("custom", "Custom adapter", CUSTOM_CAPABILITIES),
  ]);

/**
 * Frozen array of builtin descriptors, sorted by provider id. Exposed so
 * UI/audit code can render the matrix without instantiating the registry.
 */
export const BUILTIN_QC_PROVIDER_DESCRIPTORS: readonly QcProviderDescriptor[] =
  Object.freeze(
    [...BUILTIN_DESCRIPTOR_DEFINITIONS].sort((a, b) =>
      a.provider.localeCompare(b.provider),
    ),
  );

/** Read-only registry surface returned by `createQcProviderRegistry`. */
export interface QcProviderRegistry {
  /**
   * Snapshot map keyed by provider id. Values are entry copies; mutating
   * them does NOT mutate the registry. Re-call `getQcProviderEntry` to
   * read the live state.
   */
  readonly snapshot: ReadonlyMap<QcAdapterProvider, QcProviderRegistryEntry>;
}

interface MutableRegistryState {
  entries: Map<QcAdapterProvider, QcProviderRegistryEntry>;
}

const cloneDescriptor = (d: QcProviderDescriptor): QcProviderDescriptor => ({
  provider: d.provider,
  label: d.label,
  version: d.version,
  builtin: d.builtin,
  capabilities: { ...d.capabilities },
  ...(d.mappingProfileSeedId !== undefined
    ? { mappingProfileSeedId: d.mappingProfileSeedId }
    : {}),
});

const buildBuiltinAdapter = (provider: QcAdapterProvider): QcAdapter | null => {
  if (provider === "opentext_alm") return openTextAlmDryRunAdapter;
  if (provider === "custom") return null;
  return createDryRunStubAdapter({
    provider,
    version: DRY_RUN_STUB_ADAPTER_VERSION,
  });
};

/** Inputs accepted by `createQcProviderRegistry`. */
export interface CreateQcProviderRegistryInput {
  /**
   * Optional caller-supplied descriptors. They never replace a builtin
   * descriptor; instead they are added under their declared provider id
   * so an operator can describe a `"custom"` slot they intend to fill.
   * Currently only the `"custom"` provider is allowed here — supplying any
   * other id is a configuration mistake and the descriptor is ignored.
   */
  extraDescriptors?: readonly QcProviderDescriptor[];
  /**
   * Optional caller-supplied adapters. They are NOT installed eagerly —
   * call `registerQcProviderAdapter` after construction so the same
   * conflict checks apply uniformly. Reserved for future callers that
   * want to seed the registry; currently always omitted.
   */
  extraAdapters?: readonly QcAdapter[];
}

/**
 * Construct a fresh registry seeded with the eight builtin descriptors
 * and their default adapters (concrete ALM + stubs for the rest).
 */
export const createQcProviderRegistry = (
  input: CreateQcProviderRegistryInput = {},
): QcProviderRegistry => {
  const state: MutableRegistryState = { entries: new Map() };

  for (const descriptor of BUILTIN_QC_PROVIDER_DESCRIPTORS) {
    state.entries.set(descriptor.provider, {
      descriptor: cloneDescriptor(descriptor),
      adapter: buildBuiltinAdapter(descriptor.provider),
    });
  }

  if (input.extraDescriptors) {
    for (const extra of input.extraDescriptors) {
      // Only the reserved `custom` slot may be redefined; everything else
      // would shadow a builtin which is fail-closed.
      if (extra.provider !== "custom") continue;
      state.entries.set("custom", {
        descriptor: cloneDescriptor({ ...extra, builtin: false }),
        adapter: null,
      });
    }
  }

  // The optional `extraAdapters` knob is intentionally not consumed here
  // so callers always go through `registerQcProviderAdapter`, which
  // applies the full conflict matrix.
  void input.extraAdapters;

  // Freeze the snapshot view so callers cannot mutate via casting.
  const snapshot = new Map(state.entries);
  return Object.freeze({
    snapshot,
  });
};

/**
 * Result of `registerQcProviderAdapter`. A successful registration
 * returns the resulting registry view; a refusal carries a structured
 * code so callers can branch on it without parsing strings.
 */
export type RegisterQcProviderAdapterResult =
  | { ok: true; registry: QcProviderRegistry }
  | { ok: false; refusalCode: QcProviderRegistrationRefusalCode };

/** Inputs for `registerQcProviderAdapter`. */
export interface RegisterQcProviderAdapterInput {
  registry: QcProviderRegistry;
  adapter: QcAdapter;
  /**
   * Optional descriptor to attach when the adapter targets the `custom`
   * slot. Required when the slot's current descriptor is the builtin
   * `custom` placeholder; ignored for non-`custom` providers.
   */
  descriptor?: QcProviderDescriptor;
}

/**
 * Register or replace the adapter for a known provider id.
 *
 * Refusal matrix:
 *   - `unknown_provider_id` — the adapter's provider is not in the
 *     registry's snapshot at all.
 *   - `provider_mismatch_on_adapter` — `descriptor.provider` does not
 *     equal `adapter.provider`.
 *   - `register_custom_not_supported` — the slot's descriptor declares
 *     `capabilities.registerCustom === false`. Today this protects every
 *     non-`custom` builtin from being shadowed.
 *   - `duplicate_provider_id` — the slot already carries a non-null
 *     adapter and the caller did not pass an override-allowing flag.
 *     (Wave 3 has no such flag — registration is single-shot per id.)
 */
export const registerQcProviderAdapter = (
  input: RegisterQcProviderAdapterInput,
): RegisterQcProviderAdapterResult => {
  const { adapter, descriptor } = input;
  const entry = input.registry.snapshot.get(adapter.provider);
  if (!entry) {
    return { ok: false, refusalCode: "unknown_provider_id" };
  }
  if (descriptor !== undefined && descriptor.provider !== adapter.provider) {
    return { ok: false, refusalCode: "provider_mismatch_on_adapter" };
  }
  if (!entry.descriptor.capabilities.registerCustom) {
    return { ok: false, refusalCode: "register_custom_not_supported" };
  }
  if (entry.adapter !== null) {
    return { ok: false, refusalCode: "duplicate_provider_id" };
  }

  const nextDescriptor: QcProviderDescriptor =
    descriptor !== undefined
      ? cloneDescriptor({ ...descriptor, builtin: false })
      : cloneDescriptor(entry.descriptor);
  const nextSnapshot = new Map(input.registry.snapshot);
  nextSnapshot.set(adapter.provider, {
    descriptor: nextDescriptor,
    adapter,
  });
  return {
    ok: true,
    registry: Object.freeze({ snapshot: nextSnapshot }),
  };
};

/** Read a single descriptor for the given provider, or `null` if absent. */
export const getQcProviderDescriptor = (
  registry: QcProviderRegistry,
  provider: QcAdapterProvider,
): QcProviderDescriptor | null => {
  const entry = registry.snapshot.get(provider);
  return entry ? cloneDescriptor(entry.descriptor) : null;
};

/**
 * Return all descriptors sorted by provider id. The sort is stable
 * across calls — tests can assert exact equality.
 */
export const listQcProviderDescriptors = (
  registry: QcProviderRegistry,
): QcProviderDescriptor[] => {
  const out: QcProviderDescriptor[] = [];
  for (const entry of registry.snapshot.values()) {
    out.push(cloneDescriptor(entry.descriptor));
  }
  return out.sort((a, b) => a.provider.localeCompare(b.provider));
};

/**
 * Return the adapter for the given provider id, or `null` if no adapter
 * is wired up for that slot (e.g. unfilled `custom`).
 */
export const resolveQcProviderAdapter = (
  registry: QcProviderRegistry,
  provider: QcAdapterProvider,
): QcAdapter | null => {
  const entry = registry.snapshot.get(provider);
  return entry ? entry.adapter : null;
};

/** Read the full entry (descriptor + adapter) for the given provider id. */
export const getQcProviderEntry = (
  registry: QcProviderRegistry,
  provider: QcAdapterProvider,
): QcProviderRegistryEntry | null => {
  const entry = registry.snapshot.get(provider);
  return entry
    ? { descriptor: cloneDescriptor(entry.descriptor), adapter: entry.adapter }
    : null;
};
