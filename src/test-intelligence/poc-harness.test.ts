import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  GENEALOGY_ARTIFACT_FILENAME,
  BUSINESS_TEST_INTENT_IR_SCHEMA_VERSION,
  FINOPS_ARTIFACT_DIRECTORY,
  FINOPS_BUDGET_REPORT_ARTIFACT_FILENAME,
  GENERATED_TEST_CASE_SCHEMA_VERSION,
  type FinOpsBudgetReport,
  LBOM_ARTIFACT_DIRECTORY,
  LBOM_ARTIFACT_FILENAME,
  LBOM_ARTIFACT_SCHEMA_VERSION,
  LBOM_CYCLONEDX_SPEC_VERSION,
  TEST_INTELLIGENCE_CONTRACT_VERSION,
  TEST_INTELLIGENCE_PROMPT_TEMPLATE_VERSION,
  WAVE1_POC_ATTESTATION_ARTIFACT_FILENAME,
  WAVE1_POC_ATTESTATION_BUNDLE_FILENAME,
  WAVE1_POC_ATTESTATIONS_DIRECTORY,
  WAVE1_POC_FIXTURE_IDS,
  WAVE1_POC_SIGNATURES_DIRECTORY,
  VISUAL_SIDECAR_SCHEMA_VERSION,
  type BusinessTestIntentIr,
  type Wave1PocFixtureId,
  type Wave1PocLbomDocument,
} from "../contracts/index.js";
import { canonicalJson } from "./content-hash.js";
import {
  createKeyBoundSigstoreSigner,
  generateWave1PocAttestationKeyPair,
  verifyWave1PocAttestationFromDisk,
} from "./evidence-attestation.js";
import {
  computeWave1PocEvidenceManifestDigest,
  verifyWave1PocEvidenceFromDisk,
} from "./evidence-manifest.js";
import { validateLbomDocument } from "./lbom-emitter.js";
import {
  ML_BOM_ARTIFACT_DIRECTORY,
  ML_BOM_ARTIFACT_FILENAME,
  ML_BOM_CYCLONEDX_SPEC_VERSION,
  validateMlBomDocument,
  type MlBomDocument,
} from "./ml-bom.js";
import {
  BUSINESS_INTENT_IR_ARTIFACT_FILENAME,
  COMPILED_PROMPT_ARTIFACT_FILENAME,
  GATEWAY_REQUEST_AUDIT_ARTIFACT_FILENAME,
  runWave1Poc,
  synthesizeGeneratedTestCases,
  Wave1PocFinOpsBudgetExceededError,
} from "./poc-harness.js";
import { createMemoryReplayCache } from "./replay-cache.js";

const GENERATED_AT = "2026-04-25T10:00:00.000Z";

const ORIGINAL_PII_SUBSTRINGS: Record<
  Wave1PocFixtureId,
  ReadonlyArray<string>
> = {
  "poc-onboarding": [
    "anna.beispiel@example.test",
    "+49 30 5550199",
    "65929970489",
  ],
  "poc-payment-auth": ["DE02500105170137075030", "INGDDEFFXXX"],
};

const newRunDir = async (): Promise<string> => {
  return mkdtemp(join(tmpdir(), "ti-poc-run-"));
};

const lbomPropertyMap = (
  lbom: Wave1PocLbomDocument,
): Map<string, string> =>
  new Map(lbom.metadata.properties.map((property) => [property.name, property.value]));

const audit = {
  jobId: "job-synthetic-coverage",
  generatedAt: GENERATED_AT,
  contractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
  schemaVersion: GENERATED_TEST_CASE_SCHEMA_VERSION,
  promptTemplateVersion: TEST_INTELLIGENCE_PROMPT_TEMPLATE_VERSION,
  redactionPolicyVersion: "1.0.0",
  visualSidecarSchemaVersion: VISUAL_SIDECAR_SCHEMA_VERSION,
  cacheHit: false,
  cacheKey: "synthetic",
  inputHash: "0".repeat(64),
  promptHash: "0".repeat(64),
  schemaHash: "0".repeat(64),
};

test("poc-harness: synthetic test generation covers risk labels, actions, navigation, and trace fallbacks", () => {
  const intent: BusinessTestIntentIr = {
    version: BUSINESS_TEST_INTENT_IR_SCHEMA_VERSION,
    source: { kind: "figma_local_json", contentHash: "1".repeat(64) },
    screens: [
      { screenId: "checkout", screenName: "Checkout", trace: {} },
      { screenId: "profile", screenName: "Profile", trace: { nodeId: "screen.profile" } },
    ],
    detectedFields: [
      {
        id: "field.iban",
        screenId: "checkout",
        trace: { nodeId: "node.iban", nodeName: "IBAN" },
        provenance: "figma_node",
        confidence: 0.9,
        label: "IBAN",
        type: "text",
      },
      {
        id: "field.email",
        screenId: "profile",
        trace: {},
        provenance: "figma_node",
        confidence: 0.9,
        label: "Email",
        type: "email",
      },
      {
        id: "field.notes",
        screenId: "profile",
        trace: { nodeName: "Notes" },
        provenance: "figma_node",
        confidence: 0.8,
        label: "Display notes",
        type: "textarea",
      },
    ],
    detectedActions: [
      {
        id: "action.submit",
        screenId: "checkout",
        trace: { nodeId: "node.submit", nodeName: "Submit" },
        provenance: "figma_node",
        confidence: 0.9,
        label: "Submit",
        intent: "submit",
      },
      {
        id: "action.save",
        screenId: "profile",
        trace: {},
        provenance: "figma_node",
        confidence: 0.8,
        label: "Save",
        intent: "submit",
      },
    ],
    detectedValidations: [
      {
        id: "validation.iban",
        screenId: "checkout",
        trace: { nodeId: "node.iban" },
        provenance: "figma_node",
        confidence: 0.9,
        rule: "Required",
        targetFieldId: "field.iban",
      },
      {
        id: "validation.orphan",
        screenId: "profile",
        trace: {},
        provenance: "figma_node",
        confidence: 0.7,
        rule: "Optional warning",
      },
    ],
    detectedNavigation: [
      {
        id: "nav.checkout.profile",
        screenId: "checkout",
        targetScreenId: "profile",
        trigger: "submit",
        trace: { nodeName: "Submit" },
        confidence: 0.8,
      },
    ],
    inferredBusinessObjects: [],
    risks: [],
    assumptions: [],
    openQuestions: [],
    piiIndicators: [],
    redactions: [],
  };

  const list = synthesizeGeneratedTestCases({
    jobId: audit.jobId,
    generatedAt: GENERATED_AT,
    intent,
    audit,
  });
  assert.equal(list.schemaVersion, GENERATED_TEST_CASE_SCHEMA_VERSION);
  assert.equal(list.jobId, audit.jobId);
  assert.equal(
    list.testCases.some(
      (tc) =>
        tc.riskCategory === "financial_transaction" &&
        tc.qualitySignals.coveredFieldIds.includes("field.iban") &&
        tc.qualitySignals.coveredActionIds.includes("action.submit"),
    ),
    true,
  );
  assert.equal(
    list.testCases.some(
      (tc) =>
        tc.riskCategory === "regulated_data" &&
        tc.qualitySignals.coveredFieldIds.includes("field.email"),
    ),
    true,
  );
  assert.equal(
    list.testCases.some(
      (tc) =>
        tc.type === "navigation" &&
        tc.qualitySignals.coveredNavigationIds.includes("nav.checkout.profile"),
    ),
    true,
  );
  assert.equal(
    list.testCases.some(
      (tc) =>
        tc.type === "accessibility" &&
        tc.qualitySignals.coveredFieldIds.includes("field.notes"),
    ),
    true,
  );
  assert.equal(
    list.testCases.every((tc) => tc.audit !== audit && tc.audit.jobId === audit.jobId),
    true,
  );
});

for (const fixtureId of WAVE1_POC_FIXTURE_IDS) {
  test(`poc-harness: ${fixtureId} runs end-to-end without external network`, async () => {
    const runDir = await newRunDir();
    const result = await runWave1Poc({
      fixtureId,
      jobId: `job-${fixtureId}`,
      generatedAt: GENERATED_AT,
      runDir,
    });
    assert.equal(result.fixtureId, fixtureId);
    assert.ok(result.generatedList.testCases.length > 0);
    assert.equal(result.exportArtifacts.refused, false);
    assert.equal(
      result.manifest.artifacts.some(
        (artifact) => artifact.filename === GENEALOGY_ARTIFACT_FILENAME,
      ),
      true,
    );
    // Every artifact filename must be unique; subdirectory artifacts remain
    // safe relative paths so they can be attested by the manifest.
    const filenames = result.artifactFilenames;
    assert.equal(new Set(filenames).size, filenames.length);
    assert.ok(filenames.includes(BUSINESS_INTENT_IR_ARTIFACT_FILENAME));
    assert.ok(filenames.includes(COMPILED_PROMPT_ARTIFACT_FILENAME));
    assert.ok(filenames.includes(GATEWAY_REQUEST_AUDIT_ARTIFACT_FILENAME));
    // Manifest invariants.
    assert.equal(result.manifest.rawScreenshotsIncluded, false);
    assert.equal(result.manifest.imagePayloadSentToTestGeneration, false);
    assert.equal(
      result.manifest.modelDeployments.testGeneration,
      "gpt-oss-120b-mock",
    );
    assert.equal(
      result.manifest.modelDeployments.visualPrimary,
      "llama-4-maverick-vision",
    );
    assert.equal(result.attestation.signingMode, "unsigned");
    assert.equal(result.attestation.signerReference, undefined);
    assert.equal(
      result.attestation.attestationFilename,
      `${WAVE1_POC_ATTESTATIONS_DIRECTORY}/${WAVE1_POC_ATTESTATION_ARTIFACT_FILENAME}`,
    );
    assert.match(result.attestation.attestationSha256, /^[0-9a-f]{64}$/);
    assert.equal(result.attestation.bundleFilename, undefined);
    assert.equal(result.attestation.bundleSha256, undefined);

    // Issue #1378 — every completed run emits a per-job CycloneDX 1.6
    // ML-BOM under `<runDir>/lbom/ai-bom.cdx.json`, and the manifest
    // attests it via SHA-256 + byte length.
    assert.equal(result.lbom.bomFormat, "CycloneDX");
    assert.equal(result.lbom.specVersion, LBOM_CYCLONEDX_SPEC_VERSION);
    const lbomProps = lbomPropertyMap(result.lbom);
    assert.equal(lbomProps.get("workspace-dev:secretsIncluded"), "false");
    assert.equal(lbomProps.get("workspace-dev:rawPromptsIncluded"), "false");
    assert.equal(
      lbomProps.get("workspace-dev:rawScreenshotsIncluded"),
      "false",
    );
    assert.equal(
      result.lbomSummary.schemaVersion,
      LBOM_ARTIFACT_SCHEMA_VERSION,
    );
    assert.equal(result.lbomSummary.componentCounts.models, 3);
    assert.equal(result.lbomSummary.componentCounts.data, 2);
    assert.equal(result.lbomSummary.visualFallbackUsed, false);
    assert.equal(
      result.lbomSummary.filename,
      `${LBOM_ARTIFACT_DIRECTORY}/${LBOM_ARTIFACT_FILENAME}`,
    );
    assert.ok(filenames.includes(result.lbomSummary.filename));
    const lbomBytes = await readFile(result.lbomArtifactPath, "utf8");
    const parsedLbom = JSON.parse(lbomBytes) as Wave1PocLbomDocument;
    const lbomValidation = validateLbomDocument(parsedLbom);
    assert.equal(
      lbomValidation.valid,
      true,
      JSON.stringify(lbomValidation.issues, null, 2),
    );
    const attestedLbom = result.manifest.artifacts.find(
      (artifact) => artifact.filename === result.lbomSummary.filename,
    );
    assert.ok(attestedLbom, "manifest must attest the LBOM artifact");
    assert.equal(attestedLbom?.category, "lbom");
    assert.equal(attestedLbom?.sha256, result.lbomSummary.sha256);
    assert.equal(attestedLbom?.bytes, result.lbomSummary.bytes);

    assert.equal(result.mlBom.bomFormat, "CycloneDX");
    assert.equal(result.mlBom.specVersion, ML_BOM_CYCLONEDX_SPEC_VERSION);
    assert.equal(
      result.mlBomSummary.filename,
      `${ML_BOM_ARTIFACT_DIRECTORY}/${ML_BOM_ARTIFACT_FILENAME}`,
    );
    assert.ok(filenames.includes(result.mlBomSummary.filename));
    const mlBomBytes = await readFile(result.mlBomArtifactPath, "utf8");
    const parsedMlBom = JSON.parse(mlBomBytes) as MlBomDocument;
    const mlBomValidation = validateMlBomDocument(parsedMlBom);
    assert.equal(
      mlBomValidation.valid,
      true,
      JSON.stringify(mlBomValidation.issues, null, 2),
    );
    const attestedMlBom = result.manifest.artifacts.find(
      (artifact) => artifact.filename === result.mlBomSummary.filename,
    );
    assert.ok(attestedMlBom, "manifest must attest the release ML-BOM artifact");
    assert.equal(attestedMlBom?.category, "ml_bom");
    assert.equal(attestedMlBom?.sha256, result.mlBomSummary.sha256);
    assert.equal(attestedMlBom?.bytes, result.mlBomSummary.bytes);
  });

  test(`poc-harness: ${fixtureId} produces deterministic artifacts on replay`, async () => {
    const dirA = await newRunDir();
    const dirB = await newRunDir();
    const a = await runWave1Poc({
      fixtureId,
      jobId: `job-${fixtureId}-deterministic`,
      generatedAt: GENERATED_AT,
      runDir: dirA,
    });
    const b = await runWave1Poc({
      fixtureId,
      jobId: `job-${fixtureId}-deterministic`,
      generatedAt: GENERATED_AT,
      runDir: dirB,
    });
    // Manifest sha256 hashes must be byte-identical run-to-run.
    const hashesA = a.manifest.artifacts.map(
      (x) => `${x.filename}:${x.sha256}`,
    );
    const hashesB = b.manifest.artifacts.map(
      (x) => `${x.filename}:${x.sha256}`,
    );
    assert.deepEqual(hashesA, hashesB);
    // Generated test case list is byte-identical.
    assert.equal(
      canonicalJson(a.generatedList),
      canonicalJson(b.generatedList),
    );
  });

  test(`poc-harness: ${fixtureId} no original PII substrings appear in any persisted artifact`, async () => {
    const runDir = await newRunDir();
    const result = await runWave1Poc({
      fixtureId,
      jobId: `job-${fixtureId}-pii`,
      generatedAt: GENERATED_AT,
      runDir,
    });
    const violators = ORIGINAL_PII_SUBSTRINGS[fixtureId];
    for (const filename of result.artifactFilenames) {
      const path = join(runDir, filename);
      const raw = await readFile(path, "utf8").catch(async () => {
        // Some artifacts (review-store) live one layer deeper; the
        // manifest stores their basenames so re-resolve from manifest.
        return readFile(
          join(runDir, "review-store", result.jobId, filename),
          "utf8",
        );
      });
      for (const needle of violators) {
        assert.equal(
          raw.includes(needle),
          false,
          `original PII substring "${needle}" leaked into ${filename}`,
        );
      }
    }
  });

  test(`poc-harness: ${fixtureId} verifies clean against verifyWave1PocEvidenceFromDisk`, async () => {
    const runDir = await newRunDir();
    await runWave1Poc({
      fixtureId,
      jobId: `job-${fixtureId}-verify`,
      generatedAt: GENERATED_AT,
      runDir,
    });
    const { result } = await verifyWave1PocEvidenceFromDisk(runDir);
    assert.equal(result.ok, true, JSON.stringify(result));
  });

  test(`poc-harness: ${fixtureId} verification fails after deliberate artifact mutation`, async () => {
    const runDir = await newRunDir();
    const run = await runWave1Poc({
      fixtureId,
      jobId: `job-${fixtureId}-mutate`,
      generatedAt: GENERATED_AT,
      runDir,
    });
    // Mutate the first non-manifest artifact.
    const target = run.artifactFilenames.find(
      (f) => f !== "wave1-poc-evidence-manifest.json",
    );
    assert.ok(target);
    const path = join(runDir, target);
    const raw = await readFile(path, "utf8");
    await writeFile(path, raw + "\n# tampered\n", "utf8");
    const { result } = await verifyWave1PocEvidenceFromDisk(runDir);
    assert.equal(result.ok, false);
    assert.ok(
      result.mutated.includes(target) || result.resized.includes(target),
    );
  });
}

test("poc-harness: seals request audit proof that test generation received no images", async () => {
  const runDir = await newRunDir();
  const result = await runWave1Poc({
    fixtureId: "poc-payment-auth",
    jobId: "job-poc-payment-auth-request-audit",
    generatedAt: GENERATED_AT,
    runDir,
  });
  const raw = await readFile(
    join(runDir, GATEWAY_REQUEST_AUDIT_ARTIFACT_FILENAME),
    "utf8",
  );
  const audit = JSON.parse(raw) as {
    deployment: string;
    requestCount: number;
    imageInputCounts: number[];
    imagePayloadSent: boolean;
    promptHash: string;
    schemaHash: string;
    inputHash: string;
    cacheKeyDigest: string;
  };
  assert.equal(audit.deployment, "gpt-oss-120b-mock");
  assert.equal(audit.requestCount, 1);
  assert.deepEqual(audit.imageInputCounts, [0]);
  assert.equal(audit.imagePayloadSent, false);
  assert.equal(
    audit.promptHash,
    result.compiledPrompt.request.hashes.promptHash,
  );
  assert.equal(
    audit.schemaHash,
    result.compiledPrompt.request.hashes.schemaHash,
  );
  assert.equal(audit.inputHash, result.compiledPrompt.request.hashes.inputHash);
  assert.equal(
    audit.cacheKeyDigest,
    result.compiledPrompt.request.hashes.cacheKey,
  );
  const attested = result.manifest.artifacts.find(
    (artifact) => artifact.filename === GATEWAY_REQUEST_AUDIT_ARTIFACT_FILENAME,
  );
  assert.equal(attested?.category, "manifest");
});

test("poc-harness: sigstore signing returns summary and verifies from disk", async () => {
  const runDir = await newRunDir();
  const { privateKeyPem, publicKeyPem } = generateWave1PocAttestationKeyPair();
  const signer = createKeyBoundSigstoreSigner({
    signerReference: "poc-harness-signer",
    privateKeyPem,
    publicKeyPem,
  });
  const run = await runWave1Poc({
    fixtureId: "poc-onboarding",
    jobId: "job-poc-onboarding-signed",
    generatedAt: GENERATED_AT,
    runDir,
    attestationSigningMode: "sigstore",
    attestationSigner: signer,
  });

  assert.equal(run.attestation.signingMode, "sigstore");
  assert.equal(run.attestation.signerReference, "poc-harness-signer");
  assert.equal(
    run.attestation.attestationFilename,
    `${WAVE1_POC_ATTESTATIONS_DIRECTORY}/${WAVE1_POC_ATTESTATION_ARTIFACT_FILENAME}`,
  );
  assert.equal(
    run.attestation.bundleFilename,
    `${WAVE1_POC_SIGNATURES_DIRECTORY}/${WAVE1_POC_ATTESTATION_BUNDLE_FILENAME}`,
  );
  assert.match(run.attestation.attestationSha256, /^[0-9a-f]{64}$/);
  assert.match(run.attestation.bundleSha256 ?? "", /^[0-9a-f]{64}$/);

  const verification = await verifyWave1PocAttestationFromDisk(
    runDir,
    run.manifest,
    computeWave1PocEvidenceManifestDigest(run.manifest),
    { expectedSigningMode: "sigstore" },
  );
  assert.equal(verification.ok, true, JSON.stringify(verification.failures));
  assert.equal(verification.signaturesVerified, true);
});

test("poc-harness: post-hoc bySource mutation fails signed attestation verify", async () => {
  const runDir = await newRunDir();
  const { privateKeyPem, publicKeyPem } = generateWave1PocAttestationKeyPair();
  const signer = createKeyBoundSigstoreSigner({
    signerReference: "poc-harness-bysource-signer",
    privateKeyPem,
    publicKeyPem,
  });
  const run = await runWave1Poc({
    fixtureId: "poc-onboarding",
    jobId: "job-poc-onboarding-bysource-tamper",
    generatedAt: GENERATED_AT,
    runDir,
    attestationSigningMode: "sigstore",
    attestationSigner: signer,
  });

  const reportPath = join(
    runDir,
    FINOPS_ARTIFACT_DIRECTORY,
    FINOPS_BUDGET_REPORT_ARTIFACT_FILENAME,
  );
  const report = JSON.parse(await readFile(reportPath, "utf8")) as FinOpsBudgetReport;
  const tampered: FinOpsBudgetReport = {
    ...report,
    bySource: {
      ...report.bySource,
      generator: {
        ...report.bySource.generator,
        callCount: report.bySource.generator.callCount + 1,
      },
    },
  };
  await writeFile(reportPath, canonicalJson(tampered), "utf8");

  const verification = await verifyWave1PocAttestationFromDisk(
    runDir,
    run.manifest,
    computeWave1PocEvidenceManifestDigest(run.manifest),
    { expectedSigningMode: "sigstore" },
  );
  assert.equal(verification.ok, false);
  assert.ok(
    verification.failures.some(
      (failure) => failure.code === "bySource_hash_mismatch",
    ),
    JSON.stringify(verification.failures),
  );
});

test("poc-harness: visual mask hash participates in compiled prompt identity", async () => {
  const runDir = await newRunDir();
  const result = await runWave1Poc({
    fixtureId: "poc-payment-auth",
    jobId: "job-poc-payment-auth-mask",
    generatedAt: GENERATED_AT,
    runDir,
  });
  const fixtureImageHash =
    result.compiledPrompt.artifacts.visualBinding.fixtureImageHash;
  assert.match(fixtureImageHash ?? "", /^[0-9a-f]{64}$/);
  assert.equal(
    result.compiledPrompt.request.userPrompt.includes(fixtureImageHash ?? ""),
    false,
    "compiled prompt should carry visual image provenance by hash identity, not prompt text",
  );
});

test("poc-harness: visual sidecar gate must not block on shipped fixtures", async () => {
  for (const fixtureId of WAVE1_POC_FIXTURE_IDS) {
    const runDir = await newRunDir();
    const run = await runWave1Poc({
      fixtureId,
      jobId: `job-${fixtureId}-visual`,
      generatedAt: GENERATED_AT,
      runDir,
    });
    assert.ok(run.validation.visual !== undefined);
    assert.equal(run.validation.visual?.blocked, false);
  }
});

test("poc-harness: structured-test-case generator never receives image payloads", async () => {
  // The mock LLM gateway already enforces this fail-closed; the harness
  // additionally asserts at runtime that no recorded request carries
  // imageInputs. A successful run is itself the proof: any leak would
  // throw in `runWave1Poc`. We exercise the assert path here by running
  // every fixture and observing the harness completes successfully.
  for (const fixtureId of WAVE1_POC_FIXTURE_IDS) {
    const runDir = await newRunDir();
    await runWave1Poc({
      fixtureId,
      jobId: `job-${fixtureId}-leak`,
      generatedAt: GENERATED_AT,
      runDir,
    });
  }
});

test("poc-harness: default execution does not touch live gateway fetch", async () => {
  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = (async () => {
    fetchCalls += 1;
    throw new Error("default POC path attempted live fetch");
  }) as typeof fetch;

  try {
    const runDir = await newRunDir();
    const result = await runWave1Poc({
      fixtureId: "poc-onboarding",
      jobId: "job-poc-default-no-live-fetch",
      generatedAt: GENERATED_AT,
      runDir,
    });

    assert.equal(result.visualSidecar, undefined);
    assert.equal(
      result.manifest.modelDeployments.testGeneration,
      "gpt-oss-120b-mock",
    );
    assert.equal(fetchCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("poc-harness: FinOps report is returned and persisted with supplied budget and cost rates", async () => {
  const runDir = await newRunDir();
  const budget = {
    budgetId: "test-success-budget",
    budgetVersion: "2026-04-25",
    roles: {
      test_generation: {
        maxInputTokensPerRequest: 100_000,
        maxOutputTokensPerRequest: 1_000,
      },
    },
  };
  const result = await runWave1Poc({
    fixtureId: "poc-onboarding",
    jobId: "job-poc-finops-success",
    generatedAt: GENERATED_AT,
    runDir,
    finopsBudget: budget,
    finopsCostRates: {
      currencyLabel: "USD",
      rates: {
        test_generation: {
          fixedCostPerAttempt: 0.01,
        },
      },
    },
  });

  assert.equal(
    result.finopsArtifactPath,
    join(
      runDir,
      FINOPS_ARTIFACT_DIRECTORY,
      FINOPS_BUDGET_REPORT_ARTIFACT_FILENAME,
    ),
  );
  assert.equal(result.finopsReport.budget.budgetId, budget.budgetId);
  assert.equal(result.finopsReport.currencyLabel, "USD");
  assert.equal(result.finopsReport.outcome, "completed");
  assert.equal(result.finopsReport.totals.attempts, 1);
  assert.equal(result.finopsReport.totals.estimatedCost, 0.01);
  assert.equal(result.finopsReport.bySource.generator.callCount, 1);
  assert.equal(result.finopsReport.bySource.generator.costMinorUnits, 1);
  assert.equal(result.finopsReport.bySourceTotal.callCount, 1);
  assert.equal(result.finopsReport.bySourceSealedAt, GENERATED_AT);
  assert.equal(
    result.manifest.artifacts.find(
      (artifact) =>
        artifact.filename ===
        `${FINOPS_ARTIFACT_DIRECTORY}/${FINOPS_BUDGET_REPORT_ARTIFACT_FILENAME}`,
    )?.category,
    "finops",
  );

  const onDisk = JSON.parse(
    await readFile(result.finopsArtifactPath, "utf8"),
  ) as FinOpsBudgetReport;
  assert.deepEqual(onDisk, result.finopsReport);
  assert.equal(onDisk.secretsIncluded, false);
  assert.equal(onDisk.rawPromptsIncluded, false);
  assert.equal(onDisk.rawScreenshotsIncluded, false);
});

test("poc-harness: FinOps maxInputTokensPerRequest fails closed before downstream artifacts", async () => {
  const runDir = await newRunDir();
  await assert.rejects(
    runWave1Poc({
      fixtureId: "poc-onboarding",
      jobId: "job-poc-finops-input-budget",
      generatedAt: GENERATED_AT,
      runDir,
      finopsBudget: {
        budgetId: "test-tight-input",
        budgetVersion: "1.0.0",
        roles: {
          test_generation: {
            maxInputTokensPerRequest: 1,
          },
        },
      },
    }),
    Wave1PocFinOpsBudgetExceededError,
  );

  const rawReport = await readFile(
    join(
      runDir,
      FINOPS_ARTIFACT_DIRECTORY,
      FINOPS_BUDGET_REPORT_ARTIFACT_FILENAME,
    ),
    "utf8",
  );
  const report = JSON.parse(rawReport) as FinOpsBudgetReport;
  assert.equal(report.outcome, "budget_exceeded");
  assert.equal(report.totals.attempts, 0);
  assert.deepEqual(
    report.breaches.map((breach) => breach.rule),
    ["max_input_tokens"],
  );
  assert.equal(report.rawPromptsIncluded, false);
  assert.equal(report.rawScreenshotsIncluded, false);
  await assert.rejects(
    readFile(join(runDir, "generated-testcases.json"), "utf8"),
    /ENOENT/,
  );
});

test("poc-harness: aggregate FinOps breaches stop before validation and export", async () => {
  const runDir = await newRunDir();
  await assert.rejects(
    runWave1Poc({
      fixtureId: "poc-onboarding",
      jobId: "job-poc-finops-aggregate-budget",
      generatedAt: GENERATED_AT,
      runDir,
      finopsBudget: {
        budgetId: "test-tight-attempts",
        budgetVersion: "1.0.0",
        roles: {
          test_generation: {
            maxAttempts: 0,
          },
        },
      },
    }),
    Wave1PocFinOpsBudgetExceededError,
  );

  const report = JSON.parse(
    await readFile(
      join(
        runDir,
        FINOPS_ARTIFACT_DIRECTORY,
        FINOPS_BUDGET_REPORT_ARTIFACT_FILENAME,
      ),
      "utf8",
    ),
  ) as FinOpsBudgetReport;
  assert.equal(report.outcome, "budget_exceeded");
  assert.deepEqual(
    report.breaches.map((breach) => breach.rule),
    ["max_attempts"],
  );
  await assert.rejects(
    readFile(join(runDir, "test-case-validation-report.json"), "utf8"),
    /ENOENT/,
  );
});

test("poc-harness: replay-cache hit skips generation and reports completed_cache_hit", async () => {
  const cache = createMemoryReplayCache();
  const firstDir = await newRunDir();
  const secondDir = await newRunDir();
  await runWave1Poc({
    fixtureId: "poc-onboarding",
    jobId: "job-poc-cache-hit",
    generatedAt: GENERATED_AT,
    runDir: firstDir,
    replayCache: cache,
  });
  const second = await runWave1Poc({
    fixtureId: "poc-onboarding",
    jobId: "job-poc-cache-hit",
    generatedAt: GENERATED_AT,
    runDir: secondDir,
    replayCache: cache,
  });

  assert.equal(second.finopsReport.outcome, "completed_cache_hit");
  assert.equal(second.finopsReport.totals.attempts, 0);
  assert.equal(second.finopsReport.totals.cacheHits, 1);
  assert.equal(second.finopsReport.bySource.generator.idempotentReplayHits, 1);
  assert.equal(second.generatedList.testCases[0]?.audit.cacheHit, true);

  const rawAudit = JSON.parse(
    await readFile(
      join(secondDir, GATEWAY_REQUEST_AUDIT_ARTIFACT_FILENAME),
      "utf8",
    ),
  ) as { requestCount: number; imageInputCounts: number[] };
  assert.equal(rawAudit.requestCount, 0);
  assert.deepEqual(rawAudit.imageInputCounts, []);
});
