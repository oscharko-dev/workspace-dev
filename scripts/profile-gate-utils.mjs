import { profileDefinitions, resolveBuildProfiles } from "./pack-profile-contract.mjs";

export const defaultProfileIds = Object.keys(profileDefinitions);

export const parseProfileGateArgs = (
  argv,
  { allowDryRun = false, allowNpmSbomSmoke = false } = {},
) => {
  const options = {
    dryRun: false,
    npmSbomSmoke: process.env.WORKSPACE_DEV_NPM_SBOM_SMOKE === "true",
    profiles: [],
  };

  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    if (!current) {
      continue;
    }
    if (allowDryRun && current === "--dry-run") {
      options.dryRun = true;
      continue;
    }
    if (allowNpmSbomSmoke && current === "--npm-sbom-smoke") {
      options.npmSbomSmoke = true;
      continue;
    }
    if (allowNpmSbomSmoke && current === "--no-npm-sbom-smoke") {
      options.npmSbomSmoke = false;
      continue;
    }
    if (current === "--profile" || current === "-p") {
      const next = argv[index + 1];
      if (!next) {
        throw new Error(`Missing value for ${current}.`);
      }
      options.profiles.push(next);
      index += 1;
      continue;
    }
    if (current.startsWith("--profile=")) {
      options.profiles.push(current.slice("--profile=".length));
      continue;
    }
    throw new Error(`Unknown argument: ${current}`);
  }

  return {
    ...options,
    profileIds: resolveBuildProfiles(
      options.profiles.length > 0 ? options.profiles : defaultProfileIds,
    ),
  };
};

export const profilesFromIds = (profileIds) =>
  profileIds.map((profileId) => profileDefinitions[profileId]);

export const envForProfile = (profile, env = process.env) => ({
  ...env,
  WORKSPACE_DEV_PIPELINES: profile.envValue,
});

export const templateMetadata = {
  "react-mui-app": {
    label: "figma-generated-app-react-mui",
    packageRoot: "template/react-mui-app",
  },
  "react-tailwind-app": {
    label: "figma-generated-app-react-tailwind",
    packageRoot: "template/react-tailwind-app",
  },
};

export const sbomDocumentsForProfile = (profile) => [
  {
    label: "workspace-dev",
    packageRoot: ".",
    cyclonedxFileName: "workspace-dev.cdx.json",
    spdxFileName: "workspace-dev.spdx.json",
  },
  ...profile.templates.map((templateId) => {
    const template = templateMetadata[templateId];
    return {
      label: template.label,
      packageRoot: template.packageRoot,
      cyclonedxFileName: `${template.label}.cdx.json`,
      spdxFileName: `${template.label}.spdx.json`,
    };
  }),
];
