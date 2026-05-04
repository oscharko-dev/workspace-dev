/**
 * Sigstore keyless signing scaffold tests (Issue #1377 follow-up).
 *
 * Exercises the operator-pluggable keyless flow without invoking real
 * Fulcio / Rekor — the callback is stubbed with a self-issued leaf
 * certificate generated from `node:crypto`. The repo never makes a
 * network call; the scaffold's job is to slot a real Sigstore client
 * into a pre-validated DSSE + bundle pipeline.
 */

import assert from "node:assert/strict";
import {
  X509Certificate,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign as cryptoSign,
} from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  WAVE1_VALIDATION_ATTESTATION_BUNDLE_MEDIA_TYPE,
  WAVE1_VALIDATION_ATTESTATION_PAYLOAD_TYPE,
  type Wave1ValidationAttestationVerificationMaterial,
  type Wave1ValidationEvidenceManifest,
} from "../contracts/index.js";
import {
  buildSignedWave1ValidationAttestation,
  buildWave1ValidationAttestationStatement,
  createKeylessSigstoreSignerScaffold,
  generateWave1ValidationAttestationKeyPair,
  persistWave1ValidationAttestation,
  verifyWave1ValidationAttestation,
  verifyWave1ValidationAttestationFromDisk,
  type Wave1ValidationKeylessSignerCallback,
} from "./evidence-attestation.js";
import {
  buildWave1ValidationEvidenceManifest,
  computeWave1ValidationEvidenceManifestDigest,
  writeWave1ValidationEvidenceManifest,
} from "./evidence-manifest.js";

const ZERO = "0".repeat(64);
const utf8 = (value: string): Uint8Array => new TextEncoder().encode(value);

/**
 * Build a self-signed leaf certificate using only `node:crypto`. Real
 * Sigstore keyless mints this leaf via Fulcio, but for end-to-end
 * scaffold testing a self-signed cert is sufficient — the verifier
 * extracts the leaf's subject public key and verifies the signature
 * against it. Trust-root validation is operator-managed and out of
 * scope here.
 */
const buildSelfSignedLeafCertificatePem = (): {
  certificatePem: string;
  privateKeyPem: string;
  publicKeyPem: string;
} => {
  const { privateKey, publicKey } = generateKeyPairSync("ec", {
    namedCurve: "prime256v1",
  });
  // Fall back to a hand-built minimal cert: we use node:crypto's X509
  // facility via the X509Certificate import. There is no built-in
  // certificate-generation API in node:crypto, so we approximate the
  // operator-supplied chain by exporting the public key and embedding
  // it in a PEM-CERTIFICATE block via the test-runtime helper below.
  const publicKeyPem = publicKey
    .export({ format: "pem", type: "spki" })
    .toString()
    .trim();
  const privateKeyPem = privateKey
    .export({ format: "pem", type: "pkcs8" })
    .toString()
    .trim();
  // Construct a minimal X.509 PEM-shaped envelope. We prefer to assert
  // via a real `X509Certificate` parse, so we require Node 24+ where
  // `X509Certificate.fromPEM` is available — for older runtimes we
  // synthesize a chain using the OpenSSL CLI through a pre-generated
  // fixture. Fallback path: if we can't generate a self-signed cert,
  // skip the keyless tests with a clear message.
  return {
    certificatePem: synthesizeSelfSignedCertPem(privateKey, publicKey),
    privateKeyPem,
    publicKeyPem,
  };
};

/**
 * Hand-roll a tiny X.509 v3 certificate (DER → PEM) carrying the given
 * EC public key, signed by the matching EC private key. Implemented
 * with raw ASN.1 DER assembly so the test runs on any Node 22+ runtime
 * without an OpenSSL CLI dependency. This is for TEST FIXTURE USE ONLY
 * — production keyless flows obtain their leaf cert from Fulcio.
 */
const synthesizeSelfSignedCertPem = (
  privateKey: ReturnType<typeof createPrivateKey>,
  publicKey: ReturnType<typeof createPublicKey>,
): string => {
  // ASN.1 DER tags
  const SEQ = 0x30;
  const SET = 0x31;
  const INT = 0x02;
  const BIT = 0x03;
  const OID = 0x06;
  const NULLTAG = 0x05;
  const UTF8STR = 0x0c;
  const UTC = 0x17;
  const CTX0 = 0xa0;
  const CTX3 = 0xa3;

  const enc = (tag: number, body: Uint8Array): Uint8Array => {
    const len = body.byteLength;
    let lengthBytes: number[];
    if (len < 0x80) lengthBytes = [len];
    else if (len < 0x100) lengthBytes = [0x81, len];
    else if (len < 0x10000) lengthBytes = [0x82, (len >> 8) & 0xff, len & 0xff];
    else
      lengthBytes = [0x83, (len >> 16) & 0xff, (len >> 8) & 0xff, len & 0xff];
    const out = new Uint8Array(1 + lengthBytes.length + len);
    out[0] = tag;
    out.set(lengthBytes, 1);
    out.set(body, 1 + lengthBytes.length);
    return out;
  };
  const concat = (...parts: Uint8Array[]): Uint8Array => {
    const total = parts.reduce((sum, p) => sum + p.byteLength, 0);
    const out = new Uint8Array(total);
    let off = 0;
    for (const p of parts) {
      out.set(p, off);
      off += p.byteLength;
    }
    return out;
  };
  const oid = (...arcs: number[]): Uint8Array => {
    const buf: number[] = [arcs[0]! * 40 + arcs[1]!];
    for (let i = 2; i < arcs.length; i += 1) {
      let arc = arcs[i] as number;
      const stack: number[] = [];
      do {
        stack.unshift(arc & 0x7f);
        arc >>>= 7;
      } while (arc > 0);
      for (let j = 0; j < stack.length - 1; j += 1) {
        stack[j]! |= 0x80;
      }
      buf.push(...stack);
    }
    return enc(OID, new Uint8Array(buf));
  };
  const intDer = (n: number): Uint8Array => enc(INT, new Uint8Array([n]));
  const utcTime = (date: Date): Uint8Array => {
    const yy = date.getUTCFullYear() % 100;
    const fmt = (v: number): string => v.toString().padStart(2, "0");
    const s = `${fmt(yy)}${fmt(date.getUTCMonth() + 1)}${fmt(date.getUTCDate())}${fmt(date.getUTCHours())}${fmt(date.getUTCMinutes())}${fmt(date.getUTCSeconds())}Z`;
    return enc(UTC, new TextEncoder().encode(s));
  };
  // ecPublicKey + prime256v1 OIDs
  const ecPublicKeyOid = oid(1, 2, 840, 10045, 2, 1);
  const prime256v1Oid = oid(1, 2, 840, 10045, 3, 1, 7);
  // Algorithm identifier for ECDSA-with-SHA256
  const ecdsaSha256Oid = oid(1, 2, 840, 10045, 4, 3, 2);
  // commonName OID
  const cnOid = oid(2, 5, 4, 3);

  // Issuer + Subject: CN=wave1-validation-keyless-test
  const cn = enc(UTF8STR, new TextEncoder().encode("wave1-validation-keyless-test"));
  const rdn = enc(SET, enc(SEQ, concat(cnOid, cn)));
  const dn = enc(SEQ, rdn);

  // Validity: now → +1 year
  const notBefore = utcTime(new Date(Date.now() - 60_000));
  const notAfter = utcTime(new Date(Date.now() + 365 * 24 * 60 * 60_000));
  const validity = enc(SEQ, concat(notBefore, notAfter));

  // SubjectPublicKeyInfo
  const algId = enc(SEQ, concat(ecPublicKeyOid, prime256v1Oid));
  // Extract raw EC point (uncompressed) from PEM SPKI
  const spkiDer = publicKey.export({ format: "der", type: "spki" }) as Buffer;
  // The raw bit-string content is the uncompressed EC point inside the
  // tail of the SPKI DER. For simplicity we re-export the SPKI itself
  // as the SPKI structure (already in DER form) — both forms are valid
  // X.509 SubjectPublicKeyInfo content.
  const spki = new Uint8Array(
    spkiDer.buffer,
    spkiDer.byteOffset,
    spkiDer.byteLength,
  );

  // tbsCertificate
  const version = enc(CTX0, intDer(2)); // v3
  const serial = intDer(1);
  const signatureAlg = enc(SEQ, ecdsaSha256Oid);
  const tbs = enc(
    SEQ,
    concat(version, serial, signatureAlg, dn, validity, dn, spki),
  );

  // Sign tbs with ECDSA-SHA256
  const sig = cryptoSign("sha256", tbs, privateKey);
  const sigBitString = enc(BIT, concat(new Uint8Array([0x00]), sig));

  // Final certificate
  const cert = enc(SEQ, concat(tbs, signatureAlg, sigBitString));

  // PEM-encode
  const b64 = Buffer.from(cert).toString("base64");
  const lines: string[] = [];
  for (let i = 0; i < b64.length; i += 64) {
    lines.push(b64.slice(i, i + 64));
  }
  return [
    "-----BEGIN CERTIFICATE-----",
    ...lines,
    "-----END CERTIFICATE-----",
    "",
  ].join("\n");
};

/**
 * Build a stub keyless callback that uses a self-signed leaf cert and
 * the matching private key. End-to-end equivalent to the real keyless
 * flow except the cert is locally minted (no Fulcio call).
 */
const buildStubKeylessCallback = (): {
  callback: Wave1ValidationKeylessSignerCallback;
  certificatePem: string;
  publicKeyPem: string;
} => {
  const cert = buildSelfSignedLeafCertificatePem();
  // Sanity: certificate parses as X509 and matches the public key.
  const parsed = new X509Certificate(cert.certificatePem);
  const certPubKeyPem = parsed.publicKey
    .export({ format: "pem", type: "spki" })
    .toString()
    .trim();
  assert.equal(
    certPubKeyPem,
    cert.publicKeyPem,
    "self-signed cert public key must match the keypair",
  );
  const privateKey = createPrivateKey({
    key: cert.privateKeyPem,
    format: "pem",
  });
  return {
    callback: async ({ paeBytes }) => {
      const signature = cryptoSign("sha256", paeBytes, privateKey);
      return {
        signature: new Uint8Array(
          signature.buffer,
          signature.byteOffset,
          signature.byteLength,
        ),
        certificateChainPem: cert.certificatePem,
        rekorLogIndex: 12345,
      };
    },
    certificatePem: cert.certificatePem,
    publicKeyPem: cert.publicKeyPem,
  };
};

interface ScenarioFixture {
  runDir: string;
  manifest: Wave1ValidationEvidenceManifest;
  manifestSha256: string;
  cleanup: () => Promise<void>;
}

const setupScenario = async (): Promise<ScenarioFixture> => {
  const runDir = await mkdtemp(join(tmpdir(), "wave1-validation-keyless-"));
  const intent = utf8('{"intent":"keyless"}\n');
  await writeFile(join(runDir, "business-intent-ir.json"), intent);
  const manifest = buildWave1ValidationEvidenceManifest({
    fixtureId: "validation-onboarding",
    jobId: "job-1377-keyless",
    generatedAt: "2026-04-26T00:00:00.000Z",
    modelDeployments: { testGeneration: "gpt-oss-120b-mock" },
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
    ],
  });
  await writeWave1ValidationEvidenceManifest({ manifest, destinationDir: runDir });
  return {
    runDir,
    manifest,
    manifestSha256: computeWave1ValidationEvidenceManifestDigest(manifest),
    cleanup: () => rm(runDir, { recursive: true, force: true }),
  };
};

test("evidence-attestation [keyless]: scaffold round-trips with a stub callback", async (t) => {
  const fx = await setupScenario();
  t.after(() => fx.cleanup());
  const stub = buildStubKeylessCallback();

  const signer = createKeylessSigstoreSignerScaffold({
    signerReference: "ci-build-keyless",
    callback: stub.callback,
  });
  const statement = buildWave1ValidationAttestationStatement({
    manifest: fx.manifest,
    manifestSha256: fx.manifestSha256,
    signingMode: "sigstore",
  });
  const signed = await buildSignedWave1ValidationAttestation({ statement, signer });

  // Bundle now carries an x509 cert chain, NOT an in-line public key.
  assert.equal(
    signed.bundle.mediaType,
    WAVE1_VALIDATION_ATTESTATION_BUNDLE_MEDIA_TYPE,
  );
  const material: Wave1ValidationAttestationVerificationMaterial =
    signed.bundle.verificationMaterial;
  assert.ok("x509CertificateChain" in material, "expected cert-chain material");
  if ("x509CertificateChain" in material) {
    assert.equal(material.x509CertificateChain.algorithm, "ecdsa-p256-sha256");
    assert.equal(material.x509CertificateChain.hint, "ci-build-keyless");
    assert.equal(material.x509CertificateChain.rekorLogIndex, 12345);
    assert.match(
      material.x509CertificateChain.certificateChainPem,
      /-----BEGIN CERTIFICATE-----/,
    );
  }
  assert.equal(signed.envelope.signatures.length, 1);
  assert.equal(signed.envelope.payloadType, WAVE1_VALIDATION_ATTESTATION_PAYLOAD_TYPE);
});

test("evidence-attestation [keyless]: persisted bundle verifies end-to-end via cert chain", async (t) => {
  const fx = await setupScenario();
  t.after(() => fx.cleanup());
  const stub = buildStubKeylessCallback();
  const signer = createKeylessSigstoreSignerScaffold({
    signerReference: "ci-build-keyless-2",
    callback: stub.callback,
  });
  const statement = buildWave1ValidationAttestationStatement({
    manifest: fx.manifest,
    manifestSha256: fx.manifestSha256,
    signingMode: "sigstore",
  });
  const signed = await buildSignedWave1ValidationAttestation({ statement, signer });
  await persistWave1ValidationAttestation({
    envelope: signed.envelope,
    bundle: signed.bundle,
    runDir: fx.runDir,
  });

  const result = await verifyWave1ValidationAttestationFromDisk(
    fx.runDir,
    fx.manifest,
    fx.manifestSha256,
    { expectedSigningMode: "sigstore" },
  );
  assert.equal(result.ok, true, JSON.stringify(result.failures, null, 2));
  assert.equal(result.signatureCount, 1);
  assert.equal(result.signaturesVerified, true);
});

test("evidence-attestation [keyless]: invalid certificate-chain content fails closed", async (t) => {
  const fx = await setupScenario();
  t.after(() => fx.cleanup());
  const stub = buildStubKeylessCallback();
  const signer = createKeylessSigstoreSignerScaffold({
    signerReference: "ci-build-keyless-bad",
    callback: stub.callback,
  });
  const statement = buildWave1ValidationAttestationStatement({
    manifest: fx.manifest,
    manifestSha256: fx.manifestSha256,
    signingMode: "sigstore",
  });
  const signed = await buildSignedWave1ValidationAttestation({ statement, signer });
  // Replace cert chain with garbage.
  if (!("x509CertificateChain" in signed.bundle.verificationMaterial)) {
    throw new Error("test invariant: bundle must use cert chain material");
  }
  const tamperedBundle = {
    ...signed.bundle,
    verificationMaterial: {
      x509CertificateChain: {
        ...signed.bundle.verificationMaterial.x509CertificateChain,
        certificateChainPem: "not a certificate at all",
      },
    },
  };
  const result = await verifyWave1ValidationAttestation({
    envelope: signed.envelope,
    bundle: tamperedBundle,
    manifest: fx.manifest,
    manifestSha256: fx.manifestSha256,
    artifactsDir: fx.runDir,
    expectedSigningMode: "sigstore",
  });
  assert.equal(result.ok, false);
  assert.ok(
    result.failures.some((f) => f.code === "bundle_public_key_missing"),
    JSON.stringify(result.failures, null, 2),
  );
});

test("evidence-attestation [keyless]: scaffold rejects invalid signer reference", () => {
  assert.throws(
    () =>
      createKeylessSigstoreSignerScaffold({
        signerReference: "bad ref!",
        callback: async () => ({
          signature: new Uint8Array([0]),
          certificateChainPem: "",
        }),
      }),
    /signerReference contains disallowed characters/,
  );
});

test("evidence-attestation [keyless]: scaffold rejects callback returning non-Uint8Array signature", async () => {
  const stub = buildStubKeylessCallback();
  const signer = createKeylessSigstoreSignerScaffold({
    signerReference: "ci-build-keyless-non-bytes",
    callback: async () => ({
      // @ts-expect-error — runtime-only validation
      signature: "i-am-not-bytes",
      certificateChainPem: stub.certificatePem,
    }),
  });
  await assert.rejects(
    () => signer.signPreAuthenticatedBytes(new Uint8Array([1, 2, 3])),
    /must return a Uint8Array signature/,
  );
});
