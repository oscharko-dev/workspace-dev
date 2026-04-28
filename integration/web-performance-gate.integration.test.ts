import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(__dirname, "..");
const templatePerformancePaths = [
  {
    packageDir: "template/react-mui-app",
    baseline: "template/react-mui-app/perf-baseline.json",
    budget: "template/react-mui-app/perf-budget.json",
    baselineCommand: /pnpm --dir template\/react-mui-app run perf:baseline/,
    assertCommand: /pnpm --dir template\/react-mui-app run perf:assert/,
  },
  {
    packageDir: "template/react-tailwind-app",
    baseline: "template/react-tailwind-app/perf-baseline.json",
    budget: "template/react-tailwind-app/perf-budget.json",
    baselineCommand:
      /pnpm --dir template\/react-tailwind-app run perf:baseline/,
    assertCommand: /pnpm --dir template\/react-tailwind-app run perf:assert/,
  },
] as const;
const performanceDocRelativePath = "docs/react-web-performance.md";

const readRepoFile = async (relativePath: string): Promise<string> => {
  return await readFile(path.resolve(packageRoot, relativePath), "utf8");
};

const getJobSlice = (workflow: string, marker: string): string => {
  const markerIndex = workflow.indexOf(marker);
  assert.notEqual(
    markerIndex,
    -1,
    `Expected workflow to contain marker '${marker}'.`,
  );
  const afterMarker = workflow.slice(markerIndex + marker.length);
  const nextJobIndex = afterMarker.search(/\n {2}[a-z0-9-]+:\n/);
  if (nextJobIndex === -1) {
    return workflow.slice(markerIndex);
  }
  return workflow.slice(
    markerIndex,
    markerIndex + marker.length + nextJobIndex,
  );
};

test("integration: web performance gate policy, baseline path, and docs stay aligned", async () => {
  const readme = await readRepoFile("README.md");
  const performanceDoc = await readRepoFile(performanceDocRelativePath);
  const perfRunner = await readRepoFile(
    "template/react-mui-app/scripts/perf-runner.mjs",
  );
  const devWorkflow = await readRepoFile(
    ".github/workflows/dev-quality-gate.yml",
  );
  const releaseWorkflow = await readRepoFile(
    ".github/workflows/release-gate.yml",
  );
  const changesetsWorkflow = await readRepoFile(
    ".github/workflows/changesets-release.yml",
  );

  await access(path.resolve(packageRoot, performanceDocRelativePath));
  for (const template of templatePerformancePaths) {
    await access(path.resolve(packageRoot, template.baseline));
  }

  const devPerfJob = getJobSlice(devWorkflow, "  performance-web:\n");
  const releasePerfJob = getJobSlice(releaseWorkflow, "  performance-web:\n");
  const changesetsPerfJob = getJobSlice(
    changesetsWorkflow,
    "  performance-web:\n",
  );

  assert.match(readme, /docs\/react-web-performance\.md/);

  for (const template of templatePerformancePaths) {
    assert.match(
      readme,
      new RegExp(template.baseline.replaceAll("/", "\\/").replace(".", "\\.")),
    );
    assert.match(
      performanceDoc,
      new RegExp(template.budget.replaceAll("/", "\\/").replace(".", "\\.")),
    );
    assert.match(
      performanceDoc,
      new RegExp(template.baseline.replaceAll("/", "\\/").replace(".", "\\.")),
    );
    assert.match(performanceDoc, template.baselineCommand);
    assert.match(performanceDoc, template.assertCommand);
  }
  assert.match(performanceDoc, /release-gate\.yml/);
  assert.match(performanceDoc, /changesets-release\.yml/);
  assert.match(performanceDoc, /dev-quality-gate\.yml/);
  assert.match(performanceDoc, /lcp_p75_ms/);
  assert.match(performanceDoc, /cls_p75/);
  assert.match(
    perfRunner,
    /path\.join\(process\.cwd\(\), "perf-baseline\.json"\)/,
  );

  for (const workflow of [devPerfJob, releasePerfJob, changesetsPerfJob]) {
    for (const template of templatePerformancePaths) {
      assert.match(
        workflow,
        new RegExp(`packageDir: ${template.packageDir.replaceAll("/", "\\/")}`),
      );
      assert.match(
        workflow,
        new RegExp(
          `lockfile: ${template.packageDir.replaceAll("/", "\\/")}\\/pnpm-lock\\.yaml`,
        ),
      );
    }
    assert.match(
      workflow,
      /FIGMAPIPE_PERF_BASELINE_PATH: \$\{\{ matrix\.template\.packageDir \}\}\/perf-baseline\.json/,
    );
    assert.match(workflow, /FIGMAPIPE_PERF_ALLOW_BASELINE_BOOTSTRAP: "false"/);
  }

  assert.match(devPerfJob, /continue-on-error: true/);
  assert.match(devPerfJob, /warn-only/);

  assert.doesNotMatch(releasePerfJob, /continue-on-error: true/);
  assert.doesNotMatch(changesetsPerfJob, /continue-on-error: true/);
  assert.doesNotMatch(releasePerfJob, /warn-only/);
  assert.doesNotMatch(changesetsPerfJob, /warn-only/);
});
