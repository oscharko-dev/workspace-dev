import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  GENEALOGY_ARTIFACT_FILENAME,
  GENEALOGY_SCHEMA_VERSION,
} from "../contracts/index.js";
import {
  buildGenealogyArtifact,
  writeGenealogyArtifact,
} from "./genealogy.js";
import { canonicalJson } from "./content-hash.js";

test("buildGenealogyArtifact sorts deterministically and preserves optional parent pointers", () => {
  const artifact = buildGenealogyArtifact({
    runDir: "/tmp/ignored",
    generatedAt: "2026-05-03T12:00:00.000Z",
    nodes: [
      {
        jobId: "job-b",
        roleStepId: "test_generation",
        artifactFilename: "agent-role-runs/b.json",
      },
      {
        jobId: "job-a",
        roleStepId: "test_generation",
        artifactFilename: "agent-role-runs/a.json",
        parentJobId: "wd-parent-0123456789abcdef",
        roleLineageDepth: 1,
      },
    ],
  });

  assert.equal(artifact.schemaVersion, GENEALOGY_SCHEMA_VERSION);
  assert.deepEqual(
    artifact.nodes.map((node) => node.jobId),
    ["job-a", "job-b"],
  );
  assert.equal(artifact.nodes[0]?.parentJobId, "wd-parent-0123456789abcdef");
  assert.equal(artifact.nodes[0]?.roleLineageDepth, 1);
});

test("writeGenealogyArtifact persists canonical JSON and rejects excessive depth", async () => {
  const runDir = await mkdtemp(join(tmpdir(), "ti-genealogy-"));
  try {
    const written = await writeGenealogyArtifact({
      runDir,
      generatedAt: "2026-05-03T12:00:00.000Z",
      nodes: [
        {
          jobId: "job-1",
          roleStepId: "test_generation",
          artifactFilename: "agent-role-runs/test_generation.json",
          roleLineageDepth: 0,
        },
      ],
    });

    assert.ok(written.artifactPath.endsWith(GENEALOGY_ARTIFACT_FILENAME));
    const onDisk = await readFile(written.artifactPath, "utf8");
    assert.equal(onDisk, `${canonicalJson(written.artifact)}\n`);

    await assert.rejects(
      () =>
        writeGenealogyArtifact({
          runDir,
          generatedAt: "2026-05-03T12:00:00.000Z",
          nodes: [
            {
              jobId: "job-1",
              roleStepId: "test_generation",
              artifactFilename: "agent-role-runs/test_generation.json",
              roleLineageDepth: 11,
            },
          ],
        }),
      /roleLineageDepth must be an integer in \[0, 10\]/,
    );
  } finally {
    await rm(runDir, { recursive: true, force: true });
  }
});
