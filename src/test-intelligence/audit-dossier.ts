import {
  createHash,
  createPrivateKey,
  createPublicKey,
  sign as cryptoSign,
  type KeyObject,
} from "node:crypto";
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type {
  AuditDossierManifest,
  AuditDossierManifestArtifactKind,
  AuditDossierManifestArtifactRef,
  AuditDossierRegulationCoverageEntry,
  AuditDossierSignature,
} from "../contracts/index.js";
import {
  AUDIT_DOSSIER_ARTIFACT_BASENAME,
  AUDIT_DOSSIER_MANIFEST_SCHEMA_VERSION,
  AUDIT_DOSSIER_SIGNATURE_SCHEMA_VERSION,
  PROVENANCE_ARTIFACT_FILENAME,
  TEST_INTELLIGENCE_CONTRACT_VERSION,
} from "../contracts/index.js";
import { canonicalJson } from "./content-hash.js";
import { renderAuditDossierPdf } from "./audit-dossier-renderer.js";
import type { ProvenanceDocument } from "./provenance-graph.js";

const MODEL_CARD_SUFFIX = ".model-card.json";
const DEFAULT_BENCHMARK_PROTOCOL_PATH =
  "docs/test-intelligence/local-benchmark-protocol.md";
const POLICY_REPORT_FILENAME = "policy-report.json";

interface RequiredArtifactSpec {
  readonly kind: AuditDossierManifestArtifactKind;
  readonly filename: string;
  readonly required: true;
}

const REQUIRED_ARTIFACTS: readonly RequiredArtifactSpec[] = [
  {
    kind: "provenance",
    filename: PROVENANCE_ARTIFACT_FILENAME,
    required: true,
  },
  {
    kind: "compliance_coverage",
    filename: "compliance-coverage-report.json",
    required: true,
  },
  {
    kind: "compliance_annotations",
    filename: "compliance-annotations.json",
    required: true,
  },
  {
    kind: "judge_calibration",
    filename: "judge-calibration-eval.json",
    required: true,
  },
  {
    kind: "locale_calibration",
    filename: "locale-calibration-curves.json",
    required: true,
  },
  {
    kind: "inter_rater_agreement",
    filename: "inter-rater-agreement.json",
    required: true,
  },
  {
    kind: "drift_baseline",
    filename: "distribution-shift-report.json",
    required: true,
  },
  {
    kind: "incident_log",
    filename: "incidents.json",
    required: true,
  },
  {
    kind: "subprocessor_register",
    filename: "subprocessor-register.json",
    required: true,
  },
  {
    kind: "finops_budget",
    filename: "finops/budget-report.json",
    required: true,
  },
  {
    kind: "faithfulness_tier",
    filename: "faithfulness-tier-report.json",
    required: true,
  },
  {
    kind: "self_consistency",
    filename: "self-consistency-arbitration.json",
    required: true,
  },
  {
    kind: "evidence_seal",
    filename: "production-runner-evidence-seal.json",
    required: true,
  },
] as const;

const REGULATOR_COVERAGE: readonly AuditDossierRegulationCoverageEntry[] = [
  {
    regulation: "BaFin / Bundesbank",
    requirement: "Operational quality reconstruction for one run",
    artifactKinds: [
      "model_card",
      "provenance",
      "compliance_coverage",
      "judge_calibration",
      "inter_rater_agreement",
      "evidence_seal",
    ],
    notes: [
      "Ties quality, provenance, and reviewer controls to a single attested run.",
    ],
  },
  {
    regulation: "EIOPA",
    requirement: "Insurance-grade auditability and oversight evidence",
    artifactKinds: [
      "model_card",
      "compliance_annotations",
      "faithfulness_tier",
      "incident_log",
      "self_consistency",
    ],
    notes: [
      "Bundles insurer-relevant oversight, annotation, and incident evidence.",
    ],
  },
  {
    regulation: "EBA",
    requirement: "Banking model-risk and governance evidence",
    artifactKinds: [
      "model_card",
      "judge_calibration",
      "locale_calibration",
      "inter_rater_agreement",
      "drift_baseline",
    ],
    notes: [
      "Supports model governance with calibration, locale, and drift controls.",
    ],
  },
  {
    regulation: "DORA Art. 10",
    requirement: "ICT incident logging and run-level traceability",
    artifactKinds: ["incident_log", "provenance", "evidence_seal"],
    notes: ["Incident register, provenance, and evidence seal cover tamper-evident logging."],
  },
  {
    regulation: "DORA Art. 28",
    requirement: "Third-party ICT service provider record and FinOps evidence",
    artifactKinds: ["subprocessor_register", "finops_budget", "model_card"],
    notes: ["Subprocessor register and FinOps budget show provider and cost accountability."],
  },
  {
    regulation: "EU AI Act Art. 12",
    requirement: "Record-keeping and reproducibility for one run",
    artifactKinds: ["provenance", "evidence_seal", "self_consistency"],
    notes: ["Merkle-sealed provenance plus reproducible voting metadata support record-keeping."],
  },
  {
    regulation: "EU AI Act Art. 13",
    requirement: "Transparency package for the deployed model bundle",
    artifactKinds: ["model_card", "judge_calibration", "locale_calibration"],
    notes: ["Model card and calibration artifacts provide the transparency core."],
  },
  {
    regulation: "EU AI Act Art. 14",
    requirement: "Human-oversight and review-quality controls",
    artifactKinds: [
      "inter_rater_agreement",
      "faithfulness_tier",
      "incident_log",
      "self_consistency",
    ],
    notes: ["Oversight coverage combines inter-rater protocol, faithfulness, incidents, and arbitration."],
  },
  {
    regulation: "GDPR Ch. V",
    requirement: "Cross-border transfer and subprocessor visibility",
    artifactKinds: ["subprocessor_register", "model_card", "finops_budget"],
    notes: ["Subprocessor register and model card expose provider geography and hosting scope."],
  },
] as const;

interface ResolvedArtifact {
  readonly kind: AuditDossierManifestArtifactKind;
  readonly filename: string;
  readonly absolutePath: string;
  readonly bytes: Uint8Array;
  readonly json: Record<string, unknown>;
  readonly sha256: string;
}

interface GenerateAuditDossierInput {
  readonly runDir: string;
  readonly outputDir: string;
  readonly signKeyPath: string;
  readonly gitSha: string;
  readonly benchmarkProtocolVersion: string;
  readonly harnessVersion: string;
  readonly ictRegisterRef?: string;
}

export interface GenerateAuditDossierResult {
  readonly runId: string;
  readonly outputPrefix: string;
  readonly manifestPath: string;
  readonly signaturePath: string;
  readonly pdfPath: string;
  readonly merkleProofPath: string;
  readonly manifest: AuditDossierManifest;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const sha256Hex = (value: Uint8Array | string): string =>
  createHash("sha256").update(value).digest("hex");

const readJsonFile = async (
  path: string,
): Promise<Record<string, unknown>> => {
  const raw = await readFile(path);
  const parsed = JSON.parse(raw.toString("utf8")) as unknown;
  if (!isRecord(parsed)) {
    throw new Error(`${basename(path)} must contain a JSON object.`);
  }
  return parsed;
};

const resolveRepoRoot = (): string =>
  resolve(fileURLToPath(new URL("../..", import.meta.url)));

const resolvePackageVersion = async (): Promise<string> => {
  const packageJson = JSON.parse(
    await readFile(join(resolveRepoRoot(), "package.json"), "utf8"),
  ) as { version?: unknown };
  return typeof packageJson.version === "string" ? packageJson.version : "unknown";
};

const writeAtomicBytes = async (
  path: string,
  bytes: Uint8Array,
): Promise<void> => {
  const { dirname } = await import("node:path");
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = `${path}.${process.pid}.tmp`;
  await writeFile(temporaryPath, bytes);
  await rename(temporaryPath, path);
};

const writeAtomicText = async (path: string, value: string): Promise<void> =>
  writeAtomicBytes(path, new TextEncoder().encode(value));

const requireFile = async (path: string, label: string): Promise<void> => {
  try {
    await stat(path);
  } catch (error) {
    throw new Error(`${label} is missing at ${path}`);
  }
};

const resolveModelCardArtifact = async (runDir: string): Promise<ResolvedArtifact> => {
  const candidates = (await readDirNames(runDir))
    .filter((entry) => entry.endsWith(MODEL_CARD_SUFFIX))
    .sort((left, right) => left.localeCompare(right));
  if (candidates.length !== 1) {
    throw new Error(
      `Run directory must contain exactly one ${MODEL_CARD_SUFFIX} artifact; found ${candidates.length}.`,
    );
  }
  return resolveArtifact(runDir, "model_card", candidates[0]!);
};

const readDirNames = async (path: string): Promise<string[]> => {
  const { readdir } = await import("node:fs/promises");
  return readdir(path);
};

const resolveArtifact = async (
  runDir: string,
  kind: AuditDossierManifestArtifactKind,
  filename: string,
): Promise<ResolvedArtifact> => {
  const absolutePath = join(runDir, filename);
  await requireFile(absolutePath, filename);
  const bytes = await readFile(absolutePath);
  const parsed = JSON.parse(bytes.toString("utf8")) as unknown;
  if (!isRecord(parsed)) {
    throw new Error(`${filename} must contain a JSON object.`);
  }
  return {
    kind,
    filename,
    absolutePath,
    bytes,
    json: parsed,
    sha256: sha256Hex(bytes),
  };
};

const provenanceLeafHash = (node: Record<string, unknown>): string => {
  const sanitized = { ...node };
  delete sanitized["ti:leafHash"];
  return sha256Hex(canonicalJson(sanitized));
};

const buildMerkleLevels = (
  leaves: readonly { reference: string; hash: string }[],
): string[][] => {
  const sorted = [...leaves]
    .sort((left, right) => left.hash.localeCompare(right.hash))
    .map((entry) => entry.hash);
  const levels: string[][] = [sorted];
  let level = sorted;
  while (level.length > 1) {
    const nextLevel: string[] = [];
    for (let index = 0; index < level.length; index += 2) {
      const left = level[index]!;
      const right = level[index + 1] ?? left;
      nextLevel.push(sha256Hex(`${left}:${right}`));
    }
    levels.push(nextLevel);
    level = nextLevel;
  }
  return levels;
};

const computeMerkleRoot = (
  leaves: readonly { reference: string; hash: string }[],
): string => {
  const levels = buildMerkleLevels(leaves);
  const root = levels.at(-1)?.[0];
  if (!root) {
    throw new Error("Provenance Merkle root cannot be reconstructed.");
  }
  return root;
};

const buildMerkleProofText = (
  manifestLeaves: readonly { reference: string; hash: string }[],
  merkleRoot: string,
): string => {
  const sortedLeaves = [...manifestLeaves].sort((left, right) =>
    left.hash.localeCompare(right.hash),
  );
  const levels = buildMerkleLevels(sortedLeaves);
  const lines = [
    "Audit Dossier Merkle Proof",
    `Root: ${merkleRoot}`,
    `Leaf count: ${sortedLeaves.length}`,
    "",
    "Level 0 — canonical leaf hashes",
    ...sortedLeaves.map(
      (leaf, index) => `${index + 1}. ${leaf.hash}  ${leaf.reference}`,
    ),
    "",
  ];
  for (let index = 1; index < levels.length; index += 1) {
    lines.push(`Level ${index}`);
    lines.push(
      ...levels[index]!.map((hash, offset) => `${offset + 1}. ${hash}`),
    );
    lines.push("");
  }
  return `${lines.join("\n").trimEnd()}\n`;
};

const coerceString = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim().length > 0 ? value : undefined;

const countArray = (value: unknown): number =>
  Array.isArray(value) ? value.length : 0;

const countObjectKeys = (value: unknown): number =>
  isRecord(value) ? Object.keys(value).length : 0;

const summarizeArtifacts = (
  artifacts: ReadonlyMap<AuditDossierManifestArtifactKind, ResolvedArtifact>,
  modelCard: ResolvedArtifact,
  input: GenerateAuditDossierInput,
  runId: string,
  provenanceRoot: string,
  leafHashes: readonly { reference: string; hash: string }[],
  merkleProofSha256: string,
): AuditDossierManifest["summary"] => {
  const policy = artifacts.get("policy_report")?.json;
  const complianceCoverage = artifacts.get("compliance_coverage")!.json;
  const complianceAnnotations = artifacts.get("compliance_annotations")!.json;
  const judgeCalibration = artifacts.get("judge_calibration")!.json;
  const localeCalibration = artifacts.get("locale_calibration")!.json;
  const interRater = artifacts.get("inter_rater_agreement")!.json;
  const drift = artifacts.get("drift_baseline")!.json;
  const incidents = artifacts.get("incident_log")!.json;
  const subprocessors = artifacts.get("subprocessor_register")!.json;
  const faithfulness = artifacts.get("faithfulness_tier")!.json;
  const selfConsistency = artifacts.get("self_consistency")!.json;
  const modelCardJson = modelCard.json;

  const modelCardRefs = Array.isArray(modelCardJson["deployments"])
    ? (modelCardJson["deployments"] as unknown[])
        .filter((entry): entry is Record<string, unknown> => isRecord(entry))
        .map((entry) => coerceString(entry["ictRegisterRef"]))
        .filter((entry): entry is string => entry !== undefined)
    : [];
  const ictRegisterRefs = [...new Set([
    ...modelCardRefs,
    ...(input.ictRegisterRef ? [input.ictRegisterRef] : []),
  ])].sort((left, right) => left.localeCompare(right));

  return {
    harnessVersion: input.harnessVersion,
    gitSha: input.gitSha,
    benchmarkProtocolVersion: input.benchmarkProtocolVersion,
    ictRegisterRefs:
      ictRegisterRefs.length > 0 ? ictRegisterRefs : ["unspecified"],
    policyProfileId: coerceString(policy?.["policyProfileId"]) ?? "unknown",
    modelCardId: coerceString(modelCardJson["cardId"]) ?? "unknown",
    complianceFrameworkCount:
      countObjectKeys(complianceCoverage["coverageByFramework"]) ||
      countArray(complianceCoverage["frameworks"]) ||
      countArray(complianceCoverage["coverage"]),
    complianceAnnotationCount:
      countArray(complianceAnnotations["annotations"]) ||
      countArray(complianceAnnotations["entries"]),
    calibrationSampleCount:
      countArray(judgeCalibration["samples"]) ||
      countArray(judgeCalibration["calibrationCurves"]),
    localeCurveCount:
      countObjectKeys(localeCalibration["localeCurves"]) ||
      countArray(localeCalibration["curves"]),
    interRaterFailureCount:
      countArray(interRater["failures"]) || countArray(interRater["warnings"]),
    driftFindingCount: countArray(drift["findings"]),
    incidentCount:
      countArray(incidents["incidents"]) ||
      countArray(incidents["events"]) ||
      countArray(incidents["reports"]),
    subprocessorCount:
      countArray(subprocessors["subprocessors"]) ||
      countArray(subprocessors["entries"]),
    faithfulnessMismatchCount:
      countArray(faithfulness["mismatches"]) ||
      countArray(faithfulness["partialMajorityCaseIds"]),
    selfConsistencyTargetCount:
      countArray(selfConsistency["targets"]) ||
      countArray(selfConsistency["entries"]),
    provenanceRoot,
    provenanceLeafCount: leafHashes.length,
    merkleProofSha256,
    runId,
  };
};

const buildSourceArtifacts = (
  artifacts: readonly ResolvedArtifact[],
): AuditDossierManifestArtifactRef[] =>
  [...artifacts]
    .sort((left, right) => left.filename.localeCompare(right.filename))
    .map((artifact) => ({
      kind: artifact.kind,
      filename: artifact.filename,
      sha256: artifact.sha256,
      bytes: artifact.bytes.byteLength,
    }));

const parseEd25519PrivateKey = async (
  signKeyPath: string,
): Promise<{
  privateKey: KeyObject;
  publicKeyPem: string;
  keyFingerprintSha256: string;
}> => {
  const serializedKey = await readFile(signKeyPath, "utf8");
  const trimmedKey = serializedKey.trim();
  const privateKey = trimmedKey.startsWith("{")
    ? createPrivateKey({
        key: JSON.parse(trimmedKey) as unknown as Record<string, string>,
        format: "jwk",
      })
    : createPrivateKey({ key: serializedKey, format: "pem" });
  if (privateKey.asymmetricKeyType !== "ed25519") {
    throw new Error("Audit dossier signing key must be an Ed25519 private key.");
  }
  const publicKey = createPublicKey(privateKey);
  const publicKeyPem = publicKey.export({ format: "pem", type: "spki" }).trim();
  const spkiDer = publicKey.export({ format: "der", type: "spki" }) as Buffer;
  return {
    privateKey,
    publicKeyPem,
    keyFingerprintSha256: sha256Hex(
      new Uint8Array(spkiDer.buffer, spkiDer.byteOffset, spkiDer.byteLength),
    ),
  };
};

const resolveRunId = (
  provenance: Record<string, unknown>,
  policy: Record<string, unknown> | undefined,
): string => {
  const jobId =
    coerceString(provenance["ti:jobId"]) ?? coerceString(policy?.["jobId"]);
  if (!jobId) {
    throw new Error(
      "Run directory is missing a stable run id in provenance.jsonld or policy-report.json.",
    );
  }
  return jobId;
};

const resolveGeneratedAt = (
  provenance: Record<string, unknown>,
  policy: Record<string, unknown> | undefined,
): string => {
  return (
    coerceString(provenance["ti:generatedAt"]) ??
    coerceString(policy?.["generatedAt"]) ??
    "1970-01-01T00:00:00.000Z"
  );
};

const resolveGitSha = async (): Promise<string> => {
  try {
    const head = (await readFile(join(resolveRepoRoot(), ".git", "HEAD"), "utf8")).trim();
    if (head.startsWith("ref: ")) {
      const ref = head.slice(5).trim();
      return (await readFile(join(resolveRepoRoot(), ".git", ref), "utf8")).trim();
    }
    return head;
  } catch {
    return "unknown";
  }
};

const resolveBenchmarkProtocolVersion = async (): Promise<string> => {
  const path = join(resolveRepoRoot(), DEFAULT_BENCHMARK_PROTOCOL_PATH);
  const bytes = await readFile(path);
  return `${DEFAULT_BENCHMARK_PROTOCOL_PATH}@${sha256Hex(bytes).slice(0, 12)}`;
};

export const resolveAuditDossierDefaults = async (): Promise<{
  gitSha: string;
  benchmarkProtocolVersion: string;
  harnessVersion: string;
}> => ({
  gitSha: await resolveGitSha(),
  benchmarkProtocolVersion: await resolveBenchmarkProtocolVersion(),
  harnessVersion: await resolvePackageVersion(),
});

export const generateAuditDossier = async (
  input: GenerateAuditDossierInput,
): Promise<GenerateAuditDossierResult> => {
  const runDir = resolve(input.runDir);
  const outputDir = resolve(input.outputDir);
  const policyReportPath = join(runDir, POLICY_REPORT_FILENAME);
  const policyReport = await stat(policyReportPath)
    .then(() => readJsonFile(policyReportPath))
    .catch(() => undefined);

  const modelCard = await resolveModelCardArtifact(runDir);
  const resolvedArtifacts = new Map<AuditDossierManifestArtifactKind, ResolvedArtifact>();
  resolvedArtifacts.set(modelCard.kind, modelCard);
  for (const artifact of REQUIRED_ARTIFACTS) {
    resolvedArtifacts.set(
      artifact.kind,
      await resolveArtifact(runDir, artifact.kind, artifact.filename),
    );
  }
  if (policyReport !== undefined) {
    resolvedArtifacts.set("policy_report", {
      kind: "policy_report",
      filename: POLICY_REPORT_FILENAME,
      absolutePath: policyReportPath,
      bytes: await readFile(policyReportPath),
      json: policyReport,
      sha256: sha256Hex(await readFile(policyReportPath)),
    });
  }

  const provenanceArtifact = resolvedArtifacts.get("provenance")!;
  const provenance = provenanceArtifact.json as unknown as ProvenanceDocument &
    Record<string, unknown>;
  const rawGraph = Array.isArray(provenance["@graph"]) ? provenance["@graph"] : [];
  const graph = Array.isArray(rawGraph)
    ? rawGraph.filter((node: unknown): node is Record<string, unknown> => isRecord(node))
    : [];
  if (graph.length === 0) {
    throw new Error("Provenance graph contains no attested nodes.");
  }
  const leafHashes = graph.map((node: Record<string, unknown>) => ({
    reference:
      coerceString(node["ti:artifactPath"]) ??
      coerceString(node["@id"]) ??
      "graph-node",
    hash: provenanceLeafHash(node),
  }));
  const expectedSeal = isRecord(provenance["ti:merkleSeal"])
    ? provenance["ti:merkleSeal"]
    : undefined;
  const provenanceRoot = coerceString(expectedSeal?.["root"]);
  if (!provenanceRoot) {
    throw new Error("Provenance Merkle root cannot be reconstructed.");
  }
  const runId = resolveRunId(provenance, policyReport);
  const outputPrefix = join(outputDir, `${runId}-${AUDIT_DOSSIER_ARTIFACT_BASENAME}`);
  const manifestFilename = `${runId}-${AUDIT_DOSSIER_ARTIFACT_BASENAME}.json`;
  const signatureFilename = `${runId}-${AUDIT_DOSSIER_ARTIFACT_BASENAME}.sig`;
  const pdfFilename = `${runId}-${AUDIT_DOSSIER_ARTIFACT_BASENAME}.pdf`;
  const merkleProofFilename = `${runId}-${AUDIT_DOSSIER_ARTIFACT_BASENAME}.merkle.txt`;
  const generatedAt = resolveGeneratedAt(provenance, policyReport);
  const computedProvenanceRoot = computeMerkleRoot(leafHashes);
  if (computedProvenanceRoot !== provenanceRoot) {
    throw new Error(
      `Provenance Merkle root mismatch: declared ${provenanceRoot} but computed ${computedProvenanceRoot}.`,
    );
  }
  const proofText = buildMerkleProofText(leafHashes, provenanceRoot);
  const proofSha256 = sha256Hex(proofText);

  const signingMaterial = await parseEd25519PrivateKey(input.signKeyPath);
  const manifestSkeleton = {
    schemaVersion: AUDIT_DOSSIER_MANIFEST_SCHEMA_VERSION,
    contractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
    generatedAt,
    runId,
    bundle: {
      jsonFilename: manifestFilename,
      signatureFilename,
      pdfFilename,
      merkleProofFilename,
      pdfSha256: "",
    },
    signing: {
      algorithm: "ed25519" as const,
      keyFingerprintSha256: signingMaterial.keyFingerprintSha256,
      publicKeyPem: signingMaterial.publicKeyPem,
      manifestSha256: "",
    },
    provenance: {
      algorithm:
        coerceString(expectedSeal?.["algorithm"]) ?? "sha256_merkle_v1",
      merkleRoot: provenanceRoot,
      leafCount: leafHashes.length,
      leafHashes,
      merkleProofSha256: proofSha256,
    },
    sourceArtifacts: buildSourceArtifacts([...resolvedArtifacts.values()]),
    regulatorCoverage: REGULATOR_COVERAGE,
    summary: summarizeArtifacts(
      resolvedArtifacts,
      modelCard,
      input,
      runId,
      provenanceRoot,
      leafHashes,
      proofSha256,
    ),
  } satisfies Omit<AuditDossierManifest, "signing"> & {
    signing: Omit<AuditDossierManifest["signing"], "manifestSha256"> & {
      manifestSha256: string;
    };
  };

  const provisionalPdfBytes = renderAuditDossierPdf({
    manifest: manifestSkeleton as unknown as AuditDossierManifest,
  });
  const pdfSha256 = sha256Hex(provisionalPdfBytes);

  const unsignedManifestBytes = canonicalJson({
    ...manifestSkeleton,
    bundle: { ...manifestSkeleton.bundle, pdfSha256 },
    signing: { ...manifestSkeleton.signing, manifestSha256: "" },
  });
  const manifestSha256 = sha256Hex(unsignedManifestBytes);
  const manifest: AuditDossierManifest = {
    ...manifestSkeleton,
    bundle: { ...manifestSkeleton.bundle, pdfSha256 },
    signing: {
      ...manifestSkeleton.signing,
      manifestSha256,
    },
  };
  const manifestBytes = canonicalJson(manifest);
  const signatureBytes = cryptoSign(null, Buffer.from(manifestBytes), signingMaterial.privateKey);
  const signature: AuditDossierSignature = {
    schemaVersion: AUDIT_DOSSIER_SIGNATURE_SCHEMA_VERSION,
    algorithm: "ed25519",
    keyFingerprintSha256: signingMaterial.keyFingerprintSha256,
    publicKeyPem: signingMaterial.publicKeyPem,
    manifestSha256,
    signatureBase64: Buffer.from(signatureBytes).toString("base64"),
  };
  const pdfBytes = renderAuditDossierPdf({ manifest });

  await mkdir(outputDir, { recursive: true });
  const manifestPath = `${outputPrefix}.json`;
  const signaturePath = `${outputPrefix}.sig`;
  const pdfPath = `${outputPrefix}.pdf`;
  const merkleProofPath = `${outputPrefix}.merkle.txt`;
  await writeAtomicText(manifestPath, manifestBytes);
  await writeAtomicText(signaturePath, canonicalJson(signature));
  await writeAtomicBytes(pdfPath, pdfBytes);
  await writeAtomicText(merkleProofPath, proofText);

  return {
    runId,
    outputPrefix,
    manifestPath,
    signaturePath,
    pdfPath,
    merkleProofPath,
    manifest,
  };
};
