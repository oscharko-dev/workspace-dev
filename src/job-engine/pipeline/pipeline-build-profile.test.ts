import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";

type PipelineProfileProbe = {
  currentBuildProfileId: "default" | "rocket" | "default-rocket";
  currentBuildProfileIncludesDefault: boolean;
  currentBuildProfileIncludesRocket: boolean;
  currentBuildProfilePipelineIds: string[];
  registryIds: string[];
  selectedPipelineId: string;
};

const probeBuildProfile = (profile: string): PipelineProfileProbe => {
  const script = `
    (async () => {
      const buildProfile = await import("./src/job-engine/pipeline/pipeline-build-profile.ts");
      const selection = await import("./src/job-engine/pipeline/pipeline-selection.ts");
      const registry = selection.createDefaultPipelineRegistry();
      const selected = selection.selectPipelineDefinition({
        registry,
        sourceMode: "local_json",
        scope: "board",
      });

      process.stdout.write(JSON.stringify({
        currentBuildProfileId: buildProfile.CURRENT_BUILD_PROFILE_ID,
        currentBuildProfileIncludesDefault: buildProfile.CURRENT_BUILD_PROFILE_INCLUDES_DEFAULT,
        currentBuildProfileIncludesRocket: buildProfile.CURRENT_BUILD_PROFILE_INCLUDES_ROCKET,
        currentBuildProfilePipelineIds: buildProfile.CURRENT_BUILD_PROFILE_PIPELINE_IDS,
        registryIds: registry.listDescriptors().map((pipeline) => pipeline.id),
        selectedPipelineId: selected.id,
      }));
    })().catch((error) => {
      console.error(error);
      process.exit(1);
    });
  `;

  const output = execFileSync(
    "pnpm",
    ["exec", "tsx", "--eval", script],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      env: {
        ...process.env,
        WORKSPACE_DEV_PIPELINES: profile,
      },
    },
  );

  return JSON.parse(output.trim()) as PipelineProfileProbe;
};

const BUILD_PROFILES = [
  {
    profile: "default",
    currentBuildProfileId: "default",
    currentBuildProfileIncludesDefault: true,
    currentBuildProfileIncludesRocket: false,
    currentBuildProfilePipelineIds: ["default"],
    registryIds: ["default"],
    selectedPipelineId: "default",
  },
  {
    profile: "rocket",
    currentBuildProfileId: "rocket",
    currentBuildProfileIncludesDefault: false,
    currentBuildProfileIncludesRocket: true,
    currentBuildProfilePipelineIds: ["rocket"],
    registryIds: ["rocket"],
    selectedPipelineId: "rocket",
  },
  {
    profile: "default,rocket",
    currentBuildProfileId: "default-rocket",
    currentBuildProfileIncludesDefault: true,
    currentBuildProfileIncludesRocket: true,
    currentBuildProfilePipelineIds: ["default", "rocket"],
    registryIds: ["default", "rocket"],
    selectedPipelineId: "default",
  },
  {
    profile: "default-rocket",
    currentBuildProfileId: "default-rocket",
    currentBuildProfileIncludesDefault: true,
    currentBuildProfileIncludesRocket: true,
    currentBuildProfilePipelineIds: ["default", "rocket"],
    registryIds: ["default", "rocket"],
    selectedPipelineId: "default",
  },
  {
    profile: " default ",
    currentBuildProfileId: "default",
    currentBuildProfileIncludesDefault: true,
    currentBuildProfileIncludesRocket: false,
    currentBuildProfilePipelineIds: ["default"],
    registryIds: ["default"],
    selectedPipelineId: "default",
  },
] as const;

for (const {
  profile,
  currentBuildProfileId,
  currentBuildProfileIncludesDefault,
  currentBuildProfileIncludesRocket,
  currentBuildProfilePipelineIds,
  registryIds,
  selectedPipelineId,
} of BUILD_PROFILES) {
  test(`build profile '${profile}' filters the runtime registry`, () => {
    const probe = probeBuildProfile(profile);

    assert.equal(probe.currentBuildProfileId, currentBuildProfileId);
    assert.equal(
      probe.currentBuildProfileIncludesDefault,
      currentBuildProfileIncludesDefault,
    );
    assert.equal(
      probe.currentBuildProfileIncludesRocket,
      currentBuildProfileIncludesRocket,
    );
    assert.deepEqual(
      probe.currentBuildProfilePipelineIds,
      currentBuildProfilePipelineIds,
    );
    assert.deepEqual(probe.registryIds, registryIds);
    assert.equal(probe.selectedPipelineId, selectedPipelineId);
  });
}
