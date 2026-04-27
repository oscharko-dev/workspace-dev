/**
 * Unit tests for the in-toto v1 attestation builder, DSSE encoding, and
 * unsigned-mode envelope construction (Issue #1377).
 *
 * Covers:
 *   - Statement determinism (canonical JSON, sorted subjects)
 *   - DSSE PAE encoding shape and binding to payloadType
 *   - Unsigned envelope round-trip (encode → decode → equal)
 *   - Predicate hard invariants are TYPE-LEVEL `false`
 *   - Statement schema/version pinning
 */

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  CONTRACT_VERSION,
  TEST_INTELLIGENCE_CONTRACT_VERSION,
  WAVE1_POC_ATTESTATION_PAYLOAD_TYPE,
  WAVE1_POC_ATTESTATION_PREDICATE_TYPE,
  WAVE1_POC_ATTESTATION_SCHEMA_VERSION,
  WAVE1_POC_ATTESTATION_STATEMENT_TYPE,
  WAVE1_POC_EVIDENCE_MANIFEST_ARTIFACT_FILENAME,
  WAVE1_POC_EVIDENCE_MANIFEST_SCHEMA_VERSION,
  type Wave1PocEvidenceManifest,
} from "../contracts/index.js";
import { canonicalJson } from "./content-hash.js";
import {
  buildUnsignedWave1PocAttestationEnvelope,
  buildWave1PocAttestationStatement,
  computeWave1PocAttestationEnvelopeDigest,
  encodeDssePreAuth,
  encodeWave1PocAttestationPayload,
  verifyWave1PocAttestation,
} from "./evidence-attestation.js";

const ZERO = "0".repeat(64);
const ONE = "1".repeat(64);
const TWO = "2".repeat(64);

const fakeManifest = (
  overrides: Partial<Wave1PocEvidenceManifest> = {},
): Wave1PocEvidenceManifest => ({
  schemaVersion: WAVE1_POC_EVIDENCE_MANIFEST_SCHEMA_VERSION,
  contractVersion: CONTRACT_VERSION,
  testIntelligenceContractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
  fixtureId: "poc-onboarding",
  jobId: "job-1377-test",
  generatedAt: "2026-04-26T00:00:00.000Z",
  promptTemplateVersion: "1.0.0",
  generatedTestCaseSchemaVersion: "1.0.0",
  visualSidecarSchemaVersion: "1.0.0",
  redactionPolicyVersion: "1.0.0",
  policyProfileId: "eu-banking-default",
  policyProfileVersion: "1.0.0",
  exportProfileId: "opentext-alm-default",
  exportProfileVersion: "1.0.0",
  modelDeployments: {
    testGeneration: "gpt-oss-120b-mock",
    visualPrimary: "llama-4-maverick-vision",
  },
  promptHash: ZERO,
  schemaHash: ONE,
  inputHash: TWO,
  cacheKeyDigest: ZERO,
  artifacts: [
    {
      filename: "business-intent-ir.json",
      sha256: ZERO,
      bytes: 100,
      category: "intent",
    },
    {
      filename: "compiled-prompt.json",
      sha256: ONE,
      bytes: 200,
      category: "intent",
    },
    {
      filename: "validation-report.json",
      sha256: TWO,
      bytes: 50,
      category: "validation",
    },
  ],
  rawScreenshotsIncluded: false,
  imagePayloadSentToTestGeneration: false,
  ...overrides,
});

const sha256Hex = (bytes: Uint8Array): string =>
  createHash("sha256").update(bytes).digest("hex");

test("evidence-attestation: statement carries pinned URIs and schema version", () => {
  const manifest = fakeManifest();
  const statement = buildWave1PocAttestationStatement({
    manifest,
    manifestSha256: ZERO,
    signingMode: "unsigned",
  });
  assert.equal(statement._type, WAVE1_POC_ATTESTATION_STATEMENT_TYPE);
  assert.equal(statement.predicateType, WAVE1_POC_ATTESTATION_PREDICATE_TYPE);
  assert.equal(
    statement.predicate.schemaVersion,
    WAVE1_POC_ATTESTATION_SCHEMA_VERSION,
  );
  assert.equal(statement.predicate.contractVersion, CONTRACT_VERSION);
  assert.equal(statement.predicate.signingMode, "unsigned");
  assert.equal(statement.predicate.manifestSha256, ZERO);
  assert.equal(
    statement.predicate.manifestFilename,
    WAVE1_POC_EVIDENCE_MANIFEST_ARTIFACT_FILENAME,
  );
});

test("evidence-attestation: hard invariants are type-level false on predicate", () => {
  const manifest = fakeManifest();
  const statement = buildWave1PocAttestationStatement({
    manifest,
    manifestSha256: ZERO,
    signingMode: "unsigned",
  });
  assert.equal(statement.predicate.rawScreenshotsIncluded, false);
  assert.equal(statement.predicate.secretsIncluded, false);
  assert.equal(statement.predicate.imagePayloadSentToTestGeneration, false);
});

test("evidence-attestation: subjects include manifest + every artifact, sorted", () => {
  const manifest = fakeManifest();
  const statement = buildWave1PocAttestationStatement({
    manifest,
    manifestSha256: ZERO,
    signingMode: "unsigned",
  });
  const names = statement.subject.map((s) => s.name);
  // Sorted ascending.
  assert.deepEqual([...names].sort(), names);
  // Every manifest artifact present.
  for (const artifact of manifest.artifacts) {
    const found = statement.subject.find((s) => s.name === artifact.filename);
    assert.ok(found, `missing subject for ${artifact.filename}`);
    assert.equal(found.digest.sha256, artifact.sha256);
  }
  // Manifest itself appears as a subject.
  const manifestSubject = statement.subject.find(
    (s) => s.name === WAVE1_POC_EVIDENCE_MANIFEST_ARTIFACT_FILENAME,
  );
  assert.ok(manifestSubject, "manifest must be a subject");
  assert.equal(manifestSubject.digest.sha256, ZERO);
});

test("evidence-attestation: statement is byte-stable across runs (deterministic)", () => {
  const manifest = fakeManifest();
  const a = buildWave1PocAttestationStatement({
    manifest,
    manifestSha256: ZERO,
    signingMode: "unsigned",
  });
  const b = buildWave1PocAttestationStatement({
    manifest,
    manifestSha256: ZERO,
    signingMode: "unsigned",
  });
  assert.equal(canonicalJson(a), canonicalJson(b));
});

test("evidence-attestation: rejects manifest with rawScreenshotsIncluded=true", () => {
  const manifest = fakeManifest();
  // Forcibly mutate to test the runtime guard.
  (
    manifest as unknown as { rawScreenshotsIncluded: boolean }
  ).rawScreenshotsIncluded = true;
  assert.throws(
    () =>
      buildWave1PocAttestationStatement({
        manifest,
        manifestSha256: ZERO,
        signingMode: "unsigned",
      }),
    /rawScreenshotsIncluded must be false/,
  );
});

test("evidence-attestation: rejects manifest with imagePayloadSentToTestGeneration=true", () => {
  const manifest = fakeManifest();
  (
    manifest as unknown as { imagePayloadSentToTestGeneration: boolean }
  ).imagePayloadSentToTestGeneration = true;
  assert.throws(
    () =>
      buildWave1PocAttestationStatement({
        manifest,
        manifestSha256: ZERO,
        signingMode: "unsigned",
      }),
    /imagePayloadSentToTestGeneration must be false/,
  );
});

test("evidence-attestation: rejects non-sha256 manifest digest", () => {
  const manifest = fakeManifest();
  assert.throws(
    () =>
      buildWave1PocAttestationStatement({
        manifest,
        manifestSha256: "not-a-hex-digest",
        signingMode: "unsigned",
      }),
    /manifestSha256 must be a sha256 hex string/,
  );
});

test("evidence-attestation: rejects unknown signing mode", () => {
  const manifest = fakeManifest();
  assert.throws(
    () =>
      buildWave1PocAttestationStatement({
        manifest,
        manifestSha256: ZERO,
        // @ts-expect-error — runtime-only validation
        signingMode: "totally-fake",
      }),
    /unknown signingMode/,
  );
});

test("evidence-attestation: predicate carries visual sidecar identity when present", () => {
  const manifest = fakeManifest({
    modelDeployments: {
      testGeneration: "gpt-oss-120b-mock",
      visualPrimary: "llama-4-maverick-vision",
      visualFallback: "llama-4-scout-vision",
    },
    visualSidecar: {
      selectedDeployment: "llama-4-maverick-vision",
      fallbackReason: "none",
      confidenceSummary: { min: 0.9, max: 1.0, mean: 0.95 },
      resultArtifactSha256: ZERO,
    },
  });
  const statement = buildWave1PocAttestationStatement({
    manifest,
    manifestSha256: ZERO,
    signingMode: "unsigned",
  });
  assert.equal(
    statement.predicate.visualSidecar?.selectedDeployment,
    "llama-4-maverick-vision",
  );
  assert.equal(statement.predicate.visualSidecar?.fallbackReason, "none");
  assert.equal(statement.predicate.visualSidecar?.resultArtifactSha256, ZERO);
  assert.equal(statement.predicate.visualSidecar?.visualFallback, "llama-4-scout-vision");

  const fallbackOnly = buildWave1PocAttestationStatement({
    manifest: fakeManifest({
      modelDeployments: {
        testGeneration: "gpt-oss-120b-mock",
      },
      visualSidecar: {
        selectedDeployment: "llama-4-scout-vision",
        fallbackReason: "primary_unavailable",
        confidenceSummary: { min: 0.7, max: 0.8, mean: 0.75 },
        resultArtifactSha256: ONE,
      },
    }),
    manifestSha256: ZERO,
    signingMode: "unsigned",
  });
  assert.equal(fallbackOnly.predicate.visualSidecar?.visualPrimary, undefined);
});

test("evidence-attestation: predicate omits visual sidecar when absent on manifest", () => {
  const manifest = fakeManifest();
  const statement = buildWave1PocAttestationStatement({
    manifest,
    manifestSha256: ZERO,
    signingMode: "unsigned",
  });
  assert.equal(statement.predicate.visualSidecar, undefined);
});

test("evidence-attestation: encode payload returns canonical-JSON UTF-8 bytes", () => {
  const manifest = fakeManifest();
  const statement = buildWave1PocAttestationStatement({
    manifest,
    manifestSha256: ZERO,
    signingMode: "unsigned",
  });
  const bytes = encodeWave1PocAttestationPayload(statement);
  const decoded = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  assert.equal(decoded, canonicalJson(statement));
  assert.deepEqual(JSON.parse(decoded), JSON.parse(canonicalJson(statement)));
});

test("evidence-attestation: PAE prefix follows DSSEv1 format", () => {
  const payload = new Uint8Array([1, 2, 3, 4, 5]);
  const pae = encodeDssePreAuth(WAVE1_POC_ATTESTATION_PAYLOAD_TYPE, payload);
  const text = new TextDecoder().decode(pae);
  // PAE = "DSSEv1 LEN(type) type LEN(body) body"
  const expectedPrefix = `DSSEv1 ${WAVE1_POC_ATTESTATION_PAYLOAD_TYPE.length} ${WAVE1_POC_ATTESTATION_PAYLOAD_TYPE} ${payload.byteLength} `;
  assert.ok(
    text.startsWith(expectedPrefix),
    `PAE prefix mismatch — got "${text.slice(0, expectedPrefix.length)}"`,
  );
  assert.equal(pae.byteLength, expectedPrefix.length + payload.byteLength);
});

test("evidence-attestation: PAE binds payloadType (different types → different bytes)", () => {
  const payload = new Uint8Array([1, 2, 3]);
  const a = encodeDssePreAuth("application/vnd.in-toto+json", payload);
  const b = encodeDssePreAuth("application/x-evil", payload);
  assert.notEqual(sha256Hex(a), sha256Hex(b));
});

test("evidence-attestation: unsigned envelope has empty signatures and base64 payload", () => {
  const manifest = fakeManifest();
  const statement = buildWave1PocAttestationStatement({
    manifest,
    manifestSha256: ZERO,
    signingMode: "unsigned",
  });
  const envelope = buildUnsignedWave1PocAttestationEnvelope(statement);
  assert.deepEqual(envelope.signatures, []);
  assert.equal(envelope.payloadType, WAVE1_POC_ATTESTATION_PAYLOAD_TYPE);
  // Decode base64 and check we get back the canonical JSON.
  const decoded = Buffer.from(envelope.payload, "base64").toString("utf8");
  assert.equal(decoded, canonicalJson(statement));
});

test("evidence-attestation: envelope digest is byte-stable across runs", () => {
  const manifest = fakeManifest();
  const statement = buildWave1PocAttestationStatement({
    manifest,
    manifestSha256: ZERO,
    signingMode: "unsigned",
  });
  const envelope = buildUnsignedWave1PocAttestationEnvelope(statement);
  const digestA = computeWave1PocAttestationEnvelopeDigest(envelope);
  const digestB = computeWave1PocAttestationEnvelopeDigest(envelope);
  assert.equal(digestA, digestB);
  assert.match(digestA, /^[0-9a-f]{64}$/);
});

test("evidence-attestation: rejects malformed manifest identity fields", () => {
  for (const field of ["promptHash", "schemaHash", "inputHash", "cacheKeyDigest"] as const) {
    const manifest = fakeManifest({ [field]: "not-a-sha256" });
    assert.throws(
      () =>
        buildWave1PocAttestationStatement({
          manifest,
          manifestSha256: ZERO,
          signingMode: "unsigned",
        }),
      new RegExp(`manifest.${field} must be a sha256 hex string`),
    );
  }

  assert.throws(
    () =>
      buildWave1PocAttestationStatement({
        manifest: fakeManifest({
          artifacts: [
            {
              filename: "../leaked-token.txt",
              sha256: ZERO,
              bytes: 1,
              category: "diagnostic",
            },
          ],
        }),
        manifestSha256: ZERO,
        signingMode: "unsigned",
      }),
    /invalid artifact filename/,
  );
  assert.throws(
    () =>
      buildWave1PocAttestationStatement({
        manifest: fakeManifest({
          artifacts: [
            {
              filename: "safe-artifact.json",
              sha256: "not-a-sha256",
              bytes: 1,
              category: "diagnostic",
            },
          ],
        }),
        manifestSha256: ZERO,
        signingMode: "unsigned",
      }),
    /has an invalid sha256/,
  );
});

test("evidence-attestation: verifier fails closed for malformed envelopes", async () => {
  const manifest = fakeManifest();
  const statement = buildWave1PocAttestationStatement({
    manifest,
    manifestSha256: ZERO,
    signingMode: "unsigned",
  });
  const payload = (value: unknown): string =>
    Buffer.from(canonicalJson(value), "utf8").toString("base64");
  const verify = (envelope: unknown) =>
    verifyWave1PocAttestation({
      envelope: envelope as never,
      manifest,
      manifestSha256: ZERO,
      artifactsDir: ".",
      expectedSigningMode: "unsigned",
      requireFullSubjectCoverage: false,
    });

  const cases: Array<{ envelope: unknown; code: string }> = [
    { envelope: null, code: "envelope_unparseable" },
    {
      envelope: { payloadType: "application/x-wrong", payload: "", signatures: [] },
      code: "envelope_payload_type_mismatch",
    },
    {
      envelope: {
        payloadType: WAVE1_POC_ATTESTATION_PAYLOAD_TYPE,
        payload: 123,
        signatures: [],
      },
      code: "envelope_payload_decode_failed",
    },
    {
      envelope: {
        payloadType: WAVE1_POC_ATTESTATION_PAYLOAD_TYPE,
        payload: "not canonical base64",
        signatures: [],
      },
      code: "envelope_payload_decode_failed",
    },
    {
      envelope: {
        payloadType: WAVE1_POC_ATTESTATION_PAYLOAD_TYPE,
        payload: Buffer.from("{", "utf8").toString("base64"),
        signatures: [],
      },
      code: "statement_unparseable",
    },
    {
      envelope: {
        payloadType: WAVE1_POC_ATTESTATION_PAYLOAD_TYPE,
        payload: payload(null),
        signatures: [],
      },
      code: "statement_unparseable",
    },
    {
      envelope: {
        payloadType: WAVE1_POC_ATTESTATION_PAYLOAD_TYPE,
        payload: payload({ ...statement, _type: "https://example.test/wrong" }),
        signatures: [],
      },
      code: "statement_type_mismatch",
    },
    {
      envelope: {
        payloadType: WAVE1_POC_ATTESTATION_PAYLOAD_TYPE,
        payload: payload({ ...statement, subject: "not-array" }),
        signatures: [],
      },
      code: "statement_predicate_invalid",
    },
    {
      envelope: {
        payloadType: WAVE1_POC_ATTESTATION_PAYLOAD_TYPE,
        payload: payload({
          ...statement,
          subject: "not-array",
          predicate: { ...statement.predicate, secretsIncluded: true },
        }),
        signatures: [],
      },
      code: "statement_predicate_invalid",
    },
    {
      envelope: {
        payloadType: WAVE1_POC_ATTESTATION_PAYLOAD_TYPE,
        payload: payload({
          ...statement,
          subject: "not-array",
          predicate: { ...statement.predicate, imagePayloadSentToTestGeneration: true },
        }),
        signatures: [],
      },
      code: "statement_predicate_invalid",
    },
    {
      envelope: {
        payloadType: WAVE1_POC_ATTESTATION_PAYLOAD_TYPE,
        payload: payload({ ...statement, subject: "not-array", predicate: null }),
        signatures: [],
      },
      code: "statement_predicate_invalid",
    },
    {
      envelope: {
        payloadType: WAVE1_POC_ATTESTATION_PAYLOAD_TYPE,
        payload: payload({
          ...statement,
          subject: "not-array",
          predicate: { ...statement.predicate, rawScreenshotsIncluded: true },
        }),
        signatures: [],
      },
      code: "statement_predicate_invalid",
    },
    {
      envelope: {
        payloadType: WAVE1_POC_ATTESTATION_PAYLOAD_TYPE,
        payload: payload({
          ...statement,
          subject: "not-array",
          predicate: { ...statement.predicate, manifestSha256: "not-a-sha256" },
        }),
        signatures: [],
      },
      code: "statement_predicate_invalid",
    },
    {
      envelope: {
        payloadType: WAVE1_POC_ATTESTATION_PAYLOAD_TYPE,
        payload: payload({
          ...statement,
          subject: "not-array",
          predicate: { ...statement.predicate, manifestSha256: ONE },
        }),
        signatures: [],
      },
      code: "manifest_sha256_mismatch",
    },
    {
      envelope: {
        payloadType: WAVE1_POC_ATTESTATION_PAYLOAD_TYPE,
        payload: payload({
          ...statement,
          subject: "not-array",
          predicate: { ...statement.predicate, jobId: "wrong-job" },
        }),
        signatures: [],
      },
      code: "statement_predicate_invalid",
    },
    {
      envelope: {
        payloadType: WAVE1_POC_ATTESTATION_PAYLOAD_TYPE,
        payload: payload({
          ...statement,
          subject: "not-array",
          predicate: { ...statement.predicate, fixtureId: "wrong-fixture" },
        }),
        signatures: [],
      },
      code: "statement_predicate_invalid",
    },
    {
      envelope: {
        payloadType: WAVE1_POC_ATTESTATION_PAYLOAD_TYPE,
        payload: payload({
          ...statement,
          subject: "not-array",
          predicate: { ...statement.predicate, contractVersion: "0.0.0" },
        }),
        signatures: [],
      },
      code: "statement_predicate_invalid",
    },
    {
      envelope: {
        payloadType: WAVE1_POC_ATTESTATION_PAYLOAD_TYPE,
        payload: payload({
          ...statement,
          subject: "not-array",
          predicate: {
            ...statement.predicate,
            testIntelligenceContractVersion: "0.0.0",
          },
        }),
        signatures: [],
      },
      code: "statement_predicate_invalid",
    },
    {
      envelope: {
        payloadType: WAVE1_POC_ATTESTATION_PAYLOAD_TYPE,
        payload: payload({
          ...statement,
          subject: "not-array",
          predicate: { ...statement.predicate, signingMode: "sigstore" },
        }),
        signatures: [],
      },
      code: "statement_predicate_invalid",
    },
    {
      envelope: {
        payloadType: WAVE1_POC_ATTESTATION_PAYLOAD_TYPE,
        payload: payload({
          ...statement,
          subject: [
            null,
            { name: "", digest: { sha256: ZERO } },
            { name: "/absolute.json", digest: { sha256: ZERO } },
            { name: "dir//artifact.json", digest: { sha256: ZERO } },
            { name: "../secret.txt", digest: { sha256: ZERO } },
            { name: "safe-artifact.json", digest: { sha256: "not-a-sha256" } },
          ],
        }),
        signatures: [],
      },
      code: "statement_predicate_invalid",
    },
  ];

  for (const entry of cases) {
    const result = await verify(entry.envelope);
    assert.equal(result.ok, false);
    assert.equal(
      result.failures.some((failure) => failure.code === entry.code),
      true,
      entry.code,
    );
  }

  const unsignedWithSignature = await verify({
    payloadType: WAVE1_POC_ATTESTATION_PAYLOAD_TYPE,
    payload: payload({ ...statement, subject: "not-array" }),
    signatures: [{ keyid: "offline-key", sig: "AAAA" }],
  });
  assert.equal(
    unsignedWithSignature.failures.some(
      (failure) => failure.code === "signature_unsigned_envelope_carries_signatures",
    ),
    true,
  );

  const sigstoreMissingBundle = await verifyWave1PocAttestation({
    envelope: {
      payloadType: WAVE1_POC_ATTESTATION_PAYLOAD_TYPE,
      payload: payload({ ...statement, subject: "not-array" }),
      signatures: [],
    },
    manifest,
    manifestSha256: ZERO,
    artifactsDir: ".",
    expectedSigningMode: "sigstore",
  });
  assert.equal(
    sigstoreMissingBundle.failures.some(
      (failure) => failure.code === "signature_required",
    ),
    true,
  );
  assert.equal(
    sigstoreMissingBundle.failures.some(
      (failure) => failure.code === "bundle_missing",
    ),
    true,
  );

  const subjectDigestMismatch = await verifyWave1PocAttestation({
    envelope: {
      payloadType: WAVE1_POC_ATTESTATION_PAYLOAD_TYPE,
      payload: payload({
        ...statement,
        subject: [
          {
            name: WAVE1_POC_EVIDENCE_MANIFEST_ARTIFACT_FILENAME,
            digest: { sha256: ONE },
          },
        ],
      }),
      signatures: [],
    },
    manifest,
    manifestSha256: ZERO,
    artifactsDir: ".",
    expectedSigningMode: "unsigned",
  });
  assert.equal(
    subjectDigestMismatch.failures.some(
      (failure) => failure.code === "subject_digest_mismatch",
    ),
    true,
  );
  assert.equal(
    subjectDigestMismatch.failures.some(
      (failure) => failure.code === "subject_unattested_artifact",
    ),
    true,
  );

  const artifactDigestMismatch = await verifyWave1PocAttestation({
    envelope: {
      payloadType: WAVE1_POC_ATTESTATION_PAYLOAD_TYPE,
      payload: payload({
        ...statement,
        subject: [
          {
            name: WAVE1_POC_EVIDENCE_MANIFEST_ARTIFACT_FILENAME,
            digest: { sha256: ZERO },
          },
          {
            name: manifest.artifacts[0]!.filename,
            digest: { sha256: ONE },
          },
        ],
      }),
      signatures: [],
    },
    manifest,
    manifestSha256: ZERO,
    artifactsDir: ".",
    expectedSigningMode: "unsigned",
  });
  assert.equal(
    artifactDigestMismatch.failures.some(
      (failure) => failure.code === "subject_digest_mismatch",
    ),
    true,
  );

  const invalidManifestArtifact = await verifyWave1PocAttestation({
    envelope: {
      payloadType: WAVE1_POC_ATTESTATION_PAYLOAD_TYPE,
      payload: payload({
        ...statement,
        subject: [
          {
            name: WAVE1_POC_EVIDENCE_MANIFEST_ARTIFACT_FILENAME,
            digest: { sha256: ZERO },
          },
        ],
      }),
      signatures: [],
    },
    manifest: fakeManifest({
      artifacts: [
        {
          filename: "",
          sha256: ZERO,
          bytes: 1,
          category: "intent",
        },
        {
          filename: "/absolute-artifact.json",
          sha256: ZERO,
          bytes: 1,
          category: "intent",
        },
        {
          filename: "dir//unsafe-artifact.json",
          sha256: ZERO,
          bytes: 1,
          category: "intent",
        },
        {
          filename: "../unsafe-artifact.json",
          sha256: ZERO,
          bytes: 1,
          category: "intent",
        },
      ],
    }),
    manifestSha256: ZERO,
    artifactsDir: ".",
    expectedSigningMode: "unsigned",
  });
  assert.equal(
    invalidManifestArtifact.failures.some(
      (failure) => failure.code === "statement_predicate_invalid",
    ),
    true,
  );

  const missingArtifactOnDisk = await verifyWave1PocAttestation({
    envelope: {
      payloadType: WAVE1_POC_ATTESTATION_PAYLOAD_TYPE,
      payload: payload({
        ...statement,
        subject: [
          {
            name: WAVE1_POC_EVIDENCE_MANIFEST_ARTIFACT_FILENAME,
            digest: { sha256: ZERO },
          },
          {
            name: manifest.artifacts[0]!.filename,
            digest: { sha256: manifest.artifacts[0]!.sha256 },
          },
        ],
      }),
      signatures: [],
    },
    manifest,
    manifestSha256: ZERO,
    artifactsDir: ".",
    expectedSigningMode: "unsigned",
    requireFullSubjectCoverage: false,
  });
  assert.equal(
    missingArtifactOnDisk.failures.some(
      (failure) => failure.code === "subject_missing_artifact",
    ),
    true,
  );
});
