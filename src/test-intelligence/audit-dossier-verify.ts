import { createHash, createPublicKey, verify as cryptoVerify } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import type {
  AuditDossierManifest,
  AuditDossierSignature,
} from "../contracts/index.js";
import { canonicalJson } from "./content-hash.js";

export interface AuditDossierVerificationFailure {
  readonly code:
    | "bundle_missing"
    | "manifest_unparseable"
    | "signature_unparseable"
    | "manifest_digest_mismatch"
    | "signature_invalid"
    | "signature_key_mismatch"
    | "merkle_proof_mismatch";
  readonly reference: string;
  readonly message: string;
}

export interface AuditDossierVerificationResult {
  readonly ok: boolean;
  readonly bundlePrefix: string;
  readonly runId?: string;
  readonly merkleRoot?: string;
  readonly keyFingerprintSha256?: string;
  readonly failures: readonly AuditDossierVerificationFailure[];
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const sha256Hex = (value: Uint8Array | string): string =>
  createHash("sha256").update(value).digest("hex");

const buildMerkleLevels = (hashes: readonly string[]): string[][] => {
  const levels: string[][] = [[...hashes].sort((left, right) => left.localeCompare(right))];
  let current = levels[0]!;
  while (current.length > 1) {
    const next: string[] = [];
    for (let index = 0; index < current.length; index += 2) {
      const left = current[index]!;
      const right = current[index + 1] ?? left;
      next.push(sha256Hex(`${left}:${right}`));
    }
    levels.push(next);
    current = next;
  }
  return levels;
};

const buildMerkleProofText = (manifest: AuditDossierManifest): string => {
  const sortedLeaves = [...manifest.provenance.leafHashes].sort((left, right) =>
    left.hash.localeCompare(right.hash),
  );
  const levels = buildMerkleLevels(sortedLeaves.map((leaf) => leaf.hash));
  const lines = [
    "Audit Dossier Merkle Proof",
    `Root: ${manifest.provenance.merkleRoot}`,
    `Leaf count: ${manifest.provenance.leafCount}`,
    "",
    "Level 0 — canonical leaf hashes",
    ...sortedLeaves.map(
      (leaf, index) => `${index + 1}. ${leaf.hash}  ${leaf.reference}`,
    ),
    "",
  ];
  for (let index = 1; index < levels.length; index += 1) {
    lines.push(`Level ${index}`);
    lines.push(...levels[index]!.map((hash, offset) => `${offset + 1}. ${hash}`));
    lines.push("");
  }
  return `${lines.join("\n").trimEnd()}\n`;
};

const resolveBundlePrefix = (bundle: string): string =>
  bundle.endsWith(".json") ? bundle.slice(0, -5) : bundle;

export const verifyAuditDossierBundle = async (
  bundle: string,
): Promise<AuditDossierVerificationResult> => {
  const bundlePrefix = resolve(resolveBundlePrefix(bundle));
  const manifestPath = `${bundlePrefix}.json`;
  const signaturePath = `${bundlePrefix}.sig`;
  const merkleProofPath = `${bundlePrefix}.merkle.txt`;
  const failures: AuditDossierVerificationFailure[] = [];

  let manifestBytes: Uint8Array;
  try {
    manifestBytes = await readFile(manifestPath);
  } catch {
    return {
      ok: false,
      bundlePrefix,
      failures: [
        {
          code: "bundle_missing",
          reference: manifestPath,
          message: "Bundle manifest is missing.",
        },
      ],
    };
  }

  let manifest: AuditDossierManifest;
  try {
    const parsed = JSON.parse(Buffer.from(manifestBytes).toString("utf8")) as unknown;
    if (!isRecord(parsed)) throw new Error("manifest must be an object");
    manifest = parsed as unknown as AuditDossierManifest;
  } catch {
    return {
      ok: false,
      bundlePrefix,
      failures: [
        {
          code: "manifest_unparseable",
          reference: manifestPath,
          message: "Bundle manifest is malformed JSON.",
        },
      ],
    };
  }

  let signature: AuditDossierSignature;
  try {
    const parsed = JSON.parse(await readFile(signaturePath, "utf8")) as unknown;
    if (!isRecord(parsed)) throw new Error("signature must be an object");
    signature = parsed as unknown as AuditDossierSignature;
  } catch {
    return {
      ok: false,
      bundlePrefix,
      runId: manifest.runId,
      merkleRoot: manifest.provenance.merkleRoot,
      failures: [
        {
          code: "signature_unparseable",
          reference: signaturePath,
          message: "Detached signature is missing or malformed JSON.",
        },
      ],
    };
  }

  const unsignedManifestSha256 = sha256Hex(
    canonicalJson({
      ...manifest,
      signing: { ...manifest.signing, manifestSha256: "" },
    }),
  );
  if (
    unsignedManifestSha256 !== signature.manifestSha256 ||
    unsignedManifestSha256 !== manifest.signing.manifestSha256
  ) {
    failures.push({
      code: "manifest_digest_mismatch",
      reference: manifestPath,
      message: "Manifest SHA-256 does not match the detached signature metadata.",
    });
  }

  if (
    signature.keyFingerprintSha256 !== manifest.signing.keyFingerprintSha256 ||
    signature.publicKeyPem.trim() !== manifest.signing.publicKeyPem.trim()
  ) {
    failures.push({
      code: "signature_key_mismatch",
      reference: signaturePath,
      message: "Detached signature key metadata does not match the manifest.",
    });
  }

  try {
    const publicKey = createPublicKey({
      key: signature.publicKeyPem,
      format: "pem",
    });
    const verified = cryptoVerify(
      null,
      Buffer.from(manifestBytes),
      publicKey,
      Buffer.from(signature.signatureBase64, "base64"),
    );
    if (!verified) {
      failures.push({
        code: "signature_invalid",
        reference: signaturePath,
        message: "Detached signature does not verify against the manifest bytes.",
      });
    }
  } catch {
    failures.push({
      code: "signature_invalid",
      reference: signaturePath,
      message: "Detached signature uses invalid public-key material.",
    });
  }

  const expectedProof = buildMerkleProofText(manifest);
  try {
    const observedProof = await readFile(merkleProofPath, "utf8");
    if (
      observedProof !== expectedProof ||
      sha256Hex(observedProof) !== manifest.provenance.merkleProofSha256
    ) {
      failures.push({
        code: "merkle_proof_mismatch",
        reference: merkleProofPath,
        message: "Merkle proof does not match the provenance leaf set in the manifest.",
      });
    }
  } catch {
    failures.push({
      code: "merkle_proof_mismatch",
      reference: merkleProofPath,
      message: "Merkle proof file is missing.",
    });
  }

  return {
    ok: failures.length === 0,
    bundlePrefix,
    runId: manifest.runId,
    merkleRoot: manifest.provenance.merkleRoot,
    keyFingerprintSha256: manifest.signing.keyFingerprintSha256,
    failures,
  };
};
