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

const extractWorkflowJobBlock = ({
  workflow,
  marker,
}: {
  workflow: string;
  marker: string;
}): string => {
  const markerIndex = workflow.indexOf(marker);
  assert.notEqual(markerIndex, -1, `Expected workflow to contain marker '${marker}'.`);
  const afterMarker = workflow.slice(markerIndex + marker.length);
  const nextJobMatch = afterMarker.match(/^  [a-z0-9-]+:\n/m);
  if (!nextJobMatch || nextJobMatch.index === undefined) {
    return workflow.slice(markerIndex);
  }
  return workflow.slice(markerIndex, markerIndex + marker.length + nextJobMatch.index);
};

test("integration: paste delta benchmark config, docs, and workflow stay aligned", async () => {
  const packageJson = JSON.parse(await readRepoFile("package.json")) as {
    scripts?: Record<string, string>;
  };
  const contributingDoc = await readRepoFile("CONTRIBUTING.md");
  const visualBenchmarkWorkflow = await readRepoFile(
    ".github/workflows/visual-benchmark.yml",
  );

  assert.equal(
    packageJson.scripts?.["benchmark:paste-delta"],
    "tsx integration/paste-delta-benchmark.ts",
  );

  assert.match(contributingDoc, /pnpm benchmark:paste-delta/);
  assert.match(contributingDoc, /artifacts\/testing\/paste-delta-benchmark\.json/);
  assert.match(contributingDoc, /30% wall-clock reduction/i);
  assert.match(contributingDoc, /80th percentile/i);

  const benchmarkJobBlock = extractWorkflowJobBlock({
    workflow: visualBenchmarkWorkflow,
    marker: "  benchmark:\n",
  });
  assert.match(benchmarkJobBlock, /paste-delta-benchmark\.test\.ts/);
  assert.match(benchmarkJobBlock, /paste-delta-benchmark\.integration\.test\.ts/);
  assert.match(benchmarkJobBlock, /paste-delta-roots\.test\.ts/);
  assert.match(benchmarkJobBlock, /pnpm run benchmark:paste-delta -- --check/);
  assert.match(benchmarkJobBlock, /artifacts\/testing\/paste-delta-benchmark\.json/);

  for (const requiredPath of [
    'src/job-engine.ts',
    'src/server/request-handler.ts',
    'integration/paste-delta-benchmark*',
    'package.json',
  ]) {
    assert.match(visualBenchmarkWorkflow, new RegExp(requiredPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});
