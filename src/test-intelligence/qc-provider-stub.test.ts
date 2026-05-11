/**
 * Dry-run stub adapter tests (Issue #1374).
 *
 * Acceptance:
 *   - For every non-ALM provider, the stub refuses with
 *     `provider_not_implemented` and emits an empty plan.
 *   - Folder resolution is `simulated` with the canonical evidence string.
 *   - `validateProfile` surfaces `provider_mismatch` when given an
 *     ALM-shaped profile while the stub targets a different provider.
 *   - Calling `dryRun` with `mode: "api_transfer"` (or any non-`dry_run`
 *     mode) throws `QcAdapterModeNotImplementedError`.
 *   - Refusing to shadow `opentext_alm` is enforced at construction time.
 *   - Determinism: same input → same `reportId`.
 */

import assert from "node:assert/strict";
import test from "node:test";
import {
  ALLOWED_DRY_RUN_REFUSAL_CODES,
  ALLOWED_QC_ADAPTER_PROVIDERS,
  TEST_INTELLIGENCE_CONTRACT_VERSION,
  type QcAdapterProvider,
  type QcMappingPreviewArtifact,
} from "../contracts/index.js";
import { QcAdapterModeNotImplementedError } from "./qc-adapter.js";
import {
  createFixedClock,
  DEFAULT_DRY_RUN_ID_SOURCE,
} from "./qc-alm-dry-run.js";
import { cloneOpenTextAlmDefaultMappingProfile } from "./qc-alm-mapping-profile.js";
import {
  createDryRunStubAdapter,
  DEFAULT_DRY_RUN_STUB_ID_SOURCE,
  DRY_RUN_STUB_ADAPTER_VERSION,
} from "./qc-provider-stub.js";

const GENERATED_AT = "2026-04-26T10:00:00.000Z";
const JOB_ID = "job-1374-stub";

const emptyPreview = (jobId: string): QcMappingPreviewArtifact => ({
  schemaVersion: "1.0.0",
  contractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
  jobId,
  generatedAt: GENERATED_AT,
  profileId: "opentext-alm-default",
  profileVersion: "1.0.0",
  entries: [],
});

const NON_ALM_PROVIDERS: readonly QcAdapterProvider[] =
  ALLOWED_QC_ADAPTER_PROVIDERS.filter(
    (p): p is Exclude<QcAdapterProvider, "opentext_alm"> =>
      p !== "opentext_alm",
  );

test("qc-provider-stub: every non-ALM provider refuses with provider_not_implemented", async () => {
  for (const provider of NON_ALM_PROVIDERS) {
    const stub = createDryRunStubAdapter({ provider });
    const profile = cloneOpenTextAlmDefaultMappingProfile();
    profile.provider = provider;
    const result = await stub.dryRun({
      jobId: JOB_ID,
      mode: "dry_run",
      profile,
      preview: emptyPreview(JOB_ID),
      clock: createFixedClock(GENERATED_AT),
      idSource: DEFAULT_DRY_RUN_STUB_ID_SOURCE,
    });
    assert.equal(result.refused, true, `provider ${provider} must refuse`);
    assert.ok(
      result.refusalCodes.includes("provider_not_implemented"),
      `provider ${provider} missing provider_not_implemented refusal`,
    );
    assert.deepEqual(result.plannedPayloads, []);
    assert.deepEqual(result.visualEvidenceFlags, []);
    assert.equal(result.completeness.totalCases, 0);
    assert.equal(result.completeness.completeCases, 0);
    assert.equal(result.completeness.incompleteCases, 0);
    assert.equal(result.adapter.provider, provider);
    assert.equal(result.adapter.version, DRY_RUN_STUB_ADAPTER_VERSION);
    // Hard invariants stamped at the type level.
    assert.equal(result.rawScreenshotsIncluded, false);
    assert.equal(result.credentialsIncluded, false);
  }
});

test("qc-provider-stub: folder resolution is simulated with canonical evidence", async () => {
  const stub = createDryRunStubAdapter({ provider: "xray" });
  const profile = cloneOpenTextAlmDefaultMappingProfile();
  profile.provider = "xray";
  const result = await stub.dryRun({
    jobId: JOB_ID,
    mode: "dry_run",
    profile,
    preview: emptyPreview(JOB_ID),
    clock: createFixedClock(GENERATED_AT),
    idSource: DEFAULT_DRY_RUN_STUB_ID_SOURCE,
  });
  assert.equal(result.folderResolution.state, "simulated");
  assert.equal(
    result.folderResolution.evidence,
    "simulated:provider_not_implemented",
  );
  assert.equal(result.folderResolution.path, profile.targetFolderPath);
});

test("qc-provider-stub: provider_mismatch surfaces alongside provider_not_implemented", async () => {
  const stub = createDryRunStubAdapter({ provider: "opentext_octane" });
  const profile = cloneOpenTextAlmDefaultMappingProfile(); // declares opentext_alm
  const result = await stub.dryRun({
    jobId: JOB_ID,
    mode: "dry_run",
    profile,
    preview: emptyPreview(JOB_ID),
    clock: createFixedClock(GENERATED_AT),
    idSource: DEFAULT_DRY_RUN_STUB_ID_SOURCE,
  });
  assert.equal(result.refused, true);
  assert.ok(result.refusalCodes.includes("provider_mismatch"));
  assert.ok(result.refusalCodes.includes("provider_not_implemented"));
});

test("qc-provider-stub: validateProfile detects provider mismatch", () => {
  const stub = createDryRunStubAdapter({ provider: "xray" });
  const profile = cloneOpenTextAlmDefaultMappingProfile(); // opentext_alm
  const validation = stub.validateProfile(profile);
  assert.equal(validation.ok, false);
  assert.ok(
    validation.issues.some((i) => i.code === "provider_mismatch"),
    "expected provider_mismatch issue",
  );
});

test("qc-provider-stub: api_transfer mode throws QcAdapterModeNotImplementedError", async () => {
  const stub = createDryRunStubAdapter({ provider: "qtest" });
  const profile = cloneOpenTextAlmDefaultMappingProfile();
  profile.provider = "qtest";
  await assert.rejects(
    () =>
      stub.dryRun({
        jobId: JOB_ID,
        mode: "api_transfer",
        profile,
        preview: emptyPreview(JOB_ID),
        clock: createFixedClock(GENERATED_AT),
        idSource: DEFAULT_DRY_RUN_STUB_ID_SOURCE,
      }),
    QcAdapterModeNotImplementedError,
  );
});

test("qc-provider-stub: export_only mode throws QcAdapterModeNotImplementedError", async () => {
  const stub = createDryRunStubAdapter({ provider: "testrail" });
  const profile = cloneOpenTextAlmDefaultMappingProfile();
  profile.provider = "testrail";
  await assert.rejects(
    () =>
      stub.dryRun({
        jobId: JOB_ID,
        mode: "export_only",
        profile,
        preview: emptyPreview(JOB_ID),
        clock: createFixedClock(GENERATED_AT),
        idSource: DEFAULT_DRY_RUN_STUB_ID_SOURCE,
      }),
    QcAdapterModeNotImplementedError,
  );
});

test("qc-provider-stub: refuses to shadow opentext_alm", () => {
  assert.throws(
    () => createDryRunStubAdapter({ provider: "opentext_alm" }),
    /opentext_alm/,
  );
});

test("qc-provider-stub: same input produces deterministic reportId", async () => {
  const provider: QcAdapterProvider = "azure_devops_test_plans";
  const profile = cloneOpenTextAlmDefaultMappingProfile();
  profile.provider = provider;
  const buildResult = async () => {
    const stub = createDryRunStubAdapter({ provider });
    return stub.dryRun({
      jobId: JOB_ID,
      mode: "dry_run",
      profile,
      preview: emptyPreview(JOB_ID),
      clock: createFixedClock(GENERATED_AT),
      idSource: DEFAULT_DRY_RUN_STUB_ID_SOURCE,
    });
  };
  const a = await buildResult();
  const b = await buildResult();
  assert.equal(a.reportId, b.reportId);
  assert.equal(a.reportId.length, 16);
  assert.match(a.reportId, /^[0-9a-f]{16}$/);
  // Use injected clock + id source to make stability obvious in tests.
  const c = await (async () => {
    const stub = createDryRunStubAdapter({ provider });
    return stub.dryRun({
      jobId: JOB_ID,
      mode: "dry_run",
      profile,
      preview: emptyPreview(JOB_ID),
      clock: createFixedClock(GENERATED_AT),
      idSource: DEFAULT_DRY_RUN_ID_SOURCE,
    });
  })();
  assert.equal(c.reportId, a.reportId);
});

test("qc-provider-stub: custom idSource controls reportId shape", async () => {
  const provider: QcAdapterProvider = "xray";
  const profile = cloneOpenTextAlmDefaultMappingProfile();
  profile.provider = provider;
  const stub = createDryRunStubAdapter({ provider });
  const result = await stub.dryRun({
    jobId: JOB_ID,
    mode: "dry_run",
    profile,
    preview: emptyPreview(JOB_ID),
    clock: createFixedClock(GENERATED_AT),
    idSource: {
      newReportId: () => "operator-controlled-report-id",
    },
  });
  assert.equal(result.reportId, "operator-controlled-report-id");
});

test("qc-provider-stub: provider_not_implemented exists on the contract refusal enum", () => {
  assert.ok(
    (ALLOWED_DRY_RUN_REFUSAL_CODES as readonly string[]).includes(
      "provider_not_implemented",
    ),
    "provider_not_implemented refusal code missing from contract",
  );
  // Append-at-end invariant — keeps prior ordinal positions byte-stable.
  const last =
    ALLOWED_DRY_RUN_REFUSAL_CODES[ALLOWED_DRY_RUN_REFUSAL_CODES.length - 1];
  assert.equal(last, "provider_not_implemented");
});
