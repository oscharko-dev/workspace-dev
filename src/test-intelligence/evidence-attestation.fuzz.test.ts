/**
 * Property-based tests for the security-critical primitives in the
 * in-toto attestation pipeline (Issue #1377 follow-up).
 *
 * Each property below is a structural invariant the verifier relies on
 * so a future contributor cannot accidentally weaken it. We use
 * `fast-check` shrinking to surface counterexamples; the property
 * suite runs as part of `test:ti-eval`.
 */

import assert from "node:assert/strict";
import test from "node:test";
import fc from "fast-check";

import {
  WAVE1_VALIDATION_ATTESTATION_PAYLOAD_TYPE,
  type Wave1ValidationAttestationDsseEnvelope,
  type Wave1ValidationEvidenceManifest,
} from "../contracts/index.js";
import {
  buildSignedWave1ValidationAttestation,
  buildUnsignedWave1ValidationAttestationEnvelope,
  buildWave1ValidationAttestationStatement,
  createKeyBoundSigstoreSigner,
  encodeDssePreAuth,
  generateWave1ValidationAttestationKeyPair,
  verifyWave1ValidationAttestation,
} from "./evidence-attestation.js";

const ZERO = "0".repeat(64);

const fakeManifest = (jobId: string): Wave1ValidationEvidenceManifest => ({
  schemaVersion: "1.0.0" as const,
  contractVersion: "3.31.0",
  testIntelligenceContractVersion: "1.0.0" as const,
  fixtureId: "validation-onboarding",
  jobId,
  generatedAt: "2026-04-26T00:00:00.000Z",
  promptTemplateVersion: "1.0.0" as const,
  generatedTestCaseSchemaVersion: "1.0.0" as const,
  visualSidecarSchemaVersion: "1.0.0" as const,
  redactionPolicyVersion: "1.0.0" as const,
  policyProfileId: "eu-banking-default",
  policyProfileVersion: "1.0.0",
  exportProfileId: "opentext-alm-default",
  exportProfileVersion: "1.0.0",
  modelDeployments: { testGeneration: "gpt-oss-120b-mock" },
  promptHash: ZERO,
  schemaHash: ZERO,
  inputHash: ZERO,
  cacheKeyDigest: ZERO,
  artifacts: [],
  rawScreenshotsIncluded: false,
  imagePayloadSentToTestGeneration: false,
});

test("fuzz: PAE encoding starts with literal DSSEv1 prefix for any payload", () => {
  fc.assert(
    fc.property(
      fc.uint8Array({ maxLength: 4096 }),
      fc.string({ maxLength: 64 }).filter((s) => !/[\s\x00-\x1f]/.test(s)),
      (payload, payloadType) => {
        if (payloadType.length === 0) return true;
        const pae = encodeDssePreAuth(payloadType, payload);
        const text = new TextDecoder().decode(pae);
        return text.startsWith("DSSEv1 ");
      },
    ),
    { numRuns: 200 },
  );
});

test("fuzz: PAE length tail equals payload byte length and content", () => {
  fc.assert(
    fc.property(fc.uint8Array({ maxLength: 4096 }), (payload) => {
      const pae = encodeDssePreAuth(
        WAVE1_VALIDATION_ATTESTATION_PAYLOAD_TYPE,
        payload,
      );
      // PAE = "DSSEv1 LEN(type) SP type SP LEN(payload) SP payload"
      const headerStr = `DSSEv1 ${WAVE1_VALIDATION_ATTESTATION_PAYLOAD_TYPE.length} ${WAVE1_VALIDATION_ATTESTATION_PAYLOAD_TYPE} ${payload.byteLength} `;
      const headerBytes = new TextEncoder().encode(headerStr);
      if (pae.byteLength !== headerBytes.byteLength + payload.byteLength) {
        return false;
      }
      for (let i = 0; i < payload.byteLength; i += 1) {
        if (pae[headerBytes.byteLength + i] !== payload[i]) return false;
      }
      return true;
    }),
    { numRuns: 200 },
  );
});

test("fuzz: distinct payloadType inputs always produce distinct PAE bytes", () => {
  fc.assert(
    fc.property(
      fc.uint8Array({ maxLength: 256 }),
      fc
        .string({ minLength: 1, maxLength: 32 })
        .filter((s) => !/[\s\x00-\x1f]/.test(s)),
      fc
        .string({ minLength: 1, maxLength: 32 })
        .filter((s) => !/[\s\x00-\x1f]/.test(s)),
      (payload, typeA, typeB) => {
        if (typeA === typeB) return true;
        const a = encodeDssePreAuth(typeA, payload);
        const b = encodeDssePreAuth(typeB, payload);
        // Different types must yield different bytes.
        if (a.byteLength === b.byteLength) {
          let identical = true;
          for (let i = 0; i < a.byteLength; i += 1) {
            if (a[i] !== b[i]) {
              identical = false;
              break;
            }
          }
          if (identical) return false;
        }
        return true;
      },
    ),
    { numRuns: 200 },
  );
});

test("fuzz: base64 round-trip preserves arbitrary bytes (encode→decode)", () => {
  fc.assert(
    fc.property(fc.uint8Array({ maxLength: 8192 }), (bytes) => {
      const b64 = Buffer.from(bytes).toString("base64");
      const decoded = Buffer.from(b64, "base64");
      if (decoded.byteLength !== bytes.byteLength) return false;
      for (let i = 0; i < bytes.byteLength; i += 1) {
        if (decoded[i] !== bytes[i]) return false;
      }
      return true;
    }),
    { numRuns: 200 },
  );
});

test("fuzz: signed envelope verifies for any well-formed jobId", async () => {
  const { privateKeyPem, publicKeyPem } = generateWave1ValidationAttestationKeyPair();
  await fc.assert(
    fc.asyncProperty(
      fc
        .string({ minLength: 1, maxLength: 64 })
        .filter((s) => /^[A-Za-z0-9._:\-/]{1,64}$/.test(s)),
      async (jobId) => {
        const manifest = fakeManifest(jobId);
        // manifestSha256 is opaque to the verifier here; we just need it
        // to be a hex string.
        const manifestSha256 = ZERO;
        const signer = createKeyBoundSigstoreSigner({
          signerReference: "fuzz-signer",
          privateKeyPem,
          publicKeyPem,
        });
        const statement = buildWave1ValidationAttestationStatement({
          manifest,
          manifestSha256,
          signingMode: "sigstore",
        });
        const signed = await buildSignedWave1ValidationAttestation({
          statement,
          signer,
        });
        const result = await verifyWave1ValidationAttestation({
          envelope: signed.envelope,
          bundle: signed.bundle,
          manifest,
          manifestSha256,
          artifactsDir: "/tmp",
          expectedSigningMode: "sigstore",
        });
        // Round-trip must verify (artifacts are empty so no on-disk reads).
        return (
          result.signatureCount === 1 && result.signaturesVerified === true
        );
      },
    ),
    { numRuns: 30 },
  );
});

test("fuzz: any single byte flip in DSSE payload invalidates signature", async () => {
  const { privateKeyPem, publicKeyPem } = generateWave1ValidationAttestationKeyPair();
  const signer = createKeyBoundSigstoreSigner({
    signerReference: "fuzz-flip-signer",
    privateKeyPem,
    publicKeyPem,
  });
  const baseManifest = fakeManifest("fuzz-flip-job");
  const statement = buildWave1ValidationAttestationStatement({
    manifest: baseManifest,
    manifestSha256: ZERO,
    signingMode: "sigstore",
  });
  const signed = await buildSignedWave1ValidationAttestation({ statement, signer });
  const baseBytes = Buffer.from(signed.envelope.payload, "base64");

  await fc.assert(
    fc.asyncProperty(
      fc.integer({ min: 0, max: baseBytes.byteLength - 1 }),
      fc.integer({ min: 1, max: 255 }),
      async (idx, xor) => {
        const flipped = Buffer.from(baseBytes);
        flipped[idx] = (flipped[idx] ?? 0) ^ xor;
        if (flipped.equals(baseBytes)) return true; // skip degenerate flip
        const tampered: Wave1ValidationAttestationDsseEnvelope = {
          ...signed.envelope,
          payload: flipped.toString("base64"),
        };
        const result = await verifyWave1ValidationAttestation({
          envelope: tampered,
          bundle: signed.bundle,
          manifest: baseManifest,
          manifestSha256: ZERO,
          artifactsDir: "/tmp",
          expectedSigningMode: "sigstore",
        });
        // Any byte-flip must cause verification failure (sig invalid OR
        // the decoded statement no longer parses).
        return result.ok === false;
      },
    ),
    { numRuns: 30 },
  );
});

test("fuzz: unsigned envelope verifier rejects ANY signature insertion", async () => {
  await fc.assert(
    fc.asyncProperty(
      fc
        .string({ minLength: 1, maxLength: 32 })
        .filter((s) => /^[A-Za-z0-9._:\-/]{1,32}$/.test(s)),
      fc.uint8Array({ minLength: 1, maxLength: 128 }),
      async (keyid, sigBytes) => {
        const manifest = fakeManifest("fuzz-unsigned-stray-sig");
        const statement = buildWave1ValidationAttestationStatement({
          manifest,
          manifestSha256: ZERO,
          signingMode: "unsigned",
        });
        const baseEnvelope =
          buildUnsignedWave1ValidationAttestationEnvelope(statement);
        const tampered: Wave1ValidationAttestationDsseEnvelope = {
          ...baseEnvelope,
          signatures: [
            {
              keyid,
              sig: Buffer.from(sigBytes).toString("base64"),
            },
          ],
        };
        const result = await verifyWave1ValidationAttestation({
          envelope: tampered,
          manifest,
          manifestSha256: ZERO,
          artifactsDir: "/tmp",
          expectedSigningMode: "unsigned",
        });
        return (
          result.ok === false &&
          result.failures.some(
            (f) => f.code === "signature_unsigned_envelope_carries_signatures",
          )
        );
      },
    ),
    { numRuns: 30 },
  );
});

test("fuzz: invalid base64 in signature.sig fails closed (no exception leak)", async () => {
  const { privateKeyPem, publicKeyPem } = generateWave1ValidationAttestationKeyPair();
  const signer = createKeyBoundSigstoreSigner({
    signerReference: "fuzz-bad-b64-signer",
    privateKeyPem,
    publicKeyPem,
  });
  const manifest = fakeManifest("fuzz-bad-b64-job");
  const statement = buildWave1ValidationAttestationStatement({
    manifest,
    manifestSha256: ZERO,
    signingMode: "sigstore",
  });
  const signed = await buildSignedWave1ValidationAttestation({ statement, signer });

  // Produce strings that are NOT canonical base64 (forbidden chars).
  await fc.assert(
    fc.asyncProperty(
      fc
        .string({ minLength: 1, maxLength: 64 })
        .filter((s) => /[#?@!^&]/.test(s)),
      async (badSig) => {
        const tampered: Wave1ValidationAttestationDsseEnvelope = {
          ...signed.envelope,
          signatures: [{ keyid: "fuzz-bad-b64-signer", sig: badSig }],
        };
        const result = await verifyWave1ValidationAttestation({
          envelope: tampered,
          bundle: { ...signed.bundle, dsseEnvelope: tampered },
          manifest,
          manifestSha256: ZERO,
          artifactsDir: "/tmp",
          expectedSigningMode: "sigstore",
        });
        // Must report invalid signature encoding fail-closed; must not throw.
        return (
          result.ok === false &&
          result.failures.some((f) =>
            ["signature_invalid_encoding", "signature_unverified"].includes(
              f.code,
            ),
          )
        );
      },
    ),
    { numRuns: 30 },
  );
});
