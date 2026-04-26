/**
 * QC provider registry tests (Issue #1374).
 *
 * Acceptance:
 *   - All 8 builtin descriptors are present and capability matrices match
 *     the design.
 *   - `listQcProviderDescriptors` returns sorted by provider id.
 *   - `resolveQcProviderAdapter` returns a real ALM adapter for
 *     `opentext_alm`, the stub for the other six, and `null` for the
 *     unfilled `custom` slot.
 *   - Custom adapter registration installs the adapter and persists across
 *     subsequent reads.
 *   - Duplicate registration on a slot whose adapter is already non-null
 *     refuses with `duplicate_provider_id`.
 *   - Trying to register under an unknown provider id refuses with
 *     `unknown_provider_id`.
 *   - Trying to shadow a builtin (e.g. `opentext_alm`) refuses with
 *     `register_custom_not_supported`.
 *   - Provider isolation: nothing on the descriptor or registry surface
 *     embeds provider-specific test-case fields.
 */

import assert from "node:assert/strict";
import test from "node:test";
import {
  ALLOWED_QC_ADAPTER_PROVIDERS,
  ALLOWED_QC_PROVIDER_OPERATIONS,
  DRY_RUN_REPORT_SCHEMA_VERSION,
  QC_MAPPING_PREVIEW_SCHEMA_VERSION,
  TEST_INTELLIGENCE_CONTRACT_VERSION,
  type DryRunReportArtifact,
  type QcAdapterProvider,
  type QcMappingProfile,
  type QcMappingProfileValidationResult,
  type QcProviderDescriptor,
} from "../contracts/index.js";
import type { QcAdapter, QcAdapterDryRunInput } from "./qc-adapter.js";
import {
  createFixedClock,
  DEFAULT_DRY_RUN_ID_SOURCE,
} from "./qc-alm-dry-run.js";
import { cloneOpenTextAlmDefaultMappingProfile } from "./qc-alm-mapping-profile.js";
import {
  BUILTIN_QC_PROVIDER_DESCRIPTORS,
  createQcProviderRegistry,
  getQcProviderDescriptor,
  getQcProviderEntry,
  listQcProviderDescriptors,
  registerQcProviderAdapter,
  resolveQcProviderAdapter,
} from "./qc-provider-registry.js";

const ALL_PROVIDERS: readonly QcAdapterProvider[] =
  ALLOWED_QC_ADAPTER_PROVIDERS;

const buildCustomAdapter = (
  refusalReason: string = "custom-test-double",
): QcAdapter => ({
  provider: "custom",
  version: "0.0.1",
  validateProfile(
    _profile: QcMappingProfile,
  ): QcMappingProfileValidationResult {
    return {
      ok: true,
      errorCount: 0,
      warningCount: 0,
      issues: [],
    };
  },
  async dryRun(input: QcAdapterDryRunInput): Promise<DryRunReportArtifact> {
    return {
      schemaVersion: DRY_RUN_REPORT_SCHEMA_VERSION,
      contractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
      reportId: `custom-${refusalReason}`,
      jobId: input.jobId,
      generatedAt: input.clock.now(),
      mode: "dry_run",
      adapter: { provider: "custom", version: "0.0.1" },
      profile: { id: input.profile.id, version: input.profile.version },
      refused: false,
      refusalCodes: [],
      profileValidation: {
        ok: true,
        errorCount: 0,
        warningCount: 0,
        issues: [],
      },
      completeness: {
        totalCases: 0,
        completeCases: 0,
        incompleteCases: 0,
        missingFieldsAcrossCases: [],
        perCase: [],
      },
      folderResolution: {
        state: "simulated",
        path: input.profile.targetFolderPath,
        evidence: `simulated:custom-${refusalReason}`,
      },
      plannedPayloads: [],
      visualEvidenceFlags: [],
      rawScreenshotsIncluded: false,
      credentialsIncluded: false,
    };
  },
});

const buildCustomDescriptor = (
  options: Partial<QcProviderDescriptor> = {},
): QcProviderDescriptor => ({
  provider: "custom",
  label: "Custom test adapter",
  version: "0.0.1",
  builtin: false,
  capabilities: {
    validateProfile: true,
    resolveTargetFolder: false,
    dryRun: true,
    exportOnly: false,
    apiTransfer: false,
    registerCustom: true,
  },
  ...options,
});

test("qc-provider-registry: all 8 builtin descriptors are present", () => {
  const registry = createQcProviderRegistry();
  const descriptors = listQcProviderDescriptors(registry);
  const ids = descriptors.map((d) => d.provider).sort();
  assert.deepEqual(ids, [...ALL_PROVIDERS].sort());
  assert.equal(descriptors.length, ALL_PROVIDERS.length);
});

test("qc-provider-registry: listQcProviderDescriptors returns sorted by provider id", () => {
  const registry = createQcProviderRegistry();
  const descriptors = listQcProviderDescriptors(registry);
  const sorted = [...descriptors].sort((a, b) =>
    a.provider.localeCompare(b.provider),
  );
  assert.deepEqual(
    descriptors.map((d) => d.provider),
    sorted.map((d) => d.provider),
  );
});

test("qc-provider-registry: BUILTIN_QC_PROVIDER_DESCRIPTORS is sorted", () => {
  const ids = BUILTIN_QC_PROVIDER_DESCRIPTORS.map((d) => d.provider);
  const sorted = [...ids].sort();
  assert.deepEqual(ids, sorted);
});

test("qc-provider-registry: capability matrix per provider matches design", () => {
  const registry = createQcProviderRegistry();
  const expected: Record<
    QcAdapterProvider,
    {
      validateProfile: boolean;
      resolveTargetFolder: boolean;
      dryRun: boolean;
      exportOnly: boolean;
      apiTransfer: boolean;
      registerCustom: boolean;
    }
  > = {
    opentext_alm: {
      validateProfile: true,
      resolveTargetFolder: true,
      dryRun: true,
      exportOnly: true,
      apiTransfer: true,
      registerCustom: false,
    },
    opentext_octane: {
      validateProfile: true,
      resolveTargetFolder: false,
      dryRun: true,
      exportOnly: false,
      apiTransfer: false,
      registerCustom: false,
    },
    opentext_valueedge: {
      validateProfile: true,
      resolveTargetFolder: false,
      dryRun: true,
      exportOnly: false,
      apiTransfer: false,
      registerCustom: false,
    },
    xray: {
      validateProfile: true,
      resolveTargetFolder: false,
      dryRun: true,
      exportOnly: false,
      apiTransfer: false,
      registerCustom: false,
    },
    testrail: {
      validateProfile: true,
      resolveTargetFolder: false,
      dryRun: true,
      exportOnly: false,
      apiTransfer: false,
      registerCustom: false,
    },
    azure_devops_test_plans: {
      validateProfile: true,
      resolveTargetFolder: false,
      dryRun: true,
      exportOnly: false,
      apiTransfer: false,
      registerCustom: false,
    },
    qtest: {
      validateProfile: true,
      resolveTargetFolder: false,
      dryRun: true,
      exportOnly: false,
      apiTransfer: false,
      registerCustom: false,
    },
    custom: {
      validateProfile: false,
      resolveTargetFolder: false,
      dryRun: false,
      exportOnly: false,
      apiTransfer: false,
      registerCustom: true,
    },
  };
  for (const provider of ALL_PROVIDERS) {
    const d = getQcProviderDescriptor(registry, provider);
    assert.ok(d, `descriptor for ${provider} should be present`);
    assert.deepEqual(
      d?.capabilities,
      expected[provider],
      `capability matrix mismatch for ${provider}`,
    );
  }
});

test("qc-provider-registry: opentext_alm resolves to a real adapter", () => {
  const registry = createQcProviderRegistry();
  const adapter = resolveQcProviderAdapter(registry, "opentext_alm");
  assert.ok(adapter, "ALM adapter must be wired up");
  assert.equal(adapter?.provider, "opentext_alm");
});

test("qc-provider-registry: non-ALM/non-custom providers resolve to a stub adapter", () => {
  const registry = createQcProviderRegistry();
  for (const provider of ALL_PROVIDERS) {
    if (provider === "opentext_alm" || provider === "custom") continue;
    const adapter = resolveQcProviderAdapter(registry, provider);
    assert.ok(adapter, `stub for ${provider} must be wired up`);
    assert.equal(adapter?.provider, provider);
    // Stub is fail-closed and does not perform I/O, but we don't run it
    // here — that's covered in qc-provider-stub.test.ts. Asserting the
    // provider id surface and presence is sufficient at the registry layer.
  }
});

test("qc-provider-registry: custom slot resolves to null until registered", () => {
  const registry = createQcProviderRegistry();
  assert.equal(resolveQcProviderAdapter(registry, "custom"), null);
});

test("qc-provider-registry: custom adapter registers, resolves, and survives sibling reads", async () => {
  const initial = createQcProviderRegistry();
  const adapter = buildCustomAdapter();
  const result = registerQcProviderAdapter({
    registry: initial,
    adapter,
    descriptor: buildCustomDescriptor(),
  });
  assert.equal(result.ok, true);
  assert.notStrictEqual(result.ok && result.registry, initial);
  if (!result.ok) return;
  const registered = resolveQcProviderAdapter(result.registry, "custom");
  assert.ok(registered);
  assert.equal(registered?.provider, "custom");
  assert.equal(registered?.version, "0.0.1");
  const registeredDescriptor = getQcProviderDescriptor(
    result.registry,
    "custom",
  );
  assert.equal(registeredDescriptor?.capabilities.validateProfile, true);
  assert.equal(registeredDescriptor?.capabilities.dryRun, true);
  assert.equal(registeredDescriptor?.capabilities.registerCustom, false);

  // Sanity: smoke-running the adapter does not change the registry.
  const profile = cloneOpenTextAlmDefaultMappingProfile();
  profile.provider = "custom";
  const report = await registered?.dryRun({
    jobId: "job-1374-custom",
    mode: "dry_run",
    profile,
    preview: {
      schemaVersion: QC_MAPPING_PREVIEW_SCHEMA_VERSION,
      contractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
      jobId: "job-1374-custom",
      generatedAt: "2026-04-26T10:00:00.000Z",
      profileId: profile.id,
      profileVersion: profile.version,
      entries: [],
    },
    clock: createFixedClock("2026-04-26T10:00:00.000Z"),
    idSource: DEFAULT_DRY_RUN_ID_SOURCE,
  });
  assert.ok(report);
  assert.equal(report?.adapter.provider, "custom");

  // Reading the registry again returns the same descriptor (no mutation).
  const reread = resolveQcProviderAdapter(result.registry, "custom");
  assert.ok(reread);
});

test("qc-provider-registry: duplicate custom registration refuses", () => {
  const initial = createQcProviderRegistry();
  const first = registerQcProviderAdapter({
    registry: initial,
    adapter: buildCustomAdapter(),
    descriptor: buildCustomDescriptor(),
  });
  assert.equal(first.ok, true);
  if (!first.ok) return;
  const second = registerQcProviderAdapter({
    registry: first.registry,
    adapter: buildCustomAdapter("second"),
    descriptor: buildCustomDescriptor({ version: "0.0.2" }),
  });
  assert.equal(second.ok, false);
  if (second.ok) return;
  assert.equal(second.refusalCode, "duplicate_provider_id");
});

test("qc-provider-registry: shadowing a builtin refuses with register_custom_not_supported", () => {
  const initial = createQcProviderRegistry();
  const shadow: QcAdapter = {
    provider: "opentext_alm",
    version: "0.0.1",
    validateProfile() {
      return { ok: true, errorCount: 0, warningCount: 0, issues: [] };
    },
    async dryRun(input) {
      return {
        schemaVersion: DRY_RUN_REPORT_SCHEMA_VERSION,
        contractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
        reportId: "shadow",
        jobId: input.jobId,
        generatedAt: input.clock.now(),
        mode: "dry_run",
        adapter: { provider: "opentext_alm", version: "0.0.1" },
        profile: { id: input.profile.id, version: input.profile.version },
        refused: true,
        refusalCodes: ["provider_not_implemented"],
        profileValidation: {
          ok: true,
          errorCount: 0,
          warningCount: 0,
          issues: [],
        },
        completeness: {
          totalCases: 0,
          completeCases: 0,
          incompleteCases: 0,
          missingFieldsAcrossCases: [],
          perCase: [],
        },
        folderResolution: {
          state: "simulated",
          path: input.profile.targetFolderPath,
          evidence: "simulated:shadow",
        },
        plannedPayloads: [],
        visualEvidenceFlags: [],
        rawScreenshotsIncluded: false,
        credentialsIncluded: false,
      };
    },
  };
  const result = registerQcProviderAdapter({
    registry: initial,
    adapter: shadow,
  });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.refusalCode, "register_custom_not_supported");
});

test("qc-provider-registry: registering into builtin custom slot requires descriptor", () => {
  const initial = createQcProviderRegistry();
  const result = registerQcProviderAdapter({
    registry: initial,
    adapter: buildCustomAdapter(),
  });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.refusalCode, "custom_descriptor_required");
  assert.equal(resolveQcProviderAdapter(initial, "custom"), null);
});

test("qc-provider-registry: registering with descriptor whose provider differs refuses", () => {
  const initial = createQcProviderRegistry();
  const adapter = buildCustomAdapter();
  const mismatchedDescriptor = {
    provider: "xray" as const,
    label: "Mismatch",
    version: "0.0.1",
    builtin: false,
    capabilities: {
      validateProfile: false,
      resolveTargetFolder: false,
      dryRun: false,
      exportOnly: false,
      apiTransfer: false,
      registerCustom: true,
    },
  };
  const result = registerQcProviderAdapter({
    registry: initial,
    adapter,
    descriptor: mismatchedDescriptor,
  });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.refusalCode, "provider_mismatch_on_adapter");
});

test("qc-provider-registry: ALLOWED_QC_PROVIDER_OPERATIONS matches capabilities keys", () => {
  // Each capability flag must correspond to exactly one operation literal.
  const operationToFlag: Record<string, keyof BuiltCaps> = {
    validate_profile: "validateProfile",
    resolve_target_folder: "resolveTargetFolder",
    dry_run: "dryRun",
    export_only: "exportOnly",
    api_transfer: "apiTransfer",
    register_custom: "registerCustom",
  };
  const operations = [...ALLOWED_QC_PROVIDER_OPERATIONS].sort();
  const flags = Object.keys(operationToFlag)
    .map((k) => k)
    .sort();
  assert.deepEqual(operations, flags);
});

interface BuiltCaps {
  validateProfile: boolean;
  resolveTargetFolder: boolean;
  dryRun: boolean;
  exportOnly: boolean;
  apiTransfer: boolean;
  registerCustom: boolean;
}

test("qc-provider-registry: descriptors carry no provider-specific test-case fields", () => {
  const registry = createQcProviderRegistry();
  for (const descriptor of listQcProviderDescriptors(registry)) {
    const keys = new Set(Object.keys(descriptor));
    // Whitelist — descriptor contract is closed. Anything else implies a
    // provider-specific leak.
    const allowed = new Set([
      "provider",
      "label",
      "version",
      "builtin",
      "capabilities",
      "mappingProfileSeedId",
    ]);
    for (const k of keys) {
      assert.ok(
        allowed.has(k),
        `unexpected key on descriptor ${descriptor.provider}: ${k}`,
      );
    }
    // Capabilities is a closed product type — only the six known flags.
    const capKeys = new Set(Object.keys(descriptor.capabilities));
    const allowedCaps = new Set([
      "validateProfile",
      "resolveTargetFolder",
      "dryRun",
      "exportOnly",
      "apiTransfer",
      "registerCustom",
    ]);
    for (const k of capKeys) {
      assert.ok(
        allowedCaps.has(k),
        `unexpected capability on descriptor ${descriptor.provider}: ${k}`,
      );
    }
  }
});

test("qc-provider-registry: getQcProviderEntry returns descriptor + adapter", () => {
  const registry = createQcProviderRegistry();
  const alm = getQcProviderEntry(registry, "opentext_alm");
  assert.ok(alm);
  assert.equal(alm?.descriptor.provider, "opentext_alm");
  assert.ok(alm?.adapter);
  const custom = getQcProviderEntry(registry, "custom");
  assert.ok(custom);
  assert.equal(custom?.adapter, null);
});

test("qc-provider-registry: snapshot cannot mutate registry state", () => {
  const registry = createQcProviderRegistry();
  const runtimeSnapshot = registry.snapshot as ReadonlyMap<
    QcAdapterProvider,
    unknown
  > & {
    set?: unknown;
    delete?: unknown;
    clear?: unknown;
  };

  assert.equal(runtimeSnapshot.set, undefined);
  assert.equal(runtimeSnapshot.delete, undefined);
  assert.equal(runtimeSnapshot.clear, undefined);
  assert.throws(() =>
    Map.prototype.set.call(runtimeSnapshot, "custom", {
      descriptor: buildCustomDescriptor(),
      adapter: buildCustomAdapter(),
    }),
  );

  const custom = registry.snapshot.get("custom");
  assert.ok(custom);
  custom.descriptor.capabilities.registerCustom = false;
  custom.adapter = buildCustomAdapter();

  assert.equal(resolveQcProviderAdapter(registry, "custom"), null);
  assert.equal(
    getQcProviderDescriptor(registry, "custom")?.capabilities.registerCustom,
    true,
  );
});

test("qc-provider-registry: opentext_alm carries the mappingProfileSeedId", () => {
  const registry = createQcProviderRegistry();
  const alm = getQcProviderDescriptor(registry, "opentext_alm");
  assert.equal(alm?.mappingProfileSeedId, "opentext-alm-default");
});

test("qc-provider-registry: extraDescriptors only redefines the custom slot", () => {
  const registry = createQcProviderRegistry({
    extraDescriptors: [
      {
        provider: "custom",
        label: "Operator-Defined",
        version: "2.0.0",
        builtin: true,
        capabilities: {
          validateProfile: false,
          resolveTargetFolder: false,
          dryRun: false,
          exportOnly: false,
          apiTransfer: false,
          registerCustom: true,
        },
      },
      // Should be ignored because it targets a non-custom slot.
      {
        provider: "xray",
        label: "Shadow",
        version: "9.9.9",
        builtin: true,
        capabilities: {
          validateProfile: false,
          resolveTargetFolder: false,
          dryRun: false,
          exportOnly: false,
          apiTransfer: false,
          registerCustom: false,
        },
      },
    ],
  });
  const custom = getQcProviderDescriptor(registry, "custom");
  assert.equal(custom?.label, "Operator-Defined");
  assert.equal(custom?.version, "2.0.0");
  assert.equal(custom?.builtin, false);
  const xray = getQcProviderDescriptor(registry, "xray");
  // Shadow attempt was ignored — xray label remains "Xray (Jira)".
  assert.equal(xray?.label, "Xray (Jira)");
});
