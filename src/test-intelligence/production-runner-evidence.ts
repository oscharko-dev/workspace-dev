import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";

import {
  GENEALOGY_ARTIFACT_FILENAME,
} from "../contracts/index.js";
import type {
  EvidenceVerifyCheck,
  EvidenceVerifyFailure,
  FinOpsBudgetReport,
  VisualSidecarResultArtifact,
} from "../contracts/index.js";
import {
  AGENT_HARNESS_CHECKPOINT_DIRECTORY,
  AGENT_HARNESS_CHECKPOINT_ROOT_PARENT_HASH,
  verifyAgentHarnessCheckpointChainFromDisk,
} from "./agent-harness-checkpoint.js";
import { canonicalJson } from "./content-hash.js";
import { computePerSourceCostBreakdownHashFromReport } from "./per-source-cost.js";

export const PRODUCTION_RUNNER_EVIDENCE_SEAL_SCHEMA_VERSION = "1.0.0" as const;
export const PRODUCTION_RUNNER_EVIDENCE_SEAL_ARTIFACT_FILENAME =
  "production-runner-evidence-seal.json" as const;

const HEX64 = /^[0-9a-f]{64}$/u;

export interface ProductionRunnerEvidenceVisualHash {
  readonly screenId: string;
  readonly modelDeployment: string;
  readonly evidenceHash: string;
}

export interface ProductionRunnerEvidenceSeal {
  readonly schemaVersion: typeof PRODUCTION_RUNNER_EVIDENCE_SEAL_SCHEMA_VERSION;
  readonly jobId: string;
  readonly generatedAt: string;
  readonly harnessArtifactFilenames: readonly string[];
  readonly headOfChainHash: string;
  readonly chainLength: number;
  readonly finopsArtifactFilename: string;
  readonly bySourceHash: string;
  readonly genealogyArtifactFilename: typeof GENEALOGY_ARTIFACT_FILENAME;
  readonly genealogyDagHash: string;
  readonly visualEvidenceHashes: readonly ProductionRunnerEvidenceVisualHash[];
}

export interface BuildProductionRunnerEvidenceSealInput {
  readonly jobId: string;
  readonly generatedAt: string;
  readonly harnessArtifactFilenames: readonly string[];
  readonly headOfChainHash: string;
  readonly chainLength: number;
  readonly finopsArtifactFilename: string;
  readonly bySourceHash: string;
  readonly genealogyDagHash: string;
  readonly visualEvidenceHashes?: readonly ProductionRunnerEvidenceVisualHash[];
}

export interface VerifyProductionRunnerEvidenceSealFromDiskResult {
  readonly checks: readonly EvidenceVerifyCheck[];
  readonly failures: readonly EvidenceVerifyFailure[];
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const sha256Hex = (value: Uint8Array | string): string =>
  createHash("sha256").update(value).digest("hex");

const uniqueSortedStrings = (values: readonly string[]): string[] =>
  [...new Set(values)].sort((left, right) => left.localeCompare(right));

const sortVisualEvidenceHashes = (
  values: readonly ProductionRunnerEvidenceVisualHash[],
): ProductionRunnerEvidenceVisualHash[] =>
  [...values]
    .map((value) => ({ ...value }))
    .sort(
      (left, right) =>
        left.screenId.localeCompare(right.screenId) ||
        left.modelDeployment.localeCompare(right.modelDeployment) ||
        left.evidenceHash.localeCompare(right.evidenceHash),
    );

const isEnoent = (error: unknown): boolean =>
  typeof error === "object" &&
  error !== null &&
  (error as { code?: string }).code === "ENOENT";

const fileExists = async (path: string): Promise<boolean> => {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (isEnoent(error)) return false;
    throw error;
  }
};

const metadataFailure = (
  message: string,
): { check: EvidenceVerifyCheck; failure: EvidenceVerifyFailure } => ({
  check: {
    kind: "manifest_metadata",
    reference: PRODUCTION_RUNNER_EVIDENCE_SEAL_ARTIFACT_FILENAME,
    ok: false,
    failureCode: "manifest_metadata_invalid",
  },
  failure: {
    code: "manifest_metadata_invalid",
    reference: PRODUCTION_RUNNER_EVIDENCE_SEAL_ARTIFACT_FILENAME,
    message,
  },
});

const buildVisualEvidenceHashesFromArtifact = (
  artifact: VisualSidecarResultArtifact,
): ProductionRunnerEvidenceVisualHash[] => {
  const refs = artifact.visualEvidenceRefs ?? [];
  return refs.map((ref) => ({
    screenId: ref.screenId,
    modelDeployment: ref.modelDeployment,
    evidenceHash: ref.evidenceHash,
  }));
};

const parseSeal = (raw: unknown): ProductionRunnerEvidenceSeal | undefined => {
  if (!isRecord(raw)) return undefined;
  const harnessArtifactFilenames = raw["harnessArtifactFilenames"];
  const visualEvidenceHashes = raw["visualEvidenceHashes"];
  if (
    raw["schemaVersion"] !== PRODUCTION_RUNNER_EVIDENCE_SEAL_SCHEMA_VERSION ||
    typeof raw["jobId"] !== "string" ||
    typeof raw["generatedAt"] !== "string" ||
    !Array.isArray(harnessArtifactFilenames) ||
    harnessArtifactFilenames.some((entry) => typeof entry !== "string") ||
    typeof raw["headOfChainHash"] !== "string" ||
    !HEX64.test(raw["headOfChainHash"]) ||
    typeof raw["chainLength"] !== "number" ||
    !Number.isInteger(raw["chainLength"]) ||
    raw["chainLength"] < 0 ||
    typeof raw["finopsArtifactFilename"] !== "string" ||
    typeof raw["bySourceHash"] !== "string" ||
    !HEX64.test(raw["bySourceHash"]) ||
    raw["genealogyArtifactFilename"] !== GENEALOGY_ARTIFACT_FILENAME ||
    typeof raw["genealogyDagHash"] !== "string" ||
    !HEX64.test(raw["genealogyDagHash"]) ||
    !Array.isArray(visualEvidenceHashes) ||
    visualEvidenceHashes.some(
      (entry) =>
        !isRecord(entry) ||
        typeof entry["screenId"] !== "string" ||
        typeof entry["modelDeployment"] !== "string" ||
        typeof entry["evidenceHash"] !== "string" ||
        !HEX64.test(entry["evidenceHash"]),
    )
  ) {
    return undefined;
  }
  return {
    schemaVersion: PRODUCTION_RUNNER_EVIDENCE_SEAL_SCHEMA_VERSION,
    jobId: raw["jobId"],
    generatedAt: raw["generatedAt"],
    harnessArtifactFilenames: uniqueSortedStrings(harnessArtifactFilenames),
    headOfChainHash: raw["headOfChainHash"],
    chainLength: raw["chainLength"],
    finopsArtifactFilename: raw["finopsArtifactFilename"],
    bySourceHash: raw["bySourceHash"],
    genealogyArtifactFilename: GENEALOGY_ARTIFACT_FILENAME,
    genealogyDagHash: raw["genealogyDagHash"],
    visualEvidenceHashes: sortVisualEvidenceHashes(
      visualEvidenceHashes as readonly ProductionRunnerEvidenceVisualHash[],
    ),
  };
};

const readJson = async (
  path: string,
): Promise<{ ok: true; value: unknown } | { ok: false }> => {
  try {
    return { ok: true, value: JSON.parse(await readFile(path, "utf8")) };
  } catch (error) {
    if (isEnoent(error) || error instanceof SyntaxError) {
      return { ok: false };
    }
    throw error;
  }
};

const pushFailure = (
  failures: EvidenceVerifyFailure[],
  failure: EvidenceVerifyFailure,
): void => {
  if (
    failures.some(
      (existing) =>
        existing.code === failure.code &&
        existing.reference === failure.reference &&
        existing.message === failure.message,
    )
  ) {
    return;
  }
  failures.push(failure);
};

const pushCheck = (checks: EvidenceVerifyCheck[], check: EvidenceVerifyCheck): void => {
  checks.push(check);
};

const compareVisualHashes = (
  expected: readonly ProductionRunnerEvidenceVisualHash[],
  actual: readonly ProductionRunnerEvidenceVisualHash[],
): boolean => {
  if (expected.length !== actual.length) return false;
  return expected.every((entry, index) => {
    const candidate = actual[index];
    return (
      candidate !== undefined &&
      candidate.screenId === entry.screenId &&
      candidate.modelDeployment === entry.modelDeployment &&
      candidate.evidenceHash === entry.evidenceHash
    );
  });
};

export const buildProductionRunnerEvidenceSeal = (
  input: BuildProductionRunnerEvidenceSealInput,
): ProductionRunnerEvidenceSeal => ({
  schemaVersion: PRODUCTION_RUNNER_EVIDENCE_SEAL_SCHEMA_VERSION,
  jobId: input.jobId,
  generatedAt: input.generatedAt,
  harnessArtifactFilenames: uniqueSortedStrings(input.harnessArtifactFilenames),
  headOfChainHash: input.headOfChainHash,
  chainLength: input.chainLength,
  finopsArtifactFilename: input.finopsArtifactFilename,
  bySourceHash: input.bySourceHash,
  genealogyArtifactFilename: GENEALOGY_ARTIFACT_FILENAME,
  genealogyDagHash: input.genealogyDagHash,
  visualEvidenceHashes: sortVisualEvidenceHashes(input.visualEvidenceHashes ?? []),
});

export const serializeProductionRunnerEvidenceSeal = (
  seal: ProductionRunnerEvidenceSeal,
): string => canonicalJson(seal);

export const verifyProductionRunnerEvidenceSealFromDisk = async (input: {
  readonly artifactsDir: string;
  readonly jobId: string;
}): Promise<VerifyProductionRunnerEvidenceSealFromDiskResult> => {
  const checks: EvidenceVerifyCheck[] = [];
  const failures: EvidenceVerifyFailure[] = [];
  const sealPath = join(
    input.artifactsDir,
    PRODUCTION_RUNNER_EVIDENCE_SEAL_ARTIFACT_FILENAME,
  );
  if (!(await fileExists(sealPath))) {
    return { checks, failures };
  }

  const rawSeal = await readJson(sealPath);
  const parsed = rawSeal.ok ? parseSeal(rawSeal.value) : undefined;
  if (parsed === undefined) {
    const failure = metadataFailure(
      `Production-runner evidence seal '${PRODUCTION_RUNNER_EVIDENCE_SEAL_ARTIFACT_FILENAME}' is malformed or schema-incompatible.`,
    );
    return { checks: [failure.check], failures: [failure.failure] };
  }

  const checkpointDir = join(
    input.artifactsDir,
    AGENT_HARNESS_CHECKPOINT_DIRECTORY,
    input.jobId,
  );
  let expectedHeadOfChainHash = AGENT_HARNESS_CHECKPOINT_ROOT_PARENT_HASH;
  let expectedChainLength = 0;
  if (await fileExists(checkpointDir)) {
    const chain = await verifyAgentHarnessCheckpointChainFromDisk({
      runDir: input.artifactsDir,
      jobId: input.jobId,
    });
    if (!chain.ok) {
      const failure = metadataFailure(
        `Production-runner evidence seal checkpoint chain is invalid: ${chain.reason} at index ${chain.firstBreakIndex}.`,
      );
      return { checks: [failure.check], failures: [failure.failure] };
    }
    expectedHeadOfChainHash = chain.headOfChainHash;
    expectedChainLength = chain.chainLength;
  }

  const headMatches = parsed.headOfChainHash === expectedHeadOfChainHash;
  const chainLengthMatches = parsed.chainLength === expectedChainLength;
  pushCheck(checks, {
    kind: "manifest_metadata",
    reference: PRODUCTION_RUNNER_EVIDENCE_SEAL_ARTIFACT_FILENAME,
    ok: headMatches && chainLengthMatches,
    ...(!headMatches || !chainLengthMatches
      ? { failureCode: "manifest_metadata_invalid" as const }
      : {}),
  });
  if (!headMatches || !chainLengthMatches) {
    pushFailure(failures, {
      code: "manifest_metadata_invalid",
      reference: PRODUCTION_RUNNER_EVIDENCE_SEAL_ARTIFACT_FILENAME,
      message:
        `Production-runner evidence seal chain summary mismatch: expected headOfChainHash=${expectedHeadOfChainHash} chainLength=${String(expectedChainLength)}.`,
    });
  }

  const finopsPath = join(input.artifactsDir, parsed.finopsArtifactFilename);
  const finopsRaw = await readJson(finopsPath);
  if (!finopsRaw.ok || !isRecord(finopsRaw.value)) {
    pushCheck(checks, {
      kind: "manifest_metadata",
      reference: parsed.finopsArtifactFilename,
      ok: false,
      failureCode: "bySource_hash_mismatch",
    });
    pushFailure(failures, {
      code: "bySource_hash_mismatch",
      reference: parsed.finopsArtifactFilename,
      message:
        `FinOps report '${parsed.finopsArtifactFilename}' is malformed and cannot be hashed for production-runner evidence sealing.`,
    });
  } else {
    const finopsHash = computePerSourceCostBreakdownHashFromReport(
      finopsRaw.value as Pick<
        FinOpsBudgetReport,
        "jobId" | "bySource" | "bySourceTotal" | "bySourceSealedAt"
      >,
    );
    const finopsOk = finopsHash === parsed.bySourceHash;
    pushCheck(checks, {
      kind: "manifest_metadata",
      reference: parsed.finopsArtifactFilename,
      ok: finopsOk,
      ...(finopsOk ? {} : { failureCode: "bySource_hash_mismatch" as const }),
    });
    if (!finopsOk) {
      pushFailure(failures, {
        code: "bySource_hash_mismatch",
        reference: parsed.finopsArtifactFilename,
        message:
          `Production-runner evidence seal bySource hash ${parsed.bySourceHash} does not match recomputed ${finopsHash}.`,
      });
    }
  }

  const genealogyPath = join(
    input.artifactsDir,
    parsed.genealogyArtifactFilename,
  );
  const genealogyExists = await fileExists(genealogyPath);
  const genealogyHash = genealogyExists
    ? sha256Hex(await readFile(genealogyPath))
    : undefined;
  const genealogyOk = genealogyHash === parsed.genealogyDagHash;
  pushCheck(checks, {
    kind: "manifest_metadata",
    reference: parsed.genealogyArtifactFilename,
    ok: genealogyOk,
    ...(genealogyOk
      ? {}
      : { failureCode: "manifest_metadata_invalid" as const }),
  });
  if (!genealogyOk) {
    pushFailure(failures, {
      code: "manifest_metadata_invalid",
      reference: parsed.genealogyArtifactFilename,
      message:
        `Production-runner evidence seal genealogyDagHash ${parsed.genealogyDagHash} does not match recomputed ${genealogyHash ?? "missing"}.`,
    });
  }

  const visualSidecarPath = join(input.artifactsDir, "visual-sidecar-result.json");
  if (await fileExists(visualSidecarPath)) {
    const visualRaw = await readJson(visualSidecarPath);
    const visualArtifact = visualRaw.ok
      ? (visualRaw.value as VisualSidecarResultArtifact)
      : undefined;
    const actualVisualHashes = sortVisualEvidenceHashes(
      visualArtifact === undefined
        ? []
        : buildVisualEvidenceHashesFromArtifact(visualArtifact),
    );
    const visualOk = compareVisualHashes(
      parsed.visualEvidenceHashes,
      actualVisualHashes,
    );
    pushCheck(checks, {
      kind: "visual_sidecar_evidence",
      reference: "visual-sidecar-result.json",
      ok: visualOk,
      ...(visualOk
        ? {}
        : { failureCode: "visual_sidecar_evidence_missing" as const }),
    });
    if (!visualOk) {
      pushFailure(failures, {
        code: "visual_sidecar_evidence_missing",
        reference: "visual-sidecar-result.json",
        message:
          "Production-runner evidence seal visual evidence hashes do not match the persisted visual-sidecar result.",
      });
    }
  } else if (parsed.visualEvidenceHashes.length > 0) {
    pushCheck(checks, {
      kind: "visual_sidecar_evidence",
      reference: "visual-sidecar-result.json",
      ok: false,
      failureCode: "visual_sidecar_evidence_missing",
    });
    pushFailure(failures, {
      code: "visual_sidecar_evidence_missing",
      reference: "visual-sidecar-result.json",
      message:
        "Production-runner evidence seal references visual evidence hashes but the visual-sidecar result artifact is missing.",
    });
  }

  return {
    checks: checks.sort((left, right) => {
      if (left.kind !== right.kind) return left.kind.localeCompare(right.kind);
      return left.reference.localeCompare(right.reference);
    }),
    failures: failures.sort((left, right) => {
      if (left.reference !== right.reference) {
        return left.reference.localeCompare(right.reference);
      }
      return left.code.localeCompare(right.code);
    }),
  };
};
