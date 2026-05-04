import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  WAVE1_VALIDATION_EVIDENCE_MANIFEST_ARTIFACT_FILENAME,
  WAVE1_VALIDATION_EVIDENCE_MANIFEST_DIGEST_FILENAME,
} from "../contracts/index.js";
import { canonicalJson } from "./content-hash.js";
import {
  buildWave1ValidationEvidenceManifest,
  computeWave1ValidationEvidenceManifestDigest,
  verifyWave1ValidationEvidenceFromDisk,
} from "./evidence-manifest.js";

const ZERO = "0".repeat(64);
const GENERATED_AT = "2026-04-27T10:00:00.000Z";

const seedRun = async (label: string) => {
  const dir = await mkdtemp(join(tmpdir(), `evidence-tamper-${label}-`));
  await mkdir(join(dir, "sources", "jira-1"), { recursive: true });
  const files = new Map<string, string>([
    [
      "multi-source-conflicts.json",
      canonicalJson({ version: "1.0.0", conflicts: [{ conflictId: "c1" }] }),
    ],
    [
      "sources/jira-1/jira-issue-ir.json",
      canonicalJson({ issueKey: "PAY-1442", summary: "Original" }),
    ],
    [
      "sources/source-list.json",
      canonicalJson({ sources: ["jira-1"] }),
    ],
  ]);
  for (const [name, body] of files) {
    await writeFile(join(dir, name), body, "utf8");
  }
  const manifest = buildWave1ValidationEvidenceManifest({
    fixtureId: "validation-onboarding",
    jobId: "job-evidence-tamper",
    generatedAt: GENERATED_AT,
    modelDeployments: { testGeneration: "gpt-oss-120b-mock" },
    policyProfileId: "eu-banking-default",
    policyProfileVersion: "1.0.0",
    exportProfileId: "opentext-alm-default",
    exportProfileVersion: "1.0.0",
    promptHash: ZERO,
    schemaHash: ZERO,
    inputHash: ZERO,
    cacheKeyDigest: ZERO,
    artifacts: [...files].map(([filename, body]) => ({
      filename,
      bytes: new TextEncoder().encode(body),
      category: "validation" as const,
    })),
  });
  await writeFile(
    join(dir, WAVE1_VALIDATION_EVIDENCE_MANIFEST_ARTIFACT_FILENAME),
    canonicalJson(manifest),
    "utf8",
  );
  await writeFile(
    join(dir, WAVE1_VALIDATION_EVIDENCE_MANIFEST_DIGEST_FILENAME),
    `${computeWave1ValidationEvidenceManifestDigest(manifest)}\n`,
    "utf8",
  );
  return dir;
};

test("multi-source-evidence-tampering: manifest verifier detects conflict, source, truncation, and phantom mutations", async () => {
  const mutations: Array<{
    label: string;
    apply: (dir: string) => Promise<void>;
    assertResult: (result: Awaited<ReturnType<typeof verifyWave1ValidationEvidenceFromDisk>>["result"]) => void;
  }> = [
    {
      label: "conflicts",
      apply: async (dir) =>
        writeFile(
          join(dir, "multi-source-conflicts.json"),
          canonicalJson({ version: "1.0.0", conflicts: [] }),
          "utf8",
        ),
      assertResult: (result) =>
        assert.equal(result.mutated.includes("multi-source-conflicts.json"), true),
    },
    {
      label: "source-ir",
      apply: async (dir) =>
        writeFile(
          join(dir, "sources", "jira-1", "jira-issue-ir.json"),
          canonicalJson({ issueKey: "PAY-1442", summary: "Swapped" }),
          "utf8",
        ),
      assertResult: (result) =>
        assert.equal(result.mutated.includes("sources/jira-1/jira-issue-ir.json"), true),
    },
    {
      label: "truncated-source-list",
      apply: async (dir) =>
        writeFile(join(dir, "sources", "source-list.json"), "[]", "utf8"),
      assertResult: (result) =>
        assert.equal(result.resized.includes("sources/source-list.json"), true),
    },
    {
      label: "phantom-source",
      apply: async (dir) =>
        writeFile(
          join(dir, "phantom-source.json"),
          canonicalJson({ sourceId: "phantom" }),
          "utf8",
        ),
      assertResult: (result) =>
        assert.equal(result.unexpected.includes("phantom-source.json"), true),
    },
  ];

  for (const mutation of mutations) {
    const dir = await seedRun(mutation.label);
    try {
      await mutation.apply(dir);
      const { result } = await verifyWave1ValidationEvidenceFromDisk(dir, {
        rejectUnexpected: true,
      });
      assert.equal(result.ok, false, mutation.label);
      mutation.assertResult(result);
      const serialized = JSON.stringify(result);
      assert.equal(serialized.includes("/tmp/"), false);
      assert.equal(serialized.includes(await readFile(join(dir, WAVE1_VALIDATION_EVIDENCE_MANIFEST_ARTIFACT_FILENAME), "utf8")), false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
});
