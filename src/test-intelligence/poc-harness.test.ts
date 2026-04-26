import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  FINOPS_ARTIFACT_DIRECTORY,
  FINOPS_BUDGET_REPORT_ARTIFACT_FILENAME,
  type FinOpsBudgetReport,
  WAVE1_POC_ATTESTATION_ARTIFACT_FILENAME,
  WAVE1_POC_ATTESTATION_BUNDLE_FILENAME,
  WAVE1_POC_ATTESTATIONS_DIRECTORY,
  WAVE1_POC_FIXTURE_IDS,
  WAVE1_POC_SIGNATURES_DIRECTORY,
  type Wave1PocFixtureId,
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
import {
  BUSINESS_INTENT_IR_ARTIFACT_FILENAME,
  COMPILED_PROMPT_ARTIFACT_FILENAME,
  GATEWAY_REQUEST_AUDIT_ARTIFACT_FILENAME,
  runWave1Poc,
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
  assert.equal(audit.promptHash, result.compiledPrompt.request.hashes.promptHash);
  assert.equal(audit.schemaHash, result.compiledPrompt.request.hashes.schemaHash);
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
    assert.equal(result.manifest.modelDeployments.testGeneration, "gpt-oss-120b-mock");
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
  assert.equal(second.generatedList.testCases[0]?.audit.cacheHit, true);

  const rawAudit = JSON.parse(
    await readFile(join(secondDir, GATEWAY_REQUEST_AUDIT_ARTIFACT_FILENAME), "utf8"),
  ) as { requestCount: number; imageInputCounts: number[] };
  assert.equal(rawAudit.requestCount, 0);
  assert.deepEqual(rawAudit.imageInputCounts, []);
});
