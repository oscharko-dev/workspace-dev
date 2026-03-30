import { generateStorybookEvidenceArtifact, getDefaultStorybookBuildDir } from "./evidence.js";

const run = async (): Promise<void> => {
  const buildDir = process.argv[2] ?? getDefaultStorybookBuildDir();
  const { artifact, outputPath } = await generateStorybookEvidenceArtifact({ buildDir });
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
