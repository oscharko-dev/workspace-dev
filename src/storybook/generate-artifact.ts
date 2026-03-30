import path from "node:path";
import {
  generateStorybookEvidenceArtifact,
  getDefaultStorybookBuildDir
} from "./evidence.js";

const run = async (): Promise<void> => {
  const buildDir = process.argv[2] ?? getDefaultStorybookBuildDir();
  const outputFilePath = process.argv[3] ? path.resolve(process.cwd(), process.argv[3]) : undefined;
  const { artifact, outputPath } = await generateStorybookEvidenceArtifact({
    buildDir,
    ...(outputFilePath ? { outputFilePath } : {})
  });
  process.stdout.write(
    `${JSON.stringify(
      {
        outputPath,
        evidenceCount: artifact.stats.evidenceCount,
        entryCount: artifact.stats.entryCount
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
