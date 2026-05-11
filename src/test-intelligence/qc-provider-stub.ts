/**
 * Dry-run-only stub `QcAdapter` for non-ALM providers (Issue #1374).
 *
 * Wave 3 stabilizes the provider-neutral adapter interface but only ships
 * a real `opentext_alm` implementation. The other six builtin providers
 * (`opentext_octane`, `opentext_valueedge`, `xray`, `testrail`,
 * `azure_devops_test_plans`, `qtest`) are advertised as
 * dry-run-only-with-stub so the registry can return a `QcAdapter` for
 * each provider id without running any real I/O.
 *
 * Hard invariants:
 *   - Pure: no fetch, no fs, no clocks, no globals on the hot path.
 *   - Fail-closed: every `dryRun` returns a refused report whose
 *     `refusalCodes` always includes `"provider_not_implemented"`.
 *   - Mode-locked: any non-`dry_run` mode throws
 *     `QcAdapterModeNotImplementedError` so the orchestrator can never
 *     accidentally enable writes through the stub.
 *   - Profile-aware: the stub still runs `validateQcMappingProfile` so
 *     provider mismatches surface as additional refusal codes alongside
 *     `provider_not_implemented`. This keeps the report shape identical
 *     to the ALM adapter so downstream consumers (UI, audit) do not need
 *     special-case branches.
 *
 * The stub is intentionally registered through
 * `qc-provider-registry.ts` rather than re-exported as a singleton — each
 * call to `createDryRunStubAdapter` produces a fresh, independent value
 * so test isolation is guaranteed.
 */

import {
  DRY_RUN_REPORT_SCHEMA_VERSION,
  TEST_INTELLIGENCE_CONTRACT_VERSION,
  type DryRunFolderResolution,
  type DryRunMappingCompletenessSummary,
  type DryRunRefusalCode,
  type DryRunReportArtifact,
  type QcAdapterMode,
  type QcAdapterProvider,
  type QcMappingProfile,
  type QcMappingProfileValidationResult,
} from "../contracts/index.js";
import { sha256Hex } from "./content-hash.js";
import {
  QcAdapterModeNotImplementedError,
  type QcAdapter,
  type QcAdapterDryRunInput,
  type QcAdapterIdSource,
} from "./qc-adapter.js";
import { validateQcMappingProfile } from "./qc-alm-mapping-profile.js";

/** Version stamp for every stub adapter instance. */
export const DRY_RUN_STUB_ADAPTER_VERSION = "1.0.0" as const;

const REPORT_ID_LENGTH = 16;

const STUB_FOLDER_RESOLUTION_EVIDENCE = "simulated:provider_not_implemented";

const emptyCompleteness = (): DryRunMappingCompletenessSummary => ({
  totalCases: 0,
  completeCases: 0,
  incompleteCases: 0,
  missingFieldsAcrossCases: [],
  perCase: [],
});

const buildStubFolderResolution = (
  profile: QcMappingProfile,
): DryRunFolderResolution => ({
  state: "simulated",
  path: profile.targetFolderPath,
  evidence: STUB_FOLDER_RESOLUTION_EVIDENCE,
});

const buildStubReportId = (
  idSource: QcAdapterIdSource,
  jobId: string,
  provider: QcAdapterProvider,
  version: string,
  profile: QcMappingProfile,
  generatedAt: string,
): string =>
  idSource.newReportId(
    `${jobId}|${provider}|${version}|${profile.id}|${profile.version}|${generatedAt}`,
  );

/** Input shape for `createDryRunStubAdapter`. */
export interface CreateDryRunStubAdapterInput {
  /** Provider discriminator — must NOT be `opentext_alm`. */
  provider: QcAdapterProvider;
  /** Optional version override. Defaults to `DRY_RUN_STUB_ADAPTER_VERSION`. */
  version?: string;
}

/**
 * Build a fail-closed dry-run-only `QcAdapter` for a non-ALM provider.
 *
 * Throws synchronously if `provider === "opentext_alm"` — the ALM provider
 * has a real adapter (`createOpenTextAlmDryRunAdapter`) and routing it
 * through the stub would silently downgrade callers.
 */
export const createDryRunStubAdapter = (
  input: CreateDryRunStubAdapterInput,
): QcAdapter => {
  if (input.provider === "opentext_alm") {
    throw new Error(
      'createDryRunStubAdapter: provider "opentext_alm" has a real adapter; refuse to shadow it with a stub',
    );
  }
  const provider: QcAdapterProvider = input.provider;
  const version = input.version ?? DRY_RUN_STUB_ADAPTER_VERSION;

  return {
    provider,
    version,
    validateProfile(
      profile: QcMappingProfile,
    ): QcMappingProfileValidationResult {
      return validateQcMappingProfile({
        profile,
        expectedProvider: provider,
      });
    },
    async dryRun(input2: QcAdapterDryRunInput): Promise<DryRunReportArtifact> {
      const mode: QcAdapterMode = input2.mode;
      if (mode !== "dry_run") {
        throw new QcAdapterModeNotImplementedError(mode);
      }

      const generatedAt = input2.clock.now();
      const reportId = buildStubReportId(
        input2.idSource,
        input2.jobId,
        provider,
        version,
        input2.profile,
        generatedAt,
      );

      const validation = validateQcMappingProfile({
        profile: input2.profile,
        expectedProvider: provider,
      });

      const refusalCodes = new Set<DryRunRefusalCode>();
      refusalCodes.add("provider_not_implemented");
      if (input2.profile.provider !== provider) {
        refusalCodes.add("provider_mismatch");
      }
      if (!validation.ok) {
        refusalCodes.add("mapping_profile_invalid");
      }

      const folderResolution = buildStubFolderResolution(input2.profile);

      return {
        schemaVersion: DRY_RUN_REPORT_SCHEMA_VERSION,
        contractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
        reportId,
        jobId: input2.jobId,
        generatedAt,
        mode: "dry_run",
        adapter: { provider, version },
        profile: { id: input2.profile.id, version: input2.profile.version },
        refused: true,
        refusalCodes: Array.from(refusalCodes).sort(),
        profileValidation: validation,
        completeness: emptyCompleteness(),
        folderResolution,
        plannedPayloads: [],
        visualEvidenceFlags: [],
        rawScreenshotsIncluded: false,
        credentialsIncluded: false,
      };
    },
  };
};

/**
 * Default deterministic id source used by stub callers who don't supply
 * one — first 16 hex chars of `sha256(seed)`. Mirrors
 * `DEFAULT_DRY_RUN_ID_SOURCE` in `qc-alm-dry-run.ts` so test fixtures can
 * compare ids across adapters byte-for-byte.
 */
export const DEFAULT_DRY_RUN_STUB_ID_SOURCE: QcAdapterIdSource = {
  newReportId: (seed: string): string =>
    sha256Hex(seed).slice(0, REPORT_ID_LENGTH),
};
