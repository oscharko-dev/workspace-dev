import path from "node:path";
import {
  generateStorybookPublicArtifacts,
  getDefaultStorybookPublicOutputDir
} from "./public-extracts.js";
import {
  getDefaultStorybookBuildDir
} from "./evidence.js";

const run = async (): Promise<void> => {
  const buildDir = process.argv[2] ?? getDefaultStorybookBuildDir();
  const outputDirPath = process.argv[3] ? path.resolve(process.cwd(), process.argv[3]) : getDefaultStorybookPublicOutputDir();
  const { artifacts, outputDir, writtenFiles } = await generateStorybookPublicArtifacts({
    buildDir,
    outputDirPath
  });
  process.stdout.write(
    `${JSON.stringify(
      {
        outputDir,
        writtenFiles,
        tokenCount: artifacts.tokensArtifact.$extensions["io.github.oscharko-dev.workspace-dev"].stats.tokenCount,
        themeCount: artifacts.themesArtifact.$extensions["io.github.oscharko-dev.workspace-dev"].stats.themeCount,
        componentCount: artifacts.componentsArtifact.stats.componentCount
      },
      null,
      2
    )}\n`
  );
};

void run().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
