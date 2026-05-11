import { randomUUID } from "node:crypto";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

import {
  GENEALOGY_ARTIFACT_FILENAME,
  GENEALOGY_SCHEMA_VERSION,
  type GenealogyArtifact,
  type GenealogyArtifactNode,
} from "../contracts/index.js";
import { assertRoleLineageDepth } from "../contracts/branded-ids.js";
import { canonicalJson } from "./content-hash.js";

export interface GenealogyNodeInput {
  jobId: string;
  roleStepId: string;
  artifactFilename: string;
  parentJobId?: string;
  roleLineageDepth?: number;
}

export interface WriteGenealogyArtifactInput {
  runDir: string;
  generatedAt: string;
  nodes: readonly GenealogyNodeInput[];
}

const compareNodes = (
  left: GenealogyArtifactNode,
  right: GenealogyArtifactNode,
): number =>
  left.jobId.localeCompare(right.jobId) ||
  left.roleStepId.localeCompare(right.roleStepId) ||
  left.artifactFilename.localeCompare(right.artifactFilename);

const normalizeNode = (node: GenealogyNodeInput): GenealogyArtifactNode => {
  if (node.jobId.trim().length === 0) {
    throw new TypeError("writeGenealogyArtifact: jobId must be non-empty");
  }
  if (node.roleStepId.trim().length === 0) {
    throw new TypeError("writeGenealogyArtifact: roleStepId must be non-empty");
  }
  if (node.artifactFilename.trim().length === 0) {
    throw new TypeError(
      "writeGenealogyArtifact: artifactFilename must be non-empty",
    );
  }
  assertRoleLineageDepth(
    node.roleLineageDepth,
    "writeGenealogyArtifact",
  );
  return {
    jobId: node.jobId,
    roleStepId: node.roleStepId,
    artifactFilename: node.artifactFilename,
    ...(node.parentJobId !== undefined ? { parentJobId: node.parentJobId } : {}),
    ...(node.roleLineageDepth !== undefined
      ? { roleLineageDepth: node.roleLineageDepth }
      : {}),
  };
};

export const buildGenealogyArtifact = (
  input: WriteGenealogyArtifactInput,
): GenealogyArtifact => {
  const deduped = new Map<string, GenealogyArtifactNode>();
  for (const node of input.nodes) {
    const normalized = normalizeNode(node);
    const key = [
      normalized.jobId,
      normalized.roleStepId,
      normalized.artifactFilename,
    ].join("\u0000");
    deduped.set(key, normalized);
  }
  return {
    schemaVersion: GENEALOGY_SCHEMA_VERSION,
    generatedAt: input.generatedAt,
    nodes: Array.from(deduped.values()).sort(compareNodes),
  };
};

export const writeGenealogyArtifact = async (
  input: WriteGenealogyArtifactInput,
): Promise<{ artifactPath: string; artifact: GenealogyArtifact; bytes: Uint8Array }> => {
  if (input.runDir.trim().length === 0) {
    throw new TypeError("writeGenealogyArtifact: runDir must be non-empty");
  }
  const artifact = buildGenealogyArtifact(input);
  const artifactPath = join(input.runDir, GENEALOGY_ARTIFACT_FILENAME);
  const tmpPath = `${artifactPath}.${process.pid}.${randomUUID()}.tmp`;
  const serialized = `${canonicalJson(artifact)}\n`;
  const bytes = new TextEncoder().encode(serialized);
  await mkdir(input.runDir, { recursive: true });
  await writeFile(tmpPath, serialized, "utf8");
  await rename(tmpPath, artifactPath);
  return { artifactPath, artifact, bytes };
};
