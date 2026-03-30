import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  buildStorybookEvidenceArtifact,
  getDefaultStorybookBuildDir,
  writeStorybookEvidenceArtifact
} from "../src/storybook/evidence.js";

test("storybook evidence integration: real static build produces deterministic evidence coverage", async () => {
  const buildDir = getDefaultStorybookBuildDir();

  const firstArtifact = await buildStorybookEvidenceArtifact({ buildDir });
  const secondArtifact = await buildStorybookEvidenceArtifact({ buildDir });

  assert.deepEqual(firstArtifact, secondArtifact);
  assert.equal(firstArtifact.stats.entryCount, 499);
  assert.ok(firstArtifact.stats.byType.story_componentPath > 0);
  assert.ok(firstArtifact.stats.byType.story_argTypes > 0);
  assert.ok(firstArtifact.stats.byType.story_args > 0);
  assert.ok(firstArtifact.stats.byType.story_design_link > 0);
  assert.ok(firstArtifact.stats.byType.theme_bundle > 0);
  assert.ok(firstArtifact.stats.byType.css > 0);
  assert.ok(firstArtifact.stats.byType.mdx_link > 0);
  assert.ok(firstArtifact.stats.byType.docs_image > 0);
  assert.ok(firstArtifact.stats.byType.docs_text > 0);

  for (const evidenceItem of firstArtifact.evidence.filter((item) => item.type === "docs_image")) {
    assert.equal(evidenceItem.reliability, "reference_only");
    assert.equal(evidenceItem.usage.canDriveTokens, false);
    assert.equal(evidenceItem.usage.canDriveProps, false);
    assert.equal(evidenceItem.usage.canDriveImports, false);
    assert.equal(evidenceItem.usage.canDriveStyling, false);
  }

  const tempBuildDir = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-storybook-evidence-integration-"));
  const outputPath = await writeStorybookEvidenceArtifact({
    buildDir: tempBuildDir,
    artifact: firstArtifact
  });
  const firstBytes = await readFile(outputPath, "utf8");
  const secondOutputPath = await writeStorybookEvidenceArtifact({
    buildDir: tempBuildDir,
    artifact: secondArtifact
  });
  const secondBytes = await readFile(secondOutputPath, "utf8");

  assert.equal(secondOutputPath, outputPath);
  assert.equal(firstBytes, secondBytes);
});
