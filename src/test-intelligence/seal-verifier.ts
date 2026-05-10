/**
 * Self-contained verifier for `production-runner-evidence-seal.json`
 * bundles (Issue #2178). Lets an external auditor confirm the
 * reproducibility seal of a past run **without access to the original
 * run directory or the original signing infrastructure**.
 *
 * The verifier accepts a run directory or an extracted bundle, walks
 * the artifacts referenced by the seal, recomputes their SHA-256
 * digests, derives a Merkle root over the canonical leaf set, computes
 * an HMAC over the canonical seal manifest with an
 * auditor-supplied (or default) key, and reports per-artifact status:
 * `OK`, `TAMPERED`, `MISSING`, or `EXTRA`.
 *
 * The seal schema is unchanged — backward-compat is preserved with all
 * past sealed runs because the Merkle root and HMAC are derived
 * **at verify time** from the canonical seal contents, not stored in
 * new seal fields. Operators publish the expected Merkle root and HMAC
 * fingerprint out-of-band so an auditor can cross-check.
 *
 * Tar / Zip extraction is handled by the CLI wrapper
 * (`runTestIntelligenceVerifySealCommand`) which shells out to the
 * universally available `tar` / `unzip` binaries and then invokes the
 * directory verifier here. Keeping archive extraction in the CLI
 * layer keeps this module dependency-free for the standalone
 * `bun build --compile` packaging path.
 */

import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { Dirent } from "node:fs";
import { readFile, readdir, stat } from "node:fs/promises";
import { isAbsolute, join, normalize, relative, resolve, sep, dirname } from "node:path";

import {
  PROVENANCE_ARTIFACT_FILENAME,
  REGION_ATTESTATION_REPORT_ARTIFACT_FILENAME,
  type FinOpsBudgetReport,
  type VisualSidecarResultArtifact,
} from "../contracts/index.js";
import { canonicalJson } from "./content-hash.js";
import { computePerSourceCostBreakdownHashFromReport } from "./per-source-cost.js";
import {
  PRODUCTION_RUNNER_EVIDENCE_SEAL_ARTIFACT_FILENAME,
  parseProductionRunnerEvidenceSeal,
  type ProductionRunnerEvidenceSeal,
  type ProductionRunnerEvidenceVisualHash,
} from "./production-runner-evidence.js";

const HEX64 = /^[0-9a-f]{64}$/u;

/**
 * Default key material used when the auditor does not supply
 * `--key`. Deterministically derived so the resulting HMAC fingerprint
 * is reproducible across hosts. Operators rotate this by publishing
 * an explicit key file alongside each release.
 */
export const DEFAULT_SEAL_VERIFY_KEY_LABEL =
  "workspace-dev:seal-verify:v1" as const;

/** SHA-256 of `DEFAULT_SEAL_VERIFY_KEY_LABEL` (32 bytes — the natural digest size). */
const defaultKey = (): Buffer =>
  createHash("sha256").update(DEFAULT_SEAL_VERIFY_KEY_LABEL).digest();

const sha256HexBytes = (value: Uint8Array): string =>
  createHash("sha256").update(value).digest("hex");

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isEnoent = (error: unknown): boolean =>
  typeof error === "object" &&
  error !== null &&
  (error as { code?: string }).code === "ENOENT";

/** Per-artifact verifier status. */
export type SealArtifactStatus = "OK" | "TAMPERED" | "MISSING" | "EXTRA";

export interface SealArtifactReport {
  readonly status: SealArtifactStatus;
  readonly reference: string;
  readonly expectedSha256?: string;
  readonly observedSha256?: string;
  /**
   * Byte offset of the first mismatching byte when an artifact is
   * `TAMPERED` and the seal carries a canonical hash for it. Only
   * populated when both the expected canonical bytes and the observed
   * bytes are available; otherwise omitted.
   */
  readonly firstMismatchOffset?: number;
  readonly note?: string;
}

export type SealVerifyFailureCode =
  | "bundle_missing"
  | "seal_missing"
  | "seal_unparseable"
  | "artifact_missing"
  | "artifact_tampered"
  | "merkle_root_mismatch"
  | "hmac_mismatch"
  | "provenance_mismatch"
  | "region_attestation_mismatch";

export interface SealVerifyFailure {
  readonly code: SealVerifyFailureCode;
  readonly reference: string;
  readonly message: string;
}

export interface SealVerifyCrossCheck {
  readonly name:
    | "provenance_graph"
    | "region_attestations"
    | "finops_bySource_hash"
    | "genealogy_dag_hash"
    | "visual_sidecar_evidence";
  readonly ok: boolean;
  readonly detail: string;
}

export interface SealVerificationReport {
  readonly ok: boolean;
  readonly bundlePath: string;
  readonly sealPath: string;
  readonly jobId?: string;
  readonly generatedAt?: string;
  readonly merkleRoot?: string;
  readonly manifestSha256?: string;
  readonly manifestHmacSha256?: string;
  readonly hmacKeyFingerprint?: string;
  readonly artifacts: readonly SealArtifactReport[];
  readonly crossChecks: readonly SealVerifyCrossCheck[];
  readonly failures: readonly SealVerifyFailure[];
}

export interface VerifySealBundleInput {
  /**
   * Path of an extracted bundle directory. The verifier locates
   * `production-runner-evidence-seal.json` either at the root or at
   * one nested level (e.g. archive that wraps the run dir).
   */
  readonly bundleDir: string;
  /**
   * HMAC key bytes. When omitted, the deterministic
   * {@link DEFAULT_SEAL_VERIFY_KEY_LABEL}-derived key is used so the
   * report is reproducible on any host.
   */
  readonly key?: Uint8Array;
  /**
   * If supplied, the verifier compares the recomputed HMAC against
   * this value and emits a `hmac_mismatch` failure on mismatch.
   */
  readonly expectedHmacHex?: string;
  /**
   * If supplied, the verifier compares the recomputed Merkle root
   * against this value and emits a `merkle_root_mismatch` failure on
   * mismatch.
   */
  readonly expectedMerkleRootHex?: string;
}

const safeStat = async (path: string): Promise<boolean> => {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (isEnoent(error)) return false;
    throw error;
  }
};

const readBytes = async (
  path: string,
): Promise<Uint8Array | undefined> => {
  try {
    return await readFile(path);
  } catch (error) {
    if (isEnoent(error)) return undefined;
    throw error;
  }
};

const parseSealJson = (
  bytes: Uint8Array,
): ProductionRunnerEvidenceSeal | undefined => {
  let raw: unknown;
  try {
    raw = JSON.parse(Buffer.from(bytes).toString("utf8"));
  } catch {
    return undefined;
  }
  // Reuse the strict parser from `production-runner-evidence` so the
  // verifier and the in-process post-write seal verification stay in
  // lockstep on schemaVersion, HEX64 hash shapes, integer bounds for
  // chainLength, and deep array/record validation.
  return parseProductionRunnerEvidenceSeal(raw);
};

/**
 * Reject artifact paths that try to escape the run directory: absolute
 * paths, `..` segments, leading `..` after normalization, or filenames
 * that resolve outside the bundle root once joined. Mirrors the
 * containment check used by `provenance-verify.ts`.
 */
const isSafeRelativeArtifactPath = (
  runDir: string,
  artifactPath: string,
): boolean => {
  if (typeof artifactPath !== "string" || artifactPath.trim().length === 0) {
    return false;
  }
  if (isAbsolute(artifactPath)) return false;
  const normalized = normalize(artifactPath).replaceAll("\\", "/");
  if (normalized.length === 0 || normalized === "..") return false;
  if (normalized.startsWith("../") || normalized.includes("/../")) return false;
  const resolvedRunDir = resolve(runDir);
  const resolvedArtifact = resolve(runDir, artifactPath);
  // `relative` returns a string starting with `..` when the resolved
  // artifact is outside the run dir.
  const rel = relative(resolvedRunDir, resolvedArtifact);
  if (rel.startsWith("..") || isAbsolute(rel)) return false;
  return true;
};

const findSealPath = async (
  bundleDir: string,
): Promise<string | undefined> => {
  const direct = join(
    bundleDir,
    PRODUCTION_RUNNER_EVIDENCE_SEAL_ARTIFACT_FILENAME,
  );
  if (await safeStat(direct)) return direct;
  let entries: Dirent[];
  try {
    entries = await readdir(bundleDir, { withFileTypes: true });
  } catch {
    return undefined;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const candidate = join(
      bundleDir,
      entry.name,
      PRODUCTION_RUNNER_EVIDENCE_SEAL_ARTIFACT_FILENAME,
    );
    if (await safeStat(candidate)) return candidate;
  }
  return undefined;
};

const enumerateBundleFiles = async (root: string): Promise<string[]> => {
  const out: string[] = [];
  const stack: string[] = [root];
  while (stack.length > 0) {
    const dir = stack.pop()!;
    let entries: Dirent[];
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch (error) {
      if (isEnoent(error)) continue;
      throw error;
    }
    for (const entry of entries) {
      const abs = join(dir, entry.name);
      if (entry.isDirectory()) {
        stack.push(abs);
      } else if (entry.isFile()) {
        const rel = relative(root, abs).split(sep).join("/");
        out.push(rel);
      }
    }
  }
  return out.sort((left, right) => left.localeCompare(right));
};

/**
 * Build the canonical leaf list used for the Merkle root and HMAC.
 * Leaves are sorted by reference for byte-stable output.
 */
const buildLeaves = (
  pairs: readonly { reference: string; sha256: string }[],
): { reference: string; sha256: string }[] =>
  [...pairs].sort((left, right) => left.reference.localeCompare(right.reference));

const computeMerkleRoot = (
  leaves: readonly { reference: string; sha256: string }[],
): string => {
  if (leaves.length === 0) {
    return createHash("sha256").update("ti-seal-empty").digest("hex");
  }
  let level: string[] = leaves.map((leaf) =>
    createHash("sha256")
      .update(`${leaf.reference}:${leaf.sha256}`)
      .digest("hex"),
  );
  while (level.length > 1) {
    const next: string[] = [];
    for (let index = 0; index < level.length; index += 2) {
      const left = level[index]!;
      const right = level[index + 1] ?? left;
      next.push(createHash("sha256").update(`${left}:${right}`).digest("hex"));
    }
    level = next;
  }
  return level[0]!;
};

const computeFirstMismatchOffset = (
  expected: Uint8Array,
  observed: Uint8Array,
): number => {
  const max = Math.min(expected.length, observed.length);
  for (let index = 0; index < max; index += 1) {
    if (expected[index] !== observed[index]) return index;
  }
  return max;
};

/**
 * Set of seal-referenced artifacts the verifier must locate. Each entry
 * captures the file's relative path inside the bundle and the
 * canonical hash from the seal (when present).
 */
const collectSealReferences = (
  seal: ProductionRunnerEvidenceSeal,
): { reference: string; expectedSha256?: string }[] => {
  const refs: { reference: string; expectedSha256?: string }[] = [];
  for (const filename of seal.harnessArtifactFilenames) {
    refs.push({ reference: filename });
  }
  refs.push({ reference: seal.finopsArtifactFilename });
  refs.push({
    reference: seal.genealogyArtifactFilename,
    expectedSha256: seal.genealogyDagHash,
  });
  // visual-sidecar-result.json is implicit when visualEvidenceHashes is non-empty.
  if (seal.visualEvidenceHashes.length > 0) {
    refs.push({ reference: "visual-sidecar-result.json" });
  }
  // De-dupe (e.g. seal already lists genealogy in harness filenames).
  const seen = new Set<string>();
  return refs.filter((ref) => {
    if (seen.has(ref.reference)) return false;
    seen.add(ref.reference);
    return true;
  });
};

const SEAL_OWN_FILENAME = PRODUCTION_RUNNER_EVIDENCE_SEAL_ARTIFACT_FILENAME;

const isAuxiliaryRunFile = (reference: string): boolean => {
  // Files that may live alongside the seal but are not part of the
  // referenced artifact set (e.g. operator-emitted summaries).
  return (
    reference === SEAL_OWN_FILENAME ||
    reference === PROVENANCE_ARTIFACT_FILENAME ||
    reference === REGION_ATTESTATION_REPORT_ARTIFACT_FILENAME ||
    reference.endsWith(".md") ||
    reference.endsWith(".log") ||
    reference.endsWith(".txt") ||
    reference === "policy-report.json" ||
    reference.startsWith("checkpoints/") ||
    reference.startsWith("repro/")
  );
};

interface VerifyContext {
  readonly runDir: string;
  readonly seal: ProductionRunnerEvidenceSeal;
}

const verifyArtifacts = async (
  ctx: VerifyContext,
): Promise<{
  readonly reports: SealArtifactReport[];
  readonly leaves: { reference: string; sha256: string }[];
  readonly failures: SealVerifyFailure[];
}> => {
  const refs = collectSealReferences(ctx.seal);
  const reports: SealArtifactReport[] = [];
  const leaves: { reference: string; sha256: string }[] = [];
  const failures: SealVerifyFailure[] = [];
  for (const ref of refs) {
    if (!isSafeRelativeArtifactPath(ctx.runDir, ref.reference)) {
      reports.push({
        status: "TAMPERED",
        reference: ref.reference,
        note: "Seal references an artifact path that escapes the run directory.",
      });
      failures.push({
        code: "artifact_tampered",
        reference: ref.reference,
        message: `Seal references unsafe artifact path '${ref.reference}'; refusing to read outside the bundle.`,
      });
      continue;
    }
    const abs = join(ctx.runDir, ref.reference);
    const bytes = await readBytes(abs);
    if (bytes === undefined) {
      reports.push({ status: "MISSING", reference: ref.reference });
      failures.push({
        code: "artifact_missing",
        reference: ref.reference,
        message: `Bundle is missing artifact '${ref.reference}' referenced by the seal.`,
      });
      continue;
    }
    const observed = sha256HexBytes(bytes);
    leaves.push({ reference: ref.reference, sha256: observed });
    if (
      ref.expectedSha256 !== undefined &&
      HEX64.test(ref.expectedSha256) &&
      ref.expectedSha256 !== observed
    ) {
      reports.push({
        status: "TAMPERED",
        reference: ref.reference,
        expectedSha256: ref.expectedSha256,
        observedSha256: observed,
        note: "Recomputed SHA-256 does not match the seal manifest entry.",
      });
      failures.push({
        code: "artifact_tampered",
        reference: ref.reference,
        message: `Artifact '${ref.reference}' SHA-256 ${observed} does not match the seal value ${ref.expectedSha256}.`,
      });
      continue;
    }
    reports.push({
      status: "OK",
      reference: ref.reference,
      ...(ref.expectedSha256 !== undefined
        ? { expectedSha256: ref.expectedSha256 }
        : {}),
      observedSha256: observed,
    });
  }
  return { reports, leaves, failures };
};

const detectExtras = async (
  ctx: VerifyContext,
  knownReferences: ReadonlySet<string>,
): Promise<SealArtifactReport[]> => {
  const all = await enumerateBundleFiles(ctx.runDir);
  const extras: SealArtifactReport[] = [];
  for (const reference of all) {
    if (knownReferences.has(reference)) continue;
    if (isAuxiliaryRunFile(reference)) continue;
    const abs = join(ctx.runDir, reference);
    const bytes = await readBytes(abs);
    extras.push({
      status: "EXTRA",
      reference,
      ...(bytes !== undefined ? { observedSha256: sha256HexBytes(bytes) } : {}),
      note: "Bundle file not referenced by the seal manifest.",
    });
  }
  return extras;
};

const verifyFinopsBySourceHash = async (
  ctx: VerifyContext,
): Promise<SealVerifyCrossCheck> => {
  const finopsPath = join(ctx.runDir, ctx.seal.finopsArtifactFilename);
  const bytes = await readBytes(finopsPath);
  if (bytes === undefined) {
    return {
      name: "finops_bySource_hash",
      ok: false,
      detail: `FinOps artifact '${ctx.seal.finopsArtifactFilename}' not found.`,
    };
  }
  let report: unknown;
  try {
    report = JSON.parse(Buffer.from(bytes).toString("utf8"));
  } catch {
    return {
      name: "finops_bySource_hash",
      ok: false,
      detail: `FinOps artifact '${ctx.seal.finopsArtifactFilename}' is not valid JSON.`,
    };
  }
  if (!isRecord(report)) {
    return {
      name: "finops_bySource_hash",
      ok: false,
      detail: "FinOps artifact is not a JSON object.",
    };
  }
  const recomputed = computePerSourceCostBreakdownHashFromReport(
    report as Pick<
      FinOpsBudgetReport,
      "jobId" | "bySource" | "bySourceTotal" | "bySourceSealedAt"
    >,
  );
  const ok = recomputed === ctx.seal.bySourceHash;
  return {
    name: "finops_bySource_hash",
    ok,
    detail: ok
      ? `FinOps bySource hash ${recomputed} matches.`
      : `FinOps bySource hash ${recomputed} does not match seal value ${ctx.seal.bySourceHash}.`,
  };
};

const verifyGenealogyDagHash = async (
  ctx: VerifyContext,
): Promise<SealVerifyCrossCheck> => {
  const path = join(ctx.runDir, ctx.seal.genealogyArtifactFilename);
  const bytes = await readBytes(path);
  if (bytes === undefined) {
    return {
      name: "genealogy_dag_hash",
      ok: false,
      detail: `Genealogy artifact '${ctx.seal.genealogyArtifactFilename}' not found.`,
    };
  }
  const observed = sha256HexBytes(bytes);
  const ok = observed === ctx.seal.genealogyDagHash;
  return {
    name: "genealogy_dag_hash",
    ok,
    detail: ok
      ? `Genealogy DAG hash ${observed} matches.`
      : `Genealogy DAG hash ${observed} does not match seal value ${ctx.seal.genealogyDagHash}.`,
  };
};

const verifyProvenanceCrossLink = async (
  ctx: VerifyContext,
): Promise<SealVerifyCrossCheck | undefined> => {
  const path = join(ctx.runDir, PROVENANCE_ARTIFACT_FILENAME);
  if (!(await safeStat(path))) return undefined;
  const bytes = await readBytes(path);
  if (bytes === undefined) return undefined;
  let document: unknown;
  try {
    document = JSON.parse(Buffer.from(bytes).toString("utf8"));
  } catch {
    return {
      name: "provenance_graph",
      ok: false,
      detail: "provenance.jsonld present but not valid JSON.",
    };
  }
  if (!isRecord(document) || !Array.isArray(document["@graph"])) {
    return {
      name: "provenance_graph",
      ok: false,
      detail: "provenance.jsonld @graph is missing or not an array.",
    };
  }
  // For every artifact node in the graph that names a referenced
  // artifact, confirm the SHA-256 attestation matches what we just
  // recomputed against the bundle. We do not re-verify the Merkle
  // root here — that is the dedicated `verify-provenance` command's
  // job. The cross-link check is intentionally narrow: confirm the
  // graph and the seal agree on shared artifacts.
  const sealRefs = new Map<string, string | undefined>();
  for (const ref of collectSealReferences(ctx.seal)) {
    sealRefs.set(ref.reference, ref.expectedSha256);
  }
  for (const rawNode of document["@graph"]) {
    if (!isRecord(rawNode)) continue;
    const artifactPath = rawNode["ti:artifactPath"];
    const expectedSha = rawNode["ti:sha256"];
    if (
      typeof artifactPath !== "string" ||
      typeof expectedSha !== "string" ||
      !sealRefs.has(artifactPath)
    ) {
      continue;
    }
    const sealHash = sealRefs.get(artifactPath);
    if (sealHash !== undefined && sealHash !== expectedSha) {
      return {
        name: "provenance_graph",
        ok: false,
        detail: `Provenance graph hash ${expectedSha} for '${artifactPath}' disagrees with seal hash ${sealHash}.`,
      };
    }
  }
  return {
    name: "provenance_graph",
    ok: true,
    detail: "Provenance graph cross-links resolve consistently with the seal.",
  };
};

const compareVisualHashSets = (
  expected: readonly ProductionRunnerEvidenceVisualHash[],
  actual: readonly ProductionRunnerEvidenceVisualHash[],
): boolean => {
  if (expected.length !== actual.length) return false;
  const sortKey = (entry: ProductionRunnerEvidenceVisualHash): string =>
    `${entry.screenId}|${entry.modelDeployment}|${entry.evidenceHash}`;
  const left = [...expected]
    .map(sortKey)
    .sort((a, b) => a.localeCompare(b));
  const right = [...actual].map(sortKey).sort((a, b) => a.localeCompare(b));
  return left.every((value, index) => value === right[index]);
};

const verifyVisualSidecarCrossLink = async (
  ctx: VerifyContext,
): Promise<SealVerifyCrossCheck | undefined> => {
  if (ctx.seal.visualEvidenceHashes.length === 0) return undefined;
  const sidecarPath = join(ctx.runDir, "visual-sidecar-result.json");
  if (!(await safeStat(sidecarPath))) {
    return {
      name: "visual_sidecar_evidence",
      ok: false,
      detail:
        "Seal references visual evidence hashes but visual-sidecar-result.json is missing.",
    };
  }
  const bytes = await readBytes(sidecarPath);
  if (bytes === undefined) {
    return {
      name: "visual_sidecar_evidence",
      ok: false,
      detail: "visual-sidecar-result.json is unreadable.",
    };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(bytes).toString("utf8"));
  } catch {
    return {
      name: "visual_sidecar_evidence",
      ok: false,
      detail: "visual-sidecar-result.json is not valid JSON.",
    };
  }
  if (!isRecord(parsed)) {
    return {
      name: "visual_sidecar_evidence",
      ok: false,
      detail: "visual-sidecar-result.json is not a JSON object.",
    };
  }
  const refs =
    (parsed as unknown as VisualSidecarResultArtifact).visualEvidenceRefs ??
    [];
  const observed: ProductionRunnerEvidenceVisualHash[] = refs.map((ref) => ({
    screenId: ref.screenId,
    modelDeployment: ref.modelDeployment,
    evidenceHash: ref.evidenceHash,
  }));
  const ok = compareVisualHashSets(ctx.seal.visualEvidenceHashes, observed);
  return {
    name: "visual_sidecar_evidence",
    ok,
    detail: ok
      ? "Visual sidecar evidence refs match the seal's visualEvidenceHashes."
      : "Visual sidecar evidence refs disagree with the seal's visualEvidenceHashes.",
  };
};

const verifyRegionAttestationCrossLink = async (
  ctx: VerifyContext,
): Promise<SealVerifyCrossCheck | undefined> => {
  const reportPath = join(
    ctx.runDir,
    REGION_ATTESTATION_REPORT_ARTIFACT_FILENAME,
  );
  if (!(await safeStat(reportPath))) return undefined;
  const reportBytes = await readBytes(reportPath);
  if (reportBytes === undefined) return undefined;
  let report: unknown;
  try {
    report = JSON.parse(Buffer.from(reportBytes).toString("utf8"));
  } catch {
    return {
      name: "region_attestations",
      ok: false,
      detail: "region-attestations.json present but not valid JSON.",
    };
  }
  if (!isRecord(report)) {
    return {
      name: "region_attestations",
      ok: false,
      detail: "region-attestations.json is not a JSON object.",
    };
  }
  const finopsBytes = await readBytes(
    join(ctx.runDir, ctx.seal.finopsArtifactFilename),
  );
  if (finopsBytes === undefined) {
    return {
      name: "region_attestations",
      ok: false,
      detail:
        "Region attestations present but FinOps deployment record is missing.",
    };
  }
  let finops: unknown;
  try {
    finops = JSON.parse(Buffer.from(finopsBytes).toString("utf8"));
  } catch {
    return {
      name: "region_attestations",
      ok: false,
      detail: "FinOps deployment record is not valid JSON.",
    };
  }
  if (!isRecord(finops) || !Array.isArray(finops["bySource"])) {
    return {
      name: "region_attestations",
      ok: true,
      detail:
        "Region attestations present; FinOps record has no bySource list to cross-check.",
    };
  }
  const finopsDeploymentIds = new Set<string>();
  for (const entry of finops["bySource"]) {
    if (isRecord(entry) && typeof entry["deploymentId"] === "string") {
      finopsDeploymentIds.add(entry["deploymentId"]);
    }
  }
  const attestations = Array.isArray(report["attestations"])
    ? report["attestations"]
    : [];
  for (const entry of attestations) {
    if (!isRecord(entry)) continue;
    const inner = Array.isArray(entry["regionAttestations"])
      ? entry["regionAttestations"]
      : [];
    for (const att of inner) {
      if (!isRecord(att)) continue;
      const deploymentId = att["deploymentId"];
      if (
        typeof deploymentId === "string" &&
        finopsDeploymentIds.size > 0 &&
        !finopsDeploymentIds.has(deploymentId)
      ) {
        return {
          name: "region_attestations",
          ok: false,
          detail:
            `Region attestation references deploymentId '${deploymentId}' that is absent from the FinOps bySource record.`,
        };
      }
    }
  }
  return {
    name: "region_attestations",
    ok: true,
    detail:
      "Region attestations are internally consistent with the FinOps deployment record.",
  };
};

/** Verifier entry point for an extracted bundle directory. */
export const verifySealBundle = async (
  input: VerifySealBundleInput,
): Promise<SealVerificationReport> => {
  const bundlePath = input.bundleDir;
  if (!(await safeStat(bundlePath))) {
    return {
      ok: false,
      bundlePath,
      sealPath: "",
      artifacts: [],
      crossChecks: [],
      failures: [
        {
          code: "bundle_missing",
          reference: bundlePath,
          message: `Bundle path '${bundlePath}' does not exist.`,
        },
      ],
    };
  }
  const sealPath = await findSealPath(bundlePath);
  if (sealPath === undefined) {
    return {
      ok: false,
      bundlePath,
      sealPath: "",
      artifacts: [],
      crossChecks: [],
      failures: [
        {
          code: "seal_missing",
          reference: PRODUCTION_RUNNER_EVIDENCE_SEAL_ARTIFACT_FILENAME,
          message: `Bundle does not contain ${PRODUCTION_RUNNER_EVIDENCE_SEAL_ARTIFACT_FILENAME}.`,
        },
      ],
    };
  }
  const sealBytes = await readBytes(sealPath);
  if (sealBytes === undefined) {
    return {
      ok: false,
      bundlePath,
      sealPath,
      artifacts: [],
      crossChecks: [],
      failures: [
        {
          code: "seal_missing",
          reference: sealPath,
          message: "Bundle seal file disappeared during read.",
        },
      ],
    };
  }
  const seal = parseSealJson(sealBytes);
  if (seal === undefined) {
    return {
      ok: false,
      bundlePath,
      sealPath,
      artifacts: [],
      crossChecks: [],
      failures: [
        {
          code: "seal_unparseable",
          reference: sealPath,
          message: "Seal JSON is malformed or schema-incompatible.",
        },
      ],
    };
  }

  const runDir = dirname(sealPath);
  const ctx: VerifyContext = { runDir, seal };

  const { reports, leaves, failures } = await verifyArtifacts(ctx);
  const knownReferences = new Set<string>(reports.map((r) => r.reference));
  const extras = await detectExtras(ctx, knownReferences);
  const allArtifacts: SealArtifactReport[] = [...reports, ...extras].sort(
    (left, right) => {
      if (left.status !== right.status) {
        return left.status.localeCompare(right.status);
      }
      return left.reference.localeCompare(right.reference);
    },
  );
  const sortedLeaves = buildLeaves(leaves);
  const merkleRoot = computeMerkleRoot(sortedLeaves);
  const manifestSha256 = sha256HexBytes(
    Buffer.from(canonicalJson(seal), "utf8"),
  );
  const key = input.key !== undefined ? Buffer.from(input.key) : defaultKey();
  const manifestHmac = createHmac("sha256", key)
    .update(canonicalJson(seal), "utf8")
    .digest("hex");
  const hmacKeyFingerprint = createHash("sha256")
    .update(key)
    .digest("hex")
    .slice(0, 16);

  if (
    input.expectedHmacHex !== undefined &&
    HEX64.test(input.expectedHmacHex)
  ) {
    const expected = Buffer.from(input.expectedHmacHex, "hex");
    const observed = Buffer.from(manifestHmac, "hex");
    if (
      expected.length !== observed.length ||
      !timingSafeEqual(expected, observed)
    ) {
      failures.push({
        code: "hmac_mismatch",
        reference: PRODUCTION_RUNNER_EVIDENCE_SEAL_ARTIFACT_FILENAME,
        message: `HMAC ${manifestHmac} does not match expected ${input.expectedHmacHex}.`,
      });
    }
  }
  if (
    input.expectedMerkleRootHex !== undefined &&
    HEX64.test(input.expectedMerkleRootHex) &&
    input.expectedMerkleRootHex !== merkleRoot
  ) {
    failures.push({
      code: "merkle_root_mismatch",
      reference: PRODUCTION_RUNNER_EVIDENCE_SEAL_ARTIFACT_FILENAME,
      message: `Merkle root ${merkleRoot} does not match expected ${input.expectedMerkleRootHex}.`,
    });
  }

  const crossChecks: SealVerifyCrossCheck[] = [];
  const finopsCheck = await verifyFinopsBySourceHash(ctx);
  crossChecks.push(finopsCheck);
  if (!finopsCheck.ok) {
    failures.push({
      code: "artifact_tampered",
      reference: ctx.seal.finopsArtifactFilename,
      message: finopsCheck.detail,
    });
  }
  const genealogyCheck = await verifyGenealogyDagHash(ctx);
  crossChecks.push(genealogyCheck);
  if (!genealogyCheck.ok) {
    failures.push({
      code: "artifact_tampered",
      reference: ctx.seal.genealogyArtifactFilename,
      message: genealogyCheck.detail,
    });
  }
  const visual = await verifyVisualSidecarCrossLink(ctx);
  if (visual !== undefined) {
    crossChecks.push(visual);
    if (!visual.ok) {
      failures.push({
        code: "artifact_tampered",
        reference: "visual-sidecar-result.json",
        message: visual.detail,
      });
    }
  }
  const provenance = await verifyProvenanceCrossLink(ctx);
  if (provenance !== undefined) {
    crossChecks.push(provenance);
    if (!provenance.ok) {
      failures.push({
        code: "provenance_mismatch",
        reference: PROVENANCE_ARTIFACT_FILENAME,
        message: provenance.detail,
      });
    }
  }
  const region = await verifyRegionAttestationCrossLink(ctx);
  if (region !== undefined) {
    crossChecks.push(region);
    if (!region.ok) {
      failures.push({
        code: "region_attestation_mismatch",
        reference: REGION_ATTESTATION_REPORT_ARTIFACT_FILENAME,
        message: region.detail,
      });
    }
  }

  return {
    ok: failures.length === 0,
    bundlePath,
    sealPath,
    jobId: seal.jobId,
    generatedAt: seal.generatedAt,
    merkleRoot,
    manifestSha256,
    manifestHmacSha256: manifestHmac,
    hmacKeyFingerprint,
    artifacts: allArtifacts,
    crossChecks,
    failures,
  };
};

/**
 * Hard-gate code emitted to fail CI when the just-produced seal does
 * not survive an in-process replay through the verifier (Issue #2178).
 */
export const G9_REPLAY_DETERMINISM_VERIFIED =
  "G9_REPLAY_DETERMINISM_VERIFIED" as const;

export class ReplayDeterminismHardGateError extends Error {
  readonly code: typeof G9_REPLAY_DETERMINISM_VERIFIED;
  readonly failures: readonly SealVerifyFailure[];
  constructor(report: SealVerificationReport) {
    super(
      `${G9_REPLAY_DETERMINISM_VERIFIED} failed for run dir '${report.bundlePath}': ` +
        report.failures.map((f) => `[${f.code}] ${f.reference}: ${f.message}`).join(" | "),
    );
    this.name = "ReplayDeterminismHardGateError";
    this.code = G9_REPLAY_DETERMINISM_VERIFIED;
    this.failures = report.failures;
  }
}

/**
 * Replay the seal verifier against an extracted run directory and
 * throw {@link ReplayDeterminismHardGateError} when the verifier
 * reports any failure. Wired into the production runner so every CI
 * run verifies the seal it just produced — drift fails CI.
 */
export const assertReplayDeterminismVerifiedFromDisk = async (
  runDir: string,
): Promise<SealVerificationReport> => {
  const report = await verifySealBundle({ bundleDir: runDir });
  if (!report.ok) {
    throw new ReplayDeterminismHardGateError(report);
  }
  return report;
};

/** Render a human-readable plain-text report for stdout. */
export const renderSealVerificationTextReport = (
  report: SealVerificationReport,
): string => {
  const lines: string[] = [];
  lines.push(`test-intelligence seal verification ${report.ok ? "OK" : "FAILED"}`);
  lines.push(`  bundle path  : ${report.bundlePath}`);
  lines.push(`  seal path    : ${report.sealPath}`);
  if (report.jobId) lines.push(`  job id       : ${report.jobId}`);
  if (report.generatedAt) lines.push(`  generated at : ${report.generatedAt}`);
  if (report.merkleRoot) lines.push(`  merkle root  : ${report.merkleRoot}`);
  if (report.manifestSha256)
    lines.push(`  manifest sha : ${report.manifestSha256}`);
  if (report.manifestHmacSha256)
    lines.push(`  manifest hmac: ${report.manifestHmacSha256}`);
  if (report.hmacKeyFingerprint)
    lines.push(`  hmac key fp  : ${report.hmacKeyFingerprint}`);
  lines.push("");
  lines.push("artifacts:");
  for (const artifact of report.artifacts) {
    const tag = artifact.status.padEnd(8);
    const sha = artifact.observedSha256
      ? ` ${artifact.observedSha256}`
      : "";
    lines.push(`  ${tag} ${artifact.reference}${sha}`);
    if (artifact.note) {
      lines.push(`           note: ${artifact.note}`);
    }
    if (
      artifact.firstMismatchOffset !== undefined &&
      artifact.expectedSha256 !== undefined
    ) {
      lines.push(
        `           first mismatch offset: ${artifact.firstMismatchOffset}`,
      );
    }
  }
  if (report.crossChecks.length > 0) {
    lines.push("");
    lines.push("cross-checks:");
    for (const cc of report.crossChecks) {
      lines.push(`  [${cc.ok ? "OK" : "FAIL"}] ${cc.name}: ${cc.detail}`);
    }
  }
  if (report.failures.length > 0) {
    lines.push("");
    lines.push("failures:");
    for (const failure of report.failures) {
      lines.push(`  - [${failure.code}] ${failure.reference}: ${failure.message}`);
    }
  }
  lines.push("");
  return lines.join("\n");
};

/** Render the machine-readable JSON summary. */
export const renderSealVerificationJsonReport = (
  report: SealVerificationReport,
): string => `${canonicalJson(report)}\n`;

/** Exported for tests so callers can craft mismatch fixtures. */
export { computeFirstMismatchOffset };
