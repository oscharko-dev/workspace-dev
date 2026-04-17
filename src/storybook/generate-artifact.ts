import path from "node:path";
import { redactErrorChain } from "../error-sanitization.js";
import {
  buildStorybookCatalogArtifact,
  writeStorybookCatalogArtifact,
} from "./catalog.js";
import {
  buildStorybookPublicArtifacts,
  getDefaultStorybookPublicOutputDir,
  writeStorybookPublicArtifacts,
} from "./public-extracts.js";
import {
  buildStorybookEvidenceArtifact,
  getDefaultStorybookBuildDir,
  loadStorybookBuildContext,
} from "./evidence.js";

const run = async (): Promise<void> => {
  const buildDir = process.argv[2] ?? getDefaultStorybookBuildDir();
  const outputDirPath = process.argv[3]
    ? path.resolve(process.cwd(), process.argv[3])
    : getDefaultStorybookPublicOutputDir();
  const buildContext = await loadStorybookBuildContext({
    buildDir,
  });
  const evidenceArtifact = await buildStorybookEvidenceArtifact({
    buildDir,
    buildContext,
  });
  const catalogArtifact = await buildStorybookCatalogArtifact({
    buildDir,
    buildContext,
    evidenceArtifact,
  });
  const catalogPath = await writeStorybookCatalogArtifact({
    buildDir,
    artifact: catalogArtifact,
  });
  const artifacts = await buildStorybookPublicArtifacts({
    buildDir,
    buildContext,
    evidenceArtifact,
    catalogArtifact,
  });
  const { outputDir, writtenFiles } = await writeStorybookPublicArtifacts({
    artifacts,
    outputDirPath,
  });
  process.stdout.write(
    `${JSON.stringify(
      {
        outputDir,
        writtenFiles,
        catalogPath,
        catalogEntryCount: catalogArtifact.stats.entryCount,
        catalogFamilyCount: catalogArtifact.stats.familyCount,
        tokenCount:
          artifacts.tokensArtifact.$extensions[
            "io.github.oscharko-dev.workspace-dev"
          ].stats.tokenCount,
        themeCount:
          artifacts.themesArtifact.$extensions[
            "io.github.oscharko-dev.workspace-dev"
          ].stats.themeCount,
        componentCount: artifacts.componentsArtifact.stats.componentCount,
      },
      null,
      2,
    )}\n`,
  );
};

void run().catch((error: unknown) => {
  const sanitized = redactErrorChain(error);
  process.stderr.write(`${sanitized}\n`);
  process.exitCode = 1;
});
