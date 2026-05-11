/**
 * Self-service customer-onboarding (Issue #2185, W8-3).
 *
 * Lays down a complete tenant directory in one command so a tier-1
 * operator can onboard themselves without operator hand-holding:
 *
 *   <output-root>/tenants/<tenant-id>/
 *     tenant-bundle.json                 — minimal valid tenant bundle (W8-2)
 *     calibration-corpus/                — empty, ready to grow
 *     signing-keys/
 *       audit-dossier.ed25519.private.pem      (W6-1)
 *       audit-dossier.ed25519.public.pem
 *       region-attestation.hmac.key            (W6-3)
 *       reviewer-signing.ed25519.private.pem   (W6-5)
 *       reviewer-signing.ed25519.public.pem
 *       fingerprints.json
 *     ict-register.json                  — DORA Art. 28 register entry
 *     onboarding-evidence.json           — audit-trail of the onboard flow
 *
 * Key generation is **strictly local** — no KMS / HSM call. The
 * operator owns key custody from the moment the keys land on disk.
 *
 * Multi-tenant isolation (Issue #2176): every artifact embeds the
 * tenant scope, the doctor subcommand re-asserts that scope, and the
 * tenant directory is refused if a different tenant id is observed
 * inside any of the artifacts.
 */

import {
  createHash,
  createPublicKey,
  generateKeyPairSync,
  randomBytes,
  type KeyObject,
} from "node:crypto";
import {
  copyFile,
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";

import {
  DEFAULT_TENANT_SCOPE,
  EU_BANKING_DEFAULT_POLICY_PROFILE_ID,
  type TenantScope,
} from "../contracts/index.js";
import { canonicalJson } from "./content-hash.js";
import { parseAndCanonicalizeTenantBundle } from "./tenant-bundle.js";

// ---------------------------------------------------------------------------
// Public constants
// ---------------------------------------------------------------------------

/** Schema version pinned on every onboarding artifact (evidence + ICT). */
export const TENANT_ONBOARDING_SCHEMA_VERSION = "1.0.0" as const;

/** Schema version pinned on the ICT register entry. */
export const TENANT_ICT_REGISTER_SCHEMA_VERSION = "1.0.0" as const;

/** Top-level subdirectory under `--output-root` that hosts every tenant. */
export const TENANT_ONBOARDING_TENANTS_SUBDIR = "tenants" as const;

/** Filename of the tenant bundle written into the tenant directory. */
export const TENANT_ONBOARDING_BUNDLE_FILENAME = "tenant-bundle.json" as const;

/** Calibration-corpus subdirectory inside the tenant directory. */
export const TENANT_ONBOARDING_CALIBRATION_CORPUS_DIRNAME =
  "calibration-corpus" as const;

/** Signing-keys subdirectory inside the tenant directory. */
export const TENANT_ONBOARDING_SIGNING_KEYS_DIRNAME = "signing-keys" as const;

/** Filename of the DORA Art. 28 ICT register entry. */
export const TENANT_ICT_REGISTER_FILENAME = "ict-register.json" as const;

/** Filename of the onboarding evidence audit trail. */
export const TENANT_ONBOARDING_EVIDENCE_FILENAME =
  "onboarding-evidence.json" as const;

/** Filename of the public-key fingerprints summary inside `signing-keys/`. */
export const TENANT_ONBOARDING_FINGERPRINTS_FILENAME =
  "fingerprints.json" as const;

/** Filename of the audit-dossier signing key (W6-1). */
export const AUDIT_DOSSIER_PRIVATE_KEY_FILENAME =
  "audit-dossier.ed25519.private.pem" as const;
export const AUDIT_DOSSIER_PUBLIC_KEY_FILENAME =
  "audit-dossier.ed25519.public.pem" as const;

/** Filename of the region-attestation HMAC key (W6-3). */
export const REGION_ATTESTATION_KEY_FILENAME =
  "region-attestation.hmac.key" as const;

/** Filename of the reviewer signing key (W6-5). */
export const REVIEWER_SIGNING_PRIVATE_KEY_FILENAME =
  "reviewer-signing.ed25519.private.pem" as const;
export const REVIEWER_SIGNING_PUBLIC_KEY_FILENAME =
  "reviewer-signing.ed25519.public.pem" as const;

/** Mode for private key files (owner read/write only). */
export const PRIVATE_KEY_FILE_MODE = 0o600;
/** Mode for the region-attestation HMAC secret. */
export const HMAC_SECRET_FILE_MODE = 0o600;
/** Mode for public artifacts (owner rw, group r, other r). */
export const PUBLIC_ARTIFACT_FILE_MODE = 0o644;

/** Valid tenant id pattern — kept in sync with `tenant-bundle.ts`. */
export const TENANT_ONBOARDING_TENANT_ID_PATTERN: RegExp =
  /^[a-z0-9][a-z0-9_-]{0,63}$/u;

/** Closed allow-list of policy-profile ids the onboarding CLI accepts. */
export const TENANT_ONBOARDING_KNOWN_POLICY_PROFILE_IDS: readonly string[] = [
  EU_BANKING_DEFAULT_POLICY_PROFILE_ID,
];

const KNOWN_POLICY_PROFILE_SET: ReadonlySet<string> = new Set(
  TENANT_ONBOARDING_KNOWN_POLICY_PROFILE_IDS,
);

const LEGAL_NAME_MAX_LENGTH = 256;
const JURISDICTION_PATTERN = /^[A-Z]{2}(?:-[A-Z0-9]{1,3})?$/u;
const REGION_ATTESTATION_HMAC_BYTES = 32;

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface TenantOnboardingInput {
  /** Stable tenant id; must match {@link TENANT_ONBOARDING_TENANT_ID_PATTERN}. */
  readonly tenantId: string;
  /** Customer's registered legal name (≤ {@link LEGAL_NAME_MAX_LENGTH}). */
  readonly legalName: string;
  /** Policy profile id from {@link TENANT_ONBOARDING_KNOWN_POLICY_PROFILE_IDS}. */
  readonly policyProfileId: string;
  /** Root directory under which `tenants/<tenant-id>/` will be created. */
  readonly outputRoot: string;
  /** Refuse to overwrite an existing tenant directory unless `true`. */
  readonly force?: boolean;
  /** Tenant-scope environment id (default `"prod"`). */
  readonly environmentId?: string;
  /** Optional project id within the tenant scope. */
  readonly projectId?: string;
  /** ISO-3166 jurisdiction (default `"EU"`). */
  readonly jurisdiction?: string;
  /** ISO-8601 effective date for the ICT register entry (default = now). */
  readonly effectiveDate?: string;
  /** Test seam — defaults to `() => new Date()`. */
  readonly now?: () => Date;
  /** Test seam — defaults to {@link generateKeyPairSync}. */
  readonly generateEd25519KeyPair?: () => Ed25519KeyMaterial;
  /** Test seam — defaults to {@link randomBytes}. */
  readonly randomBytes?: (size: number) => Buffer;
}

export interface Ed25519KeyMaterial {
  /** PEM-encoded PKCS#8 private key. */
  readonly privateKeyPem: string;
  /** PEM-encoded SPKI public key. */
  readonly publicKeyPem: string;
}

export interface SigningKeyFingerprints {
  readonly auditDossierEd25519Sha256: string;
  readonly regionAttestationHmacSha256: string;
  readonly reviewerSigningEd25519Sha256: string;
}

export interface CreatedArtifactRef {
  /** Tenant-directory-relative POSIX path (always forward-slash). */
  readonly relativePath: string;
  /** sha256 hex digest of the file bytes. */
  readonly sha256: string;
  /** File size in bytes. */
  readonly bytes: number;
}

export interface TenantOnboardingResult {
  readonly tenantId: string;
  readonly tenantScope: TenantScope;
  readonly tenantDirectory: string;
  readonly bundlePath: string;
  readonly ictRegisterPath: string;
  readonly evidencePath: string;
  readonly fingerprints: SigningKeyFingerprints;
  readonly createdArtifacts: readonly CreatedArtifactRef[];
  /** Human-readable summary report (the operator-facing stdout). */
  readonly summaryReport: string;
}

export interface TenantOnboardingDoctorInput {
  readonly tenantId: string;
  readonly outputRoot: string;
  readonly environmentId?: string;
  readonly projectId?: string;
}

export interface TenantOnboardingDoctorCheck {
  readonly name: string;
  readonly ok: boolean;
  readonly detail: string;
}

export interface TenantOnboardingDoctorResult {
  readonly tenantId: string;
  readonly tenantDirectory: string;
  readonly ok: boolean;
  readonly checks: readonly TenantOnboardingDoctorCheck[];
  readonly orphanedFiles: readonly string[];
}

/** Operator-facing validation error for the onboarding subsystem. */
export class TenantOnboardingValidationError extends Error {
  /** Stable, machine-readable error code. */
  readonly code: string;
  constructor(message: string, code = "TENANT_ONBOARDING_VALIDATION_ERROR") {
    super(message);
    this.name = "TenantOnboardingValidationError";
    this.code = code;
  }
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

const EXPECTED_SIGNING_KEY_FILENAMES: readonly string[] = [
  AUDIT_DOSSIER_PRIVATE_KEY_FILENAME,
  AUDIT_DOSSIER_PUBLIC_KEY_FILENAME,
  REGION_ATTESTATION_KEY_FILENAME,
  REVIEWER_SIGNING_PRIVATE_KEY_FILENAME,
  REVIEWER_SIGNING_PUBLIC_KEY_FILENAME,
  TENANT_ONBOARDING_FINGERPRINTS_FILENAME,
];

const EXPECTED_TENANT_DIR_ENTRIES: readonly string[] = [
  TENANT_ONBOARDING_BUNDLE_FILENAME,
  TENANT_ONBOARDING_CALIBRATION_CORPUS_DIRNAME,
  TENANT_ONBOARDING_SIGNING_KEYS_DIRNAME,
  TENANT_ICT_REGISTER_FILENAME,
  TENANT_ONBOARDING_EVIDENCE_FILENAME,
];

const sha256HexBytes = (bytes: Uint8Array): string =>
  createHash("sha256").update(bytes).digest("hex");

const sha256HexString = (s: string): string =>
  createHash("sha256").update(s, "utf8").digest("hex");

const tenantScopeFromInput = (input: {
  readonly tenantId: string;
  readonly environmentId?: string;
  readonly projectId?: string;
}): TenantScope => {
  const environmentId = (input.environmentId ?? "prod").trim();
  const tenantScope: TenantScope = {
    tenantId: input.tenantId,
    environmentId,
    ...(input.projectId !== undefined && input.projectId.trim().length > 0
      ? { projectId: input.projectId.trim() }
      : {}),
  };
  return tenantScope;
};

const validateTenantId = (raw: unknown): string => {
  if (typeof raw !== "string") {
    throw new TenantOnboardingValidationError(
      "--tenant-id must be a string",
      "TENANT_ONBOARDING_INVALID_TENANT_ID",
    );
  }
  const trimmed = raw.trim();
  if (!TENANT_ONBOARDING_TENANT_ID_PATTERN.test(trimmed)) {
    throw new TenantOnboardingValidationError(
      `--tenant-id must match ${TENANT_ONBOARDING_TENANT_ID_PATTERN.source}`,
      "TENANT_ONBOARDING_INVALID_TENANT_ID",
    );
  }
  return trimmed;
};

const validateLegalName = (raw: unknown): string => {
  if (typeof raw !== "string") {
    throw new TenantOnboardingValidationError(
      "--legal-name must be a string",
      "TENANT_ONBOARDING_INVALID_LEGAL_NAME",
    );
  }
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    throw new TenantOnboardingValidationError(
      "--legal-name must be non-empty",
      "TENANT_ONBOARDING_INVALID_LEGAL_NAME",
    );
  }
  if (trimmed.length > LEGAL_NAME_MAX_LENGTH) {
    throw new TenantOnboardingValidationError(
      `--legal-name must be ≤ ${LEGAL_NAME_MAX_LENGTH} characters`,
      "TENANT_ONBOARDING_INVALID_LEGAL_NAME",
    );
  }
  // Reject control characters that would break canonical JSON readability.
  // eslint-disable-next-line no-control-regex
  if (/[ -]/u.test(trimmed)) {
    throw new TenantOnboardingValidationError(
      "--legal-name must not contain control characters",
      "TENANT_ONBOARDING_INVALID_LEGAL_NAME",
    );
  }
  return trimmed;
};

const validatePolicyProfileId = (raw: unknown): string => {
  if (typeof raw !== "string") {
    throw new TenantOnboardingValidationError(
      "--policy-profile must be a string",
      "TENANT_ONBOARDING_UNKNOWN_POLICY_PROFILE",
    );
  }
  const trimmed = raw.trim();
  if (!KNOWN_POLICY_PROFILE_SET.has(trimmed)) {
    const known = TENANT_ONBOARDING_KNOWN_POLICY_PROFILE_IDS.join(", ");
    throw new TenantOnboardingValidationError(
      `--policy-profile "${trimmed}" is not a known profile (known: ${known})`,
      "TENANT_ONBOARDING_UNKNOWN_POLICY_PROFILE",
    );
  }
  return trimmed;
};

const validateOutputRoot = (raw: unknown): string => {
  if (typeof raw !== "string") {
    throw new TenantOnboardingValidationError(
      "--output-root must be a string",
      "TENANT_ONBOARDING_INVALID_OUTPUT_ROOT",
    );
  }
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    throw new TenantOnboardingValidationError(
      "--output-root must be non-empty",
      "TENANT_ONBOARDING_INVALID_OUTPUT_ROOT",
    );
  }
  return resolve(trimmed);
};

const validateEnvironmentId = (raw: string): string => {
  if (!/^[a-z0-9][a-z0-9_-]{0,63}$/u.test(raw)) {
    throw new TenantOnboardingValidationError(
      `environmentId must match ^[a-z0-9][a-z0-9_-]{0,63}$ (got "${raw}")`,
      "TENANT_ONBOARDING_INVALID_ENVIRONMENT_ID",
    );
  }
  return raw;
};

const validateJurisdiction = (raw: string): string => {
  if (!JURISDICTION_PATTERN.test(raw)) {
    throw new TenantOnboardingValidationError(
      `--jurisdiction must match ${JURISDICTION_PATTERN.source} (e.g. "EU", "DE", "DE-BY")`,
      "TENANT_ONBOARDING_INVALID_JURISDICTION",
    );
  }
  return raw;
};

const validateEffectiveDate = (raw: string): string => {
  if (!/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z)?$/u.test(raw)) {
    throw new TenantOnboardingValidationError(
      "--effective-date must be ISO-8601 (YYYY-MM-DD or full UTC timestamp)",
      "TENANT_ONBOARDING_INVALID_EFFECTIVE_DATE",
    );
  }
  const parsed = Date.parse(raw);
  if (Number.isNaN(parsed)) {
    throw new TenantOnboardingValidationError(
      "--effective-date must be a parseable ISO-8601 date",
      "TENANT_ONBOARDING_INVALID_EFFECTIVE_DATE",
    );
  }
  return raw;
};

const tenantDirectoryFor = (outputRoot: string, tenantId: string): string =>
  join(outputRoot, TENANT_ONBOARDING_TENANTS_SUBDIR, tenantId);

const toRelativePosix = (root: string, child: string): string =>
  relative(root, child).split(/[\\/]/u).join("/");

const fingerprintFromPublicKeyPem = (publicKeyPem: string): string => {
  const publicKey = createPublicKey({ key: publicKeyPem, format: "pem" });
  const spkiDer = publicKey.export({ format: "der", type: "spki" }) as Buffer;
  return sha256HexBytes(
    new Uint8Array(spkiDer.buffer, spkiDer.byteOffset, spkiDer.byteLength),
  );
};

const fingerprintFromKeyObject = (publicKey: KeyObject): string => {
  const spkiDer = publicKey.export({ format: "der", type: "spki" }) as Buffer;
  return sha256HexBytes(
    new Uint8Array(spkiDer.buffer, spkiDer.byteOffset, spkiDer.byteLength),
  );
};

const defaultGenerateEd25519KeyPair = (): Ed25519KeyMaterial => {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const privateKeyPem = (
    privateKey.export({ format: "pem", type: "pkcs8" }) as string
  ).trim();
  const publicKeyPem = (
    publicKey.export({ format: "pem", type: "spki" }) as string
  ).trim();
  return { privateKeyPem, publicKeyPem };
};

const ensureFreshTenantDirectory = async (
  tenantDirectory: string,
  force: boolean,
): Promise<void> => {
  let exists = false;
  try {
    await stat(tenantDirectory);
    exists = true;
  } catch (err) {
    if (
      err === null ||
      typeof err !== "object" ||
      (err as { code?: string }).code !== "ENOENT"
    ) {
      throw err;
    }
  }
  if (exists) {
    if (!force) {
      throw new TenantOnboardingValidationError(
        `tenant directory "${tenantDirectory}" already exists; pass --force to overwrite`,
        "TENANT_ONBOARDING_DIRECTORY_EXISTS",
      );
    }
    await rm(tenantDirectory, { recursive: true, force: true });
  }
};

const writeArtifact = async (input: {
  readonly tenantDirectory: string;
  readonly absolutePath: string;
  readonly bytes: Buffer | string;
  readonly mode: number;
  readonly created: CreatedArtifactRef[];
}): Promise<void> => {
  await mkdir(dirname(input.absolutePath), { recursive: true });
  const buffer = Buffer.isBuffer(input.bytes)
    ? input.bytes
    : Buffer.from(input.bytes, "utf8");
  await writeFile(input.absolutePath, buffer, { mode: input.mode });
  input.created.push({
    relativePath: toRelativePosix(input.tenantDirectory, input.absolutePath),
    sha256: sha256HexBytes(
      new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength),
    ),
    bytes: buffer.byteLength,
  });
};

const buildTenantBundleJson = (input: {
  readonly tenantId: string;
  readonly policyProfileId: string;
}): string => {
  // Minimal bundle that round-trips through W8-2 validation. The
  // bundle resolver canonicalizes regardless of source key order.
  return `${JSON.stringify(
    {
      tenantId: input.tenantId,
      bundleVersion: "1.0.0",
      inheritsFromPolicyProfile: input.policyProfileId,
    },
    null,
    2,
  )}\n`;
};

const buildIctRegisterEntry = (input: {
  readonly tenantId: string;
  readonly tenantScope: TenantScope;
  readonly legalName: string;
  readonly jurisdiction: string;
  readonly policyProfileId: string;
  readonly effectiveDate: string;
  readonly registeredAtUtc: string;
  readonly fingerprints: SigningKeyFingerprints;
}): Record<string, unknown> => {
  return {
    schemaVersion: TENANT_ICT_REGISTER_SCHEMA_VERSION,
    regulation: "DORA-Art-28",
    tenantId: input.tenantId,
    tenantScope: input.tenantScope,
    legalEntity: {
      legalName: input.legalName,
      jurisdiction: input.jurisdiction,
    },
    ictArrangement: {
      providerName: "workspace-dev",
      serviceDescription:
        "Test-intelligence harness for QC test-case generation, audit-dossier signing, and tenant-scoped artifact production.",
      criticality: "important",
    },
    policyProfileId: input.policyProfileId,
    effectiveDate: input.effectiveDate,
    registeredAtUtc: input.registeredAtUtc,
    signingKeyFingerprints: input.fingerprints,
  };
};

const buildOnboardingEvidence = (input: {
  readonly tenantId: string;
  readonly tenantScope: TenantScope;
  readonly outputRoot: string;
  readonly tenantDirectory: string;
  readonly policyProfileId: string;
  readonly legalName: string;
  readonly jurisdiction: string;
  readonly effectiveDate: string;
  readonly createdAtUtc: string;
  readonly fingerprints: SigningKeyFingerprints;
  readonly createdArtifacts: readonly CreatedArtifactRef[];
}): Record<string, unknown> => {
  const body = {
    schemaVersion: TENANT_ONBOARDING_SCHEMA_VERSION,
    tenantId: input.tenantId,
    tenantScope: input.tenantScope,
    policyProfileId: input.policyProfileId,
    legalName: input.legalName,
    jurisdiction: input.jurisdiction,
    effectiveDate: input.effectiveDate,
    outputRoot: input.outputRoot,
    tenantDirectory: input.tenantDirectory,
    createdAtUtc: input.createdAtUtc,
    fingerprints: input.fingerprints,
    artifacts: [...input.createdArtifacts].sort((left, right) =>
      left.relativePath.localeCompare(right.relativePath),
    ),
  };
  return {
    ...body,
    evidenceContentHash: sha256HexString(canonicalJson(body)),
  };
};

const buildSummaryReport = (input: {
  readonly tenantId: string;
  readonly tenantDirectory: string;
  readonly bundlePath: string;
  readonly fingerprints: SigningKeyFingerprints;
}): string => {
  const lines: string[] = [];
  lines.push("Tenant onboarding complete.");
  lines.push("");
  lines.push(`  tenantId:        ${input.tenantId}`);
  lines.push(`  tenantDirectory: ${input.tenantDirectory}`);
  lines.push("");
  lines.push("Public-key fingerprints (record these — private keys are NEVER reprinted):");
  lines.push(
    `  audit-dossier (W6-1):       ${input.fingerprints.auditDossierEd25519Sha256}`,
  );
  lines.push(
    `  region-attestation (W6-3):  ${input.fingerprints.regionAttestationHmacSha256}`,
  );
  lines.push(
    `  reviewer-signing (W6-5):    ${input.fingerprints.reviewerSigningEd25519Sha256}`,
  );
  lines.push("");
  lines.push("Next steps:");
  lines.push(
    `  1. Back up "${join(input.tenantDirectory, TENANT_ONBOARDING_SIGNING_KEYS_DIRNAME)}" (private keys are operator-managed; we never see them).`,
  );
  lines.push(
    `  2. Sanity-check the layout:`,
  );
  lines.push(
    `       pnpm exec tsx src/cli.ts test-intelligence onboard --doctor --tenant-id ${input.tenantId} --output-root ${dirname(dirname(input.tenantDirectory))}`,
  );
  lines.push(
    `  3. Run a smoke test against a small mask:`,
  );
  lines.push(
    `       pnpm exec tsx src/cli.ts test-intelligence run --tenant-bundle ${input.bundlePath} [...]`,
  );
  return `${lines.join("\n")}\n`;
};

/**
 * Run the full onboarding flow. Pure function over its inputs and the
 * filesystem — no env-var reads, no network, no secret material printed.
 *
 * Throws {@link TenantOnboardingValidationError} on operator-facing
 * input errors, propagates filesystem errors verbatim.
 */
export const runTenantOnboarding = async (
  rawInput: TenantOnboardingInput,
): Promise<TenantOnboardingResult> => {
  const tenantId = validateTenantId(rawInput.tenantId);
  const legalName = validateLegalName(rawInput.legalName);
  const policyProfileId = validatePolicyProfileId(rawInput.policyProfileId);
  const outputRoot = validateOutputRoot(rawInput.outputRoot);
  const force = rawInput.force === true;
  const environmentId = validateEnvironmentId(
    (rawInput.environmentId ?? "prod").trim(),
  );
  const jurisdiction = validateJurisdiction(
    (rawInput.jurisdiction ?? "EU").trim(),
  );
  const now = (rawInput.now ?? (() => new Date()))();
  const nowUtc = now.toISOString();
  const effectiveDate = validateEffectiveDate(
    (rawInput.effectiveDate ?? nowUtc.slice(0, 10)).trim(),
  );

  const tenantScope = tenantScopeFromInput({
    tenantId,
    environmentId,
    ...(rawInput.projectId !== undefined ? { projectId: rawInput.projectId } : {}),
  });

  const tenantDirectory = tenantDirectoryFor(outputRoot, tenantId);
  await ensureFreshTenantDirectory(tenantDirectory, force);

  await mkdir(tenantDirectory, { recursive: true, mode: 0o755 });
  await mkdir(
    join(tenantDirectory, TENANT_ONBOARDING_CALIBRATION_CORPUS_DIRNAME),
    { recursive: true, mode: 0o755 },
  );
  const signingKeysDirectory = join(
    tenantDirectory,
    TENANT_ONBOARDING_SIGNING_KEYS_DIRNAME,
  );
  await mkdir(signingKeysDirectory, { recursive: true, mode: 0o700 });

  const created: CreatedArtifactRef[] = [];

  const generate = rawInput.generateEd25519KeyPair ?? defaultGenerateEd25519KeyPair;
  const random = rawInput.randomBytes ?? randomBytes;

  // Audit-dossier signing key (W6-1).
  const auditDossierKeys = generate();
  const auditDossierFingerprint = fingerprintFromPublicKeyPem(
    auditDossierKeys.publicKeyPem,
  );
  await writeArtifact({
    tenantDirectory,
    absolutePath: join(signingKeysDirectory, AUDIT_DOSSIER_PRIVATE_KEY_FILENAME),
    bytes: `${auditDossierKeys.privateKeyPem}\n`,
    mode: PRIVATE_KEY_FILE_MODE,
    created,
  });
  await writeArtifact({
    tenantDirectory,
    absolutePath: join(signingKeysDirectory, AUDIT_DOSSIER_PUBLIC_KEY_FILENAME),
    bytes: `${auditDossierKeys.publicKeyPem}\n`,
    mode: PUBLIC_ARTIFACT_FILE_MODE,
    created,
  });

  // Reviewer signing key (W6-5).
  const reviewerKeys = generate();
  const reviewerFingerprint = fingerprintFromPublicKeyPem(
    reviewerKeys.publicKeyPem,
  );
  await writeArtifact({
    tenantDirectory,
    absolutePath: join(
      signingKeysDirectory,
      REVIEWER_SIGNING_PRIVATE_KEY_FILENAME,
    ),
    bytes: `${reviewerKeys.privateKeyPem}\n`,
    mode: PRIVATE_KEY_FILE_MODE,
    created,
  });
  await writeArtifact({
    tenantDirectory,
    absolutePath: join(
      signingKeysDirectory,
      REVIEWER_SIGNING_PUBLIC_KEY_FILENAME,
    ),
    bytes: `${reviewerKeys.publicKeyPem}\n`,
    mode: PUBLIC_ARTIFACT_FILE_MODE,
    created,
  });

  // Region-attestation HMAC secret (W6-3). The region-attestation
  // module signs payloads with HMAC-SHA-256 using a shared symmetric
  // secret read from the env. We emit a high-entropy hex secret; the
  // operator wires it into the env on the production runner.
  const regionAttestationSecret = random(REGION_ATTESTATION_HMAC_BYTES).toString("hex");
  const regionAttestationFingerprint = sha256HexString(regionAttestationSecret);
  await writeArtifact({
    tenantDirectory,
    absolutePath: join(signingKeysDirectory, REGION_ATTESTATION_KEY_FILENAME),
    bytes: `${regionAttestationSecret}\n`,
    mode: HMAC_SECRET_FILE_MODE,
    created,
  });

  const fingerprints: SigningKeyFingerprints = {
    auditDossierEd25519Sha256: auditDossierFingerprint,
    regionAttestationHmacSha256: regionAttestationFingerprint,
    reviewerSigningEd25519Sha256: reviewerFingerprint,
  };

  // Public-key fingerprints summary — safe to commit to a register.
  await writeArtifact({
    tenantDirectory,
    absolutePath: join(
      signingKeysDirectory,
      TENANT_ONBOARDING_FINGERPRINTS_FILENAME,
    ),
    bytes: `${JSON.stringify(
      {
        schemaVersion: TENANT_ONBOARDING_SCHEMA_VERSION,
        tenantId,
        tenantScope,
        fingerprints,
      },
      null,
      2,
    )}\n`,
    mode: PUBLIC_ARTIFACT_FILE_MODE,
    created,
  });

  // Tenant bundle (W8-2). Round-trip through the validator so a broken
  // bundle is caught here and not at the next `test-intelligence run`.
  const bundleJson = buildTenantBundleJson({ tenantId, policyProfileId });
  const parsed = parseAndCanonicalizeTenantBundle(bundleJson);
  if (!parsed.ok) {
    throw new TenantOnboardingValidationError(
      `internal error: generated tenant bundle failed validation: ${parsed.issues
        .map((issue) => `${issue.path}: ${issue.message}`)
        .join("; ")}`,
      "TENANT_ONBOARDING_INTERNAL_BUNDLE_INVALID",
    );
  }
  const bundlePath = join(tenantDirectory, TENANT_ONBOARDING_BUNDLE_FILENAME);
  await writeArtifact({
    tenantDirectory,
    absolutePath: bundlePath,
    bytes: bundleJson,
    mode: PUBLIC_ARTIFACT_FILE_MODE,
    created,
  });

  // ICT register entry (DORA Art. 28).
  const ictRegisterPath = join(tenantDirectory, TENANT_ICT_REGISTER_FILENAME);
  const ictRegister = buildIctRegisterEntry({
    tenantId,
    tenantScope,
    legalName,
    jurisdiction,
    policyProfileId,
    effectiveDate,
    registeredAtUtc: nowUtc,
    fingerprints,
  });
  await writeArtifact({
    tenantDirectory,
    absolutePath: ictRegisterPath,
    bytes: `${JSON.stringify(ictRegister, null, 2)}\n`,
    mode: PUBLIC_ARTIFACT_FILE_MODE,
    created,
  });

  // Onboarding evidence — last so it can hash every prior artifact.
  const evidencePath = join(tenantDirectory, TENANT_ONBOARDING_EVIDENCE_FILENAME);
  const evidence = buildOnboardingEvidence({
    tenantId,
    tenantScope,
    outputRoot,
    tenantDirectory,
    policyProfileId,
    legalName,
    jurisdiction,
    effectiveDate,
    createdAtUtc: nowUtc,
    fingerprints,
    createdArtifacts: created,
  });
  // Note: writing evidence appends one more entry to `created` (itself),
  // but its hash captures only the artifacts written before it — which
  // matches the "evidence summarizes the prior steps" semantic.
  await writeArtifact({
    tenantDirectory,
    absolutePath: evidencePath,
    bytes: `${JSON.stringify(evidence, null, 2)}\n`,
    mode: PUBLIC_ARTIFACT_FILE_MODE,
    created,
  });

  const summaryReport = buildSummaryReport({
    tenantId,
    tenantDirectory,
    bundlePath,
    fingerprints,
  });

  return {
    tenantId,
    tenantScope,
    tenantDirectory,
    bundlePath,
    ictRegisterPath,
    evidencePath,
    fingerprints,
    createdArtifacts: created,
    summaryReport,
  };
};

// ---------------------------------------------------------------------------
// Doctor
// ---------------------------------------------------------------------------

const safeReadJson = async (
  path: string,
): Promise<{ ok: true; value: unknown } | { ok: false; reason: string }> => {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (err) {
    if (
      err !== null &&
      typeof err === "object" &&
      (err as { code?: string }).code === "ENOENT"
    ) {
      return { ok: false, reason: "missing" };
    }
    return { ok: false, reason: `unreadable: ${(err as Error).message}` };
  }
  try {
    return { ok: true, value: JSON.parse(raw) as unknown };
  } catch (err) {
    return { ok: false, reason: `not valid JSON: ${(err as Error).message}` };
  }
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const tenantScopesEqual = (
  left: TenantScope,
  right: TenantScope,
): boolean =>
  left.tenantId === right.tenantId &&
  left.environmentId === right.environmentId &&
  (left.projectId ?? "default") === (right.projectId ?? "default");

const verifyTenantScopeOnArtifact = (
  artifactName: string,
  body: unknown,
  expectedScope: TenantScope,
  expectedTenantId: string,
): TenantOnboardingDoctorCheck => {
  if (!isRecord(body)) {
    return {
      name: `${artifactName}-tenant-scope`,
      ok: false,
      detail: `${artifactName} body is not a JSON object`,
    };
  }
  const scope = body["tenantScope"];
  if (!isRecord(scope) || typeof scope["tenantId"] !== "string") {
    return {
      name: `${artifactName}-tenant-scope`,
      ok: false,
      detail: `${artifactName} is missing the tenantScope envelope (multi-tenant isolation)`,
    };
  }
  const observed: TenantScope = {
    tenantId: scope["tenantId"],
    environmentId:
      typeof scope["environmentId"] === "string"
        ? scope["environmentId"]
        : DEFAULT_TENANT_SCOPE.environmentId,
    ...(typeof scope["projectId"] === "string"
      ? { projectId: scope["projectId"] }
      : {}),
  };
  if (
    body["tenantId"] !== expectedTenantId ||
    !tenantScopesEqual(observed, expectedScope)
  ) {
    return {
      name: `${artifactName}-tenant-scope`,
      ok: false,
      detail:
        `${artifactName} carries a different tenant scope ` +
        `(expected ${expectedScope.tenantId}/${expectedScope.environmentId}, ` +
        `got ${observed.tenantId}/${observed.environmentId})`,
    };
  }
  return {
    name: `${artifactName}-tenant-scope`,
    ok: true,
    detail: `tenant scope ${expectedScope.tenantId}/${expectedScope.environmentId} matches`,
  };
};

const checkPemPrivateKey = async (
  filePath: string,
  expectedFingerprint: string | undefined,
  label: string,
): Promise<TenantOnboardingDoctorCheck> => {
  let raw: string;
  try {
    raw = await readFile(filePath, "utf8");
  } catch (err) {
    if (
      err !== null &&
      typeof err === "object" &&
      (err as { code?: string }).code === "ENOENT"
    ) {
      return {
        name: `${label}-private-key`,
        ok: false,
        detail: `${filePath} is missing`,
      };
    }
    return {
      name: `${label}-private-key`,
      ok: false,
      detail: `${filePath} unreadable: ${(err as Error).message}`,
    };
  }
  try {
    // We import lazily so the doctor stays callable when the file is
    // a stub; the createPrivateKey path verifies the byte format.
    const { createPrivateKey } = await import("node:crypto");
    const privateKey = createPrivateKey({ key: raw, format: "pem" });
    if (privateKey.asymmetricKeyType !== "ed25519") {
      return {
        name: `${label}-private-key`,
        ok: false,
        detail: `${label} private key is not Ed25519 (got ${privateKey.asymmetricKeyType ?? "unknown"})`,
      };
    }
    const publicKey = createPublicKey(privateKey);
    const fingerprint = fingerprintFromKeyObject(publicKey);
    if (
      expectedFingerprint !== undefined &&
      expectedFingerprint !== fingerprint
    ) {
      return {
        name: `${label}-private-key`,
        ok: false,
        detail: `${label} private key fingerprint does not match recorded fingerprint`,
      };
    }
    return {
      name: `${label}-private-key`,
      ok: true,
      detail: `${label} private key valid (sha256: ${fingerprint.slice(0, 16)}…)`,
    };
  } catch (err) {
    return {
      name: `${label}-private-key`,
      ok: false,
      detail: `${label} private key parse failed: ${(err as Error).message}`,
    };
  }
};

const checkPemPublicKey = async (
  filePath: string,
  expectedFingerprint: string | undefined,
  label: string,
): Promise<TenantOnboardingDoctorCheck> => {
  let raw: string;
  try {
    raw = await readFile(filePath, "utf8");
  } catch (err) {
    if (
      err !== null &&
      typeof err === "object" &&
      (err as { code?: string }).code === "ENOENT"
    ) {
      return {
        name: `${label}-public-key`,
        ok: false,
        detail: `${filePath} is missing`,
      };
    }
    return {
      name: `${label}-public-key`,
      ok: false,
      detail: `${filePath} unreadable: ${(err as Error).message}`,
    };
  }
  try {
    const fingerprint = fingerprintFromPublicKeyPem(raw);
    if (
      expectedFingerprint !== undefined &&
      expectedFingerprint !== fingerprint
    ) {
      return {
        name: `${label}-public-key`,
        ok: false,
        detail: `${label} public key fingerprint does not match recorded fingerprint`,
      };
    }
    return {
      name: `${label}-public-key`,
      ok: true,
      detail: `${label} public key valid (sha256: ${fingerprint.slice(0, 16)}…)`,
    };
  } catch (err) {
    return {
      name: `${label}-public-key`,
      ok: false,
      detail: `${label} public key parse failed: ${(err as Error).message}`,
    };
  }
};

const checkRegionAttestationKey = async (
  filePath: string,
  expectedFingerprint: string | undefined,
): Promise<TenantOnboardingDoctorCheck> => {
  let raw: string;
  try {
    raw = await readFile(filePath, "utf8");
  } catch (err) {
    if (
      err !== null &&
      typeof err === "object" &&
      (err as { code?: string }).code === "ENOENT"
    ) {
      return {
        name: "region-attestation-key",
        ok: false,
        detail: `${filePath} is missing`,
      };
    }
    return {
      name: "region-attestation-key",
      ok: false,
      detail: `${filePath} unreadable: ${(err as Error).message}`,
    };
  }
  const trimmed = raw.trim();
  if (!/^[0-9a-f]+$/u.test(trimmed) || trimmed.length < 32) {
    return {
      name: "region-attestation-key",
      ok: false,
      detail: "region-attestation key must be a hex string ≥ 32 chars",
    };
  }
  const fingerprint = sha256HexString(trimmed);
  if (
    expectedFingerprint !== undefined &&
    expectedFingerprint !== fingerprint
  ) {
    return {
      name: "region-attestation-key",
      ok: false,
      detail: "region-attestation key fingerprint does not match recorded fingerprint",
    };
  }
  return {
    name: "region-attestation-key",
    ok: true,
    detail: `region-attestation key valid (sha256: ${fingerprint.slice(0, 16)}…)`,
  };
};

/**
 * Validate an existing tenant directory:
 *
 *   - signing keys present and correctly typed
 *   - calibration corpus directory accessible
 *   - ICT register valid and tenant-scope tagged
 *   - tenant bundle parses cleanly
 *   - no orphaned top-level files in the tenant directory
 */
export const runTenantOnboardingDoctor = async (
  rawInput: TenantOnboardingDoctorInput,
): Promise<TenantOnboardingDoctorResult> => {
  const tenantId = validateTenantId(rawInput.tenantId);
  const outputRoot = validateOutputRoot(rawInput.outputRoot);
  const environmentId = validateEnvironmentId(
    (rawInput.environmentId ?? "prod").trim(),
  );
  const expectedScope = tenantScopeFromInput({
    tenantId,
    environmentId,
    ...(rawInput.projectId !== undefined ? { projectId: rawInput.projectId } : {}),
  });
  const tenantDirectory = tenantDirectoryFor(outputRoot, tenantId);

  const checks: TenantOnboardingDoctorCheck[] = [];

  let dirExists = false;
  try {
    const tenantStat = await stat(tenantDirectory);
    dirExists = tenantStat.isDirectory();
  } catch {
    dirExists = false;
  }
  if (!dirExists) {
    return {
      tenantId,
      tenantDirectory,
      ok: false,
      checks: [
        {
          name: "tenant-directory",
          ok: false,
          detail: `tenant directory ${tenantDirectory} does not exist`,
        },
      ],
      orphanedFiles: [],
    };
  }
  checks.push({
    name: "tenant-directory",
    ok: true,
    detail: `tenant directory ${tenantDirectory} present`,
  });

  // Calibration corpus accessible.
  const calibrationDir = join(
    tenantDirectory,
    TENANT_ONBOARDING_CALIBRATION_CORPUS_DIRNAME,
  );
  try {
    const corpusStat = await stat(calibrationDir);
    if (!corpusStat.isDirectory()) {
      checks.push({
        name: "calibration-corpus",
        ok: false,
        detail: `${calibrationDir} exists but is not a directory`,
      });
    } else {
      checks.push({
        name: "calibration-corpus",
        ok: true,
        detail: `calibration corpus directory accessible`,
      });
    }
  } catch {
    checks.push({
      name: "calibration-corpus",
      ok: false,
      detail: `${calibrationDir} is missing`,
    });
  }

  // ICT register present, parseable, tenant-scope correct.
  const ictPath = join(tenantDirectory, TENANT_ICT_REGISTER_FILENAME);
  const ictRead = await safeReadJson(ictPath);
  let recordedFingerprints: SigningKeyFingerprints | undefined;
  if (!ictRead.ok) {
    checks.push({
      name: "ict-register",
      ok: false,
      detail: `${TENANT_ICT_REGISTER_FILENAME} ${ictRead.reason}`,
    });
  } else {
    checks.push(
      verifyTenantScopeOnArtifact(
        TENANT_ICT_REGISTER_FILENAME,
        ictRead.value,
        expectedScope,
        tenantId,
      ),
    );
    if (
      isRecord(ictRead.value) &&
      isRecord(ictRead.value["signingKeyFingerprints"])
    ) {
      const fp = ictRead.value["signingKeyFingerprints"];
      const audit = fp["auditDossierEd25519Sha256"];
      const region = fp["regionAttestationHmacSha256"];
      const reviewer = fp["reviewerSigningEd25519Sha256"];
      if (
        typeof audit === "string" &&
        typeof region === "string" &&
        typeof reviewer === "string"
      ) {
        recordedFingerprints = {
          auditDossierEd25519Sha256: audit,
          regionAttestationHmacSha256: region,
          reviewerSigningEd25519Sha256: reviewer,
        };
      }
    }
    if (recordedFingerprints === undefined) {
      checks.push({
        name: "ict-register-fingerprints",
        ok: false,
        detail: "ICT register is missing signingKeyFingerprints",
      });
    } else {
      checks.push({
        name: "ict-register-fingerprints",
        ok: true,
        detail: "ICT register carries all three signing-key fingerprints",
      });
    }
  }

  // Tenant bundle present and parses.
  const bundlePath = join(tenantDirectory, TENANT_ONBOARDING_BUNDLE_FILENAME);
  let bundleRaw: string | undefined;
  try {
    bundleRaw = await readFile(bundlePath, "utf8");
  } catch {
    bundleRaw = undefined;
  }
  if (bundleRaw === undefined) {
    checks.push({
      name: "tenant-bundle",
      ok: false,
      detail: `${TENANT_ONBOARDING_BUNDLE_FILENAME} is missing`,
    });
  } else {
    const parsed = parseAndCanonicalizeTenantBundle(bundleRaw);
    if (!parsed.ok) {
      checks.push({
        name: "tenant-bundle",
        ok: false,
        detail: `tenant bundle invalid: ${parsed.issues
          .map((issue) => `${issue.path}: ${issue.message}`)
          .join("; ")}`,
      });
    } else if (parsed.bundle.tenantId !== tenantId) {
      checks.push({
        name: "tenant-bundle",
        ok: false,
        detail: `tenant bundle is scoped to "${parsed.bundle.tenantId}", expected "${tenantId}" (multi-tenant isolation violation)`,
      });
    } else {
      checks.push({
        name: "tenant-bundle",
        ok: true,
        detail: `tenant bundle parses; tenantId=${parsed.bundle.tenantId}`,
      });
    }
  }

  // Onboarding evidence present and tenant-scope tagged.
  const evidencePath = join(
    tenantDirectory,
    TENANT_ONBOARDING_EVIDENCE_FILENAME,
  );
  const evidenceRead = await safeReadJson(evidencePath);
  if (!evidenceRead.ok) {
    checks.push({
      name: "onboarding-evidence",
      ok: false,
      detail: `${TENANT_ONBOARDING_EVIDENCE_FILENAME} ${evidenceRead.reason}`,
    });
  } else {
    checks.push(
      verifyTenantScopeOnArtifact(
        TENANT_ONBOARDING_EVIDENCE_FILENAME,
        evidenceRead.value,
        expectedScope,
        tenantId,
      ),
    );
  }

  // Signing keys present + correctly typed.
  const signingKeysDir = join(
    tenantDirectory,
    TENANT_ONBOARDING_SIGNING_KEYS_DIRNAME,
  );
  checks.push(
    await checkPemPrivateKey(
      join(signingKeysDir, AUDIT_DOSSIER_PRIVATE_KEY_FILENAME),
      recordedFingerprints?.auditDossierEd25519Sha256,
      "audit-dossier",
    ),
  );
  checks.push(
    await checkPemPublicKey(
      join(signingKeysDir, AUDIT_DOSSIER_PUBLIC_KEY_FILENAME),
      recordedFingerprints?.auditDossierEd25519Sha256,
      "audit-dossier",
    ),
  );
  checks.push(
    await checkPemPrivateKey(
      join(signingKeysDir, REVIEWER_SIGNING_PRIVATE_KEY_FILENAME),
      recordedFingerprints?.reviewerSigningEd25519Sha256,
      "reviewer-signing",
    ),
  );
  checks.push(
    await checkPemPublicKey(
      join(signingKeysDir, REVIEWER_SIGNING_PUBLIC_KEY_FILENAME),
      recordedFingerprints?.reviewerSigningEd25519Sha256,
      "reviewer-signing",
    ),
  );
  checks.push(
    await checkRegionAttestationKey(
      join(signingKeysDir, REGION_ATTESTATION_KEY_FILENAME),
      recordedFingerprints?.regionAttestationHmacSha256,
    ),
  );

  // Orphan detection: top-level entries we did not write.
  let topLevelEntries: string[] = [];
  try {
    topLevelEntries = await readdir(tenantDirectory);
  } catch {
    topLevelEntries = [];
  }
  const expectedTopLevel = new Set<string>(EXPECTED_TENANT_DIR_ENTRIES);
  const orphanedTopLevel = topLevelEntries
    .filter((entry) => !expectedTopLevel.has(entry))
    .sort();

  let signingKeyEntries: string[] = [];
  try {
    signingKeyEntries = await readdir(signingKeysDir);
  } catch {
    signingKeyEntries = [];
  }
  const expectedSigning = new Set<string>(EXPECTED_SIGNING_KEY_FILENAMES);
  const orphanedSigning = signingKeyEntries
    .filter((entry) => !expectedSigning.has(entry))
    .map((entry) => `${TENANT_ONBOARDING_SIGNING_KEYS_DIRNAME}/${entry}`)
    .sort();

  const orphanedFiles = [...orphanedTopLevel, ...orphanedSigning];
  if (orphanedFiles.length > 0) {
    checks.push({
      name: "orphaned-files",
      ok: false,
      detail: `unexpected entries in tenant directory: ${orphanedFiles.join(", ")}`,
    });
  } else {
    checks.push({
      name: "orphaned-files",
      ok: true,
      detail: "no orphaned files",
    });
  }

  const ok = checks.every((check) => check.ok);
  return {
    tenantId,
    tenantDirectory,
    ok,
    checks,
    orphanedFiles,
  };
};

// ---------------------------------------------------------------------------
// Test seam exports — narrow surface kept exported for the CLI tests.
// ---------------------------------------------------------------------------

/** Exported for tests: copy a tenant directory under a different tenantId. */
export const cloneTenantDirectoryForTesting = async (
  source: string,
  destination: string,
): Promise<void> => {
  await mkdir(dirname(destination), { recursive: true });
  await mkdir(destination, { recursive: true });
  const entries = await readdir(source, { withFileTypes: true });
  for (const entry of entries) {
    const src = join(source, entry.name);
    const dst = join(destination, entry.name);
    if (entry.isDirectory()) {
      await cloneTenantDirectoryForTesting(src, dst);
    } else {
      await copyFile(src, dst);
    }
  }
};
