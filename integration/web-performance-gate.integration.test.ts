import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(__dirname, "..");
const baselineRelativePath = "template/react-mui-app/perf-baseline.json";
const performanceDocRelativePath = "docs/react-web-performance.md";

const readRepoFile = async (relativePath: string): Promise<string> => {
  return await readFile(path.resolve(packageRoot, relativePath), "utf8");
};

const getJobSlice = (workflow: string, marker: string): string => {
  const markerIndex = workflow.indexOf(marker);
  assert.notEqual(markerIndex, -1, `Expected workflow to contain marker '${marker}'.`);
  const afterMarker = workflow.slice(markerIndex + marker.length);
  const nextJobIndex = afterMarker.search(/\n {2}[a-z0-9-]+:\n/);
  if (nextJobIndex === -1) {
    return workflow.slice(markerIndex);
  }
  return workflow.slice(markerIndex, markerIndex + marker.length + nextJobIndex);
};

test("integration: web performance gate policy, baseline path, and docs stay aligned", async () => {
  const readme = await readRepoFile("README.md");
  const performanceDoc = await readRepoFile(performanceDocRelativePath);
  const perfRunner = await readRepoFile("template/react-mui-app/scripts/perf-runner.mjs");
  const devWorkflow = await readRepoFile(".github/workflows/dev-quality-gate.yml");
  const releaseWorkflow = await readRepoFile(".github/workflows/release-gate.yml");
  const changesetsWorkflow = await readRepoFile(".github/workflows/changesets-release.yml");

  await access(path.resolve(packageRoot, baselineRelativePath));
  await access(path.resolve(packageRoot, performanceDocRelativePath));

  const devPerfJob = getJobSlice(devWorkflow, "  performance-web:\n");
  const releasePerfJob = getJobSlice(releaseWorkflow, "  performance-web:\n");
  const changesetsPerfJob = getJobSlice(changesetsWorkflow, "  performance-web:\n");

  assert.match(readme, /template\/react-mui-app\/perf-baseline\.json/);
  assert.match(readme, /docs\/react-web-performance\.md/);

  assert.match(performanceDoc, /template\/react-mui-app\/perf-budget\.json/);
  assert.match(performanceDoc, /template\/react-mui-app\/perf-baseline\.json/);
  assert.match(performanceDoc, /release-gate\.yml/);
  assert.match(performanceDoc, /changesets-release\.yml/);
  assert.match(performanceDoc, /dev-quality-gate\.yml/);
  assert.match(performanceDoc, /lcp_p75_ms/);
  assert.match(performanceDoc, /cls_p75/);
  assert.match(performanceDoc, /pnpm --dir template\/react-mui-app run perf:baseline/);
  assert.match(performanceDoc, /pnpm --dir template\/react-mui-app run perf:assert/);
  assert.match(perfRunner, /path\.join\(process\.cwd\(\), "perf-baseline\.json"\)/);

  for (const workflow of [devPerfJob, releasePerfJob, changesetsPerfJob]) {
    assert.match(workflow, /FIGMAPIPE_PERF_BASELINE_PATH: template\/react-mui-app\/perf-baseline\.json/);
    assert.match(workflow, /FIGMAPIPE_PERF_ALLOW_BASELINE_BOOTSTRAP: "false"/);
  }

  assert.match(devPerfJob, /continue-on-error: true/);
  assert.match(devPerfJob, /warn-only/);

  assert.doesNotMatch(releasePerfJob, /continue-on-error: true/);
  assert.doesNotMatch(changesetsPerfJob, /continue-on-error: true/);
  assert.doesNotMatch(releasePerfJob, /warn-only/);
  assert.doesNotMatch(changesetsPerfJob, /warn-only/);
});
