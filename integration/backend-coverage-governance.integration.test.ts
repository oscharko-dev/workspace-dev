import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(__dirname, "..");

const readRepoFile = async (relativePath: string): Promise<string> => {
  return await readFile(path.resolve(packageRoot, relativePath), "utf8");
};

test("integration: backend coverage gate keeps core import and governance paths in scope", async () => {
  const packageJson = JSON.parse(await readRepoFile("package.json")) as {
    scripts?: Record<string, string>;
  };
  const pipelineDoc = await readRepoFile("PIPELINE.md");
  const releaseGateWorkflow = await readRepoFile(
    ".github/workflows/release-gate.yml",
  );
  const changesetsReleaseWorkflow = await readRepoFile(
    ".github/workflows/changesets-release.yml",
  );

  const coverageScript = packageJson.scripts?.["test:coverage"] ?? "";
  assert.match(
    coverageScript,
    /--all --src src --include "src\/\*\*\/\*\.ts"/,
  );
  assert.match(coverageScript, /c8(?:\.js)?/);
  assert.match(
    coverageScript,
    /node scripts\/check-coverage-thresholds\.mjs$/,
  );
  assert.doesNotMatch(coverageScript, /--exclude "src\/job-engine\.ts"/);
  assert.doesNotMatch(
    coverageScript,
    /--exclude "src\/job-engine\/figma-source\.ts"/,
  );

  assert.match(pipelineDoc, /## Backend coverage gate/);
  assert.match(
    pipelineDoc,
    /src\/job-engine\.ts.*src\/job-engine\/figma-source\.ts/s,
  );
  assert.match(
    pipelineDoc,
    /stay inside that global backend gate/i,
  );
  assert.match(
    pipelineDoc,
    /lines >= 90%.*statements >= 90%.*functions >= 90%.*branches >= 85%/is,
  );
  assert.match(
    pipelineDoc,
    /must be documented here with an explicit rationale, owner, and retirement condition/i,
  );

  for (const workflow of [releaseGateWorkflow, changesetsReleaseWorkflow]) {
    assert.match(workflow, /pnpm run test:coverage/);
  }
});
