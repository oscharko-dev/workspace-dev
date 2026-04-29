#!/usr/bin/env node

import { spawn } from "node:child_process";
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  utimes,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  distAllowlist,
  docsFileAllowlist,
  profileDefinitions,
  resolveBuildProfiles,
  rootFileAllowlist,
  templateFileAllowlists,
} from "./pack-profile-contract.mjs";
import { validatePackProfileTarballs } from "./validate-pack-profile.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(__dirname, "..");
const defaultPackDestination = path.join(
  packageRoot,
  "artifacts",
  "build-profiles",
);

const parseArgs = (argv) => {
  const options = {
    dryRun: false,
    json: false,
    packDestination: defaultPackDestination,
    printTarball: false,
    profiles: [],
    skipBuild: false,
    verify: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    if (current === "--dry-run") {
      options.dryRun = true;
      continue;
    }
    if (current === "--json") {
      options.json = true;
      continue;
    }
    if (current === "--print-tarball") {
      options.printTarball = true;
      continue;
    }
    if (current === "--skip-build") {
      options.skipBuild = true;
      continue;
    }
    if (current === "--verify") {
      options.verify = true;
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
    if (current === "--pack-destination") {
      const next = argv[index + 1];
      if (!next) {
        throw new Error("Missing value for --pack-destination.");
      }
      options.packDestination = path.resolve(packageRoot, next);
      index += 1;
      continue;
    }
    if (current.startsWith("--pack-destination=")) {
      options.packDestination = path.resolve(
        packageRoot,
        current.slice("--pack-destination=".length),
      );
      continue;
    }
    if (!current.startsWith("-")) {
      options.profiles.push(current);
      continue;
    }
    throw new Error(`Unknown argument: ${current}`);
  }

  if (options.profiles.length === 0) {
    options.profiles = ["default", "rocket", "default-rocket"];
  }

  return options;
};

const run = (
  command,
  args,
  { cwd = packageRoot, env = process.env, stdio = "inherit" } = {},
) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env,
      stdio,
    });

    let stdout = "";
    if (stdio === "pipe") {
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk) => {
        stdout += chunk;
      });
      child.stderr.pipe(process.stderr);
    }

    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0) {
        resolve(stdout);
        return;
      }
      reject(
        new Error(
          `Command failed with exit code ${code ?? 1}: ${command} ${args.join(" ")}`,
        ),
      );
    });
  });

const assertFileExists = async (relativePath) => {
  const absolutePath = path.join(packageRoot, relativePath);
  const fileStat = await stat(absolutePath);
  if (!fileStat.isFile()) {
    throw new Error(
      `Expected file allowlist entry to be a file: ${relativePath}`,
    );
  }
};

const copyAllowlistedPath = async ({ relativePath, stagingRoot }) => {
  const sourcePath = path.join(packageRoot, relativePath);
  const destinationPath = path.join(stagingRoot, relativePath);
  const sourceStat = await stat(sourcePath);
  await mkdir(path.dirname(destinationPath), { recursive: true });
  await cp(sourcePath, destinationPath, {
    dereference: false,
    errorOnExist: false,
    force: true,
    preserveTimestamps: true,
    recursive: sourceStat.isDirectory(),
  });
};

const createPackagedManifest = async (profile) => {
  const manifest = JSON.parse(
    await readFile(path.join(packageRoot, "package.json"), "utf8"),
  );
  delete manifest.devDependencies;
  delete manifest.files;
  delete manifest.scripts;
  manifest.workspaceDev = {
    ...(manifest.workspaceDev ?? {}),
    buildProfile: profile.id,
    pipelineIds: profile.pipelineIds,
  };
  return `${JSON.stringify(manifest, null, 2)}\n`;
};

const stagePackage = async ({ profile, stagingRoot }) => {
  const packageJsonStat = await stat(path.join(packageRoot, "package.json"));
  const stagedPackageJsonPath = path.join(stagingRoot, "package.json");
  await writeFile(
    stagedPackageJsonPath,
    await createPackagedManifest(profile),
    "utf8",
  );
  await utimes(
    stagedPackageJsonPath,
    packageJsonStat.atime,
    packageJsonStat.mtime,
  );

  for (const relativePath of [
    ...rootFileAllowlist,
    ...docsFileAllowlist,
    ...distAllowlist,
  ]) {
    await copyAllowlistedPath({ relativePath, stagingRoot });
  }

  for (const templateId of profile.templates) {
    const allowlist = templateFileAllowlists[templateId];
    for (const relativePath of allowlist) {
      await assertFileExists(relativePath);
      await copyAllowlistedPath({ relativePath, stagingRoot });
    }
  }
};

const selectPackedFilename = (value) => {
  if (!value || typeof value !== "object") {
    return "";
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const selected = selectPackedFilename(item);
      if (selected) {
        return selected;
      }
    }
    return "";
  }
  return typeof value.filename === "string" ? value.filename : "";
};

const packStagedPackage = async ({ packDestination, profile, stagingRoot }) => {
  const profilePackDestination = await mkdtemp(
    path.join(os.tmpdir(), `workspace-dev-${profile.id}-pack-`),
  );
  try {
    const stdout = await run(
      "pnpm",
      ["pack", "--json", "--pack-destination", profilePackDestination],
      {
        cwd: stagingRoot,
        env: {
          ...process.env,
          npm_config_ignore_scripts: "true",
          NPM_CONFIG_IGNORE_SCRIPTS: "true",
        },
        stdio: "pipe",
      },
    );

    const packedPath = selectPackedFilename(JSON.parse(stdout.trim()));
    if (!packedPath) {
      throw new Error("pnpm pack did not report a tarball path.");
    }

    const manifest = JSON.parse(
      await readFile(path.join(stagingRoot, "package.json"), "utf8"),
    );
    const packageName = String(manifest.name ?? "package")
      .replace(/^@/, "")
      .replace("/", "-");
    const packageVersion = String(manifest.version ?? "0.0.0");
    const finalTarball = path.join(
      packDestination,
      `${packageName}-${packageVersion}-${profile.id}.tgz`,
    );
    await mkdir(packDestination, { recursive: true });
    await rm(finalTarball, { force: true });
    await cp(packedPath, finalTarball);
    return finalTarball;
  } finally {
    await rm(profilePackDestination, { recursive: true, force: true });
  }
};

const buildProfile = async (profile) => {
  console.log(
    `[build-profile] Building profile '${profile.id}' (${profile.envValue}).`,
  );
  await run("pnpm", ["run", "build"], {
    env: {
      ...process.env,
      WORKSPACE_DEV_PIPELINES: profile.envValue,
    },
  });
};

const buildPlan = (profiles) =>
  profiles.map((profileId) => {
    const profile = profileDefinitions[profileId];
    return {
      profile: profile.id,
      pipelines: profile.pipelineIds,
      templates: profile.templates,
      allowlists: {
        dist: distAllowlist,
        docs: docsFileAllowlist,
        root: rootFileAllowlist,
        templates: Object.fromEntries(
          profile.templates.map((templateId) => [
            templateId,
            templateFileAllowlists[templateId],
          ]),
        ),
      },
    };
  });

const main = async () => {
  const options = parseArgs(process.argv.slice(2));
  const profileIds = resolveBuildProfiles(options.profiles);

  if (options.dryRun) {
    console.log(JSON.stringify(buildPlan(profileIds), null, 2));
    return;
  }

  const results = [];
  for (const profileId of profileIds) {
    const profile = profileDefinitions[profileId];
    if (!options.skipBuild) {
      await buildProfile(profile);
    }

    const stagingRoot = await mkdtemp(
      path.join(os.tmpdir(), `workspace-dev-${profile.id}-stage-`),
    );
    try {
      await stagePackage({ profile, stagingRoot });
      const tarballPath = await packStagedPackage({
        packDestination: options.packDestination,
        profile,
        stagingRoot,
      });
      if (options.verify) {
        await validatePackProfileTarballs({
          profileId: profile.id,
          tarballPaths: [tarballPath],
        });
      }
      results.push({ profile: profile.id, tarballPath });
      if (!options.json && !options.printTarball) {
        console.log(`[build-profile] Packed ${profile.id}: ${tarballPath}`);
      }
    } finally {
      await rm(stagingRoot, { recursive: true, force: true });
    }
  }

  if (options.json) {
    console.log(JSON.stringify(results, null, 2));
    return;
  }

  if (options.printTarball) {
    for (const result of results) {
      console.log(result.tarballPath);
    }
  }
};

main().catch((error) => {
  console.error("[build-profile] Failed:", error);
  process.exit(1);
});
