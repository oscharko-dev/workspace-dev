/**
 * Controlled OpenText ALM API transfer pipeline tests (Issue #1372 — Wave 3).
 *
 * Acceptance matrix exercised here:
 *   - feature gate / admin gate / bearer-token gate fail-closed,
 *   - mapping profile + provider mismatch refusals,
 *   - dry-run binding (missing / refused / mismatching profile),
 *   - approved-only exportable cases reach the API client,
 *   - idempotency: re-runs do not create duplicates,
 *   - per-case failure isolation,
 *   - four-eyes pending refusal,
 *   - policy_blocked / unapproved_test_cases_present refusals,
 *   - visual sidecar evidence present invariant,
 *   - review_state_inconsistent fails closed,
 *   - forged review state is detected,
 *   - audit metadata records dry-run report id + principal id,
 *   - rollback guidance includes only the created+skipped entries,
 *   - all artifacts stamped with type-level invariants.
 */

import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  ALLOWED_TRANSFER_ENTITY_OUTCOMES,
  ALLOWED_TRANSFER_FAILURE_CLASSES,
  ALLOWED_TRANSFER_REFUSAL_CODES,
  GENERATED_TEST_CASE_SCHEMA_VERSION,
  QC_CREATED_ENTITIES_ARTIFACT_FILENAME,
  QC_CREATED_ENTITIES_SCHEMA_VERSION,
  REVIEW_GATE_SCHEMA_VERSION,
  TEST_INTELLIGENCE_CONTRACT_VERSION,
  TEST_INTELLIGENCE_PROMPT_TEMPLATE_VERSION,
  TRACEABILITY_MATRIX_ARTIFACT_FILENAME,
  TRANSFER_REPORT_ARTIFACT_FILENAME,
  TRANSFER_REPORT_SCHEMA_VERSION,
  VISUAL_SIDECAR_SCHEMA_VERSION,
  VISUAL_SIDECAR_VALIDATION_REPORT_SCHEMA_VERSION,
  type BusinessTestIntentIr,
  type DryRunReportArtifact,
  type GeneratedTestCase,
  type GeneratedTestCaseList,
  type QcMappingPreviewArtifact,
  type ReviewGateSnapshot,
  type ReviewSnapshot,
  type TestCasePolicyReport,
  type VisualSidecarValidationReport,
} from "../contracts/index.js";
import {
  buildTransferRollbackGuidance,
  createUnconfiguredQcApiTransferClient,
  isApiTransferMode,
  NO_CLIENT_CONFIGURED_ERROR_DETAIL,
  QcApiTransferError,
  runOpenTextAlmApiTransfer,
  type QcApiCreatedEntity,
  type QcApiDesignStepRequest,
  type QcApiFolderHandle,
  type QcApiLookupResult,
  type QcApiTransferClient,
  type RunOpenTextAlmApiTransferInput,
  type TransferReviewEventSink,
} from "./qc-alm-api-transfer.js";
import { buildQcMappingPreview } from "./qc-mapping.js";
import {
  createFixedClock,
  DEFAULT_DRY_RUN_ID_SOURCE,
  createOpenTextAlmDryRunAdapter,
} from "./qc-alm-dry-run.js";
import { sha256Hex } from "./content-hash.js";
import { cloneOpenTextAlmDefaultMappingProfile } from "./qc-alm-mapping-profile.js";

const ZERO = "0".repeat(64);
const GENERATED_AT = "2026-04-26T10:00:00.000Z";
const JOB_ID = "job-1372";
const PROFILE = cloneOpenTextAlmDefaultMappingProfile();

const buildIntent = (): BusinessTestIntentIr => ({
  version: "1.0.0",
  source: { kind: "figma_local_json", contentHash: ZERO },
  screens: [
    {
      screenId: "s-payment",
      screenName: "Payment Details",
      trace: { nodeId: "s-payment" },
    },
  ],
  detectedFields: [],
  detectedActions: [],
  detectedValidations: [],
  detectedNavigation: [],
  inferredBusinessObjects: [],
  risks: [],
  assumptions: [],
  openQuestions: [],
  piiIndicators: [],
  redactions: [],
});

const buildCase = (
  overrides: Partial<GeneratedTestCase>,
): GeneratedTestCase => ({
  id: "tc-1",
  sourceJobId: JOB_ID,
  contractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
  schemaVersion: GENERATED_TEST_CASE_SCHEMA_VERSION,
  promptTemplateVersion: TEST_INTELLIGENCE_PROMPT_TEMPLATE_VERSION,
  title: "Pay with valid IBAN",
  objective: "Ensure a valid IBAN is accepted by the payment form.",
  level: "system",
  type: "functional",
  priority: "p1",
  riskCategory: "regulated_data",
  technique: "use_case",
  preconditions: ["Logged-in user"],
  testData: ["IBAN: <redacted>"],
  steps: [
    { index: 1, action: "Open payment form", expected: "Form is visible" },
    { index: 2, action: "Submit", expected: "Payment accepted" },
  ],
  expectedResults: ["Confirmation displayed"],
  figmaTraceRefs: [{ screenId: "s-payment", nodeId: "n-submit" }],
  assumptions: [],
  openQuestions: [],
  qcMappingPreview: { exportable: true },
  qualitySignals: {
    coveredFieldIds: [],
    coveredActionIds: [],
    coveredValidationIds: [],
    coveredNavigationIds: [],
    confidence: 0.9,
  },
  reviewState: "auto_approved",
  audit: {
    jobId: JOB_ID,
    generatedAt: GENERATED_AT,
    contractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
    schemaVersion: GENERATED_TEST_CASE_SCHEMA_VERSION,
    promptTemplateVersion: TEST_INTELLIGENCE_PROMPT_TEMPLATE_VERSION,
    redactionPolicyVersion: "1.0.0",
    visualSidecarSchemaVersion: VISUAL_SIDECAR_SCHEMA_VERSION,
    cacheHit: false,
    cacheKey: "k",
    inputHash: ZERO,
    promptHash: ZERO,
    schemaHash: ZERO,
  },
  ...overrides,
});

const buildList = (cases: GeneratedTestCase[]): GeneratedTestCaseList => ({
  schemaVersion: GENERATED_TEST_CASE_SCHEMA_VERSION,
  jobId: JOB_ID,
  testCases: cases,
});

const emptyPolicy = (): TestCasePolicyReport => ({
  schemaVersion: "1.0.0",
  contractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
  generatedAt: GENERATED_AT,
  jobId: JOB_ID,
  policyProfileId: "eu-banking-default",
  policyProfileVersion: "1.0.0",
  totalTestCases: 0,
  approvedCount: 0,
  blockedCount: 0,
  needsReviewCount: 0,
  blocked: false,
  decisions: [],
  jobLevelViolations: [],
});

const buildPreview = (cases: GeneratedTestCase[]): QcMappingPreviewArtifact =>
  buildQcMappingPreview({
    jobId: JOB_ID,
    generatedAt: GENERATED_AT,
    list: buildList(cases),
    intent: buildIntent(),
    policy: { ...emptyPolicy(), totalTestCases: cases.length },
    profile: {
      id: PROFILE.id,
      version: PROFILE.version,
      description: "OpenText ALM API transfer fixture profile",
      rootFolderPath: PROFILE.targetFolderPath,
      cdataDescription: true,
    },
  });

const snapshotEntry = (overrides: Partial<ReviewSnapshot>): ReviewSnapshot => ({
  testCaseId: "tc-1",
  state: "exported",
  policyDecision: "approved",
  lastEventId: "evt-1",
  lastEventAt: GENERATED_AT,
  fourEyesEnforced: false,
  approvers: [],
  ...overrides,
});

const buildSnapshot = (perTestCase: ReviewSnapshot[]): ReviewGateSnapshot => {
  let approvedCount = 0;
  let needsReviewCount = 0;
  let rejectedCount = 0;
  for (const e of perTestCase) {
    if (
      e.state === "approved" ||
      e.state === "exported" ||
      e.state === "transferred"
    )
      approvedCount += 1;
    else if (e.state === "needs_review" || e.state === "edited")
      needsReviewCount += 1;
    else if (e.state === "rejected") rejectedCount += 1;
  }
  return {
    schemaVersion: REVIEW_GATE_SCHEMA_VERSION,
    contractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
    jobId: JOB_ID,
    generatedAt: GENERATED_AT,
    perTestCase,
    approvedCount,
    needsReviewCount,
    rejectedCount,
  };
};

const visualReport = (): VisualSidecarValidationReport => ({
  schemaVersion: VISUAL_SIDECAR_VALIDATION_REPORT_SCHEMA_VERSION,
  contractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
  visualSidecarSchemaVersion: VISUAL_SIDECAR_SCHEMA_VERSION,
  generatedAt: GENERATED_AT,
  jobId: JOB_ID,
  totalScreens: 1,
  screensWithFindings: 0,
  blocked: false,
  records: [
    {
      screenId: "s-payment",
      deployment: "llama-4-maverick-vision",
      outcomes: ["ok"],
      issues: [],
      meanConfidence: 0.9,
    },
  ],
});

const visualEvidenceHash = (
  visual: VisualSidecarValidationReport = visualReport(),
): string =>
  sha256Hex(
    visual.records
      .slice()
      .sort((a, b) => a.screenId.localeCompare(b.screenId))
      .map(
        (record) =>
          `${record.screenId}|${record.deployment}|${record.outcomes
            .slice()
            .sort()
            .join(",")}|${record.meanConfidence.toFixed(6)}`,
      )
      .join("\n"),
  );

interface MockClientCallLog {
  resolveFolderCalls: number;
  resolvedFolderPaths: string[];
  lookupCalls: { externalId: string; folderPath: string }[];
  createTestEntityCalls: { externalId: string; folderPath: string }[];
  createDesignStepCalls: { qcEntityId: string; index: number }[];
}

interface MockClientOptions {
  preexistingByExternalId?: Record<string, string>;
  // Issue #1696: simulate the partial-write scenario where the entity exists
  // on the tenant but the design-step loop aborted partway through a previous
  // attempt. Maps externalIdCandidate to the count of design steps already
  // present on the tenant.
  preexistingDesignStepCountByExternalId?: Record<string, number>;
  failOnCreate?: {
    externalId: string;
    failureClass?: ConstructorParameters<typeof QcApiTransferError>[0];
    detail?: string;
  };
  failOnLookup?: { externalId: string; detail?: string };
  failOnDesignStep?: { qcEntityId?: string; afterIndex?: number };
  qcEntityIdSeed?: string;
}

const buildMockClient = (
  options: MockClientOptions = {},
): { client: QcApiTransferClient; log: MockClientCallLog } => {
  const log: MockClientCallLog = {
    resolveFolderCalls: 0,
    resolvedFolderPaths: [],
    lookupCalls: [],
    createTestEntityCalls: [],
    createDesignStepCalls: [],
  };
  let counter = 0;
  const seed = options.qcEntityIdSeed ?? "qc-id";
  const client: QcApiTransferClient = {
    resolveFolder: ({ targetFolderPath }) => {
      log.resolveFolderCalls += 1;
      log.resolvedFolderPaths.push(targetFolderPath);
      return {
        qcFolderId: `qc-folder-${log.resolveFolderCalls}`,
        resolvedPath: targetFolderPath,
      };
    },
    lookupByExternalId: ({
      externalIdCandidate,
      folder,
    }): QcApiLookupResult => {
      log.lookupCalls.push({
        externalId: externalIdCandidate,
        folderPath: folder.resolvedPath,
      });
      if (
        options.failOnLookup &&
        options.failOnLookup.externalId === externalIdCandidate
      ) {
        throw new QcApiTransferError(
          "transport_error",
          options.failOnLookup.detail ?? "lookup_failed",
        );
      }
      const hit = options.preexistingByExternalId?.[externalIdCandidate];
      if (hit) {
        const existingDesignStepCount =
          options.preexistingDesignStepCountByExternalId?.[externalIdCandidate];
        return {
          kind: "found",
          qcEntityId: hit,
          ...(existingDesignStepCount !== undefined
            ? { existingDesignStepCount }
            : {}),
        };
      }
      return { kind: "missing" };
    },
    createTestEntity: ({ entry, folder }): QcApiCreatedEntity => {
      log.createTestEntityCalls.push({
        externalId: entry.externalIdCandidate,
        folderPath: folder.resolvedPath,
      });
      if (
        options.failOnCreate &&
        options.failOnCreate.externalId === entry.externalIdCandidate
      ) {
        throw new QcApiTransferError(
          options.failOnCreate.failureClass ?? "validation_rejected",
          options.failOnCreate.detail ?? "create_failed",
        );
      }
      counter += 1;
      return { qcEntityId: `${seed}-${counter}` };
    },
    createDesignStep: ({
      qcEntityId,
      step,
    }: {
      qcEntityId: string;
      step: QcApiDesignStepRequest;
    }) => {
      log.createDesignStepCalls.push({
        qcEntityId,
        index: step.index,
      });
      if (
        options.failOnDesignStep &&
        (options.failOnDesignStep.qcEntityId === undefined ||
          options.failOnDesignStep.qcEntityId === qcEntityId) &&
        (options.failOnDesignStep.afterIndex === undefined ||
          step.index > options.failOnDesignStep.afterIndex)
      ) {
        throw new QcApiTransferError("server_error", "step_failed");
      }
    },
  };
  return { client, log };
};

const buildDryRun = (
  preview: QcMappingPreviewArtifact = buildPreview([buildCase({})]),
  overrides?: Partial<DryRunReportArtifact>,
): DryRunReportArtifact => {
  const adapter = createOpenTextAlmDryRunAdapter();
  // The dry-run adapter is async; for predictable fixtures we synthesise
  // the artifact directly so this helper can stay synchronous and the
  // test reads top-to-bottom.
  return {
    schemaVersion: "1.0.0",
    contractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
    reportId: "dry-run-fixture-id",
    jobId: JOB_ID,
    generatedAt: GENERATED_AT,
    mode: "dry_run",
    adapter: { provider: "opentext_alm", version: adapter.version },
    profile: { id: PROFILE.id, version: PROFILE.version },
    refused: false,
    refusalCodes: [],
    profileValidation: { ok: true, errorCount: 0, warningCount: 0, issues: [] },
    completeness: {
      totalCases: preview.entries.length,
      completeCases: preview.entries.length,
      incompleteCases: 0,
      missingFieldsAcrossCases: [],
      perCase: [],
    },
    folderResolution: {
      state: "simulated",
      path: PROFILE.targetFolderPath,
      evidence: "simulated:matched-segments=2",
    },
    plannedPayloads: preview.entries.map((entry) => ({
      testCaseId: entry.testCaseId,
      externalIdCandidate: entry.externalIdCandidate,
      testEntityType: PROFILE.testEntityType,
      targetFolderPath: entry.targetFolderPath,
      fields: [],
      designStepCount: entry.designSteps.length,
    })),
    visualEvidenceFlags: [],
    rawScreenshotsIncluded: false,
    credentialsIncluded: false,
    ...(overrides ?? {}),
  };
};

const baseInput = (
  overrides: Partial<RunOpenTextAlmApiTransferInput> = {},
): RunOpenTextAlmApiTransferInput => {
  const { client } = buildMockClient();
  const preview = overrides.preview ?? buildPreview([buildCase({})]);
  const dryRun = Object.hasOwn(overrides, "dryRun")
    ? overrides.dryRun
    : buildDryRun(preview);
  return {
    jobId: JOB_ID,
    generatedAt: GENERATED_AT,
    profile: PROFILE,
    preview,
    dryRun,
    reviewSnapshot: buildSnapshot([snapshotEntry({})]),
    visual: visualReport(),
    featureEnabled: true,
    allowApiTransfer: true,
    configuredBearerToken: "secret-bearer",
    callerBearerToken: "secret-bearer",
    client,
    clock: createFixedClock(GENERATED_AT),
    idSource: DEFAULT_DRY_RUN_ID_SOURCE,
    ...overrides,
  };
};

test("api-transfer: contract enums round-trip the public membership", () => {
  for (const code of ALLOWED_TRANSFER_REFUSAL_CODES) {
    assert.equal(typeof code, "string");
  }
  for (const outcome of ALLOWED_TRANSFER_ENTITY_OUTCOMES) {
    assert.equal(typeof outcome, "string");
  }
  for (const failureClass of ALLOWED_TRANSFER_FAILURE_CLASSES) {
    assert.equal(typeof failureClass, "string");
  }
  assert.equal(isApiTransferMode("api_transfer"), true);
  assert.equal(isApiTransferMode("dry_run"), false);
});

test("api-transfer: feature gate disabled fails closed without any client call", async () => {
  const { client, log } = buildMockClient();
  const result = await runOpenTextAlmApiTransfer(
    baseInput({ featureEnabled: false, client }),
  );
  assert.equal(result.refused, true);
  assert.deepEqual(result.refusalCodes.includes("feature_disabled"), true);
  assert.equal(log.resolveFolderCalls, 0);
  assert.equal(log.createTestEntityCalls.length, 0);
  assert.equal(log.createDesignStepCalls.length, 0);
  assert.equal(result.report.refused, true);
  assert.equal(result.createdEntities.entities.length, 0);
});

test("api-transfer: admin gate disabled fails closed", async () => {
  const { client, log } = buildMockClient();
  const result = await runOpenTextAlmApiTransfer(
    baseInput({ allowApiTransfer: false, client }),
  );
  assert.equal(result.refused, true);
  assert.equal(result.refusalCodes.includes("admin_gate_disabled"), true);
  assert.equal(log.resolveFolderCalls, 0);
  assert.equal(log.lookupCalls.length, 0);
  assert.equal(log.createTestEntityCalls.length, 0);
});

test("api-transfer: bearer token missing fails closed (token never configured)", async () => {
  const { client, log } = buildMockClient();
  const result = await runOpenTextAlmApiTransfer(
    baseInput({
      configuredBearerToken: undefined,
      callerBearerToken: undefined,
      client,
    }),
  );
  assert.equal(result.refused, true);
  assert.equal(result.refusalCodes.includes("bearer_token_missing"), true);
  assert.equal(
    result.report.audit.authPrincipalId,
    "transfer-principal:unconfigured",
  );
  assert.equal(log.resolveFolderCalls, 0);
  assert.equal(log.createTestEntityCalls.length, 0);
  assert.equal(result.report.audit.bearerTokenAccepted, false);
});

test("api-transfer: bearer token mismatch fails closed (forged caller token)", async () => {
  const { client, log } = buildMockClient();
  const result = await runOpenTextAlmApiTransfer(
    baseInput({
      configuredBearerToken: "expected-token",
      callerBearerToken: "forged-token",
      client,
    }),
  );
  assert.equal(result.refused, true);
  assert.equal(result.refusalCodes.includes("bearer_token_missing"), true);
  assert.equal(
    result.report.audit.authPrincipalId,
    "transfer-principal:anonymous",
  );
  assert.equal(log.resolveFolderCalls, 0);
  assert.equal(log.createTestEntityCalls.length, 0);
});

test("api-transfer: timing-safe bearer compare matches configured token", async () => {
  const { client } = buildMockClient();
  const result = await runOpenTextAlmApiTransfer(
    baseInput({
      configuredBearerToken: "secret-bearer",
      callerBearerToken: "secret-bearer",
      client,
    }),
  );
  assert.equal(result.refused, false);
  assert.equal(result.report.audit.bearerTokenAccepted, true);
  assert.equal(
    result.report.audit.authPrincipalId,
    "transfer-principal:default",
  );
});

test("api-transfer: principal-bound credentials surface the matching principalId in audit", async () => {
  const { client } = buildMockClient();
  const result = await runOpenTextAlmApiTransfer(
    baseInput({
      configuredBearerToken: undefined,
      transferPrincipals: [
        { principalId: "operator-alpha", bearerToken: "alpha-token" },
        { principalId: "operator-beta", bearerToken: "beta-token" },
      ],
      callerBearerToken: "beta-token",
      client,
    }),
  );
  assert.equal(result.refused, false);
  assert.equal(result.report.audit.authPrincipalId, "operator-beta");
});

test("api-transfer: missing dry-run report fails closed (every gate aggregated)", async () => {
  const { client } = buildMockClient();
  const result = await runOpenTextAlmApiTransfer(
    baseInput({ dryRun: undefined, client }),
  );
  assert.equal(result.refused, true);
  assert.equal(result.refusalCodes.includes("dry_run_missing"), true);
});

test("api-transfer: refused dry-run report fails closed", async () => {
  const { client } = buildMockClient();
  const result = await runOpenTextAlmApiTransfer(
    baseInput({
      dryRun: buildDryRun(undefined, {
        refused: true,
        refusalCodes: ["folder_resolution_failed"],
      }),
      client,
    }),
  );
  assert.equal(result.refused, true);
  assert.equal(result.refusalCodes.includes("dry_run_refused"), true);
});

test("api-transfer: dry-run profile mismatch fails closed", async () => {
  const { client } = buildMockClient();
  const result = await runOpenTextAlmApiTransfer(
    baseInput({
      dryRun: buildDryRun(undefined, {
        profile: { id: "other-profile", version: "9.9.9" },
      }),
      client,
    }),
  );
  assert.equal(result.refused, true);
  assert.equal(result.refusalCodes.includes("dry_run_missing"), true);
});

test("api-transfer: provider mismatch on profile fails closed", async () => {
  const { client } = buildMockClient();
  const result = await runOpenTextAlmApiTransfer(
    baseInput({
      profile: { ...PROFILE, provider: "xray" },
      client,
    }),
  );
  assert.equal(result.refused, true);
  assert.equal(result.refusalCodes.includes("provider_mismatch"), true);
});

test("api-transfer: invalid mapping profile fails closed before folder resolution", async () => {
  const { client, log } = buildMockClient();
  const result = await runOpenTextAlmApiTransfer(
    baseInput({
      profile: {
        ...PROFILE,
        targetFolderPath: "Subject/missing-leading-slash",
      },
      client,
    }),
  );
  assert.equal(result.refused, true);
  assert.equal(result.refusalCodes.includes("mapping_profile_invalid"), true);
  assert.equal(result.refusalCodes.includes("folder_resolution_failed"), true);
  assert.equal(log.resolveFolderCalls, 0);
  assert.equal(log.lookupCalls.length, 0);
  assert.equal(log.createTestEntityCalls.length, 0);
});

test("api-transfer: invalid per-entry target folder fails closed before resolution", async () => {
  const preview = buildPreview([buildCase({})]);
  preview.entries[0] = {
    ...preview.entries[0]!,
    targetFolderPath: "Subject/tampered",
  };
  const { client, log } = buildMockClient();
  const result = await runOpenTextAlmApiTransfer(
    baseInput({
      preview,
      client,
    }),
  );
  assert.equal(result.refused, true);
  assert.equal(result.refusalCodes.includes("folder_resolution_failed"), true);
  assert.equal(log.resolveFolderCalls, 0);
  assert.equal(log.lookupCalls.length, 0);
  assert.equal(log.createTestEntityCalls.length, 0);
});

test("api-transfer: out-of-root per-entry target folder fails closed before resolution", async () => {
  const preview = buildPreview([buildCase({})]);
  preview.entries[0] = {
    ...preview.entries[0]!,
    targetFolderPath: "/Subject/OtherProject/Beta",
  };
  const { client, log } = buildMockClient();
  const result = await runOpenTextAlmApiTransfer(
    baseInput({
      preview,
      client,
    }),
  );
  assert.equal(result.refused, true);
  assert.equal(result.refusalCodes.includes("folder_resolution_failed"), true);
  assert.equal(log.resolveFolderCalls, 0);
  assert.equal(log.lookupCalls.length, 0);
  assert.equal(log.createTestEntityCalls.length, 0);
});

test("api-transfer: dot-only per-entry target folder segments fail closed before resolution", async () => {
  for (const targetFolderPath of [
    "/Subject/Imported/../Other",
    "/Subject/Imported/.",
  ]) {
    const preview = buildPreview([buildCase({})]);
    preview.entries[0] = {
      ...preview.entries[0]!,
      targetFolderPath,
    };
    const { client, log } = buildMockClient();
    const result = await runOpenTextAlmApiTransfer(
      baseInput({
        preview,
        client,
      }),
    );
    assert.equal(result.refused, true);
    assert.equal(
      result.refusalCodes.includes("folder_resolution_failed"),
      true,
    );
    assert.equal(log.resolveFolderCalls, 0);
    assert.equal(log.lookupCalls.length, 0);
    assert.equal(log.createTestEntityCalls.length, 0);
  }
});

test("api-transfer: dry-run payload mismatch fails closed before resolution", async () => {
  const preview = buildPreview([buildCase({})]);
  const dryRun = buildDryRun(preview, {
    plannedPayloads: [
      {
        ...buildDryRun(preview).plannedPayloads[0]!,
        externalIdCandidate: "tampered-external-id",
      },
    ],
  });
  const { client, log } = buildMockClient();
  const result = await runOpenTextAlmApiTransfer(
    baseInput({
      preview,
      dryRun,
      client,
    }),
  );
  assert.equal(result.refused, true);
  assert.equal(result.refusalCodes.includes("dry_run_refused"), true);
  assert.equal(log.resolveFolderCalls, 0);
  assert.equal(log.lookupCalls.length, 0);
});

test("api-transfer: empty preview fails closed (no_mapped_test_cases)", async () => {
  const { client } = buildMockClient();
  const result = await runOpenTextAlmApiTransfer(
    baseInput({
      preview: buildPreview([]),
      reviewSnapshot: buildSnapshot([]),
      client,
    }),
  );
  assert.equal(result.refused, true);
  assert.equal(result.refusalCodes.includes("no_mapped_test_cases"), true);
});

test("api-transfer: needs_review case fails closed (unapproved_test_cases_present)", async () => {
  const { client, log } = buildMockClient();
  const result = await runOpenTextAlmApiTransfer(
    baseInput({
      reviewSnapshot: buildSnapshot([snapshotEntry({ state: "needs_review" })]),
      client,
    }),
  );
  assert.equal(result.refused, true);
  assert.equal(
    result.refusalCodes.includes("unapproved_test_cases_present"),
    true,
  );
  assert.deepEqual(result.refusalCodes, ["unapproved_test_cases_present"]);
  assert.equal(log.resolveFolderCalls, 0);
  assert.equal(log.createTestEntityCalls.length, 0);
});

test("api-transfer: policy-blocked case fails closed", async () => {
  const { client } = buildMockClient();
  const result = await runOpenTextAlmApiTransfer(
    baseInput({
      reviewSnapshot: buildSnapshot([
        snapshotEntry({ policyDecision: "blocked", state: "exported" }),
      ]),
      client,
    }),
  );
  assert.equal(result.refused, true);
  assert.equal(
    result.refusalCodes.includes("policy_blocked_cases_present"),
    true,
  );
});

test("api-transfer: four-eyes pending case fails closed", async () => {
  const { client, log } = buildMockClient();
  const result = await runOpenTextAlmApiTransfer(
    baseInput({
      reviewSnapshot: buildSnapshot([
        snapshotEntry({
          fourEyesEnforced: true,
          state: "pending_secondary_approval",
          fourEyesReasons: ["risk_category"],
        }),
      ]),
      client,
    }),
  );
  assert.equal(result.refused, true);
  assert.equal(result.refusalCodes.includes("four_eyes_pending"), true);
  assert.equal(log.createTestEntityCalls.length, 0);
  assert.deepEqual(result.report.audit.fourEyesReasons, ["risk_category"]);
});

test("api-transfer: review_state_inconsistent — preview entry has no snapshot row", async () => {
  const { client } = buildMockClient();
  const result = await runOpenTextAlmApiTransfer(
    baseInput({
      reviewSnapshot: buildSnapshot([]),
      client,
    }),
  );
  assert.equal(result.refused, true);
  assert.equal(result.refusalCodes.includes("review_state_inconsistent"), true);
});

test("api-transfer: forged review state with policy_decision=approved but state=rejected → fails closed", async () => {
  // The policy decision is approved but the actor flipped state to rejected.
  // The orchestrator must NOT consider this approved; it should refuse.
  const { client, log } = buildMockClient();
  const result = await runOpenTextAlmApiTransfer(
    baseInput({
      reviewSnapshot: buildSnapshot([
        snapshotEntry({ state: "rejected", policyDecision: "approved" }),
      ]),
      client,
    }),
  );
  assert.equal(result.refused, true);
  assert.equal(
    result.refusalCodes.includes("unapproved_test_cases_present"),
    true,
  );
  assert.deepEqual(result.refusalCodes, ["unapproved_test_cases_present"]);
  assert.equal(log.resolveFolderCalls, 0);
  assert.equal(log.createTestEntityCalls.length, 0);
});

test("api-transfer: happy path — exported case is created with deterministic step ordering", async () => {
  const { client, log } = buildMockClient();
  const result = await runOpenTextAlmApiTransfer(baseInput({ client }));
  assert.equal(result.refused, false);
  assert.deepEqual(result.refusalCodes, []);
  assert.equal(result.report.records.length, 1);
  assert.equal(result.report.records[0]?.outcome, "created");
  assert.equal(result.report.createdCount, 1);
  assert.equal(result.report.skippedDuplicateCount, 0);
  assert.equal(result.report.failedCount, 0);
  assert.notEqual(result.report.audit.evidenceReferences.dryRunReportHash, "");
  assert.notEqual(
    result.report.audit.evidenceReferences.qcMappingPreviewHash,
    "",
  );
  assert.equal(result.createdEntities.entities.length, 1);
  assert.equal(result.createdEntities.entities[0]?.preExisting, false);
  assert.equal(log.lookupCalls.length, 1);
  assert.equal(log.createTestEntityCalls.length, 1);
  assert.equal(log.createDesignStepCalls.length, 2);
  assert.deepEqual(
    log.createDesignStepCalls.map((c) => c.index),
    [1, 2],
  );
  // Type-level invariants on the artifacts.
  assert.equal(result.report.rawScreenshotsIncluded, false);
  assert.equal(result.report.credentialsIncluded, false);
  assert.equal(result.report.transferUrlIncluded, false);
  assert.equal(result.createdEntities.transferUrlIncluded, false);
});

test("api-transfer: resolves distinct target folders before deterministic transfer", async () => {
  const cases = [buildCase({ id: "tc-1" }), buildCase({ id: "tc-2" })];
  const preview = buildPreview(cases);
  preview.entries[0] = {
    ...preview.entries[0]!,
    targetFolderPath: "/Subject/Imported/Alpha",
  };
  preview.entries[1] = {
    ...preview.entries[1]!,
    targetFolderPath: "/Subject/Imported/Beta",
  };
  const { client, log } = buildMockClient();
  const result = await runOpenTextAlmApiTransfer(
    baseInput({
      preview,
      reviewSnapshot: buildSnapshot([
        snapshotEntry({ testCaseId: "tc-1" }),
        snapshotEntry({ testCaseId: "tc-2" }),
      ]),
      client,
    }),
  );
  assert.equal(result.refused, false);
  assert.deepEqual(log.resolvedFolderPaths, [
    "/Subject/Imported/Alpha",
    "/Subject/Imported/Beta",
  ]);
  assert.deepEqual(
    log.lookupCalls.map((call) => call.folderPath),
    ["/Subject/Imported/Alpha", "/Subject/Imported/Beta"],
  );
  assert.deepEqual(
    result.report.records.map((record) => record.targetFolderPath),
    ["/Subject/Imported/Alpha", "/Subject/Imported/Beta"],
  );
});

test("api-transfer: idempotent re-run skips duplicate entities and never creates", async () => {
  const preview = buildPreview([buildCase({})]);
  const externalId = preview.entries[0]?.externalIdCandidate ?? "";
  assert.notEqual(externalId, "");
  const { client, log } = buildMockClient({
    preexistingByExternalId: { [externalId]: "qc-already-existing" },
  });
  const result = await runOpenTextAlmApiTransfer(
    baseInput({ preview, client }),
  );
  assert.equal(result.refused, false);
  assert.equal(result.report.records[0]?.outcome, "skipped_duplicate");
  assert.equal(result.report.records[0]?.qcEntityId, "qc-already-existing");
  assert.equal(result.report.skippedDuplicateCount, 1);
  assert.equal(result.report.createdCount, 0);
  assert.equal(log.createTestEntityCalls.length, 0);
  assert.equal(log.createDesignStepCalls.length, 0);
  assert.equal(result.createdEntities.entities[0]?.preExisting, true);
});

test("api-transfer: per-case create failure isolates and continues other cases", async () => {
  const cases = [buildCase({ id: "tc-1" }), buildCase({ id: "tc-2" })];
  const preview = buildPreview(cases);
  const failExternalId = preview.entries[0]?.externalIdCandidate ?? "";
  const { client } = buildMockClient({
    failOnCreate: {
      externalId: failExternalId,
      failureClass: "validation_rejected",
    },
  });
  const result = await runOpenTextAlmApiTransfer(
    baseInput({
      preview,
      reviewSnapshot: buildSnapshot([
        snapshotEntry({ testCaseId: "tc-1" }),
        snapshotEntry({ testCaseId: "tc-2" }),
      ]),
      client,
    }),
  );
  assert.equal(result.refused, false);
  assert.equal(result.report.records.length, 2);
  const failedRecord = result.report.records.find(
    (r) => r.outcome === "failed",
  );
  const createdRecord = result.report.records.find(
    (r) => r.outcome === "created",
  );
  assert.ok(failedRecord);
  assert.ok(createdRecord);
  assert.equal(failedRecord?.failureClass, "validation_rejected");
  assert.equal(failedRecord?.qcEntityId, "");
  assert.equal(failedRecord?.designStepsCreated, 0);
  // Only the successful case was persisted to qc-created-entities.
  assert.equal(result.createdEntities.entities.length, 1);
  assert.equal(result.report.failedCount, 1);
  assert.equal(result.report.createdCount, 1);
});

// Issue #1696 (audit-2026-05 Wave 2): partial-write recovery on rerun.
test("api-transfer: resumes design-step loop when tenant has incomplete entity", async () => {
  // Use the standard 3-step preview so we can simulate "first attempt
  // succeeded for the entity and 1 of 3 steps; rerun must add the missing 2".
  const preview = buildPreview([buildCase({ id: "tc-1" })]);
  const externalId = preview.entries[0]?.externalIdCandidate ?? "";
  assert.notEqual(externalId, "");
  const totalSteps = preview.entries[0]?.designSteps.length ?? 0;
  assert.ok(totalSteps >= 2, "fixture must produce >=2 design steps");
  const alreadyPersisted = 1;
  const { client, log } = buildMockClient({
    preexistingByExternalId: { [externalId]: "qc-already-existing" },
    preexistingDesignStepCountByExternalId: { [externalId]: alreadyPersisted },
  });
  const result = await runOpenTextAlmApiTransfer(
    baseInput({ preview, client }),
  );
  assert.equal(result.refused, false);
  // Recovery path now reports `created` (steps were added on the tenant) and
  // never short-circuits to `skipped_duplicate` — that is the silent-data-loss
  // bug the issue closes.
  assert.equal(result.report.records[0]?.outcome, "created");
  assert.equal(result.report.records[0]?.qcEntityId, "qc-already-existing");
  assert.equal(
    result.report.records[0]?.designStepsCreated,
    totalSteps - alreadyPersisted,
  );
  // No new entity was created; the orchestrator only added the missing
  // design steps on the existing entity.
  assert.equal(log.createTestEntityCalls.length, 0);
  assert.equal(log.createDesignStepCalls.length, totalSteps - alreadyPersisted);
  // The recovered design steps must be the tail of the sorted-by-index
  // sequence (steps 2..N when 1 was already persisted).
  const expectedIndices = Array.from(
    { length: totalSteps - alreadyPersisted },
    (_, i) => alreadyPersisted + 1 + i,
  );
  assert.deepEqual(
    log.createDesignStepCalls.map((call) => call.index),
    expectedIndices,
  );
});

test("api-transfer: lookup with matching design-step count short-circuits to skipped_duplicate", async () => {
  const preview = buildPreview([buildCase({ id: "tc-1" })]);
  const externalId = preview.entries[0]?.externalIdCandidate ?? "";
  const totalSteps = preview.entries[0]?.designSteps.length ?? 0;
  const { client, log } = buildMockClient({
    preexistingByExternalId: { [externalId]: "qc-already-existing" },
    preexistingDesignStepCountByExternalId: { [externalId]: totalSteps },
  });
  const result = await runOpenTextAlmApiTransfer(
    baseInput({ preview, client }),
  );
  assert.equal(result.report.records[0]?.outcome, "skipped_duplicate");
  assert.equal(log.createDesignStepCalls.length, 0);
});

test("api-transfer: legacy lookup omitting existingDesignStepCount preserves skipped_duplicate fast path", async () => {
  const preview = buildPreview([buildCase({ id: "tc-1" })]);
  const externalId = preview.entries[0]?.externalIdCandidate ?? "";
  const { client, log } = buildMockClient({
    preexistingByExternalId: { [externalId]: "qc-already-existing" },
    // existingDesignStepCount intentionally omitted — legacy adapter shape.
  });
  const result = await runOpenTextAlmApiTransfer(
    baseInput({ preview, client }),
  );
  assert.equal(result.report.records[0]?.outcome, "skipped_duplicate");
  assert.equal(log.createDesignStepCalls.length, 0);
});

test("api-transfer: per-step failure records partial designStepsCreated count", async () => {
  const { client } = buildMockClient({
    failOnDesignStep: { afterIndex: 1 },
  });
  const result = await runOpenTextAlmApiTransfer(baseInput({ client }));
  assert.equal(result.report.records[0]?.outcome, "failed");
  assert.equal(result.report.records[0]?.designStepsCreated, 1);
  assert.equal(result.report.records[0]?.failureClass, "server_error");
  const guidance = buildTransferRollbackGuidance(result.report);
  assert.equal(guidance.removalHints.length, 1);
  assert.equal(guidance.removalHints[0]?.qcEntityId, "qc-id-1");
  // The entity already exists on the tenant because createTestEntity
  // succeeded; the caller MUST run rollback or rely on idempotency on
  // the next attempt — neither is the orchestrator's responsibility.
});

test("api-transfer: failure detail strips URLs and high-risk secrets", async () => {
  const { client } = buildMockClient({
    failOnCreate: {
      externalId:
        buildPreview([buildCase({})]).entries[0]?.externalIdCandidate ?? "",
      detail: "https://alm.internal/api/v1/test-1234?token=secret-shibboleth",
    },
  });
  const result = await runOpenTextAlmApiTransfer(baseInput({ client }));
  const detail = result.report.records[0]?.failureDetail ?? "";
  assert.ok(!detail.includes("https://"));
  assert.ok(!detail.includes("secret-shibboleth"));
  assert.ok(detail.includes("[REDACTED_URL]") || detail.includes("[REDACTED]"));
});

test("api-transfer: visual sidecar evidence missing for visual-driven case fails closed", async () => {
  const visualCase = buildCase({});
  const preview = buildPreview([visualCase]);
  // Inject visual provenance so the case is "visual-driven" but provide
  // no matching record in the visual report.
  preview.entries[0] = {
    ...preview.entries[0]!,
    visualProvenance: {
      deployment: "llama-4-maverick-vision",
      fallbackReason: "primary_used",
      confidenceMean: 0.9,
      ambiguityCount: 0,
      evidenceHash: visualEvidenceHash(),
    },
  };
  const { client } = buildMockClient();
  const result = await runOpenTextAlmApiTransfer(
    baseInput({
      preview,
      visual: undefined,
      client,
    }),
  );
  assert.equal(result.refused, true);
  assert.equal(
    result.refusalCodes.includes("visual_sidecar_evidence_missing"),
    true,
  );
});

test("api-transfer: blocked visual sidecar report fails closed", async () => {
  const preview = buildPreview([buildCase({})]);
  preview.entries[0] = {
    ...preview.entries[0]!,
    visualProvenance: {
      deployment: "llama-4-maverick-vision",
      fallbackReason: "primary_used",
      confidenceMean: 0.9,
      ambiguityCount: 0,
      evidenceHash: visualEvidenceHash(),
    },
  };
  const { client, log } = buildMockClient();
  const result = await runOpenTextAlmApiTransfer(
    baseInput({
      preview,
      visual: { ...visualReport(), blocked: true },
      client,
    }),
  );
  assert.equal(result.refused, true);
  assert.equal(result.refusalCodes.includes("visual_sidecar_blocked"), true);
  assert.equal(log.resolveFolderCalls, 0);
});

test("api-transfer: visual provenance without trace refs fails closed", async () => {
  const preview = buildPreview([buildCase({})]);
  preview.entries[0] = {
    ...preview.entries[0]!,
    sourceTraceRefs: [],
    visualProvenance: {
      deployment: "llama-4-maverick-vision",
      fallbackReason: "primary_used",
      confidenceMean: 0.9,
      ambiguityCount: 0,
      evidenceHash: visualEvidenceHash(),
    },
  };
  const { client, log } = buildMockClient();
  const result = await runOpenTextAlmApiTransfer(
    baseInput({
      preview,
      client,
    }),
  );
  assert.equal(result.refused, true);
  assert.equal(
    result.refusalCodes.includes("visual_sidecar_evidence_missing"),
    true,
  );
  assert.equal(log.resolveFolderCalls, 0);
  assert.equal(log.lookupCalls.length, 0);
  assert.equal(log.createTestEntityCalls.length, 0);
});

test("api-transfer: stale visual sidecar evidence hash fails closed", async () => {
  const preview = buildPreview([buildCase({})]);
  preview.entries[0] = {
    ...preview.entries[0]!,
    visualProvenance: {
      deployment: "llama-4-maverick-vision",
      fallbackReason: "primary_used",
      confidenceMean: 0.9,
      ambiguityCount: 0,
      evidenceHash: visualEvidenceHash(),
    },
  };
  const staleVisual = {
    ...visualReport(),
    records: [{ ...visualReport().records[0]!, meanConfidence: 0.5 }],
  };
  const { client, log } = buildMockClient();
  const result = await runOpenTextAlmApiTransfer(
    baseInput({
      preview,
      visual: staleVisual,
      client,
    }),
  );
  assert.equal(result.refused, true);
  assert.equal(
    result.refusalCodes.includes("visual_sidecar_evidence_missing"),
    true,
  );
  assert.equal(log.resolveFolderCalls, 0);
});

test("api-transfer: stale same-screen visual report from different job fails closed", async () => {
  const staleVisual = { ...visualReport(), jobId: "old-job" };
  const preview = buildPreview([buildCase({})]);
  preview.entries[0] = {
    ...preview.entries[0]!,
    visualProvenance: {
      deployment: "llama-4-maverick-vision",
      fallbackReason: "primary_used",
      confidenceMean: 0.9,
      ambiguityCount: 0,
      evidenceHash: visualEvidenceHash(staleVisual),
    },
  };
  const { client, log } = buildMockClient();
  const result = await runOpenTextAlmApiTransfer(
    baseInput({
      preview,
      visual: staleVisual,
      client,
    }),
  );
  assert.equal(result.refused, true);
  assert.equal(
    result.refusalCodes.includes("visual_sidecar_evidence_missing"),
    true,
  );
  assert.equal(log.resolveFolderCalls, 0);
  assert.equal(log.lookupCalls.length, 0);
  assert.equal(log.createTestEntityCalls.length, 0);
});

test("api-transfer: visual-driven case transfers when sidecar evidence matches", async () => {
  const preview = buildPreview([buildCase({})]);
  preview.entries[0] = {
    ...preview.entries[0]!,
    visualProvenance: {
      deployment: "llama-4-maverick-vision",
      fallbackReason: "primary_used",
      confidenceMean: 0.9,
      ambiguityCount: 0,
      evidenceHash: visualEvidenceHash(),
    },
  };
  const { client } = buildMockClient();
  const result = await runOpenTextAlmApiTransfer(
    baseInput({
      preview,
      client,
      evidenceReferences: {
        generationOutputHash: "1".repeat(64),
        reconciledIntentIrHash: "2".repeat(64),
      },
    }),
  );
  assert.equal(result.refused, false);
  assert.equal(result.report.createdCount, 1);
  assert.deepEqual(
    result.report.audit.evidenceReferences.visualSidecarEvidenceHashes,
    [visualEvidenceHash()],
  );
  assert.equal(
    result.report.audit.evidenceReferences.generationOutputHash,
    "1".repeat(64),
  );
  assert.equal(
    result.report.audit.evidenceReferences.reconciledIntentIrHash,
    "2".repeat(64),
  );
});

test("api-transfer: review event sink receives one transferred event per success", async () => {
  const events: Array<{ testCaseId: string; qcEntityId: string }> = [];
  const sink: TransferReviewEventSink = {
    appendTransferred: (input) => {
      events.push({
        testCaseId: input.testCaseId,
        qcEntityId: input.qcEntityId,
      });
    },
  };
  const { client } = buildMockClient();
  const result = await runOpenTextAlmApiTransfer(
    baseInput({ client, reviewEventSink: sink }),
  );
  assert.equal(result.refused, false);
  assert.equal(events.length, 1);
  assert.equal(events[0]?.testCaseId, "tc-1");
});

test("api-transfer: review event sink failure keeps outcome=created and notes failure_detail", async () => {
  const sink: TransferReviewEventSink = {
    appendTransferred: () => {
      throw new Error("sink dead");
    },
  };
  const { client } = buildMockClient();
  const result = await runOpenTextAlmApiTransfer(
    baseInput({ client, reviewEventSink: sink }),
  );
  assert.equal(result.refused, false);
  assert.equal(result.report.records[0]?.outcome, "created");
  assert.equal(
    result.report.records[0]?.failureDetail,
    "review_event_sink_failed",
  );
});

test("api-transfer: artifacts persist atomically under artifactRoot", async () => {
  const dir = await mkdtemp(join(tmpdir(), "api-transfer-"));
  try {
    const { client } = buildMockClient();
    const result = await runOpenTextAlmApiTransfer(
      baseInput({
        client,
        artifactRoot: dir,
        traceability: {
          intent: buildIntent(),
          list: buildList([buildCase({})]),
          policyProfile: { id: "eu-banking-default", version: "1.0.0" },
        },
      }),
    );
    assert.equal(
      result.reportPath,
      join(dir, TRANSFER_REPORT_ARTIFACT_FILENAME),
    );
    assert.equal(
      result.createdEntitiesPath,
      join(dir, QC_CREATED_ENTITIES_ARTIFACT_FILENAME),
    );
    assert.equal(
      result.traceabilityMatrixPath,
      join(dir, TRACEABILITY_MATRIX_ARTIFACT_FILENAME),
    );
    const reportRaw = await readFile(result.reportPath!, "utf8");
    const createdRaw = await readFile(result.createdEntitiesPath!, "utf8");
    const traceabilityRaw = await readFile(
      result.traceabilityMatrixPath!,
      "utf8",
    );
    for (const raw of [reportRaw, createdRaw]) {
      assert.equal(raw.includes("secret-bearer"), false);
      assert.equal(raw.includes("Bearer "), false);
      assert.equal(/https?:\/\//.test(raw), false);
    }
    const report = JSON.parse(reportRaw);
    const created = JSON.parse(createdRaw);
    assert.equal(report.schemaVersion, TRANSFER_REPORT_SCHEMA_VERSION);
    assert.equal(report.contractVersion, TEST_INTELLIGENCE_CONTRACT_VERSION);
    assert.equal(created.schemaVersion, QC_CREATED_ENTITIES_SCHEMA_VERSION);
    assert.equal(created.contractVersion, TEST_INTELLIGENCE_CONTRACT_VERSION);
    assert.equal(report.transferUrlIncluded, false);
    assert.equal(created.transferUrlIncluded, false);
    assert.equal(report.audit.dryRunReportId, "dry-run-fixture-id");
    const traceability = JSON.parse(traceabilityRaw);
    assert.equal(traceability.rows[0]?.qcEntityId, "qc-id-1");
    assert.equal(traceability.rows[0]?.transferOutcome, "created");
    assert.equal(traceability.rows[0]?.steps.length, 2);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("api-transfer: evidence reference overrides must be sha256 hashes", async () => {
  const dir = await mkdtemp(join(tmpdir(), "api-transfer-evidence-"));
  try {
    const { client } = buildMockClient();
    const result = await runOpenTextAlmApiTransfer(
      baseInput({
        client,
        artifactRoot: dir,
        evidenceReferences: {
          qcMappingPreviewHash: "5".repeat(64),
          dryRunReportHash: "6".repeat(64),
          visualSidecarReportHash: "7".repeat(64),
          visualSidecarEvidenceHashes: ["Bearer secret-bearer", "3".repeat(64)],
          generationOutputHash: "https://example.invalid/generated",
          reconciledIntentIrHash: "4".repeat(64),
        },
      }),
    );
    const reportRaw = await readFile(result.reportPath!, "utf8");
    assert.equal(reportRaw.includes("secret-bearer"), false);
    assert.equal(reportRaw.includes("Bearer "), false);
    assert.equal(/https?:\/\//.test(reportRaw), false);

    const refs = JSON.parse(reportRaw).audit.evidenceReferences;
    assert.match(refs.qcMappingPreviewHash, /^[a-f0-9]{64}$/);
    assert.match(refs.dryRunReportHash, /^[a-f0-9]{64}$/);
    assert.match(refs.visualSidecarReportHash, /^[a-f0-9]{64}$/);
    assert.notEqual(refs.qcMappingPreviewHash, "5".repeat(64));
    assert.notEqual(refs.dryRunReportHash, "6".repeat(64));
    assert.notEqual(refs.visualSidecarReportHash, "7".repeat(64));
    assert.deepEqual(refs.visualSidecarEvidenceHashes, []);
    assert.equal("generationOutputHash" in refs, false);
    assert.equal(refs.reconciledIntentIrHash, "4".repeat(64));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("api-transfer: rollback guidance contains only created+skipped entries", async () => {
  const cases = [buildCase({ id: "tc-1" }), buildCase({ id: "tc-2" })];
  const preview = buildPreview(cases);
  const dupExternalId = preview.entries[0]?.externalIdCandidate ?? "";
  const { client } = buildMockClient({
    preexistingByExternalId: { [dupExternalId]: "qc-existing" },
  });
  const result = await runOpenTextAlmApiTransfer(
    baseInput({
      preview,
      reviewSnapshot: buildSnapshot([
        snapshotEntry({ testCaseId: "tc-1" }),
        snapshotEntry({ testCaseId: "tc-2" }),
      ]),
      client,
    }),
  );
  const guidance = buildTransferRollbackGuidance(result.report);
  assert.equal(guidance.removalHints.length, 1);
  assert.equal(guidance.auditHints.length, 1);
  assert.equal(guidance.removalHints[0]?.testCaseId, "tc-2");
  assert.equal(guidance.auditHints[0]?.testCaseId, "tc-1");
  assert.equal(guidance.generalNotes.length >= 4, true);
});

test("api-transfer: unconfigured client throws permission_denied through QcApiTransferError", async () => {
  const client = createUnconfiguredQcApiTransferClient();
  await assert.rejects(
    async () =>
      Promise.resolve(
        client.resolveFolder({
          profile: PROFILE,
          targetFolderPath: PROFILE.targetFolderPath,
          bearerToken: "x",
        }),
      ),
    (err: unknown) => {
      assert.ok(err instanceof QcApiTransferError);
      assert.equal(err.failureClass, "permission_denied");
      assert.equal(err.detail, NO_CLIENT_CONFIGURED_ERROR_DETAIL);
      return true;
    },
  );
});

test("api-transfer: orchestrator throws programmer error when client missing", async () => {
  await assert.rejects(
    async () =>
      runOpenTextAlmApiTransfer({
        ...baseInput(),
        // @ts-expect-error — testing the runtime guard
        client: undefined,
      }),
    /input\.client is required/,
  );
});

test("api-transfer: report ids are deterministic for fixed clock + idSource", async () => {
  const a = await runOpenTextAlmApiTransfer(baseInput());
  const b = await runOpenTextAlmApiTransfer(baseInput());
  assert.equal(a.report.reportId, b.report.reportId);
});

test("api-transfer: multiple refusals are reported in one cycle (sorted, deduped)", async () => {
  const { client } = buildMockClient();
  const result = await runOpenTextAlmApiTransfer(
    baseInput({
      featureEnabled: false,
      allowApiTransfer: false,
      configuredBearerToken: undefined,
      callerBearerToken: undefined,
      dryRun: undefined,
      profile: { ...PROFILE, provider: "xray" },
      preview: buildPreview([]),
      reviewSnapshot: buildSnapshot([]),
      client,
    }),
  );
  assert.equal(result.refused, true);
  // sorted + deduped
  const codes = result.refusalCodes;
  assert.deepEqual(codes, [...codes].sort());
  assert.equal(new Set(codes).size, codes.length);
  for (const expected of [
    "feature_disabled",
    "admin_gate_disabled",
    "bearer_token_missing",
    "provider_mismatch",
    "dry_run_missing",
    "no_mapped_test_cases",
  ]) {
    assert.equal(
      codes.includes(expected as never),
      true,
      `missing ${expected}`,
    );
  }
});
