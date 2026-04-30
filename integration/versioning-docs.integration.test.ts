import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { rootFileAllowlist } from "../scripts/pack-profile-contract.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(__dirname, "..");
const releaseWorkflowRelativePath = ".github/workflows/changesets-release.yml";

const readRepoFile = async (relativePath: string): Promise<string> => {
  return await readFile(path.resolve(packageRoot, relativePath), "utf8");
};

test("integration: published docs and release workflow stay aligned on versioning policy", async () => {
  const readmeDoc = await readRepoFile("README.md");
  const versioningDoc = await readRepoFile("VERSIONING.md");
  const contractChangelog = await readRepoFile("CONTRACT_CHANGELOG.md");
  const workflowPath = path.resolve(packageRoot, releaseWorkflowRelativePath);
  const workflowContent = await readFile(workflowPath, "utf8");

  await access(workflowPath);

  assert.ok(rootFileAllowlist.includes("VERSIONING.md"));
  assert.match(readmeDoc, /`VERSIONING\.md`/);
  assert.match(readmeDoc, /npm and GitHub Releases are the authoritative sources for published package versions/i);

  assert.match(versioningDoc, /npm and GitHub Releases are the authoritative sources for published package versions/i);
  assert.match(versioningDoc, /checked-in `package\.json` version in `dev`, `dev-gate`, or `main` can lag the latest published package version/i);
  assert.match(versioningDoc, /`CHANGELOG\.md` tracks package release history\./);
  assert.match(versioningDoc, /`CONTRACT_CHANGELOG\.md` tracks public contract history and contract bump rules\./);

  assert.match(contractChangelog, /Package version bumps are produced by Changesets and the publish workflow when a release is cut\./);
  assert.match(contractChangelog, /Consumers pin the package version from npm, not `CONTRACT_VERSION`\./);

  assert.match(workflowContent, /No changesets found and current version is not published yet\. Keeping package version as-is for first publish\./);
  assert.match(workflowContent, /No changesets found and current version already exists on npm\. Applying automatic patch version bump based on latest published version\./);
  assert.match(workflowContent, /npm version "\$\{NEXT_PATCH_VERSION\}" --no-git-tag-version/);
  assert.match(workflowContent, /Skipping direct git push to main because branch protection requires pull-request based updates\./);
});
