import path from "node:path";
import { getDefaultStorybookBuildDir } from "./evidence.js";
import { generateStorybookPublicArtifacts } from "./public-extracts.js";

const run = async (): Promise<void> => {
  const buildDir = process.argv[2] ?? getDefaultStorybookBuildDir();
  const outputDirPath = process.argv[3] ? path.resolve(process.cwd(), process.argv[3]) : undefined;
  const { artifacts, outputDir, writtenFiles } = await generateStorybookPublicArtifacts({
    buildDir,
    ...(outputDirPath ? { outputDirPath } : {})
  });
  process.stdout.write(
    `${JSON.stringify(
      {
        outputDir,
        writtenFiles,
        entryCount: artifacts.componentsArtifact.stats.entryCount,
        tokenCount: artifacts.tokensArtifact.stats.tokenCount,
        themeCount: artifacts.themesArtifact.stats.themeCount,
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
