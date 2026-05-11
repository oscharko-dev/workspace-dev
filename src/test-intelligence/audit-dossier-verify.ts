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
    | "pdf_mismatch"
    | "merkle_root_mismatch"
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

const computeMerkleRoot = (hashes: readonly string[]): string => {
  const levels = buildMerkleLevels(hashes);
  const root = levels.at(-1)?.[0];
  if (!root) {
    throw new Error("Merkle root cannot be reconstructed from the manifest.");
  }
  return root;
};

const expectString = (
  record: Record<string, unknown>,
  key: string,
): string | undefined => {
  const value = record[key];
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
};

const expectNumber = (
  record: Record<string, unknown>,
  key: string,
): number | undefined => {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
};

const parseManifest = (
  value: unknown,
): AuditDossierManifest | undefined => {
  if (!isRecord(value)) {
    return undefined;
  }
  const bundle = isRecord(value.bundle) ? value.bundle : undefined;
  const signing = isRecord(value.signing) ? value.signing : undefined;
  const provenance = isRecord(value.provenance) ? value.provenance : undefined;
  const leafHashes = Array.isArray(provenance?.leafHashes)
    ? provenance.leafHashes
    : undefined;
  if (
    !bundle ||
    !signing ||
    !provenance ||
    !leafHashes ||
    !expectString(value, "runId") ||
    !expectString(bundle, "pdfFilename") ||
    !expectString(bundle, "pdfSha256") ||
    !expectString(signing, "keyFingerprintSha256") ||
    !expectString(signing, "publicKeyPem") ||
    !expectString(signing, "manifestSha256") ||
    !expectString(provenance, "merkleRoot") ||
    expectNumber(provenance, "leafCount") === undefined ||
    !expectString(provenance, "merkleProofSha256") ||
    !leafHashes.every(
      (leaf) =>
        isRecord(leaf) &&
        expectString(leaf, "reference") !== undefined &&
        expectString(leaf, "hash") !== undefined,
    )
  ) {
    return undefined;
  }
  return value as unknown as AuditDossierManifest;
};

const parseSignature = (
  value: unknown,
): AuditDossierSignature | undefined => {
  if (!isRecord(value)) {
    return undefined;
  }
  if (
    !expectString(value, "keyFingerprintSha256") ||
    !expectString(value, "publicKeyPem") ||
    !expectString(value, "manifestSha256") ||
    !expectString(value, "signatureBase64")
  ) {
    return undefined;
  }
  return value as unknown as AuditDossierSignature;
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
  const pdfPath = `${bundlePrefix}.pdf`;
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
    const validated = parseManifest(parsed);
    if (!validated) throw new Error("manifest shape is invalid");
    manifest = validated;
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
    const validated = parseSignature(parsed);
    if (!validated) throw new Error("signature shape is invalid");
    signature = validated;
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

  const expectedMerkleRoot = computeMerkleRoot(
    manifest.provenance.leafHashes.map((leaf) => leaf.hash),
  );
  if (expectedMerkleRoot !== manifest.provenance.merkleRoot) {
    failures.push({
      code: "merkle_root_mismatch",
      reference: manifestPath,
      message:
        "Manifest Merkle root does not match the provenance leaf hashes.",
    });
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

  try {
    const pdfBytes = await readFile(pdfPath);
    if (
      sha256Hex(pdfBytes) !== manifest.bundle.pdfSha256 ||
      manifest.bundle.pdfFilename !== `${manifest.runId}-audit-dossier.pdf`
    ) {
      failures.push({
        code: "pdf_mismatch",
        reference: pdfPath,
        message: "Bundle PDF is missing, renamed, or does not match the manifest hash.",
      });
    }
  } catch {
    failures.push({
      code: "pdf_mismatch",
      reference: pdfPath,
      message: "Bundle PDF is missing.",
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
