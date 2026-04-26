import assert from "node:assert/strict";
import {
  appendFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import fc from "fast-check";

import {
  TEST_CASE_POLICY_REPORT_ARTIFACT_FILENAME,
  WAVE1_POC_ATTESTATION_BUNDLE_FILENAME,
  WAVE1_POC_EVIDENCE_MANIFEST_DIGEST_FILENAME,
  WAVE1_POC_EVIDENCE_MANIFEST_ARTIFACT_FILENAME,
  WAVE1_POC_SIGNATURES_DIRECTORY,
} from "../contracts/index.js";
import {
  createKeyBoundSigstoreSigner,
  generateWave1PocAttestationKeyPair,
} from "./evidence-attestation.js";
import {
  EVIDENCE_VERIFY_RESPONSE_SCHEMA_VERSION,
  verifyJobEvidence,
  type EvidenceVerifyResponse,
} from "./evidence-verify.js";
import { runWave1Poc } from "./poc-harness.js";

const GENERATED_AT = "2026-04-25T10:00:00.000Z";
const VERIFIED_AT = "2026-04-26T10:00:00.000Z";

const newRoot = async (label: string): Promise<string> => {
  return mkdtemp(join(tmpdir(), `ti-evidence-verify-${label}-`));
};

interface SeededRun {
  /** The artifacts root that contains a single `<jobId>` subdir. */
  artifactsRoot: string;
  jobId: string;
  /** Absolute path of the run dir (`<artifactsRoot>/<jobId>`). */
  runDir: string;
  cleanup: () => Promise<void>;
}

const seedHarnessRun = async (
  label: string,
  options: {
    jobId?: string;
    attestationSigningMode?: "unsigned" | "sigstore";
  } = {},
): Promise<SeededRun> => {
  const root = await newRoot(label);
  const jobId = options.jobId ?? `job-${label}`;
  const runDir = join(root, jobId);
  await mkdir(runDir, { recursive: true });
  if (options.attestationSigningMode === "sigstore") {
    const { privateKeyPem, publicKeyPem } =
      generateWave1PocAttestationKeyPair();
    const signer = createKeyBoundSigstoreSigner({
      signerReference: "evidence-verify-test-signer",
      privateKeyPem,
      publicKeyPem,
    });
    await runWave1Poc({
      fixtureId: "poc-onboarding",
      jobId,
      generatedAt: GENERATED_AT,
      runDir,
      attestationSigningMode: "sigstore",
      attestationSigner: signer,
    });
  } else {
    await runWave1Poc({
      fixtureId: "poc-onboarding",
      jobId,
      generatedAt: GENERATED_AT,
      runDir,
    });
  }
  return {
    artifactsRoot: root,
    jobId,
    runDir,
    cleanup: () => rm(root, { recursive: true, force: true }),
  };
};

test("verifyJobEvidence: untouched POC run verifies clean (ok=true, no failures)", async () => {
  const seed = await seedHarnessRun("untouched");
  try {
    const result = await verifyJobEvidence({
      artifactsRoot: seed.artifactsRoot,
      jobId: seed.jobId,
      verifiedAt: VERIFIED_AT,
    });
    assert.equal(result.status, "ok");
    if (result.status !== "ok") return;
    assert.equal(
      result.body.ok,
      true,
      JSON.stringify(result.body.failures, null, 2),
    );
    assert.equal(result.body.failures.length, 0);
    assert.equal(
      result.body.schemaVersion,
      EVIDENCE_VERIFY_RESPONSE_SCHEMA_VERSION,
    );
    assert.equal(result.body.jobId, seed.jobId);
    assert.equal(result.body.verifiedAt, VERIFIED_AT);
    assert.match(result.body.manifestSha256, /^[0-9a-f]{64}$/);
    assert.equal(
      result.body.modelDeployments?.testGeneration,
      "gpt-oss-120b-mock",
    );
    // Every artifact_sha256 row should be ok.
    for (const check of result.body.checks) {
      if (check.kind === "artifact_sha256") {
        assert.equal(check.ok, true, `artifact ${check.reference} failed`);
      }
    }
    // The manifest_metadata + manifest_digest_witness rows are present.
    assert.ok(
      result.body.checks.some(
        (c) =>
          c.kind === "manifest_metadata" &&
          c.reference === WAVE1_POC_EVIDENCE_MANIFEST_ARTIFACT_FILENAME,
      ),
    );
    assert.ok(
      result.body.checks.some(
        (c) =>
          c.kind === "manifest_digest_witness" &&
          c.reference === WAVE1_POC_EVIDENCE_MANIFEST_ARTIFACT_FILENAME,
      ),
    );
    // Visual sidecar evidence row present.
    assert.ok(
      result.body.checks.some((c) => c.kind === "visual_sidecar_evidence"),
    );
    // Attestation present (default unsigned mode).
    assert.ok(result.body.attestation);
    assert.equal(result.body.attestation?.signingMode, "unsigned");
    assert.equal(result.body.attestation?.signaturesVerified, true);
  } finally {
    await seed.cleanup();
  }
});

test("verifyJobEvidence: tampered manifest field surfaces digest_witness failure", async () => {
  const seed = await seedHarnessRun("tampered-manifest");
  try {
    const manifestPath = join(
      seed.runDir,
      WAVE1_POC_EVIDENCE_MANIFEST_ARTIFACT_FILENAME,
    );
    const raw = await readFile(manifestPath, "utf8");
    // Replace promptHash with all zeros — keeps the JSON valid but
    // breaks the digest witness.
    const mutated = raw.replace(
      /"promptHash":"[0-9a-f]{64}"/,
      `"promptHash":"${"0".repeat(64)}"`,
    );
    assert.notEqual(mutated, raw, "manifest content must change");
    await writeFile(manifestPath, mutated, "utf8");

    const result = await verifyJobEvidence({
      artifactsRoot: seed.artifactsRoot,
      jobId: seed.jobId,
      verifiedAt: VERIFIED_AT,
    });
    assert.equal(result.status, "ok");
    if (result.status !== "ok") return;
    assert.equal(result.body.ok, false);
    assert.deepEqual(
      result.body.checks.find((c) => c.kind === "manifest_metadata"),
      {
        kind: "manifest_metadata",
        reference: WAVE1_POC_EVIDENCE_MANIFEST_ARTIFACT_FILENAME,
        ok: true,
      },
    );
    assert.deepEqual(
      result.body.checks.find((c) => c.kind === "manifest_digest_witness"),
      {
        kind: "manifest_digest_witness",
        reference: WAVE1_POC_EVIDENCE_MANIFEST_ARTIFACT_FILENAME,
        ok: false,
        failureCode: "manifest_digest_witness_invalid",
      },
    );
    assert.ok(
      result.body.failures.some(
        (f) =>
          f.code === "manifest_digest_witness_invalid" &&
          f.reference === WAVE1_POC_EVIDENCE_MANIFEST_ARTIFACT_FILENAME,
      ),
      JSON.stringify(result.body.failures, null, 2),
    );
  } finally {
    await seed.cleanup();
  }
});

test("verifyJobEvidence: schema-mismatched manifest returns manifest_unparseable", async () => {
  const seed = await seedHarnessRun("schema-mismatch");
  try {
    const manifestPath = join(
      seed.runDir,
      WAVE1_POC_EVIDENCE_MANIFEST_ARTIFACT_FILENAME,
    );
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as Record<
      string,
      unknown
    >;
    manifest["schemaVersion"] = "999.0.0";
    await writeFile(manifestPath, JSON.stringify(manifest), "utf8");

    const result = await verifyJobEvidence({
      artifactsRoot: seed.artifactsRoot,
      jobId: seed.jobId,
      verifiedAt: VERIFIED_AT,
    });
    assert.equal(result.status, "ok");
    if (result.status !== "ok") return;
    assert.equal(result.body.ok, false);
    assert.equal(result.body.manifestSha256, "");
    assert.deepEqual(result.body.failures, [
      {
        code: "manifest_unparseable",
        reference: WAVE1_POC_EVIDENCE_MANIFEST_ARTIFACT_FILENAME,
        message:
          "Evidence manifest 'wave1-poc-evidence-manifest.json' is missing, malformed, or carries a mismatched schema/contract version.",
      },
    ]);
  } finally {
    await seed.cleanup();
  }
});

test("verifyJobEvidence: digest witness failure does not mark manifest metadata failed", async () => {
  const seed = await seedHarnessRun("digest-witness");
  try {
    await writeFile(
      join(seed.runDir, WAVE1_POC_EVIDENCE_MANIFEST_DIGEST_FILENAME),
      `${"0".repeat(64)}\n`,
      "utf8",
    );

    const result = await verifyJobEvidence({
      artifactsRoot: seed.artifactsRoot,
      jobId: seed.jobId,
      verifiedAt: VERIFIED_AT,
    });
    assert.equal(result.status, "ok");
    if (result.status !== "ok") return;
    assert.equal(result.body.ok, false);
    assert.deepEqual(
      result.body.checks.find((c) => c.kind === "manifest_metadata"),
      {
        kind: "manifest_metadata",
        reference: WAVE1_POC_EVIDENCE_MANIFEST_ARTIFACT_FILENAME,
        ok: true,
      },
    );
    assert.deepEqual(
      result.body.checks.find((c) => c.kind === "manifest_digest_witness"),
      {
        kind: "manifest_digest_witness",
        reference: WAVE1_POC_EVIDENCE_MANIFEST_ARTIFACT_FILENAME,
        ok: false,
        failureCode: "manifest_digest_witness_invalid",
      },
    );
    assert.ok(
      result.body.failures.some(
        (f) => f.code === "manifest_digest_witness_invalid",
      ),
      JSON.stringify(result.body.failures, null, 2),
    );
    assert.equal(
      result.body.failures.some(
        (f) => f.code === "manifest_metadata_invalid",
      ),
      false,
    );
  } finally {
    await seed.cleanup();
  }
});

test("verifyJobEvidence: malformed versioned manifest returns ok=false instead of throwing", async () => {
  const seed = await seedHarnessRun("malformed-versioned");
  try {
    const manifestPath = join(
      seed.runDir,
      WAVE1_POC_EVIDENCE_MANIFEST_ARTIFACT_FILENAME,
    );
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as Record<
      string,
      unknown
    >;
    delete manifest["artifacts"];
    await writeFile(manifestPath, JSON.stringify(manifest), "utf8");

    const result = await verifyJobEvidence({
      artifactsRoot: seed.artifactsRoot,
      jobId: seed.jobId,
      verifiedAt: VERIFIED_AT,
    });
    assert.equal(result.status, "ok");
    if (result.status !== "ok") return;
    assert.equal(result.body.ok, false);
    assert.ok(
      result.body.failures.some(
        (f) => f.code === "manifest_metadata_invalid",
      ),
      JSON.stringify(result.body.failures, null, 2),
    );
  } finally {
    await seed.cleanup();
  }
});

test("verifyJobEvidence: metadata failure with a matching digest witness is classified independently", async () => {
  const seed = await seedHarnessRun("metadata-only");
  try {
    const manifestPath = join(
      seed.runDir,
      WAVE1_POC_EVIDENCE_MANIFEST_ARTIFACT_FILENAME,
    );
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as Record<
      string,
      unknown
    >;
    manifest["rawScreenshotsIncluded"] = true;
    await writeFile(manifestPath, JSON.stringify(manifest), "utf8");
    const { computeWave1PocEvidenceManifestDigest } =
      await import("./evidence-manifest.js");
    const digest = computeWave1PocEvidenceManifestDigest(
      manifest as Parameters<typeof computeWave1PocEvidenceManifestDigest>[0],
    );
    await writeFile(
      join(seed.runDir, WAVE1_POC_EVIDENCE_MANIFEST_DIGEST_FILENAME),
      `${digest}\n`,
      "utf8",
    );

    const result = await verifyJobEvidence({
      artifactsRoot: seed.artifactsRoot,
      jobId: seed.jobId,
      verifiedAt: VERIFIED_AT,
    });
    assert.equal(result.status, "ok");
    if (result.status !== "ok") return;
    assert.equal(result.body.ok, false);
    assert.deepEqual(
      result.body.checks.find((c) => c.kind === "manifest_metadata"),
      {
        kind: "manifest_metadata",
        reference: WAVE1_POC_EVIDENCE_MANIFEST_ARTIFACT_FILENAME,
        ok: false,
        failureCode: "manifest_metadata_invalid",
      },
    );
    assert.deepEqual(
      result.body.checks.find((c) => c.kind === "manifest_digest_witness"),
      {
        kind: "manifest_digest_witness",
        reference: WAVE1_POC_EVIDENCE_MANIFEST_ARTIFACT_FILENAME,
        ok: true,
      },
    );
  } finally {
    await seed.cleanup();
  }
});

test("verifyJobEvidence: tampered artifact surfaces both resized + mutated", async () => {
  const seed = await seedHarnessRun("tampered-artifact");
  try {
    const target = join(seed.runDir, "generated-testcases.json");
    await appendFile(target, "\n", "utf8");

    const result = await verifyJobEvidence({
      artifactsRoot: seed.artifactsRoot,
      jobId: seed.jobId,
      verifiedAt: VERIFIED_AT,
    });
    assert.equal(result.status, "ok");
    if (result.status !== "ok") return;
    assert.equal(result.body.ok, false);
    assert.ok(
      result.body.failures.some(
        (f) =>
          f.code === "artifact_mutated" &&
          f.reference === "generated-testcases.json",
      ),
      "expected artifact_mutated failure",
    );
    assert.ok(
      result.body.failures.some(
        (f) =>
          f.code === "artifact_resized" &&
          f.reference === "generated-testcases.json",
      ),
      "expected artifact_resized failure",
    );
  } finally {
    await seed.cleanup();
  }
});

test("verifyJobEvidence: missing artifact surfaces artifact_missing", async () => {
  const seed = await seedHarnessRun("missing-artifact");
  try {
    const target = join(seed.runDir, TEST_CASE_POLICY_REPORT_ARTIFACT_FILENAME);
    await rm(target);

    const result = await verifyJobEvidence({
      artifactsRoot: seed.artifactsRoot,
      jobId: seed.jobId,
      verifiedAt: VERIFIED_AT,
    });
    assert.equal(result.status, "ok");
    if (result.status !== "ok") return;
    assert.equal(result.body.ok, false);
    assert.ok(
      result.body.failures.some(
        (f) =>
          f.code === "artifact_missing" &&
          f.reference === TEST_CASE_POLICY_REPORT_ARTIFACT_FILENAME,
      ),
      "expected artifact_missing failure",
    );
  } finally {
    await seed.cleanup();
  }
});

test("verifyJobEvidence: empty job dir with no manifest returns no_evidence", async () => {
  const root = await newRoot("no-evidence");
  try {
    const jobId = "job-empty";
    await mkdir(join(root, jobId), { recursive: true });
    const result = await verifyJobEvidence({
      artifactsRoot: root,
      jobId,
      verifiedAt: VERIFIED_AT,
    });
    assert.equal(result.status, "no_evidence");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("verifyJobEvidence: nonexistent jobId returns job_not_found", async () => {
  const root = await newRoot("not-found");
  try {
    const result = await verifyJobEvidence({
      artifactsRoot: root,
      jobId: "job-does-not-exist",
      verifiedAt: VERIFIED_AT,
    });
    assert.equal(result.status, "job_not_found");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("verifyJobEvidence: sigstore-signed run reports signaturesVerified=true", async () => {
  const seed = await seedHarnessRun("sigstore-signed", {
    attestationSigningMode: "sigstore",
  });
  try {
    const result = await verifyJobEvidence({
      artifactsRoot: seed.artifactsRoot,
      jobId: seed.jobId,
      verifiedAt: VERIFIED_AT,
    });
    assert.equal(result.status, "ok");
    if (result.status !== "ok") return;
    assert.equal(result.body.ok, true, JSON.stringify(result.body.failures));
    assert.equal(result.body.attestation?.present, true);
    assert.equal(result.body.attestation?.signingMode, "sigstore");
    assert.equal(result.body.attestation?.signaturesVerified, true);
    assert.ok((result.body.attestation?.signatureCount ?? 0) >= 1);
  } finally {
    await seed.cleanup();
  }
});

test("verifyJobEvidence: tampered signed bundle surfaces a verification failure", async () => {
  const seed = await seedHarnessRun("tampered-bundle", {
    attestationSigningMode: "sigstore",
  });
  try {
    const bundlePath = join(
      seed.runDir,
      WAVE1_POC_SIGNATURES_DIRECTORY,
      WAVE1_POC_ATTESTATION_BUNDLE_FILENAME,
    );
    const raw = await readFile(bundlePath, "utf8");
    // Mutate the first base64 signature character to flip the verifier.
    const mutated = raw.replace(/"sig":"[A-Za-z0-9+/]/, (match) => {
      const last = match.charAt(match.length - 1);
      const replacement = last === "A" ? "B" : "A";
      return match.slice(0, -1) + replacement;
    });
    assert.notEqual(mutated, raw, "bundle content must change");
    await writeFile(bundlePath, mutated, "utf8");

    const result = await verifyJobEvidence({
      artifactsRoot: seed.artifactsRoot,
      jobId: seed.jobId,
      verifiedAt: VERIFIED_AT,
    });
    assert.equal(result.status, "ok");
    if (result.status !== "ok") return;
    assert.equal(result.body.ok, false);
    assert.ok(
      result.body.failures.length > 0,
      "expected at least one attestation-related failure",
    );
  } finally {
    await seed.cleanup();
  }
});

test("verifyJobEvidence: visual_sidecar_evidence_missing when manifest lacks visualSidecar but cases reference screens", async () => {
  // Construct a minimal in-memory job directory: one valid manifest
  // (no visualSidecar block), one generated-testcases.json that
  // references a Figma screen, and the matching attested artifact
  // bytes for the testcases file.
  const root = await newRoot("visual-missing");
  try {
    const jobId = "job-visual-missing";
    const dir = join(root, jobId);
    await mkdir(dir, { recursive: true });

    const generated = {
      schemaVersion: "1.0.0",
      jobId,
      testCases: [
        {
          id: "tc-1",
          figmaTraceRefs: [{ screenId: "screen-login" }],
          visualEvidenceRefs: [{ screenId: "screen-login" }],
        },
      ],
    };
    const generatedBytes = new TextEncoder().encode(JSON.stringify(generated));
    const sha256OfBytes = (await import("node:crypto"))
      .createHash("sha256")
      .update(generatedBytes)
      .digest("hex");
    await writeFile(join(dir, "generated-testcases.json"), generatedBytes);

    const { canonicalJson } = await import("./content-hash.js");
    const ZERO = "0".repeat(64);
    const manifest = {
      schemaVersion: "1.0.0",
      contractVersion: "4.1.0",
      testIntelligenceContractVersion: "1.0.0",
      fixtureId: "poc-onboarding",
      jobId,
      generatedAt: GENERATED_AT,
      promptTemplateVersion: "1.0.0",
      generatedTestCaseSchemaVersion: "1.0.0",
      visualSidecarSchemaVersion: "1.0.0",
      redactionPolicyVersion: "1.0.0",
      policyProfileId: "eu-banking-default",
      policyProfileVersion: "1.0.0",
      exportProfileId: "opentext-alm-default",
      exportProfileVersion: "1.0.0",
      modelDeployments: { testGeneration: "gpt-oss-120b-mock" },
      promptHash: ZERO,
      schemaHash: ZERO,
      inputHash: ZERO,
      cacheKeyDigest: ZERO,
      artifacts: [
        {
          filename: "generated-testcases.json",
          sha256: sha256OfBytes,
          bytes: generatedBytes.byteLength,
          category: "validation" as const,
        },
      ],
      rawScreenshotsIncluded: false as const,
      imagePayloadSentToTestGeneration: false as const,
    };
    const serialized = canonicalJson(manifest);
    await writeFile(
      join(dir, WAVE1_POC_EVIDENCE_MANIFEST_ARTIFACT_FILENAME),
      serialized,
      "utf8",
    );
    const { computeWave1PocEvidenceManifestDigest } =
      await import("./evidence-manifest.js");
    const digest = computeWave1PocEvidenceManifestDigest(
      manifest as Parameters<typeof computeWave1PocEvidenceManifestDigest>[0],
    );
    await writeFile(
      join(dir, "wave1-poc-evidence-manifest.sha256"),
      `${digest}\n`,
      "utf8",
    );

    const result = await verifyJobEvidence({
      artifactsRoot: root,
      jobId,
      verifiedAt: VERIFIED_AT,
    });
    assert.equal(result.status, "ok");
    if (result.status !== "ok") return;
    assert.equal(result.body.ok, false);
    assert.ok(
      result.body.failures.some(
        (f) => f.code === "visual_sidecar_evidence_missing",
      ),
      JSON.stringify(result.body.failures, null, 2),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("verifyJobEvidence: two consecutive verifications produce byte-identical bodies (modulo verifiedAt)", async () => {
  const seed = await seedHarnessRun("determinism");
  try {
    const first = await verifyJobEvidence({
      artifactsRoot: seed.artifactsRoot,
      jobId: seed.jobId,
      verifiedAt: VERIFIED_AT,
    });
    const second = await verifyJobEvidence({
      artifactsRoot: seed.artifactsRoot,
      jobId: seed.jobId,
      verifiedAt: VERIFIED_AT,
    });
    assert.equal(first.status, "ok");
    assert.equal(second.status, "ok");
    if (first.status !== "ok" || second.status !== "ok") return;
    assert.equal(JSON.stringify(first.body), JSON.stringify(second.body));
  } finally {
    await seed.cleanup();
  }
});

test("verifyJobEvidence: response body never carries absolute paths or fake bearer tokens (fast-check)", async () => {
  const seed = await seedHarnessRun("redaction");
  try {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom(
          "Bearer abcdef-not-real-deadbeef",
          "/private/var/secret",
          "/etc/passwd",
        ),
        async () => {
          const result = await verifyJobEvidence({
            artifactsRoot: seed.artifactsRoot,
            jobId: seed.jobId,
            verifiedAt: VERIFIED_AT,
          });
          assert.equal(result.status, "ok");
          if (result.status !== "ok") return true;
          const serialized = JSON.stringify(result.body);
          // No bearer-token-shaped strings.
          assert.ok(!serialized.includes("Bearer "));
          assert.ok(!serialized.includes("authorization"));
          // No absolute paths from the host filesystem (rough check —
          // any "/var/", "/tmp/", "/private/", "/Users/", or "/etc/"
          // prefix would be a leak).
          for (const prefix of [
            "/var/",
            "/tmp/",
            "/private/",
            "/Users/",
            "/etc/",
            "/home/",
          ]) {
            assert.ok(
              !serialized.includes(prefix),
              `response body leaked absolute path prefix '${prefix}'`,
            );
          }
          return true;
        },
      ),
      { numRuns: 5 },
    );
  } finally {
    await seed.cleanup();
  }
});

test("verifyJobEvidence: response shape matches the documented EvidenceVerifyResponse schema (golden)", async () => {
  const seed = await seedHarnessRun("golden-shape");
  try {
    const result = await verifyJobEvidence({
      artifactsRoot: seed.artifactsRoot,
      jobId: seed.jobId,
      verifiedAt: VERIFIED_AT,
    });
    assert.equal(result.status, "ok");
    if (result.status !== "ok") return;
    const body: EvidenceVerifyResponse = result.body;
    // Required top-level keys.
    const expectedKeys = [
      "schemaVersion",
      "verifiedAt",
      "jobId",
      "ok",
      "manifestSha256",
      "manifestSchemaVersion",
      "testIntelligenceContractVersion",
      "modelDeployments",
      "checks",
      "failures",
    ];
    for (const key of expectedKeys) {
      assert.ok(
        Object.prototype.hasOwnProperty.call(body, key),
        `missing top-level key '${key}'`,
      );
    }
    // Determinism: checks sorted by (kind, reference).
    const sorted = [...body.checks].sort((a, b) => {
      if (a.kind !== b.kind) return a.kind < b.kind ? -1 : 1;
      if (a.reference !== b.reference) {
        return a.reference < b.reference ? -1 : 1;
      }
      return 0;
    });
    assert.deepEqual(body.checks, sorted);
    // Failures sorted by (reference, code).
    const sortedFailures = [...body.failures].sort((a, b) => {
      if (a.reference !== b.reference) {
        return a.reference < b.reference ? -1 : 1;
      }
      if (a.code !== b.code) return a.code < b.code ? -1 : 1;
      return 0;
    });
    assert.deepEqual(body.failures, sortedFailures);
  } finally {
    await seed.cleanup();
  }
});

// Suppress an unused import warning when none of the tests above need
// `dirname`. (Kept for future test additions that work with subdirs.)
void dirname;
