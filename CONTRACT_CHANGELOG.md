# Contract Changelog - workspace-dev

All changes to the public contract surface of `workspace-dev` are documented here.

## Versioning Rules

| Change Type                 | Version Bump  | Example                                  |
| --------------------------- | ------------- | ---------------------------------------- |
| New optional field          | Minor (x.Y.0) | Add `projectName` to `WorkspaceJobInput` |
| New endpoint                | Minor (x.Y.0) | Add `GET /workspace/version`             |
| New exported type           | Minor (x.Y.0) | Export `WorkspaceVersionInfo`            |
| Remove field or type        | Major (X.0.0) | Remove `WorkspaceJobResult.error`        |
| Rename field or type        | Major (X.0.0) | Rename `figmaFileKey` to `fileKey`       |
| Change field type           | Major (X.0.0) | Change `port` from `number` to `string`  |
| Change response status code | Major (X.0.0) | Change `501` to `202` on submit          |
| Change error code string    | Major (X.0.0) | Rename `MODE_LOCK_VIOLATION`             |

### Package alignment policy

- `CONTRACT_VERSION` and the npm package version are intentionally independent version tracks.
- A contract bump requires a `CONTRACT_CHANGELOG.md` entry before merge, but it does not require the checked-in `package.json` version to change immediately.
- Package version bumps are produced by Changesets and the publish workflow when a release is cut.
- Consumers pin the package version from npm, not `CONTRACT_VERSION`.
- See `VERSIONING.md` for the full package-versus-contract versioning policy.

## Enforcement

- `contract-version.test.ts` guards runtime export surface.
- `pnpm typecheck` guards type compatibility.
- Every contract change must add an entry in this file before merge.

---

## [1.30.0] - 2026-05-10

Test-intelligence sub-contract bump that accompanies the Issue #2180
causal-validation framework (counterfactual test cases via
do-calculus). See the package-version entry below for the full
additive surface inventory; the test-intelligence sub-contract bump
mirrors the new schema and artifact constants for the
`causal-validation-report.json` artifact, the
`causalCoverage` summary block on `policy-report.json`, and the
FinOps token-budget cap exposed for the framework.

---

## [4.65.0] - 2026-05-10

### Added (Issue #2180 — causal-validation framework)

- New test-intelligence runtime constants exported from
  `src/contracts/index.ts`:
  `CAUSAL_VALIDATION_REPORT_SCHEMA_VERSION` (`"1.0.0"`),
  `CAUSAL_VALIDATION_REPORT_ARTIFACT_FILENAME`
  (`"causal-validation-report.json"`), and
  `CAUSAL_VALIDATION_TOKEN_BUDGET_RATIO_CAP` (`0.3`, the FinOps
  ceiling on the framework's relative additional token cost per run).
- New exported type `CausalCoverageSummary` carried as the optional
  additive `causalCoverage` field on `TestCasePolicyReport`. The block
  surfaces `hypothesesEvaluated`, `pairsGenerated`, `pairsViolated`,
  and the `causalCoverageRatio` (= `(pairsGenerated -
  pairsViolated) / pairsGenerated`, rounded to six digits, `0` when
  no pairs were generated). Omitted for runs that did not enable the
  framework, so byte-shape stays stable for legacy runs.
- (Issue #2180 follow-up — PR #2205) The persisted
  `causal-validation-report.json` now carries a `pairs[]` array of
  `CausalValidationPairAudit` rows so reviewers can trace each pair's
  variant ids, oracle-derived causal delta, and projected
  effect-invariant text without re-running the framework. The new
  exported type `CausalValidationPairAudit` ships under the same
  test-intelligence sub-contract version (`1.30.0`); no version bump
  is required because the report was introduced in the same minor
  cycle and no released tarball carried the prior shape.
- New module `src/test-intelligence/causal-hypothesis-registry.ts`
  exposing the branded `SemanticFieldId` type, the
  `semanticFieldId(screenId, elementId)` constructor and
  `parseSemanticFieldId` reader, the `CausalHypothesis` /
  `CausalRelationship` types, the
  `buildCausalHypothesisRegistry({ invariants, model,
  operatorHypotheses })` API that derives hypotheses from registered
  domain invariants (Issue #2040 + Issue #2108) and merges
  operator-declared hypotheses, and the `loadOperatorHypotheses`
  fixture loader.
- New module `src/test-intelligence/causal-validation-framework.ts`
  exposing the `CounterfactualPair` interface, the
  `deriveCounterfactualPairs({ cases, invariants, model,
  operatorHypotheses?, now, seed })` deterministic pair generator that
  uses the test-data oracle (Issue #2071) for every value variation
  between pair members, the `evaluateCounterfactualPairs` aggregator
  that computes the persisted `CausalValidationReport`, and the
  `CausalValidationFrameworkError` class with stable error codes
  (`E_INVALID_HYPOTHESIS`, `E_INVALID_FIELD_ID`, `E_NO_BVA_VARIATION`,
  `E_INVALID_SEED`).
- Pair generation is **deterministic** given fixed seeds — replaying
  the same `(cases, invariants, operatorHypotheses, model, now,
  seed)` tuple produces byte-identical output.
- Each pair counts as **one logical coverage unit** for the
  `causalCoverage` KPI but **two physical cases** when added to the
  suite. The pair envelope carries `causalDelta.fieldId`,
  `valueA`, `valueB`, plus the `expectedEffectInvariant` text the
  hypothesis projects onto the effect field.
- New documentation page
  `docs/test-intelligence/causal-validation.md` describing the
  do-calculus primer, the hypothesis derivation rules, and worked
  banking + insurance examples.
- `TEST_INTELLIGENCE_CONTRACT_VERSION` bumped `1.29.0` → `1.30.0`;
  `CONTRACT_VERSION` bumped `4.64.0` → `4.65.0`. All changes are
  additive — no existing field, type, or command was removed or
  renamed.
- `migrationHash:` registration is not required for this release. The
  signed migration registry carries forward unchanged because no
  migration id, hash, or rollback semantics changed.

---

## [1.29.0] - 2026-05-10

Test-intelligence sub-contract bump that accompanies the Issue #2179
human-oversight review-queue + decision-capture surface. See the
package-version entry below for the full additive surface inventory;
the test-intelligence sub-contract bump only mirrors the new schema
and artifact constants for the queue, verdict, and per-run audit log.

---

## [4.64.0] - 2026-05-10

### Added (Issue #2179 — human-oversight review-queue + decision-capture surface)

- New test-intelligence runtime constants exported from
  `src/contracts/index.ts`:
  `HUMAN_REVIEW_QUEUE_ITEM_SCHEMA_VERSION` (`"1.0.0"`),
  `HUMAN_REVIEW_VERDICT_SCHEMA_VERSION` (`"1.0.0"`),
  `HUMAN_REVIEW_LOG_SCHEMA_VERSION` (`"1.0.0"`),
  `HUMAN_REVIEW_LOG_ARTIFACT_FILENAME` (`"human-review-log.json"`),
  `HUMAN_REVIEW_VERDICT_RATIONALE_MAX_CHARS` (`4096`),
  `HUMAN_REVIEW_QUEUE_VERDICT_LABELS`
  (`["approved","rejected","revised"]`), and
  `HUMAN_REVIEW_POLICY_WARNING_RULES`
  (`["policy:human-review-sla-breach"]`).
- New exported types `HumanReviewQueueItem`, `HumanReviewVerdict`,
  `HumanReviewFilter`, `HumanReviewLog`, `HumanReviewSlaBreachEntry`,
  `HumanReviewQueueVerdictLabel`, `HumanReviewPolicyWarningRule`, and
  `JudgeDisagreementSnapshot`. These define the canonical queue-item,
  signed-verdict, per-tenant filter, per-run audit-log, SLA-breach
  entry, and inline disagreement-snapshot shapes for the human-
  oversight surface.
- New module `src/test-intelligence/human-review-queue.ts` exposing:
  `enqueueHumanReview`, `fetchPendingReviews`,
  `recordHumanReviewVerdict`, `getHumanReviewQueueItem`,
  `loadHumanReviewVerdictsForRun`, `findHumanReviewSlaBreaches`,
  `buildHumanReviewLog`, `buildSlaBreachPolicyWarning`,
  `buildVerdictSigningPayload`, `computeHumanReviewItemId`,
  `hashReviewerPrincipalId`, `createFilesystemQueueStore`, and the
  `HumanReviewQueueError` class with stable error codes
  (`E_INVALID_SCHEMA`, `E_INVALID_FIELD`, `E_INVALID_SEGMENT`,
  `E_INVALID_TIMESTAMP`, `E_INVALID_RATIONALE`, `E_INVALID_VERDICT`,
  `E_INVALID_KEY`, `E_INVALID_SIGNATURE`, `E_INVALID_SLA`,
  `E_QUEUE_ITEM_ALREADY_EXISTS`, `E_QUEUE_ITEM_NOT_FOUND`,
  `E_KEY_FINGERPRINT_MISMATCH`, `E_SIGNATURE_INVALID`).
- Verdicts are signed with **ed25519** detached signatures over the
  canonical-JSON serialisation of the verdict body (every field
  except `signatureHex`). The queue verifies the signature and the
  SPKI sha256 fingerprint before persisting; tampered verdicts are
  refused with `E_SIGNATURE_INVALID` / `E_KEY_FINGERPRINT_MISMATCH`.
- New operator-facing CLI subcommands on the package entrypoint:
  `workspace-dev test-intelligence review list --tenant <id>
   [--profile <id>] [--sla-due-by <iso-8601>] [--root <dir>]`,
  `workspace-dev test-intelligence review get <item-id> --tenant <id>
   [--root <dir>]`, and
  `workspace-dev test-intelligence review decide <item-id>
   --tenant <id> --verdict <approved|rejected|revised>
   --rationale <md-file> [--revised-tc <json-file>]
   --sign-key <pem> --decided-at <iso-8601>
   [--reviewer-principal <stable-id>] [--root <dir>]`.
- New framework-agnostic HTTP route handlers in
  `src/test-intelligence/human-review-http-routes.ts`:
  `handleListQueue`, `handleGetItem`, `handlePostDecision`. Each
  returns a typed `HumanReviewHttpResponse` (`status`, `headers`,
  `body`) the host server can adapt to its router of choice.
  Endpoints: `GET /api/human-review/queue`,
  `GET /api/human-review/items/:id`,
  `POST /api/human-review/decisions`.
- New audit-dossier source-artifact kind: `human_review_log`. The
  bundle generator picks up `<runDir>/human-review-log.json` when
  present (additive — runs without human review still bundle), and
  the manifest's regulator-coverage table now carries an
  **EU AI Act Art. 14** row that includes `human_review_log` plus a
  new **DSGVO Art. 22** row (`human_review_log`, `provenance`,
  `evidence_seal`).
- New minimal React surface at
  `ui-src/src/features/human-review/human-review-page.tsx` mounted at
  `/workspace/ui/human-review`. The UI lists the queue, inspects one
  item, and accepts pre-signed verdicts pasted by the reviewer. The
  UI never holds private key material.
- Per-run `human-review-log.json` artifact written canonical-JSON,
  byte-stable for byte-identical inputs, and bundled into the W6-1
  audit-dossier (Issue #2175). Items + verdicts + SLA breaches are
  sorted by `itemId` so byte-identical inputs always produce
  byte-identical files.
- SLA tracking: every queue item carries `slaDeadlineAt`. Items past
  their deadline that have **no recorded verdict** are surfaced via
  `findHumanReviewSlaBreaches`; the next run consumes the list to
  emit a `policy:human-review-sla-breach` policy warning.
- Replay determinism: `loadHumanReviewVerdictsForRun` returns
  persisted verdicts for a given run id so the production runner can
  short-circuit re-prompting / re-judging on replay.
- New documentation page
  `docs/test-intelligence/human-oversight.md` describing the legal
  basis (DSGVO Art. 22, EU AI Act Art. 14, DORA Art. 28), the
  operational flow, and the on-disk layout.
- Reference fixtures under `fixtures/test-intelligence/human-review/`.
- `TEST_INTELLIGENCE_CONTRACT_VERSION` bumped `1.28.0` → `1.29.0`.
- `CONTRACT_VERSION` bumped `4.63.0` → `4.64.0`.
- These are additive surface changes; no existing field, type, or
  command was removed or renamed.
- `migrationHash:` registration is not required for this release. The
  signed migration registry carries forward unchanged because no
  migration id, hash, or rollback semantics changed.

---

## [4.63.0] - 2026-05-10

### Added (Issue #2176 — runtime multi-tenant isolation enforcement)

- New `src/test-intelligence/tenant-isolation-guard.ts` module
  providing the runtime guarantee that no persistent-store read
  crosses tenant boundaries. Public exports:
  - `withTenantScope(scope, fn)` — opens an `AsyncLocalStorage`
    context so nested async calls inherit the active `TenantScope`
    without re-passing `tenantId`. Nested calls under a different
    scope throw eagerly.
  - `assertTenantScope(operation, expected, actual)` — catastrophic
    guard that raises `TenantIsolationViolation` on mismatch.
  - `recordPersistentStoreRead(operation, recordedScope)` — guard
    used by stores that carry their scope at construction time
    (`replay-cache-persistent`).
  - `recordTenantIdRead(operation, recordedTenantId)` — `tenantId`-
    only variant for stores keyed on a flat tenant id
    (`coverage-baseline-drift`, `distribution-shift-detector`).
  - `recordActiveTenantRead(operation)` — audit-only hook for
    runDir-implicit stores (`agent-lessons-memdir`,
    `lessons-consolidation-lock`).
  - `getCurrentTenantScope()`, `snapshotTenantIsolationReads()`,
    `buildTenantIsolationAttestation`,
    `serializeTenantIsolationAttestation`.
- New exported error class `TenantIsolationViolation` with a
  machine-readable `code === "TENANT_ISOLATION_VIOLATION"` and
  `operation`, `expected`, `actual` fields.
- New artifact filename and schema-version constants:
  `TENANT_ISOLATION_ATTESTATION_ARTIFACT_FILENAME`
  (`"tenant-isolation-attestation.json"`),
  `TENANT_ISOLATION_ATTESTATION_SCHEMA_VERSION` (`"1.0.0"`),
  `TENANT_ISOLATION_ATTESTATION_CERTIFICATION` (stable certification
  string).
- The production runner opens a `withTenantScope` boundary at the top
  of `runFigmaToQcTestCases` and emits a per-run, byte-stable
  `tenant-isolation-attestation.json` next to `provenance.jsonld`.
- `provenance.jsonld` now carries
  `ti:tenantIsolationAttestationSha256` (SHA-256 of the canonical
  attestation over `{ tenantScope, persistentStoreReads }`) and
  `ti:tenantScope` (the active scope at run time), plus a
  `prov:Entity` artifact node for the attestation file.
- `BuildRunProvenanceGraphInput` adds an optional
  `tenantIsolationAttestation` cross-link
  (`{ artifactFilename, attestationSha256, tenantScope }`).
- `TEST_INTELLIGENCE_CONTRACT_VERSION` unchanged at `1.27.0` — the
  surface is additive: every guard hook is a no-op outside
  `withTenantScope`, so single-tenant fixtures pass without
  modification.

### Added (Issue #2177 — EU region-attestation evidence and residency gating)

- New region-attestation constants exported from `src/contracts/index.ts`:
  `REGION_ATTESTATION_SCHEMA_VERSION` (`"1.0.0"`),
  `SUPPORTED_REGION_ATTESTATION_HOSTING_REGIONS` (closed allow-list of EU,
  sovereign-EU, Switzerland, and Norway hosting regions), and
  `REGION_ATTESTATION_REPORT_ARTIFACT_FILENAME`
  (`"region-attestations.json"`).
- New exported types `RegionAttestation`,
  `RegionAttestationHostingRegion`, `RegionAttestationArtifactEntry`,
  and `RegionAttestationReport`. These define the per-call signed region
  evidence envelope plus the canonical per-run report artifact.
- `ActiveModelBinding` gains the additive optional `region` marker so
  runtime routing and audit surfaces can preserve the intended region
  family alongside `deployment`, `modelRevision`, and
  `ictRegisterRef`.
- `TestCasePolicyProfileRules` gains the additive optional
  `allowedHostingRegions` allow-list used by
  `G8_EU_REGION_ATTESTED`. The default `eu-banking-default` profile now
  carries the full supported EU/EEA/CH/NO set.
- `Wave1ValidationEvidenceArtifact` gains the additive optional
  `regionAttestations` array. Every persisted artifact row in
  `evidence.manifest.json` can now carry the exact LLM-call residency
  evidence that informed it.
- `FinOpsBudgetReport.bySource[*]` and the top-level
  `FinOpsBudgetReport` gain additive optional `regionAttestation`
  summaries so vendor-governance review can confirm `distinctRegions`,
  attested call counts, and operator-pinned fallback warnings without
  parsing the full report artifact.
- `AuditDossierManifest` gains the additive optional
  `regionAttestations` table and `ALLOWED_AUDIT_DOSSIER_ARTIFACT_KINDS`
  now includes `"region_attestations"`. The audit dossier now requires
  `region-attestations.json` and maps it into DORA Art. 28 / GDPR Ch. V
  coverage.
- `BuildRunProvenanceGraphInput` gains additive optional
  `regionAttestations` (per-call observation entities) and the optional
  `regionAttestationReport` cross-link. `provenance.jsonld` can now add
  `prov:Entity` nodes for residency observations and wire
  `prov:wasInformedBy` edges from generator / judge activities to the
  specific region-evidence entries they consumed.
- `TEST_INTELLIGENCE_CONTRACT_VERSION` bumped `1.27.0` → `1.28.0`.

### Added (Issue #2178 — self-contained reproducibility-seal verifier CLI)

- New `src/test-intelligence/seal-verifier.ts` module providing the
  auditor-facing verifier for `production-runner-evidence-seal.json`.
  Public exports:
  - `verifySealBundle(input)` — directory-bundle entry point.
    Recomputes per-artifact SHA-256, builds a Merkle root over sorted
    `(filename, sha256)` leaves, HMAC-SHA256s the canonical seal
    manifest with the supplied (or default deterministic) key, and
    cross-checks the FinOps `bySource` hash, genealogy DAG hash,
    `provenance.jsonld` graph, and `region-attestations.json`.
  - `assertReplayDeterminismVerifiedFromDisk(runDir)` — throws
    `ReplayDeterminismHardGateError` (code
    `G9_REPLAY_DETERMINISM_VERIFIED`) on any failure.
  - `renderSealVerificationTextReport(report)` and
    `renderSealVerificationJsonReport(report)` — human and
    machine-readable renderers.
  - `DEFAULT_SEAL_VERIFY_KEY_LABEL` — documented sentinel for the
    deterministic default HMAC key.
  - Exported types: `SealArtifactReport`, `SealArtifactStatus`
    (`"OK" | "TAMPERED" | "MISSING" | "EXTRA"`),
    `SealVerifyCrossCheck`, `SealVerifyFailure`,
    `SealVerifyFailureCode`, `SealVerificationReport`,
    `VerifySealBundleInput`.
- New CLI subcommand
  `workspace-dev test-intelligence verify-seal --bundle <path>
  [--key <path>] [--expected-hmac <hex>] [--expected-merkle-root <hex>]
  [--json] [--output <path>]`. Accepts directory, `.tar`,
  `.tar.gz`/`.tgz`, and `.zip` bundles; archives are extracted via
  the universal POSIX `tar` / `unzip` binaries. Exit `0` on full
  match, `1` on operator misuse, `2` on tamper / mismatch.
- The production runner now invokes
  `assertReplayDeterminismVerifiedFromDisk` after the existing
  post-write seal and provenance verifications, wiring the new
  `G9_REPLAY_DETERMINISM_VERIFIED` hard gate so any drift between the
  in-process build path and the auditor-facing verifier fails CI.
- `TEST_INTELLIGENCE_CONTRACT_VERSION` unchanged at `1.28.0` — the
  surface is purely additive (new module + new CLI subcommand) and
  the seal schema is unchanged. The Merkle root and HMAC are derived
  at verify time from the canonical seal manifest contents, so seals
  produced by past run sets (`G0`, `I0`, `J0`, `K0`, `M0`
  multi-dataset) verify without modification.

### Hardened (Issue #2178 — seal verifier follow-up after PR review)

- `parseProductionRunnerEvidenceSeal` is now exported from
  `src/test-intelligence/production-runner-evidence.ts` so the
  standalone seal verifier reuses the same strict shape check that
  the in-process post-write seal verifier already applies (HEX64 hash
  shape, integer-bound `chainLength`, deep array/record validation).
  Type surface is purely additive — no existing callers change.
- `SealVerifyCrossCheck.name` gains a new union member
  `"visual_sidecar_evidence"`. The verifier now parses
  `visual-sidecar-result.json` and confirms its `visualEvidenceRefs`
  match `seal.visualEvidenceHashes`; fails closed when the seal
  references visuals but the sidecar is missing. Existing consumers
  that switch on `name` should treat unknown variants as informational
  (the report shape is otherwise unchanged).
- `SealArtifactReport.firstMismatchOffset` is now omitted on
  hash-only mismatches instead of being misleadingly set to `0`. The
  field semantics in the docstring remain stable (still only present
  when both byte sequences are available).
- Seal-referenced artifact paths and archive entries in `.tar`,
  `.tar.gz`/`.tgz`, and `.zip` bundles are now rejected when they try
  to escape the run directory (absolute paths, `..` segments, drive
  letters, embedded null bytes). Closes the path-traversal /
  zip-slip / tar-escape risk on auditor-supplied bundles.
- `runChild` now treats a signal-terminated extractor as a non-zero
  exit so a SIGKILL'd `tar`/`unzip` cannot silently look like
  success.
- `TEST_INTELLIGENCE_CONTRACT_VERSION` unchanged at `1.28.0`. All
  changes are additive or internal hardening; no existing public
  signatures, fields, or error codes are renamed or removed.

---

## [4.62.0] - 2026-05-10

### Added (Issue #2175 — regulator-ready audit-dossier bundle generation and verification)

- New test-intelligence runtime constants exported from
  `src/contracts/index.ts`:
  `AUDIT_DOSSIER_ARTIFACT_BASENAME` (`"audit-dossier"`),
  `AUDIT_DOSSIER_MANIFEST_SCHEMA_VERSION` (`"1.0.0"`),
  `AUDIT_DOSSIER_SIGNATURE_SCHEMA_VERSION` (`"1.0.0"`), and
  `ALLOWED_AUDIT_DOSSIER_ARTIFACT_KINDS` (closed vocabulary for the
  manifest artifact inventory).
- New exported types `AuditDossierManifestArtifactKind`,
  `AuditDossierManifestArtifactRef`, `AuditDossierProvenanceLeafHash`,
  `AuditDossierRegulationCoverageEntry`, `AuditDossierManifest`, and
  `AuditDossierSignature`. These define the canonical JSON manifest,
  detached-signature envelope, provenance leaf inventory, and
  regulation-coverage table for the audit bundle surface.
- New operator-facing CLI subcommands on the package entrypoint:
  `workspace-dev test-intelligence audit-dossier` and
  `workspace-dev test-intelligence audit-verify`.
- `audit-dossier` builds a deterministic four-file bundle from one run
  directory:
  `<runId>-audit-dossier.json`,
  `<runId>-audit-dossier.sig`,
  `<runId>-audit-dossier.pdf`, and
  `<runId>-audit-dossier.merkle.txt`.
- The manifest contract records only attested metadata and digests for
  the required evidence set (`provenance.jsonld`,
  `compliance-coverage-report.json`, `compliance-annotations.json`,
  `judge-calibration-eval.json`, `locale-calibration-curves.json`,
  `inter-rater-agreement.json`, `distribution-shift-report.json`,
  `incidents.json`, `subprocessor-register.json`,
  `finops/budget-report.json`, `faithfulness-tier-report.json`,
  `self-consistency-arbitration.json`,
  `production-runner-evidence-seal.json`, and exactly one
  `*.model-card.json`). Raw prompts, screenshot bytes, secrets, and PII
  are intentionally out of scope for the bundle surface.
- The detached-signature contract uses Ed25519 public-key material plus
  a stable SHA-256 fingerprint and signs the final canonical manifest
  bytes. The manifest also carries the SHA-256 of the unsigned-manifest
  view (`signing.manifestSha256`) so verifiers can detect metadata
  drift even when the signature file is intact.
- `audit-verify` recomputes the manifest digest, validates the detached
  signature, and rebuilds the Merkle proof text from the manifest's
  canonical leaf hashes. Missing files, malformed JSON, mismatched key
  metadata, invalid signatures, and Merkle drift all fail closed.
- `TEST_INTELLIGENCE_CONTRACT_VERSION` bumped `1.26.0` → `1.27.0`.
- `CONTRACT_VERSION` bumped `4.60.0` → `4.62.0`.
- These are additive surface changes; no existing field, type, or
  command was removed or renamed.

## [1.26.0] - 2026-05-10

### Added (Issue #2174 — subprocessor register JSON artifact, DORA Art. 28 machine-verifiable)

- New runtime constant `SUBPROCESSOR_REGISTER_SCHEMA_VERSION` (`"1.0.0"`)
  exported from `src/contracts/index.ts`. Tracks the artifact shape
  (`SubprocessorRegister` interface) independently of
  `SUBPROCESSOR_REGISTER_VERSION`, which keeps tracking the documented
  register content.
- New runtime constant `SUBPROCESSOR_REGISTER_ARTIFACT_FILENAME`
  (`"subprocessor-register.json"`) exported from `src/contracts/index.ts`.
- New runtime constant `SUPPORTED_HOSTING_REGIONS` exported from
  `src/contracts/index.ts` — closed vocabulary of Azure / Mistral
  EEA regions plus the explicit `"operator-defined"` token.
- New exported types `SupportedHostingRegion`, `SubprocessorEntry`,
  `CrossBorderTransferEntry`, `SubprocessorRegister`. Every field is
  required unless explicitly typed `?` (`soc2ReportRef`,
  `iso27001ReportRef`).
- `BuildRunProvenanceGraphInput` gains the additive optional
  `subprocessorRegister?: { artifactFilename: string; merkleRoot: string }`
  input. When present, `provenance.jsonld` carries
  `ti:subprocessorRegisterMerkleRoot` at the bundle level and adds a
  `prov:Entity` artifact node for the register file.
- `ComplianceAnnotationEntry` gains the additive
  `subprocessorRefs: readonly string[]` field (sorted ascending; empty
  when no rule citation references a subprocessor).
- `ComplianceAnnotationArtifact` gains the additive optional
  `subprocessorRegisterRef?: { artifactFilename, schemaVersion, registerVersion, merkleRoot }`
  cross-link.
- `AnnotateTestCasesInput` gains the additive optional
  `subprocessorRegister?: SubprocessorRegister` and
  `subprocessorRegisterArtifactFilename?: string` inputs so the
  annotator can resolve subprocessor citations without an extra file
  read.
- New artifact `subprocessor-register.json` ships per run alongside
  `compliance-annotations.json` and `compliance-coverage-report.json`.
  Byte-stable: identical inputs produce identical canonical JSON bytes
  and identical SHA-256 across runs at the same commit.
- Auto-generated `docs/dora/subprocessor-register.md` is now regenerated
  from the canonical TS source-of-truth in
  `src/test-intelligence/subprocessor-register.ts` by
  `scripts/render-subprocessor-register.mts`. CI dev-gate
  (`pnpm run verify:subprocessor-register`) fails the build on drift.
- New schema doc `docs/dora/subprocessor-register-schema.md`.
- `TEST_INTELLIGENCE_CONTRACT_VERSION` bumped `1.25.0` → `1.26.0` in
  lockstep with the additive surface above.
- These are all additive changes; no existing field is removed or
  renamed.

## [1.24.0] - 2026-05-10

### Added (Issue #2170 — cross-modal-faithfulness mid-tier `evidence_partial` thresholds + state-transition tier + partial-majority warning)

- New runtime constant `FAITHFULNESS_PARTIAL_MAJORITY_FRACTION` (`0.6`)
  exported from `src/contracts/index.ts`. The tier report and the policy
  gate import it as the single source of truth for the per-case
  partial-majority threshold.
- `FAITHFULNESS_TIER_LABELS` gains the additive third member
  `"state_transition"`. A step is classified as `state_transition` when
  the parent test case has `technique === "state_transition"` and the
  step has no concrete-data assertion. Per-step thresholds:
  `match >= 0.95`, `evidence_partial >= 0.65`, `mismatch < 0.65`.
- `FaithfulnessTierReport` gains the additive
  `partialMajorityCaseIds: readonly string[]` field (sorted ascending,
  empty when no case crosses the `>= 60 %` partial-evidence majority).
- `ALLOWED_TEST_CASE_POLICY_OUTCOMES` gains the additive
  `"cross_modal_faithfulness_partial_majority"` outcome. The companion
  rule id `policy:cross-modal-faithfulness-partial-majority` is raised at
  case level with severity `warning`; the case escalates to
  `needs_review` (never `blocked`) so it still ships.
- `RenderCustomerMarkdownInput` gains the additive optional
  `faithfulnessPartialMajorityCaseIds?: ReadonlySet<string>` field. When
  set, the customer markdown footer for each flagged case carries the
  `Hinweis (Cross-Modal-Faithfulness)` partial-evidence note.
- `FAITHFULNESS_TIER_REPORT_SCHEMA_VERSION` bumped `1.0.0` → `1.1.0`
  (additive `partialMajorityCaseIds`; readers built against `1.0.0`
  continue to load `1.1.0` reports unchanged).
- `FAITHFULNESS_JUDGE_PROMPT_TEMPLATE_VERSION` bumped
  `faithfulness-judge.v2` → `faithfulness-judge.v3` (rubric prefers
  `evidence_partial` over `mismatch` on intermediate state-transition
  frames; verdict-emission contract unchanged).
- `TEST_INTELLIGENCE_CONTRACT_VERSION` bumped `1.23.0` → `1.24.0` in
  lockstep with the additive surface above.
- These are all additive changes; no existing field is removed or
  renamed.

## [1.25.0] - 2026-05-10

### Added (Issue #2171 — tier-elastic technique-coverage quotas owned by the policy profile)

- The technique-coverage policy surface now exports the closed
  `TECHNIQUE_COVERAGE_MINIMUM_MODES` vocabulary plus
  `TechniqueCoverageMinimumMode`, `TechniqueCoverageMinimumTier`,
  `FixedTechniqueCoverageMinimumPolicy`,
  `TierElasticTechniqueCoverageMinimumPolicy`, and
  `TechniqueCoverageMinimumPolicy`.
- `TIER_ELASTIC_EP_TIERS` is now a published default tier table, and the
  `eu-banking-default` policy profile owns the tier coefficients used to
  scale equivalence-partitioning quotas per screen.
- `TechniqueQuotaReport` persists the resolved mode and tier audit trail so
  reviewers can reconstruct why a run chose fixed versus tier-elastic quota
  enforcement.

### Added (Issue #2172 — audited `--max-figma-payload-bytes` override and FinOps payload trace)

- The production runner publishes a new optional `FinOpsBudgetReport.figmaPayload`
  block with `resolvedCapBytes`, `actualBytes`, `defaultCapBytes`,
  `ceilingBytes`, and `overrideApplied`.
- The CLI and programmatic runner now expose an audited soft-cap override for
  large Figma REST payloads while hard-rejecting values above the 64 MiB
  ceiling.
- Migration note: downstream FinOps consumers may now rely on the persisted
  `figmaPayload` audit block instead of inferring payload caps from CLI flags
  or operator logs.

## [1.23.0] - 2026-05-10

### Added (Issue #2125 — Wilson self-consistency confidence + cross-family arbiter routing)

- New exported `SelfConsistencyVote` type from `src/contracts/index.ts` with
  additive fields `winner`, `agreementRate`, `confidenceInterval95`,
  `bootstrapSampleSize`, and `consensusStrength`.
- `SelfConsistencyDisagreementRoute` now includes the additive
  `"cross_family_arbitration"` member alongside `"human_review"`.
- `SelfConsistencyFieldVote` gains additive metadata fields
  `agreementRate`, `confidenceInterval95`, `bootstrapSampleSize`,
  `consensusStrength`, and `winner` while preserving the legacy
  `agreement` alias.
- `SelfConsistencyTargetReportEntry` gains additive
  `consensusStrength?: "strong_consensus" | "weak_consensus"` semantics at
  runtime plus optional `arbitrationTriggered` for audited 4th-vote runs.
- These are additive contract changes; existing persisted artifacts remain
  readable because legacy fields were not removed or renamed.

### Added (Issue #2117 — per-locale Platt-curve calibration: DE-DE, DE-AT, DE-CH, EN-IE, FR-FR, IT-IT)

- New `SupportedLocale` type exported from `src/contracts/index.ts` (`"DE-DE" | "DE-AT" | "DE-CH" | "EN-IE" | "FR-FR" | "IT-IT"`).
- `BusinessTestIntentScreen` gains optional `locale?: SupportedLocale` (additive; existing artifacts unaffected).
- `CaseConfidenceCurveArtifact` gains three additive fields: `localeCurves`, `perLocaleEceThreshold`, `localeSampleCount`. New type `LocaleCurveEntry` with `fallbackToDefault` flag.
- `DriftMetricObservation` and `DriftFinding` gain optional `locale?: LocaleCalibrationKey` for per-locale calibration shift tracking.
- These are all additive changes; no existing field is removed or renamed.

### Added (Issue #2118 — A/B shadow-mode parity tests for `shadow_eval` and `enforced`)

- The production-runner audit contract now treats `shadow_eval` and `enforced`
  as a regression-locked parity pair: identical inputs must yield the same
  `(generatedTestCases, validation, policy.violations)` triple, modulo the
  harness enforcement decision itself.
- Replay-cache identity is explicitly mode-independent across that pair: cache
  keys populated under `shadow_eval` must be reusable under `enforced`
  without adding a harness-mode discriminator.
- Migration note: future harness-mode changes must preserve the cross-mode
  parity and cache-key invariants or land with a new contract entry.

### Added (Issue #2119 — active-learning sample-selection loop)

- New active-learning queue surface selects human-label growth candidates from
  three auditable sources: low-confidence cases, judge-consensus disagreement
  cases, and drift-flagged cases.
- The selection loop re-applies the Issue #2109 inter-rater gate over newly
  added examples so quarterly gold-set growth preserves the published kappa
  and reviewer-share thresholds.
- The resulting sample-selection artifact is deterministic and reviewable;
  downstream operators can inspect why a case entered the relabel queue
  without replaying the production run.

### Added (Issue #2120 — distribution-shift detection on the input side)

- New drift-sentinel artifact family adds `DRIFT_CANARY_SCHEMA_VERSION`,
  `DRIFT_REPORT_ARTIFACT_FILENAME`, `DRIFT_ALERTS_ARTIFACT_FILENAME`,
  `DRIFT_BASELINE_FILENAME`, and `DRIFT_CANARY_BASELINES_DIRNAME` for the
  persisted input-distribution monitoring lane.
- The detector contracts a fixed holdout/canary surface via
  `DRIFT_CANARY_CANARY_SET_ID`, `DRIFT_CANARY_HOLDOUT_FIXTURE_IDS`,
  `DRIFT_CANARY_HISTORY_DAYS`, `DRIFT_CANARY_SIGMA_THRESHOLD`, and
  `DRIFT_CANARY_BRIER_ABSOLUTE_THRESHOLD`.
- Consumers may now rely on a canonical `drift-report.json` / `drift-alerts.json`
  pair for pre-metric concept-drift evidence.

### Added (Issue #2121 — performance-regression tracking with per-role token and latency SLOs)

- New FinOps regression artifact surface adds
  `FINOPS_SLO_REPORT_SCHEMA_VERSION`, `FINOPS_SLO_REPORT_ARTIFACT_FILENAME`,
  `FINOPS_SLO_ALERT_SET_ID`, `FINOPS_SLO_DEFAULT_HISTORY_RETENTION_DAYS`, and
  the closed `FINOPS_SLO_ROLES` / `FinOpsSloRole` role vocabulary.
- The persisted SLO report records rolling token and latency budgets plus the
  routing-savings dashboard used by the CI gate and operator runbooks.
- Migration note: downstream tooling may now ingest
  `artifacts/finops/finops-slo-report.json` as the canonical regression
  summary instead of scraping console output.

### Added (Issue #2122 — adversarial corpus expansion to 50+ curated attacks)

- The evaluation corpus now includes the committed `adversarial-2025` attack
  set as a regression-locked public evidence surface, with CI gates requiring
  the curated corpus to remain loadable and complete.
- The attack inventory is append-only from a governance perspective: new
  categories or fixture families should land with an explicit changelog note
  because the benchmark envelope is part of the published quality contract.

### Added (Issue #2123 — semantic equivalence-class verification)

- New validation issue codes `intra_equivalence_class_redundancy` and
  `exact_near_duplicate_text` are exported on
  `ALLOWED_TEST_CASE_VALIDATION_ISSUE_CODES`.
- New semantic polarity contract adds
  `ALLOWED_TEST_CASE_ORACLE_POLARITIES` / `TestCaseOraclePolarity`, and the
  validator persists `EquivalenceClassFingerprint`-based redundancy analysis
  instead of relying on text similarity alone.
- Migration note: warning consumers must accept the two new validator codes
  when reviewing redundancy findings.

### Added (Issue #2124 — customer-eval statistical sample plan)

- The customer-eval rubric now carries an explicit statistical sample-plan
  governance contract: rubric updates must land together with `SAMPLE-PLAN.md`
  or `SAMPLE-PLAN-NON-UPDATE.md`.
- CI enforces that linkage structurally, so downstream auditors can treat the
  published sample-plan files as part of the stable evaluation surface rather
  than best-effort documentation.

## [1.22.0] - 2026-05-09

### Added (Issue #2099 — multi-model routing strategy with Azure portfolio)

- New typed routing-policy contract adds `MODEL_ROUTING_TIER_LABELS`,
  `MODEL_ROUTING_ROUTE_SLOTS`, `MODEL_ROUTING_ROLES`,
  `MODEL_ROUTING_POLICY_SCHEMA_VERSION`, and the associated
  `ModelRoutingTierLabel`, `ModelRoutingRouteSlot`, `ModelRoutingRole`, and
  `ModelRoutingRoute` types.
- The role vocabulary now covers the production routing graph for
  `test_generation`, `logic_judge`, `coverage_planner`, `risk_ranker`,
  `visual_*`, `a11y_judge`, `faithfulness_judge`, `document_ingestion`,
  `adversarial_critic`, and `calibration_holdout_generator`.
- Migration note: routing-policy consumers must treat the slot/tier labels as
  the source of truth instead of inferring topology from environment-variable
  naming.

### Added (Issue #2101 — operator-configurable judge refusal policy)

- `TestCaseValidationReport` gains the additive
  `judgeAvailability?: JudgeAvailabilityReport` block and the closed
  `ALLOWED_JUDGE_AVAILABILITY_STATES` vocabulary
  (`"available" | "refused" | "skipped"`).
- New policy-profile contract adds `ALLOWED_JUDGE_REFUSAL_POLICIES`,
  `JudgeRefusalPolicy`, and `JudgeRefusalPolicyConfig` so operators can choose
  `fail_open`, `fail_closed`, or `needs_review` independently for
  faithfulness and accessibility judges.
- Migration note: policy/report consumers may now see explicit refused/skipped
  judge state even when the overall run still passes.

### Added (Issue #2102 — JudgeConsensusVeto and multi-judge voting protocol)

- `JUDGE_CONSENSUS_SCHEMA_VERSION` bumped `1.0.0` → `1.1.0`.
- New consensus-panel contract exports `KNOWN_JUDGE_CONSENSUS_JUDGE_IDS`,
  `JUDGE_CONSENSUS_FINDING_CATEGORIES`, `JudgeConsensusFinding`,
  `JudgeConsensusPanelEntry`, `JudgeConsensusVeto`,
  `JUDGE_CONSENSUS_AGREEMENT_SHAPES`, `JUDGE_CONSENSUS_REPAIR_STATES`,
  `JUDGE_CONSENSUS_REPAIR_OUTCOMES`, `JudgeConsensusRepairHistory`, and the
  expanded `JudgeConsensusVerdict`.
- Migration note: consumers of `judge-consensus.json` must accept the additive
  `agreementShape`, `vetoBy`, `panel`, and `repairHistory` fields.

### Added (Issue #2103 — drift-canary MVP for calibration shift)

- The monitoring surface now persists a dedicated drift-canary artifact family:
  `drift-report.json`, `drift-alerts.json`, baseline snapshots, and the
  associated canary-set identity.
- The report contract records ECE, Brier, and faithfulness shift findings
  against a rolling baseline so operator alerts no longer depend on log
  scraping or re-deriving thresholds offline.

### Added (Issue #2104 — centralized `MAX_INSTRUCTION_LENGTH` and truncation audit)

- `GENERATED_TEST_CASE_SCHEMA_VERSION` bumped `1.2.0` → `1.3.0`.
- Generated-test-case payloads gain the additive audit field
  `audit.truncatedInstructionCount`, and persisted judge / repair artifacts
  may now surface `truncatedInstructionCount` so reviewers can see when
  upstream instructions were clipped.
- Migration note: validators should treat the truncation counters as optional
  additive audit metadata, not as a sign of schema incompatibility.

### Added (Issue #2105 — remove `dry_run` submit mode from the public surface)

- The public runner contract no longer treats `dry_run` as a valid submit-mode
  surface; callers must use the persisted dry-run report artifact instead of a
  quasi-production execution mode.
- Migration note: any caller still branching on `dry_run` must migrate to the
  deterministic report path before upgrading.

### Added (Issue #2106 — explicit synthetic flag for test-data oracle provenance)

- The deterministic oracle artifact keeps its existing schema version but now
  treats synthetic provenance as a first-class field instead of encoding it in
  redaction-token suffixes.
- Migration note: consumers should read the explicit synthetic provenance in
  `test-data-oracle-report.json` and stop inferring it from placeholder text.

### Added (Issue #2107 — per-class ECE on regulated risk categories)

- The calibration gate now treats per-class Expected Calibration Error as a
  published quality contract across the regulated risk categories rather than a
  single aggregate-only metric.
- The exported threshold surface is consumed downstream by the Issue #2117
  locale-calibration lane and by the judge-calibration model card.

### Added (Issue #2108 — default-on domain-invariant registry)

- The default registry now ships a public, append-only EU banking and
  insurance invariant catalog with legal-source citations and deterministic
  provenance (`source: "Issue #2108 (registered)"`).
- Validation behavior now assumes the domain-invariant registry is active by
  default; disabling it is no longer the compatibility baseline for regulated
  profiles.

### Added (Issue #2109 — inter-rater agreement protocol)

- New inter-rater artifact contract exports `INTER_RATER_KAPPA_HARD_FLOOR`,
  `INTER_RATER_KAPPA_WARN_FLOOR`, `INTER_RATER_PER_SCENARIO_GATE_MIN_PAIRS`,
  `INTER_RATER_REVIEWER_SHARE_HARD_CAP`,
  `INTER_RATER_REVIEWER_SHARE_WARN_CAP`,
  `INTER_RATER_GATE_THRESHOLDS`, and `InterRaterAgreementReport`.
- The persisted agreement artifact now captures per-judge / per-scenario
  Cohen's kappa plus reviewer-rotation diagnostics as auditable release-gate
  evidence.

### Added (Issue #2110 — cross-field invariant engine with typed AST)

- New persisted coverage artifact
  `CROSS_FIELD_INVARIANT_COVERAGE_ARTIFACT_FILENAME =
  "cross-field-invariant-coverage-report.json"` records per-screen and
  per-invariant coverage.
- The invariant engine now publishes a typed, citation-carrying rule surface
  that downstream validators can replay deterministically without re-reading
  free-form policy prose.

### Added (Issue #2111 — workflow state-machine validation for step sequences)

- New persisted workflow-state-machine artifact
  `WORKFLOW_STATE_MACHINE_REPORT_ARTIFACT_FILENAME =
  "workflow-state-machine-report.json"` records per-case transition paths,
  aggregated issues, and per-state-machine coverage.
- The validator contract now treats step-sequence reachability as a first-class
  quality gate rather than an implementation detail of the runner.

### Added (Issue #2112 — model card artifact for EU AI Act Article 13)

- New model-card artifact contract adds `MODEL_CARD_SCHEMA_VERSION`, the
  deterministic docs output filenames, and a byte-stable JSON/Markdown model
  card for the active policy profile.
- The generated envelope carries deployment topology, provider statements,
  calibration provenance, update cadence, and the current
  `TEST_INTELLIGENCE_CONTRACT_VERSION`.

### Added (Issue #2113 — subprocessor register and transfer ADR versioning)

- New exported `SUBPROCESSOR_REGISTER_VERSION` stamps the reviewed
  subprocessor register and cross-border transfer ADR into persisted evidence.
- `Wave1ValidationEvidenceManifestMetadata` gains
  `subprocessorRegisterVersion`, so replays can prove which DORA/GDPR
  documentation set was active for the run.

### Added (Issue #2114 — incident-reporting hooks)

- New incident-handling contract exports `INCIDENT_REPORT_SCHEMA_VERSION`,
  `INCIDENT_REPORT_ARTIFACT_FILENAME`, `ALLOWED_INCIDENT_SEVERITIES`,
  `ALLOWED_INCIDENT_CATEGORIES`, `ALLOWED_INCIDENT_REVIEW_STATES`,
  `ManifestRef`, `IncidentEvent`, and `IncidentReport`.
- Migration note: operator sinks may now receive `incidents.json` and must
  accept the seven-category incident taxonomy.

### Added (Issue #2115 — benchmark dataset expansion to 50+ fixtures)

- New benchmark-expansion surface publishes the committed
  `BENCHMARK_EXPANSION_FIXTURE_IDS`, per-stratum minimums, and deterministic
  fixture-to-stratum mapping used by the release-gate corpus.
- The benchmark envelope is now a reviewable contract rather than an implicit
  fixture-directory convention.

### Added (Issue #2116 — faithfulness tier-elastic fallback semantics)

- `TestCasePolicyReport` gains the additive
  `faithfulnessEvaluation?: FaithfulnessEvaluationSummary` block.
- New published faithfulness-evaluation contract documents the
  `per_step`, `case_level_fallback`, and `missing` modes together with the
  `requirePerStepFaithfulness` policy mirror and step-verdict counts.
- Migration note: policy-report consumers should read the explicit
  `faithfulnessEvaluation` block instead of inferring fallback behavior from
  warning text alone.

## [4.61.0] - 2026-05-09

### Added (Issue #2100 — signed semantic-content overrides enforced inside policy-gate)

Issue #2100 closes the remaining trust gap in semantic suspicious-content
overrides. Before this change the test-intelligence submodule accepted a plain
`semanticContentOverrides` membership map and let any matching `(testCaseId,
path)` downgrade a blocking `semantic_suspicious_content` finding to
`needs_review`. The review-event log captured override notes for forensics, but
the policy gate itself did not require signed, attributable, non-expired
entries before honoring the downgrade.

Public surface changes in the additive `src/test-intelligence` submodule:

- `createSignedSemanticContentOverrideEntry(...)` is now exported for callers
  that need to construct signed override entries deterministically.
- New exported types:
    - `PrincipalRef`
    - `ISO8601`
    - `HmacBlock`
    - `OverrideAuthoritySecretProvider`
    - `OverrideAuthorityProvider`
    - `SemanticContentOverrideEntry`
    - `CreateSignedSemanticContentOverrideEntryInput`
    - `InvalidSemanticContentOverride`
    - `InvalidSemanticContentOverrideMap`
- `SemanticContentOverrideMap` now carries signed entries keyed by
  `testCaseId -> path` instead of accepting legacy raw path sets.
- `EvaluatePolicyGateInput`, `RunValidationPipelineInput`, and
  `RunExportPipelineInput` add the optional
  `overrideAuthorityProvider?: OverrideAuthorityProvider` hook so the module can
  verify signatures before an override affects blocking or export decisions.
- New exported metadata keys used in `review-events.json` replay:
    - `SEMANTIC_CONTENT_OVERRIDE_METADATA_SIGNED_AT_KEY`
    - `SEMANTIC_CONTENT_OVERRIDE_METADATA_SIGNATURE_KEY`
    - `SEMANTIC_CONTENT_OVERRIDE_METADATA_SIGNATURE_KEY_ID_KEY`
    - `SEMANTIC_CONTENT_OVERRIDE_METADATA_EXPIRES_AT_KEY`
    - `SEMANTIC_CONTENT_OVERRIDE_METADATA_VERIFIED_SIGNATURE_KEY`
- New exported runtime constant:
  `SEMANTIC_CONTENT_OVERRIDE_HMAC_ALGORITHM = "hmac-sha256"`.
- `partitionSemanticContentOverridesForValidation(...)` is exported so callers
  can derive the verified subset plus invalid-entry audit reasons using the same
  fail-closed logic as `policy-gate`.

Behavioral changes:

- `evaluatePolicyGate(...)` now rejects semantic overrides that are unsigned,
  malformed, unverifiable, expired, or supplied without an
  `overrideAuthorityProvider`. Rejected entries emit the per-case
  `policy:override_invalid` rule at `error` severity and do not downgrade the
  original semantic blocking violation.
- `runValidationPipeline(...)` and `runExportPipeline(...)` now recompute the
  effective validation block using only the verified override subset, so the
  policy/export path cannot bypass signature checks through a direct raw map.
- `recordSemanticContentOverride(...)` now requires an authority provider and
  persists signed replay metadata, including `verifiedSignature: true`, for
  each recorded override note.

Migration note:

- Existing tests and fixtures that previously used
  `Map<string, Set<string>>` semantic override inputs were regenerated to use
  signed `SemanticContentOverrideEntry` values plus an
  `overrideAuthorityProvider`.

## [4.60.0] - 2026-05-08

### Added (Issue #2069 — persisted visual-sidecar primary circuit breaker + policy split)

Before #2069 the visual-sidecar runner always attempted the primary deployment
first, even after repeated protocol-class failures that were known to be
non-recovering for the active deployment. Each new run therefore paid for the
same broken primary attempt again before falling through to the fallback. The
policy surface also collapsed two materially different situations into one
warning-style signal: a fallback-recovered success and a total both-sidecars
failure.

This release persists a caller-side circuit breaker for the visual primary
deployment, skips the primary while the breaker is open, records the observed
breaker state in FinOps, and splits the policy outcomes so recovered fallback is
informational while total visual refusal is blocking.

Public-contract changes (additive — no removals, no renames):

- `TEST_INTELLIGENCE_CONTRACT_VERSION` bumps from `1.20.0` to `1.21.0`.
- `TestCaseValidationSeverity` adds the new literal `info`.
- `ALLOWED_TEST_CASE_POLICY_OUTCOMES` adds:
    - `visual_sidecar_fallback_used_succeeded`
    - `visual_sidecar_both_failed`
- New exported type `LlmCircuitState = "closed" | "open" | "half_open"`.
- `VisualSidecarAttempt.circuitBreakerState?` — optional breaker snapshot state
  observed before dispatch.
- `FinOpsBudgetReport.bySource[*].circuitBreakerStates?` — ordered list of
  caller-side breaker states recorded per dispatch decision, including
  breaker-open skips.

Operational behaviour introduced by the additive surface:

- The production runner persists visual-primary breaker state at
  `<outputRoot>/replay-cache/circuit-breaker-state.json`, keyed by tenant scope
  plus primary deployment id.
- The breaker opens after two consecutive protocol-class primary failures and
  stays open for the configured cooldown window (default `30s` via the primary
  role's LLM circuit-breaker reset timeout).
- While open, the runner skips the primary and dispatches directly to the
  fallback. After cooldown expiry, the next run may probe the primary in
  `half_open`.
- `policy:visual-sidecar:fallback_used` now emits
  `outcome = visual_sidecar_fallback_used_succeeded` with `severity = info`
  when the fallback succeeds after a primary failure or skip.
- `policy:visual-sidecar:both_failed` emits
  `outcome = visual_sidecar_both_failed` with `severity = error` when visual
  evidence cannot be produced from either deployment.

Breaking-change posture: additive on the wire, but consumers that hard-coded the
old visual-sidecar warning outcome set must accept the new `info` severity and
the two new policy outcome literals.

migrationHash: 2026-05-08T00-00-00-000Z-issue-2069

---

## [4.59.0] - 2026-05-08

### Added (Issue #2068 — tier-elastic `policy:technique-coverage-minimum` quota)

Before #2068 the `policy:technique-coverage-minimum` gate enforced the
planner-published `CoveragePlan.perScreen[].techniqueQuotas` minCount
verbatim. On the K0 benchmark the planner emitted a fixed `minCount: 12`
for `equivalence_partitioning` regardless of screen size, so the harness
flagged a `technique_quota_breach` even though the screen had only 7–9
fields and the generator already produced 10–11 EP cases. The same
defect blocked G0/I0/J0 and now K0 — the policy quota was structurally
mis-sized for small-field screens, forcing the harness to emit padding
cases that lowered the semantic-coverage signal.

This release replaces the fixed quota with a tier-elastic formula that
scales with the screen's coverage-relevant field count. Customers that
contractually require a fixed floor opt into `{ mode: "fixed" }` on a
derived policy profile, which preserves the legacy behaviour byte-for-byte.

Public-contract changes (additive — no removals, no renames):

- New exported runtime constants:
    - `TECHNIQUE_COVERAGE_MINIMUM_MODES`
      (`["tier-elastic", "fixed"]` — frozen tuple),
    - `TIER_ELASTIC_EP_TIERS` — frozen tier catalog
      (`<= 4 fields → max(4, 2*fields)`,
      `<= 8 fields → ceil(1.5*fields)`,
      `>= 9 fields → fields`),
    - `TECHNIQUE_QUOTA_REPORT_SCHEMA_VERSION` (`"1.0.0"`),
    - `TECHNIQUE_QUOTA_REPORT_ARTIFACT_FILENAME`
      (`"technique-quota-report.json"`),
    - `TECHNIQUE_QUOTA_REPORT_STATUSES` (`["pass", "deficit"]`).
- New exported types: `TechniqueCoverageMinimumMode`,
  `TechniqueCoverageMinimumPolicy`, `TechniqueQuotaReport`,
  `TechniqueQuotaReportEntry`, `TechniqueQuotaReportStatus`.
- `TestCasePolicyProfileRules.techniqueCoverageMinimum` — new optional
  field. The `eu-banking-default` profile defaults to
  `{ mode: "tier-elastic" }`. Legacy profiles that omit the field
  continue to work unchanged (the gate falls back to `tier-elastic`).
- `TEST_INTELLIGENCE_CONTRACT_VERSION` bumps from `1.19.0` to `1.20.0`.

Operational behaviour introduced by the additive surface:

- The runner now persists `technique-quota-report.json` alongside
  `policy-report.json` whenever a `CoveragePlan` is supplied. The
  report lists, for every `(screenId, technique)` pair the gate
  resolved this run, the screen's `fieldCount`, the effective
  `requiredCount`, the `actualCount` of anchored cases, the
  machine-readable `formula` label
  (`tier-elastic:fields<=8:ceil(1.5*fields)` etc.) and the per-row
  `status` (`pass | deficit`).
- The `policy:technique-coverage-minimum` gate now consults the
  active `techniqueCoverageMinimum` mode. In `tier-elastic` mode the
  EP quota is replaced with the tier formula; non-EP rows keep their
  planner-published minimums. In `fixed` mode every quota row is
  enforced verbatim.
- The post-LLM logic-judge hard-gate enforces the same tier-elastic
  formula so `repair`-loop verdicts never disagree with the policy
  gate.

Breaking-change posture: none. Profiles that omit the new field, or
that explicitly opt into `{ mode: "fixed" }`, continue to enforce the
exact byte-stable quota the planner published. The artifact is
additive — runs that do not pass a `CoveragePlan` skip the artifact
entirely.

migrationHash: 2026-05-08T00-00-00-000Z-issue-2068

---

## [4.58.0] - 2026-05-08

### Added (Issue #2066 — tier the cross-modal faithfulness threshold + calibrate cross-family judges)

Before #2066 the cross-family faithfulness judge (`llama-4-maverick-vision`,
landed in #2038) collapsed `evidence_partial` step signals into the same
penalty bucket as `mismatch`. Label-only steps where the judge's own
diagnosis was _"the label matches the expectation but the step description
is not fully visible in the screenshot"_ therefore caused the case-level
faithfulness score to land at 0.5 — well below the 0.80 cross-modal floor —
even though every label assertion matched the visible Figma capture. This
blocked **G3** on the K0 benchmark.

This release introduces a per-step three-state rubric and a tier-aware
score aggregation in the policy gate.

Public-contract changes (additive — no removals, no renames):

- New exported runtime constants:
    - `FAITHFULNESS_STEP_VERDICT_LABELS`
      (`["match", "evidence_partial", "mismatch"]` — frozen tuple),
    - `FAITHFULNESS_TIER_LABELS`
      (`["concrete_data", "label_only"]` — frozen tuple),
    - `FAITHFULNESS_TIER_REPORT_SCHEMA_VERSION` (`"1.0.0"`),
    - `FAITHFULNESS_TIER_REPORT_ARTIFACT_FILENAME`
      (`"faithfulness-tier-report.json"`).
- New exported types: `FaithfulnessStepVerdict`,
  `FaithfulnessStepVerdictLabel`, `FaithfulnessTierLabel`,
  `FaithfulnessTierReport`, `FaithfulnessTierReportEntry`.
- `FaithfulnessVerdict.stepVerdicts` — new optional field carrying the
  per-step verdict array. `FAITHFULNESS_VERDICT_SCHEMA_VERSION` bumps
  from `1.0.0` to `1.1.0`. Old verdicts persisted under `1.0.0` parse
  unchanged: the field is optional and the legacy
  `hallucinations` / `mismatches` arrays continue to be emitted in
  parallel.
- `FAITHFULNESS_JUDGE_PROMPT_TEMPLATE_VERSION` bumps from
  `faithfulness-judge.v1` to `faithfulness-judge.v2`. The new template
  instructs the judge to emit the per-step verdict array alongside the
  legacy fields, and clarifies that `evidence_partial` is a soft
  signal, not a contradiction.
- `TEST_INTELLIGENCE_CONTRACT_VERSION` bumps from `1.18.0` to `1.19.0`.

Operational behaviour introduced by the additive surface:

- The runner now persists `faithfulness-tier-report.json` alongside
  `faithfulness_judge.json` whenever the judge produces a non-refused
  verdict. The report lists, for every step, the inferred tier
  (`concrete_data` if the step carries observable input or expected
  data, otherwise `label_only`), the per-step verdict, the per-step
  score (`{1.0 | 0.85 | 0.0}`), and whether the step clears its
  tier-aware threshold.
- The `policy:cross-modal-faithfulness-score` gate aggregates the
  per-step tier-aware scores into the case-level faithfulness score
  before comparing against the threshold. Concrete-data steps still
  fail at `< 0.80`; label-only steps require `>= 0.95` for `match`
  and `>= 0.80` for `evidence_partial`.
- `eu-banking-default` keeps the strict thresholds; profile-scoped
  overrides remain available via `policyOverrides`.

Breaking-change posture: none. Old verdicts persisted under schema
`1.0.0` are still accepted — the gate falls back to the existing
case-level pass/fail aggregation when `stepVerdicts` is absent.

migrationHash: 2026-05-08T00-00-00-000Z-issue-2066

---

## [4.57.0] - 2026-05-08

### Added (Issue #2065 — llguidance constrained-decoding adapter for the openai_chat transport)

Before #2065, the constrained-decoding registry returned a hard-coded
`ok: false` for `preferredAdapter: "llguidance"` on every transport,
which forced every generator and judge call through the prompt-only
fallback. The K0 baseline therefore recorded
`adapterId: "prompt_only"` / `enforcement: "prompt_only"` and left
`polarity` / `category` `null` on the active dataset, blocking the
property-invariant exercises declared by #2040 and the L6
self-consistency multi-sample voting wave.

This release introduces a transport-specific adapter for the
`openai_chat` compatibility mode that delegates JSON-schema
enforcement to the upstream provider via
`response_format: { type: "json_schema", ... }` (and equivalently
via tool-calling: a single `function` tool whose `parameters` carry
the schema, with `tool_choice` pinned). Both Outlines-style
(FSM-bound, schema reified into a token-level automaton inside a
co-located runtime) and llguidance-style (provider-bound, schema
forwarded verbatim and the upstream grammar engine enforces it)
integrations sit behind the same internal adapter contract.

Public-contract changes (additive — no removals, no renames):

- New module surface
  `test-intelligence/constrained-decoding/openai-chat-adapter`:
  `buildOpenAiChatLlguidanceAdapter`,
  `buildOpenAiChatOutlinesAdapter`, `getOpenAiChatAdapter`, and the
  `ConstrainedDecodingAdapter` interface.
- New exported runtime constants:
  `OPENAI_CHAT_LLGUIDANCE_ADAPTER_VERSION` (`"1"`),
  `OPENAI_CHAT_OUTLINES_ADAPTER_VERSION` (`"1"`).
- `LlmConstrainedDecodingMetadata.adapterVersion` is now populated on
  every resolved metadata record (success and fallback paths) so
  downstream FinOps and provenance graphs always have a deterministic
  version pin to correlate cost/quality shifts with adapter rollouts.
  The field was already present on the type and was always populated
  on the fallback path; this release closes the success-path gap.
- The `ConstrainedDecodingAdapter.supports` adapter-internal contract
  now takes both `wireMode` and `compatibilityMode` so transport-bound
  adapters can fail closed when the deployment is not reachable via
  their bound transport. This is an internal contract — no public
  signature changes.

Operational behaviour introduced by the additive runtime surface:

- Adapter selection is automatic and deterministic: when the
  deployment is reachable via `openai_chat` and the operator config
  prefers `llguidance` or `outlines`, the new adapter resolves with
  `enforcement: "provider"` and `wireMode: "json_schema"`. When the
  preferred adapter has no transport-bound variant, the legacy
  registry entry resolves (e.g. `openai_json_schema`).
- The graceful fallback for transports that have no constrained mode
  is preserved verbatim — the resolved metadata still carries
  `fallback: true` and a redacted `fallbackReason`. FinOps and
  provenance consumers see the same envelope shape.
- The adapter is a pure value with no per-call state, so resolution
  is byte-identical given fixed config and seed.

Documentation:

- `docs/test-intelligence/constrained-decoding.md` documents the
  adapter selection table, the openai_chat tool-calling /
  `response_format` posture, and the acceptance-criteria coverage map.

Contract version impacts:

- `CONTRACT_VERSION` bumps from `4.56.0` to `4.57.0` (additive minor
  bump; new exported runtime constants and new module surface; no
  removals, no renames).
- `TEST_INTELLIGENCE_CONTRACT_VERSION` bumps from `1.17.0` to `1.18.0`
  because the test-intelligence surface gains the new constrained-
  decoding adapter module and the `OPENAI_CHAT_*_ADAPTER_VERSION`
  runtime constants.
- `migrationHash:` registration is not required for this release. The
  signed migration registry carries forward unchanged because no
  migration id, hash, or rollback semantics changed.

## [4.56.0] - 2026-05-08

### Added (Issue #2044 — DSPy-style auto-prompt optimization with bootstrapped few-shot)

Prompt curation has been hand-tuned and locked in
`docs/test-intelligence-prompt-template-version.lock.json`. Each tweak
was a manual experiment; eval feedback never drove the next iteration.
This release adds an _offline-only_, deterministic DSPy/MIPRO-style
optimizer that mines bootstrapped few-shot exemplars from accepted
runs, evaluates a closed set of additive directive variants against a
deterministic synthetic eval, and records the winning template as an
_additive_ lock-file entry. The base prompt template is never
rewritten — the prompt-compiler SHA pin enforced by
`scripts/check-prompt-template-version.mjs` remains the authoritative
artifact.

Public-contract changes (additive — no removals, no renames):

- New exported runtime surface from
  `test-intelligence/prompt-optimizer`: `bootstrapExemplars`,
  `runPromptOptimizationCycle`, `writePromptOptimizationReportArtifact`,
  `appendOptimizedTemplateToLockFile`,
  `encodePromptOptimizationReportBytes`, plus the typed inputs
  (`BootstrapExemplarInput`, `RunPromptOptimizationCycleInput`,
  `PromptOptimizerAcceptedRun`).
- New exported runtime constants:
  `PROMPT_OPTIMIZER_VERSION` (`"1.0.0"`),
  `PROMPT_OPTIMIZER_REPORT_SCHEMA_VERSION` (`"1.0.0"`),
  `PROMPT_OPTIMIZER_REPORT_ARTIFACT_FILENAME`
  (`"prompt-optimization-report.json"`),
  `PROMPT_OPTIMIZER_DEFAULT_QUALITY_GATE` (`90`),
  `PROMPT_OPTIMIZER_DEFAULT_BUDGET_MULTIPLIER` (`5`),
  `PROMPT_OPTIMIZER_DEFAULT_SEARCH_BUDGET` (`16`),
  `PROMPT_OPTIMIZER_DEFAULT_MAX_FEW_SHOTS` (`3`),
  `PROMPT_OPTIMIZER_DIRECTIVE_IDS` (closed string-literal union of six
  additive directive ids).
- New exported types: `PromptOptimizerDirectiveId`,
  `PromptOptimizerCandidate`, `PromptOptimizerCandidateScore`,
  `PromptOptimizerExemplar`, `PromptOptimizationLockEntry`,
  `PromptOptimizationReport`.
- The lock file at
  `docs/test-intelligence-prompt-template-version.lock.json` gains an
  optional, additive top-level `optimizedTemplates: PromptOptimizationLockEntry[]`
  array. Existing readers — including the
  `scripts/check-prompt-template-version.mjs` CI guard — ignore it
  because the guard only validates `version` and `promptCompilerSha256`.

Operational behaviour introduced by the additive runtime surface:

- The optimizer is offline-only. The standard production runner does
  not invoke it; operators trigger it explicitly via
  `pnpm tsx scripts/run-prompt-optimization.ts`.
- The cycle is fully deterministic given fixed seeds: identical
  inputs (eval set, exemplar pool, seed, search budget,
  hyperparameters) produce byte-identical
  `prompt-optimization-report.json` and lock-file entries.
- The token-budget cap is a hard ceiling: a candidate whose cumulative
  cost would exceed `budgetMultiplier × baselineTokenCost` (default
  5x) is skipped, never throttled after the fact. The synthetic eval
  is judge-free and never calls an LLM.
- Each report carries a PROV-DM provenance node
  (`provenance.activityId`, `provenance.entityId`, `wasInformedBy`,
  `wasGeneratedAt`) so downstream graph builders can attach the
  optimization activity to the existing test-case lineage without
  re-deriving the shape.

Documentation:

- `docs/test-intelligence/prompt-optimization.md` documents the
  bootstrap pipeline, search loop, FinOps caps, lock-file shape, and
  operator runbook.

Contract version impacts:

- `CONTRACT_VERSION` bumps from `4.55.0` to `4.56.0` (additive minor
  bump; new optional fields, new exported types, new runtime
  constants, no removals or renames).
- `TEST_INTELLIGENCE_CONTRACT_VERSION` bumps from `1.16.0` to `1.17.0`
  because the test-intelligence surface gains the
  `PromptOptimizationReport` and `PromptOptimizationLockEntry`
  contract types and their schema version constant.
- `PROMPT_OPTIMIZER_REPORT_SCHEMA_VERSION` is introduced at `"1.0.0"`.
- `migrationHash:` registration is not required for this release. The
  signed migration registry carries forward unchanged because no
  migration id, hash, or rollback semantics changed.

## [4.55.0] - 2026-05-08

### Added (Issue #2041 — mutation-killing eval suite with `mutationKillRate` KPI)

Coverage metrics (`fieldCoverage`, `traceCoverage`, `invariantCoverage`)
describe what the generated suite _exercises_; they do not describe what
it _detects_. Issue #1753 listed `mutationKillRate >= 0.85` as a primary
success criterion for the multi-agent harness; until this release the
KPI was undefined and never persisted, so DORA-grade audits that ask
"how do you know your test generation is effective?" had no defensible
answer beyond the coverage buckets.

This release adds an in-process, fully deterministic mutation-killing
evaluator that injects a curated catalog of synthetic SUT bugs into a
synthetic SUT stub derived from the customer-eval rubric, runs every
accepted test case against every mutated SUT, and surfaces the resulting
`mutationKillRate` KPI alongside `policy-report.json`. A test case
"kills" a mutation when its expected results are specific enough to
distinguish the mutated SUT from the baseline; the KPI is the share of
applicable mutations killed by at least one accepted case. The
evaluator never calls the LLM gateway, so it consumes no token budget
and stays well below the documented `0.20` cap on the generator
budget (`MUTATION_EVAL_TOKEN_BUDGET_RATIO_CAP`).

The catalog ships fifteen first-order mutations covering the classes
called out in the issue spec (`field-required-flipped`,
`vat-applied-to-netto`, `currency-rounding-off-by-one`,
`boundary-off-by-one`, `state-transition-skipped`, `regex-relaxed`,
`null-equals-empty`, `optional-cost-treated-required`,
`currency-locale-confusion`, `error-message-suppressed`,
`accessibility-name-removed`, `iban-checksum-skipped`,
`pii-redaction-disabled`, `four-eyes-principle-skipped`,
`audit-log-omitted`). Every mutation class declared in
`ALLOWED_MUTATION_CLASSES` has at least one catalog entry, and every
domain invariant registered by Issue #2040 has at least one mutation
that violates it (the property-based safety predicates and the
mutation-killing detection predicates form a dual under the same
catalog of bug archetypes).

Public-contract changes (additive — no removals, no renames):

- New exported runtime surface from
  `test-intelligence/mutation-killing-eval`:
  `createMutationCatalog`, `buildDefaultMutationCatalog`,
  `registerDefaultMutations`, `evaluateMutationKillingSuite`,
  `buildMutationKillRateSummary`, `writeMutationReportArtifact`,
  `encodeCanonicalReportBytes`, plus the typed DSL (`Mutation`,
  `MutationCatalog`, `MutationContext`,
  `EvaluateMutationKillingSuiteInput`).
- New exported runtime constants:
  `ALLOWED_MUTATION_CLASSES`, `ALLOWED_MUTATION_SEVERITIES`,
  `MUTATION_REPORT_ARTIFACT_FILENAME` (`"mutation-report.json"`),
  `MUTATION_REPORT_SCHEMA_VERSION` (`"1.0.0"`),
  `MUTATION_KILL_RATE_DEFAULT_THRESHOLD` (`0.85`),
  `MUTATION_EVAL_TOKEN_BUDGET_RATIO_CAP` (`0.20`).
- New exported types: `MutationClass`, `MutationSeverity`,
  `MutationEvaluation`, `MutationClassKillRate`, `MutationReport`,
  `MutationKillRateSummary`.
- `TestCasePolicyReport` gains an optional `mutationKillRate?:
MutationKillRateSummary` field. The block is omitted when the
  evaluator was not run for this job (the default for fast iterative
  runs), so the byte-shape stays stable for runs that pre-date the
  evaluator.
- `RunFigmaToQcTestCasesInput` gains an optional
  `mutationEval?: { enabled, thresholdRatio }` block. The runner
  defaults to off; benchmark runs opt in via `--enable-mutation-eval`.
  When enabled the runner persists `mutation-report.json`, embeds the
  summary into `policy-report.json#mutationKillRate`, and adds the
  artifact to the Wave-1 evidence manifest under category `manifest`.
- `RunFigmaToQcTestCasesResult.artifactPaths` gains the optional
  `mutationReport?: string` field, present only when the evaluator
  was opted into for the run.
- `TestIntelligenceRunOptions` gains `enableMutationEval: boolean`.
  The CLI exposes the matching `--enable-mutation-eval` and
  `--no-mutation-eval` flags; the env override
  `FIGMAPIPE_WORKSPACE_TI_ENABLE_MUTATION_EVAL=1` flips the default
  for benchmark CI lanes.

Operational behaviour introduced by the additive runtime surface:

- The default catalog is fully deterministic and never calls an LLM,
  so enabling the evaluator does not consume any token budget and
  cannot interact with the `FinOpsBudgetReport` accounting.
- The persisted `mutation-report.json` shape is byte-stable: arrays
  are deterministically sorted (per-mutation rows by `mutationId`,
  per-class rows by the closed `ALLOWED_MUTATION_CLASSES` order,
  unkilled mutations alphabetically by id), ratios are rounded to six
  digits, and only set fields are written.
- The summary projection embedded in
  `policy-report.json#mutationKillRate` is auditable on its own:
  `killRate`, `threshold`, and `meetsThreshold` are recorded
  deterministically at write time so downstream gates can reproduce
  the pass/fail decision without re-running the evaluator.

Documentation:

- `docs/test-intelligence/mutation-eval.md` documents the catalog
  classes, the synthetic-SUT stub semantics, the KPI threshold
  precedence (CLI > runner default), and the wire-shape of
  `mutation-report.json` and `policy-report.json#mutationKillRate`.
- `docs/test-intelligence/local-benchmark-protocol.md` is added so the
  local benchmark scorecard surfaces `mutationKillRate` alongside the
  existing `G-NEG-CASE` lift gate. The protocol document was relocated
  from the gitignored `sandbox/` tree referenced in the Issue #2038 and
  #2053 changelog entries; the original references are preserved as
  historical pointers in the new doc.

Contract version impacts:

- `CONTRACT_VERSION` bumps from `4.54.0` to `4.55.0` (additive minor
  bump; new optional fields, new exported types, new runtime
  constants, no removals or renames).
- `TEST_INTELLIGENCE_CONTRACT_VERSION` bumps from `1.15.0` to `1.16.0`
  because the test-intelligence wire artifact `policy-report.json`
  extends its top-level shape with the new optional `mutationKillRate`
  field, and the new persisted `mutation-report.json` artifact
  shares the same `contractVersion` line.
- `MUTATION_REPORT_SCHEMA_VERSION` is introduced at `"1.0.0"`.
- `migrationHash:` registration is not required for this release. The
  signed migration registry carries forward unchanged because no
  migration id, hash, or rollback semantics changed.

## [4.54.0] - 2026-05-08

### Added (Issue #2040 — property-based test layer with domain-invariant registry)

Until this release the active-dataset risk traps (G5 hard gate — VAT must
not be applied to a Netto financing-need base, plus brutto/netto exclusivity,
optional-cost-field semantics, and financing-need formula bounds) were
enforced only by prose in the customer eval rubric. The rubric instructs
the LLM but cannot reject a generated case that contradicts the rule —
violations could only be caught downstream by the calculation-constraint
detector, which fires after the case has been wrapped, persisted, and
fed into the policy gate.

This release introduces a typed property-based test layer that enforces
those facts as code. Domain experts (or the prompt compiler) declare
invariants such as "VAT is never applied to a Netto base" or
"principal − down payment = financing need (VAT excluded)" via a small
DSL; a property-based sampler derives concrete seed test data and
mutation-killer candidates from each invariant; the validation pipeline
evaluates each generated case against the registry and reports
`domain_invariant_violation` issues for any case that matches an
invariant's `forall` predicate but fails its `holds` predicate. The
coverage report surfaces a job-level `invariantCoverage` ratio plus a
per-case `invariantAnnotations` mapping (`exercises: ["INV-VAT-01", ...]`).

Public-contract changes (additive — no removals, no renames):

- New exported runtime surface from `test-intelligence/domain-invariant-registry`:
  `createInvariantRegistry`, `buildActiveDatasetInvariantRegistry`,
  `registerActiveDatasetInvariants`, `evaluateInvariants`,
  `computeInvariantCoverageRatio`, plus the typed DSL
  (`DomainInvariant`, `DomainInvariantContext`,
  `DomainInvariantViolation`, `DomainInvariantCaseEvaluation`,
  `DomainInvariantEvaluation`, `DomainInvariantRegistry`,
  `DomainInvariantSeverity`).
- New exported runtime surface from `test-intelligence/property-sampler`:
  `sampleInvariantSeeds`, `findInvariantsMissingSamplerFactory`,
  `InvariantSeedPair`, `InvariantSeedSet`. The sampler is deterministic
  (fixed seed, bounded run count) so cache keys remain stable.
- `ALLOWED_TEST_CASE_VALIDATION_ISSUE_CODES` gains
  `"domain_invariant_violation"` (alphabetical-tail insertion). The
  validation pipeline emits this code for every case where an invariant's
  `forall` predicate matches but its `holds` predicate returns false.
- `TestCaseCoverageReport` gains two optional additive fields:
    - `invariantCoverage?: { total, exercised, ratio, registeredIds, exercisedIds }`
      — job-level invariant coverage, with `total` = registered count,
      `exercised` = invariants matched by `forall` for at least one case,
      and `ratio` rounded to six digits.
    - `invariantAnnotations?: TestCaseInvariantAnnotation[]` — per-case
      sorted `exercises` mapping, surfaced only for cases that exercise at
      least one invariant. The new exported type
      `TestCaseInvariantAnnotation` carries `{ testCaseId, exercises }`.
- `RunValidationPipelineInput` and the self-verify variant gain an
  optional `invariantRegistry?: DomainInvariantRegistry | null` override.
  The default is `buildActiveDatasetInvariantRegistry()`; setting the
  field to `null` disables invariant evaluation entirely (no
  `domain_invariant_violation` issues, no `invariantCoverage` field).
- A new `validateGeneratedTestCasesWithInvariants` helper exposes the
  combined report + invariant evaluation so callers that do not run the
  full pipeline can still surface the same outputs.

Operational behaviour introduced by the additive runtime surface:

- The active-dataset registry ships four invariants:
  `INV-VAT-01` (VAT exclusion on the financing-need calculation),
  `INV-NETTO-BRUTTO-01` (brutto/netto exclusivity),
  `INV-OPTIONAL-COST-01` (optional-cost-field semantics),
  `INV-FINANCING-NEED-01` (financing-need formula bounds).
- A test case that triggers an `error`-severity violation is rejected by
  the validation pipeline (`validation-report.json#blocked = true`),
  which propagates to the policy gate and the run-level `blocked` flag.
- `INV-VAT-01` supplements the existing G5 hard gate (VAT-on-financing
  contradiction): the rule is still steered by the eval rubric, and now
  it is additionally enforced as a typed predicate that fails closed
  before the policy gate runs.

Documentation:

- `docs/test-intelligence/property-based-layer.md` documents the DSL,
  the active-dataset invariant set, the property-sampler contract, and
  worked invariants for one banking and one insurance domain.

Contract version impacts:

- `CONTRACT_VERSION` bumps from `4.53.0` to `4.54.0` (additive minor
  bump; new optional fields, new exported types, new runtime constants,
  no removals or renames).
- `TEST_INTELLIGENCE_CONTRACT_VERSION` bumps from `1.14.0` to `1.15.0`
  because the test-intelligence wire artifact `coverage-report.json`
  extends its top-level shape with the new optional `invariantCoverage`
  and `invariantAnnotations` fields.
- `TEST_CASE_COVERAGE_REPORT_SCHEMA_VERSION` and
  `TEST_CASE_VALIDATION_REPORT_SCHEMA_VERSION` remain `1.0.0` — the
  added fields are optional and the existing required envelope keeps
  its byte-shape for legacy producers and consumers.
- `migrationHash:` registration is not required for this release. The
  signed migration registry carries forward unchanged because no
  migration id, hash, or rollback semantics changed.

## [4.53.0] - 2026-05-08

### Added (Issue #2053 — `G-NEG-CASE` adversarial-critic negative-case-lift hard gate)

Issue #2039 shipped the adversarial-critic self-play loop and the
`AdversarialCriticTraceArtifact.negativeCoverage` accounting block, but
the documented `≥ 30 %` negative-case lift target was enforced only by a
single unit test on synthetic input. The production runner had no
release-grade gate that failed closed when the active dataset missed the
target, so a regression in the critic loop or a domain-shift in the
playbooks would silently degrade negative-case coverage.

This release promotes the lift target to a release-grade hard gate
(`G-NEG-CASE`) evaluated by the production runner using the existing
trace artifact and persisted in `policy-report.json` for audit.

Public-contract changes (additive — no removals, no renames):

- `TestCasePolicyProfileRules` gains an optional
  `negativeCaseLift?: { gateMode, thresholdRatio }` block. The
  `eu-banking-default` profile sets the secure default
  `{ gateMode: "enforce", thresholdRatio: 0.30 }`. A derived profile
  that wants to override the gate must specify both fields (e.g.
  `{ gateMode: "advisory", thresholdRatio: 0.30 }`); the
  `RunFigmaToQcTestCasesInput.qualityGates.negativeCaseLift` escape
  hatch (below) is the one-line shortcut that lets operators flip a
  single field while inheriting the rest from the profile.
- `TestCasePolicyReport` gains an optional `gateResults?:
TestCasePolicyGateResult[]` field. Today the array carries the single
  `G-NEG-CASE` entry; future gates extend the same array without a
  contract change.
- New exported types: `TestCasePolicyGateResult`,
  `TestCasePolicyGateId`, `TestCasePolicyGateStatus`,
  `TestCasePolicyGateSkipReason`.
- New exported runtime constants:
  `ALLOWED_TEST_CASE_POLICY_GATE_IDS`,
  `ALLOWED_TEST_CASE_POLICY_GATE_STATUSES`,
  `ALLOWED_TEST_CASE_POLICY_GATE_SKIP_REASONS`.
- `PRODUCTION_RUNNER_FAILURE_CLASSES` adds
  `"NEGATIVE_CASE_LIFT_BELOW_THRESHOLD"` (alphabetical-tail
  insertion). The runner emits this failure class when the gate runs
  in `enforce` mode and the lift target is not met.
- `RunFigmaToQcTestCasesInput` gains an optional
  `qualityGates?.negativeCaseLift?` override. This is the documented
  CLI escape hatch so operators can flip the gate to `advisory` or
  `off` for a single run without authoring a derived policy profile.
  Both `gateMode` and `thresholdRatio` are themselves optional on the
  override — fields left undefined inherit per-field from the policy
  profile, which itself falls back to the documented secure default.
  `{ gateMode: "advisory" }` is therefore a valid one-line escape
  hatch.

Operational behavior introduced by the additive runtime surface:

- After the adversarial-critic loop completes, the runner evaluates
  `G-NEG-CASE` against the per-run baseline and final negative-case
  ratios captured in
  `AdversarialCriticTraceArtifact.negativeCoverage`. The result is
  appended to `policy-report.json` under `gateResults` regardless of
  outcome.
- The gate fails closed when the lift target is not met and
  `gateMode === "enforce"`: every artifact (policy report, evidence
  seal, provenance graph) is sealed first so a failure still leaves a
  complete, auditable evidence bundle on disk; the runner then throws
  a `ProductionRunnerError` with
  `failureClass === "NEGATIVE_CASE_LIFT_BELOW_THRESHOLD"`.
- The gate is `"skipped"` (an explicit, audit-visible status — never
  silently a pass) when the adversarial-critic loop did not run,
  exited with `stopReason === "critic_failed"`, or the operator set
  `gateMode === "off"`. Each skip carries a structured `skipReason`.
- In `"advisory"` mode the same `failed` outcome is recorded as
  `status === "advisory"` and the run completes successfully.

Documentation:

- `docs/test-intelligence/adversarial-critic.md` adds the
  "G-NEG-CASE quality gate" section documenting threshold semantics,
  override precedence (CLI > profile > documented default), skip
  conditions, and the policy-report wire-shape.
- `sandbox/benchmarks/test-intelligence/LOCAL_BENCHMARK_PROTOCOL.md`
  references the new gate in the scorecard template so benchmark runs
  surface the result alongside `mutationKillRate`.

Contract version impacts:

- `CONTRACT_VERSION` bumps from `4.52.0` to `4.53.0` (additive minor
  bump; new optional fields, new exported types, new runtime
  constants, no removals or renames).
- `TEST_INTELLIGENCE_CONTRACT_VERSION` bumps from `1.13.0` to
  `1.14.0` because the test-intelligence wire artifact
  `policy-report.json` extends its top-level shape with the new
  optional `gateResults` array.
- `TEST_CASE_POLICY_REPORT_SCHEMA_VERSION` remains `1.0.0` — the
  added field is optional and the existing required envelope keeps
  its byte-shape for legacy producers and consumers.
- `migrationHash:` registration is not required for this release. The
  signed migration registry introduced in 4.42.0 carries forward
  unchanged because no migration id, hash, or rollback semantics
  changed.

## [4.52.0] - 2026-05-08

### Added (Issue #2039 — adversarial critic self-play loop for blind-spot discovery)

The production runner previously stopped after cooperative generation plus
judge review: generator outputs were checked, but no role was tasked with
actively attacking the suite to surface blind spots before finalisation.
This release adds the bounded `adversarial_critic` lane for
test-intelligence runs.

Public-contract changes (additive — no removals, no renames):

- `AGENT_HARNESS_ROLES` adds `"adversarial_critic"` (alphabetical
  insertion).
- `AGENT_ROLE_FINOPS_GROUPS` adds the dedicated group `"adversarial"`.
- `ALLOWED_AGENT_SOURCE_LABELS` adds `"adversarial_critic"` so per-source
  FinOps, evidence, and participation artifacts can attribute the new
  lane explicitly.

Operational behavior introduced by the additive runtime surface:

- The new `src/test-intelligence/adversarial-critic-agent.ts` module runs a
  bounded self-play loop of at most `2` rounds.
- The critic prompt is parameterized by business domain and grounded in the
  curated playbooks under
  `src/test-intelligence/adversarial-playbooks/banking.json` and
  `src/test-intelligence/adversarial-playbooks/insurance.json`.
- Each round emits structured `AdversarialFinding[]` records with category,
  reproducible test-data fragments, and repair instructions.
- Round artifacts are persisted under
  `agent-role-runs/adversarial_critic_round_K.json`; the aggregated trace is
  persisted as `adversarial-critic-trace.json`, and
  `provenance.jsonld` now records the critic rounds as first-class
  activities.
- FinOps budget attribution for the critic is capped at `25%` of the
  generator budget envelope per round.

Documentation:

- New operator-facing guide:
  `docs/test-intelligence/adversarial-critic.md`.

Contract version impacts:

- `CONTRACT_VERSION` bumps from `4.51.0` to `4.52.0`.
- `TEST_INTELLIGENCE_CONTRACT_VERSION` remains `1.13.0` because the
  schema-versioned artifact envelopes keep their existing shape; this
  release adds enum members, runtime exports, and new additive artifacts
  without changing existing required fields.
- `migrationHash:` registration is not required for this release. The
  signed migration registry introduced in 4.42.0 carries forward unchanged
  because no migration id, hash, or rollback semantics changed.

## [4.51.0] - 2026-05-08

### Added (Issue #2038 — cross-family judge ensemble + disagreement-driven human review)

The judge panel previously sourced every judge role (logic, faithfulness,
accessibility) from a single in-house model family. Failure modes were
therefore correlated — a single mis-classification was likely to be
repeated by the rest of the panel, and the `logic_judge` schema-drift
incident on the I0 baseline went undetected because all three judges
agreed on the wrong shape.

This release adds the cross-family judge ensemble (Issue #2038): every
judge role may declare a model `family` and `region`; the new
`cross-family-judge-policy.ts` module enforces that no two judge roles
in the same run draw from the same family unless the operator opts in.
Disagreements classified as `split_decision` (1:1:1) or
`majority_decision` with the lone dissenter belonging to the
most-trusted family for the case-class are escalated through the new
`human_review` agent role, which emits a deterministic envelope
recorded in `judge-consensus.json`. Per-run disagreement evidence —
disagreement rate, escalation rate, per-family agreement matrix, and
per-family cost rollup — is persisted into the new
`judge-disagreement-report.json` artifact for offline trending.

DORA Article 28 and BaFin VAIT (Versicherungsaufsichtliche IT)
expectations are met by the EU-residency policy gate: under
`eu-banking-default` the `requireEuRegion` flag refuses any judge
binding whose `region` is not `"eu"`.

Public-contract changes (additive — no removals, no renames):

- New runtime exports:
    - `JUDGE_MODEL_FAMILIES`, `JUDGE_MODEL_REGIONS`
    - `JUDGE_DISAGREEMENT_DECISION_LABELS`,
      `JUDGE_DISAGREEMENT_ESCALATION_ACTIONS`
    - `JUDGE_DISAGREEMENT_REPORT_SCHEMA_VERSION`,
      `JUDGE_DISAGREEMENT_REPORT_ARTIFACT_FILENAME`
    - `HUMAN_REVIEW_DECISION_SCHEMA_VERSION`,
      `HUMAN_REVIEW_REVIEWER_KINDS`, `HUMAN_REVIEW_VERDICT_LABELS`,
      `HUMAN_REVIEW_RATIONALE_MAX_CHARS`
- New exported types: `JudgeModelFamily`, `JudgeModelRegion`,
  `JudgeDisagreementDecisionLabel`,
  `JudgeDisagreementEscalationAction`,
  `JudgeDisagreementJudgeEntry`, `JudgeDisagreementMatrixCell`,
  `JudgeDisagreementCostByFamily`, `JudgeDisagreementReport`,
  `HumanReviewReviewerKind`, `HumanReviewVerdictLabel`,
  `HumanReviewDecision`, `JudgeCrossFamilySummary`.
- `AgentModelBinding` gains optional `family` and `region` fields. Both
  default to undefined; existing bindings are unaffected.
- `JudgeConsensusPanelEntry` gains optional `family`, `region`,
  `modelId`, and `promptVersion` markers. The harness fills them when
  the judge is sourced from a known cross-family deployment; consumers
  ignore them when absent.
- `JudgeConsensusVerdict` gains optional `humanReview` and
  `crossFamily` fields. Existing artifacts that omit these continue to
  pass the contract guards.
- `AGENT_HARNESS_ROLES` adds `"human_review"` (alphabetical insertion).
  The new role is a deterministic service with capability
  `"read_artifacts"` and FinOps group `"judge"`; it never calls the
  gateway directly.

Versioning impacts:

- `CONTRACT_VERSION` bumps from `4.50.0` to `4.51.0`.
- `TEST_INTELLIGENCE_CONTRACT_VERSION` bumps from `1.12.0` to `1.13.0`
  to reflect the additive judge-consensus / disagreement-report
  surfaces.

Migration-hash registration: not required. The
`migrationHash:` registry from 4.42.0 carries over unchanged because
this release only adds optional fields, new exports, and a new
deterministic agent role; no error-code rename, field rename, or type
narrowing was introduced.

## [4.50.0] - 2026-05-06

### Changed (Issue #1959 — open `sidecarDeployment` enum + drop `mistral-document-ai-2512` from chat-completion paths)

The visual-sidecar wire surface previously hardcoded a closed set of
deployment-name literals — `llama-4-maverick-vision`,
`phi-4-multimodal-poc`, `mistral-document-ai-2512`, and `mock`. The
closed set was a Welle-2/3 carry-over: when the test-intelligence
contract was first shaped, the live deployments were not yet
finalised, so the four candidates were promoted to the canonical
contract. Wave-0 of the production-hardening epic (PR #1953)
provisioned `phi-4-multimodal-instruct` as the cross-vendor Stable
Visual-Fallback, and #1933 promoted `llama-4-maverick-vision` to
Visual-Primary — but neither operator-supplied id was assignable to
the wire schema. The deployment-name-to-tag mapper at
`src/test-intelligence/visual-sidecar-client.ts` would also fall into
its `default`/`mock` branch for any new id and lose provenance.

Additionally, `mistral-document-ai-2512` was type-blessed as a valid
chat-completion sidecar — it is not. The Document-AI deployment
exposes `chatCompletion: false` on the Azure account; chat-completion
requests return HTTP 404. Operators who copied the value from the
type union into their `.env` ended up in the silent fallback path
documented as a footgun in the operator runbook §1c.

This release broadens the sidecar deployment surface to a brand-typed
`string`. Deployment-name validity is now the responsibility of the
gateway (HTTP 404 surfaces back to the policy gate), not the runner's
wire schema or contract type union.

Public-contract changes:

- New exported type alias `SidecarDeployment = string & { readonly
__brand?: "sidecar_deployment" }` documents the contract surface
  without forcing a public type-import migration on callers that
  pass plain string literals (the historical four literals continue
  to be assignable).
- New exported runtime constant `SIDECAR_DEPLOYMENT_MAX_LENGTH = 128`
  mirrors the wire-validation length cap.
- `VisualSidecarValidationRecord.deployment`,
  `VisualScreenDescription.sidecarDeployment`,
  `VisualSidecarAttempt.deployment`,
  `VisualSidecarSuccess.selectedDeployment`,
  `CompiledPromptVisualBinding.selectedDeployment`,
  `QcMappingVisualProvenance.deployment`,
  `Wave1ValidationEvidenceVisualSidecarSummary.selectedDeployment`,
  `Wave1ValidationAttestationVisualSidecarIdentity.selectedDeployment`,
  and the `modelDeployments.visualPrimary` / `visualFallback` slots
  on the validation/export/attestation manifests broaden from the
  four-literal closed enum (plus `"none"`) to `SidecarDeployment`
  (plus `"none"`).
- Visual-sidecar JSON-Schema validator drops the closed `enum` on
  `sidecarDeployment` in favour of `{ type: "string", minLength: 1,
maxLength: SIDECAR_DEPLOYMENT_MAX_LENGTH }`. Operator-supplied
  deployment names now flow through verbatim and are surfaced as the
  provenance tag in the artefact.
- The mock-client provenance label `"mock"` is preserved for unit
  tests via a new `__isMock: true` sentinel on `MockLlmGatewayClient`
  and a re-exported `isMockLlmGatewayClient` type guard. The
  `clientDeploymentLabel` helper now returns `"mock"` for sentinel
  clients and the verbatim `client.deployment` for everyone else,
  removing the historical four-literal switch.
- The internal `roleFromVisualDeployment` helper in the validation
  harness drops its three deployment-name branches
  (`mistral-document-ai-2512` → primary,
  `phi-4-multimodal-poc`/`llama-4-maverick-vision` → fallback) in
  favour of the existing `isFirstAttempt` orchestration signal.
  The sidecar client always invokes the primary client first and
  the fallback (if any) second, so the index is the actual semantic
  signal and the deployment-name switch was both brittle and
  mis-attributed live calls after the #1933 visual-primary swap.
- The evidence-manifest validator's `VISUAL_DEPLOYMENTS` Set is
  removed; `modelDeployments.visualPrimary` / `visualFallback` /
  `visualSidecar.selectedDeployment` are validated against
  non-empty-string + ≤128-char shape (plus the literal `"none"`
  sentinel for the `modelDeployments` slots).

Documentation:

- `docs/local-runtime.md` row "Primary visual sidecar" updated from
  the deprecated `mistral-document-ai-2512` to the Wave-0 Stable
  substitution `llama-4-maverick-vision`. The fallback row updates
  from the deprecated `phi-4-multimodal-poc` to the cross-vendor
  Stable substitution `phi-4-multimodal-instruct`. This brings the
  local-runtime quick-reference into alignment with operator runbook
  §1b/§1c (already updated by PR #1953).

Contract version bumps:

- `CONTRACT_VERSION` bumps from `4.49.0` to `4.50.0` (additive minor
  bump; the broadened union types are supersets of the previous
  closed enums, so existing callers passing one of the historical
  four literals continue to typecheck without code changes; new
  runtime exports `SIDECAR_DEPLOYMENT_MAX_LENGTH` and the
  `isMockLlmGatewayClient` type guard).
- `TEST_INTELLIGENCE_CONTRACT_VERSION` is unchanged at `1.12.0`
  because no schema-versioned artefact shape changes; only the
  type surface and wire-validation regex broaden.

Out of scope (separate issues):

- Document-AI as an OCR sidecar — Wave-3 candidate. When that lands,
  it will live on a different gateway client and a different role,
  not via the chat-completion path that #1959 removed.
- Deployment-shape regex validation beyond non-empty + length cap —
  the operator runbook is the source of truth for valid names.

No removals of public exports. No new migrations are registered; the
`migrationHash:` registry from 4.42.0 carries over unchanged.

---

## [4.49.0] - 2026-05-06

### Added (Issue #1932 — cross-model logic-judge wired via dedicated deployment env var)

`src/test-intelligence/production-runner.ts` previously routed the
Logic-Judge LLM call through `input.llm.client` — the same gateway
client that produced the test cases. The multi-agent harness lost its
cross-model voting property: a self-consistency bias from the
generator was amplified rather than caught by the judge. Wave 0 of
the test-intelligence production hardening deployed
`mistral-large-3` alongside `gpt-oss-120b`, but the runner had no
seam to dispatch the judge to a different deployment.

The runner now resolves the logic-judge client via:
`input.llm.bundle?.logicJudge ?? input.llm.logicJudge ?? input.llm.client`
so the operator can pin the judge to a different deployment without
touching the generator wiring. When neither slot is populated, the
runner falls back to the generator client and behaviour is identical
to the legacy single-model topology.

Additive public-contract changes:

- `LlmGatewayClientBundle` gains an optional `logicJudge?:
LlmGatewayClient` slot. The slot, when populated, must declare role
  `"logic_judge"` and must NOT advertise image-input support; the
  bundle assert refuses misconfigured clients at construction time.
- `LlmGatewayClientBundleConfigs` and
  `MockLlmGatewayClientBundleInputs` gain a matching optional
  `logicJudge?` field so factory callers compose the slot like any
  other bundle role.
- `ALLOWED_LLM_GATEWAY_ROLES` gains the `"logic_judge"` value (new
  optional gateway role; additive, does not affect existing
  `test_generation` / `visual_primary` / `visual_fallback`
  configurations).
- `ProductionRunnerLlmConfig` gains an optional `logicJudge?:
LlmGatewayClient` field. Use this seam when a cross-model judge is
  required without a full visual-sidecar bundle. `bundle.logicJudge`
  takes precedence when both are set.
- `FinOpsBudgetReport.bySource` entries gain an optional
  `deployment?: string` field. Surfaces the **judge** deployment for
  `judge_primary` / `judge_secondary` when the operator wired a
  cross-model topology so FinOps attribution distinguishes the judge
  family from the generator family. The field is omitted from
  canonical-JSON when no deployment was recorded, so the `bySource`
  hash remains byte-stable for legacy single-model runs.
- `PerSourceCostEntry` mirrors the optional `deployment?` field for
  the per-source cost breakdown helper.
- `recordPerSourceAttempt` accepts an optional `deployment` argument
  used to stamp the per-source accumulator.

CLI changes:

- `workspace-dev test-intelligence run` adds
  `--logic-judge-deployment <name>` (default sourced from the
  `WORKSPACE_TEST_SPACE_LOGIC_JUDGE_DEPLOYMENT` env var; falls back to
  the generator deployment for legacy single-model runs).
- `TestIntelligenceRunOptions` gains a `logicJudgeDeployment?:
string` field; `TestIntelligenceRunRuntime` gains a
  `buildLogicJudgeClient` injection seam that mirrors
  `buildLlmClient`.
- New exported helper `buildLiveLogicJudgeClient` in
  `src/test-intelligence-run-cli.ts` constructs the dedicated
  Azure-bound logic-judge client (returns `undefined` when no
  separate deployment is configured).

Operator runbook update:

- `docs/test-intelligence-operator-runbook.md` gains a "Cross-model
  logic judge" section documenting the
  `mistral-large-3` generator ↔ `gpt-oss-120b` judge recommendation
  and the env-var matrix the operator must configure.

Contract version bumps:

- `CONTRACT_VERSION` bumps from `4.48.0` to `4.49.0` (additive minor
  bump; new optional fields, new runtime exports, no removals).
- `TEST_INTELLIGENCE_CONTRACT_VERSION` bumps from `1.11.0` to
  `1.12.0` because the test-intelligence FinOps wire artifact
  (`bySource[*].deployment`) and gateway role enum
  (`logic_judge`) are extended in this release.

No removals or renames. No new migrations are registered; the
`migrationHash:` registry from 4.42.0 carries over unchanged.

---

## [4.48.0] - 2026-05-06

### Added (Issue #1930 — multimodal token estimator counts image tiles, not base64 bytes)

The shared `estimateLlmInputTokens` heuristic in
`src/test-intelligence/llm-token-estimator.ts` previously charged the raw
base64 string length of every image input against the input-token budget,
divided by `CONTEXT_BUDGET_ESTIMATOR_BYTES_PER_TOKEN = 4`. For a typical
119 KiB / 1280×720 Banking-Form screenshot this estimated ~40 605 input
tokens — exceeding the production default
`visual_primary.maxInputTokensPerRequest = 40_000` before any system or
user prompt bytes — and pre-flight-rejected realistic Visual-Sidecar
requests with `errorClass: input_budget_exceeded`.

The estimator now uses a per-modality strategy. Text bytes still divide
by 4; image inputs use a tile-based formula aligned with provider
billing:

- `openai_tiles` (default): `ceil(widthPx*heightPx / 512^2) * 85 + 85`
  tokens per image — OpenAI Chat-Vision high-detail aligned.
- `llama_tiles`: `ceil(widthPx*heightPx / 560^2) * 1601 + 1` tokens per
  image — Llama-Vision tile encoding (CLS + 1600 patches per tile).
- `raw_bytes`: explicit override that preserves the legacy
  `ceil(base64.length / 4)` rule.

Any image whose pixel dimensions are not supplied falls back to
`raw_bytes` regardless of the requested strategy, preserving back-compat
for callers that have not yet plumbed dimensions through to the
estimator.

Additive public-contract changes:

- `LlmImageInput` gains optional `widthPx?: number` and
  `heightPx?: number` fields. The wire payload is unchanged; the fields
  only inform the estimator.
- `LlmGatewayClientConfig` gains optional
  `imageTokenStrategy?: LlmImageTokenStrategy` (default
  `DEFAULT_LLM_IMAGE_TOKEN_STRATEGY = "openai_tiles"`). The mock and
  real gateway clients honour the field in their `guardInputBudget`
  pre-flight.
- `VisualSidecarCaptureInput` gains optional `widthPx?` / `heightPx?`
  fields. The Figma REST adapter
  (`fetchFigmaScreenCapturesForTestIntelligence`) parses the PNG IHDR
  chunk and propagates decoded dimensions; both the visual sidecar
  client and the faithfulness judge forward them into
  `LlmImageInput`.
- New runtime exports:
  `ALLOWED_LLM_IMAGE_TOKEN_STRATEGIES`,
  `DEFAULT_LLM_IMAGE_TOKEN_STRATEGY`,
  `LLM_IMAGE_OPENAI_TILE_SIZE_PX`,
  `LLM_IMAGE_OPENAI_TOKENS_PER_TILE`,
  `LLM_IMAGE_OPENAI_BASE_TOKENS`,
  `LLM_IMAGE_LLAMA_TILE_SIZE_PX`,
  `LLM_IMAGE_LLAMA_TOKENS_PER_TILE`,
  `LLM_IMAGE_LLAMA_BASE_TOKENS`,
  `estimateImageInputTokens`,
  and the `LlmTokenEstimationOptions` type.
- `estimateLlmInputBytes` now returns the **text-only** payload size
  (system + user + serialised schema). Image inputs are no longer
  summed into this helper — callers that need a token estimate must
  use `estimateLlmInputTokens`. The single internal caller is the
  estimator itself; no other production call site relied on the
  previous image-inclusive behaviour.

Contract version bumps:

- `CONTRACT_VERSION` bumps from `4.47.0` to `4.48.0` (additive minor
  bump; new optional fields, new runtime exports, no removals).
- `TEST_INTELLIGENCE_CONTRACT_VERSION` is unchanged at `1.11.0` (the
  visual-sidecar wire artifacts and gateway request audit shapes are
  unaffected — only optional, in-memory fields on
  `VisualSidecarCaptureInput`/`LlmImageInput`/`LlmGatewayClientConfig`
  are added).

No removals or renames. No FinOps role limit changes — the fix is
purely on the estimator side. No new migrations are registered; the
`migrationHash:` registry from 4.42.0 carries over unchanged.

---

## [4.47.0] - 2026-05-05

### Added (Issue #1901 — coverage hard-gate in the logic judge)

The `eu-banking-default` policy profile gains two optional, additive
threshold rules consumed by the logic-judge coverage hard-gate:

- `TestCasePolicyProfileRules.fieldCoverageRatioMin?: number` — minimum
  job-level field-coverage ratio required by the hard-gate (default
  `0.4`). Below this threshold the judge emits the
  `insufficient_coverage_breadth` finding (severity: `error`) and the
  repair-loop is triggered.
- `TestCasePolicyProfileRules.actionCoverageRatioMin?: number` — minimum
  job-level action-coverage ratio (default `0.5`). Same emission
  semantics.

Both fields are optional for backward compatibility: when omitted the
hard-gate skips the breadth check. Pre-`4.47.0` profiles round-trip
unchanged.

The logic judge (`runLogicJudge`) gains an additive deterministic
post-LLM coverage hard-gate that augments the LLM verdict with four
finding codes — `empty_coverage_signals`, `hallucinated_id`,
`insufficient_coverage_breadth` (all `severity: error`), and
`weak_trace` (`severity: warning`). Error-severity findings upgrade an
LLM `accept` to `repair` so the existing repair-loop (Issue #1900)
drives regeneration. The hard-gate runs deterministically on cache hit
and miss — no extra LLM call, no replay-cache invalidation.

Generator prompt hardening: the user-prompt preamble in
`prompt-compiler.ts` now states that an empty `coveredFieldIds: []` is
a schema violation and that any id outside the IR is rejected. The
existing `[3] TestDesignModel` section already exposes the real IR ids
that the model must cite; the hardened preamble points the generator
at them.

Additive public-contract changes:

- `CONTRACT_VERSION` bumps from `4.46.0` to `4.47.0` (additive minor
  bump; new optional rules fields).
- `TEST_INTELLIGENCE_CONTRACT_VERSION` is unchanged at `1.11.0` (the
  judge verdict and policy-profile wire shapes remain compatible —
  only optional fields and runtime-emitted finding codes are added).

No removals or renames. No new migrations are registered; the
`migrationHash:` registry from 4.42.0 carries over unchanged.

---

## [4.46.0] - 2026-05-05

### Changed (Issue #1898 follow-up — Logic-Judge defaults to ON)

Flips the default for `RunFigmaToQcTestCasesInput.logicJudge` from
opt-in to opt-out. Callers that omit the field (or pass
`logicJudge: { enabled: true }`) now dispatch the second LLM
roundtrip and the harness consumes the real `LogicJudgeVerdict`.
Callers that need the legacy deterministic single-pass behaviour
(unit tests that mock only the generator responder, etc.) must pass
`logicJudge: { enabled: false }` explicitly.

Mock-gateway compatibility: `createMockLlmGatewayClient` now
auto-substitutes a default `accept` verdict envelope when a request
targets the logic-judge structured-output schema and the
user-provided responder returned a result that does not even attempt
the judge surface (no `verdict` field at all). This keeps generator-
only test fixtures green after the default flip without forcing
every test author to thread judge-shape responders. Responders that
DO supply a `verdict` field — including out-of-range literals used
by parser tests — pass through untouched.

Contract surface impact: none. The field already existed at
`4.45.0`; only its default-on/off semantic flipped, which is a
behavioural change rather than a wire-shape change.

Also fixes a pre-existing snapshot drift in
`production-runner-events.test.ts` (the `"cancelled"` event phase
landed in `0db87b9c` without the snapshot update), unblocking the
dev-quality-gate `test:coverage` lane.

- `CONTRACT_VERSION` bumps from `4.45.0` to `4.46.0` (default-flip
  is a contract-observable behaviour change; documented for
  consumers depending on the pre-flip semantics).

This is an additive minor bump. No removals or renames. No
banking-profile migrations are registered in this release; the
`migrationHash:` registry from 4.42.0 carries over unchanged.

---

## [4.45.0] - 2026-05-05

### Added (Issue #1898 / #1899 — production-runner logic judge and cross-modal faithfulness judge)

The production `figma_to_qc_test_cases` runner now has dedicated
contract surface for a second-stage logic judge and a screenshot-based
faithfulness judge. These verdict artifacts are intended for the live
test-intelligence runner path: the generator output can now be judged
against the derived `TestDesignModel` / `CoveragePlan`, and
independently judged against the rendered screenshot batch when the
visual sidecar bundle is enabled.

Additive public-contract changes:

- `TEST_INTELLIGENCE_CONTRACT_VERSION` bumps from `1.10.0` to `1.11.0`.
- `CONTRACT_VERSION` bumps from `4.44.0` to `4.45.0`.
- `migrationHash:` unchanged for this additive surface; no existing
  migration registration entry required.
- New runtime constants exported from `src/contracts/index.ts` and the
  package root:
  - `LOGIC_JUDGE_VERDICT_SCHEMA_VERSION = "1.0.0"`
  - `LOGIC_JUDGE_PROMPT_TEMPLATE_VERSION = "logic-judge.v1"`
  - `LOGIC_JUDGE_COMPILED_PROMPT_ARTIFACT_FILENAME = "compiled-prompt-logic-judge.json"`
  - `LOGIC_JUDGE_VERDICT_ARTIFACT_FILENAME = "logic_judge.json"`
  - `ALLOWED_LOGIC_JUDGE_VERDICTS = ["accept", "repair", "reject"]`
  - `ALLOWED_LOGIC_JUDGE_FINDING_SEVERITIES = ["warning", "error"]`
  - `FAITHFULNESS_VERDICT_SCHEMA_VERSION = "1.0.0"`
  - `FAITHFULNESS_JUDGE_PROMPT_TEMPLATE_VERSION = "faithfulness-judge.v1"`
  - `FAITHFULNESS_JUDGE_COMPILED_PROMPT_ARTIFACT_FILENAME = "compiled-prompt-faithfulness-judge.json"`
  - `FAITHFULNESS_VERDICT_ARTIFACT_FILENAME = "faithfulness_judge.json"`
  - `ALLOWED_FAITHFULNESS_VERDICTS = ["accept", "repair", "reject"]`
- New exported types:
  - `JudgeFinding`, `RepairInstruction`, `JudgeVerdictRefusal`,
    `JudgeVerdict`, `LogicJudgeVerdictLabel`,
    `LogicJudgeFindingSeverity`
  - `HallucinationFinding`, `VisualMismatch`,
    `FaithfulnessVerdictRefusal`, `FaithfulnessVerdict`,
    `FaithfulnessVerdictLabel`

This is an additive minor bump. No existing field or discriminant is
removed or renamed.

---

## [4.44.0] - 2026-05-05

### Added (Issue #1894 — `--custom-context-markdown` CLI flag and production-runner wiring)

The `workspace-dev test-intelligence run` CLI gains a new optional flag,
`--custom-context-markdown <path>`, that loads a UTF-8 Markdown file (max
256 KiB) and forwards the body to the production runner as supporting
evidence. The runner canonicalises the body via the existing
`canonicalizeCustomContextMarkdown` pipeline (PII redaction,
prompt-injection neutralisation, link/HTML/MDX/image refusal) before the
content ever reaches the LLM gateway. The redacted Markdown surfaces in
the compiled prompt as a dedicated `custom_context_markdown` source-mix
section wrapped in `<UNTRUSTED_CUSTOM>` tags, and its content hashes are
sealed into `production-runner-evidence-seal.json` for audit replay.

Operator behaviour:

- File missing, unreadable, or larger than 256 KiB → exit code `1` with
  a clean operator-facing message; no LLM call is dispatched.
- Canonicalisation refusal (oversize after canonicalisation, raw HTML,
  unsafe URL, MDX, Mermaid, frontmatter, etc.) → runner throws
  `ProductionRunnerError` with `failureClass = "CUSTOM_CONTEXT_MARKDOWN_INVALID"`,
  CLI exits `2`.

Additive public-contract changes:

- `RunFigmaToQcTestCasesInput` gains the optional field
  `customContextMarkdown?: string` (Issue #1894). When omitted the runner
  is byte-for-byte equivalent to the legacy single-source pipeline, so
  existing callers see no wire-shape change.
- `TestIntelligenceRunOptions` gains
  `customContextMarkdownPath: string | undefined`.
- `MAX_CUSTOM_CONTEXT_MARKDOWN_FILE_BYTES` is exported from
  `src/test-intelligence-run-cli.ts` so callers can pin the same limit.
- `PRODUCTION_RUNNER_FAILURE_CLASSES` gains the new value
  `"CUSTOM_CONTEXT_MARKDOWN_INVALID"` (failure-class enum bump).
- `ProductionRunnerEvidenceSeal` gains the optional, content-hash-only
  field `customContextMarkdownHashes?: ProductionRunnerEvidenceCustomMarkdownHash[]`.
  The new field is additive — legacy seals with no Markdown context omit
  it entirely, so existing seal verifiers keep working.
- `TEST_INTELLIGENCE_CONTRACT_VERSION` bumps from `1.9.0` to `1.10.0`.
- `CONTRACT_VERSION` bumps from `4.43.0` to `4.44.0`.

This is an additive minor bump. No removals or renames. No new
banking-profile migrations are registered in this release; the
`migrationHash:` registry from 4.42.0 carries over unchanged.

---

## [4.43.0] - 2026-05-04

### Added (Issue #1803 — release-pipeline integration with consolidated release-readiness report)

The release pipeline (`release:quality-gates`) is wired to a single
orchestrator that runs the canonical twelve harness gates as ordered
subprocesses, captures per-gate stdout+stderr to a log file, and
consolidates the verdicts into a canonical-JSON release-readiness report
committed to evidence at
`evidence/release-readiness/release-readiness-report.json`.

Acceptance contract (Issue #1803):

- Single command (`pnpm run release:readiness`) produces the complete
  release-readiness report. `release:quality-gates` runs that orchestrator
  as its terminal step so the consolidated artifact is always produced.
- The report is canonical-JSON (sorted keys via `canonicalJson`, trailing
  newline) and atomically written (tmp + rename) so partial writes never
  become evidence.
- Failures are attributable to the offending gate: each entry carries
  `gateId`, `command`, `status`, `exitCode`, `durationMs`, `logPath`
  (repo-relative), and `attribution[]`. The CI summary prints the failing
  gate's `logPath` so the on-call jumps straight to the offending log.

Additive public-contract changes:

- New runtime constants exported from `src/contracts/index.ts` and the
  package root:
  - `RELEASE_READINESS_REPORT_ARTIFACT_FILENAME = "release-readiness-report.json"`
  - `RELEASE_READINESS_ARTIFACT_DIRECTORY = "evidence/release-readiness"`
  - `RELEASE_READINESS_REPORT_SCHEMA_VERSION = "1.0.0"`
  - `ALLOWED_RELEASE_READINESS_GATE_IDS` — closed, ordered list of the
    twelve canonical gates: `typecheck`, `test`, `test_ti_eval`,
    `test_ti_live_e2e`, `lint_no_telemetry`, `lint_secrets_all`,
    `lint_agent_boundaries`, `lint_ts_style`, `build`,
    `release_ml_bom_emit`, `release_merkle_roundtrip`,
    `release_library_coverage_report`.
  - `ALLOWED_RELEASE_READINESS_GATE_STATUSES = ["passed", "failed", "skipped"]`.
- New contract types: `ReleaseReadinessGateId`,
  `ReleaseReadinessGateStatus`, `ReleaseReadinessGateResult`,
  `ReleaseReadinessReport`.
- New test-intelligence module exports
  (`src/test-intelligence/release-readiness-report.ts` and the
  `test-intelligence` barrel): `buildReleaseReadinessReport`,
  `isReleaseReadinessGateResult`, `isReleaseReadinessReport`,
  `parseReleaseReadinessReport`, `serializeReleaseReadinessReport`,
  `writeReleaseReadinessReport`, `RELEASE_READINESS_GATE_SPECS`, plus
  the `BuildReleaseReadinessReportInput`,
  `ReleaseReadinessGateSpec`,
  `WriteReleaseReadinessReportInput`,
  `WriteReleaseReadinessReportResult` types.
- `TEST_INTELLIGENCE_CONTRACT_VERSION` bumps from `1.8.0` to `1.9.0`.
- `CONTRACT_VERSION` bumps from `4.42.0` to `4.43.0`.

This is an additive minor bump. No removals or renames. No new
banking-profile migrations are registered in this release; the
`migrationHash:` registry from 4.42.0 carries over unchanged.

---

## [4.42.0] - 2026-05-04

### Added (Issue #1802 — evidence + library-coverage + architecture-fit self-test gates)

The `release:quality-gates` evaluator is extended with five additional hard
release gates (Gates 5–9). All gates flow through the same canonical-JSON
report artifact at `artifacts/release-quality-gates/release-quality-gates.json`.

Additive public-contract changes:

- New runtime constants exported from `src/contracts/index.ts` and the
  package root:
  - `ALLOWED_LIBRARY_COVERAGE_RELEASE_STATUSES = ["COVERED", "PARITY-PATH", "NICHT-UEBERNOMMEN"]`
  - `RELEASE_QUALITY_GATES_THRESHOLDS.perSourceCostPlausibility = { allowedFailures: 0 }`
  - `RELEASE_QUALITY_GATES_THRESHOLDS.MEMDIR_MAX_AGE_MS = 7776000000` (90 days)
  - `RELEASE_QUALITY_GATES_THRESHOLDS.contextBudget = { defaultMaxBloatRatio: 1.20, minSampleCount: 5 }`
  - `ALLOWED_RELEASE_QUALITY_GATE_IDS` extended with five new members:
    `"per_source_cost_plausibility"`, `"memdir_manifest_consistency"`,
    `"library_coverage_status_completeness"`, `"architecture_fit_self_test"`,
    `"context_budget_regression"`
- New contract types:
  - `LibraryCoverageReleaseStatus`
  - `ReleaseQualityGatePerSourceCostSample`
  - `ReleaseQualityGateMemdirLesson`
  - `ReleaseQualityGateLibraryCoveragePrimitive`
  - `ReleaseQualityGateArchitectureViolation`
- `ReleaseQualityGatesInput` extended with five new required sections:
  - `perSourceCostPlausibility`
  - `memdirManifestConsistency`
  - `libraryCoverageStatusCompleteness`
  - `architectureFitSelfTest`
  - `contextBudgetRegression`
- `TEST_INTELLIGENCE_CONTRACT_VERSION` bumps from `1.7.0` to `1.8.0`.
- `CONTRACT_VERSION` bumps from `4.41.0` to `4.42.0`.

Gate semantics:

- **Gate 5** (`per_source_cost_plausibility`): Every sample must be sealed
  (`sealed === true`) and have matching `attestedBySourceHash` /
  `observedBySourceHash` (lowercase hex64). A mismatch surfaces
  `bySource_hash_mismatch:<sampleId>` in attribution.
- **Gate 6** (`memdir_manifest_consistency`): Banking-profile lessons must be
  within 90 days of their effective freshness timestamp; path validator must
  have `coveredCases === totalCases >= 1`.
- **Gate 7** (`library_coverage_status_completeness`): Every primitive must
  have a valid `LibraryCoverageReleaseStatus` and a non-empty justification
  (1–480 chars). A `COVERED` entry with `moduleImplemented === false` is
  rejected with `covered_unimplemented` attribution.
- **Gate 8** (`architecture_fit_self_test`): Zero boundary violations across
  scanned files; `scannedFileCount >= 1`. The CLI runner auto-derives this
  from `analyzeAgentBoundaries` — the fixture value is overwritten at runtime.
- **Gate 9** (`context_budget_regression`): `harness.meanInputTokens /
baseline.meanInputTokens <= maxBloatRatio (default 1.20)` OR
  `qualityDeltaScore >= 0.05`. Both sample counts must be `>= 5`.

This is an additive minor bump. No removals or renames. No new
banking-profile migrations are registered in this release; the
`migrationHash:` registry from 4.41.0 carries over unchanged.

## [4.41.0] - 2026-05-04

### Added (Issue #1801 — release:quality-gates hard CI gates)

The `release:quality-gates` script now enforces four hard release gates
that fail the release on threshold breach. Each gate produces a section
of a single canonical-JSON report whose breaches are attributed to the
offending fixture, role, or query source.

Additive public-contract changes:

- New runtime constants exported from `src/contracts/index.ts` and the
  package root:
  - `RELEASE_QUALITY_GATES_REPORT_ARTIFACT_FILENAME = "release-quality-gates.json"`
  - `RELEASE_QUALITY_GATES_REPORT_SCHEMA_VERSION = "1.0.0"`
  - `RELEASE_QUALITY_GATES_THRESHOLDS = { minMutationKillRate: 0.85, minPromptCacheHitRate: 0.7, maxCacheBreakRate: 0.05 }`
  - `ALLOWED_RELEASE_QUALITY_GATE_IDS = ["mutation_kill_rate", "prompt_cache_hit_rate", "tamper_detection_round_trip", "cache_break_rate"]`
- New contract types:
  - `ReleaseQualityGateId`
  - `ReleaseQualityGateMutationFixture`
  - `ReleaseQualityGatePromptCacheRole`
  - `ReleaseQualityGateTamperSample`
  - `ReleaseQualityGateCacheBreakSample`
  - `ReleaseQualityGatesInput`
  - `ReleaseQualityGateVerdict`
  - `ReleaseQualityGatesReport`
- New test-intelligence helpers (re-exported from
  `src/test-intelligence/index.ts`):
  - `evaluateReleaseQualityGates` — pure evaluator.
  - `isReleaseQualityGatesInput` — strict structural validator.
  - `serializeReleaseQualityGatesReport` — canonical-JSON byte payload.
  - `parseReleaseQualityGatesReport` — strict round-trip parser.
  - `writeReleaseQualityGatesReport` — atomic tmp+rename writer.
- `TEST_INTELLIGENCE_CONTRACT_VERSION` bumps from `1.6.0` to `1.7.0`.

The new `verify:release-quality-gates` package script consumes a
canonical-JSON input envelope (default fixture
`fixtures/release-quality-gates/baseline-input.json`) and writes the
report to `artifacts/release-quality-gates/release-quality-gates.json`.
The script exits non-zero on any threshold breach, so the existing
`release:quality-gates` chain fails the release on regression.

This is an additive minor bump. No removals or renames. No new
banking-profile migrations are registered in this release; the
`migrationHash:` registry from 4.40.0 carries over unchanged.

## [4.40.0] - 2026-05-04

### Added (Issue #1798 — settings migration pipeline with signed-bundle enforcement)

The test-intelligence surface now ships a deterministic settings migration
runner for per-run state upgrades, with banking-profile signed-bundle
enforcement and canonical JSONL audit logging.

Additive public-contract changes:

- New runtime constants:
  - `MIGRATIONS_LOG_ARTIFACT_FILENAME = "migrations.log.jsonl"`
  - `MIGRATION_BUNDLE_SCHEMA_VERSION = "1.0.0"`
  - `ALLOWED_MIGRATION_REFUSAL_CODES = ["migration_apply_failed", "migration_audit_log_invalid", "migration_registry_invalid", "migration_rollback_failed", "migration_rollback_required", "migration_state_invalid", "migration_unsigned"]`
- New contract types:
  - `MigrationRefusalCode`
  - `SignedMigrationBundleEntry`
  - `SignedMigrationBundle`
- `ALLOWED_HARNESS_ARTIFACT_FILENAMES` now includes
  `migrations.log.jsonl`, so the harness artifact manifest may hash the
  migration audit log offline without re-running a job.
- New public runtime helpers exported from the package root:
  - `buildMigrationHash`
  - `parseMigrationAuditLog`
  - `runMigrations`

Banking-profile governance for signed migration bundles:

- A banking-profile run must supply a `SignedMigrationBundle` whose
  `entries[]` contain the exact `{id, hash}` pair for every migration that
  would apply. Missing entries refuse with `migration_unsigned`.
- `SignedMigrationBundle.entries[].hash` is governed by the contract process:
  future contract headings that introduce or change banking-profile
  migrations must register each approved hash inline using
  ``migrationHash: `<sha256>` `` entries under the same heading.
- This release introduces the bundle format and enforcement path only; it
  does not ship any pre-registered banking migrations yet.

This is an additive minor bump. Existing callers remain source-compatible
until they opt into `runMigrations`, and existing jobs remain readable
because `migrations.log.jsonl` is optional.

## [4.39.0] - 2026-05-04

### Added (Issue #1795 — canonical-JSON harness job artifacts)

The harness now persists every per-job report listed under Story MA-4
as a canonical-JSON job artifact. All artifacts are atomic-write
(tmp + rename), byte-stable for byte-identical inputs, and
schema-versioned. A sibling `harness-artifact-manifest.json` indexes
every present artifact so the evidence verify route can reproduce
each hash offline without re-running the harness.

Additive public-contract changes (no removals or renames):

- New filename + schema-version constants and persisted artifact
  shapes:
  - `AGENT_ITERATIONS_ARTIFACT_FILENAME`,
    `AGENT_ITERATIONS_SCHEMA_VERSION`, `AgentIterationsArtifact`,
    `AgentIterationRecord`, `ALLOWED_AGENT_ITERATION_OUTCOMES`,
    `AgentIterationOutcome` — consolidated repair-iteration log.
  - `CACHE_BREAK_EVENTS_LOG_ARTIFACT_FILENAME`,
    `CACHE_BREAK_EVENTS_LOG_SCHEMA_VERSION`,
    `CacheBreakEventLogEntry` — consolidated cache-break event log
    (newline-delimited JSON).
  - `COMPACT_BOUNDARY_LOG_ARTIFACT_FILENAME`,
    `COMPACT_BOUNDARY_LOG_SCHEMA_VERSION`,
    `CompactBoundaryLogEntry`,
    `ALLOWED_COMPACT_BOUNDARY_LOG_TIERS`, `CompactBoundaryLogTier`
    — consolidated compaction-boundary log (newline-delimited JSON).
  - `LIBRARY_COVERAGE_REPORT_ARTIFACT_FILENAME`,
    `LIBRARY_COVERAGE_REPORT_SCHEMA_VERSION`,
    `LibraryCoverageReport`, `LibraryPrimitiveCoverageEntry`,
    `LibraryCoverageReportCounts`,
    `ALLOWED_LIBRARY_PRIMITIVE_STATUSES`, `LibraryPrimitiveStatus`
    — per-release primitive-map status report.
  - `HARNESS_ARTIFACT_MANIFEST_ARTIFACT_FILENAME`,
    `HARNESS_ARTIFACT_MANIFEST_SCHEMA_VERSION`,
    `HarnessArtifactManifest`, `HarnessArtifactManifestEntry`,
    `ALLOWED_HARNESS_ARTIFACT_FILENAMES`, `HarnessArtifactFilename`
    — per-job manifest pinning every artifact's
    `{filename, schemaVersion, sha256, sizeBytes}`.

- New writer / validator / verify functions in
  `src/test-intelligence`:
  `writeAgentIterationsArtifact`, `isAgentIterationsArtifact`,
  `writeCacheBreakEventsLog`, `parseCacheBreakEventsLog`,
  `isCacheBreakEventLogEntry`, `writeCompactBoundaryLog`,
  `parseCompactBoundaryLog`, `isCompactBoundaryLogEntry`,
  `writeLibraryCoverageReport`, `isLibraryCoverageReport`,
  `writeHarnessArtifactManifest`, `readHarnessArtifactManifest`,
  `verifyHarnessArtifactManifest`, `isHarnessArtifactManifest`.

- Inspector bundle now surfaces each new artifact in its
  corresponding tab (`agentIterations`, `cacheBreakEventsLog`,
  `compactBoundaryLog`, `libraryCoverageReport`,
  `harnessArtifactManifest`); missing artifacts continue to render
  empty placeholders so existing layouts are unaffected.

This is an additive minor bump. Existing callers and persisted
artifacts remain source-compatible — every new field is optional or
lives on a new artifact, and no existing schema changed shape.

## [4.38.0] - 2026-05-04

### Added (Issue #1794 — banking ICT register enforcement metadata)

The banking-policy surface now exposes and attests ICT register metadata for
active model bindings.

Additive public-contract changes:

- `TestCasePolicyOutcome` adds `ict_register_ref_required` for the banking
  refusal path triggered when an active model binding is missing its operator
  ICT register reference.
- New exported type `ActiveModelBinding` models the runtime binding summary
  persisted into evidence and forwarded into policy evaluation.
- `LlmGatewayClientConfig` adds optional `ictRegisterRef?: string` so operators
  can configure the DORA register-of-information reference per deployment.
- `Wave1PocEvidenceManifest` adds optional `activeModelBindings` so banking
  jobs attest the binding metadata, including `ictRegisterRef` when present.

This is an additive minor bump. Existing callers remain source-compatible, and
existing persisted manifests remain readable because the new fields are
optional.

## [4.37.0] - 2026-05-03

### Added (Issue #1788 — policy-aware gateway in-flight dedup keys)

The contract surface now includes `GatewayInFlightDedupInputs` plus the
optional `LlmGenerationRequest.inFlightDedup` field.

- `GatewayInFlightDedupInputs` carries
  `{promptHash, modelBinding, schemaHash, policyProfileHash, source?}` for
  one request.
- `policyProfileHash` is now an explicit part of the gateway in-flight dedup
  identity so concurrent identical requests from different policy profiles do
  not collapse onto the same Promise.
- `source?` is an optional FinOps attribution label used to credit
  `inFlightDedupHits` in the `bySource` report when a caller joins an existing
  in-flight request.

## [4.36.0] - 2026-05-03

### Added (Issue #1784 — gateway-side idempotency keys, HMAC + TTL)

The contract surface now includes the `GatewayIdempotencyKey` envelope and
the `GatewayIdempotencyInputs` shape consumed by the multi-agent harness's
gateway-side idempotency cache (Story MA-3 #1758).

- `GATEWAY_IDEMPOTENCY_KEY_SCHEMA_VERSION = "1.0.0"` is the new pinned
  schema literal; bumping it requires a major contract bump.
- `GatewayIdempotencyInputs` carries the per-attempt fields the harness
  hashes to derive the key:
  `{jobId, roleStepId, attempt, promptVersion, schemaHash, inputHash}`.
- `GatewayIdempotencyKey` is the persisted envelope that pairs those
  inputs with the HMAC-SHA256 hex digest. The HMAC secret itself is
  operator-configured and never persisted to artifacts or logs.
- `LlmGenerationRequest` gains an additive optional field
  `idempotency?: GatewayIdempotencyInputs`. When set AND the runtime is
  wired with `idempotencyCache`, the gateway looks up the cache before
  dispatch and returns the previously-completed structured success on
  a hit without making a second LLM call. Cache hits count as
  `gateway_idempotent_replay` in FinOps, distinct from `replay_cache_hit`.

This is an additive minor bump. Existing callers that omit the
`idempotency` field and the `idempotencyCache` runtime continue to
behave as before — the gateway dispatches every call.

## [4.35.0] - 2026-05-03

### Added (Issue #1783 — deterministic IR mutation oracle report)

The contract surface now includes `IrMutationCoverageStrengthReport`, the
machine-readable artifact shape emitted by the deterministic
`ir-mutation-oracle.ts` companion to the LLM-based Adversarial Gap Finder.

The report carries:

- `schemaVersion = "1.0.0"` and the originating `jobId`
- aggregate mutation counters: `mutationCount`, `killedMutations`,
  `mutationKillRate`
- `perMutation[]` rows containing the stable `mutationId`, closed
  `mutationKind` literal
  (`flip_required`, `shrink_boundary`, `drop_state_transition`,
  `swap_equivalence_class`, `invert_decision_rule`), sorted
  `affectedSourceRefs`, and sorted `killedByTestCaseIds`
- `survivingMutationsForRepair`, the sorted list of mutation ids that the
  repair planner should treat as coverage findings

This is an additive minor bump. Existing serialized artifacts remain valid and
the new report is opt-in for callers that run the deterministic oracle.

## [4.34.0] - 2026-05-03

### Added (Issue #1782 — Agent_02 Judge Panel (PoLL) verdict artifact)

The test-intelligence contract surface now ships the Panel-of-LLM-
Judges (PoLL) verdict shape that the multi-agent harness (Story MA-3,
parent #1758) writes for every `semantic_judge` step:
`<runDir>/judge-panel-verdicts.json`.

The new exports cover the full Trust-or-Escalate routing surface:

- `JUDGE_PANEL_VERDICT_SCHEMA_VERSION = "1.0.0"` and
  `JUDGE_PANEL_VERDICTS_ARTIFACT_FILENAME = "judge-panel-verdicts.json"`
  pin the on-disk schema and filename.
- `JUDGE_PANEL_JUDGE_IDS = ["judge_primary", "judge_secondary"]`
  closes the panel to two cross-family judges
  (`gpt-oss-120b` × `phi-4-multimodal-poc` per
  `AGENT_ROLE_PROFILE_REGISTRY`).
- `JUDGE_PANEL_PER_JUDGE_VERDICTS = ["fail", "pass", "uncertain"]`
  closes the per-judge verdict literal.
- `JUDGE_PANEL_AGREEMENT_LABELS = ["both_fail", "both_pass", "disagree"]`
  closes the panel-level agreement label.
- `JUDGE_PANEL_RESOLVED_SEVERITIES = ["critical", "downgraded_disagreement", "major", "minor"]`
  is the closed severity vocabulary the router emits;
  `downgraded_disagreement` is the AT-022-mandated label for
  cross-judge disagreement.
- `JUDGE_PANEL_ESCALATION_ROUTES = ["accept", "downgrade", "needs_review"]`
  closes the routing decision.
- `JUDGE_PANEL_REASON_MAX_CHARS = 240` enforces the per-judge reason
  length cap from the issue spec.

`JudgePanelVerdict` and `JudgePanelPerJudgeVerdictRecord` carry the
shape consumed by the harness: per-judge raw + post-hoc-calibrated
scores (CalibraEval-style empirical-CDF mapping per judge), the
derived per-judge verdict, the panel agreement, the resolved
severity, and the routing decision. Per-judge entries are sorted
alphabetically by `judgeId`; the persisted artifact is sorted by
`(testCaseId, criterion)` so calling the panel builder twice with
byte-identical inputs returns byte-identical canonical JSON.

The runtime module ships in `src/test-intelligence/semantic-judge-panel.ts`
and is re-exported through `src/test-intelligence/index.ts`. It does
not extend the public API (`src/index.ts`) surface; consumers that
need the panel import it from the test-intelligence subpath, mirroring
the `AGENT_HARNESS_*` / `AGENT_TEAM_*` contracts shipped in 4.32.0–4.33.0.

### Disagreement routing (AT-022)

A panel agreement of `disagree` always maps to
`resolvedSeverity = "downgraded_disagreement"` and
`escalationRoute ∈ {downgrade, needs_review}` (operator-selectable
via `JudgePanelPolicy`; default `downgrade`). Both-pass and both-fail
remain deterministic — `both_pass` ⇒ `accept` / `minor`, `both_fail`
⇒ `needs_review` / `critical`.

### Bias controls

- Calibration is the empirical CDF of raw scores observed in the
  same run, per judge. Monotonic, distribution-aware, no naive
  shuffling.
- No length normalisation (verbosity-bias inversion 2025).
- Reasons are length-capped to `JUDGE_PANEL_REASON_MAX_CHARS` and
  refuse `LF`, `CR`, `U+2028`, and `U+2029` to prevent line-ending
  smuggling into evidence.
- The artifact carries no chain-of-thought, no raw prompts, no
  screenshots, no model logits — `assertJudgePanelVerdictInvariants`
  refuses verdicts whose `agreement` does not match the per-judge
  verdicts or whose routing violates the AT-022 mapping.

## [4.33.0] - 2026-05-03

### Added (Issue #1781 — Execution graph and team artifacts)

The test-intelligence contract surface now ships an
`AgentHarnessExecutionGraph` and the two team-level rollup artifacts
the multi-agent harness (Story MA-3, parent #1758) writes per job:
`<runDir>/agent-team-config.json` and
`<runDir>/agent-team-results.json`.

The execution graph is a small canonical-JSON-stable adjacency-list
DAG. It is *not* a workflow framework — there is no scheduler, no
trigger, no conditional. Each node carries `roleStepId`, `role`,
sorted `blocks` / `blockedBy` edges, sorted `requiredInputArtifacts`
and `producedArtifacts`, and a closed `retryPolicy` literal. The
builder canonicalises edge / artifact lists, asserts the mirror
invariant `a.blocks ⇔ b.blockedBy`, asserts acyclicity, and computes
`graphHash = sha256(canonicalJson(nodes))`. Calling the builder
twice with byte-identical inputs returns graphs whose canonical-JSON
representations are byte-identical, so the graph hash is suitable
for evidence anchoring and gateway idempotency keys.

Resume contract: `computeAgentHarnessResumePlan(graph, completed)`
partitions the graph into `skip` / `runnable` / `blocked` buckets
given the set of `roleStepId`s already accepted on a previous run
(read from per-step checkpoint artifacts under
`<runDir>/agent-role-runs/`). Already-completed steps are skipped;
nodes whose `blockedBy` set is fully covered become runnable.

Team artifacts are hash-only by construction — both interfaces carry
a literal `rawPromptsIncluded: false` field that documents the
contract and is asserted by tests:

- `AgentTeamConfigArtifact` pins the active profile registry
  (sorted alphabetically by role), the graph hash, and the
  operator's `policyProfileHash` (sha256 of the canonical-JSON of
  the active policy profile). Used by the gateway to scope
  idempotency and in-flight dedup keys.
- `AgentTeamResultsArtifact` rolls up per-step harness rollups
  (only their hashes, terminal outcomes, error classes, attempt
  counts, and cost rollups) into a single anchor with a unioned
  `totalCost`. No raw prompts, no chain-of-thought, no model
  output bytes, no secrets are ever surfaced.

Both writers use the temp-file + `rename` pattern already in use by
the per-step rollup writer, so a crash never leaves a half-written
file behind.

`TEST_INTELLIGENCE_CONTRACT_VERSION` is unchanged at `1.6.0` — the
new graph and team artifacts are additive and do not change any
existing test-intelligence artifact schema. Per the precedent set
by Issues #1767 / #1774 / #1778 / #1779, additive test-intelligence
surface bumps the top-level `CONTRACT_VERSION` only.

New public exports (additive only):

- Constants:
  `AGENT_HARNESS_EXECUTION_GRAPH_SCHEMA_VERSION` (`"1.0.0"`),
  `AGENT_HARNESS_GRAPH_RETRY_POLICIES` (`["none",
"retry_from_checkpoint", "retry_transient_once"]`),
  `AGENT_TEAM_CONFIG_SCHEMA_VERSION` (`"1.0.0"`),
  `AGENT_TEAM_CONFIG_ARTIFACT_FILENAME`
  (`"agent-team-config.json"`),
  `AGENT_TEAM_RESULTS_SCHEMA_VERSION` (`"1.0.0"`),
  `AGENT_TEAM_RESULTS_ARTIFACT_FILENAME`
  (`"agent-team-results.json"`),
  `ALLOWED_AGENT_TEAM_OUTCOMES`.
- Types: `AgentHarnessExecutionGraph`, `AgentHarnessGraphNode`,
  `AgentHarnessGraphRetryPolicy`, `AgentTeamOutcome`,
  `AgentTeamConfigArtifact`, `AgentTeamResultsArtifact`,
  `AgentTeamRoleRunSummary`, `AgentTeamTotalCost`.

The accompanying `test-intelligence/agent-harness-execution-graph.ts`
module (re-exported via `src/test-intelligence/index.ts`) ships the
builders, validators, resume planner, and atomic writers:

- `buildAgentHarnessExecutionGraph(input)` — normalises edges and
  artifact lists, validates the DAG, computes `graphHash`.
- `assertAgentHarnessExecutionGraphInvariants(graph)` — boundary
  validator the Production Runner runs on resume.
- `serializeAgentHarnessExecutionGraph(graph)` — canonical-JSON
  serialiser with trailing newline.
- `computeAgentHarnessResumePlan(graph, completed)` — partitions
  into skip/runnable/blocked buckets.
- `buildAgentTeamConfigArtifact(input)` /
  `writeAgentTeamConfigArtifact(input)` — frozen builder + atomic
  writer.
- `buildAgentTeamResultsArtifact(input)` /
  `writeAgentTeamResultsArtifact(input)` — frozen builder + atomic
  writer.

This is an additive minor bump — existing serialised artifacts
remain valid because no field, type, or refusal code is removed or
renamed.

## [4.32.0] - 2026-05-03

### Added (Issue #1779 — Static `AgentRoleProfile` matrix with capability filters)

The test-intelligence contract surface now ships a static, hand-rolled
`AgentRoleProfile` registry that pins every multi-agent harness role
(Story MA-3, parent #1758) to a deterministic budget tier, capability
filter, output schema, FinOps attribution group, and (for LLM roles)
prompt-template version + model binding.

Profiles are deeply frozen at module load and serialise to canonical
JSON, so they round-trip cleanly into evidence anchors. There is no
runtime configuration surface — adding or mutating a role requires a
contract bump and a `CONTRACT_CHANGELOG.md` entry.

Capability invariant: no profile with `roleKind === "llm_role"` may
declare `capability === "propose_changes"`. Filesystem, gateway, and
review-store mutations remain reserved for deterministic services
gated by `RepairChangeGuard`. The invariant is enforced both at
registry construction (`assertAgentRoleProfileInvariants` throws) and
by `agent-role-profile.test.ts` as a boundary self-test.

`AgentModelBinding` carries the optional `ictRegisterRef?: string`
slot defined by Wave MA-4; the field is accepted today but only
becomes mandatory once the banking-policy gate ships in MA-4.

`TEST_INTELLIGENCE_CONTRACT_VERSION` is unchanged at `1.6.0` — the
new registry is additive and does not change any existing
test-intelligence artifact schema. Per the precedent set by
Issues #1767 / #1774 / #1778, additive test-intelligence surface bumps the
top-level `CONTRACT_VERSION` only.

New public exports (additive only):

- Constants: `AGENT_ROLE_PROFILE_SCHEMA_VERSION` (`"1.0.0"`),
  `AGENT_HARNESS_ROLES`, `AGENT_ROLE_CAPABILITIES`,
  `AGENT_ROLE_KINDS`, `AGENT_ROLE_FINOPS_GROUPS`,
  `AGENT_ROLE_MAX_ATTEMPT_VALUES`.
- Types: `AgentHarnessRole`, `AgentRoleCapability`, `AgentRoleKind`,
  `AgentRoleFinOpsGroup`, `AgentModelBinding`, `AgentRoleProfile`.

The accompanying `test-intelligence/agent-role-profile.ts` module
(re-exported via `src/test-intelligence/index.ts`) ships the
registry and helpers:

- `AGENT_ROLE_PROFILE_REGISTRY` — frozen
  `Record<AgentHarnessRole, AgentRoleProfile>`.
- `getAgentRoleProfile(role)` — exhaustive accessor.
- `listAgentRoleProfiles()` — alphabetical, canonical-JSON-stable order.
- `serializeAgentRoleProfile(profile)` — canonical-JSON serialiser.
- `assertAgentRoleProfileInvariants(profile)` — boundary validator
  re-used by the self-test.
- `LLM_ROLE_FORBIDDEN_CAPABILITIES` — the closed set referenced by
  the boundary lint.
- Type guards: `isAgentHarnessRole`, `isAgentRoleCapability`,
  `isAgentRoleKind`, `isAgentRoleFinOpsGroup`.

This release also reconciles the public-export snapshot in
`contract-version.test.ts` with the actual surface: prior additive
merges (issues #1364/#1365/#1386 context-budget + coverage-planner
artifacts, #1769 agent-role-run + genealogy artifacts, #1775 agent
source labels, branded-id helpers) had landed as runtime exports
without being added to the snapshot. The snapshot now matches the
runtime surface byte-for-byte; no exports are renamed or removed.

This is an additive minor bump — existing serialised artifacts
remain valid because no field, type, or refusal code is removed or
renamed.

## [4.31.0] - 2026-05-03

### Added (Issue #1778 — CacheBreakDetector with intent suppression and redacted diffs)

The test-intelligence contract surface now includes a two-phase
cache-break detector that wraps the LLM gateway. Between consecutive
iterations of the same `querySource`, the detector compares the
observed `cacheReadTokens` / `cacheCreationTokens` against the
previously recorded baseline; when
`cacheReadTokens < 0.05 * expected` AND
`cacheCreationTokens > 2_000` it emits a structured `cache_break`
event onto the `RunnerEventBus` and writes a canonical-JSON diff
artifact to `<runDir>/observability/cache-breaks/<ts>.diff.json`.

Diff dumps run through `normalizeUntrustedContent` +
`redactHighRiskSecrets` before persistence — a poisoned tool result
that broke the cache must never be persisted raw.

Each `cache_break` event carries the current Merkle `parentHash` so
it remains part of the chain.

`PRODUCTION_RUNNER_EVENT_PHASES` adds the new `"cache_break"` phase
literal. Adding a union member to a closed exported set is a minor
bump per the rules at the top of this file.

`TEST_INTELLIGENCE_CONTRACT_VERSION` is unchanged at `1.6.0` — the new
detector is additive and does not change any existing
test-intelligence artifact schema. Per the precedent set by
Issues #1767 / #1774, additive test-intelligence surface bumps the top-level
`CONTRACT_VERSION` only.

New public exports (additive only):

- `createCacheBreakDetector` — factory. Returns an object exposing
  `recordPromptState`, `checkResponseForCacheBreak`,
  `notifyCompaction`, `notifyCacheDeletion`.
- Types: `CacheBreakDetector`, `CacheBreakSnapshot`,
  `RecordPromptStateInput`, `RecordPromptStateResult`,
  `CheckResponseForCacheBreakInput`, `CacheBreakCheckOutcome`,
  `CacheBreakPromptMessage`, `CreateCacheBreakDetectorOptions`,
  `CacheBreakSuppressionReason`.
- Constants: `CACHE_BREAK_ARTIFACT_DIRECTORY`
  (`"observability/cache-breaks"`),
  `CACHE_BREAK_DIFF_SCHEMA_VERSION` (`"1.0.0"`),
  `CACHE_BREAK_READ_RATIO_THRESHOLD` (`0.05`),
  `CACHE_BREAK_MIN_CREATION_TOKENS` (`2_000`),
  `CACHE_BREAK_DETECTOR_MAX_SNAPSHOTS` (`10`),
  `ALLOWED_CACHE_BREAK_SUPPRESSION_REASONS`.
- Phase: `"cache_break"` added to `PRODUCTION_RUNNER_EVENT_PHASES`.

Suppression APIs flag the next break for a `jobId` as intentional so
it produces neither an event nor an artifact; suppression is one-shot
and consumed by the next `checkResponseForCacheBreak` for the same
`jobId`. State is an LRU `Map<querySource, Snapshot>` capped at 10
entries.

This is an additive minor bump — existing serialised artifacts
remain valid because no field, type, or refusal code is removed or
renamed.

## [4.30.0] - 2026-05-03

### Added (Issue #1774 — UntrustedContentNormalizer for 2025-vintage injection carriers)

The test-intelligence contract surface now includes a new pre-LLM
normalization pass that strips 2025-vintage prompt-injection carriers
from untrusted content before the prompt compiler runs. The carriers
covered are: hidden Figma layers (`visible=false`), zero-opacity
layers, off-canvas layers (bounding box outside the parent screen),
zero font-size layers, sentinel layer names (anything starting with
`__`, including `__system` and `__instructions`), zero-width Unicode
in source text (U+200B / U+200C / U+200D / U+FEFF), and Atlassian
Document Format (ADF) nodes outside the existing `parseJiraAdfDocument`
allow-list. A hard per-element byte cap (Jira-comment baseline) is
applied to every untrusted text span. Findings from the existing
`detectPii` and `redactHighRiskSecrets` detectors plus a pinned
Markdown prompt-injection regex set are integrated into the drop
counts.

`TEST_INTELLIGENCE_CONTRACT_VERSION` is unchanged at `1.6.0` — the new
normalization is additive and does not change any existing
test-intelligence artifact schema. Per the precedent set by
Issue #1767 (`[4.28.0]`), additive test-intelligence surface bumps the
top-level `CONTRACT_VERSION` only.

New public exports (additive only):

- `normalizeUntrustedContent` — pure function over an
  `UntrustedContentNormalizerInput` describing optional Figma /
  Jira-ADF / Markdown / generic-text-field payloads. Returns sanitised
  payloads + an `UntrustedContentNormalizationReport`.
- `writeUntrustedContentNormalizationReport` — persists the canonical
  drop-count report to
  `<runDir>/untrusted-content-normalization-report.json`. Counts
  only — never raw stripped content.
- `UNTRUSTED_CONTENT_NORMALIZATION_REPORT_ARTIFACT_FILENAME`,
  `UNTRUSTED_CONTENT_NORMALIZATION_REPORT_SCHEMA_VERSION` (`"1.0.0"`),
  `MAX_UNTRUSTED_CONTENT_ELEMENT_BYTES` (`4_096`),
  `MAX_UNTRUSTED_CONTENT_MARKDOWN_BYTES` (`32_768`),
  `ALLOWED_UNTRUSTED_CONTENT_CARRIER_KINDS`,
  `ALLOWED_UNTRUSTED_CONTENT_SEVERITIES`,
  `ALLOWED_UNTRUSTED_CONTENT_OUTCOMES`.
- Types: `UntrustedContentNormalizerInput`,
  `UntrustedContentDropCounts`,
  `UntrustedContentNeedsReviewReason`,
  `UntrustedContentNormalizationReport`,
  `UntrustedContentNormalizationOutput`,
  `UntrustedContentCarrierKind`, `UntrustedContentSeverity`,
  `UntrustedContentNormalizationOutcome`.

Sentinel-name hits (severity `critical`) flip the report `outcome`
to `needs_review`; secret matches and Markdown injection-pattern
hits do the same. The banking profile pins this normalization as
enforced — there is no opt-out.

This is an additive minor bump — existing serialised artifacts
remain valid because no field, type, or refusal code is removed or
renamed.

## [4.29.0] - 2026-05-03

### Changed (Issue #1756 — visual sidecar deployment correction)

All deployment-name union types across the visual sidecar contract surface now
include `"mistral-document-ai-2512"` as a recognized deployment literal.
Previously the unions only covered `"llama-4-maverick-vision"`,
`"phi-4-multimodal-poc"`, and `"mock"`. The production environment changed
primary/fallback roles:

- **Primary**: `mistral-document-ai-2512`
  (`WORKSPACE_TEST_SPACE_VISUAL_PRIMARY_DEPLOYMENT`)
- **Fallback**: `llama-4-maverick-vision`
  (`WORKSPACE_TEST_SPACE_VISUAL_FALLBACK_DEPLOYMENT`)

Affected interfaces: `VisualScreenDescription`, `VisualSidecarAttempt`,
`VisualSidecarSuccess`, `CompiledPromptVisualBinding`,
`VisualSidecarValidationRecord`, `QcMappingVisualProvenance`,
`Wave1PocEvidenceVisualSidecarSummary`,
`Wave1PocAttestationVisualSidecarIdentity`,
`ExportReportArtifact.modelDeployments`,
`Wave1PocEvidenceManifest.modelDeployments`,
`Wave1PocAttestationPredicateBody.modelDeployments`,
`TraceabilityVisualObservation`.

`VISUAL_SIDECAR_SCHEMA_VERSION` bumps `1.0.0` → `1.1.0` because the JSON
schema used to validate LLM responses now accepts the new literal; existing
replay-cache entries keyed by the old schema hash will miss and be re-emitted.

The `roleFromVisualDeployment` FinOps heuristic in `poc-harness.ts` is updated
to treat `mistral-document-ai-2512` as `visual_primary` and
`llama-4-maverick-vision` as `visual_fallback`.

This is an additive minor bump — existing serialized artifacts with
`"llama-4-maverick-vision"` or `"phi-4-multimodal-poc"` remain valid.

## [4.28.0] - 2026-05-03

### Added (Issue #1767)

The test-intelligence contract surface now includes a deterministic
pre-generation coverage-planning artifact for Wave MA-1. This is additive
only: it does not change `GeneratedTestCase`, `coverage-report.json`, the
prompt compiler cache key, or existing production-runner behavior.

New public exports:

- `COVERAGE_PLAN_SCHEMA_VERSION` — schema version stamp for
  `coverage-plan.json`.
- `COVERAGE_PLAN_ARTIFACT_FILENAME` — canonical artifact filename
  (`"coverage-plan.json"`).
- `DEFAULT_MUTATION_KILL_RATE_TARGET` — default mutation objective (`0.85`)
  used when callers do not supply an override.
- `ALLOWED_COVERAGE_PLAN_TECHNIQUES` and `CoveragePlanTechnique` —
  deterministic planner technique enum:
  `initial_state`, `equivalence_partitioning`, `boundary_value`,
  `decision_table`, `state_transition`, `pairwise`, `error_guessing`.
- `ALLOWED_COVERAGE_REQUIREMENT_REASON_CODES` and
  `CoverageRequirementReasonCode` — machine-readable reason codes explaining
  why each requirement exists.
- `CoverageRequirement` — stable requirement rows carrying
  `requirementId`, `technique`, `reasonCode`, optional `screenId`,
  `targetIds`, `sourceRefs`, and `visualRefs`.
- `CoveragePlan` — additive deterministic plan shape containing
  `minimumCases`, `recommendedCases`, ordered `techniques`, and
  `mutationKillRateTarget`.

This is a minor contract bump because it adds new exported constants and
types. Existing consumers remain source- and runtime-compatible unless they
choose to adopt the new artifact.

## [4.27.0] - 2026-05-02

### Added (Issue #1735 — banking/insurance prompt polish)

`GeneratedTestCase` gains an optional `regulatoryRelevance` field
surfaced via two new runtime exports:

- `ALLOWED_REGULATORY_RELEVANCE_DOMAINS` — frozen `["banking",
"insurance", "general"]` enum and matching `RegulatoryRelevanceDomain`
  union type.
- `BANKING_INSURANCE_SEMANTIC_KEYWORDS` — readonly tuple of German
  banking/insurance flow keywords (`Versicherung`, `Police`,
  `Schadensfall`, `Risikoprüfung`, `Bonität`, `Antrag`, `Abschluss`,
  `Auszahlung`, `Kündigung`) used by the production runner to detect
  regulated screens.
- `RegulatoryRelevance` interface = `{ domain, rationale }`.

Driven by the customer-demo brief: when the policy profile is
`eu-banking-default` (the production-runner default), the runner
augments the LLM user prompt with banking/insurance compliance
expectations — positive+negative cases per relevant input, PII / IBAN /
BIC / Vertragsnummer rejection + masking, four-eyes + audit-trail for
state-changing actions, boundary tests on amount/currency, and exactly
one regulatory-compliance case for screens whose name matches a
`BANKING_INSURANCE_SEMANTIC_KEYWORDS` entry. Generic compliance language
only — the prompt forbids citing specific regulatory paragraphs.

The new field is optional at the TypeScript / runtime level — code
that constructs a `GeneratedTestCase` without `regulatoryRelevance`
still type-checks and validates. However,
`GENERATED_TEST_CASE_SCHEMA_VERSION` bumps `1.0.0` → `1.1.0` in
lockstep because the JSON-schema hash drifted with the new optional
property; lists stamped under the prior schema version will be
rejected by the validator (which pins `schemaVersion` via `const`),
and replay-cache entries keyed by the schema hash will miss. In both
cases the producer must re-emit the artifact under the new schema
version. This is the same shape of change as the prior schema-hash
bump in Issue #1676.

`LLM_GATEWAY_CONTRACT_VERSION` and `TEST_INTELLIGENCE_CONTRACT_VERSION`
are unchanged because the LLM gateway wire shape and the
test-intelligence client surface are otherwise untouched; the
schema-internal bump is tracked at the top-level `CONTRACT_VERSION`
per the precedent established in 4.7.0 / 4.26.0.

## [4.26.0] - 2026-05-02

### Added (Issue #1733 customer-demo follow-up)

`LlmGatewayClientConfig` gains an optional `wireStructuredOutputMode`
field with three values surfaced via the new
`ALLOWED_LLM_GATEWAY_WIRE_STRUCTURED_OUTPUT_MODES` runtime list and
`LlmGatewayWireStructuredOutputMode` type:

- `"json_schema"` (default) — preserves existing behaviour: emit
  `response_format: { type: "json_schema", json_schema: {...} }` when
  the client declares `structuredOutputs: true` and the request
  carries a schema.
- `"json_object"` — emit `response_format: { type: "json_object" }`.
  Schema is still validated in-process.
- `"none"` — omit `response_format` entirely. Schema is still
  validated in-process from JSON parsed out of the free-form
  `content` field.

Driven by a 2026-05-02 customer-demo finding: Azure AI Foundry's
`gpt-oss-120b` deployment on the `openai/v1` path returns empty
`message.content` for ANY `response_format` value (probed with both
`json_schema` and `json_object`; both yielded `content: ""` after
~2 completion tokens). With no `response_format`, the same deployment
produces clean parseable JSON when the prompt instructs it to. The
new field gives operators a per-deployment escape hatch without
weakening the in-process structured-output guarantee surfaced to
callers.

`LLM_GATEWAY_CONTRACT_VERSION` remains `1.0.0` because the persisted
gateway evidence-artifact shape is unchanged; this is a client-surface
addition tracked by the top-level `CONTRACT_VERSION`, per the
precedent established in 4.7.0.

The default value is `"json_schema"`, so all existing client
configurations continue to behave exactly as before.

## [4.25.0] - 2026-05-02

### Added (Issue #1668, audit-2026-05)

The `PiiKind` union is extended with five new GDPR Art. 5(1)(c) /
Art. 9 categories the May 2026 audit identified as previously
unrecognized by the central `detectPii` detector:

- `postal_address` — DE / AT / CH / NL / FR / IT / GB shapes
- `date_of_birth` — labelled (DOB / Geburtsdatum / etc.)
- `account_number` — labelled (account / Kontonummer / etc.)
- `national_id` — Swiss AHV, Swedish personnummer, ES NIE/DNI,
  DE Personalausweis (labelled)
- `special_category`— Art. 9 keyword block (health, political, union,
  religion, race, sexual orientation)

Adding union members is a minor bump per `CONTRACT_CHANGELOG.md`'s
versioning rules. Consumers reading the IR may receive previously-
unseen `kind` values; downstream redaction tokens are pre-defined.

The detectors are hand-rolled (no runtime deps per repo policy), run
after the existing PII detectors so labelled / structurally-recognized
data (IBAN, PAN, tax_id) is classified by its primary detector first.
The `special_category` kind reports lower confidence (0.6) than the
others because it is keyword-anchored — reviewers should treat it as a
flag for attention rather than a deterministic redaction signal.

## [4.24.0] - 2026-05-02

### Changed (Issue #1676, #1704 Wave 1)

The internal LLM-gateway response schema names emitted on outbound
structured-output calls have been renormalised to comply with Azure OpenAI's
`response_format.json_schema.name` grammar (`^[a-zA-Z0-9_-]{1,64}$`).
Previously the names embedded dots (`.`), which Azure rejects with HTTP 422
`Invalid input — Json schema name was ... but must be a-z, A-Z, 0-9, or
contain underscores and dashes`, breaking every live #1359 priority-feature
end-to-end run against the configured Azure deployment.

**Renames (internal — no public-export surface change):**

- `VISUAL_SIDECAR_RESPONSE_SCHEMA_NAME`
  - before: `workspace-dev.test-intelligence.visual-sidecar.v1`
  - after: `workspace-dev-visual-sidecar-v1`
- `GENERATED_TEST_CASE_LIST_SCHEMA_NAME` (template):
  - before: `workspace-dev.test-intelligence.generated-test-case-list.v${V}`
  - after: `workspace-dev-generated-test-case-list-v${V}`
- `llm-capability-probe.ts` probe `responseSchemaName`:
  - before: `workspace-dev.test-intelligence.capability-probe.v1`
  - after: `workspace-dev-capability-probe-v1`

The constant identifiers and JSON Schema `$id` fields are unchanged from a
TypeScript-export perspective; only the runtime string values change. A
structural lint (Issue #1678) is added in the same wave to prevent
re-introduction.

`TEST_INTELLIGENCE_CONTRACT_VERSION` bumps `1.5.0` → `1.6.0` to surface the
runtime-string change to downstream replay-cache implementations that key on
the schema name.

---

## [4.23.0] - 2026-04-29

### Added (Issue #1555)

WorkspaceDev now defines the deterministic quality-passport contract and
canonical writer primitive used by the default-pipeline enterprise evidence
story. This adds the public schema constants and type surface for
`quality-passport.json` without changing runtime job projection or Inspector
behavior; runtime emission is owned by Issue #1556.

**Evidence contract:**

- `PIPELINE_QUALITY_PASSPORT_SCHEMA_VERSION` — version stamp for the
  persisted passport schema.
- `PIPELINE_QUALITY_PASSPORT_ARTIFACT_FILENAME` — canonical
  `quality-passport.json` artifact name.
- `WorkspacePipelineQualityPassport` — secret-free deterministic report shape
  covering pipeline identity, template bundle, build profile, scope,
  generated-file rows, validation status, token coverage, semantic coverage,
  warnings, and caller-provided metadata projection.
- Supporting quality-passport types for generated files, coverage metrics,
  validation status, validation summary, warnings, and scope projection.

---

## [4.22.0] - 2026-04-29

### Changed (Issue #1553)

Pipeline compatibility guards now fail closed when Rocket-specific inputs are
submitted to the OSS `default` pipeline or when regeneration attempts to change
pipeline identity. The combined `default,rocket` profile still preserves the
legacy omitted-`pipelineId` Rocket auto-selection path, but explicit
`pipelineId: "default"` plus customer profile, brand, or component mapping
inputs is rejected with a structured pipeline request error.

**Validation behavior:**

- `WorkspacePipelineRequestErrorCode` adds `PIPELINE_INPUT_UNSUPPORTED`.
- Submit and regeneration pipeline compatibility failures return structured
  `400` responses with top-level `error`, `message`, `pipelineId`, and
  `issues: [{ path: "pipelineId", message }]` fields.
- `WorkspaceRegenerationInput.pipelineId` is accepted only as a compatibility
  assertion. It must match the completed source job pipeline; cross-pipeline
  regeneration is rejected until an explicit migration path exists.

---

## [4.21.0] - 2026-04-28

### Changed (Issue #1539)

Contract-version evidence now reflects the completed pipeline selection and
runtime-metadata public contract slice from Issues #1537 and #1538. This bump
updates the canonical `CONTRACT_VERSION`, compatibility matrix, committed API
reference, and contract-version process checks without changing the canonical
stage order or introducing additional runtime behavior.

**Evidence updated:**

- `CONTRACT_VERSION` — bumped from `4.20.0` to `4.21.0`.
- `COMPATIBILITY.md` — current contract matrix updated to `4.21.0`.
- `docs/api` — regenerated committed API reference for the updated runtime
  constant.
- `src/contract-version.test.ts` and `src/docs-alignment.test.ts` — existing
  gates continue to require a changelog heading for the current runtime
  contract and a compatibility-matrix entry matching `CONTRACT_VERSION`.

## [4.20.0] - 2026-04-28

### Added (Issue #1538)

Pipeline runtime metadata now follows the selected pipeline through execution
contexts, persisted job records, terminal snapshots, public projections,
regeneration lineage, and retry lineage. This is additive for wire consumers and
keeps the canonical stage order unchanged.

**New types:**

- `WorkspaceJobPipelineMetadata` — selected pipeline id, display name, template
  bundle id, active build profile, and deterministic execution guarantee.

**Extended types (additive fields only):**

- `WorkspaceSubmitAccepted.pipelineMetadata`
- `WorkspaceJobRequestMetadata.pipelineMetadata`
- `WorkspaceJobStatus.pipelineMetadata`
- `WorkspaceJobResult.pipelineMetadata`
- `WorkspaceJobInspector.pipelineMetadata`
- `WorkspaceRegenerationAccepted.pipelineMetadata`
- `WorkspaceRetryAccepted.pipelineMetadata`
- `WorkspaceJobLineage.pipelineMetadata`

Legacy terminal snapshots that predate this field continue to rehydrate with the
existing `rocket` compatibility pipeline metadata.

## [4.19.0] - 2026-04-28

### Added (Issue #1537)

Pipeline identity projection across public job lifecycle contracts. Additive for
wire consumers; accepted submissions already returned the selected pipeline, and
this release extends the same audit field to polling, result, Inspector,
regeneration, and retry payloads.

**Extended types (additive fields only):**

- `WorkspaceJobStatus.pipelineId` — selected pipeline surfaced at the top level
  of job polling payloads.
- `WorkspaceJobResult.pipelineId` — selected pipeline surfaced on compact
  terminal result payloads.
- `WorkspaceJobInspector.pipelineId` — selected pipeline surfaced on
  Inspector-facing recovery metadata.
- `WorkspaceRegenerationAccepted.pipelineId` — inherited source-job pipeline
  echoed on regeneration acceptance.
- `WorkspaceRetryAccepted.pipelineId` — inherited source-job pipeline echoed on
  retry acceptance.

**Validation behavior:**

- Submit-time pipeline selection errors now include a structured
  `issues: [{ path: "pipelineId", message }]` array while preserving their
  existing top-level pipeline error codes.

---

## [4.18.0] - 2026-04-28

### Added (Issue #1535)

Pipeline descriptor manifest metadata for conformance and runtime inspection.
The runtime now includes additive pipeline descriptor fields that identify the
registered pipeline visibility, deterministic execution guarantee, and template
bundle stack.

**New types:**

- `WorkspacePipelineVisibility` — pipeline visibility class: `oss`,
  `customer`, or `internal`.
- `WorkspacePipelineStackDescriptor` — public framework, language, styling, and
  bundler identity for a pipeline template.
- `WorkspacePipelineTemplateMetadata` — public template bundle id, path, and
  stack identity for a pipeline.

**Extended types (additive fields only):**

- `WorkspacePipelineDescriptor.visibility`
- `WorkspacePipelineDescriptor.deterministic`
- `WorkspacePipelineDescriptor.template`

---

## [4.17.0] - 2026-04-28

### Added (Issue #1534)

Pipeline registry foundation for deterministic pipeline selection. Purely
additive for existing callers; submissions without `pipelineId` continue to use
the single available compatibility pipeline in the current build profile.

**New constants:**

- `ALLOWED_PIPELINE_REQUEST_ERROR_CODES` — four structured submit-time pipeline
  request error codes.

**New types:**

- `WorkspacePipelineId` — pipeline identifier string.
- `WorkspacePipelineScope` — resolved input scope: `board`, `node`, or
  `selection`.
- `WorkspacePipelineRequestErrorCode` — union of structured pipeline request
  error codes.
- `WorkspacePipelineDescriptor` — runtime descriptor for pipelines included in
  the current package profile.

**Extended types (additive fields only):**

- `WorkspaceJobInput.pipelineId` — optional explicit pipeline selector.
- `WorkspaceStatus.availablePipelines` and `WorkspaceStatus.defaultPipelineId`
  — runtime pipeline availability metadata.
- `WorkspaceSubmitAccepted.pipelineId` — selected pipeline echoed on accepted
  submissions.
- `WorkspaceJobRequestMetadata.pipelineId` — selected pipeline persisted on job
  request metadata.

---

## [4.16.0] - 2026-04-27

### Added (Issue #1482, Wave 5)

Jira write workflow — approved test cases written back to Jira as sub-tasks. Purely additive.

**New constants:**

- `JIRA_WRITE_REPORT_SCHEMA_VERSION` — schema version "1.0.0" for the Jira write report artifact.
- `JIRA_WRITE_REPORT_ARTIFACT_FILENAME` — artifact filename "jira-write-report.json".
- `JIRA_WRITE_REPORT_ARTIFACT_DIRECTORY` — sub-directory "jira-write" under the run dir.
- `JIRA_CREATED_SUBTASKS_SCHEMA_VERSION` — schema version "1.0.0" for the created-subtasks artifact.
- `JIRA_CREATED_SUBTASKS_ARTIFACT_FILENAME` — artifact filename "jira-created-subtasks.json".
- `ALLOWED_JIRA_WRITE_MODE_VALUES` — `["jira_subtasks"]` discriminant array.
- `ALLOWED_JIRA_WRITE_REFUSAL_CODES` — 8 structured refusal codes for the Jira write pipeline.
- `ALLOWED_JIRA_WRITE_ENTITY_OUTCOMES` — 4 per-case outcome strings.
- `ALLOWED_JIRA_WRITE_FAILURE_CLASSES` — 8 failure class strings.

**New types:**

- `JiraWriteMode` — discriminated union of write mode strings.
- `JiraWriteRefusalCode` — union of refusal code strings.
- `JiraWriteEntityOutcome` — union of per-case outcome strings.
- `JiraWriteFailureClass` — union of failure class strings.
- `JiraSubTaskRecord` — per-case sub-task outcome record.
- `JiraCreatedSubtasksArtifact` — artifact type for jira-created-subtasks.json.
- `JiraWriteAuditMetadata` — audit metadata embedded in the write report.
- `JiraWriteReportArtifact` — artifact type for jira-write-report.json.

**Extended types (additive fields only):**

- `WorkspaceStartOptions.testIntelligence` — optional `allowJiraWrite?: boolean` and `jiraWriteBearerToken?: string`.

**TEST_INTELLIGENCE_CONTRACT_VERSION bump:** `1.4.0` → `1.5.0`

## [4.15.0] - 2026-04-27

### Added (Issue #1441, Wave 4.K)

Source-mix orchestration and Jira-only generation path. Purely additive —
all existing consumers are unaffected.

**New constants:**

- `SOURCE_MIX_PLAN_SCHEMA_VERSION` — schema version "1.0.0" for the source-mix plan artifact.
- `SOURCE_MIX_PLAN_ARTIFACT_FILENAME` — artifact filename "source-mix-plan.json".
- `ALLOWED_TEST_INTENT_SOURCE_MIX_KINDS` — 7 supported source-mix kind identifiers.
- `ALLOWED_SOURCE_MIX_PLANNER_REFUSAL_CODES` — 8 structured refusal codes for the source-mix planner.

**New types:**

- `TestIntentSourceMixKind` — discriminated union of 7 source-mix kind strings.
- `SourceMixPlanPromptSection` — role-tagged prompt section emitted by the planner.
- `SourceMixPlanSourceDigest` — hash-only source fingerprint material sealed into emitted source-mix plans.
- `SourceMixPlan` — deterministic plan with `sourceMixPlanHash`, `visualSidecarRequirement`, and hard `false` privacy invariants.
- `SourceMixPlannerRefusalCode` — union of planner refusal code strings.
- `SourceMixPlannerIssue` — structured issue record returned on refusal.
- `SourceMixPlannerResult` — discriminated union `{ ok: true; plan } | { ok: false; issues }`.

**Extended types (additive fields only):**

- `SourceMixPlan` — added optional `sourceDigests` so planner-emitted plans seal source content hashes, canonical Jira issue keys, and redacted Markdown/plain-text derivative hashes into `sourceMixPlanHash` without persisting raw Jira responses, paste bytes, or editor input.
- `ReplayCacheKey` — added optional `sourceMixPlanHash` to match the runtime replay key emitted for multi-source jobs.
- `CompiledPromptArtifacts.payload` — added optional `sourceMixPlan` so persisted prompt artifacts can explain which source-mix path compiled the prompt.

**New `ALLOWED_TEST_INTENT_SOURCE_KINDS` member:** `"custom_markdown"` (intrinsically-Markdown supporting source; requires `redactedMarkdownHash` + `plainTextDerivativeHash`; forbids `inputFormat`).

**New `SUPPORTING_TEST_INTENT_SOURCE_KINDS` member:** `"custom_markdown"`.

**`TEST_INTELLIGENCE_CONTRACT_VERSION` bumped:** `1.3.0` → `1.4.0`.

---

## [4.14.0] - 2026-04-27

### Added (Issue #1439, Wave 4.I)

Multi-source production-readiness fixtures, CI eval gate, FinOps source
quotas, and extended evidence manifest. Purely additive — all existing
consumers are unaffected.

**New constants:**

- `MAX_JIRA_API_REQUESTS_PER_JOB` — hard cap on Jira REST calls per job (20).
- `MAX_JIRA_PASTE_BYTES_PER_JOB` — hard cap on paste ingest size (524 288 B).
- `MAX_CUSTOM_CONTEXT_BYTES_PER_JOB` — hard cap on custom-context size (262 144 B).
- `WAVE4_PRODUCTION_READINESS_EVAL_REPORT_ARTIFACT_FILENAME` — artifact filename for the Wave 4.I CI eval report.
- `WAVE4_PRODUCTION_READINESS_EVAL_REPORT_SCHEMA_VERSION` — schema version "1.0.0" for the eval report.

**New types:**

- `Wave4SourceMixId` — discriminated union of all supported source-mix identifiers.
- `Wave4ProductionReadinessEvalThresholds` — pass/fail threshold configuration for the CI eval gate.
- `Wave4SourceMixCoverageEntry` — per-fixture coverage record within the eval report.
- `MultiSourceSourceProvenanceRecord` — per-source provenance record for the evidence manifest.
- `Wave4ProductionReadinessEvalReport` — top-level eval report artifact type.

**Extended types (additive fields only):**

- `FinOpsBudgetEnvelope` — added `sourceQuotas?` block (`maxJiraApiRequestsPerJob`, `maxJiraPasteBytesPerJob`, `maxCustomContextBytesPerJob`).
- `FinOpsRoleBudget` — added `maxIngestBytesPerJob?: number`.
- `FinOpsRoleUsage` — added `ingestBytes: number`.
- `Wave1PocEvidenceManifest` — added `sourceProvenanceRecords?`, `multiSourceEnabled?`, `rawJiraResponsePersisted?`, `rawPasteBytesPersisted?`.
- `Wave1PocEvidenceArtifactCategory` — added `"jira_issue_ir"`, `"jira_paste_provenance"`, `"custom_context_ir"`, `"multi_source_reconciliation"`.

**New `ALLOWED_FINOPS_ROLES` members:** `"jira_api_requests"`, `"jira_paste_ingest"`, `"custom_context_ingest"`.

**New `ALLOWED_FINOPS_BUDGET_BREACH_REASONS` members:** `"jira_api_request_quota_exceeded"`, `"jira_paste_quota_exceeded"`, `"custom_context_quota_exceeded"`.

**`TEST_INTELLIGENCE_CONTRACT_VERSION` bumped:** `1.2.0` → `1.3.0`.

---

## [4.13.0] - 2026-04-26

### Added (Issue #1432, Wave 4.B)

Jira issue intermediate representation, hand-rolled Atlassian Document
Format (ADF) parser, and Jira-specific PII detection / redaction
extensions. Purely additive — existing single-source Figma jobs and
Wave 4.A multi-source consumers are unchanged.

- `TEST_INTELLIGENCE_CONTRACT_VERSION` bumped from `1.1.0` to `1.2.0`.
- New schema constant `JIRA_ISSUE_IR_SCHEMA_VERSION = "1.0.0"`.
- New artifact constants `JIRA_ISSUE_IR_ARTIFACT_DIRECTORY = "sources"` and
  `JIRA_ISSUE_IR_ARTIFACT_FILENAME = "jira-issue-ir.json"`. The Jira IR is
  persisted at `<runDir>/sources/<sourceId>/jira-issue-ir.json` per
  contributing source.
- New byte-cap constants: `MAX_JIRA_ADF_INPUT_BYTES = 1 MiB` (pre-parse
  hard cap on raw ADF JSON), `MAX_JIRA_DESCRIPTION_PLAIN_BYTES = 32 KiB`,
  `MAX_JIRA_COMMENT_BODY_BYTES = 4 KiB`, `MAX_JIRA_CUSTOM_FIELD_VALUE_BYTES = 2 KiB`.
- New count-cap constants: `MAX_JIRA_COMMENT_COUNT = 50`,
  `MAX_JIRA_ATTACHMENT_COUNT = 50`, `MAX_JIRA_LINK_COUNT = 50`,
  `MAX_JIRA_CUSTOM_FIELD_COUNT = 50`.
- New runtime enums:
  - `ALLOWED_JIRA_ISSUE_TYPES` (`story|task|bug|epic|subtask|other`).
  - `ALLOWED_JIRA_ADF_NODE_TYPES` (24 allow-listed ADF node types).
  - `ALLOWED_JIRA_ADF_MARK_TYPES` (8 allow-listed ADF mark types).
  - `ALLOWED_JIRA_ADF_REJECTION_CODES` (11 codes including
    `jira_adf_payload_too_large`, `jira_adf_unknown_node_type`).
  - `ALLOWED_JIRA_IR_REFUSAL_CODES` (19 codes including
    `jira_issue_key_invalid`, `jira_jql_fragment_disallowed_token`,
    `jira_field_unknown_excluded`).
- New types: `JiraIssueIr`, `JiraAcceptanceCriterion`, `JiraComment`,
  `JiraAttachmentRef`, `JiraLinkRef`, `JiraIssueIrCustomField`,
  `JiraFieldSelectionProfile`, `JiraIssueIrDataMinimization`,
  `JiraAdfNodeType`, `JiraAdfMarkType`, `JiraAdfRejectionCode`,
  `JiraIrRefusalCode`, `JiraIssueType`.
- New value-typed `DEFAULT_JIRA_FIELD_SELECTION_PROFILE` — comments,
  attachments, linked issues, and unknown custom fields are excluded by
  default. Inclusion of each opt-in group is recorded in the IR's
  `dataMinimization` audit metadata.
- `PiiKind` extended (additive) with `internal_hostname`, `jira_mention`,
  `customer_name_placeholder`. `PiiMatchLocation` extended with
  Jira-specific locations (`jira_summary`, `jira_description`,
  `jira_acceptance_criterion`, `jira_comment_body`,
  `jira_custom_field_name`, `jira_custom_field_value`,
  `jira_attachment_filename`, `jira_link_relationship`, `jira_label`,
  `jira_component`).
- New module `src/test-intelligence/jira-adf-parser.ts` —
  `parseJiraAdfDocument` (pure, fail-closed, allow-list-only). Strips
  `mention` / `inlineCard` / `media` / `mediaSingle` / `mediaGroup` to
  text-only stubs (`@user`, `[link]`, `[attachment:filename.ext]`).
  Bounds traversal depth (32) and node count (5_000). Byte-stable across
  runs.
- New module `src/test-intelligence/jira-issue-ir.ts` — `buildJiraIssueIr`
  (pure builder), `writeJiraIssueIr` (atomic temp-rename persistence),
  `isValidJiraIssueKey`, `sanitizeJqlFragment` (rejects `;`, backticks,
  `--`, control characters, `OR 1=1` / `AND 1=1` hijack patterns,
  oversize keys).
- New PII-detection helpers: `detectCustomerNameInLabelledField`,
  `isCustomerNameShapedFieldName`. The Jira-specific detectors fire on
  internal-hostname-like strings (`*.intranet.*`, `*.corp.*`,
  `*.internal`, `*.local`, `*.lan`, `*.atlassian.net`, `*.jira.com`),
  Confluence/Jira `[~accountid:...]` markup + bare account ids, and
  customer-name-shaped placeholders inside well-known customer-name Jira
  custom-field labels.
- Zero new runtime dependencies. No telemetry. No fetch. The parser and
  the IR builder are both pure value-object code.

## [4.12.0] - 2026-04-26

### Added (Issue #1431, Wave 4.A)

Wave 4 multi-source Test Intent ingestion contracts, feature gate, and
mode-lock isolation. Purely additive — single-source Figma jobs that have
not opted into the multi-source gate keep producing bit-identical artifacts
and replay-cache hits.

- New env var `TEST_INTELLIGENCE_MULTISOURCE_ENV` (literal
  `FIGMAPIPE_WORKSPACE_TEST_INTELLIGENCE_MULTISOURCE`) gating Wave 4
  multi-source ingestion. Strictly nested behind `TEST_INTELLIGENCE_ENV`:
  the gate fails closed unless *both* env vars and the parent
  `WorkspaceStartOptions.testIntelligence.enabled` startup option are set.
- New optional startup option
  `WorkspaceStartOptions.testIntelligence.multiSourceEnabled?: boolean`
  (default `false`). Provides operator runtime toggle without redeploys.
- New optional status field
  `WorkspaceStatus.testIntelligenceMultiSourceEnabled?: boolean`. True only
  when all three nested gates are satisfied.
- `TEST_INTELLIGENCE_CONTRACT_VERSION` bumped `1.0.0` → `1.1.0`.
- New schema-version constant
  `MULTI_SOURCE_TEST_INTENT_ENVELOPE_SCHEMA_VERSION = "1.0.0"`.
- New runtime enums:
  - `ALLOWED_TEST_INTENT_SOURCE_KINDS` — `figma_local_json`,
    `figma_plugin`, `figma_rest`, `jira_rest`, `jira_paste`, `custom_text`,
    `custom_structured`. Type alias `TestIntentSourceKind`.
  - `PRIMARY_TEST_INTENT_SOURCE_KINDS` — the five kinds (Figma trio plus
    `jira_rest`, `jira_paste`) at least one of which must be present in
    every envelope. Type alias `PrimaryTestIntentSourceKind`.
  - `SUPPORTING_TEST_INTENT_SOURCE_KINDS` — `custom_text`,
    `custom_structured`. Type alias `SupportingTestIntentSourceKind`.
  - `ALLOWED_CONFLICT_RESOLUTION_POLICIES` — `priority`,
    `reviewer_decides`, `keep_both`. Type alias `ConflictResolutionPolicy`.
  - `ALLOWED_TEST_INTENT_CUSTOM_INPUT_FORMATS` — `plain_text`, `markdown`,
    `structured_json`. Type alias `TestIntentCustomInputFormat`.
  - `ALLOWED_MULTI_SOURCE_ENVELOPE_REFUSAL_CODES` — 26 stable refusal
    codes covering envelope shape, source-mix, conflict policy, priority
    order, Markdown hash, Jira issue-key, source-mix-plan, and
    aggregate-hash mismatch checks.
  - `ALLOWED_MULTI_SOURCE_MODE_GATE_REFUSAL_CODES` — four stable refusal
    codes for the runtime mode gate (parent gate, env, startup option,
    `llmCodegenMode` lock).
- New types:
  - `TestIntentSourceRef` (`sourceId`, `kind`, `contentHash`, `capturedAt`,
    optional `authorHandle`, `inputFormat`, `noteEntryId`,
    `markdownSectionPath`, `canonicalIssueKey`, `redactedMarkdownHash`,
    `plainTextDerivativeHash`).
  - `MultiSourceTestIntentEnvelope` (`version`, `sources`,
    `aggregateContentHash`, `conflictResolutionPolicy`, optional
    `priorityOrder`, `sourceMixPlan`).
  - `MultiSourceTestIntentSourceMixPlanRef` (`ownerIssue`, `planHash`) as the
    #1441-owned source-mix orchestration hook.
  - `MultiSourceEnvelopeIssue`, `MultiSourceEnvelopeRefusalCode`,
    `MultiSourceEnvelopeValidationResult`.
  - `MultiSourceModeGateInput`, `MultiSourceModeGateRefusal`,
    `MultiSourceModeGateRefusalCode`, `MultiSourceModeGateDecision`.
- New optional `BusinessTestIntentIr.sourceEnvelope?: MultiSourceTestIntentEnvelope`.
  Legacy `source: BusinessTestIntentIrSource`
  is preserved for one minor cycle.
- Per-element provenance types extended additively with
  `sourceRefs?: TestIntentSourceRef[]` on `IntentTraceRef`, `DetectedField`,
  `DetectedAction`, `DetectedValidation`, `DetectedNavigation`, and
  `InferredBusinessObject`. Existing single-source fields (`trace`,
  `provenance`) keep working unchanged for legacy single-source jobs.
- New module `src/test-intelligence/multi-source-envelope.ts` with
  hand-rolled validators (zero new runtime deps). Public exports:
  `buildMultiSourceTestIntentEnvelope`, `computeAggregateContentHash`,
  `validateMultiSourceTestIntentEnvelope`, `evaluateMultiSourceModeGate`,
  `enforceMultiSourceModeGate`, `MultiSourceModeGateError`,
  `legacySourceFromMultiSourceEnvelope`,
  `resolveTestIntelligenceMultiSourceEnvEnabled`,
  `canonicalizeMultiSourceEnvelope`, `isPrimaryTestIntentSourceKind`,
  `isSupportingTestIntentSourceKind`, `isMultiSourceEnvelopeRefusalCode`,
  `isMultiSourceModeGateRefusalCode`.
- New env-var resolver `resolveTestIntelligenceMultiSourceEnvEnabled` in
  `src/server/constants.ts` mirroring the existing test-intelligence
  resolver.

### Source-mix contract hardening (2026-04-26 addendum)

The validator enforces the customer-facing source matrix explicitly:

- At least one primary source per envelope. A custom-only envelope is
  rejected with `primary_source_required` before any artifact is persisted.
- Figma is optional. Jira-REST-only and Jira-paste-only envelopes are valid
  when the multi-source gate is enabled.
- Jira REST and Jira paste may both appear in one envelope; duplicate
  canonical issue keys route through `duplicate_jira_paste_collision` rather than
  silently deduplicating.
- Optional `sourceMixPlan` references are shape-validated only; #1441 owns
  orchestration and reconciliation.
- The `priority` policy requires a `priorityOrder` covering exactly the
  kinds present in the envelope (no extras, no duplicates, no missing).

### Markdown-aware custom source contract (2026-04-26 addendum)

`custom_text` / `custom_structured` sources may carry
`inputFormat: "markdown"` and (only then) `markdownSectionPath` /
`noteEntryId` provenance hints. Markdown sources must also carry
`redactedMarkdownHash` and `plainTextDerivativeHash` so downstream prompt
isolation can audit canonical redacted Markdown and the deterministic
plain-text derivative without storing raw Markdown. Markdown is treated as
user-provided supporting evidence and is never trusted as instructions to the
model or runtime — downstream issues are responsible for the prompt-isolation
plumbing.

### Production-ready baseline (2026-04-26 addendum)

This issue ships as production-ready enterprise software for regulated
financial deployment: hand-rolled validators, fail-closed gates, zero
runtime deps, no telemetry, and full byte-stable backward compatibility.

---

## [4.11.0] - 2026-04-26

### Added (Issue #1374)

Wave 3 stabilizes the provider-neutral QC/ALM adapter surface so non-ALM
providers and caller-registered custom adapters plug in without coupling the
core test-intelligence pipeline to OpenText ALM.

- New runtime enum `ALLOWED_QC_PROVIDER_OPERATIONS` with members
  `validate_profile`, `resolve_target_folder`, `dry_run`, `export_only`,
  `api_transfer`, `register_custom`. Type alias `QcProviderOperation`.
  Re-exported from the package root.
- New types `QcProviderCapabilities` (closed product type, six boolean
  flags mirroring `QcProviderOperation`) and `QcProviderDescriptor`
  (`provider`, `label`, `version`, `builtin`, `capabilities`,
  `mappingProfileSeedId?`).
- New refusal-code literal `provider_not_implemented` appended to the end
  of `ALLOWED_DRY_RUN_REFUSAL_CODES`. Existing ordinal positions of prior
  codes are preserved byte-for-byte.
- New optional fields on `DryRunPlannedEntityPayload` exposing normalized
  visual provenance per the 2026-04-24 multimodal addendum:
  `visualConfidence?: number` (mean sidecar confidence, rounded to four
  decimals), `visualAmbiguityFlags?: VisualSidecarValidationOutcome[]`
  (sorted, deduplicated non-`ok` outcomes), `visualFallbackUsed?: boolean`
  (true when a matching record carries `fallback_used`), and
  `visualEvidenceRefs?: { screenId; modelDeployment; evidenceHash }[]`
  (sorted by `screenId`, `modelDeployment`, then `evidenceHash`;
  `evidenceHash` is the canonical
  `(screenId|deployment|sortedOutcomes|roundedConfidence)` SHA-256, never
  a screenshot-byte hash). All four keys are absent — not `undefined` —
  on payloads without sidecar coverage and on stub-adapter output, so
  pre-#1374 byte-stable artifacts remain byte-stable.
- New module `src/test-intelligence/qc-provider-registry.ts` shipping
  `BUILTIN_QC_PROVIDER_DESCRIPTORS` (frozen, sorted by provider id),
  `createQcProviderRegistry`, `registerQcProviderAdapter`,
  `resolveQcProviderAdapter`, `getQcProviderDescriptor`,
  `getQcProviderEntry`, `listQcProviderDescriptors`, plus the structured
  refusal enum `ALLOWED_QC_PROVIDER_REGISTRATION_REFUSAL_CODES` (members:
  `duplicate_provider_id`, `custom_descriptor_required`,
  `unknown_provider_id`, `provider_mismatch_on_adapter`,
  `register_custom_not_supported`).
  Eight builtin descriptors are wired up: `opentext_alm` exposes the full
  matrix and binds the existing `openTextAlmDryRunAdapter`; the six
  non-ALM providers (`opentext_octane`, `opentext_valueedge`, `xray`,
  `testrail`, `azure_devops_test_plans`, `qtest`) advertise
  `validateProfile` + `dryRun` only and bind the dry-run-only stub; the
  reserved `custom` slot publishes every flag `false` until a caller
  registers a concrete adapter and descriptor via
  `registerQcProviderAdapter`. Registry snapshots expose only read
  operations and clone entries on read so caller mutation cannot bypass
  registration checks.
- New module `src/test-intelligence/qc-provider-stub.ts` shipping
  `createDryRunStubAdapter`, `DEFAULT_DRY_RUN_STUB_ID_SOURCE`, and
  `DRY_RUN_STUB_ADAPTER_VERSION = "1.0.0"`. The stub honors the
  `QcAdapter` interface, refuses every dry-run with the new
  `provider_not_implemented` code, throws
  `QcAdapterModeNotImplementedError` for non-`dry_run` modes, performs no
  I/O, and emits a deterministic `reportId` so replay/evidence pipelines
  remain byte-stable.
- Existing `openTextAlmDryRunAdapter` populates the four new visual
  provenance fields on every planned payload whose case has matching
  sidecar records. Cases without matching records continue to emit the
  prior shape unchanged (no extra keys).

### Backward compatibility

- All public exports retain prior names and signatures. New types,
  enum members, and fields are additive only.
- `provider_not_implemented` is appended to the end of
  `ALLOWED_DRY_RUN_REFUSAL_CODES`; pre-#1374 ordinals are stable.
- ALM dry-run reports for cases without sidecar coverage are byte-stable
  with 4.10.0 output; the new visual provenance fields are omitted (not
  set to `undefined`).

## [4.10.0] - 2026-04-26

### Added (Issue #1373 follow-up)

- `TEST_CASE_DELTA_REPORT_ARTIFACT_FILENAME = "test-case-delta-report.json"`
  is now exported from the public contract surface alongside the other Wave 3
  artifact filenames.
- `TraceabilityMatrixRow.steps` records ordered per-step traceability rows.
  Each row carries inherited Figma screen/node metadata, matching QC design-step
  index when available, visual-sidecar observations, and the validation/policy
  outcomes that governed the parent test case.
- The persisted export pipeline now emits `dedupe-report.json` and
  `traceability-matrix.json` for successful export runs so duplicate evidence
  and export-only traceability are produced by the normal workflow, not only by
  manually composing helper functions.
- The controlled OpenText ALM API transfer pipeline accepts optional
  traceability lineage inputs and persists a transfer-aware
  `traceability-matrix.json` beside `transfer-report.json` when those inputs and
  an artifact root are supplied.
- `DedupeExternalProbeState` now includes `partial_failure` for runs where an
  external duplicate probe produced at least one usable lookup but one or more
  case lookups failed. This keeps partial external coverage fail-closed while
  preserving sanitized findings for operator evidence.

## [4.9.0] - 2026-04-26

### Added (Issue #1373)

- New schema constants for the Wave 3 delta + dedupe + traceability surface:
  - `INTENT_DELTA_REPORT_SCHEMA_VERSION = "1.0.0"`,
  - `INTENT_DELTA_REPORT_ARTIFACT_FILENAME = "intent-delta-report.json"`,
  - `TEST_CASE_DELTA_REPORT_SCHEMA_VERSION = "1.0.0"`,
  - `DEDUPE_REPORT_SCHEMA_VERSION = "1.0.0"`,
  - `DEDUPE_REPORT_ARTIFACT_FILENAME = "dedupe-report.json"`,
  - `TRACEABILITY_MATRIX_SCHEMA_VERSION = "1.0.0"`,
  - `TRACEABILITY_MATRIX_ARTIFACT_FILENAME = "traceability-matrix.json"`.
- New enums (additive):
  - `ALLOWED_INTENT_DELTA_KINDS` / `IntentDeltaKind`: `screen`, `field`,
    `action`, `validation`, `navigation`, `visual_screen`.
  - `ALLOWED_INTENT_DELTA_CHANGE_TYPES` / `IntentDeltaChangeType`: `added`,
    `removed`, `changed`, `confidence_dropped`, `ambiguity_increased`.
  - `ALLOWED_TEST_CASE_DELTA_VERDICTS` / `TestCaseDeltaVerdict`: `new`,
    `unchanged`, `changed`, `obsolete`, `requires_review`.
  - `ALLOWED_TEST_CASE_DELTA_REASONS` / `TestCaseDeltaReason`:
    `absent_in_current`, `absent_in_prior`, `fingerprint_changed`,
    `trace_screen_changed`, `trace_screen_removed`,
    `visual_ambiguity_increased`, `visual_confidence_dropped`,
    `reconciliation_conflict`.
  - `ALLOWED_DEDUPE_SIMILARITY_SOURCES` / `DedupeSimilaritySource`:
    `lexical`, `embedding`, `external_lookup`.
  - `ALLOWED_DEDUPE_EXTERNAL_PROBE_STATES` / `DedupeExternalProbeState`:
    `disabled`, `unconfigured`, `executed`.
- New artifact types (additive):
  - `IntentDeltaReport` + `IntentDeltaEntry` + `TestCaseDeltaReport` +
    `TestCaseDeltaRow` carrying type-level invariants
    `rawScreenshotsIncluded: false`, `secretsIncluded: false`.
  - `TestCaseDedupeReport` + `DedupeInternalFinding` +
    `DedupeExternalFinding` + `DedupeCaseVerdict` carrying the same
    type-level invariants.
  - `TraceabilityMatrix` + `TraceabilityMatrixRow` +
    `TraceabilityVisualObservation` + `TraceabilityReconciliationDecision`
    carrying the same type-level invariants.
- Extended `Wave1PocEvidenceArtifactCategory` union (additive) with three
  new literal categories: `intent_delta`, `dedupe_report`,
  `traceability_matrix`. Existing manifests continue to validate.
- New public modules under `src/test-intelligence/`:
  - `intent-delta.ts` exporting `computeIntentDelta`,
    `writeIntentDeltaReport`, `INTENT_DELTA_DEFAULT_CONFIDENCE_DRIFT`.
  - `test-case-delta.ts` exporting `classifyTestCaseDelta`,
    `writeTestCaseDeltaReport`.
  - `test-case-dedupe.ts` exporting `detectTestCaseDuplicatesExtended`,
    `cosineSimilarity`, `writeTestCaseDedupeReport`,
    `createDisabledExternalDedupeProbe`,
    `createUnconfiguredExternalDedupeProbe`, plus the
    `EmbeddingProvider` and `ExternalDedupeProbe` interfaces.
  - `traceability-matrix.ts` exporting `buildTraceabilityMatrix`,
    `writeTraceabilityMatrix`.

### Behaviour notes

- All new surfaces are OPT-IN: existing pipelines (`runValidationPipeline`,
  `runExportPipeline`, `runOpenTextAlmApiTransfer`) keep their pre-#1373
  behaviour byte-for-byte. A caller invokes the new helpers explicitly to
  produce the artifacts.
- Air-gapped flow is preserved: `EmbeddingProvider` defaults to absent,
  `ExternalDedupeProbe` defaults to `disabled`. When the embedding path is
  unavailable the lexical fingerprint path still surfaces duplicates.
- Obsolete cases are reported via `TestCaseDeltaVerdict = "obsolete"` only
  — never destructively removed from QC (per AC3).
- Visual hashes participate in delta detection so unchanged screens avoid
  unnecessary visual-sidecar calls (per the 2026-04-24 multimodal
  addendum).

## [4.8.0] - 2026-04-26

### Added (Issue #1372)

- New schema constants for the controlled OpenText ALM API transfer pipeline:
  - `TRANSFER_REPORT_SCHEMA_VERSION = "1.1.0"`,
  - `TRANSFER_REPORT_ARTIFACT_FILENAME = "transfer-report.json"`,
  - `QC_CREATED_ENTITIES_SCHEMA_VERSION = "1.0.0"`,
  - `QC_CREATED_ENTITIES_ARTIFACT_FILENAME = "qc-created-entities.json"`.
- New enums (additive):
  - `ALLOWED_TRANSFER_REFUSAL_CODES` / `TransferRefusalCode` covering
    `feature_disabled`, `admin_gate_disabled`, `bearer_token_missing`,
    `mapping_profile_invalid`, `provider_mismatch`, `no_mapped_test_cases`,
    `no_approved_test_cases`, `unapproved_test_cases_present`,
    `policy_blocked_cases_present`, `schema_invalid_cases_present`,
    `visual_sidecar_blocked`, `visual_sidecar_evidence_missing`,
    `review_state_inconsistent`, `four_eyes_pending`, `dry_run_refused`,
    `dry_run_missing`, `folder_resolution_failed`, `mode_not_implemented`.
  - `ALLOWED_TRANSFER_ENTITY_OUTCOMES` / `TransferEntityOutcome`:
    `created`, `skipped_duplicate`, `failed`, `refused`.
  - `ALLOWED_TRANSFER_FAILURE_CLASSES` / `TransferFailureClass`:
    `transport_error`, `auth_failed`, `permission_denied`,
    `validation_rejected`, `conflict_unresolved`, `rate_limited`,
    `server_error`, `unknown`.
- New artifact types (additive):
  - `TransferReportArtifact` with type-level invariants
    `rawScreenshotsIncluded: false`, `credentialsIncluded: false`,
    `transferUrlIncluded: false`, plus deterministic counts
    (`createdCount`, `skippedDuplicateCount`, `failedCount`,
    `refusedCount`) and `audit: TransferAuditMetadata`.
  - `QcCreatedEntitiesArtifact` with type-level invariant
    `transferUrlIncluded: false`.
  - `TransferEntityRecord`, `QcCreatedEntity`, `TransferAuditMetadata`,
    and `TransferEvidenceReferences`.
- New optional fields on `WorkspaceStartOptions.testIntelligence`:
  - `allowApiTransfer?: boolean` (default `false` — fail-closed admin gate),
  - `transferBearerToken?: string` (legacy single-principal token),
  - `transferPrincipals?: TestIntelligenceTransferPrincipal[]`
    (multi-principal idempotent audit lineage).
- New exported type `TestIntelligenceTransferPrincipal`.
- New public module `src/test-intelligence/qc-alm-api-transfer.ts`
  exporting `runOpenTextAlmApiTransfer`, `buildTransferRollbackGuidance`,
  `createUnconfiguredQcApiTransferClient`, `isApiTransferMode`,
  `QcApiTransferError`, plus the `QcApiTransferClient` interface.

### Changed (Issue #1372)

- `TRANSFER_REPORT_SCHEMA_VERSION` is `"1.1.0"` because transfer audit
  metadata now includes required hash-only `evidenceReferences`. Consumers of
  schema `"1.0.0"` reports should treat missing `audit.evidenceReferences` as
  a legacy artifact and should not infer Wave 3 evidence binding from it.

### Behaviour notes (api_transfer)

- The `api_transfer` mode is fail-closed by default. Every gate
  (feature flag, admin flag, bearer token, mapping profile, dry-run
  report, review state, four-eyes, visual sidecar, policy decisions)
  must succeed before any write leaves the process. Refusal codes are
  recorded together so an operator can address them in one cycle.
- Idempotency is enforced via `lookupByExternalId` against the resolved
  folder path before any create call. Re-running on an unchanged approved
  set never produces duplicate entities; distinct target folders are
  resolved deterministically before any entity write starts.
- Transfer audit metadata carries hash-only evidence references for the
  mapping preview, dry-run report, visual-sidecar validation report, and
  optional generated test-case / reconciled intent artifacts. Raw prompts,
  screenshots, bearer tokens, and transfer URLs are never embedded.
- The pipeline writes `transfer-report.json` and
  `qc-created-entities.json` atomically using
  `${pid}.${randomUUID()}.tmp` so concurrent transfers on the same
  artifact root cannot tear a JSON file. Failure detail strings are
  redacted through the same secret + URL strip used by the dry-run
  report.

## [4.7.0] - 2026-04-26

### Added (Issue #1414)

- New `LlmGatewayErrorClass` literal `"response_too_large"` added to `ALLOWED_LLM_GATEWAY_ERROR_CLASSES`. Surfaced by `LlmGatewayClient.generate` when the gateway response body exceeds the configured `maxResponseBytes` cap. The failure is `retryable: false` (re-issuing the request would by definition breach the same cap); the transport cancels the underlying `ReadableStream` so the socket is released without buffering the remaining bytes.
- New optional `maxResponseBytes?: number` field on `LlmGatewayClientConfig`. Defaults to `8 * 1024 * 1024` (8 MiB) when omitted. Accepts any positive safe integer; invalid values (zero, negative, non-integer, `NaN`, infinite) throw `RangeError` at client construction. The mock gateway has no transport and ignores the field — fixtures that need to model this failure mode emit it directly through a `responder`.
- The transport enforces the cap via two layers: a `Content-Length` header pre-read short-circuit (so a header-declared oversized body never even pulls bytes from the socket) and a chunk-by-chunk byte counter against the streaming reader (so a missing or mendacious header still cannot exhaust memory). Both oversized paths cancel the underlying response body so the socket is released without buffering the remaining bytes.

### Changed

- Consumers that switch on `errorClass` should extend their handling to cover `"response_too_large"`. Behavior is `retryable: false`; `llm-capability-probe` classifies the outcome as `unsupported` (the gateway responded but its body shape is incompatible with the cap), and `visual-sidecar-client` treats it as `primary_unavailable` so the multimodal fallback chain still fires.
- The previous internal `MAX_RESPONSE_BYTES = 1 MiB` constant in `llm-gateway.ts` and its `errorClass: "schema_invalid"` failure are replaced by the configurable cap and the dedicated `response_too_large` discriminant. Clients that did not override the cap see the default raised from 1 MiB to 8 MiB; callers that previously matched on `errorClass === "schema_invalid"` plus the `/response body exceeds/` message must now match `errorClass === "response_too_large"` (the human-readable message remains `/response body exceeds maxResponseBytes \d+/`).
- Retryable early-status responses (`408`, `429`, and `5xx`) preserve their existing `timeout`, `rate_limited`, and `transport` classifications, but now cancel unread response bodies before retrying. `LLM_GATEWAY_CONTRACT_VERSION` remains `1.0.0` because it stamps persisted gateway evidence artifacts; this additive client-surface change is tracked by `CONTRACT_VERSION` `4.7.0`.

---

## [4.6.0] - 2026-04-26

### Added (Issue #1415)

- New `LlmGatewayErrorClass` literal `"input_budget_exceeded"` added to `ALLOWED_LLM_GATEWAY_ERROR_CLASSES`. Surfaced by `LlmGatewayClient.generate` (real and mock) when an outgoing `LlmGenerationRequest` carries a `maxInputTokens` cap and the client-side estimate of the prompt size (system prompt + user prompt + structured-output schema + image base64 payloads, divided by 4 bytes/token) exceeds that cap. The failure is `retryable: false`; the pre-transport guard returns before circuit-breaker dispatch because retrying would by definition violate the same budget.
- The `maxInputTokens` field on `LlmGenerationRequest` (introduced in 3.29.0 as a FinOps surface) is now load-bearing on the gateway transport: the cap is evaluated **before** any network call, before `apiKeyProvider` is invoked, and before the request body is serialized. Mock gateway honours the same guard so CI fixtures observe identical fail-closed semantics. Negative, zero, non-integer, or non-safe-integer values continue to be rejected as `schema_invalid` (structurally invalid budgets, distinct from a budget breach).
- `runWave1Poc` recognises the new error class as a FinOps gateway-budget failure and routes it through the existing `Wave1PocFinOpsBudgetExceededError` path (no downstream artifacts emitted).

### Changed (Issue #1415)

- Consumers that switch on `errorClass` must extend their handling to cover `"input_budget_exceeded"`. Behavior continues to be `retryable: false`; treat it as a non-transient policy outcome (operator-set cap was breached). Existing matchers that key on the human-readable message (`/estimated input tokens \d+ exceeds maxInputTokens \d+/`) still apply unchanged — only the `errorClass` discriminant moved from `"schema_invalid"` to `"input_budget_exceeded"`.

## [4.5.0] - 2026-04-26

### Added (Issue #1412)

- New `TestCasePolicyOutcome` literal `"risk_tag_downgrade_detected"` added to `ALLOWED_TEST_CASE_POLICY_OUTCOMES`. Emitted by `evaluatePolicyGate` (per-case and job-level) when the case-level `riskCategory` is outside the active profile's `reviewOnlyRiskCategories` set while the Business Test Intent IR derives a review-only classification for a screen referenced in the case's `figmaTraceRefs`. Per-case violations carry `severity: "warning"` and force the per-case decision to `needs_review`; a deduplicated set of job-level violations records the same drift for audit. The `risk_tag_downgrade_detected` outcome is additive to the existing `regulated_risk_review_required` violation, which continues to fire so per-case review tooling preserves its prior behavior.
- New optional field `enforceRiskTagDowngradeDetection?: boolean` on `TestCasePolicyProfileRules`. The secure default is `true` (treat `undefined` as `true`); the `eu-banking-default` profile sets the flag explicitly. Setting it to `false` disables the new gate behavior so legacy consumers remain backward-compatible.

### Changed (Issue #1412)

- `evaluatePolicyGate` now derives an effective intent risk classification per generated test case by intersecting `BusinessTestIntentIr.piiIndicators` with the case's `figmaTraceRefs.screenId` set (PII indicators without a `screenId` continue to be treated as global, fail-closed). Top-level `intent.risks` strings continue to be considered globally because the intent IR does not yet model per-screen risk strings.

## [4.4.0] - 2026-04-26

### Added (Issue #1413)

- New `TestCaseValidationIssueCode` literal `"semantic_suspicious_content"` added to `ALLOWED_TEST_CASE_VALIDATION_ISSUE_CODES`. Emitted by `validateGeneratedTestCases` when a deny-list pattern (shell metacharacters in suspicious sequences, JNDI / log4shell payloads, long base64 / hex runs, `<script>` tags, inline event handlers, `javascript:` / `data:` URLs) is found inside `steps[n].action`, `steps[n].data`, `steps[n].expected`, top-level `expectedResults[n]`, `preconditions[n]`, or `testData[n]`. Severity is `error`, so the validation report blocks the pipeline by default.
- New `TestCasePolicyOutcome` literal `"semantic_suspicious_content"` added to `ALLOWED_TEST_CASE_POLICY_OUTCOMES`. Mapped from the matching validation issue code by `evaluatePolicyGate`.
- New module `src/test-intelligence/semantic-content-sanitization.ts` with documented deny-list patterns, the pure detector `detectSuspiciousContent`, the runtime constants `SEMANTIC_SUSPICION_CATEGORIES` and `SEMANTIC_CONTENT_OVERRIDE_NOTE_KIND`, the per-case override types `SemanticContentOverride` / `SemanticContentOverrideInput` / `SemanticContentOverrideMap`, the operator entry point `recordSemanticContentOverride` (records a structured `note` review event with `metadata.overrideKind = "semantic_suspicious_content"` plus a non-empty justification), the auditor entry point `extractSemanticContentOverrides` (rebuilds the active override map from a persisted review-event log so it is replay-safe and carries the reviewed category), the pure helper `filterSemanticContentOverridesForValidation` (joins override maps against the current validation report so stale/unknown/category-mismatched paths remain fail-closed), and the pure helper `effectiveSemanticContentBlock` (computes the post-override `blocked` flag for downstream gates without mutating the validation report).
- New optional input `evaluatePolicyGate({ ..., semanticContentOverrides })`. When a `(testCaseId, path)` pair is in the override map, the corresponding `semantic_suspicious_content` validation finding is recorded as a `warning`-severity violation rather than a blocking `error`, the per-case decision is downgraded from `blocked` to `needs_review`, and the violation `rule` is annotated with `:overridden`. Cases with no override behave exactly as before. The validation report itself is preserved unchanged so the audit history carries the original finding.
- New optional input `runValidationPipeline({ ..., semanticContentOverrides })`. Forwards overrides into the policy gate and recomputes the pipeline-level `blocked` flag using `effectiveSemanticContentBlock`, so an overridden case no longer blocks downstream review/export gates while the validation artifact retains the original error finding.
- New optional input `runExportPipeline({ ..., semanticContentOverrides })`. Export still refuses raw validation errors by default, but when supplied with the same validated override map and an override-aware policy report it uses the effective validation block calculation so reviewed semantic findings do not permanently block export.
- New `ReviewStore.refreshPolicyDecisions({ jobId, at, policy })` entry point. It refreshes persisted per-case `policyDecision` values from an override-aware policy report, appends an audit note when anything changes, and preserves review state so a previously blocked semantic case can be approved after the explicit override is recorded and policy is re-evaluated. Refreshes fail closed when the policy report belongs to another job or references test-case ids outside the current review snapshot.

### Compatibility (Issue #1413)

- Additive only. Existing call sites that omit `semanticContentOverrides` see no behavior change for any test case that does not contain semantically suspicious content. Test cases that previously passed validation continue to pass; only newly detected injection-shape content blocks where it would have previously slipped through.
- New runtime exports surface through `src/test-intelligence/index.ts` only (the test-intelligence sub-module entry point): `SEMANTIC_SUSPICION_CATEGORIES`, `SEMANTIC_CONTENT_OVERRIDE_KIND_VALUE`, `SEMANTIC_CONTENT_OVERRIDE_MAX_JUSTIFICATION_LENGTH`, `SEMANTIC_CONTENT_OVERRIDE_METADATA_*` keys, `SEMANTIC_CONTENT_OVERRIDE_NOTE_KIND`, `detectSuspiciousContent`, `recordSemanticContentOverride`, `extractSemanticContentOverrides`, `listSemanticContentOverrides`, `filterSemanticContentOverridesForValidation`, and `effectiveSemanticContentBlock`. The root `src/index.ts` snapshot in `contract-version.test.ts` is unchanged because the root module re-exports only from `src/contracts/index.ts`.

## [4.3.0] - 2026-04-26

### Added (Issue #1411)

- `Wave1PocEvidenceManifest.manifestIntegrity?: { algorithm: "sha256"; hash: string }` — new optional self-attestation field for Wave 1 evidence manifests. New manifests stamp `algorithm: "sha256"` plus the SHA-256 of the canonical manifest JSON with `manifestIntegrity` omitted, so metadata-only rewrites to fields such as `modelDeployments`, `rawScreenshotsIncluded`, `promptHash`, or `policyProfileId` are detected by `verifyWave1PocEvidenceManifest` without requiring artifact-byte changes.
- `Wave1PocEvidenceVerificationResult.manifestIntegrity?` — structured verification details for the self-attestation check (`algorithm`, `actualHash`, optional `expectedHash`, `ok`). Current-version manifests that omit `manifestIntegrity` fail closed; legacy manifests remain parseable and continue to rely on the existing digest witness / trusted digest path.

### Unchanged (Issue #1411)

- The sibling `wave1-poc-evidence-manifest.sha256` digest witness remains in place and is still used by `verifyWave1PocEvidenceFromDisk`. The self-attestation field is additive defense-in-depth for direct manifest verification, not a replacement for external digest witnesses or signed in-toto attestations.
- No runtime dependency, telemetry, network call, signer, or external schema library is introduced. Hashing continues to use `node:crypto` and the existing canonical JSON helper.

## [4.2.0] - 2026-04-26

### Added (Issue #1380)

- New endpoint `GET /workspace/jobs/:jobId/evidence/verify` exposing the local Wave 1 POC evidence-verification capability (#1366) as a read-only HTTP route so operators and auditors can verify a completed job's evidence integrity without touching artifacts directly on disk. Status codes: `404` for unknown job IDs, `409` when no evidence has been written yet, `200` on verification completion regardless of pass/fail outcome (the body carries `ok`). The route is feature-gated by the same dual `FIGMAPIPE_WORKSPACE_TEST_INTELLIGENCE` + `WorkspaceStartOptions.testIntelligence.enabled` check as `/workspace/test-intelligence/...`. Bearer-protected per the existing governance-route convention (fail-closed `503 AUTHENTICATION_UNAVAILABLE` when `testIntelligence.reviewBearerToken` is unset, `401 UNAUTHORIZED` on missing/invalid token). Per-IP rate limiter `evidence-verify-reads.json` consumed per `(client, jobId)`. Method-locked to `GET` (returns `405 METHOD_NOT_ALLOWED` with `Allow: GET` for other methods). Invocations are audit-logged.
- New constant `EVIDENCE_VERIFY_RESPONSE_SCHEMA_VERSION` (`"1.0.0"`).
- New exported types `EvidenceVerifyResponse`, `EvidenceVerifyCheck`, `EvidenceVerifyFailure`, `EvidenceVerifyCheckKind`, `EvidenceVerifyFailureCode` describing the `200` response body. The body carries `schemaVersion`, `verifiedAt`, `jobId`, `ok`, `manifestSha256`, `manifestSchemaVersion`, `testIntelligenceContractVersion`, `modelDeployments`, optional `visualSidecar` summary (`selectedDeployment`, `fallbackUsed`, `resultArtifactSha256`), optional `attestation` summary (`present`, `signingMode`, `signatureCount`, `signaturesVerified`), and the deterministic `checks[]` + `failures[]` arrays. `checks[]` is sorted by `(kind, reference)`; `failures[]` is sorted by `(reference, code)` so consecutive verifications of the same on-disk run produce byte-stable bodies (modulo `verifiedAt`).
- New module `src/test-intelligence/evidence-verify.ts` exporting `verifyJobEvidence({ artifactsRoot, jobId, verifiedAt })` plus the discriminated `EvidenceVerifyResult` (`{ status: "ok"; body }` | `{ status: "job_not_found" }` | `{ status: "no_evidence" }`). The orchestrator wraps `verifyWave1PocEvidenceFromDisk` (per-artifact SHA-256 + manifest digest witness) and, when an in-toto attestation is present at `<runDir>/evidence/attestations/wave1-poc-attestation.intoto.json`, also calls `verifyWave1PocAttestationFromDisk` with the signing mode auto-detected from the on-disk presence of the matching Sigstore bundle. Visual-sidecar evidence is detected as missing when the manifest carries a `visualSidecar` summary but the on-disk result artifact is absent / failed, when the manifest attests the result artifact but never wires the summary block, or when `generated-testcases.json` references screen-only `visualEvidenceRefs` without a backing `visualSidecar` summary.
- New module `src/test-intelligence/evidence-verify-route.ts` exporting `parseEvidenceVerifyRoute` plus the `EvidenceVerifyRoute` / `EvidenceVerifyParseResult` / `EvidenceVerifyParseError` types. Path parser is method-agnostic; the request handler dispatches on method and applies bearer + rate-limit guards.

### Unchanged (Issue #1380)

- Read-only route: no write side effects, no artifact mutation, no attestation re-signing or manifest patching.
- Response body never contains tokens, prompt bodies, reasoning traces, raw test-case payloads, environment values, signer secret material, or absolute paths — only safe manifest-relative filenames, SHA-256 digests, and identity stamps surface.
- The route is HTTP-level only; the underlying `verifyWave1PocEvidenceFromDisk` / `verifyWave1PocAttestationFromDisk` primitives from #1366 / #1377 are unchanged. No new dependency, telemetry, or external schema library is introduced.

## [4.1.0] - 2026-04-26

### Added (Issue #1379)

- New optional self-verify rubric pass (Issue #1379) that sits between `testcase.validate` and `testcase.policy` in the validation pipeline. The pass scores every validated test case against a fixed rubric (six dimensions: schema conformance, source-trace completeness, assumption / open-question marking, expected-result coverage, negative / boundary case presence, duplication flag consistency) and, when a `VisualScreenDescription[]` is supplied, four multimodal subscores (visible-control coverage, state / validation coverage, ambiguity handling, unsupported-visual-claims penalty per the 2026-04-24 multimodal addendum). Per-case rubric scores are rounded to 6 digits and the job-level aggregate is the arithmetic mean of the per-case scores; the same job-level aggregate is mirrored onto `coverage-report.json#rubricScore`.
- New constants: `SELF_VERIFY_RUBRIC_REPORT_SCHEMA_VERSION` (`"1.0.0"`), `SELF_VERIFY_RUBRIC_REPORT_ARTIFACT_FILENAME` (`"self-verify-rubric.json"`), `SELF_VERIFY_RUBRIC_ARTIFACT_DIRECTORY` (`"testcases"`), `SELF_VERIFY_RUBRIC_PROMPT_TEMPLATE_VERSION` (`"1.0.0"`), `SELF_VERIFY_RUBRIC_RESPONSE_SCHEMA_NAME` (`"SelfVerifyRubricReport"`), `ALLOWED_SELF_VERIFY_RUBRIC_DIMENSIONS`, `ALLOWED_SELF_VERIFY_RUBRIC_VISUAL_SUBSCORES`, `ALLOWED_SELF_VERIFY_RUBRIC_REFUSAL_CODES`.
- New exported types: `SelfVerifyRubricDimension`, `SelfVerifyRubricVisualSubscoreKind`, `SelfVerifyRubricRefusalCode`, `SelfVerifyRubricDimensionScore`, `SelfVerifyRubricVisualSubscore`, `SelfVerifyRubricRuleCitation`, `SelfVerifyRubricCaseEvaluation`, `SelfVerifyRubricAggregateScores`, `SelfVerifyRubricRefusal`, `SelfVerifyRubricReport`, `SelfVerifyRubricReplayCacheKey`, `SelfVerifyRubricReplayCacheEntry`, `SelfVerifyRubricReplayCacheLookupResult`, `TestCaseQualitySignalRubric` (per-case quality-signal projection of the rubric report).
- New module `src/test-intelligence/self-verify-rubric.ts` exporting `runSelfVerifyRubricPass`, `projectSelfVerifyRubricToTestCaseQualitySignals`, `aggregateSelfVerifyRubricScores`, `buildSelfVerifyRubricResponseSchema`, `buildSelfVerifyRubricUserPrompt`, `validateSelfVerifyRubricResponse`, `computeSelfVerifyRubricCacheKeyDigest`, `computeSelfVerifyRubricPromptHash`, `computeSelfVerifyRubricSchemaHash`, `createMemorySelfVerifyRubricReplayCache`, `createFileSystemSelfVerifyRubricReplayCache`, `writeSelfVerifyRubricReportArtifact`, `SELF_VERIFY_RUBRIC_SYSTEM_PROMPT`, `SELF_VERIFY_RUBRIC_USER_PROMPT_PREAMBLE`. The pass calls the same `LlmGatewayClient` (role `test_generation`) that the generator uses (per Issue #1379 non-goal "no second model"); image inputs are refused at the gateway boundary so the rubric never receives screenshot bytes.
- Rubric replay-cache keys include `modelDeployment` and `compatibilityMode` in addition to model revision and gateway release, and the rubric pass refuses with `model_binding_mismatch` before cache lookup or LLM invocation when the supplied model binding does not match the gateway client or the client is not in `openai_chat` compatibility mode.
- Per-case rubric scores are reported via the `self-verify-rubric.json` artifact's `caseEvaluations[].rubricScore` field and the `TestCaseQualitySignalRubric[]` projection (`projectSelfVerifyRubricToTestCaseQualitySignals`). The strict generated-test-case JSON schema is intentionally NOT widened — the cached `GeneratedTestCase` payload remains byte-identical, the replay-cache key for the test-generation pass is unchanged, and downstream consumers that already validate cached payloads keep working without a schema-version migration.
- New `RunValidationPipelineInput.selfVerifyRubric?: SelfVerifyRubricPipelineOptions` (additive, opt-in). When set, callers use the new async `runValidationPipelineWithSelfVerify` (or `runAndPersistValidationPipelineWithSelfVerify`) which threads the rubric pass between validation and policy. When omitted, the synchronous `runValidationPipeline` path is byte-stable with the pre-#1379 behavior — no rubric artifact is emitted, `coverage-report.json#rubricScore` is left unset, and downstream policy / visual gates are unchanged.
- New `ValidationPipelineArtifacts.rubric?: SelfVerifyRubricReport` (additive, optional). Persisted at `<destinationDir>/testcases/self-verify-rubric.json` via `writeValidationPipelineArtifacts` when present.
- `runWave1Poc` accepts optional `selfVerifyRubric: { enabled: true; cache?, mockResponder?, maxOutputTokens?, maxRetries?, ... }` (additive). When enabled the harness builds an in-process deterministic mock LLM client (role `test_generation`, deployment `gpt-oss-120b-mock`) and threads the rubric pass through the validation pipeline; the resulting `<runDir>/testcases/self-verify-rubric.json` is attested by the evidence manifest under category `self_verify_rubric`. When omitted the Wave 1 POC fixtures remain byte-identical to the pre-#1379 baseline.
- `Wave1PocRunResult.selfVerifyRubric?: SelfVerifyRubricReport` and `Wave1PocRunResult.selfVerifyRubricArtifactPath?: string` (additive, optional).
- `Wave1PocEvidenceArtifactCategory` adds `"self_verify_rubric"` for the new artifact attestation slot.
- `Wave1PocEvalThresholds.minJobRubricScore?: number` and `Wave1PocEvalThresholds.requireRubricPass?: boolean` (additive). When set, the eval gate fails the run if the rubric `jobLevelRubricScore` is strictly below the threshold or if the rubric pass attached a `refusal` to its report.
- `Wave1PocEvalFixtureMetrics.jobRubricScore?: number` and `Wave1PocEvalFixtureMetrics.rubricRefused?: boolean` (additive). Populated by the eval gate when the rubric pass ran for the fixture.
- `Wave1PocEvalFailure.rule` extended with `"min_job_rubric_score"` and `"rubric_pass_refused"` (additive — new accepted rule strings, no rule rename).

### Unchanged (Issue #1379)

- The pre-#1379 default fixture-only POC path is byte-identical: rubric pass is opt-in and the deterministic harness emits the same `wave1-poc-evidence-manifest.json` digest for every existing fixture. The strict generated-test-case JSON schema is unchanged so every replay-cache file and persisted `generated-testcases.json` written before this change remains valid (zero migration burden for replay caches and on-disk artifacts).
- No new runtime dependency, telemetry, or external schema library is introduced. The rubric pass uses the existing `LlmGatewayClient` surface from #1363, the existing `LlmGatewayClientBundle.testGeneration` client, the same `openai_chat` compatibility mode, and hand-rolled JSON validation (workspace-dev zero-runtime-deps policy — see `repo_zero_deps.md`). Image payloads are refused for the test_generation role so the rubric never receives screenshot bytes (`imagePayloadSentToTestGeneration: false` invariant from #1366 holds).
- API keys, bearer tokens, and prompt text are NEVER persisted by the rubric pass. The persisted report carries dimension scores, short rule citations (sanitized + truncated), the cache-key digest, and the deployment / model-revision identity — never raw prompts and never chain-of-thought.
- Replay-cache identity for the test-generation pass is unchanged (the rubric cache uses a separate key shape with `passKind: "self_verify_rubric"` so the two caches cannot collide).

## [4.0.0] - 2026-04-26

### Changed (Issue #1378 follow-up — schema conformance) — BREAKING

- `CONTRACT_VERSION` from `3.32.0` to `4.0.0` (Major bump: field removals +
  type change per the versioning rules table above).
- **Removed** `Wave1PocLbomDocument.secretsIncluded`, `rawPromptsIncluded`,
  and `rawScreenshotsIncluded` (non-standard top-level fields). The same
  invariants are now carried as CycloneDX `metadata.properties`:
  `workspace-dev:secretsIncluded`, `workspace-dev:rawPromptsIncluded`, and
  `workspace-dev:rawScreenshotsIncluded`. Consumers that read these fields
  must switch to `metadata.properties`.
- **Changed** `LbomModelConsiderations.ethicalConsiderations` from
  `string[]` to `Array<{ name: string; mitigationStrategy?: string }>`,
  matching the CycloneDX 1.6 model-card risk-object schema.
- Per-job LBOM documents now validate directly against the pinned CycloneDX
  1.6 JSON schema family (`bom-1.6`, SPDX, and JSF).
- New CI-covered schema test validates both emitted LBOM artifacts and
  `docs/figma-to-test/lbom-template.cdx.json` against pinned local
  CycloneDX 1.6 + SPDX + JSF schemas.

## [3.32.0] - 2026-04-26

### Added (Issue #1378)

- New per-job CycloneDX 1.6 ML-BOM (LBOM) artifact emitted by `runWave1Poc` under `<runDir>/lbom/ai-bom.cdx.json`. The artifact inventories the model chain (`gpt-oss-120b` test-generation, `llama-4-maverick-vision` visual primary, `phi-4-multimodal-poc` visual fallback), the curated few-shot prompt bundle (hashed via the prompt compiler's `promptHash` + `schemaHash`), and the active policy profile (hashed via canonical SHA-256). The visual sidecar fallback usage is recorded as a metadata + per-component property so an operator can detect degraded paths without re-parsing the visual sidecar result.
- New constants: `LBOM_CYCLONEDX_SPEC_VERSION` (`"1.6"`), `LBOM_ARTIFACT_SCHEMA_VERSION` (`"1.0.0"`), `LBOM_ARTIFACT_DIRECTORY` (`"lbom"`), `LBOM_ARTIFACT_FILENAME` (`"ai-bom.cdx.json"`), and `ALLOWED_LBOM_MODEL_ROLES` (`["test_generation", "visual_primary", "visual_fallback"]`).
- New exported types describing the persisted LBOM document: `Wave1PocLbomDocument`, `LbomMetadata`, `LbomToolComponent`, `LbomSubjectComponent`, `LbomModelComponent`, `LbomDataComponent`, `LbomDependency`, `LbomHash`, `LbomProperty`, `LbomExternalReference`, `LbomLicenseEntry`, `LbomModelCard`, `LbomModelParameters`, `LbomModelConsiderations`, `LbomPerformanceMetric`, `LbomModelRole`, `LbomDataKind`.
- New exported types `Wave1PocLbomSummary`, `LbomValidationIssue`, `LbomValidationResult` for audit-timeline summary + structured validator diagnostics.
- New module `src/test-intelligence/lbom-emitter.ts` with `buildLbomDocument`, `validateLbomDocument`, `writeLbomArtifact`, `summarizeLbomArtifact`, `lbomDataKindFromBomRef`, and `isAllowedVisualFallbackReason`. Validator is hand-rolled (workspace-dev zero-runtime-deps policy — see `repo_zero_deps.md`) and enforces CycloneDX 1.6 structural shape, single-algorithm hash entries (`SHA-256` only), unique `bom-ref` set, dependency-graph closure, RFC-4122 serial number, ISO-8601 timestamp, no raw `contents` payloads on data components, and no high-risk secret patterns in any property value.
- `Wave1PocEvidenceArtifactCategory` adds `"lbom"`. The `runWave1Poc` evidence manifest now attests `lbom/ai-bom.cdx.json` with SHA-256 + byte length, so the existing in-toto attestation transitively covers the LBOM through the manifest digest.
- `Wave1PocRunResult` adds `lbom: Wave1PocLbomDocument`, `lbomSummary: Wave1PocLbomSummary`, and `lbomArtifactPath: string`. All three are always present — the LBOM emit is part of the evidence-seal flow on every completed Wave 1 POC run.
- New documentation template at `docs/figma-to-test/lbom-template.cdx.json` referenced from `docs/test-intelligence.md`. The template describes the document shape an operator should expect to find under each run directory.
- The visual-sidecar-failure path also emits `lbom/ai-bom.cdx.json`. Even on a refused run an operator can audit the model chain (test-generation deployment, primary + fallback visual sidecars) and the active policy profile that were attempted before the sidecar exhaustion. The failure-mode LBOM uses the same identity-hash convention as the failure evidence manifest (deterministic SHA-256 over fixture / job / sidecar identity, `failureHash:not-generated` for prompt/schema fields) and is attested by the failure manifest under category `lbom`.

## [3.31.0] - 2026-04-26

### Added (Issue #1377 follow-up — quality-gate)

- New exported type `Wave1PocAttestationCertificateChainMaterial` (`hint`, `certificateChainPem`, `algorithm: "ecdsa-p256-sha256"`, optional `rekorLogIndex`) and discriminated union `Wave1PocAttestationVerificationMaterial = { publicKey } | { x509CertificateChain }` so signed bundles can carry either an in-line public key (key-bound flow) or an X.509 certificate chain (Sigstore keyless flow). Existing key-bound bundles continue to round-trip unchanged.
- `Wave1PocAttestationBundle.verificationMaterial` widens from `{ publicKey: ... }` to `Wave1PocAttestationVerificationMaterial`. The verifier extracts the leaf certificate's subject public key automatically when keyless material is present; trust-root validation (chain → operator-pinned root) remains operator-managed and is OUT OF SCOPE for this module.
- `Wave1PocAttestationSigner.publicKeyMaterial` is renamed to `verificationMaterial` (same union type) so a single field carries either form. Built-in `createKeyBoundSigstoreSigner` now exposes `verificationMaterial: { publicKey: ... }`.
- New module exports: `createKeylessSigstoreSignerScaffold`, `Wave1PocKeylessSignerCallback`, `CreateKeylessSigstoreSignerInput` — operator-pluggable scaffold for Sigstore keyless signing. The repo never invokes Fulcio / Rekor itself; the operator-supplied callback is the only place network egress can occur. The scaffold is exercised end-to-end by tests via a self-signed leaf cert generated entirely in `node:crypto`.
- Atomic-write idiom in `persistWave1PocAttestation` strengthened to `${path}.${pid}.${randomUUID()}.tmp` so concurrent same-pid same-millisecond writers cannot collide on the temp filename. Mirrors the FinOps writer idiom in #1371.
- `evidence-manifest.ts` filename validator (`validateArtifactPath`) now returns a discriminated `{ ok, reason }` so the builder can throw a specific diagnostic (`control_characters`, `path_traversal`, `absolute`, `backslash`, `segment_exceeds_byte_length`, `exceeds_total_byte_length`, `empty`) instead of a generic message.
- 14 new tests across `evidence-attestation.keyless.test.ts` (5), `evidence-attestation.fuzz.test.ts` (8), `evidence-attestation.concurrency.test.ts` (1). The 4 stale filename-injection tests in `evidence-tampering.test.ts` are repaired (test 10's assertion is updated to reflect the post-#1371 multi-segment path policy).

### Added (Issue #1377)

- `WAVE1_POC_ATTESTATION_SCHEMA_VERSION` (`"1.0.0"`) — schema version stamp for the in-toto v1 attestation produced per job by the Wave 1 POC harness.
- `WAVE1_POC_ATTESTATION_STATEMENT_TYPE` (`"https://in-toto.io/Statement/v1"`) and `WAVE1_POC_ATTESTATION_PREDICATE_TYPE` (`"https://workspace-dev.figmapipe.dev/test-intelligence/wave1-poc-evidence/v1"`) — pinned URIs identifying the attestation envelope and predicate shape.
- `WAVE1_POC_ATTESTATION_PAYLOAD_TYPE` (`"application/vnd.in-toto+json"`) — DSSE `payloadType` bound into the pre-authentication encoding (PAE) so a signature cannot be replayed against a different payload type.
- `WAVE1_POC_ATTESTATION_ARTIFACT_FILENAME` (`"wave1-poc-attestation.intoto.json"`) and `WAVE1_POC_ATTESTATION_BUNDLE_FILENAME` (`"wave1-poc-attestation.bundle.json"`) — canonical filenames for the persisted DSSE envelope and the optional Sigstore bundle.
- `WAVE1_POC_ATTESTATIONS_DIRECTORY` (`"evidence/attestations"`) and `WAVE1_POC_SIGNATURES_DIRECTORY` (`"evidence/signatures"`) — run-dir-relative subdirectories where the envelope and (when signed) the Sigstore bundle are written.
- `WAVE1_POC_ATTESTATION_BUNDLE_MEDIA_TYPE` (`"application/vnd.dev.sigstore.bundle.v0.3+json"`) — pinned Sigstore bundle media type embedded in every signed bundle.
- `ALLOWED_WAVE1_POC_ATTESTATION_SIGNING_MODES` (`unsigned`, `sigstore`) and discriminant `Wave1PocAttestationSigningMode` — `unsigned` is the default and is the only mode exercised by the POC fixture path; `sigstore` requires an operator-supplied signer.
- New exported types: `Wave1PocAttestationStatement`, `Wave1PocAttestationSubject`, `Wave1PocAttestationPredicate`, `Wave1PocAttestationVisualSidecarIdentity`, `Wave1PocAttestationDsseEnvelope`, `Wave1PocAttestationSignature`, `Wave1PocAttestationBundle`, `Wave1PocAttestationPublicKeyMaterial`, `Wave1PocAttestationSummary`, `Wave1PocAttestationVerificationFailure`, `Wave1PocAttestationVerificationResult`. Hard invariants on the predicate: `rawScreenshotsIncluded: false`, `secretsIncluded: false`, `imagePayloadSentToTestGeneration: false` (TYPE-LEVEL `false` literals).
- `Wave1PocEvidenceArtifactCategory` gains two new variants: `"attestation"` and `"signature"` — reserved so future verifiers may attest the envelope and bundle inside the existing manifest. The default Wave 1 manifest keeps the attestation as a sibling artifact under `evidence/attestations/...` and `evidence/signatures/...`; the manifest's basename-driven `unexpected` check is unaffected.
- New module `src/test-intelligence/evidence-attestation.ts` — `buildWave1PocAttestationStatement` (canonical statement builder), `encodeWave1PocAttestationPayload` (canonical JSON + UTF-8 encode), `encodeDssePreAuth` (PAE bytes), `buildUnsignedWave1PocAttestationEnvelope`, `buildSignedWave1PocAttestation`, `createKeyBoundSigstoreSigner` (ECDSA P-256 signer using `node:crypto`, no network), `generateWave1PocAttestationKeyPair`, `persistWave1PocAttestation` (atomic `${pid}.${ts}.tmp` rename), `summarizeWave1PocAttestation`, `listWave1PocAttestationArtifactPaths`, `verifyWave1PocAttestation`, `verifyWave1PocAttestationFromDisk`, `computeWave1PocAttestationEnvelopeDigest`. The verifier returns a structured `Wave1PocAttestationVerificationResult` with per-failure `code` + `reference` + `message`; tampered subjects fail with `subject_digest_mismatch` and the mismatched artifact path under `reference`.
- `runWave1Poc` accepts optional `attestationSigningMode` and `attestationSigner`. Always emits `<runDir>/evidence/attestations/wave1-poc-attestation.intoto.json`; when the signing mode is `sigstore`, also emits `<runDir>/evidence/signatures/wave1-poc-attestation.bundle.json`. Result type extended with `attestation: Wave1PocAttestationSummary` so the audit timeline surfaces signing mode, signer reference, and artifact SHA-256 without re-reading the on-disk envelope.

### Unchanged (Issue #1377)

- The Wave 1 evidence manifest from #1366 (`Wave1PocEvidenceManifest`) and its on-disk verification (`verifyWave1PocEvidenceManifest`, `verifyWave1PocEvidenceFromDisk`) continue to behave exactly as before. The attestation is a sibling layer; existing Merkle-style hash + byte-length checks, manifest-mutation detection, and digest-witness validation are preserved bit-identically.
- The default signing mode is `unsigned` and never invokes a signer. The unsigned path is fully air-gapped: no network calls, no private-key operations, deterministic byte output for byte-stable fixture replays.
- No new runtime dependency, telemetry, or external schema library is introduced. DSSE encoding and ECDSA P-256 signing/verification use `node:crypto` only; the canonical JSON helper is the existing `canonicalJson` from `content-hash.ts`.
- API keys, bearer tokens, OIDC tokens, prompt text, and response bytes are NEVER attested. Predicate fields carry only identity hashes, deployment names, and version stamps.

---

## [3.30.0] - 2026-04-25

### Added (Issue #1376)

- `pending_secondary_approval` — new value appended to `ALLOWED_REVIEW_STATES` for cases that have received their first distinct approval and are awaiting a second under four-eyes enforcement. Cases not subject to four-eyes never enter this state.
- `primary_approved` and `secondary_approved` — new values appended to `ALLOWED_REVIEW_EVENT_KINDS`. The store records each four-eyes approval as one of these wire-level kinds for governance auditability; clients may continue to send the generic `approved` action and the store routes it based on snapshot state.
- `ALLOWED_FOUR_EYES_ENFORCEMENT_REASONS` (`risk_category`, `visual_low_confidence`, `visual_fallback_used`, `visual_possible_pii`, `visual_prompt_injection`, `visual_metadata_conflict`) and discriminant `FourEyesEnforcementReason`.
- `DEFAULT_FOUR_EYES_REQUIRED_RISK_CATEGORIES` (`financial_transaction`, `regulated_data`, `high`) — operator-overridable default mapping the issue's `payment / authorization / identity / regulatory` surface onto the existing `TestCaseRiskCategory` taxonomy.
- `DEFAULT_FOUR_EYES_VISUAL_SIDECAR_TRIGGERS` (`low_confidence`, `fallback_used`, `possible_pii`, `prompt_injection_like_text`, `conflicts_with_figma_metadata`) — visual-sidecar outcomes that trigger four-eyes regardless of risk category, per the 2026-04-24 multimodal addendum.
- New exported type `FourEyesPolicy` — `{ requiredRiskCategories, visualSidecarTriggerOutcomes }`. The policy is resolved at startup from `WorkspaceStartOptions.testIntelligence` and stamped into each `ReviewGateSnapshot.fourEyesPolicy`.
- New exported type `TestIntelligenceReviewPrincipal` — `{ principalId, bearerToken }`. Review-gate writes may derive the persisted actor from a server-configured principal-bound bearer token instead of trusting a request-body `actor`.
- New optional fields on `WorkspaceStartOptions.testIntelligence`: `reviewPrincipals?: TestIntelligenceReviewPrincipal[]`, `fourEyesRequiredRiskCategories?: TestCaseRiskCategory[]`, and `fourEyesVisualSidecarTriggerOutcomes?: VisualSidecarValidationOutcome[]`.
- New optional fields on `ReviewSnapshot`: `fourEyesReasons?`, `primaryReviewer?`, `primaryApprovalAt?`, `secondaryReviewer?`, `secondaryApprovalAt?`, `lastEditor?`. The previously-required `fourEyesEnforced: boolean` field now actually drives enforcement; older snapshots that emitted `false` continue to validate.
- New optional fields on `ReviewGateSnapshot`: `pendingSecondaryApprovalCount?: number`, `fourEyesPolicy?: FourEyesPolicy`.
- New module `src/test-intelligence/four-eyes-policy.ts` — `EU_BANKING_DEFAULT_FOUR_EYES_POLICY`, `cloneFourEyesPolicy`, `resolveFourEyesPolicy` (normalizes operator config), `evaluateFourEyesEnforcement` (returns `{ enforced, reasons }` per case), `validateFourEyesPolicy` (returns `ValidationIssue[]` for invalid risk categories or outcomes).
- The review store extends `seedSnapshot` with optional `fourEyesPolicy` and `visual` inputs so each test case is stamped at seed time. `recordTransition` now refuses self-approval, duplicate-principal approval, and approving one's own edit with structured codes (`self_approval_refused`, `duplicate_principal_refused`); approving a four-eyes case routes through the `primary_approved` / `secondary_approved` kinds based on current state.
- The review handler maps two new actions, `primary-approve` and `secondary-approve`, to the matching event kinds for callers that want explicit semantics. The legacy `approve` action remains valid and is auto-routed for four-eyes-enforced cases. When `reviewPrincipals` are configured, the matched bearer token supplies the authoritative reviewer identity; the legacy `reviewBearerToken` is treated as one principal for backward compatibility.
- The export pipeline refuses on `unapproved_test_cases_present`; `pending_secondary_approval` is treated as not-approved-not-rejected, so a four-eyes case with only one approval blocks export deterministically. It also refuses `approved`/`exported`/`transferred` four-eyes snapshots missing distinct primary/secondary reviewers, timestamps, or approver membership with `review_state_inconsistent`.

### Unchanged (Issue #1376)

- The Wave 1 single-reviewer flow (#1365) is preserved bit-identically when `fourEyesEnforced=false` for every case in the snapshot. Existing operator profiles, legacy snapshots, and Wave 1 fixture replays are untouched.
- No new runtime dependency, telemetry, or external schema library is introduced; validators remain hand-rolled and atomic writes continue to use `${path}.${pid}.tmp` rename.
- The pre-existing forward-compatibility hint on `ReviewSnapshot.fourEyesEnforced` is honored: prior snapshots that emitted the field default-false validate against the new schema unchanged.

---

## [3.29.0] - 2026-04-25

### Added (Issue #1371)

- `FINOPS_BUDGET_REPORT_SCHEMA_VERSION` (`"1.0.0"`) and `FINOPS_BUDGET_REPORT_ARTIFACT_FILENAME` (`budget-report.json`) — version stamp and canonical filename for the persisted FinOps budget report. The artifact lives under `<runDir>/finops/` (constant `FINOPS_ARTIFACT_DIRECTORY`) so an operator can browse cost reports separately from the Wave 1 evidence artifacts.
- `ALLOWED_FINOPS_ROLES` (`test_generation`, `visual_primary`, `visual_fallback`) and discriminant `FinOpsRole` — per-role split that the report attests in lockstep with the gateway's role-separated bundle.
- `ALLOWED_FINOPS_BUDGET_BREACH_REASONS` and discriminant `FinOpsBudgetBreachReason` — policy-readable reasons (`max_input_tokens`, `max_output_tokens`, `max_wall_clock_ms`, `max_retries`, `max_attempts`, `max_image_bytes`, `max_total_input_tokens`, `max_total_output_tokens`, `max_total_wall_clock_ms`, `max_replay_cache_miss_rate`, `max_fallback_attempts`, `max_live_smoke_calls`, `max_estimated_cost`).
- `ALLOWED_FINOPS_JOB_OUTCOMES` and discriminant `FinOpsJobOutcome` — terminal outcomes the report stamps (`completed`, `completed_cache_hit`, `budget_exceeded`, `policy_blocked`, `validation_blocked`, `visual_sidecar_failed`, `export_refused`, `gateway_failed`).
- New exported types: `FinOpsRoleBudget`, `FinOpsBudgetEnvelope`, `FinOpsCostRate`, `FinOpsCostRateMap`, `FinOpsRoleUsage`, `FinOpsBudgetBreach`, `FinOpsBudgetReport`. Hard invariants on the report: `secretsIncluded: false`, `rawPromptsIncluded: false`, `rawScreenshotsIncluded: false` (TYPE-LEVEL `false` literals).
- New optional fields on `LlmGenerationRequest`: `maxWallClockMs` (fail-closed when exceeded — returns `retryable: false`) and `maxRetries` (per-request override capped against the static client config). Both were previously not configurable per request.
- `Wave1PocEvidenceArtifactCategory` gains a new variant `"finops"` so future Wave 2 manifests can attest the FinOps report category if a verifier extends the manifest's path-resolution surface.
- New module `src/test-intelligence/finops-budget.ts` — envelope factory, deep-clone, validator (`validateFinOpsBudgetEnvelope`), `EU_BANKING_DEFAULT_FINOPS_BUDGET` profile, `DEFAULT_FINOPS_BUDGET_ENVELOPE` permissive baseline, and `resolveFinOpsRequestLimits` helper that maps a role budget onto the four `LlmGenerationRequest` fields the gateway consumes.
- New module `src/test-intelligence/finops-report.ts` — `createFinOpsUsageRecorder`, `buildFinOpsBudgetReport`, `writeFinOpsBudgetReport` (atomic `${pid}.${randomUUID()}.tmp` rename). The recorder aggregates per-attempt observations with cache-hit / cache-miss tracking; cache hits never increment token or attempt counters.
- `runWave1Poc` accepts optional `finopsBudget` and `finopsCostRates` inputs and always emits `<runDir>/finops/budget-report.json`. Result type adds `finopsReport` (the in-memory `FinOpsBudgetReport`) and `finopsArtifactPath` so eval-gate and inspector code can read the report without re-parsing the file.
- Visual sidecar attempt records flow into the FinOps recorder verbatim: `VisualSidecarAttempt.deployment` decides the role (`llama-4-maverick-vision` → `visual_primary`, `phi-4-multimodal-poc` → `visual_fallback`, `mock` resolves by attempt index).

### Unchanged (Issue #1371)

- The Wave 1 evidence manifest (`Wave1PocEvidenceManifest`) does NOT attest the FinOps artifact because the manifest verifier resolves artifacts at the run-dir root only (basename invariant). The FinOps artifact is verifiable independently via its negative-invariant fields and its own schema/contract stamps.
- `gpt-oss-120b` (`test_generation`) still NEVER receives image payloads. The new `imageBytes` counter on `FinOpsRoleUsage` is non-zero only for visual roles.
- Cache-hit jobs report no LLM call and no new token usage: `recordCacheHit()` increments only the cache-hit counter, leaving every other counter at zero.

---

## [3.28.0] - 2026-04-25

### Added (Issue #1368)

- `DRY_RUN_REPORT_SCHEMA_VERSION` (`"1.0.0"`) and `DRY_RUN_REPORT_ARTIFACT_FILENAME` (`dry-run-report.json`) — version stamp and canonical filename for the persisted QC adapter dry-run report envelope (covers profile validation, mapping completeness, folder resolution state, planned-entity payload preview, and visual evidence flags).
- `ALLOWED_QC_ADAPTER_MODES` — runtime list of transfer modes recognised by the QC adapter facade (`export_only`, `dry_run`, `api_transfer`). The `api_transfer` mode is intentionally not implemented in Wave 2 and surfaces `mode_not_implemented` so the export pipeline can fail-closed.
- `ALLOWED_QC_ADAPTER_PROVIDERS` — runtime list of provider discriminators recognised by the QC adapter facade (`opentext_alm`, `opentext_octane`, `opentext_valueedge`, `xray`, `testrail`, `azure_devops_test_plans`, `qtest`, `custom`). Wave 2 ships only the `opentext_alm` adapter; the rest are reserved identifiers so future adapters plug in without contract churn.
- `ALLOWED_QC_MAPPING_PROFILE_ISSUE_CODES` — runtime list of mapping-profile validator codes (`missing_base_url_alias`, `invalid_base_url_alias`, `missing_domain`, `missing_project`, `missing_target_folder_path`, `invalid_target_folder_path`, `missing_test_entity_type`, `unsupported_test_entity_type`, `missing_required_fields`, `duplicate_required_field`, `missing_design_step_mapping`, `design_step_mapping_field_invalid`, `credential_like_field_present`, `provider_mismatch`, `profile_id_mismatch`).
- `ALLOWED_DRY_RUN_REFUSAL_CODES` — runtime list of refusal codes the dry-run adapter may emit (`no_mapped_test_cases`, `mapping_profile_invalid`, `provider_mismatch`, `mode_not_implemented`, `folder_resolution_failed`).
- `ALLOWED_DRY_RUN_FOLDER_RESOLUTION_STATES` — runtime list of folder-resolution states under `dry_run` (`resolved`, `missing`, `simulated`, `invalid_path`).
- New exported types: `QcAdapterMode`, `QcAdapterProvider`, `QcMappingProfile`, `QcMappingProfileIssue`, `QcMappingProfileIssueCode`, `QcMappingProfileValidationResult`, `DryRunRefusalCode`, `DryRunFolderResolutionState`, `DryRunFolderResolution`, `DryRunMappingCompletenessEntry`, `DryRunMappingCompletenessSummary`, `DryRunPlannedEntityPayload`, `DryRunVisualEvidenceFlag`, `DryRunReportArtifact`.
- Provider-neutral `QcAdapter` interface (`src/test-intelligence/qc-adapter.ts`) — narrow façade exposing `provider`, `validateProfile`, and `dryRun`. The interface accepts injected `QcAdapterClock`, `QcAdapterIdSource`, and `QcFolderResolver` so dry-run output is bit-identical across runs and never performs I/O on the QC tool.
- OpenText ALM dry-run adapter (`openTextAlmDryRunAdapter`, `createOpenTextAlmDryRunAdapter`) — implements `QcAdapter` for the `opentext_alm` provider. Validates the supplied mapping profile (rejects credential-shaped fields, validates `/Subject/...` folder paths, surfaces missing required fields), simulates target folder resolution via the injected resolver, and emits a redacted `DryRunReportArtifact` with hard `rawScreenshotsIncluded: false` + `credentialsIncluded: false` invariants stamped at the type level. Visual sidecar evidence flows through as `visualEvidenceFlags` for cases whose mapping derives only from low-confidence sidecar observations.
- Hand-rolled mapping-profile validator (`validateQcMappingProfile`, `cloneOpenTextAlmDefaultMappingProfile`, `OPENTEXT_ALM_DEFAULT_MAPPING_PROFILE`) — `ValidationIssue[]`-style diagnostics with JSON-pointer-shaped paths and severity-tagged outcomes. Designed to plug into a UI form without re-walking the structure.

### Unchanged (Issue #1368)

- `export_only` pipeline (`runExportPipeline`) is byte-identical to its 3.27.0 emission; the dry-run adapter is a sibling surface, not a rewrite.
- The hard invariant that no QC credentials, no API URLs, and no raw screenshots are persisted in any artifact remains stamped at the type level on both `ExportReportArtifact` and the new `DryRunReportArtifact`.
- The `api_transfer` mode is intentionally NOT implemented in Wave 2 — calling it on the dry-run adapter throws `QcAdapterModeNotImplementedError` so callers can surface a deterministic refusal code.

---

## [3.27.0] - 2026-04-25

### Added (Issue #1386)

- `VISUAL_SIDECAR_RESULT_SCHEMA_VERSION` (`"1.0.0"`) and `VISUAL_SIDECAR_RESULT_ARTIFACT_FILENAME` (`visual-sidecar-result.json`) — version stamp and canonical filename for the persisted multimodal visual sidecar result envelope (covers capture identities, attempts, fallback reason, and the embedded validation report).
- `ALLOWED_VISUAL_SIDECAR_FAILURE_CLASSES` — runtime list of policy-readable failure classes for the visual sidecar client (`primary_unavailable`, `primary_quota_exceeded`, `both_sidecars_failed`, `schema_invalid_response`, `image_payload_too_large`, `image_mime_unsupported`, `duplicate_screen_id`, `empty_screen_capture_set`).
- `ALLOWED_VISUAL_SIDECAR_INPUT_MIME_TYPES` — runtime list of MIME types accepted as multimodal sidecar capture input (`image/png`, `image/jpeg`, `image/webp`, `image/gif`). SVG is intentionally excluded because of the XML/injection surface.
- `MAX_VISUAL_SIDECAR_INPUT_BYTES` (`5 * 1024 * 1024`) — maximum decoded byte size of a single capture, enforced after base64 decoding.
- New exported types: `VisualSidecarFailureClass`, `VisualSidecarInputMimeType`, `VisualSidecarCaptureInput`, `VisualSidecarCaptureIdentity`, `VisualSidecarAttempt`, `VisualSidecarSuccess`, `VisualSidecarFailure`, `VisualSidecarResult`, `VisualSidecarResultArtifact`, `Wave1PocEvidenceVisualSidecarSummary`.
- Visual sidecar client (`describeVisualScreens` in `src/test-intelligence/visual-sidecar-client.ts`) — primary→fallback routing over `LlmGatewayClientBundle`, deterministic mock-friendly request shape, hand-rolled JSON-Schema gate on the sidecar envelope, `validateVisualSidecar` integration, atomic artifact persistence, and a defence-in-depth helper `assertNoImagePayloadToTestGeneration` that walks recorded gateway requests for the `test_generation` role.
- `runWave1Poc` accepts an optional `visualCaptures` + `bundle` pair so the POC can produce `VisualScreenDescription[]` from a multimodal sidecar call instead of a fixture JSON. Emits the new `visual-sidecar-result.json` artifact and adds it to the evidence manifest under the new `visual_sidecar` category. Failure results are persisted and manifest-attested before the harness refuses downstream generation. The default fixture-driven path is unchanged.
- `Wave1PocEvidenceManifest.visualSidecar` — optional direct summary of the selected sidecar deployment, fallback reason, confidence summary, and SHA-256 of `visual-sidecar-result.json` when the opt-in sidecar path runs.
- `pnpm run test:ti-live-smoke` — operator-controlled live visual-sidecar smoke test, disabled by default and enabled only with `WORKSPACE_TEST_SPACE_LIVE_SMOKE=1` plus the role-specific `WORKSPACE_TEST_SPACE_*` endpoint/deployment env vars and `WORKSPACE_TEST_SPACE_LLM_API_KEY`.
- `Wave1PocEvidenceArtifactCategory` gains a new variant `"visual_sidecar"`.

### Unchanged (Issue #1386)

- The hard invariant that the structured-test-case generator (`gpt-oss-120b`) never receives image payloads remains stamped at the type level (`imagePayloadSentToTestGeneration: false`).
- `rawScreenshotsIncluded: false` is enforced for both the evidence manifest and the new visual sidecar result artifact: only SHA-256 hashes of the captures are persisted, never the raw bytes.
- Existing `*.visual.json` POC fixtures and golden artifacts are byte-stable; the new sidecar entry point is opt-in.

---

## [3.26.0] - 2026-04-25

### Added (Issue #1367)

- New optional `WorkspaceStartOptions.testIntelligence.reviewBearerToken` and `WorkspaceStartOptions.testIntelligence.artifactRoot` fields. The bearer token gates `POST /workspace/test-intelligence/review/...` write actions fail-closed (503 when unset). The artifact root overrides the default `<outputRoot>/test-intelligence` directory used by the Inspector UI.
- New optional `WorkspaceStatus.testIntelligenceEnabled` boolean exposed from `GET /workspace`. The Inspector UI uses this flag to gate the "Test Intelligence" navigation entry.
- New routes mounted at `/workspace/test-intelligence/...`. All routes return `503 FEATURE_DISABLED` when the existing test-intelligence dual-gate (`FIGMAPIPE_WORKSPACE_TEST_INTELLIGENCE=1` + `WorkspaceStartOptions.testIntelligence.enabled`) is not satisfied:
  - `GET /workspace/test-intelligence/jobs` — list jobs that have on-disk artifacts.
  - `GET /workspace/test-intelligence/jobs/<jobId>` — composite read of the per-job artifact bundle (generated test cases, validation report, policy report, coverage report, visual sidecar report, QC mapping preview, export report, review snapshot, review events). Returns `404 JOB_NOT_FOUND` when no artifact directory exists for the job.
  - `GET /workspace/test-intelligence/review/<jobId>/state` — read the review-gate snapshot and event log via the existing in-process review handler.
  - `POST /workspace/test-intelligence/review/<jobId>/<action>[/<testCaseId>]` — record a review-gate transition (`approve`, `reject`, `edit`, `note`, `review-started`). Bearer-protected fail-closed; rate-limited per IP+jobId.

### Unchanged (Issue #1367)

- Job submission contract is unchanged; `figma_to_qc_test_cases` continues to return `501 NOT_IMPLEMENTED` until a future wave wires the runner.
- The deterministic Figma-to-code pipeline (`llmCodegenMode=deterministic`) is unaffected.
- The hard invariant that the structured-test-case generator deployment never receives image payloads remains stamped in every emitted artifact.

---

## [3.25.0] - 2026-04-25

### Added (Issue #1366)

- `WAVE1_POC_EVIDENCE_MANIFEST_SCHEMA_VERSION`, `WAVE1_POC_EVAL_REPORT_SCHEMA_VERSION` — version stamps (`"1.0.0"`) for the persisted Wave 1 POC evidence manifest and evaluation report.
- `WAVE1_POC_EVIDENCE_MANIFEST_ARTIFACT_FILENAME` (`wave1-poc-evidence-manifest.json`), `WAVE1_POC_EVIDENCE_MANIFEST_DIGEST_FILENAME` (`wave1-poc-evidence-manifest.sha256`), `WAVE1_POC_EVAL_REPORT_ARTIFACT_FILENAME` (`wave1-poc-eval-report.json`) — canonical filenames for the evidence manifest, its digest witness, and the evaluation report artifacts.
- `WAVE1_POC_FIXTURE_IDS` — runtime list of public synthetic fixture identifiers (`poc-onboarding`, `poc-payment-auth`).
- `Wave1PocFixtureId` — discriminated union of the supported fixture identifiers.
- `Wave1PocEvidenceArtifact`, `Wave1PocEvidenceArtifactCategory`, `Wave1PocEvidenceManifest`, `Wave1PocEvidenceVerificationResult` — type surface for the new evidence manifest, including the hard `rawScreenshotsIncluded: false` and `imagePayloadSentToTestGeneration: false` invariants enforced at the type level.
- `Wave1PocEvalThresholds`, `Wave1PocEvalFailure`, `Wave1PocEvalFixtureMetrics`, `Wave1PocEvalFixtureReport`, `Wave1PocEvalReport` — type surface for the evaluation gate covering trace coverage, QC mapping completeness, duplicate similarity, expected results per case, and policy/visual/export gate outcomes.

### Unchanged (Issue #1366)

- No public route, submit parser, runtime schema, or orchestrator wiring changed. The Wave 1 POC harness, evidence manifest builder/verifier, fixture loader, and evaluation gate live entirely under `src/test-intelligence/` and are reached only via the opt-in test-intelligence subsurface.
- The opt-in test-intelligence feature gate (`FIGMAPIPE_WORKSPACE_TEST_INTELLIGENCE`, `WorkspaceStartOptions.testIntelligence.enabled`) remains the only entry-point gate.
- The deterministic Figma-to-code pipeline (`llmCodegenMode=deterministic`) is unaffected.
- The structured-test-case generator deployment (`gpt-oss-120b`) never receives image payloads; image-bearing payloads only flow into the visual sidecar role. The new manifest stamps this invariant explicitly.

---

## [3.24.0] - 2026-04-25

### Added (Issue #1365)

- `REVIEW_GATE_SCHEMA_VERSION`, `QC_MAPPING_PREVIEW_SCHEMA_VERSION`, `EXPORT_REPORT_SCHEMA_VERSION`, `ALM_EXPORT_SCHEMA_VERSION` — version stamps (`"1.0.0"`) for the persisted Wave 1 review gate, QC mapping preview, export-report, and OpenText ALM reference XML artifacts.
- `REVIEW_EVENTS_ARTIFACT_FILENAME`, `REVIEW_STATE_ARTIFACT_FILENAME`, `EXPORT_TESTCASES_JSON_ARTIFACT_FILENAME`, `EXPORT_TESTCASES_CSV_ARTIFACT_FILENAME`, `EXPORT_TESTCASES_XLSX_ARTIFACT_FILENAME`, `EXPORT_TESTCASES_ALM_XML_ARTIFACT_FILENAME`, `QC_MAPPING_PREVIEW_ARTIFACT_FILENAME`, `EXPORT_REPORT_ARTIFACT_FILENAME` — canonical filenames for the eight persisted review-gate and export-only QC artifacts.
- `OPENTEXT_ALM_REFERENCE_PROFILE_ID`, `OPENTEXT_ALM_REFERENCE_PROFILE_VERSION`, `ALM_EXPORT_XML_NAMESPACE` — built-in OpenText ALM reference export profile identity and root XML namespace.
- `ALLOWED_REVIEW_STATES` — runtime list (`generated`, `needs_review`, `approved`, `rejected`, `edited`, `exported`, `transferred`).
- `ALLOWED_REVIEW_EVENT_KINDS` — runtime list (`generated`, `review_started`, `approved`, `rejected`, `edited`, `exported`, `transferred`, `note`).
- `ALLOWED_EXPORT_REFUSAL_CODES` — runtime list of fail-closed refusal codes covering missing approvals, residual unapproved cases, residual policy-blocked cases, residual schema-invalid cases, blocked visual sidecar, and inconsistent review state.
- `ALLOWED_EXPORT_ARTIFACT_CONTENT_TYPES` — runtime list of declared content types (`application/json`, `text/csv`, `application/xml`, `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`).
- `ReviewState`, `ReviewEventKind`, `ReviewEvent`, `ReviewSnapshot`, `ReviewGateSnapshot` — type surface for the persisted review-gate event log and snapshot.
- `ExportRefusalCode`, `ExportArtifactContentType`, `ExportArtifactRecord`, `ExportReportArtifact` — type surface for the persisted export-report artifact, including the hard `rawScreenshotsIncluded: false` invariant.
- `QcMappingVisualProvenance`, `QcMappingPreviewEntry`, `QcMappingPreviewArtifact` — type surface for the QC mapping preview artifact, including model role names, deployment names, schema versions, evidence hashes, and source trace references.
- `OpenTextAlmExportProfile` — operator-tunable knobs for the reference ALM XML export.

### Unchanged (Issue #1365)

- No public route, submit parser, runtime schema, or orchestrator wiring changed. The review gate, export pipeline, and bearer-protected handler live entirely under `src/test-intelligence/`. The handler mirrors the import-session governance bearer pattern (`validateImportSessionEventWriteAuth`) but is invoked through an in-process API so the public HTTP surface is unaffected.
- The opt-in test-intelligence feature gate (`FIGMAPIPE_WORKSPACE_TEST_INTELLIGENCE`, `WorkspaceStartOptions.testIntelligence.enabled`) remains the only entry-point gate; no separate review or export gate is introduced.
- The deterministic Figma-to-code pipeline (`llmCodegenMode=deterministic`) is unaffected; review and export logic is reachable only from the test-intelligence subsurface.
- Production QC/ALM API writes are intentionally out of scope for Wave 1; the export pipeline emits deterministic on-disk artifacts only.

---

## [3.23.0] - 2026-04-25

### Added (Issue #1364)

- `TEST_CASE_VALIDATION_REPORT_SCHEMA_VERSION`, `TEST_CASE_POLICY_REPORT_SCHEMA_VERSION`, `TEST_CASE_COVERAGE_REPORT_SCHEMA_VERSION`, `VISUAL_SIDECAR_VALIDATION_REPORT_SCHEMA_VERSION` — version stamps (`"1.0.0"`) for the persisted Wave 1 validation, policy, coverage, and visual-sidecar gate artifacts.
- `GENERATED_TESTCASES_ARTIFACT_FILENAME`, `TEST_CASE_VALIDATION_REPORT_ARTIFACT_FILENAME`, `TEST_CASE_POLICY_REPORT_ARTIFACT_FILENAME`, `TEST_CASE_COVERAGE_REPORT_ARTIFACT_FILENAME`, `VISUAL_SIDECAR_VALIDATION_REPORT_ARTIFACT_FILENAME` — canonical filenames for the four persisted reports plus the gated test-case payload.
- `EU_BANKING_DEFAULT_POLICY_PROFILE_ID`, `EU_BANKING_DEFAULT_POLICY_PROFILE_VERSION` — built-in `eu-banking-default` policy profile identity stamp shipped with Wave 1.
- `ALLOWED_TEST_CASE_VALIDATION_ISSUE_CODES` — runtime source-of-truth list of semantic / structural validation issue codes consumed by the validation pipeline.
- `ALLOWED_TEST_CASE_POLICY_DECISIONS` — runtime list (`approved`, `blocked`, `needs_review`).
- `ALLOWED_TEST_CASE_POLICY_OUTCOMES` — runtime list of policy outcome codes covering missing-trace, missing-expected-results, PII in test data, missing negative/validation case, missing accessibility/boundary case, schema invalid, duplicate, regulated-risk review, ambiguity review, QC mapping not exportable, low confidence, open questions, plus the visual-sidecar codes (`visual_sidecar_failure`, `visual_sidecar_fallback_used`, `visual_sidecar_low_confidence`, `visual_sidecar_possible_pii`, `visual_sidecar_prompt_injection_text`).
- `ALLOWED_VISUAL_SIDECAR_VALIDATION_OUTCOMES` — runtime list of visual-sidecar gate outcomes (`ok`, `schema_invalid`, `low_confidence`, `fallback_used`, `possible_pii`, `prompt_injection_like_text`, `conflicts_with_figma_metadata`, `primary_unavailable`).
- `TestCaseValidationIssue`, `TestCaseValidationReport`, `TestCaseValidationIssueCode`, `TestCaseValidationSeverity` — type surface for the persisted validation diagnostics.
- `TestCasePolicyDecision`, `TestCasePolicyOutcome`, `TestCasePolicyViolation`, `TestCasePolicyDecisionRecord`, `TestCasePolicyReport`, `TestCasePolicyProfile`, `TestCasePolicyProfileRules` — type surface for the policy gate.
- `TestCaseCoverageBucket`, `TestCaseCoverageReport`, `TestCaseDuplicatePair` — type surface for the coverage / quality-signals report and duplicate detection.
- `VisualSidecarValidationOutcome`, `VisualSidecarValidationRecord`, `VisualSidecarValidationReport` — type surface for the visual-sidecar gate.

### Unchanged (Issue #1364)

- No public route, submit parser, runtime schema, or orchestrator wiring changed. The validation, policy, coverage, and visual-sidecar gate live entirely under `src/test-intelligence/` and are consumed by Issue #1365 (review gate) and Issue #1366 (POC fixture / CI evaluation gate) in later waves.
- The opt-in test-intelligence feature gate (`FIGMAPIPE_WORKSPACE_TEST_INTELLIGENCE`, `WorkspaceStartOptions.testIntelligence.enabled`) remains the only entry-point gate; no separate validation gate is introduced.
- The deterministic Figma-to-code pipeline (`llmCodegenMode=deterministic`) is unaffected; the validation pipeline is reachable only from the test-intelligence subsurface.

---

## [3.22.0] - 2026-04-25

### Added (Issue #1363 follow-up)

- `WorkspaceJobArtifacts.llmCapabilitiesEvidenceDir` — optional public artifact pointer for per-role LLM capability evidence written under the job artifact tree.
- `LlmCapabilityProbeCapability` — probe-row discriminant type that covers declared capability flags plus the mandatory `textChat` baseline probe.
- `STAGE_ARTIFACT_KEYS.llmCapabilitiesEvidence` — internal artifact-store key for role-separated `llm-capabilities.json` evidence directories.

### Changed (Issue #1363 follow-up)

- `LLM_CAPABILITIES_SCHEMA_VERSION` from `"1.0.0"` to `"1.1.0"` because persisted probe rows now include the mandatory `textChat` baseline and no longer mark streaming as supported without network evidence.
- `openai_chat` request construction now uses the documented chat-completions path shape and Chat Completions token-budget field (`max_completion_tokens`).

---

## [3.21.0] - 2026-04-25

### Added (Issue #1363)

- `LLM_GATEWAY_CONTRACT_VERSION` — version stamp (`"1.0.0"`) for the role-separated LLM gateway client surface.
- `LLM_CAPABILITIES_SCHEMA_VERSION` — version stamp (`"1.0.0"`) for the persisted capability probe artifact.
- `LLM_CAPABILITIES_ARTIFACT_FILENAME` — canonical filename (`"llm-capabilities.json"`) for the persisted capability probe artifact.
- `ALLOWED_LLM_GATEWAY_ROLES` — runtime source-of-truth list of role discriminants (`test_generation`, `visual_primary`, `visual_fallback`).
- `ALLOWED_LLM_GATEWAY_COMPATIBILITY_MODES` — runtime source-of-truth list (`openai_chat`); future modes (`openai_responses`, `custom_adapter`) plug in here without changing call sites.
- `ALLOWED_LLM_GATEWAY_AUTH_MODES` — runtime source-of-truth list (`api_key`, `bearer_token`, `none`).
- `ALLOWED_LLM_GATEWAY_ERROR_CLASSES` — runtime source-of-truth list (`refusal`, `schema_invalid`, `incomplete`, `timeout`, `rate_limited`, `transport`, `image_payload_rejected`).
- `LlmGatewayRole`, `LlmGatewayCompatibilityMode`, `LlmGatewayAuthMode`, `LlmGatewayErrorClass` — discriminant types over the allow-lists above.
- `LlmGatewayCapabilities`, `LlmCapabilityProbeOutcome`, `LlmCapabilityProbeRecord`, `LlmCapabilitiesArtifact` — typed shape of the declared/observed capabilities and the persisted `llm-capabilities.json` evidence artifact.
- `LlmGatewayCircuitBreakerConfig`, `LlmGatewayClientConfig` — construction-time configuration shapes. The config object never carries an API token; tokens are read at request time via an injected provider callback.
- `LlmImageInput`, `LlmReasoningEffort`, `LlmGenerationRequest`, `LlmFinishReason`, `LlmGenerationSuccess`, `LlmGenerationFailure`, `LlmGenerationResult` — wire-shaped request/response surface for `LlmGatewayClient.generate`. The success branch never carries chain-of-thought or reasoning traces.

### Unchanged (Issue #1363)

- No runtime schema, submit parser, public route, or orchestrator wiring changed. The gateway client lives entirely under `src/test-intelligence/` and is consumed by Issues #1364 (policy gate), #1365 (review gate), and #1386 (visual sidecar) in later waves.
- The opt-in test-intelligence feature gate (`FIGMAPIPE_WORKSPACE_TEST_INTELLIGENCE`, `WorkspaceStartOptions.testIntelligence.enabled`) remains the only entry-point gate; no separate gateway gate is introduced.
- The deterministic Figma-to-code pipeline (`llmCodegenMode=deterministic`) is unaffected; the gateway client is reachable only from the test-intelligence subsurface.

---

## [3.20.0] - 2026-04-25

### Added (Issue #1362)

- `VISUAL_SIDECAR_SCHEMA_VERSION` — schema version constant (`"1.0.0"`) consumed by the prompt compiler to bind a `VisualScreenDescription` payload to a replay-cache key.
- `REDACTION_POLICY_VERSION` — version stamp (`"1.0.0"`) for the redaction policy bundle hashed into compiled prompt artifacts and replay-cache keys.
- `GeneratedTestCase`, `GeneratedTestCaseList`, `GeneratedTestCaseStep`, `GeneratedTestCaseFigmaTrace`, `GeneratedTestCaseQcMapping`, `GeneratedTestCaseQualitySignals`, `GeneratedTestCaseAuditMetadata`, `GeneratedTestCaseReviewState`, `TestCaseLevel`, `TestCaseType`, `TestCasePriority`, `TestCaseRiskCategory`, `TestCaseTechnique29119` — type surface modeling the structured test-case payload the LLM gateway must produce.
- `CompiledPromptRequest`, `CompiledPromptArtifacts`, `CompiledPromptHashes`, `CompiledPromptVisualBinding`, `CompiledPromptModelBinding`, `VisualSidecarFallbackReason` — type surface emitted by the prompt compiler. The artifacts variant holds only redacted material safe to persist as evidence.
- `ReplayCacheKey`, `ReplayCacheEntry`, `ReplayCacheLookupResult` — type surface for the replay-cache layer. Cache hits are the only guaranteed bit-identical replay path; lookup keys hash input IR, prompt template, JSON schema, model revision, gateway release, policy bundle, redaction policy, visual sidecar binding, fixture image hash, prompt template version, and seed.

### Unchanged (Issue #1362)

- No runtime schema, submit parser, or orchestrator wiring changed. `src/test-intelligence/prompt-compiler.ts`, `src/test-intelligence/generated-test-case-schema.ts`, and `src/test-intelligence/replay-cache.ts` are pure helper surfaces that the LLM gateway client (Issue #1363) and the policy gate (Issue #1364) will compose with in later waves.

---

## [3.19.0] - 2026-04-24

### Added (Issue #1361)

- `BUSINESS_TEST_INTENT_IR_SCHEMA_VERSION` — schema version constant (`"1.0.0"`) for the redacted Business Test Intent IR artifact consumed by the downstream test-case generator.
- `BusinessTestIntentIr`, `BusinessTestIntentIrSource`, `BusinessTestIntentScreen`, `DetectedField`, `DetectedAction`, `DetectedValidation`, `DetectedNavigation`, `InferredBusinessObject`, `PiiIndicator`, `IntentRedaction`, `IntentTraceRef`, `IntentAmbiguity`, `IntentProvenance`, `PiiKind`, `PiiMatchLocation` exported types describing the IR shape, its Figma trace references, provenance, and redaction records.
- `VisualScreenDescription` interface — public type for the optional multimodal visual sidecar consumed alongside Figma input (Issue #1386 preparation).
- `WorkspaceJobArtifacts.businessTestIntentIrFile?: string` — optional public path to the persisted `business-test-intent-ir.json` artifact when the pipeline has derived it.

### Changed (Issue #1361)

- The `ir.derive` stage now persists the redacted Business Test Intent IR artifact through the existing stage artifact store. Runtime submit schema and test-intelligence prompt generation remain unchanged.

---

## [3.18.0] - 2026-04-24

### Added (Issue #1360)

- `WorkspaceStartOptions.testIntelligence?: { enabled: boolean }` — opt-in startup feature gate for Figma-to-QC test case generation.
- `WorkspaceJobInput.jobType?: WorkspaceJobType` with values `"figma_to_code"` (default) and `"figma_to_qc_test_cases"`.
- `WorkspaceJobInput.testIntelligenceMode?: WorkspaceTestIntelligenceMode` — separate mode namespace with values `"deterministic_llm" | "offline_eval" | "dry_run"`, isolated from `llmCodegenMode`.
- `ALLOWED_WORKSPACE_JOB_TYPES` and `ALLOWED_TEST_INTELLIGENCE_MODES` runtime-exported `readonly` arrays, consumed by `src/schemas.ts` to keep the submit parser allowlist in lockstep with the exported types.
- `TEST_INTELLIGENCE_CONTRACT_VERSION`, `GENERATED_TEST_CASE_SCHEMA_VERSION`, `TEST_INTELLIGENCE_PROMPT_TEMPLATE_VERSION` constants — version stamps for the opt-in surface.
- `TEST_INTELLIGENCE_ENV` constant naming the `FIGMAPIPE_WORKSPACE_TEST_INTELLIGENCE` environment gate.
- `FEATURE_DISABLED` error code. `POST /workspace/submit` with `jobType="figma_to_qc_test_cases"` returns `503 FEATURE_DISABLED` when the startup option or environment gate is not enabled and performs no side effects.

### Unchanged (Issue #1360)

- `llmCodegenMode=deterministic` mode-lock validation is unchanged and isolated from the test-intelligence namespace.
- All existing `figma_to_code` submission behavior (including mode-lock, schema validation, and engine submission) is preserved.

### Planned (not in this wave)

- Optional subpath export `workspace-dev/test-intelligence` for the full test-intelligence surface. The current wave exposes the contract surface from the root entry point only.

---

## [3.17.0] - 2026-04-18

### Changed (Issue #638)

- Added `GET /readyz` as a readiness probe. It returns `200` only when the server is fully ready and `503` during startup and graceful shutdown drain.
- Changed `GET /healthz` to return a lifecycle-aware JSON payload `{ status, uptime }` instead of the legacy static shape.
- Added optional `WorkspaceStartOptions.shutdownTimeoutMs` to control graceful shutdown drain timing.

## [3.16.0] - 2026-04-18

### Changed (Issue #1104)

- `WorkspaceJobInput.figmaSourceMode` is now typed as `WorkspaceFigmaSourceMode` (previously loosely `string`).
- `WorkspaceJobInput.llmCodegenMode` is now typed as `WorkspaceLlmCodegenMode` (previously loosely `string`).
- Removed `WorkspaceJobInput.requestSourceMode`. The submit-origin marker was internal metadata; it never belonged on the public submit surface and is now set server-side during ingress normalization. `WorkspaceJobRequestMetadata.requestSourceMode` is unchanged and continues to be persisted for replayable import sessions.

### Added (Issue #1104)

- `ALLOWED_FIGMA_SOURCE_MODES` — runtime-exported `readonly` source-of-truth array for `WorkspaceFigmaSourceMode`. Consumed by `src/schemas.ts` so the submit parser allowlist cannot drift from the exported type.
- `ALLOWED_LLM_CODEGEN_MODES` — runtime-exported `readonly` source-of-truth array for `WorkspaceLlmCodegenMode`. Consumed by `src/schemas.ts` for the same reason.

---

## [3.15.0] - 2026-04-16

### Added

- `WorkspaceStartOptions.importSessionEventBearerToken?: string` to configure authenticated writes for `POST /workspace/import-sessions/:id/events`.

### Changed (3.15.0)

- `POST /workspace/import-sessions/:id/events` is bearer-only and now requires `Authorization: Bearer <token>` matching the configured import-session event token.
- Unauthenticated or invalidly authenticated import-session event writes now return `401` without reading the request body or mutating persisted session state.
- When no import-session event bearer token is configured, `POST /workspace/import-sessions/:id/events` fails closed with `503`.
- Local sync apply and create-PR requests accept optional `reviewerNote` fields so review context can travel with trusted mutation requests; successful local sync writes persist that note on the trusted `applied` event, and successful create-PR writes fold it into the persisted server-authored import-session `note` event.

---

## [3.14.0] - 2026-04-15

### Import session governance scaffolding (Issue #994)

Added (additive only — no `CONTRACT_VERSION` bump beyond the prior `3.14.0`):

- `WorkspaceImportSessionStatus` union (`imported` | `reviewing` | `approved` | `applied` | `rejected`) for the review lifecycle of a persisted import session.
- `WorkspaceImportSessionEventKind` union (`imported` | `review_started` | `approved` | `applied` | `rejected` | `apply_blocked` | `note`) for the audit event taxonomy.
- `WorkspaceImportSessionEvent` carrying `id`, `sessionId`, `kind`, `at`, optional `actor`, optional `note`, and optional JSON-safe `metadata` map.
- `WorkspaceImportSessionEventsResponse` returning an ordered `events` list.
- `WorkspaceImportSession.qualityScore?: number` (integer 0–100) for the persisted Pre-flight Quality Score.
- `WorkspaceImportSession.status?: WorkspaceImportSessionStatus` for the persisted review state.
- `WorkspaceImportSession.reviewRequired?: boolean` for the governance-policy-driven review gate at save time.

Backwards compatibility: legacy `import-sessions.json` envelopes without the new fields continue to round-trip unchanged.

### Audit-trail endpoints (Issue #994)

Added (additive only):

- `GET  /workspace/import-sessions/:id/events` returns `WorkspaceImportSessionEventsResponse` with the ordered audit trail. Responds `404` when the session does not exist.
- `POST /workspace/import-sessions/:id/events` appends one event. Accepts `{ id?, kind, note?, metadata? }`; the server fills `id` when omitted and always stamps `at`. Responds `201` on success, `404` when the session does not exist, `422` on malformed bodies (missing `kind`, unknown `kind`, or nested `metadata`), `405` on other verbs.

Events are persisted under `<outputRoot>/import-session-events/<sessionId>.json`, append-only, rotated at 200 entries, with `note` truncated at 1024 characters. Deleting a session via `DELETE /workspace/import-sessions/:id` also purges the corresponding event file.

---

## [3.13.0] - 2026-04-14

### Added (3.13.0)

- `WorkspaceJobRequestMetadata.importMode` so polling surfaces the requested paste delta mode.
- `WorkspaceJobStatus.pasteDeltaSummary` and `WorkspaceJobResult.pasteDeltaSummary` so final job polling reflects the authoritative delta/full execution outcome instead of only the submit-accepted response.

### Changed (3.13.0)

- `WorkspaceJobLineage.kind` now also allows `"delta"` for submission jobs that safely reused a prior compatible paste import.
- `CONTRACT_VERSION` from `3.12.0` to `3.13.0`.

## [3.12.0] - 2026-04-14

### Incremental delta import scaffolding (Issue #992)

Added:

- `WorkspacePasteDeltaStrategy` union (`baseline_created` | `no_changes` | `delta` | `structural_break`) classifying the tree diff between a prior paste and the current one.
- `WorkspaceImportMode` union (`full` | `delta` | `auto`) for selecting the paste regeneration strategy.
- `WorkspacePasteDeltaSummary` surfacing `mode`, `strategy`, `totalNodes`, `nodesReused`, `nodesReprocessed`, `structuralChangeRatio`, `pasteIdentityKey`, `priorManifestMissing`.
- `WorkspaceJobInput.importMode?: WorkspaceImportMode` for submit-time mode selection.
- `WorkspaceSubmitAccepted.pasteDeltaSummary?: WorkspacePasteDeltaSummary` returned on accepted Figma paste submissions when diff compute succeeds.

Changed:

- `CONTRACT_VERSION` from `3.11.1` to `3.12.0`.

---

## [3.11.1] - 2026-04-13

### Plugin ingress contract alignment

Changed:

- Inspector bootstrap submissions now emit `figmaSourceMode="figma_plugin"` for confirmed plugin-envelope imports instead of collapsing them into `figma_paste`.
- `WorkspaceStatus` schema and public mode documentation now recognize `figma_paste` and `figma_plugin` consistently alongside `rest`, `hybrid`, and `local_json`.
- `figma_plugin` unknown-envelope validation now surfaces `UNSUPPORTED_FORMAT`, while the clipboard-first `figma_paste` path keeps `UNSUPPORTED_CLIPBOARD_KIND` for legacy envelope-version handling.
- Submit acceptance audit logs now expose issue-aligned telemetry aliases `payload_size`, `node_count`, and `runtime_ms` in addition to the existing ingress tracing fields.
- `CONTRACT_VERSION` from `3.11.0` to `3.11.1`.

---

## [3.11.0] - 2026-04-12

### Inspector-initiated Figma paste import

Added:

- `WorkspaceFigmaSourceMode` union member `"figma_paste"` for inline Figma `JSON_REST_V1` payload submission.
- `WorkspaceJobInput.figmaJsonPayload?: string` carrying the inline payload when `figmaSourceMode === "figma_paste"`.
- Submit-time validation surfacing `INVALID_PAYLOAD` / `TOO_LARGE` / `SCHEMA_MISMATCH` error codes for malformed, oversize, or structurally incompatible `figma_paste` payloads before they queue.
- `WORKSPACE_FIGMA_PASTE_MAX_BYTES` env knob (default 6 MiB) for the per-payload cap, still bounded by the submit transport budget.
- `MAX_SUBMIT_BODY_BYTES` constant (8 MiB) scoping the larger body limit to `/workspace/submit`.

Changed:

- `CONTRACT_VERSION` from `3.10.0` to `3.11.0`.

---

## [3.10.0] - 2026-04-09

- Added `WorkspaceConfidenceLevel`, `WorkspaceConfidenceContributor`, `WorkspaceComponentConfidence`, `WorkspaceScreenConfidence`, `WorkspaceJobConfidence` types.
- Added optional `confidence` field to `WorkspaceJobStatus` and `WorkspaceJobResult`.
- Added `confidenceReportFile` to `WorkspaceJobArtifacts`.

## [3.9.0] - 2026-04-09

### Visual quality validation contract

Added:

- `WorkspaceVisualQualityReferenceMode` for selecting `figma_api` or `frozen_fixture` visual references.
- `WorkspaceJobInput.enableVisualQualityValidation?: boolean` for first-class visual quality opt-in.
- `WorkspaceJobInput.visualQualityReferenceMode?: WorkspaceVisualQualityReferenceMode` for submit-time reference source selection.
- `WorkspaceJobInput.visualQualityViewportWidth?: number` for submit-time viewport width overrides.
- Matching `WorkspaceJobRequestMetadata` fields so public job metadata preserves the visual quality request contract.
- `WorkspaceVisualReferenceFixtureMetadata` for persisted frozen visual reference metadata.
- `WorkspaceVisualQualityReport.status`, `referenceSource`, and `capturedAt` for the issue-defined visual quality envelope.
- `WorkspaceVisualQualityReport.message?: string` for non-blocking visual quality failure details.

Changed:

- `WorkspaceVisualQualityReport` now represents an envelope that can report `completed`, `failed`, or `not_requested`.
- `WorkspaceJobInput.visualAudit` remains supported as a deprecated compatibility alias for legacy visual-audit callers.
- `CONTRACT_VERSION` from `3.8.0` to `3.9.0`.

---

## [3.8.0] - 2026-04-09

### Per-job visual quality report integration

Added:

- `WorkspaceJobStatus.visualQuality?: WorkspaceVisualQualityReport` for inline visual quality scores on job polling payloads.
- `WorkspaceJobResult.visualQuality?: WorkspaceVisualQualityReport` for the same on terminal job result payloads.
- `WorkspaceJobArtifacts.visualQualityReportFile?: string` for the visual quality report artifact path.

Changed:

- `CONTRACT_VERSION` from `3.7.0` to `3.8.0`.

---

## [3.7.0] - 2026-04-09

### Visual quality report hardening and metadata completion

Added:

- `WorkspaceVisualQualityReport.diffImagePath` for the persisted visual diff overlay path.
- `WorkspaceVisualComparisonMetadata.viewport` for the capture viewport used during comparison.
- `WorkspaceVisualComparisonMetadata.versions` for the package and contract versions that produced the report.

Changed:

- `CONTRACT_VERSION` from `3.6.0` to `3.7.0`.

---

## [3.6.0] - 2026-04-09

### Visual quality scoring surface

Added:

- `WorkspaceVisualScoringWeights` for configurable scoring dimension weights.
- `WorkspaceVisualDimensionScore` for per-dimension quality scores.
- `WorkspaceVisualDeviationHotspot` for deviation hotspot detection results.
- `WorkspaceVisualComparisonMetadata` for comparison run metadata.
- `WorkspaceVisualQualityReport` for the full visual quality scoring report.

Runtime:

- `DEFAULT_SCORING_WEIGHTS` — default scoring weights (layout 30%, color 25%, typography 20%, component 15%, spacing 10%).
- `DEFAULT_SCORING_CONFIG` — default scoring configuration with weights and hotspot count.
- `computeVisualQualityReport` — produces a structured visual quality report from diff results.
- `interpretScore` — maps a 0–100 score to a human-readable interpretation string.

Changed:

- `CONTRACT_VERSION` from `3.5.0` to `3.6.0`.

---

## [3.5.0] - 2026-04-08

### Public visual audit surface

Added:

- `WorkspaceVisualCaptureConfig` for optional screenshot-capture overrides.
- `WorkspaceVisualDiffConfig` for optional pixel-diff tuning.
- `WorkspaceVisualDiffRegion` for named comparison regions.
- `WorkspaceVisualAuditRegionResult` for region-level visual audit results.
- `WorkspaceVisualAuditStatus` for the runtime state of the optional visual audit flow.
- `WorkspaceVisualAuditInput` as the opt-in submit-time visual audit payload.
- `WorkspaceVisualAuditResult` for the public visual audit outcome exposed on job status/result payloads.
- `WorkspaceJobInput.visualAudit?: WorkspaceVisualAuditInput` for opt-in visual auditing at submit time.
- `WorkspaceJobRequestMetadata.visualAudit?: WorkspaceVisualAuditInput` so public job metadata retains the submitted visual audit settings.
- `WorkspaceJobArtifacts.visualAuditReferenceImageFile?: string` for the copied reference image artifact path.
- `WorkspaceJobArtifacts.visualAuditActualImageFile?: string` for the captured screenshot artifact path.
- `WorkspaceJobArtifacts.visualAuditDiffImageFile?: string` for the generated diff image artifact path.
- `WorkspaceJobArtifacts.visualAuditReportFile?: string` for the structured visual audit report artifact path.
- `WorkspaceJobStatus.visualAudit?: WorkspaceVisualAuditResult` for the public visual audit outcome on job polling payloads.
- `WorkspaceJobResult.visualAudit?: WorkspaceVisualAuditResult` for the same outcome on terminal job result payloads.

Changed:

- `CONTRACT_VERSION` from `3.4.0` to `3.5.0`.

---

## [3.4.0] - 2026-04-02

### Public component mapping override rules

Added:

- `WorkspaceComponentMappingSource` for explicit manual-override rule provenance.
- `WorkspaceComponentMappingRule` as the public component mapping override rule contract shared by submit and regeneration flows.
- `WorkspaceJobInput.componentMappings?: WorkspaceComponentMappingRule[]` for submit-time exact or pattern-based component mapping overrides.
- `WorkspaceJobRequestMetadata.componentMappings?: WorkspaceComponentMappingRule[]` so persisted public job metadata retains submitted component mapping rules.
- `WorkspaceRegenerationInput.componentMappings?: WorkspaceComponentMappingRule[]` so regeneration jobs can replace inherited component mapping overrides.

Changed:

- `CONTRACT_VERSION` from `3.3.0` to `3.4.0`.

---

## [3.3.0] - 2026-03-31

### Storybook-first submit metadata and artifact paths

Added:

- `WorkspaceJobInput.storybookStaticDir?: string` for supplying an optional local Storybook static build directory during submission.
- `WorkspaceJobRequestMetadata.storybookStaticDir?: string` so public job metadata preserves the submitted Storybook static directory without exposing secrets.
- `WorkspaceJobArtifacts.storybookTokensFile?: string` for the curated `storybook.tokens` artifact path.
- `WorkspaceJobArtifacts.storybookThemesFile?: string` for the curated `storybook.themes` artifact path.
- `WorkspaceJobArtifacts.storybookComponentsFile?: string` for the curated `storybook.components` artifact path.
- `WorkspaceJobArtifacts.figmaLibraryResolutionFile?: string` for the public `figma.library_resolution` artifact path when present.
- `WorkspaceJobArtifacts.componentMatchReportFile?: string` for the public `component.match_report` artifact path when present.
- `WorkspaceJobArtifacts.validationSummaryFile?: string` for the structured `validation-summary.json` artifact path produced by `validate.project`.

Changed:

- Submit-time `storybookStaticDir` values are trimmed before they enter persisted request metadata.

---

## [3.2.0] - 2026-03-31

### Public figma.analysis artifact

Added:

- `WorkspaceJobArtifacts.figmaAnalysisFile?: string` for the curated `figma.analysis` artifact path produced by `ir.derive`.
- `GET /workspace/jobs/{jobId}/figma-analysis` to fetch the public `figma.analysis` artifact for completed jobs.

---

## [3.1.0] - 2026-03-31

### Customer profile submit metadata

Added:

- `WorkspaceJobInput.customerProfilePath?: string` for supplying an optional customer profile file path during submission.
- `WorkspaceJobRequestMetadata.customerProfilePath?: string` so public job metadata preserves the submitted customer profile path without exposing secrets.

Changed:

- Submit-time `customerProfilePath` values are trimmed before they enter persisted request metadata.

---

## [3.0.0] - 2026-03-29

### Submit schema validation for codegen mode and generation locale

Changed:

- `POST /workspace/submit` now rejects unsupported `llmCodegenMode` values at the submit schema boundary with `VALIDATION_ERROR` instead of deferring malformed values to downstream mode-lock handling.
- `POST /workspace/submit` now rejects invalid or unsupported `generationLocale` values at the submit schema boundary with `VALIDATION_ERROR` instead of silently falling back at request ingestion time.
- Accepted submit-time locale overrides are canonicalized before they enter the job engine request payload.

---

## [2.29.0] - 2026-03-29

### Command output cap runtime controls

Added:

- `WorkspaceStartOptions.commandStdoutMaxBytes?: number` (default `1048576`) to configure the retained stdout byte budget per pnpm/git command before deterministic truncation and artifact spooling.
- `WorkspaceStartOptions.commandStderrMaxBytes?: number` (default `1048576`) to configure the retained stderr byte budget per pnpm/git command before deterministic truncation and artifact spooling.

---

## [2.28.0] - 2026-03-27

### Configurable pipeline diagnostic limits

Added:

- `WorkspaceStartOptions.pipelineDiagnosticMaxCount?: number` (default `25`) to configure how many structured diagnostics are retained per pipeline error.
- `WorkspaceStartOptions.pipelineDiagnosticTextMaxLength?: number` (default `320`) to configure the maximum message and suggestion length retained per structured diagnostic.
- `WorkspaceStartOptions.pipelineDiagnosticDetailsMaxKeys?: number` (default `30`) to configure how many keys are retained per structured diagnostic details object.
- `WorkspaceStartOptions.pipelineDiagnosticDetailsMaxItems?: number` (default `20`) to configure how many items are retained per structured diagnostic details array.
- `WorkspaceStartOptions.pipelineDiagnosticDetailsMaxDepth?: number` (default `4`) to configure how deeply structured diagnostic details are traversed before deterministic truncation.

---

## [2.27.0] - 2026-03-27

### Configurable structured runtime logging

Added:

- `WorkspaceLogFormat = "text" | "json"` for selecting human-readable or newline-delimited JSON operational logs.
- `WorkspaceStartOptions.logFormat?: WorkspaceLogFormat` (default `text`) to configure runtime log emission for CLI and programmatic server starts.

---

## [2.26.0] - 2026-03-27

### Configurable Figma REST circuit breaker

Added:

- `WorkspaceStartOptions.figmaCircuitBreakerFailureThreshold?: number` (default `3`) to configure how many consecutive transient Figma REST failures open the in-memory circuit breaker.
- `WorkspaceStartOptions.figmaCircuitBreakerResetTimeoutMs?: number` (default `30000`) to configure how long the breaker remains open before allowing a half-open probe request.

---

## [2.25.0] - 2026-03-26

### Per-IP submission rate limiting

Added:

- `WorkspaceStartOptions.rateLimitPerMinute?: number` (default `10`, `0` disables) for per-client job submission throttling across `POST /workspace/submit` and `POST /workspace/jobs/{jobId}/regenerate`.

---

## [2.24.0] - 2026-03-24

### Selectable hybrid Figma source mode

Added:

- `WorkspaceFigmaSourceMode = "rest" | "hybrid" | "local_json"` so clients can explicitly request hybrid REST + MCP-enrichment derivation in addition to pure REST and local JSON modes.

---

## [2.23.0] - 2026-03-23

### Guided remap suggestions for stale draft recovery

Added:

- `WorkspaceStaleDraftDecisionExtended = WorkspaceStaleDraftDecision | "remap"` for stale-draft flows that branch into guided remapping instead of only continue/discard/carry-forward.
- `WorkspaceRemapConfidence`, `WorkspaceRemapRule`, `WorkspaceRemapSuggestion`, `WorkspaceRemapRejection`, `WorkspaceRemapSuggestInput`, `WorkspaceRemapSuggestResult`, and `WorkspaceRemapDecisionEntry` for typed remap-suggestion request/response handling.
- `POST /workspace/jobs/{jobId}/remap-suggest` to generate deterministic remap suggestions between a stale source job and a newer completed job.

---

## [2.22.0] - 2026-03-23

### Advanced validation rule DSL and cross-field editor

Added:

- `validationMin`, `validationMax`, `validationMinLength`, `validationMaxLength`, `validationPattern` — Five new optional override fields for `WorkspaceRegenerationOverrideEntry` enabling advanced per-field validation rules (min/max numeric bounds, string length constraints, regex pattern matching).
- `ValidationRule` / `ValidationRuleType` — New types in `generator-forms.ts` defining the advanced validation rule DSL.
- `validationRules` — New optional field on `InteractiveFieldModel` carrying an array of `ValidationRule` entries.

---

## [2.21.0] - 2026-03-22

### Stale draft detection and carry-forward

Added:

- `WorkspaceStaleDraftDecision` — User decision type for handling a stale draft (`"continue" | "discard" | "carry-forward"`).
- `WorkspaceStaleDraftCheckResult` — Result of a stale-draft check for a given job.
- `POST /workspace/jobs/{jobId}/stale-check` — Endpoint to check whether a draft's source job has been superseded by a newer completed job for the same board key, with carry-forward validation.

---

## [2.20.0] - 2026-03-22

### PR creation from regenerated jobs

Added:

- `WorkspaceCreatePrInput` — Input payload for creating a PR from a completed regeneration job.
- `WorkspaceCreatePrResult` — Result payload returned after PR creation.
- `WorkspaceGitPrPrerequisites` — Prerequisites check result for PR creation.
- `POST /workspace/jobs/{jobId}/create-pr` — Endpoint to create a GitHub PR from regenerated output.

---

## [2.19.0] - 2026-03-22

### Regenerated local sync dry-run/apply contract

Added:

- `WorkspaceLocalSyncMode = "dry_run" | "apply"`
- `WorkspaceLocalSyncDryRunRequest`
- `WorkspaceLocalSyncApplyRequest`
- `WorkspaceLocalSyncRequest`
- `WorkspaceLocalSyncFilePlanEntry`
- `WorkspaceLocalSyncSummary`
- `WorkspaceLocalSyncDryRunResult`
- `WorkspaceLocalSyncApplyResult`

## [2.17.0] - 2026-03-21

### Generation diff report for design iteration cycles

Added:

- `WorkspaceGenerationDiffModifiedFile` type for modified file entries in diff report.
- `WorkspaceGenerationDiffReport` type for full generation diff report.
- `generationDiffFile?: string` to `WorkspaceJobArtifacts` for the diff report file path.
- `generationDiff?: WorkspaceGenerationDiffReport` to `WorkspaceJobStatus` for diff in job status.
- `generationDiff?: WorkspaceGenerationDiffReport` to `WorkspaceJobResult` for diff in job result.

## [2.16.0] - 2026-03-20

### Structured pipeline diagnostics on failed jobs

Added:

- `WorkspaceJobDiagnosticSeverity = "error" | "warning" | "info"`
- `WorkspaceJobDiagnosticValue` recursive JSON-safe value union for diagnostic details
- `WorkspaceJobDiagnostic` payload shape for actionable stage diagnostics
- `WorkspaceJobError.diagnostics?: WorkspaceJobDiagnostic[]` (optional structured diagnostics)

## [2.15.0] - 2026-03-19

### Form handling mode selection for generated forms

Added:

- `WorkspaceFormHandlingMode = "react_hook_form" | "legacy_use_state"`
- `WorkspaceJobInput.formHandlingMode?: WorkspaceFormHandlingMode`
- `WorkspaceJobRequestMetadata.formHandlingMode: WorkspaceFormHandlingMode` (resolved effective mode)

## [2.14.0] - 2026-03-18

### Job cancellation endpoint and queue backpressure controls

Added:

- `WorkspaceStartOptions.maxConcurrentJobs?: number` (default `1`)
- `WorkspaceStartOptions.maxQueuedJobs?: number` (default `20`)
- `WorkspaceJobRuntimeStatus` now also supports `"canceled"`.
- `WorkspaceJobQueueState` and `WorkspaceJobStatus.queue`
- `WorkspaceJobCancellation` and `WorkspaceJobStatus.cancellation`
- `WorkspaceJobResult.cancellation`

## [2.13.0] - 2026-03-18

### Optional unit-test validation gate in runtime configuration

Added:

- `WorkspaceStartOptions.enableUnitTestValidation?: boolean` (default `false`)

## [2.12.0] - 2026-03-18

### Design system config file path for runtime code generation

Added:

- `WorkspaceStartOptions.designSystemFilePath?: string` (default `<outputRoot>/design-system.json`)

## [2.11.0] - 2026-03-17

### Local Figma JSON submit mode

Added:

- `WorkspaceFigmaSourceMode` now also supports `"local_json"`.
- `WorkspaceJobInput.figmaJsonPath?: string` for local JSON ingestion runs.

Changed:

- `WorkspaceJobInput.figmaFileKey` and `figmaAccessToken` are now optional and validated conditionally by `figmaSourceMode`.
- `WorkspaceJobRequestMetadata.figmaFileKey` is now optional and `figmaJsonPath?: string` was added.

## [2.10.0] - 2026-03-17

### Configurable generated app router mode

Added:

- `WorkspaceRouterMode = "browser" | "hash"`
- `WorkspaceStartOptions.routerMode?: WorkspaceRouterMode` (default `browser`)

## [2.9.0] - 2026-03-17

### Configurable generation locale for deterministic select-option derivation

Added:

- `WorkspaceStartOptions.generationLocale?: string` (default `de-DE`)
- `WorkspaceJobInput.generationLocale?: string` (optional per-job override)
- `WorkspaceJobRequestMetadata.generationLocale: string` (resolved effective locale)

## [2.8.0] - 2026-03-17

### Deterministic image export runtime switch

Added:

- `WorkspaceStartOptions.exportImages?: boolean` (default `true`)

## [2.7.0] - 2026-03-17

### Configurable icon fallback map path

Added:

- `WorkspaceStartOptions.iconMapFilePath?: string` (default `<outputRoot>/icon-fallback-map.json`)

## [2.6.0] - 2026-03-16

### Skip-install runtime switch for validate.project

Added:

- `WorkspaceStartOptions.skipInstall?: boolean` (default `false`)

## [2.5.0] - 2026-03-16

### Dynamic IR depth traversal baseline configuration

Added:

- `WorkspaceStartOptions.figmaScreenElementMaxDepth?: number` (default `14`)

## [2.4.0] - 2026-03-16

### Brand theme policy for IR token derivation

Added:

- `WorkspaceBrandTheme = "derived" | "sparkasse"`
- `WorkspaceStartOptions.brandTheme?: WorkspaceBrandTheme` (default `derived`)
- `WorkspaceJobInput.brandTheme?: WorkspaceBrandTheme` (optional per-job override)
- `WorkspaceJobRequestMetadata.brandTheme: WorkspaceBrandTheme` (resolved effective policy)

## [2.3.0] - 2026-03-16

### Staged screen candidate name filter

Added:

- `WorkspaceStartOptions.figmaScreenNamePattern?: string` (default `undefined`)

## [2.2.0] - 2026-03-16

### Figma source cache controls

Added:

- `WorkspaceStartOptions.figmaCacheEnabled?: boolean` (default `true`)
- `WorkspaceStartOptions.figmaCacheTtlMs?: number` (default `900000`)

## [2.1.0] - 2026-03-12

### Parity pipeline + optional git.pr contract

Added:

- New stage names:
  - `template.prepare`
  - `validate.project`
  - `git.pr`
- `WorkspaceJobInput.enableGitPr?: boolean` (`false` by default)
- `WorkspaceGitPrStatus` payload on `WorkspaceJobStatus` and `WorkspaceJobResult`

Changed:

- `WorkspaceJobInput.repoUrl` and `repoToken` are now optional by default.
- `repoUrl`/`repoToken` are required only when `enableGitPr=true`.
- Removed `project.build` stage from public stage contract.

## [2.0.0] - 2026-03-12

### Autonomous generation contract

Breaking changes:

- `POST /workspace/submit` now returns `202 Accepted` and enqueues a real local generation job.
- `WorkspaceJobInput` now requires:
  - `figmaAccessToken`
  - `repoUrl`
  - `repoToken`
- `WorkspaceJobResult` changed from static `not_implemented` envelope to compact job result payload.
- `WorkspaceStatus` now includes:
  - `outputRoot`
  - `previewEnabled`

Added:

- `WorkspaceJobRuntimeStatus`
- `WorkspaceJobStageStatus`
- `WorkspaceJobStageName`
- `WorkspaceSubmitAccepted`
- `WorkspaceJobRequestMetadata`
- `WorkspaceJobStage`
- `WorkspaceJobLog`
- `WorkspaceJobArtifacts`
- `WorkspaceJobError`
- `WorkspaceJobStatus`

New endpoints:

- `GET /workspace/jobs/:id`
- `GET /workspace/jobs/:id/result`
- `GET /workspace/repros/:id/*`

Mode lock remains unchanged:

- `figmaSourceMode=rest`
- `llmCodegenMode=deterministic`

## [1.0.0] - 2026-03-11

### Initial stable contract baseline

Exported types:

- `WorkspaceFigmaSourceMode`
- `WorkspaceLlmCodegenMode`
- `WorkspaceStartOptions`
- `WorkspaceStatus`
- `WorkspaceJobInput`
- `WorkspaceJobResult`
- `WorkspaceVersionInfo`

Exported values:

- `CONTRACT_VERSION` (`"1.0.0"`)

Added:

- `CONTRACT_VERSION` constant for programmatic version checks
- Runtime schema validation on `POST /workspace/submit`
- `VALIDATION_ERROR` envelope for schema validation failures
