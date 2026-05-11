#!/usr/bin/env node

import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  createProfilePackageManifest,
  defaultBuildProfileIds,
  profileDefinitions,
  resolveBuildProfiles,
} from "./pack-profile-contract.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const defaultOutputDirectory = "artifacts/sbom/profiles";

const parseArgs = (argv) => {
  const options = {
    formats: ["cyclonedx", "spdx"],
    outputDirectory: defaultOutputDirectory,
    profiles: [],
  };

  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    if (current === "--format") {
      const next = argv[index + 1];
      if (!next) {
        throw new Error("Missing value for --format.");
      }
      options.formats = [next];
      index += 1;
      continue;
    }
    if (current.startsWith("--format=")) {
      options.formats = [current.slice("--format=".length)];
      continue;
    }
    if (current === "--output-directory") {
      const next = argv[index + 1];
      if (!next) {
        throw new Error("Missing value for --output-directory.");
      }
      options.outputDirectory = next;
      index += 1;
      continue;
    }
    if (current.startsWith("--output-directory=")) {
      options.outputDirectory = current.slice("--output-directory=".length);
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
    if (!current.startsWith("-")) {
      options.profiles.push(current);
      continue;
    }
    throw new Error(`Unknown argument: ${current}`);
  }

  for (const format of options.formats) {
    if (format !== "cyclonedx" && format !== "spdx") {
      throw new Error("Unsupported SBOM format. Expected cyclonedx or spdx.");
    }
  }

  return {
    ...options,
    profiles:
      options.profiles.length > 0
        ? resolveBuildProfiles(options.profiles)
        : defaultBuildProfileIds,
  };
};

const run = (command, args) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: repoRoot,
      env: process.env,
      stdio: "inherit",
    });

    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0) {
        resolve(undefined);
        return;
      }
      reject(
        new Error(
          `Command failed with exit code ${code ?? 1}: ${command} ${args.join(" ")}`,
        ),
      );
    });
  });

const writeProfilePackageRoot = async ({ baseManifest, profile }) => {
  const packageRoot = await mkdtemp(
    path.join(os.tmpdir(), `workspace-dev-${profile.id}-sbom-`),
  );
  const manifest = createProfilePackageManifest(baseManifest, profile);
  await writeFile(
    path.join(packageRoot, "package.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8",
  );
  return { manifest, packageRoot };
};

const writeProfileCycloneDxSbom = async ({ manifest, outputPath, profile }) => {
  const document = {
    bomFormat: "CycloneDX",
    specVersion: "1.5",
    version: 1,
    metadata: {
      component: {
        type: "library",
        name: manifest.name,
        version: manifest.version,
        purl: `pkg:npm/${manifest.name}@${manifest.version}`,
        licenses:
          typeof manifest.license === "string"
            ? [{ license: { id: manifest.license } }]
            : undefined,
        properties: [
          {
            name: "workspace-dev:buildProfile",
            value: profile.id,
          },
          {
            name: "workspace-dev:pipelineIds",
            value: profile.pipelineIds.join(","),
          },
        ],
      },
    },
    components: [],
  };
  await writeFile(outputPath, `${JSON.stringify(document, null, 2)}\n`, "utf8");
};

const generateProfileSbom = async ({
  baseManifest,
  format,
  outputDirectory,
  profile,
}) => {
  const { manifest, packageRoot } = await writeProfilePackageRoot({
    baseManifest,
    profile,
  });
  const extension = format === "cyclonedx" ? "cdx" : "spdx";
  const script =
    format === "cyclonedx"
      ? "scripts/generate-cyclonedx.mjs"
      : "scripts/generate-spdx.mjs";
  const outputPath = path.join(
    outputDirectory,
    `workspace-dev-${profile.id}.${extension}.json`,
  );

  try {
    if (format === "cyclonedx") {
      await writeProfileCycloneDxSbom({ manifest, outputPath, profile });
      console.log(
        `[sbom] Profile CycloneDX written to ${outputPath} (profile=${profile.id})`,
      );
      return;
    }

    await run("node", [
      script,
      outputPath,
      "--package-root",
      packageRoot,
    ]);
  } finally {
    await rm(packageRoot, { recursive: true, force: true });
  }
};

const main = async () => {
  const options = parseArgs(process.argv.slice(2));
  const outputDirectory = path.resolve(repoRoot, options.outputDirectory);
  await mkdir(outputDirectory, { recursive: true });

  const baseManifest = JSON.parse(
    await readFile(path.join(repoRoot, "package.json"), "utf8"),
  );

  for (const profileId of options.profiles) {
    const profile = profileDefinitions[profileId];
    for (const format of options.formats) {
      await generateProfileSbom({
        baseManifest,
        format,
        outputDirectory,
        profile,
      });
    }
  }
};

main().catch((error) => {
  console.error("[sbom] Profile SBOM generation failed:", error);
  process.exit(1);
});

export { parseArgs as parseGenerateProfileSbomsArgs };
