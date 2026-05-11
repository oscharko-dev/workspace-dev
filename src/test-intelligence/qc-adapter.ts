/**
 * Provider-neutral `QcAdapter` interface (Issue #1368).
 *
 * Adapters wrap a third-party QC/ALM tool behind a narrow surface so the
 * test-intelligence pipeline can validate mappings without coupling to a
 * specific vendor. The interface is intentionally minimal:
 *
 *   - `provider` — discriminator used to route a profile to the matching
 *     adapter (`opentext_alm`, `xray`, etc.).
 *   - `validateProfile` — pure structural validator.
 *   - `dryRun` — produces a `DryRunReportArtifact` from approved+mapped
 *     test cases without performing any write to the QC tool.
 *
 * Wave 2 ships the `opentext_alm` dry-run adapter. Wave 3 implements
 * controlled `api_transfer` in `qc-alm-api-transfer.ts` instead of this
 * dry-run facade, so direct dry-run calls with `api_transfer` still throw
 * a typed error.
 */

import {
  type DryRunReportArtifact,
  type QcAdapterMode,
  type QcAdapterProvider,
  type QcMappingPreviewArtifact,
  type QcMappingProfile,
  type QcMappingProfileValidationResult,
  type VisualSidecarValidationReport,
} from "../contracts/index.js";

/**
 * Stable clock abstraction used by adapters so dry-run report ids and
 * timestamps stay deterministic in tests. The `now` value is the only
 * source of wall-clock state on the adapter hot path.
 */
export interface QcAdapterClock {
  now(): string;
}

/**
 * Stable id source used by adapters so report ids stay deterministic in
 * tests. Implementations may hash a stable seed; production callers may
 * use `randomUUID()` if they prefer.
 */
export interface QcAdapterIdSource {
  newReportId(seed: string): string;
}

/**
 * Optional resolver injected by the adapter caller to validate target
 * folders without contacting the real QC tool. Must be read-only — the
 * resolver returns one of the four allowed states and never performs a
 * mutating call. The `assertReadOnly` flag is asserted by the regression
 * test so any later implementation that flips it must update the test.
 */
export interface QcFolderResolver {
  readonly assertReadOnly: true;
  resolve(input: {
    profile: QcMappingProfile;
    targetFolderPath: string;
  }): Promise<QcFolderResolverResult> | QcFolderResolverResult;
}

export interface QcFolderResolverResult {
  state: "resolved" | "missing" | "simulated" | "invalid_path";
  evidence: string;
}

/**
 * Input passed to `dryRun`. Approved + mapped cases come from the export
 * pipeline (`QcMappingPreviewArtifact`); the visual sidecar validation
 * report is optional and only used to flag low-confidence visual-only
 * mapping decisions.
 */
export interface QcAdapterDryRunInput {
  jobId: string;
  /** Adapter mode discriminator. Must equal `"dry_run"` on this code path. */
  mode: QcAdapterMode;
  profile: QcMappingProfile;
  preview: QcMappingPreviewArtifact;
  visual?: VisualSidecarValidationReport;
  clock: QcAdapterClock;
  idSource: QcAdapterIdSource;
  /** Optional folder resolver. Defaults to a deterministic `simulated` resolver. */
  folderResolver?: QcFolderResolver;
  /**
   * Lower bound (inclusive) on per-screen sidecar mean confidence below
   * which a visual-only mapping triggers a `visualEvidenceFlags` entry.
   * Defaults to `0.6` (matches the `eu-banking-default` policy gate).
   */
  visualConfidenceThreshold?: number;
}

/** Discriminator for unrecognised mode requests. */
export class QcAdapterModeNotImplementedError extends Error {
  readonly code = "mode_not_implemented" as const;
  readonly mode: QcAdapterMode;
  constructor(mode: QcAdapterMode) {
    super(
      `QcAdapter: mode "${mode}" is not implemented in this build (dry-run only)`,
    );
    this.mode = mode;
    this.name = "QcAdapterModeNotImplementedError";
  }
}

/**
 * Provider-neutral adapter facade. The `dryRun` method must NEVER attempt
 * a write — adapters that require I/O for folder resolution must accept
 * an injected resolver and refuse to do anything else.
 */
export interface QcAdapter {
  readonly provider: QcAdapterProvider;
  readonly version: string;
  validateProfile(profile: QcMappingProfile): QcMappingProfileValidationResult;
  dryRun(input: QcAdapterDryRunInput): Promise<DryRunReportArtifact>;
}

/**
 * Type guard reused by the export pipeline + tests to ensure the mode
 * discriminator hits the dry-run branch only.
 */
export const isDryRunMode = (mode: QcAdapterMode): mode is "dry_run" =>
  mode === "dry_run";
