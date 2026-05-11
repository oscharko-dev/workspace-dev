import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  buildWave1ValidationEvidenceManifest,
  verifyWave1ValidationEvidenceManifest,
} from "./evidence-manifest.js";

const utf8 = (value: string): Uint8Array => new TextEncoder().encode(value);

test("evidence-unexpected-artifact: verifier reports extra multi-source artifact when rejectUnexpected is enabled", async () => {
  const dir = await mkdtemp(join(tmpdir(), "evidence-unexpected-"));
  await writeFile(join(dir, "alpha.json"), '{"ok":true}', "utf8");
  await writeFile(join(dir, "multi-source-conflicts.json"), '{"phantom":true}', "utf8");

  const manifest = buildWave1ValidationEvidenceManifest({
    fixtureId: "validation-onboarding",
    jobId: "job-1438",
    generatedAt: "2026-04-27T10:00:00.000Z",
    modelDeployments: {
      testGeneration: "gpt-oss-120b-mock",
      visualPrimary: "llama-4-maverick-vision",
    },
    policyProfileId: "eu-banking-default",
    policyProfileVersion: "1.0.0",
    exportProfileId: "opentext-alm-default",
    exportProfileVersion: "1.0.0",
    promptHash: "0".repeat(64),
    schemaHash: "0".repeat(64),
    inputHash: "0".repeat(64),
    cacheKeyDigest: "0".repeat(64),
    artifacts: [
      {
        filename: "alpha.json",
        bytes: utf8('{"ok":true}'),
        category: "validation",
      },
    ],
  });

  const result = await verifyWave1ValidationEvidenceManifest({
    manifest,
    artifactsDir: dir,
    rejectUnexpected: true,
  });

  assert.equal(result.ok, false);
  assert.equal(result.unexpected.includes("multi-source-conflicts.json"), true);
});
