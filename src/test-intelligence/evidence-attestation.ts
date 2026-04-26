/**
 * Wave 1 POC in-toto attestation + optional Sigstore signing (Issue #1377).
 *
 * The attestation is an in-toto v1 statement wrapped in a DSSE envelope.
 * The statement enumerates every artifact the harness produced (subject
 * digests) and carries a predicate that pins the pipeline identity:
 * contract version, prompt template version, schema version, model
 * deployments, policy and export profile identifiers, replay-cache
 * digests, and the visual-sidecar identity when present.
 *
 * Two signing modes are supported:
 *
 *   - `unsigned` (default) — DSSE `signatures: []`. Always works
 *     air-gapped; no `node:crypto` private-key operations are invoked.
 *   - `sigstore` — operator-supplied signer produces one or more
 *     signatures over the PAE-encoded `(payloadType, payload)` tuple.
 *     The shipped key-bound signer uses ECDSA P-256 from `node:crypto`
 *     so signing and local verification both work without network.
 *
 * Hard invariants enforced at build time AND at verify time:
 *
 *   - `rawScreenshotsIncluded: false`
 *   - `secretsIncluded: false`
 *   - `imagePayloadSentToTestGeneration: false`
 *
 * No bearer tokens, API keys, OIDC tokens, prompt text, or response
 * bytes flow into the attestation payload — only identity hashes, model
 * deployment names, and version stamps.
 */

import {
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  randomUUID,
  sign as cryptoSign,
  verify as cryptoVerify,
  type KeyObject,
} from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import {
  CONTRACT_VERSION,
  GENERATED_TEST_CASE_SCHEMA_VERSION,
  REDACTION_POLICY_VERSION,
  TEST_INTELLIGENCE_CONTRACT_VERSION,
  TEST_INTELLIGENCE_PROMPT_TEMPLATE_VERSION,
  VISUAL_SIDECAR_SCHEMA_VERSION,
  WAVE1_POC_ATTESTATION_ARTIFACT_FILENAME,
  WAVE1_POC_ATTESTATION_BUNDLE_FILENAME,
  WAVE1_POC_ATTESTATION_BUNDLE_MEDIA_TYPE,
  WAVE1_POC_ATTESTATION_PAYLOAD_TYPE,
  WAVE1_POC_ATTESTATION_PREDICATE_TYPE,
  WAVE1_POC_ATTESTATION_SCHEMA_VERSION,
  WAVE1_POC_ATTESTATION_STATEMENT_TYPE,
  WAVE1_POC_ATTESTATIONS_DIRECTORY,
  WAVE1_POC_EVIDENCE_MANIFEST_ARTIFACT_FILENAME,
  WAVE1_POC_SIGNATURES_DIRECTORY,
  type Wave1PocAttestationBundle,
  type Wave1PocAttestationCertificateChainMaterial,
  type Wave1PocAttestationDsseEnvelope,
  type Wave1PocAttestationPredicate,
  type Wave1PocAttestationPublicKeyMaterial,
  type Wave1PocAttestationSignature,
  type Wave1PocAttestationSigningMode,
  type Wave1PocAttestationStatement,
  type Wave1PocAttestationSubject,
  type Wave1PocAttestationSummary,
  type Wave1PocAttestationVerificationFailure,
  type Wave1PocAttestationVerificationMaterial,
  type Wave1PocAttestationVerificationResult,
  type Wave1PocEvidenceManifest,
} from "../contracts/index.js";
import { canonicalJson } from "./content-hash.js";
import {
  formatWave1PocEvidenceArtifactPathForDiagnostic,
  resolveWave1PocEvidenceArtifactPath,
  validateWave1PocEvidenceArtifactPath,
} from "./evidence-manifest.js";

const HEX64 = /^[0-9a-f]{64}$/;
const KEYID_PATTERN = /^[A-Za-z0-9._:\-/]{1,128}$/;
const BASE64_STD_PATTERN = /^[A-Za-z0-9+/]+={0,2}$/;
const ECDSA_PEM_BLOCK_PATTERN =
  /^-----BEGIN (?:EC )?PRIVATE KEY-----[\s\S]+?-----END (?:EC )?PRIVATE KEY-----\s*$/;
const PUBLIC_KEY_PEM_BLOCK_PATTERN =
  /^-----BEGIN PUBLIC KEY-----[\s\S]+?-----END PUBLIC KEY-----\s*$/;

const sha256OfBytes = (bytes: Uint8Array): string => {
  return createHash("sha256").update(bytes).digest("hex");
};

const utf8 = (value: string): Uint8Array => new TextEncoder().encode(value);

const bytesToBase64 = (bytes: Uint8Array): string => {
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString(
    "base64",
  );
};

const base64ToBytes = (value: string): Uint8Array => {
  const trimmed = value.trim();
  if (!BASE64_STD_PATTERN.test(trimmed)) {
    throw new RangeError("invalid base64 input");
  }
  const buf = Buffer.from(trimmed, "base64");
  if (
    buf.toString("base64").replace(/=+$/, "") !== trimmed.replace(/=+$/, "")
  ) {
    throw new RangeError("invalid base64 input");
  }
  return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * DSSE Pre-Authentication Encoding (PAE).
 *
 *   PAE(type, body) = "DSSEv1" SP LEN(type) SP type SP LEN(body) SP body
 *
 * `LEN` is the ASCII-decimal length in bytes. The encoding binds the
 * payloadType into the signature so a verifier cannot be tricked into
 * applying a signature meant for a different payload type.
 */
export const encodeDssePreAuth = (
  payloadType: string,
  payloadBytes: Uint8Array,
): Uint8Array => {
  const typeBytes = utf8(payloadType);
  const prefix = utf8(
    `DSSEv1 ${typeBytes.byteLength} ${payloadType} ${payloadBytes.byteLength} `,
  );
  const out = new Uint8Array(prefix.byteLength + payloadBytes.byteLength);
  out.set(prefix, 0);
  out.set(payloadBytes, prefix.byteLength);
  return out;
};

/** Subject record as derived from a manifest artifact. */
export interface BuildAttestationSubjectInput {
  /** Relative artifact path inside the run directory. */
  filename: string;
  /** SHA-256 hex of the artifact bytes. */
  sha256: string;
}

const isPositiveLengthString = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0;

const validateManifestForAttestation = (
  manifest: Wave1PocEvidenceManifest,
): void => {
  const rawScreenshotsIncluded = manifest.rawScreenshotsIncluded as boolean;
  const imagePayloadSentToTestGeneration =
    manifest.imagePayloadSentToTestGeneration as boolean;
  if (rawScreenshotsIncluded) {
    throw new RangeError(
      "buildWave1PocAttestationStatement: manifest.rawScreenshotsIncluded must be false",
    );
  }
  if (imagePayloadSentToTestGeneration) {
    throw new RangeError(
      "buildWave1PocAttestationStatement: manifest.imagePayloadSentToTestGeneration must be false",
    );
  }
  for (const field of [
    "promptHash",
    "schemaHash",
    "inputHash",
    "cacheKeyDigest",
  ] as const) {
    if (!HEX64.test(manifest[field])) {
      throw new RangeError(
        `buildWave1PocAttestationStatement: manifest.${field} must be a sha256 hex string`,
      );
    }
  }
  for (const artifact of manifest.artifacts) {
    if (!validateWave1PocEvidenceArtifactPath(artifact.filename).ok) {
      throw new RangeError(
        `buildWave1PocAttestationStatement: invalid artifact filename ${formatWave1PocEvidenceArtifactPathForDiagnostic(artifact.filename)}`,
      );
    }
    if (!HEX64.test(artifact.sha256)) {
      throw new RangeError(
        `buildWave1PocAttestationStatement: artifact ${formatWave1PocEvidenceArtifactPathForDiagnostic(artifact.filename)} has an invalid sha256`,
      );
    }
  }
};

export interface BuildWave1PocAttestationStatementInput {
  manifest: Wave1PocEvidenceManifest;
  /** SHA-256 of the canonical manifest bytes. */
  manifestSha256: string;
  signingMode: Wave1PocAttestationSigningMode;
}

/**
 * Build a deterministic in-toto v1 statement from an evidence manifest.
 * The statement's subjects mirror the manifest's artifact list (sorted
 * by filename) and append the manifest itself; the predicate carries
 * the pipeline-identity fields plus the manifest's SHA-256 and the
 * active signing mode.
 *
 * The returned object is canonical-JSON-stable: every key is sorted on
 * serialization and only deterministic fields are included.
 */
export const buildWave1PocAttestationStatement = (
  input: BuildWave1PocAttestationStatementInput,
): Wave1PocAttestationStatement => {
  validateManifestForAttestation(input.manifest);
  if (!HEX64.test(input.manifestSha256)) {
    throw new RangeError(
      "buildWave1PocAttestationStatement: manifestSha256 must be a sha256 hex string",
    );
  }
  const signingMode = input.signingMode as string;
  if (signingMode !== "unsigned" && signingMode !== "sigstore") {
    throw new RangeError(
      `buildWave1PocAttestationStatement: unknown signingMode "${input.signingMode}"`,
    );
  }

  const subjectMap = new Map<string, Wave1PocAttestationSubject>();
  for (const artifact of input.manifest.artifacts) {
    subjectMap.set(artifact.filename, {
      name: artifact.filename,
      digest: { sha256: artifact.sha256 },
    });
  }
  subjectMap.set(WAVE1_POC_EVIDENCE_MANIFEST_ARTIFACT_FILENAME, {
    name: WAVE1_POC_EVIDENCE_MANIFEST_ARTIFACT_FILENAME,
    digest: { sha256: input.manifestSha256 },
  });
  const subject = Array.from(subjectMap.values()).sort((a, b) =>
    a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
  );

  const visualSidecar = input.manifest.visualSidecar
    ? {
        selectedDeployment: input.manifest.visualSidecar.selectedDeployment,
        fallbackReason: input.manifest.visualSidecar.fallbackReason,
        ...(input.manifest.modelDeployments.visualPrimary !== undefined
          ? { visualPrimary: input.manifest.modelDeployments.visualPrimary }
          : {}),
        ...(input.manifest.modelDeployments.visualFallback !== undefined
          ? { visualFallback: input.manifest.modelDeployments.visualFallback }
          : {}),
        resultArtifactSha256: input.manifest.visualSidecar.resultArtifactSha256,
      }
    : undefined;

  const modelDeployments: Wave1PocAttestationPredicate["modelDeployments"] = {
    testGeneration: input.manifest.modelDeployments.testGeneration,
    ...(input.manifest.modelDeployments.visualPrimary !== undefined
      ? { visualPrimary: input.manifest.modelDeployments.visualPrimary }
      : {}),
    ...(input.manifest.modelDeployments.visualFallback !== undefined
      ? { visualFallback: input.manifest.modelDeployments.visualFallback }
      : {}),
  };

  const predicate: Wave1PocAttestationPredicate = {
    schemaVersion: WAVE1_POC_ATTESTATION_SCHEMA_VERSION,
    contractVersion: CONTRACT_VERSION,
    testIntelligenceContractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
    fixtureId: input.manifest.fixtureId,
    jobId: input.manifest.jobId,
    generatedAt: input.manifest.generatedAt,
    promptTemplateVersion: TEST_INTELLIGENCE_PROMPT_TEMPLATE_VERSION,
    generatedTestCaseSchemaVersion: GENERATED_TEST_CASE_SCHEMA_VERSION,
    visualSidecarSchemaVersion: VISUAL_SIDECAR_SCHEMA_VERSION,
    redactionPolicyVersion: REDACTION_POLICY_VERSION,
    policyProfileId: input.manifest.policyProfileId,
    policyProfileVersion: input.manifest.policyProfileVersion,
    exportProfileId: input.manifest.exportProfileId,
    exportProfileVersion: input.manifest.exportProfileVersion,
    promptHash: input.manifest.promptHash,
    schemaHash: input.manifest.schemaHash,
    inputHash: input.manifest.inputHash,
    cacheKeyDigest: input.manifest.cacheKeyDigest,
    modelDeployments,
    ...(visualSidecar !== undefined ? { visualSidecar } : {}),
    signingMode: input.signingMode,
    manifestSha256: input.manifestSha256,
    manifestFilename: WAVE1_POC_EVIDENCE_MANIFEST_ARTIFACT_FILENAME,
    rawScreenshotsIncluded: false,
    secretsIncluded: false,
    imagePayloadSentToTestGeneration: false,
  };

  return {
    _type: WAVE1_POC_ATTESTATION_STATEMENT_TYPE,
    predicateType: WAVE1_POC_ATTESTATION_PREDICATE_TYPE,
    subject,
    predicate,
  };
};

/** Canonical-JSON encode a statement and base64-wrap it as DSSE payload. */
export const encodeWave1PocAttestationPayload = (
  statement: Wave1PocAttestationStatement,
): Uint8Array => utf8(canonicalJson(statement));

/** Build an unsigned DSSE envelope for `statement`. */
export const buildUnsignedWave1PocAttestationEnvelope = (
  statement: Wave1PocAttestationStatement,
): Wave1PocAttestationDsseEnvelope => {
  const payload = encodeWave1PocAttestationPayload(statement);
  return {
    payload: bytesToBase64(payload),
    payloadType: WAVE1_POC_ATTESTATION_PAYLOAD_TYPE,
    signatures: [],
  };
};

/**
 * Operator-pluggable signer interface. The signer receives the
 * pre-authentication-encoded bytes (already DSSEv1-prefixed) and must
 * return one or more signatures plus the verification material that
 * accompanies them in the Sigstore bundle.
 *
 * The signer MUST NOT have side effects beyond producing signatures —
 * it must not log secrets, persist the private key, or call out to
 * untrusted services. Built-in signers in this module honour that
 * contract; custom signers do so at the operator's risk.
 */
export interface Wave1PocAttestationSigner {
  /** Stable signer identity, used for `keyid` and audit-timeline output. */
  readonly signerReference: string;
  /**
   * Verification material exposed to verifiers. Discriminated:
   *   - `{ publicKey }` — key-bound signing (the air-gapped default).
   *   - `{ x509CertificateChain }` — Sigstore keyless flow (the leaf
   *     certificate's subject public key is used to verify the
   *     signature; operator pins their trust root separately).
   */
  readonly verificationMaterial: Wave1PocAttestationVerificationMaterial;
  /** Sign the PAE-encoded payload. */
  signPreAuthenticatedBytes(
    paeBytes: Uint8Array,
  ): Promise<Wave1PocAttestationSignature>;
}

const stripPemHeaders = (pem: string): string =>
  pem.replace(/-----[A-Z ]+-----/g, "").replace(/\s+/g, "");

const subjectPublicKeyInfoFromPem = (publicKeyPem: string): KeyObject => {
  const key = createPublicKey({ key: publicKeyPem, format: "pem" });
  if (key.asymmetricKeyType !== "ec") {
    throw new RangeError(
      "Wave 1 POC attestation public key must be an ECDSA key (P-256)",
    );
  }
  const details = key.asymmetricKeyDetails;
  if (
    details === undefined ||
    details.namedCurve === undefined ||
    details.namedCurve !== "prime256v1"
  ) {
    throw new RangeError(
      "Wave 1 POC attestation public key must use the prime256v1 (P-256) curve",
    );
  }
  return key;
};

const ecdsaPrivateKeyFromPem = (privateKeyPem: string): KeyObject => {
  if (!ECDSA_PEM_BLOCK_PATTERN.test(privateKeyPem)) {
    throw new RangeError(
      "Wave 1 POC attestation private key must be PEM-encoded ECDSA",
    );
  }
  const key = createPrivateKey({ key: privateKeyPem, format: "pem" });
  if (key.asymmetricKeyType !== "ec") {
    throw new RangeError(
      "Wave 1 POC attestation private key must be an ECDSA key (P-256)",
    );
  }
  const details = key.asymmetricKeyDetails;
  if (
    details === undefined ||
    details.namedCurve === undefined ||
    details.namedCurve !== "prime256v1"
  ) {
    throw new RangeError(
      "Wave 1 POC attestation private key must use the prime256v1 (P-256) curve",
    );
  }
  return key;
};

const PEM_CERT_BLOCK_PATTERN =
  /-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g;
const PEM_LEAF_CERT_PATTERN =
  /^[\s]*-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----[\s\S]*$/;

/**
 * Extract the leaf certificate's subject public key (as PEM SPKI) from
 * a PEM-encoded certificate chain. The chain may include zero or more
 * intermediate / root certificates; only the leaf (first) is used to
 * derive the verification key. The full-chain trust validation (Fulcio
 * → operator-pinned root) is OUT OF SCOPE for this module — operators
 * who need it pin a trust root and run that check before invoking the
 * verifier.
 */
const subjectPublicKeyFromCertificateChain = (
  certificateChainPem: string,
): { ok: true; publicKeyPem: string } | { ok: false; reason: string } => {
  if (!PEM_LEAF_CERT_PATTERN.test(certificateChainPem)) {
    return {
      ok: false,
      reason:
        "certificateChainPem must contain at least one PEM CERTIFICATE block",
    };
  }
  const matches = certificateChainPem.match(PEM_CERT_BLOCK_PATTERN) ?? [];
  if (matches.length === 0) {
    return {
      ok: false,
      reason: "no PEM CERTIFICATE blocks parsed",
    };
  }
  const leafPem = matches[0] as string;
  let publicKey: KeyObject;
  try {
    const cert = createPublicKey({ key: leafPem, format: "pem" });
    publicKey = cert;
  } catch (err) {
    return {
      ok: false,
      reason: `leaf certificate is not a valid public-key carrier: ${(err as Error).message}`,
    };
  }
  if (publicKey.asymmetricKeyType !== "ec") {
    return {
      ok: false,
      reason: "leaf certificate public key must be ECDSA (P-256)",
    };
  }
  const details = publicKey.asymmetricKeyDetails;
  if (
    details === undefined ||
    details.namedCurve === undefined ||
    details.namedCurve !== "prime256v1"
  ) {
    return {
      ok: false,
      reason:
        "leaf certificate public key must use the prime256v1 (P-256) curve",
    };
  }
  return {
    ok: true,
    publicKeyPem: publicKey
      .export({ format: "pem", type: "spki" })
      .trim(),
  };
};

const derivePublicKeyFromBundleMaterial = (
  material: Wave1PocAttestationVerificationMaterial,
):
  | { ok: true; material: Wave1PocAttestationPublicKeyMaterial }
  | { ok: false; failure: Wave1PocAttestationVerificationFailure } => {
  if ("publicKey" in material) {
    return { ok: true, material: material.publicKey };
  }
  const chain = material.x509CertificateChain;
  const extracted = subjectPublicKeyFromCertificateChain(
    chain.certificateChainPem,
  );
  if (!extracted.ok) {
    return {
      ok: false,
      failure: {
        code: "bundle_public_key_missing",
        reference: chain.hint,
        message: `bundle x509CertificateChain is invalid: ${extracted.reason}`,
      },
    };
  }
  return {
    ok: true,
    material: {
      hint: chain.hint,
      publicKeyPem: extracted.publicKeyPem,
      algorithm: chain.algorithm,
    },
  };
};

export interface CreateKeyBoundSigstoreSignerInput {
  /** Stable, non-secret identifier (becomes `keyid` and bundle hint). */
  signerReference: string;
  /** PEM-encoded ECDSA P-256 private key. Held in memory only. */
  privateKeyPem: string;
  /**
   * PEM-encoded ECDSA P-256 public key. Optional — if omitted the
   * matching public key is derived from the private key. Supplying it
   * explicitly is preferred when the operator's signing root and
   * verification root differ (e.g., HSM-bound private key).
   */
  publicKeyPem?: string;
}

/**
 * Build a Sigstore-shaped key-bound signer that signs DSSE PAE bytes
 * with ECDSA P-256 (DER-encoded signatures, SHA-256 digest). All
 * signing happens locally via `node:crypto`; no network calls are
 * made. The returned object is the air-gapped reference implementation
 * of `Wave1PocAttestationSigner`.
 */
export const createKeyBoundSigstoreSigner = (
  input: CreateKeyBoundSigstoreSignerInput,
): Wave1PocAttestationSigner => {
  if (!isPositiveLengthString(input.signerReference)) {
    throw new RangeError(
      "createKeyBoundSigstoreSigner: signerReference must be a non-empty string",
    );
  }
  if (!KEYID_PATTERN.test(input.signerReference)) {
    throw new RangeError(
      "createKeyBoundSigstoreSigner: signerReference contains disallowed characters",
    );
  }
  const privateKey = ecdsaPrivateKeyFromPem(input.privateKeyPem);
  let publicKeyPem: string;
  let publicKey: KeyObject;
  if (input.publicKeyPem !== undefined) {
    if (!PUBLIC_KEY_PEM_BLOCK_PATTERN.test(input.publicKeyPem)) {
      throw new RangeError(
        "createKeyBoundSigstoreSigner: publicKeyPem must be PEM-encoded SubjectPublicKeyInfo",
      );
    }
    publicKey = subjectPublicKeyInfoFromPem(input.publicKeyPem);
    publicKeyPem = input.publicKeyPem.trim();
  } else {
    publicKey = createPublicKey(privateKey);
    publicKeyPem = publicKey
      .export({ format: "pem", type: "spki" })
      .trim();
  }
  // Cross-check: derived public key matches when supplied externally.
  const derivedPem = createPublicKey(privateKey)
    .export({ format: "pem", type: "spki" })
    .trim();
  if (stripPemHeaders(derivedPem) !== stripPemHeaders(publicKeyPem)) {
    throw new RangeError(
      "createKeyBoundSigstoreSigner: privateKey does not match supplied publicKey",
    );
  }
  // Touch publicKey to ensure validation ran above; not used after this.
  void publicKey;
  const publicKeyMaterial: Wave1PocAttestationPublicKeyMaterial = {
    hint: input.signerReference,
    publicKeyPem,
    algorithm: "ecdsa-p256-sha256",
  };
  return {
    signerReference: input.signerReference,
    verificationMaterial: { publicKey: publicKeyMaterial },
    signPreAuthenticatedBytes: async (paeBytes) => {
      const signature = cryptoSign("sha256", paeBytes, privateKey);
      return {
        keyid: input.signerReference,
        sig: bytesToBase64(
          new Uint8Array(
            signature.buffer,
            signature.byteOffset,
            signature.byteLength,
          ),
        ),
      };
    },
  };
};

/**
 * Generate a fresh ECDSA P-256 keypair in PEM form. Used by tests and
 * by an operator bootstrapping a key-bound signer when no HSM is
 * available. The private key is returned only via the result; it is
 * never written to disk by this helper.
 */
export const generateWave1PocAttestationKeyPair = (): {
  privateKeyPem: string;
  publicKeyPem: string;
} => {
  const { privateKey, publicKey } = generateKeyPairSync("ec", {
    namedCurve: "prime256v1",
  });
  return {
    privateKeyPem: privateKey
      .export({ format: "pem", type: "pkcs8" })
      .trim(),
    publicKeyPem: publicKey
      .export({ format: "pem", type: "spki" })
      .trim(),
  };
};

/**
 * Operator-supplied callback that produces a Sigstore keyless signature
 * over the DSSE PAE bytes. The implementation is the integration point
 * for Fulcio/Rekor: typically the operator obtains an OIDC token,
 * negotiates an ephemeral keypair, sends the public key to Fulcio for
 * a leaf certificate, signs the PAE bytes with the ephemeral private
 * key, and submits the signed envelope to Rekor for transparency
 * logging.
 *
 * The repo deliberately does NOT vendor that flow — it requires
 * network access and operator-managed trust roots that fall outside
 * the air-gap baseline. Operators who need keyless wire this callback
 * to their preferred Sigstore client (e.g., `sigstore-js`, `cosign`).
 */
export type Wave1PocKeylessSignerCallback = (input: {
  paeBytes: Uint8Array;
}) => Promise<{
  signature: Uint8Array;
  /** PEM-encoded leaf certificate + intermediates (chain order: leaf → root). */
  certificateChainPem: string;
  /** Optional Rekor inclusion proof reference (log index). */
  rekorLogIndex?: number;
}>;

export interface CreateKeylessSigstoreSignerInput {
  /** Stable, non-secret signer reference (e.g., the OIDC subject). */
  signerReference: string;
  /** Operator-supplied function producing signature + cert chain. */
  callback: Wave1PocKeylessSignerCallback;
}

/**
 * Build a Sigstore-keyless-flavoured signer that delegates the
 * certificate-issuance + signing concerns to an operator-supplied
 * `callback`. The repo does not invoke any network code itself; the
 * callback is the only place network egress can occur.
 *
 * The returned signer presents an `x509CertificateChain` verification
 * material on the bundle, so verifiers extract the leaf certificate's
 * subject public key automatically. Trust-root validation (chain → an
 * operator-pinned root) is OUT OF SCOPE here — operators run that
 * validation before invoking `verifyWave1PocAttestation`.
 *
 * The scaffold is fully exercised by tests via a stub callback so the
 * signer/verifier round-trip is validated end-to-end without network.
 */
export const createKeylessSigstoreSignerScaffold = (
  input: CreateKeylessSigstoreSignerInput,
): Wave1PocAttestationSigner => {
  if (!isPositiveLengthString(input.signerReference)) {
    throw new RangeError(
      "createKeylessSigstoreSignerScaffold: signerReference must be a non-empty string",
    );
  }
  if (!KEYID_PATTERN.test(input.signerReference)) {
    throw new RangeError(
      "createKeylessSigstoreSignerScaffold: signerReference contains disallowed characters",
    );
  }
  // The verification material on the signer is opaque until the first
  // signature is produced — Fulcio mints the cert at signing time.
  // We hold a placeholder that the bundle build path replaces after
  // `signPreAuthenticatedBytes` resolves.
  let materializedChain:
    | Wave1PocAttestationCertificateChainMaterial
    | undefined;
  const signer: Wave1PocAttestationSigner = {
    signerReference: input.signerReference,
    get verificationMaterial(): Wave1PocAttestationVerificationMaterial {
      if (materializedChain === undefined) {
        throw new Error(
          "createKeylessSigstoreSignerScaffold: verificationMaterial accessed before signPreAuthenticatedBytes resolved",
        );
      }
      return { x509CertificateChain: materializedChain };
    },
    signPreAuthenticatedBytes: async (paeBytes) => {
      const result = await input.callback({ paeBytes });
      if (!(result.signature instanceof Uint8Array)) {
        throw new TypeError(
          "createKeylessSigstoreSignerScaffold: callback must return a Uint8Array signature",
        );
      }
      const extracted = subjectPublicKeyFromCertificateChain(
        result.certificateChainPem,
      );
      if (!extracted.ok) {
        throw new Error(
          `createKeylessSigstoreSignerScaffold: callback returned invalid certificateChainPem (${extracted.reason})`,
        );
      }
      materializedChain = {
        hint: input.signerReference,
        certificateChainPem: result.certificateChainPem.trim(),
        algorithm: "ecdsa-p256-sha256",
        ...(result.rekorLogIndex !== undefined
          ? { rekorLogIndex: result.rekorLogIndex }
          : {}),
      };
      return {
        keyid: input.signerReference,
        sig: bytesToBase64(result.signature),
      };
    },
  };
  return signer;
};

export interface BuildSignedWave1PocAttestationInput {
  statement: Wave1PocAttestationStatement;
  signer: Wave1PocAttestationSigner;
}

/**
 * Sign a statement with the supplied signer, producing the DSSE
 * envelope and the matching Sigstore bundle. The bundle embeds the
 * envelope by value so a verifier can rely on a single artifact when
 * cross-referencing the signature material.
 */
export const buildSignedWave1PocAttestation = async (
  input: BuildSignedWave1PocAttestationInput,
): Promise<{
  envelope: Wave1PocAttestationDsseEnvelope;
  bundle: Wave1PocAttestationBundle;
}> => {
  const payloadBytes = encodeWave1PocAttestationPayload(input.statement);
  const pae = encodeDssePreAuth(
    WAVE1_POC_ATTESTATION_PAYLOAD_TYPE,
    payloadBytes,
  );
  const signature = await input.signer.signPreAuthenticatedBytes(pae);
  if (!KEYID_PATTERN.test(signature.keyid)) {
    throw new RangeError(
      "buildSignedWave1PocAttestation: signer returned an invalid keyid",
    );
  }
  if (!BASE64_STD_PATTERN.test(signature.sig)) {
    throw new RangeError(
      "buildSignedWave1PocAttestation: signer returned a non-base64 signature",
    );
  }
  const envelope: Wave1PocAttestationDsseEnvelope = {
    payload: bytesToBase64(payloadBytes),
    payloadType: WAVE1_POC_ATTESTATION_PAYLOAD_TYPE,
    signatures: [signature],
  };
  const bundle: Wave1PocAttestationBundle = {
    mediaType: WAVE1_POC_ATTESTATION_BUNDLE_MEDIA_TYPE,
    dsseEnvelope: envelope,
    verificationMaterial: input.signer.verificationMaterial,
  };
  return { envelope, bundle };
};

const isSafeSubdir = (value: string): boolean => {
  if (value.length === 0) return false;
  if (value.startsWith("/") || value.includes("\\")) return false;
  for (const part of value.split("/")) {
    if (part.length === 0 || part === "." || part === "..") return false;
  }
  return true;
};

const ensureSubdir = async (
  rootDir: string,
  subdir: string,
): Promise<string> => {
  if (!isSafeSubdir(subdir)) {
    throw new RangeError(`unsafe subdirectory "${subdir}"`);
  }
  const target = resolve(rootDir, subdir);
  await mkdir(target, { recursive: true });
  return target;
};

const writeAtomic = async (
  destinationDir: string,
  filename: string,
  contents: string,
): Promise<{ path: string; bytes: Uint8Array }> => {
  const path = join(destinationDir, filename);
  // Use randomUUID() instead of Date.now() so concurrent same-pid same-ms
  // writers (e.g., parallel runs in a test runner) cannot collide on
  // the temp filename. Mirrors the FinOps writer idiom in #1371.
  const tmp = `${path}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(tmp, contents, "utf8");
  await rename(tmp, path);
  return { path, bytes: utf8(contents) };
};

export interface PersistWave1PocAttestationInput {
  envelope: Wave1PocAttestationDsseEnvelope;
  bundle?: Wave1PocAttestationBundle;
  /** Run directory under which `evidence/attestations/...` is created. */
  runDir: string;
}

export interface PersistedWave1PocAttestation {
  attestationFilename: string;
  attestationPath: string;
  attestationBytes: Uint8Array;
  bundleFilename?: string;
  bundlePath?: string;
  bundleBytes?: Uint8Array;
}

/**
 * Persist the DSSE envelope under `<runDir>/evidence/attestations/...`
 * and (when supplied) the Sigstore bundle under
 * `<runDir>/evidence/signatures/...`. Writes are atomic via the
 * `${pid}.${randomUUID()}.tmp` rename idiom so concurrent runs (even
 * within the same process / millisecond) cannot corrupt each other's
 * artifacts.
 */
export const persistWave1PocAttestation = async (
  input: PersistWave1PocAttestationInput,
): Promise<PersistedWave1PocAttestation> => {
  const attestationsDir = await ensureSubdir(
    input.runDir,
    WAVE1_POC_ATTESTATIONS_DIRECTORY,
  );
  const attestationFilename = `${WAVE1_POC_ATTESTATIONS_DIRECTORY}/${WAVE1_POC_ATTESTATION_ARTIFACT_FILENAME}`;
  const envelopeContents = canonicalJson(input.envelope);
  const written = await writeAtomic(
    attestationsDir,
    WAVE1_POC_ATTESTATION_ARTIFACT_FILENAME,
    envelopeContents,
  );
  if (input.bundle === undefined) {
    return {
      attestationFilename,
      attestationPath: written.path,
      attestationBytes: written.bytes,
    };
  }
  const signaturesDir = await ensureSubdir(
    input.runDir,
    WAVE1_POC_SIGNATURES_DIRECTORY,
  );
  const bundleFilename = `${WAVE1_POC_SIGNATURES_DIRECTORY}/${WAVE1_POC_ATTESTATION_BUNDLE_FILENAME}`;
  const bundleContents = canonicalJson(input.bundle);
  const writtenBundle = await writeAtomic(
    signaturesDir,
    WAVE1_POC_ATTESTATION_BUNDLE_FILENAME,
    bundleContents,
  );
  return {
    attestationFilename,
    attestationPath: written.path,
    attestationBytes: written.bytes,
    bundleFilename,
    bundlePath: writtenBundle.path,
    bundleBytes: writtenBundle.bytes,
  };
};

/**
 * Audit-timeline summary derived from the persisted attestation. Surfaces
 * signing mode, signer reference, and artifact hashes for a UI / log
 * consumer; no secrets are leaked.
 */
export const summarizeWave1PocAttestation = (input: {
  signingMode: Wave1PocAttestationSigningMode;
  signerReference?: string;
  persisted: PersistedWave1PocAttestation;
}): Wave1PocAttestationSummary => {
  return {
    signingMode: input.signingMode,
    ...(input.signerReference !== undefined
      ? { signerReference: input.signerReference }
      : {}),
    attestationFilename: input.persisted.attestationFilename,
    attestationSha256: sha256OfBytes(input.persisted.attestationBytes),
    ...(input.persisted.bundleFilename !== undefined
      ? { bundleFilename: input.persisted.bundleFilename }
      : {}),
    ...(input.persisted.bundleBytes !== undefined
      ? { bundleSha256: sha256OfBytes(input.persisted.bundleBytes) }
      : {}),
  };
};

const isENOENT = (err: unknown): boolean =>
  typeof err === "object" &&
  err !== null &&
  (err as { code?: string }).code === "ENOENT";

const decodeStatement = (
  envelope: unknown,
): {
  statement?: Wave1PocAttestationStatement;
  failures: Wave1PocAttestationVerificationFailure[];
} => {
  const failures: Wave1PocAttestationVerificationFailure[] = [];
  if (!isRecord(envelope)) {
    failures.push({
      code: "envelope_unparseable",
      reference: WAVE1_POC_ATTESTATION_ARTIFACT_FILENAME,
      message: "DSSE envelope must be an object",
    });
    return { failures };
  }
  if (envelope["payloadType"] !== WAVE1_POC_ATTESTATION_PAYLOAD_TYPE) {
    failures.push({
      code: "envelope_payload_type_mismatch",
      reference: WAVE1_POC_ATTESTATION_ARTIFACT_FILENAME,
      message: `payloadType must be "${WAVE1_POC_ATTESTATION_PAYLOAD_TYPE}"`,
    });
    return { failures };
  }
  if (typeof envelope["payload"] !== "string") {
    failures.push({
      code: "envelope_payload_decode_failed",
      reference: WAVE1_POC_ATTESTATION_ARTIFACT_FILENAME,
      message: "payload must be a base64 string",
    });
    return { failures };
  }
  let payloadBytes: Uint8Array;
  try {
    payloadBytes = base64ToBytes(envelope["payload"]);
  } catch {
    failures.push({
      code: "envelope_payload_decode_failed",
      reference: WAVE1_POC_ATTESTATION_ARTIFACT_FILENAME,
      message: "payload is not canonical base64",
    });
    return { failures };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(payloadBytes),
    );
  } catch {
    failures.push({
      code: "statement_unparseable",
      reference: WAVE1_POC_ATTESTATION_ARTIFACT_FILENAME,
      message: "decoded payload is not valid JSON",
    });
    return { failures };
  }
  if (!isRecord(parsed)) {
    failures.push({
      code: "statement_unparseable",
      reference: WAVE1_POC_ATTESTATION_ARTIFACT_FILENAME,
      message: "decoded payload must be an object",
    });
    return { failures };
  }
  if (parsed["_type"] !== WAVE1_POC_ATTESTATION_STATEMENT_TYPE) {
    failures.push({
      code: "statement_type_mismatch",
      reference: WAVE1_POC_ATTESTATION_ARTIFACT_FILENAME,
      message: `statement _type must be "${WAVE1_POC_ATTESTATION_STATEMENT_TYPE}"`,
    });
  }
  if (parsed["predicateType"] !== WAVE1_POC_ATTESTATION_PREDICATE_TYPE) {
    failures.push({
      code: "statement_predicate_type_mismatch",
      reference: WAVE1_POC_ATTESTATION_ARTIFACT_FILENAME,
      message: `predicateType must be "${WAVE1_POC_ATTESTATION_PREDICATE_TYPE}"`,
    });
  }
  if (failures.length > 0) {
    return { failures };
  }
  return {
    statement: parsed as unknown as Wave1PocAttestationStatement,
    failures,
  };
};

const validatePredicate = (
  predicate: unknown,
  manifest: Wave1PocEvidenceManifest,
  manifestSha256: string,
  expectedSigningMode: Wave1PocAttestationSigningMode,
): Wave1PocAttestationVerificationFailure[] => {
  const failures: Wave1PocAttestationVerificationFailure[] = [];
  if (!isRecord(predicate)) {
    failures.push({
      code: "statement_predicate_invalid",
      reference: "predicate",
      message: "predicate must be an object",
    });
    return failures;
  }
  if (predicate["rawScreenshotsIncluded"] !== false) {
    failures.push({
      code: "statement_predicate_invalid",
      reference: "rawScreenshotsIncluded",
      message: "predicate.rawScreenshotsIncluded must be false",
    });
  }
  if (predicate["secretsIncluded"] !== false) {
    failures.push({
      code: "statement_predicate_invalid",
      reference: "secretsIncluded",
      message: "predicate.secretsIncluded must be false",
    });
  }
  if (predicate["imagePayloadSentToTestGeneration"] !== false) {
    failures.push({
      code: "statement_predicate_invalid",
      reference: "imagePayloadSentToTestGeneration",
      message: "predicate.imagePayloadSentToTestGeneration must be false",
    });
  }
  if (
    typeof predicate["manifestSha256"] !== "string" ||
    !HEX64.test(predicate["manifestSha256"])
  ) {
    failures.push({
      code: "statement_predicate_invalid",
      reference: "manifestSha256",
      message: "predicate.manifestSha256 must be a sha256 hex string",
    });
  } else if (predicate["manifestSha256"] !== manifestSha256) {
    failures.push({
      code: "manifest_sha256_mismatch",
      reference: "manifestSha256",
      message:
        "predicate.manifestSha256 does not match the manifest digest provided to verify",
    });
  }
  if (predicate["jobId"] !== manifest.jobId) {
    failures.push({
      code: "statement_predicate_invalid",
      reference: "jobId",
      message: "predicate.jobId must match manifest.jobId",
    });
  }
  if (predicate["fixtureId"] !== manifest.fixtureId) {
    failures.push({
      code: "statement_predicate_invalid",
      reference: "fixtureId",
      message: "predicate.fixtureId must match manifest.fixtureId",
    });
  }
  if (predicate["contractVersion"] !== manifest.contractVersion) {
    failures.push({
      code: "statement_predicate_invalid",
      reference: "contractVersion",
      message: "predicate.contractVersion must match manifest.contractVersion",
    });
  }
  if (predicate["signingMode"] !== expectedSigningMode) {
    failures.push({
      code: "signing_mode_mismatch",
      reference: "signingMode",
      message: `predicate.signingMode must be "${expectedSigningMode}"`,
    });
  } else if (
    predicate["signingMode"] !== "unsigned" &&
    predicate["signingMode"] !== "sigstore"
  ) {
    failures.push({
      code: "statement_predicate_invalid",
      reference: "signingMode",
      message: "predicate.signingMode must be one of unsigned | sigstore",
    });
  }
  return failures;
};

const verifySignaturesAgainstPublicKey = (
  paeBytes: Uint8Array,
  signatures: Wave1PocAttestationSignature[],
  publicKey: Wave1PocAttestationPublicKeyMaterial,
): Wave1PocAttestationVerificationFailure[] => {
  const failures: Wave1PocAttestationVerificationFailure[] = [];
  let pkObject: KeyObject;
  try {
    pkObject = subjectPublicKeyInfoFromPem(publicKey.publicKeyPem);
  } catch (err) {
    failures.push({
      code: "bundle_public_key_missing",
      reference: publicKey.hint,
      message: `verification public key invalid: ${(err as Error).message}`,
    });
    return failures;
  }
  for (const sig of signatures) {
    if (!KEYID_PATTERN.test(sig.keyid)) {
      failures.push({
        code: "signature_invalid_keyid",
        reference: sig.keyid,
        message: "signature.keyid contains disallowed characters",
      });
      continue;
    }
    if (sig.keyid !== publicKey.hint) {
      failures.push({
        code: "signature_invalid_keyid",
        reference: sig.keyid,
        message: `signature.keyid "${sig.keyid}" does not match public key hint "${publicKey.hint}"`,
      });
      continue;
    }
    let sigBytes: Uint8Array;
    try {
      sigBytes = base64ToBytes(sig.sig);
    } catch {
      failures.push({
        code: "signature_invalid_encoding",
        reference: sig.keyid,
        message: "signature.sig is not canonical base64",
      });
      continue;
    }
    const verified = cryptoVerify("sha256", paeBytes, pkObject, sigBytes);
    if (!verified) {
      failures.push({
        code: "signature_unverified",
        reference: sig.keyid,
        message: "ECDSA signature failed to verify against public key",
      });
    }
  }
  return failures;
};

export interface VerifyWave1PocAttestationInput {
  envelope: Wave1PocAttestationDsseEnvelope;
  manifest: Wave1PocEvidenceManifest;
  /** SHA-256 of the canonical manifest bytes. */
  manifestSha256: string;
  artifactsDir: string;
  expectedSigningMode: Wave1PocAttestationSigningMode;
  /**
   * Bundle witnessing the same envelope. REQUIRED for `sigstore` mode;
   * MUST be omitted (or `undefined`) for `unsigned` mode.
   */
  bundle?: Wave1PocAttestationBundle;
  /**
   * Optional public-key override. When supplied, signatures verify
   * against this material instead of the bundle's. Used by callers
   * that pin a specific signer identity (e.g., compliance audits).
   */
  publicKey?: Wave1PocAttestationPublicKeyMaterial;
  /**
   * When true, every artifact in the manifest must appear as a
   * subject. Defaults to `true` so a tampered statement that drops a
   * subject fails verification fail-closed.
   */
  requireFullSubjectCoverage?: boolean;
}

const verifySubjectsAgainstDisk = async (
  subjects: Wave1PocAttestationSubject[],
  manifest: Wave1PocEvidenceManifest,
  artifactsDir: string,
  manifestSha256: string,
  requireFullSubjectCoverage: boolean,
): Promise<Wave1PocAttestationVerificationFailure[]> => {
  const failures: Wave1PocAttestationVerificationFailure[] = [];
  const subjectMap = new Map<string, string>();
  const safeReference = (filename: string): string =>
    validateWave1PocEvidenceArtifactPath(filename).ok
      ? filename
      : formatWave1PocEvidenceArtifactPathForDiagnostic(filename);
  for (const subject of subjects) {
    if (!isRecord(subject)) {
      failures.push({
        code: "statement_predicate_invalid",
        reference: "subject",
        message: "subject entry must be an object",
      });
      continue;
    }
    if (typeof subject.name !== "string" || subject.name.length === 0) {
      failures.push({
        code: "statement_predicate_invalid",
        reference: "subject.name",
        message: "subject.name must be a non-empty string",
      });
      continue;
    }
    if (
      subject.name !== WAVE1_POC_EVIDENCE_MANIFEST_ARTIFACT_FILENAME &&
      !validateWave1PocEvidenceArtifactPath(subject.name).ok
    ) {
      const reference = safeReference(subject.name);
      failures.push({
        code: "statement_predicate_invalid",
        reference,
        message: `subject.name must be a safe artifact filename: ${reference}`,
      });
      continue;
    }
    if (
      !isRecord(subject.digest) ||
      typeof subject.digest.sha256 !== "string" ||
      !HEX64.test(subject.digest.sha256)
    ) {
      failures.push({
        code: "statement_predicate_invalid",
        reference: subject.name,
        message: "subject.digest.sha256 must be a sha256 hex string",
      });
      continue;
    }
    subjectMap.set(subject.name, subject.digest.sha256);
  }

  const manifestSubjectName = WAVE1_POC_EVIDENCE_MANIFEST_ARTIFACT_FILENAME;
  if (!subjectMap.has(manifestSubjectName)) {
    failures.push({
      code: "subject_missing_artifact",
      reference: manifestSubjectName,
      message: "statement must include the manifest as a subject",
    });
  } else if (subjectMap.get(manifestSubjectName) !== manifestSha256) {
    failures.push({
      code: "subject_digest_mismatch",
      reference: manifestSubjectName,
      message:
        "subject digest for the manifest does not match the canonical manifest SHA-256",
    });
  }

  for (const artifact of manifest.artifacts) {
    if (!validateWave1PocEvidenceArtifactPath(artifact.filename).ok) {
      const reference = safeReference(artifact.filename);
      failures.push({
        code: "statement_predicate_invalid",
        reference,
        message: `manifest artifact filename is invalid: ${reference}`,
      });
      continue;
    }
    const subjectDigest = subjectMap.get(artifact.filename);
    if (subjectDigest === undefined) {
      if (requireFullSubjectCoverage) {
        failures.push({
          code: "subject_unattested_artifact",
          reference: artifact.filename,
          message:
            "manifest artifact is not covered by the attestation subject list",
        });
      }
      continue;
    }
    if (subjectDigest !== artifact.sha256) {
      failures.push({
        code: "subject_digest_mismatch",
        reference: artifact.filename,
        message: `subject digest does not match manifest digest for ${artifact.filename}`,
      });
      continue;
    }
    let path: string;
    try {
      path = resolveWave1PocEvidenceArtifactPath(
        artifactsDir,
        artifact.filename,
      );
    } catch (err) {
      failures.push({
        code: "subject_missing_artifact",
        reference: artifact.filename,
        message: (err as Error).message,
      });
      continue;
    }
    let bytes: Buffer;
    try {
      bytes = await readFile(path);
    } catch (err) {
      if (isENOENT(err)) {
        failures.push({
          code: "subject_missing_artifact",
          reference: artifact.filename,
          message: `artifact file not found at ${path}`,
        });
        continue;
      }
      throw err;
    }
    const actual = sha256OfBytes(
      new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength),
    );
    if (actual !== subjectDigest) {
      failures.push({
        code: "subject_digest_mismatch",
        reference: artifact.filename,
        message: `on-disk SHA-256 ${actual} does not match attested ${subjectDigest} for ${artifact.filename} at ${path}`,
      });
    }
  }
  return failures;
};

/**
 * Verify a parsed DSSE envelope against the manifest it attests, the
 * artifacts on disk, and (when present) the Sigstore signature. Returns
 * a structured failure list; callers can render any non-empty list as
 * an audit failure without re-parsing diagnostic strings.
 *
 * Signing-mode contract:
 *   - `unsigned` envelopes MUST carry zero signatures and no bundle.
 *   - `sigstore` envelopes MUST carry at least one signature, the
 *     `bundle` parameter, and the bundle MUST embed the same envelope
 *     bytes as the standalone artifact. All signatures must verify
 *     against the (overridden or bundle-embedded) public key.
 */
export const verifyWave1PocAttestation = async (
  input: VerifyWave1PocAttestationInput,
): Promise<Wave1PocAttestationVerificationResult> => {
  const failures: Wave1PocAttestationVerificationFailure[] = [];
  const requireFullSubjectCoverage = input.requireFullSubjectCoverage ?? true;
  const decoded = decodeStatement(input.envelope);
  failures.push(...decoded.failures);
  if (decoded.statement === undefined) {
    return {
      ok: false,
      signingMode: input.expectedSigningMode,
      signatureCount: Array.isArray(input.envelope.signatures)
        ? input.envelope.signatures.length
        : 0,
      signaturesVerified: false,
      failures,
    };
  }
  failures.push(
    ...validatePredicate(
      decoded.statement.predicate,
      input.manifest,
      input.manifestSha256,
      input.expectedSigningMode,
    ),
  );
  if (!Array.isArray(decoded.statement.subject)) {
    failures.push({
      code: "statement_predicate_invalid",
      reference: "subject",
      message: "statement.subject must be an array",
    });
  } else {
    failures.push(
      ...(await verifySubjectsAgainstDisk(
        decoded.statement.subject,
        input.manifest,
        input.artifactsDir,
        input.manifestSha256,
        requireFullSubjectCoverage,
      )),
    );
  }

  const signatures = Array.isArray(input.envelope.signatures)
    ? input.envelope.signatures
    : [];
  const signatureCount = signatures.length;
  let signaturesVerified = false;
  if (input.expectedSigningMode === "unsigned") {
    if (signatureCount > 0) {
      failures.push({
        code: "signature_unsigned_envelope_carries_signatures",
        reference: WAVE1_POC_ATTESTATION_ARTIFACT_FILENAME,
        message: "unsigned envelope must carry zero signatures",
      });
    } else {
      signaturesVerified = true;
    }
    if (input.bundle !== undefined) {
      failures.push({
        code: "bundle_envelope_mismatch",
        reference: WAVE1_POC_ATTESTATION_BUNDLE_FILENAME,
        message: "unsigned mode must not produce a Sigstore bundle",
      });
    }
  } else {
    if (signatureCount === 0) {
      failures.push({
        code: "signature_required",
        reference: WAVE1_POC_ATTESTATION_ARTIFACT_FILENAME,
        message: "sigstore mode requires at least one signature",
      });
    }
    let publicKey = input.publicKey;
    if (input.bundle === undefined) {
      failures.push({
        code: "bundle_missing",
        reference: WAVE1_POC_ATTESTATION_BUNDLE_FILENAME,
        message: "sigstore mode requires the matching Sigstore bundle",
      });
    } else {
      const bundleEnvelopeBytes = utf8(
        canonicalJson(input.bundle.dsseEnvelope),
      );
      const envelopeBytes = utf8(canonicalJson(input.envelope));
      if (sha256OfBytes(bundleEnvelopeBytes) !== sha256OfBytes(envelopeBytes)) {
        failures.push({
          code: "bundle_envelope_mismatch",
          reference: WAVE1_POC_ATTESTATION_BUNDLE_FILENAME,
          message:
            "bundle.dsseEnvelope does not match the standalone DSSE envelope",
        });
      }
      if (publicKey === undefined) {
        const derived = derivePublicKeyFromBundleMaterial(
          input.bundle.verificationMaterial,
        );
        if (derived.ok) {
          publicKey = derived.material;
        } else {
          failures.push(derived.failure);
        }
      }
    }
    if (publicKey === undefined) {
      failures.push({
        code: "bundle_public_key_missing",
        reference: WAVE1_POC_ATTESTATION_BUNDLE_FILENAME,
        message: "sigstore mode requires verification public key material",
      });
    } else if (signatureCount > 0) {
      let payloadBytes: Uint8Array;
      try {
        payloadBytes = base64ToBytes(input.envelope.payload);
      } catch {
        failures.push({
          code: "envelope_payload_decode_failed",
          reference: WAVE1_POC_ATTESTATION_ARTIFACT_FILENAME,
          message: "envelope.payload is not canonical base64",
        });
        return {
          ok: false,
          signingMode: input.expectedSigningMode,
          signatureCount,
          signaturesVerified: false,
          failures,
        };
      }
      const pae = encodeDssePreAuth(
        WAVE1_POC_ATTESTATION_PAYLOAD_TYPE,
        payloadBytes,
      );
      const sigFailures = verifySignaturesAgainstPublicKey(
        pae,
        signatures,
        publicKey,
      );
      failures.push(...sigFailures);
      signaturesVerified = sigFailures.length === 0 && signatureCount > 0;
    }
  }

  return {
    ok: failures.length === 0,
    signingMode: input.expectedSigningMode,
    signatureCount,
    signaturesVerified,
    failures,
  };
};

export interface VerifyWave1PocAttestationFromDiskOptions {
  expectedSigningMode: Wave1PocAttestationSigningMode;
  publicKey?: Wave1PocAttestationPublicKeyMaterial;
  requireFullSubjectCoverage?: boolean;
}

const readJsonFile = async (
  path: string,
): Promise<
  | { value: unknown; ok: true }
  | { ok: false; reason: "missing" | "unparseable" }
> => {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (err) {
    if (isENOENT(err)) return { ok: false, reason: "missing" };
    throw err;
  }
  try {
    return { value: JSON.parse(raw), ok: true };
  } catch {
    return { ok: false, reason: "unparseable" };
  }
};

/**
 * Convenience wrapper: read the in-toto envelope (and bundle when in
 * `sigstore` mode) from `<runDir>/evidence/...`, then call
 * `verifyWave1PocAttestation`. Throws only when the envelope file is
 * missing or unparseable; tampering with the file content is reported
 * via the returned `failures` array.
 */
export const verifyWave1PocAttestationFromDisk = async (
  runDir: string,
  manifest: Wave1PocEvidenceManifest,
  manifestSha256: string,
  options: VerifyWave1PocAttestationFromDiskOptions,
): Promise<Wave1PocAttestationVerificationResult> => {
  const attestationPath = join(
    runDir,
    WAVE1_POC_ATTESTATIONS_DIRECTORY,
    WAVE1_POC_ATTESTATION_ARTIFACT_FILENAME,
  );
  const envelopeRead = await readJsonFile(attestationPath);
  if (!envelopeRead.ok) {
    return {
      ok: false,
      signingMode: options.expectedSigningMode,
      signatureCount: 0,
      signaturesVerified: false,
      failures: [
        {
          code:
            envelopeRead.reason === "missing"
              ? "envelope_unparseable"
              : "envelope_unparseable",
          reference: WAVE1_POC_ATTESTATION_ARTIFACT_FILENAME,
          message:
            envelopeRead.reason === "missing"
              ? `attestation envelope not found at ${attestationPath}`
              : `attestation envelope at ${attestationPath} is not valid JSON`,
        },
      ],
    };
  }
  const envelope = envelopeRead.value as Wave1PocAttestationDsseEnvelope;

  let bundle: Wave1PocAttestationBundle | undefined;
  if (options.expectedSigningMode === "sigstore") {
    const bundlePath = join(
      runDir,
      WAVE1_POC_SIGNATURES_DIRECTORY,
      WAVE1_POC_ATTESTATION_BUNDLE_FILENAME,
    );
    const bundleRead = await readJsonFile(bundlePath);
    if (!bundleRead.ok) {
      return {
        ok: false,
        signingMode: options.expectedSigningMode,
        signatureCount: Array.isArray(envelope.signatures)
          ? envelope.signatures.length
          : 0,
        signaturesVerified: false,
        failures: [
          {
            code: "bundle_missing",
            reference: WAVE1_POC_ATTESTATION_BUNDLE_FILENAME,
            message:
              bundleRead.reason === "missing"
                ? `Sigstore bundle not found at ${bundlePath}`
                : `Sigstore bundle at ${bundlePath} is not valid JSON`,
          },
        ],
      };
    }
    bundle = bundleRead.value as Wave1PocAttestationBundle;
  }

  return verifyWave1PocAttestation({
    envelope,
    manifest,
    manifestSha256,
    artifactsDir: runDir,
    expectedSigningMode: options.expectedSigningMode,
    ...(bundle !== undefined ? { bundle } : {}),
    ...(options.publicKey !== undefined
      ? { publicKey: options.publicKey }
      : {}),
    ...(options.requireFullSubjectCoverage !== undefined
      ? { requireFullSubjectCoverage: options.requireFullSubjectCoverage }
      : {}),
  });
};

/**
 * Lists the run-dir-relative paths the attestation flow writes for a
 * given signing mode. Useful for callers that want to attest the
 * attestation files themselves (e.g., as evidence-manifest artifacts).
 */
export const listWave1PocAttestationArtifactPaths = (
  signingMode: Wave1PocAttestationSigningMode,
): string[] => {
  const paths = [
    `${WAVE1_POC_ATTESTATIONS_DIRECTORY}/${WAVE1_POC_ATTESTATION_ARTIFACT_FILENAME}`,
  ];
  if (signingMode === "sigstore") {
    paths.push(
      `${WAVE1_POC_SIGNATURES_DIRECTORY}/${WAVE1_POC_ATTESTATION_BUNDLE_FILENAME}`,
    );
  }
  return paths;
};

export const computeWave1PocAttestationEnvelopeDigest = (
  envelope: Wave1PocAttestationDsseEnvelope,
): string => sha256OfBytes(utf8(canonicalJson(envelope)));
