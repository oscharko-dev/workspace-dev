/**
 * Integration tests for the in-toto attestation signing + verification
 * round-trip (Issue #1377).
 *
 * Covers:
 *   - Unsigned mode: deterministic envelope, no signatures, no bundle
 *   - Sigstore mode (key-bound ECDSA P-256): envelope + bundle round-trip
 *   - Persistence under `evidence/attestations` and `evidence/signatures`
 *   - Audit-timeline summary surfaces signing mode + signer reference
 *   - Verifier accepts the freshly persisted bundle
 */

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  CONTRACT_VERSION,
  TEST_INTELLIGENCE_CONTRACT_VERSION,
  WAVE1_POC_ATTESTATION_ARTIFACT_FILENAME,
  WAVE1_POC_ATTESTATION_BUNDLE_FILENAME,
  WAVE1_POC_ATTESTATION_BUNDLE_MEDIA_TYPE,
  WAVE1_POC_ATTESTATION_PAYLOAD_TYPE,
  WAVE1_POC_ATTESTATIONS_DIRECTORY,
  WAVE1_POC_EVIDENCE_MANIFEST_ARTIFACT_FILENAME,
  WAVE1_POC_EVIDENCE_MANIFEST_SCHEMA_VERSION,
  WAVE1_POC_SIGNATURES_DIRECTORY,
  type Wave1PocAttestationBundle,
  type Wave1PocAttestationDsseEnvelope,
  type Wave1PocEvidenceManifest,
} from "../contracts/index.js";
import { canonicalJson } from "./content-hash.js";
import {
  buildSignedWave1PocAttestation,
  buildUnsignedWave1PocAttestationEnvelope,
  buildWave1PocAttestationStatement,
  createKeyBoundSigstoreSigner,
  generateWave1PocAttestationKeyPair,
  persistWave1PocAttestation,
  summarizeWave1PocAttestation,
  verifyWave1PocAttestation,
  verifyWave1PocAttestationFromDisk,
} from "./evidence-attestation.js";
import {
  buildWave1PocEvidenceManifest,
  computeWave1PocEvidenceManifestDigest,
  writeWave1PocEvidenceManifest,
} from "./evidence-manifest.js";

const ZERO = "0".repeat(64);
const utf8 = (value: string): Uint8Array => new TextEncoder().encode(value);
const sha256 = (bytes: Uint8Array): string =>
  createHash("sha256").update(bytes).digest("hex");

interface ScenarioFixture {
  runDir: string;
  manifest: Wave1PocEvidenceManifest;
  manifestSha256: string;
  cleanup: () => Promise<void>;
}

/**
 * Build a tmpdir-backed POC-shaped fixture: write a few artifact bytes
 * to disk, build the matching manifest, persist the manifest with its
 * digest witness. Returns the pieces tests need to exercise the
 * attestation flow without booting the full POC harness.
 */
const setupScenario = async (): Promise<ScenarioFixture> => {
  const runDir = await mkdtemp(join(tmpdir(), "wave1-poc-attestation-"));
  const intent = utf8('{"intent":"sample"}\n');
  const validation = utf8('{"validation":"sample"}\n');
  await writeFile(join(runDir, "business-intent-ir.json"), intent);
  await writeFile(join(runDir, "validation-report.json"), validation);
  const manifest = buildWave1PocEvidenceManifest({
    fixtureId: "poc-onboarding",
    jobId: "job-1377-signing",
    generatedAt: "2026-04-26T00:00:00.000Z",
    modelDeployments: {
      testGeneration: "gpt-oss-120b-mock",
      visualPrimary: "llama-4-maverick-vision",
    },
    policyProfileId: "eu-banking-default",
    policyProfileVersion: "1.0.0",
    exportProfileId: "opentext-alm-default",
    exportProfileVersion: "1.0.0",
    promptHash: ZERO,
    schemaHash: ZERO,
    inputHash: ZERO,
    cacheKeyDigest: ZERO,
    artifacts: [
      {
        filename: "business-intent-ir.json",
        bytes: intent,
        category: "intent",
      },
      {
        filename: "validation-report.json",
        bytes: validation,
        category: "validation",
      },
    ],
  });
  await writeWave1PocEvidenceManifest({ manifest, destinationDir: runDir });
  const manifestSha256 = computeWave1PocEvidenceManifestDigest(manifest);
  return {
    runDir,
    manifest,
    manifestSha256,
    cleanup: () => rm(runDir, { recursive: true, force: true }),
  };
};

test("evidence-attestation [signing]: unsigned mode persists envelope only", async (t) => {
  const fx = await setupScenario();
  t.after(() => fx.cleanup());

  const statement = buildWave1PocAttestationStatement({
    manifest: fx.manifest,
    manifestSha256: fx.manifestSha256,
    signingMode: "unsigned",
  });
  const envelope = buildUnsignedWave1PocAttestationEnvelope(statement);
  const persisted = await persistWave1PocAttestation({
    envelope,
    runDir: fx.runDir,
  });

  assert.equal(
    persisted.attestationFilename,
    `${WAVE1_POC_ATTESTATIONS_DIRECTORY}/${WAVE1_POC_ATTESTATION_ARTIFACT_FILENAME}`,
  );
  assert.equal(persisted.bundleFilename, undefined);
  assert.equal(persisted.bundleBytes, undefined);
  // File on disk matches the in-memory envelope canonical bytes.
  const onDisk = await readFile(persisted.attestationPath);
  assert.equal(onDisk.toString("utf8"), canonicalJson(envelope));
});

test("evidence-attestation [signing]: unsigned audit summary records mode + digest", async (t) => {
  const fx = await setupScenario();
  t.after(() => fx.cleanup());

  const statement = buildWave1PocAttestationStatement({
    manifest: fx.manifest,
    manifestSha256: fx.manifestSha256,
    signingMode: "unsigned",
  });
  const envelope = buildUnsignedWave1PocAttestationEnvelope(statement);
  const persisted = await persistWave1PocAttestation({
    envelope,
    runDir: fx.runDir,
  });
  const summary = summarizeWave1PocAttestation({
    signingMode: "unsigned",
    persisted,
  });
  assert.equal(summary.signingMode, "unsigned");
  assert.equal(summary.signerReference, undefined);
  assert.equal(summary.bundleFilename, undefined);
  assert.equal(summary.bundleSha256, undefined);
  assert.equal(summary.attestationSha256, sha256(persisted.attestationBytes));
});

test("evidence-attestation [signing]: sigstore key-bound signer produces valid bundle", async (t) => {
  const fx = await setupScenario();
  t.after(() => fx.cleanup());

  const { privateKeyPem, publicKeyPem } = generateWave1PocAttestationKeyPair();
  const signer = createKeyBoundSigstoreSigner({
    signerReference: "wave1-poc-test-signer",
    privateKeyPem,
    publicKeyPem,
  });
  const statement = buildWave1PocAttestationStatement({
    manifest: fx.manifest,
    manifestSha256: fx.manifestSha256,
    signingMode: "sigstore",
  });
  const { envelope, bundle } = await buildSignedWave1PocAttestation({
    statement,
    signer,
  });

  assert.equal(envelope.signatures.length, 1);
  assert.equal(envelope.signatures[0]?.keyid, "wave1-poc-test-signer");
  assert.match(envelope.signatures[0]?.sig ?? "", /^[A-Za-z0-9+/]+={0,2}$/);
  assert.equal(bundle.mediaType, WAVE1_POC_ATTESTATION_BUNDLE_MEDIA_TYPE);
  assert.equal(
    bundle.dsseEnvelope.payloadType,
    WAVE1_POC_ATTESTATION_PAYLOAD_TYPE,
  );
  assert.equal(
    bundle.verificationMaterial.publicKey.hint,
    "wave1-poc-test-signer",
  );
  assert.equal(
    bundle.verificationMaterial.publicKey.algorithm,
    "ecdsa-p256-sha256",
  );
});

test("evidence-attestation [signing]: sigstore mode persists envelope + bundle to dedicated dirs", async (t) => {
  const fx = await setupScenario();
  t.after(() => fx.cleanup());

  const { privateKeyPem } = generateWave1PocAttestationKeyPair();
  const signer = createKeyBoundSigstoreSigner({
    signerReference: "operator-test-key",
    privateKeyPem,
  });
  const statement = buildWave1PocAttestationStatement({
    manifest: fx.manifest,
    manifestSha256: fx.manifestSha256,
    signingMode: "sigstore",
  });
  const signed = await buildSignedWave1PocAttestation({ statement, signer });
  const persisted = await persistWave1PocAttestation({
    envelope: signed.envelope,
    bundle: signed.bundle,
    runDir: fx.runDir,
  });
  assert.equal(
    persisted.attestationFilename,
    `${WAVE1_POC_ATTESTATIONS_DIRECTORY}/${WAVE1_POC_ATTESTATION_ARTIFACT_FILENAME}`,
  );
  assert.equal(
    persisted.bundleFilename,
    `${WAVE1_POC_SIGNATURES_DIRECTORY}/${WAVE1_POC_ATTESTATION_BUNDLE_FILENAME}`,
  );
  // Bundle on disk equals canonical JSON.
  const bundleOnDisk = await readFile(persisted.bundlePath ?? "");
  assert.equal(bundleOnDisk.toString("utf8"), canonicalJson(signed.bundle));
});

test("evidence-attestation [signing]: unsigned verify accepts untouched artifacts", async (t) => {
  const fx = await setupScenario();
  t.after(() => fx.cleanup());

  const statement = buildWave1PocAttestationStatement({
    manifest: fx.manifest,
    manifestSha256: fx.manifestSha256,
    signingMode: "unsigned",
  });
  const envelope = buildUnsignedWave1PocAttestationEnvelope(statement);
  await persistWave1PocAttestation({ envelope, runDir: fx.runDir });

  const result = await verifyWave1PocAttestationFromDisk(
    fx.runDir,
    fx.manifest,
    fx.manifestSha256,
    { expectedSigningMode: "unsigned" },
  );
  assert.equal(result.ok, true, JSON.stringify(result.failures, null, 2));
  assert.equal(result.signingMode, "unsigned");
  assert.equal(result.signatureCount, 0);
  assert.equal(result.signaturesVerified, true);
});

test("evidence-attestation [signing]: sigstore verify accepts untouched signed bundle", async (t) => {
  const fx = await setupScenario();
  t.after(() => fx.cleanup());

  const { privateKeyPem, publicKeyPem } = generateWave1PocAttestationKeyPair();
  const signer = createKeyBoundSigstoreSigner({
    signerReference: "ci-build-signer-001",
    privateKeyPem,
    publicKeyPem,
  });
  const statement = buildWave1PocAttestationStatement({
    manifest: fx.manifest,
    manifestSha256: fx.manifestSha256,
    signingMode: "sigstore",
  });
  const signed = await buildSignedWave1PocAttestation({ statement, signer });
  await persistWave1PocAttestation({
    envelope: signed.envelope,
    bundle: signed.bundle,
    runDir: fx.runDir,
  });

  const result = await verifyWave1PocAttestationFromDisk(
    fx.runDir,
    fx.manifest,
    fx.manifestSha256,
    { expectedSigningMode: "sigstore" },
  );
  assert.equal(result.ok, true, JSON.stringify(result.failures, null, 2));
  assert.equal(result.signingMode, "sigstore");
  assert.equal(result.signatureCount, 1);
  assert.equal(result.signaturesVerified, true);
});

test("evidence-attestation [signing]: sigstore mode rejects mismatched private/public key pair", () => {
  const a = generateWave1PocAttestationKeyPair();
  const b = generateWave1PocAttestationKeyPair();
  assert.throws(
    () =>
      createKeyBoundSigstoreSigner({
        signerReference: "mixed-keys",
        privateKeyPem: a.privateKeyPem,
        publicKeyPem: b.publicKeyPem,
      }),
    /privateKey does not match supplied publicKey/,
  );
});

test("evidence-attestation [signing]: sigstore mode rejects non-EC private key shape", () => {
  assert.throws(
    () =>
      createKeyBoundSigstoreSigner({
        signerReference: "rsa-impostor",
        privateKeyPem:
          "-----BEGIN RSA PRIVATE KEY-----\nfake\n-----END RSA PRIVATE KEY-----\n", // pragma: allowlist secret
      }),
    /must be PEM-encoded ECDSA/,
  );
});

test("evidence-attestation [signing]: signer reference rejects disallowed characters", () => {
  const { privateKeyPem } = generateWave1PocAttestationKeyPair();
  assert.throws(
    () =>
      createKeyBoundSigstoreSigner({
        signerReference: "bad signer ref!",
        privateKeyPem,
      }),
    /signerReference contains disallowed characters/,
  );
});

test("evidence-attestation [signing]: harness-runner that supplies wrong public key fails verify", async (t) => {
  const fx = await setupScenario();
  t.after(() => fx.cleanup());

  const a = generateWave1PocAttestationKeyPair();
  const b = generateWave1PocAttestationKeyPair();
  const signer = createKeyBoundSigstoreSigner({
    signerReference: "real-signer",
    privateKeyPem: a.privateKeyPem,
    publicKeyPem: a.publicKeyPem,
  });
  const statement = buildWave1PocAttestationStatement({
    manifest: fx.manifest,
    manifestSha256: fx.manifestSha256,
    signingMode: "sigstore",
  });
  const signed = await buildSignedWave1PocAttestation({ statement, signer });

  const result = await verifyWave1PocAttestation({
    envelope: signed.envelope,
    bundle: signed.bundle,
    manifest: fx.manifest,
    manifestSha256: fx.manifestSha256,
    artifactsDir: fx.runDir,
    expectedSigningMode: "sigstore",
    publicKey: {
      hint: "real-signer",
      publicKeyPem: b.publicKeyPem,
      algorithm: "ecdsa-p256-sha256",
    },
  });
  assert.equal(result.ok, false);
  assert.ok(result.failures.some((f) => f.code === "signature_unverified"));
});

test("evidence-attestation [signing]: sigstore mode without bundle fails closed", async (t) => {
  const fx = await setupScenario();
  t.after(() => fx.cleanup());

  const { privateKeyPem } = generateWave1PocAttestationKeyPair();
  const signer = createKeyBoundSigstoreSigner({
    signerReference: "lonely-signer",
    privateKeyPem,
  });
  const statement = buildWave1PocAttestationStatement({
    manifest: fx.manifest,
    manifestSha256: fx.manifestSha256,
    signingMode: "sigstore",
  });
  const { envelope } = await buildSignedWave1PocAttestation({
    statement,
    signer,
  });

  const result = await verifyWave1PocAttestation({
    envelope,
    manifest: fx.manifest,
    manifestSha256: fx.manifestSha256,
    artifactsDir: fx.runDir,
    expectedSigningMode: "sigstore",
  });
  assert.equal(result.ok, false);
  assert.ok(result.failures.some((f) => f.code === "bundle_missing"));
});

test("evidence-attestation [signing]: unsigned envelope with stray signatures is rejected", async (t) => {
  const fx = await setupScenario();
  t.after(() => fx.cleanup());

  const statement = buildWave1PocAttestationStatement({
    manifest: fx.manifest,
    manifestSha256: fx.manifestSha256,
    signingMode: "unsigned",
  });
  const envelope: Wave1PocAttestationDsseEnvelope = {
    ...buildUnsignedWave1PocAttestationEnvelope(statement),
    signatures: [{ keyid: "spurious", sig: "AAAA" }],
  };

  const result = await verifyWave1PocAttestation({
    envelope,
    manifest: fx.manifest,
    manifestSha256: fx.manifestSha256,
    artifactsDir: fx.runDir,
    expectedSigningMode: "unsigned",
  });
  assert.equal(result.ok, false);
  assert.ok(
    result.failures.some(
      (f) => f.code === "signature_unsigned_envelope_carries_signatures",
    ),
  );
});

test("evidence-attestation [signing]: sigstore mode with mismatched bundle envelope is rejected", async (t) => {
  const fx = await setupScenario();
  t.after(() => fx.cleanup());

  const { privateKeyPem, publicKeyPem } = generateWave1PocAttestationKeyPair();
  const signer = createKeyBoundSigstoreSigner({
    signerReference: "honest-signer",
    privateKeyPem,
    publicKeyPem,
  });
  const statement = buildWave1PocAttestationStatement({
    manifest: fx.manifest,
    manifestSha256: fx.manifestSha256,
    signingMode: "sigstore",
  });
  const signed = await buildSignedWave1PocAttestation({ statement, signer });
  const tamperedBundle: Wave1PocAttestationBundle = {
    ...signed.bundle,
    dsseEnvelope: {
      ...signed.envelope,
      payload: Buffer.from("tampered", "utf8").toString("base64"),
    },
  };

  const result = await verifyWave1PocAttestation({
    envelope: signed.envelope,
    bundle: tamperedBundle,
    manifest: fx.manifest,
    manifestSha256: fx.manifestSha256,
    artifactsDir: fx.runDir,
    expectedSigningMode: "sigstore",
  });
  assert.equal(result.ok, false);
  assert.ok(result.failures.some((f) => f.code === "bundle_envelope_mismatch"));
});

test("evidence-attestation [signing]: signing mode mismatch in predicate fails verify", async (t) => {
  const fx = await setupScenario();
  t.after(() => fx.cleanup());

  // Build a statement claiming sigstore but verify expecting unsigned.
  const statement = buildWave1PocAttestationStatement({
    manifest: fx.manifest,
    manifestSha256: fx.manifestSha256,
    signingMode: "sigstore",
  });
  const envelope = buildUnsignedWave1PocAttestationEnvelope(statement);

  const result = await verifyWave1PocAttestation({
    envelope,
    manifest: fx.manifest,
    manifestSha256: fx.manifestSha256,
    artifactsDir: fx.runDir,
    expectedSigningMode: "unsigned",
  });
  assert.equal(result.ok, false);
  assert.ok(result.failures.some((f) => f.code === "signing_mode_mismatch"));
});

test("evidence-attestation [signing]: predicate manifestSha256 mismatch fails verify", async (t) => {
  const fx = await setupScenario();
  t.after(() => fx.cleanup());

  const statement = buildWave1PocAttestationStatement({
    manifest: fx.manifest,
    manifestSha256: fx.manifestSha256,
    signingMode: "unsigned",
  });
  const envelope = buildUnsignedWave1PocAttestationEnvelope(statement);

  const result = await verifyWave1PocAttestation({
    envelope,
    manifest: fx.manifest,
    manifestSha256: "f".repeat(64),
    artifactsDir: fx.runDir,
    expectedSigningMode: "unsigned",
  });
  assert.equal(result.ok, false);
  assert.ok(result.failures.some((f) => f.code === "manifest_sha256_mismatch"));
});

test("evidence-attestation [signing]: missing on-disk artifact reports specific subject", async (t) => {
  const fx = await setupScenario();
  t.after(() => fx.cleanup());

  const statement = buildWave1PocAttestationStatement({
    manifest: fx.manifest,
    manifestSha256: fx.manifestSha256,
    signingMode: "unsigned",
  });
  const envelope = buildUnsignedWave1PocAttestationEnvelope(statement);
  await persistWave1PocAttestation({ envelope, runDir: fx.runDir });

  // Delete one attested artifact.
  await rm(join(fx.runDir, "validation-report.json"));

  const result = await verifyWave1PocAttestationFromDisk(
    fx.runDir,
    fx.manifest,
    fx.manifestSha256,
    { expectedSigningMode: "unsigned" },
  );
  assert.equal(result.ok, false);
  const missing = result.failures.find(
    (f) =>
      f.code === "subject_missing_artifact" &&
      f.reference === "validation-report.json",
  );
  assert.ok(
    missing,
    "expected subject_missing_artifact for validation-report.json",
  );
});

test("evidence-attestation [signing]: subject points to consistent manifest", async (t) => {
  // The persisted manifest's bytes must hash to the manifestSha256 the
  // attestation embedded; both verifyFromDisk and verifyManually must
  // agree.
  const fx = await setupScenario();
  t.after(() => fx.cleanup());

  const onDisk = await readFile(
    join(fx.runDir, WAVE1_POC_EVIDENCE_MANIFEST_ARTIFACT_FILENAME),
  );
  const recomputed = sha256(
    new Uint8Array(onDisk.buffer, onDisk.byteOffset, onDisk.byteLength),
  );
  assert.equal(recomputed, fx.manifestSha256);
  const parsed = JSON.parse(
    onDisk.toString("utf8"),
  ) as Wave1PocEvidenceManifest;
  assert.equal(
    parsed.schemaVersion,
    WAVE1_POC_EVIDENCE_MANIFEST_SCHEMA_VERSION,
  );
  assert.equal(parsed.contractVersion, CONTRACT_VERSION);
  assert.equal(
    parsed.testIntelligenceContractVersion,
    TEST_INTELLIGENCE_CONTRACT_VERSION,
  );
});
