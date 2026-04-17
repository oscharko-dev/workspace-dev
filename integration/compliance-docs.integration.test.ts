import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(__dirname, "..");
const expectedWorkflowRelativePath = ".github/workflows/changesets-release.yml";
const staleWorkflowPattern = /npm-publish\.yml/;
const openVexPattern = /openvex/i;

const ignoredPublishedDocs = new Set([
  "CHANGELOG.md",
  "CONTRACT_CHANGELOG.md",
  "CODE_OF_CONDUCT.md",
]);

const escapeRegExp = (value: string): string => {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
};

const readRepoFile = async (relativePath: string): Promise<string> => {
  return await readFile(path.resolve(packageRoot, relativePath), "utf8");
};

const getPublishedDocumentationPaths = async (): Promise<string[]> => {
  const packageJson = JSON.parse(await readRepoFile("package.json")) as {
    files?: string[];
  };

  return (packageJson.files ?? [])
    .filter((entry) => entry.endsWith(".md"))
    .filter((entry) => !ignoredPublishedDocs.has(entry))
    .sort((left, right) => left.localeCompare(right));
};

test("integration: compliance docs reference the active release workflow and avoid stale workflow names", async () => {
  const complianceDoc = await readRepoFile("COMPLIANCE.md");
  const publishedDocumentationPaths = await getPublishedDocumentationPaths();
  const publishedDocs = await Promise.all(
    publishedDocumentationPaths.map(async (relativePath) => {
      return {
        relativePath,
        content: await readRepoFile(relativePath),
      };
    }),
  );
  const workflowPath = path.resolve(packageRoot, expectedWorkflowRelativePath);
  const workflowContent = await readFile(workflowPath, "utf8");

  assert.ok(publishedDocumentationPaths.includes("COMPLIANCE.md"));
  assert.match(
    complianceDoc,
    new RegExp(`\`${escapeRegExp(expectedWorkflowRelativePath)}\``),
  );
  assert.doesNotMatch(complianceDoc, staleWorkflowPattern);
  assert.doesNotMatch(complianceDoc, openVexPattern);

  await access(workflowPath);
  assert.match(workflowContent, /pnpm run release:changesets:publish/);
  assert.doesNotMatch(workflowContent, openVexPattern);

  for (const document of publishedDocs) {
    assert.doesNotMatch(
      document.content,
      staleWorkflowPattern,
      `Found stale workflow reference in ${document.relativePath}.`,
    );
    assert.doesNotMatch(
      document.content,
      openVexPattern,
      `Found stale OpenVEX reference in ${document.relativePath}.`,
    );
  }
});
