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

const extractMutationTestingJobBlock = (workflow: string): string => {
  const marker = "  mutation-testing:\n";
  const markerIndex = workflow.indexOf(marker);
  assert.notEqual(markerIndex, -1, "Expected workflow to contain mutation-testing job");

  const afterMarker = workflow.slice(markerIndex + marker.length);
  const nextJobMatch = afterMarker.match(/^  [a-z0-9-]+:\n/m);
  if (!nextJobMatch || nextJobMatch.index === undefined) {
    return workflow.slice(markerIndex);
  }

  return workflow.slice(markerIndex, markerIndex + marker.length + nextJobMatch.index);
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
  const mutationSummaryScript = await readRepoFile(
    "scripts/print-mutation-report-summary.mjs",
  );
  const strykerConfigModule = (await import(
    pathToFileURL(path.resolve(packageRoot, "stryker.config.mjs")).href
  )) as {
    default: {
      mutate: string[];
      thresholds: { break: number | null; high: number; low: number };
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
    "src/job-engine/figma-mcp-resolver.ts",
    "src/job-engine/figma-token-bridge.ts",
    "src/job-engine/figma-component-mapper.ts",
    "src/job-engine/import-session-event-store.ts",
    "src/job-engine/paste-fingerprint-store.ts",
    "src/job-engine/paste-tree-diff.ts",
    "src/parity/ir.ts",
    "src/parity/ir-design-context.ts",
  ]);
  assert.equal(strykerConfigModule.default.thresholds.break, 58);
  assert.equal(strykerConfigModule.default.thresholds.high, 58);
  assert.equal(strykerConfigModule.default.thresholds.low, 58);
  assert.deepEqual(strykerConfigModule.default.tap.testFiles, [
    "src/mode-lock.test.ts",
    "src/schemas.test.ts",
    "src/server/request-security.test.ts",
    "src/job-engine/pipeline/orchestrator.test.ts",
    "src/job-engine/visual-scoring.test.ts",
    "src/job-engine/figma-mcp-resolver.test.ts",
    "src/job-engine/figma-token-bridge.test.ts",
    "src/job-engine/figma-component-mapper.test.ts",
    "src/job-engine/import-session-event-store.test.ts",
    "src/job-engine/paste-fingerprint-store.test.ts",
    "src/job-engine/paste-tree-diff.test.ts",
    "src/parity/ir.test.ts",
    "src/parity/ir-design-context.test.ts",
  ]);
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
  assert.match(contributingDoc, /CI-blocking quality gate/i);
  assert.match(contributingDoc, /Current baseline mutation score:/i);
  assert.match(
    mutationSummaryScript,
    /"src\/job-engine\/paste-tree-diff\.ts"/,
  );

  for (const workflow of [
    devQualityWorkflow,
    releaseGateWorkflow,
    changesetsReleaseWorkflow,
  ]) {
    const mutationJobBlock = extractMutationTestingJobBlock(workflow);
    assert.match(workflow, /\n  mutation-testing:\n/);
    assert.doesNotMatch(mutationJobBlock, /continue-on-error:\s*true/);
    assert.match(
      mutationJobBlock,
      /Run mutation baseline \(blocking >=58%\)/,
    );
    assert.match(mutationJobBlock, /pnpm run test:mutation/);
    assert.match(mutationJobBlock, /print-mutation-report-summary\.mjs/);
    assert.match(mutationJobBlock, /artifacts\/testing\/mutation/);
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
