/**
 * Tamper-detection tests extending the #1366 evidence-tampering surface
 * to the new in-toto attestation envelope (Issue #1377).
 *
 * Every attack here corresponds to a field an auditor must be able to
 * detect via `verifyWave1PocAttestation`. Each test mutates the on-disk
 * artifacts AFTER the attestation is persisted, so the manifest+digest
 * witnesses still claim the original bytes.
 *
 * The verifier MUST surface a structured `Wave1PocAttestationVerificationFailure`
 * naming the specific subject / artifact path / signature reference
 * that failed.
 */

import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  WAVE1_POC_ATTESTATION_ARTIFACT_FILENAME,
  WAVE1_POC_ATTESTATION_BUNDLE_FILENAME,
  WAVE1_POC_ATTESTATIONS_DIRECTORY,
  WAVE1_POC_SIGNATURES_DIRECTORY,
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

interface ScenarioFixture {
  runDir: string;
  manifest: Wave1PocEvidenceManifest;
  manifestSha256: string;
  cleanup: () => Promise<void>;
}

const setupScenario = async (): Promise<ScenarioFixture> => {
  const runDir = await mkdtemp(join(tmpdir(), "wave1-poc-tamper-"));
  const intent = utf8('{"intent":"sample-tamper"}\n');
  const validation = utf8('{"validation":"sample-tamper"}\n');
  await writeFile(join(runDir, "business-intent-ir.json"), intent);
  await writeFile(join(runDir, "validation-report.json"), validation);
  const manifest = buildWave1PocEvidenceManifest({
    fixtureId: "poc-onboarding",
    jobId: "job-1377-tamper",
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
  return {
    runDir,
    manifest,
    manifestSha256: computeWave1PocEvidenceManifestDigest(manifest),
    cleanup: () => rm(runDir, { recursive: true, force: true }),
  };
};

test("attestation-tampering: subject digest mismatch when artifact is mutated", async (t) => {
  const fx = await setupScenario();
  t.after(() => fx.cleanup());
  const statement = buildWave1PocAttestationStatement({
    manifest: fx.manifest,
    manifestSha256: fx.manifestSha256,
    signingMode: "unsigned",
  });
  const envelope = buildUnsignedWave1PocAttestationEnvelope(statement);
  await persistWave1PocAttestation({ envelope, runDir: fx.runDir });
  // Append a single byte to the validation report on disk.
  await writeFile(
    join(fx.runDir, "validation-report.json"),
    Buffer.concat([
      await readFile(join(fx.runDir, "validation-report.json")),
      Buffer.from("X"),
    ]),
  );
  const result = await verifyWave1PocAttestationFromDisk(
    fx.runDir,
    fx.manifest,
    fx.manifestSha256,
    { expectedSigningMode: "unsigned" },
  );
  assert.equal(result.ok, false);
  const failure = result.failures.find(
    (f) =>
      f.code === "subject_digest_mismatch" &&
      f.reference === "validation-report.json",
  );
  assert.ok(
    failure,
    "expected subject_digest_mismatch for validation-report.json",
  );
  assert.match(failure.message, /validation-report\.json/);
});

test("attestation-tampering: payload byte mutation invalidates signature (sigstore)", async (t) => {
  const fx = await setupScenario();
  t.after(() => fx.cleanup());
  const { privateKeyPem, publicKeyPem } = generateWave1PocAttestationKeyPair();
  const signer = createKeyBoundSigstoreSigner({
    signerReference: "tamper-test-signer",
    privateKeyPem,
    publicKeyPem,
  });
  const statement = buildWave1PocAttestationStatement({
    manifest: fx.manifest,
    manifestSha256: fx.manifestSha256,
    signingMode: "sigstore",
  });
  const signed = await buildSignedWave1PocAttestation({ statement, signer });
  // Build an evil envelope that flips bytes in payload but keeps signature.
  const evilPayload = Buffer.from(signed.envelope.payload, "base64");
  evilPayload[0] = (evilPayload[0] ?? 0) ^ 0xff;
  const tampered: Wave1PocAttestationDsseEnvelope = {
    ...signed.envelope,
    payload: evilPayload.toString("base64"),
  };
  const result = await verifyWave1PocAttestation({
    envelope: tampered,
    bundle: signed.bundle,
    manifest: fx.manifest,
    manifestSha256: fx.manifestSha256,
    artifactsDir: fx.runDir,
    expectedSigningMode: "sigstore",
  });
  assert.equal(result.ok, false);
  // Either statement_unparseable or signature_unverified — both are
  // legitimate fail-closed responses for a payload mutation.
  assert.ok(
    result.failures.some((f) =>
      [
        "signature_unverified",
        "statement_unparseable",
        "statement_type_mismatch",
        "envelope_payload_decode_failed",
      ].includes(f.code),
    ),
  );
});

test("attestation-tampering: signature byte flip fails verification", async (t) => {
  const fx = await setupScenario();
  t.after(() => fx.cleanup());
  const { privateKeyPem, publicKeyPem } = generateWave1PocAttestationKeyPair();
  const signer = createKeyBoundSigstoreSigner({
    signerReference: "tamper-sig-signer",
    privateKeyPem,
    publicKeyPem,
  });
  const statement = buildWave1PocAttestationStatement({
    manifest: fx.manifest,
    manifestSha256: fx.manifestSha256,
    signingMode: "sigstore",
  });
  const signed = await buildSignedWave1PocAttestation({ statement, signer });
  // Flip a byte inside the base64 signature.
  const sigBytes = Buffer.from(signed.envelope.signatures[0]!.sig, "base64");
  sigBytes[10] = (sigBytes[10] ?? 0) ^ 0xff;
  const tampered: Wave1PocAttestationDsseEnvelope = {
    ...signed.envelope,
    signatures: [
      {
        keyid: signed.envelope.signatures[0]!.keyid,
        sig: sigBytes.toString("base64"),
      },
    ],
  };
  const tamperedBundle = {
    ...signed.bundle,
    dsseEnvelope: tampered,
  };
  const result = await verifyWave1PocAttestation({
    envelope: tampered,
    bundle: tamperedBundle,
    manifest: fx.manifest,
    manifestSha256: fx.manifestSha256,
    artifactsDir: fx.runDir,
    expectedSigningMode: "sigstore",
  });
  assert.equal(result.ok, false);
  assert.ok(
    result.failures.some((f) => f.code === "signature_unverified"),
    JSON.stringify(result.failures, null, 2),
  );
});

test("attestation-tampering: missing envelope file fails closed", async (t) => {
  const fx = await setupScenario();
  t.after(() => fx.cleanup());
  // Don't persist any attestation — verifyFromDisk should fail closed.
  const result = await verifyWave1PocAttestationFromDisk(
    fx.runDir,
    fx.manifest,
    fx.manifestSha256,
    { expectedSigningMode: "unsigned" },
  );
  assert.equal(result.ok, false);
  assert.ok(result.failures.some((f) => f.code === "envelope_unparseable"));
});

test("attestation-tampering: missing bundle in sigstore mode fails closed", async (t) => {
  const fx = await setupScenario();
  t.after(() => fx.cleanup());
  const { privateKeyPem, publicKeyPem } = generateWave1PocAttestationKeyPair();
  const signer = createKeyBoundSigstoreSigner({
    signerReference: "no-bundle-signer",
    privateKeyPem,
    publicKeyPem,
  });
  const statement = buildWave1PocAttestationStatement({
    manifest: fx.manifest,
    manifestSha256: fx.manifestSha256,
    signingMode: "sigstore",
  });
  const signed = await buildSignedWave1PocAttestation({ statement, signer });
  // Persist envelope but NOT bundle.
  await persistWave1PocAttestation({
    envelope: signed.envelope,
    runDir: fx.runDir,
  });
  const result = await verifyWave1PocAttestationFromDisk(
    fx.runDir,
    fx.manifest,
    fx.manifestSha256,
    { expectedSigningMode: "sigstore" },
  );
  assert.equal(result.ok, false);
  assert.ok(result.failures.some((f) => f.code === "bundle_missing"));
});

test("attestation-tampering: unparseable envelope JSON fails closed", async (t) => {
  const fx = await setupScenario();
  t.after(() => fx.cleanup());
  const statement = buildWave1PocAttestationStatement({
    manifest: fx.manifest,
    manifestSha256: fx.manifestSha256,
    signingMode: "unsigned",
  });
  const envelope = buildUnsignedWave1PocAttestationEnvelope(statement);
  await persistWave1PocAttestation({ envelope, runDir: fx.runDir });
  await writeFile(
    join(
      fx.runDir,
      WAVE1_POC_ATTESTATIONS_DIRECTORY,
      WAVE1_POC_ATTESTATION_ARTIFACT_FILENAME,
    ),
    "not valid json {",
  );
  const result = await verifyWave1PocAttestationFromDisk(
    fx.runDir,
    fx.manifest,
    fx.manifestSha256,
    { expectedSigningMode: "unsigned" },
  );
  assert.equal(result.ok, false);
  assert.ok(result.failures.some((f) => f.code === "envelope_unparseable"));
});

test("attestation-tampering: predicate jobId rewrite is detected", async (t) => {
  const fx = await setupScenario();
  t.after(() => fx.cleanup());
  const statement = buildWave1PocAttestationStatement({
    manifest: fx.manifest,
    manifestSha256: fx.manifestSha256,
    signingMode: "unsigned",
  });
  const envelope = buildUnsignedWave1PocAttestationEnvelope(statement);
  await persistWave1PocAttestation({ envelope, runDir: fx.runDir });

  const path = join(
    fx.runDir,
    WAVE1_POC_ATTESTATIONS_DIRECTORY,
    WAVE1_POC_ATTESTATION_ARTIFACT_FILENAME,
  );
  const onDisk = JSON.parse(
    (await readFile(path)).toString("utf8"),
  ) as Wave1PocAttestationDsseEnvelope;
  const decodedStatement = JSON.parse(
    Buffer.from(onDisk.payload, "base64").toString("utf8"),
  ) as ReturnType<typeof buildWave1PocAttestationStatement>;
  decodedStatement.predicate.jobId = "job-evil-rewrite";
  const evilPayload = Buffer.from(canonicalJson(decodedStatement), "utf8");
  await writeFile(
    path,
    canonicalJson({
      ...onDisk,
      payload: evilPayload.toString("base64"),
    }),
  );

  const result = await verifyWave1PocAttestationFromDisk(
    fx.runDir,
    fx.manifest,
    fx.manifestSha256,
    { expectedSigningMode: "unsigned" },
  );
  assert.equal(result.ok, false);
  const jobIdFail = result.failures.find(
    (f) => f.code === "statement_predicate_invalid" && f.reference === "jobId",
  );
  assert.ok(jobIdFail, "expected statement_predicate_invalid on jobId");
});

test("attestation-tampering: predicate hard invariant rewrite (rawScreenshotsIncluded=true) detected", async (t) => {
  const fx = await setupScenario();
  t.after(() => fx.cleanup());
  const statement = buildWave1PocAttestationStatement({
    manifest: fx.manifest,
    manifestSha256: fx.manifestSha256,
    signingMode: "unsigned",
  });
  const envelope = buildUnsignedWave1PocAttestationEnvelope(statement);
  await persistWave1PocAttestation({ envelope, runDir: fx.runDir });

  const path = join(
    fx.runDir,
    WAVE1_POC_ATTESTATIONS_DIRECTORY,
    WAVE1_POC_ATTESTATION_ARTIFACT_FILENAME,
  );
  const onDisk = JSON.parse(
    (await readFile(path)).toString("utf8"),
  ) as Wave1PocAttestationDsseEnvelope;
  const decodedStatement = JSON.parse(
    Buffer.from(onDisk.payload, "base64").toString("utf8"),
  ) as ReturnType<typeof buildWave1PocAttestationStatement>;
  // Defeat the type-level `false` literal at runtime to test the verifier.
  (
    decodedStatement.predicate as unknown as { rawScreenshotsIncluded: boolean }
  ).rawScreenshotsIncluded = true;
  await writeFile(
    path,
    canonicalJson({
      ...onDisk,
      payload: Buffer.from(canonicalJson(decodedStatement), "utf8").toString(
        "base64",
      ),
    }),
  );

  const result = await verifyWave1PocAttestationFromDisk(
    fx.runDir,
    fx.manifest,
    fx.manifestSha256,
    { expectedSigningMode: "unsigned" },
  );
  assert.equal(result.ok, false);
  assert.ok(
    result.failures.some(
      (f) =>
        f.code === "statement_predicate_invalid" &&
        f.reference === "rawScreenshotsIncluded",
    ),
  );
});

test("attestation-tampering: bundle file replaced with attacker bundle is detected", async (t) => {
  const fx = await setupScenario();
  t.after(() => fx.cleanup());

  // Real signer and real bundle.
  const real = generateWave1PocAttestationKeyPair();
  const realSigner = createKeyBoundSigstoreSigner({
    signerReference: "real-signer-99",
    privateKeyPem: real.privateKeyPem,
    publicKeyPem: real.publicKeyPem,
  });
  const statement = buildWave1PocAttestationStatement({
    manifest: fx.manifest,
    manifestSha256: fx.manifestSha256,
    signingMode: "sigstore",
  });
  const realSigned = await buildSignedWave1PocAttestation({
    statement,
    signer: realSigner,
  });
  await persistWave1PocAttestation({
    envelope: realSigned.envelope,
    bundle: realSigned.bundle,
    runDir: fx.runDir,
  });

  // Attacker swaps the bundle file for one signed with their own key.
  const attacker = generateWave1PocAttestationKeyPair();
  const attackerSigner = createKeyBoundSigstoreSigner({
    signerReference: "real-signer-99", // pretend to be real
    privateKeyPem: attacker.privateKeyPem,
    publicKeyPem: attacker.publicKeyPem,
  });
  const attackerSigned = await buildSignedWave1PocAttestation({
    statement,
    signer: attackerSigner,
  });
  await writeFile(
    join(
      fx.runDir,
      WAVE1_POC_SIGNATURES_DIRECTORY,
      WAVE1_POC_ATTESTATION_BUNDLE_FILENAME,
    ),
    canonicalJson(attackerSigned.bundle),
  );

  // Verify with the REAL public key — attacker's signature must fail.
  const result = await verifyWave1PocAttestationFromDisk(
    fx.runDir,
    fx.manifest,
    fx.manifestSha256,
    {
      expectedSigningMode: "sigstore",
      publicKey: {
        hint: "real-signer-99",
        publicKeyPem: real.publicKeyPem,
        algorithm: "ecdsa-p256-sha256",
      },
    },
  );
  assert.equal(result.ok, false);
  // Failure could be bundle_envelope_mismatch (envelope file untouched but
  // bundle now embeds attacker's signature) OR signature_unverified.
  assert.ok(
    result.failures.some((f) =>
      ["bundle_envelope_mismatch", "signature_unverified"].includes(f.code),
    ),
    JSON.stringify(result.failures, null, 2),
  );
});

test("attestation-tampering: requireFullSubjectCoverage catches dropped subject", async (t) => {
  const fx = await setupScenario();
  t.after(() => fx.cleanup());
  const statement = buildWave1PocAttestationStatement({
    manifest: fx.manifest,
    manifestSha256: fx.manifestSha256,
    signingMode: "unsigned",
  });
  // Drop a subject from the statement before encoding.
  const tamperedSubjects = statement.subject.filter(
    (s) => s.name !== "validation-report.json",
  );
  const tamperedStatement = { ...statement, subject: tamperedSubjects };
  const tamperedPayload = utf8(canonicalJson(tamperedStatement));
  const tamperedEnvelope: Wave1PocAttestationDsseEnvelope = {
    payload: Buffer.from(tamperedPayload).toString("base64"),
    payloadType: statement.predicate
      ? // ensure pinned payloadType remains
        ("application/vnd.in-toto+json" as const)
      : ("application/vnd.in-toto+json" as const),
    signatures: [],
  };
  const result = await verifyWave1PocAttestation({
    envelope: tamperedEnvelope,
    manifest: fx.manifest,
    manifestSha256: fx.manifestSha256,
    artifactsDir: fx.runDir,
    expectedSigningMode: "unsigned",
  });
  assert.equal(result.ok, false);
  assert.ok(
    result.failures.some(
      (f) =>
        f.code === "subject_unattested_artifact" &&
        f.reference === "validation-report.json",
    ),
  );
});
