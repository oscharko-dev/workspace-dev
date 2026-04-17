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

test("integration: SBOM parity gate stays wired into scripts and workflows", async () => {
  const packageJson = JSON.parse(await readRepoFile("package.json")) as {
    scripts?: Record<string, string>;
  };
  const devQualityWorkflow = await readRepoFile(".github/workflows/dev-quality-gate.yml");
  const releaseGateWorkflow = await readRepoFile(".github/workflows/release-gate.yml");
  const changesetsReleaseWorkflow = await readRepoFile(".github/workflows/changesets-release.yml");

  assert.equal(packageJson.scripts?.["verify:sbom:parity"], "node scripts/check-sbom-parity.mjs");
  assert.match(packageJson.scripts?.["release:quality-gates"] ?? "", /pnpm run verify:sbom:parity/);
  assert.match(
    packageJson.scripts?.["release:quality-gates:publish-lifecycle"] ?? "",
    /pnpm run verify:sbom:parity/
  );

  for (const workflow of [devQualityWorkflow, releaseGateWorkflow]) {
    assert.match(workflow, /Verify SBOM parity/);
    assert.match(workflow, /pnpm run verify:sbom:parity/);
  }

  assert.match(changesetsReleaseWorkflow, /Verify SBOM parity/);
  assert.match(
    changesetsReleaseWorkflow,
    /node scripts\/check-sbom-parity\.mjs --directory "\$\{RELEASE_EVIDENCE_DIR\}\/sbom"/
  );
});
