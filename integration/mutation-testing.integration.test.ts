import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(__dirname, "..");

const readRepoFile = async (relativePath: string): Promise<string> => {
  return await readFile(path.resolve(packageRoot, relativePath), "utf8");
};

test("integration: mutation-testing config, docs, and workflows stay aligned", async () => {
  const packageJson = JSON.parse(await readRepoFile("package.json")) as {
    scripts?: Record<string, string>;
  };
  const contributingDoc = await readRepoFile("CONTRIBUTING.md");
  const devQualityWorkflow = await readRepoFile(
    ".github/workflows/dev-quality-gate.yml",
  );
  const releaseGateWorkflow = await readRepoFile(
    ".github/workflows/release-gate.yml",
  );
  const changesetsReleaseWorkflow = await readRepoFile(
    ".github/workflows/changesets-release.yml",
  );
  const strykerConfigModule = (await import(
    pathToFileURL(path.resolve(packageRoot, "stryker.config.mjs")).href
  )) as {
    default: {
      mutate: string[];
      thresholds: { break: number | null };
      tap: { testFiles: string[] };
      jsonReporter: { fileName: string };
      htmlReporter: { fileName: string };
    };
  };

  assert.equal(
    packageJson.scripts?.["test:mutation"],
    "pnpm exec stryker run stryker.config.mjs",
  );

  assert.deepEqual(strykerConfigModule.default.mutate, [
    "src/mode-lock.ts",
    "src/schemas.ts",
    "src/server/request-security.ts",
    "src/job-engine/pipeline/orchestrator.ts",
    "src/job-engine/visual-scoring.ts",
    "src/parity/ir.ts",
  ]);
  assert.equal(strykerConfigModule.default.thresholds.break, null);
  assert.equal(
    strykerConfigModule.default.tap.testFiles.includes(
      "src/server/request-security.test.ts",
    ),
    true,
  );
  assert.equal(
    strykerConfigModule.default.jsonReporter.fileName,
    "artifacts/testing/mutation/mutation.json",
  );
  assert.equal(
    strykerConfigModule.default.htmlReporter.fileName,
    "artifacts/testing/mutation/mutation.html",
  );

  assert.match(contributingDoc, /pnpm run test:mutation/);
  assert.match(contributingDoc, /artifacts\/testing\/mutation/);
  assert.match(contributingDoc, /warn-only CI signal/i);
  assert.match(contributingDoc, /Current baseline mutation score:/i);

  for (const workflow of [
    devQualityWorkflow,
    releaseGateWorkflow,
    changesetsReleaseWorkflow,
  ]) {
    assert.match(workflow, /\n  mutation-testing:\n/);
    assert.match(workflow, /continue-on-error: true/);
    assert.match(workflow, /pnpm run test:mutation/);
    assert.match(workflow, /print-mutation-report-summary\.mjs/);
    assert.match(workflow, /artifacts\/testing\/mutation/);
  }

  assert.match(devQualityWorkflow, /needs: quality/);
  assert.match(
    releaseGateWorkflow,
    /needs: \[quality, performance-web, mutation-testing, fips-smoke\]/,
  );
  assert.match(
    changesetsReleaseWorkflow,
    /needs: \[quality-matrix, performance-web, mutation-testing\]/,
  );
});
