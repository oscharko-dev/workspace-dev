import path from "node:path";
import { rm } from "node:fs/promises";
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
    await context.artifactStore.setPath({
      key: STAGE_ARTIFACT_KEYS.reproPath,
      stage: "repro.export",
      absolutePath: context.paths.reproDir
    });
  }
};
