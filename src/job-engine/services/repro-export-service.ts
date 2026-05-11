import path from "node:path";
import { copyFile, rm } from "node:fs/promises";
import { PIPELINE_QUALITY_PASSPORT_ARTIFACT_FILENAME } from "../../contracts/index.js";
import { copyDir } from "../fs-helpers.js";
import type { StageService } from "../pipeline/stage-service.js";
import { STAGE_ARTIFACT_KEYS } from "../pipeline/artifact-keys.js";

export const ReproExportService: StageService<void> = {
  stageName: "repro.export",
  execute: async (_input, context) => {
    const generatedProjectDir = await context.artifactStore.requirePath(STAGE_ARTIFACT_KEYS.generatedProject);
    await rm(context.paths.reproDir, { recursive: true, force: true });
    await copyDir({
      sourceDir: path.join(generatedProjectDir, "dist"),
      targetDir: context.paths.reproDir
    });
    const qualityPassportFile = await context.artifactStore.getPath(
      STAGE_ARTIFACT_KEYS.qualityPassportFile,
    );
    if (qualityPassportFile) {
      await copyFile(
        qualityPassportFile,
        path.join(
          context.paths.reproDir,
          PIPELINE_QUALITY_PASSPORT_ARTIFACT_FILENAME,
        ),
      );
    }
    await context.artifactStore.setPath({
      key: STAGE_ARTIFACT_KEYS.reproPath,
      stage: "repro.export",
      absolutePath: context.paths.reproDir
    });
  }
};
