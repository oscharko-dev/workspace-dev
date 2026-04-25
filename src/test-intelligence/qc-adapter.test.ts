/**
 * QcAdapter interface contract tests (Issue #1368).
 *
 * Pins the narrow shape of the provider-neutral adapter facade so future
 * adapters (Octane/ValueEdge/Xray/TestRail/Azure DevOps Test Plans/qTest)
 * can plug in without contract churn:
 *
 *   - typed `provider` discriminator drawn from ALLOWED_QC_ADAPTER_PROVIDERS
 *   - exhaustive mode switch — `dry_run` is the only supported mode in
 *     Wave 2; `api_transfer` MUST throw `mode_not_implemented`.
 *   - `validateProfile` is a pure structural validator.
 *
 * Also exercises `isDryRunMode` as the typed mode-discrimination guard
 * the export pipeline uses to gate its dry-run branch.
 */

import assert from "node:assert/strict";
import test from "node:test";
import {
  ALLOWED_QC_ADAPTER_MODES,
  ALLOWED_QC_ADAPTER_PROVIDERS,
  QC_MAPPING_PREVIEW_SCHEMA_VERSION,
  TEST_INTELLIGENCE_CONTRACT_VERSION,
  type QcAdapterMode,
  type QcAdapterProvider,
  type QcMappingPreviewArtifact,
  type QcMappingProfile,
} from "../contracts/index.js";
import {
  isDryRunMode,
  QcAdapterModeNotImplementedError,
} from "./qc-adapter.js";
import {
  createFixedClock,
  createOpenTextAlmDryRunAdapter,
  DEFAULT_DRY_RUN_ID_SOURCE,
} from "./qc-alm-dry-run.js";
import { cloneOpenTextAlmDefaultMappingProfile } from "./qc-alm-mapping-profile.js";

const GENERATED_AT = "2026-04-25T10:00:00.000Z";

const emptyPreview = (jobId: string): QcMappingPreviewArtifact => ({
  schemaVersion: QC_MAPPING_PREVIEW_SCHEMA_VERSION,
  contractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
  jobId,
  generatedAt: GENERATED_AT,
  profileId: "opentext-alm-default",
  profileVersion: "1.0.0",
  entries: [],
});

test("qc-adapter: ALLOWED_QC_ADAPTER_MODES surfaces the three modes", () => {
  assert.deepEqual([...ALLOWED_QC_ADAPTER_MODES].sort(), [
    "api_transfer",
    "dry_run",
    "export_only",
  ]);
});

test("qc-adapter: provider list pins forward-compatible adapters", () => {
  const providers = new Set<QcAdapterProvider>(ALLOWED_QC_ADAPTER_PROVIDERS);
  for (const expected of [
    "opentext_alm",
    "opentext_octane",
    "opentext_valueedge",
    "xray",
    "testrail",
    "azure_devops_test_plans",
    "qtest",
    "custom",
  ] as const) {
    assert.ok(providers.has(expected), `missing provider ${expected}`);
  }
});

test("qc-adapter: openTextAlmDryRunAdapter declares correct discriminator", () => {
  const adapter = createOpenTextAlmDryRunAdapter();
  assert.equal(adapter.provider, "opentext_alm");
  assert.equal(adapter.version, "1.0.0");
});

test("qc-adapter: validateProfile delegates to mapping-profile validator", () => {
  const adapter = createOpenTextAlmDryRunAdapter();
  const valid = adapter.validateProfile(
    cloneOpenTextAlmDefaultMappingProfile(),
  );
  assert.equal(valid.ok, true);
  const invalid = adapter.validateProfile({
    ...cloneOpenTextAlmDefaultMappingProfile(),
    targetFolderPath: "not-a-path",
  } as QcMappingProfile);
  assert.equal(invalid.ok, false);
});

test("qc-adapter: api_transfer mode throws QcAdapterModeNotImplementedError", async () => {
  const adapter = createOpenTextAlmDryRunAdapter();
  await assert.rejects(
    () =>
      adapter.dryRun({
        jobId: "job-x",
        mode: "api_transfer",
        profile: cloneOpenTextAlmDefaultMappingProfile(),
        preview: emptyPreview("job-x"),
        clock: createFixedClock(GENERATED_AT),
        idSource: DEFAULT_DRY_RUN_ID_SOURCE,
      }),
    (err: unknown) => {
      assert.ok(err instanceof QcAdapterModeNotImplementedError);
      assert.equal(err.code, "mode_not_implemented");
      assert.equal(err.mode, "api_transfer");
      return true;
    },
  );
});

test("qc-adapter: export_only mode also throws (dry-run adapter is dry-run only)", async () => {
  const adapter = createOpenTextAlmDryRunAdapter();
  await assert.rejects(
    () =>
      adapter.dryRun({
        jobId: "job-x",
        mode: "export_only",
        profile: cloneOpenTextAlmDefaultMappingProfile(),
        preview: emptyPreview("job-x"),
        clock: createFixedClock(GENERATED_AT),
        idSource: DEFAULT_DRY_RUN_ID_SOURCE,
      }),
    QcAdapterModeNotImplementedError,
  );
});

test("qc-adapter: isDryRunMode narrows the mode union", () => {
  const m: QcAdapterMode = "dry_run";
  assert.equal(isDryRunMode(m), true);
  assert.equal(isDryRunMode("api_transfer" as QcAdapterMode), false);
  assert.equal(isDryRunMode("export_only" as QcAdapterMode), false);
});
