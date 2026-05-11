import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { isAbsolute, join, normalize } from "node:path";

import {
  PROVENANCE_ARTIFACT_FILENAME,
  type TestCasePolicyReport,
} from "../contracts/index.js";
import {
  PROV_JSONLD_CONTEXT_URL,
  computeProvenanceMerkleSeal,
  type ProvenanceDocument,
} from "./provenance-graph.js";

export interface ProvenanceVerificationFailure {
  readonly code:
    | "provenance_missing"
    | "provenance_unparseable"
    | "provenance_context_invalid"
    | "artifact_path_invalid"
    | "artifact_missing"
    | "artifact_hash_mismatch"
    | "merkle_root_mismatch"
    | "policy_report_missing"
    | "policy_report_unparseable"
    | "policy_report_merkle_mismatch";
  readonly reference: string;
  readonly message: string;
}

export interface ProvenanceVerificationResult {
  readonly ok: boolean;
  readonly runDir: string;
  readonly merkleRoot?: string;
  readonly leafCount?: number;
  readonly failures: readonly ProvenanceVerificationFailure[];
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isEnoent = (error: unknown): boolean =>
  typeof error === "object" &&
  error !== null &&
  (error as { code?: string }).code === "ENOENT";

const sha256Hex = (value: Uint8Array | string): string =>
  createHash("sha256").update(value).digest("hex");

const readJson = async (
  path: string,
): Promise<
  | { ok: true; value: unknown }
  | { ok: false; reason: "missing" | "unparseable" }
> => {
  try {
    return { ok: true, value: JSON.parse(await readFile(path, "utf8")) };
  } catch (error) {
    if (isEnoent(error)) {
      return { ok: false, reason: "missing" };
    }
    if (error instanceof SyntaxError) {
      return { ok: false, reason: "unparseable" };
    }
    throw error;
  }
};

const isSafeRelativeArtifactPath = (artifactPath: string): boolean => {
  if (artifactPath.trim().length === 0 || isAbsolute(artifactPath)) {
    return false;
  }
  const normalized = normalize(artifactPath).replaceAll("\\", "/");
  return (
    normalized.length > 0 &&
    !normalized.startsWith("../") &&
    normalized !== ".."
  );
};

export const verifyProvenanceFromDisk = async (
  runDir: string,
): Promise<ProvenanceVerificationResult> => {
  const provenancePath = join(runDir, PROVENANCE_ARTIFACT_FILENAME);
  const provenanceJson = await readJson(provenancePath);
  if (!provenanceJson.ok || !isRecord(provenanceJson.value)) {
    return {
      ok: false,
      runDir,
      failures: [
        {
          code:
            provenanceJson.ok || provenanceJson.reason === "unparseable"
              ? "provenance_unparseable"
              : "provenance_missing",
          reference: PROVENANCE_ARTIFACT_FILENAME,
          message:
            provenanceJson.ok || provenanceJson.reason === "unparseable"
            ? "Provenance graph is malformed JSON-LD."
            : "Provenance graph is missing.",
        },
      ],
    };
  }

  const document = provenanceJson.value as unknown as ProvenanceDocument;
  const failures: ProvenanceVerificationFailure[] = [];
  const context = document["@context"];
  if (
    !Array.isArray(context) ||
    !context.some((entry) => entry === PROV_JSONLD_CONTEXT_URL)
  ) {
    failures.push({
      code: "provenance_context_invalid",
      reference: PROVENANCE_ARTIFACT_FILENAME,
      message:
        "Provenance graph must include the official PROV-O JSON-LD context URL.",
    });
  }

  const graph = Array.isArray(document["@graph"]) ? document["@graph"] : [];
  for (const rawNode of graph) {
    if (!isRecord(rawNode)) continue;
    const artifactPath = rawNode["ti:artifactPath"];
    const expectedSha = rawNode["ti:sha256"];
    if (typeof artifactPath !== "string" || typeof expectedSha !== "string") {
      continue;
    }
    if (!isSafeRelativeArtifactPath(artifactPath)) {
      failures.push({
        code: "artifact_path_invalid",
        reference: artifactPath,
        message:
          "Attested provenance artifact path must stay within the run directory.",
      });
      continue;
    }
    const diskPath = join(runDir, artifactPath);
    try {
      await stat(diskPath);
    } catch (error) {
      if (isEnoent(error)) {
        failures.push({
          code: "artifact_missing",
          reference: artifactPath,
          message: `Attested provenance artifact '${artifactPath}' is missing.`,
        });
        continue;
      }
      throw error;
    }
    const observedSha = sha256Hex(await readFile(diskPath));
    if (observedSha !== expectedSha) {
      failures.push({
        code: "artifact_hash_mismatch",
        reference: artifactPath,
        message: `Artifact '${artifactPath}' hash does not match the provenance graph.`,
      });
    }
  }

  const observedSeal = computeProvenanceMerkleSeal(
    graph.filter((node): node is Record<string, unknown> => isRecord(node)) as unknown as Parameters<
      typeof computeProvenanceMerkleSeal
    >[0],
  );
  const expectedSeal = isRecord(document["ti:merkleSeal"])
    ? document["ti:merkleSeal"]
    : undefined;
  const expectedRoot =
    expectedSeal !== undefined && typeof expectedSeal["root"] === "string"
      ? expectedSeal["root"]
      : undefined;
  if (expectedRoot !== observedSeal.root) {
    failures.push({
      code: "merkle_root_mismatch",
      reference: PROVENANCE_ARTIFACT_FILENAME,
      message: "Merkle root does not match the canonical provenance graph.",
    });
  }

  const policyPath = join(runDir, "policy-report.json");
  const policyJson = await readJson(policyPath);
  if (!policyJson.ok || !isRecord(policyJson.value)) {
    failures.push({
      code:
        policyJson.ok || policyJson.reason === "unparseable"
          ? "policy_report_unparseable"
          : "policy_report_missing",
      reference: "policy-report.json",
      message:
        policyJson.ok || policyJson.reason === "unparseable"
        ? "Policy report is malformed."
        : "Policy report is missing.",
    });
  } else {
    const policy = policyJson.value as unknown as TestCasePolicyReport & Record<string, unknown>;
    const summary = isRecord(policy["provenance"]) ? policy["provenance"] : undefined;
    const policyRoot =
      summary !== undefined && typeof summary["merkleRoot"] === "string"
        ? summary["merkleRoot"]
        : undefined;
    if (policyRoot !== observedSeal.root) {
      failures.push({
        code: "policy_report_merkle_mismatch",
        reference: "policy-report.json",
        message:
          "Policy report provenance summary does not match the recomputed Merkle root.",
      });
    }
  }

  return {
    ok: failures.length === 0,
    runDir,
    merkleRoot: observedSeal.root,
    leafCount: observedSeal.leafCount,
    failures,
  };
};
