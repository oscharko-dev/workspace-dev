#!/usr/bin/env node

import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  extractLockfilePackageEntries,
  extractRootImporterPackages,
  matchesDeniedPackage,
} from "./check-default-template-denylist.mjs";
import {
  commonRequiredFiles,
  forbiddenPackagePathPatterns,
  normalizeBuildProfileId,
  profileDefinitions,
  profileTarballSizeBudgetsBytes,
  templateRequiredFiles,
} from "./pack-profile-contract.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(__dirname, "..");

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

const readJson = async (filePath) =>
  JSON.parse(await readFile(filePath, "utf8"));

const listTarball = async (tarballPath) =>
  (await run("tar", ["-tzf", tarballPath], { stdio: "pipe" }))
    .split(/\r?\n/u)
    .filter(Boolean)
    .sort((first, second) => first.localeCompare(second));

const extractTarball = async (tarballPath) => {
  const extractRoot = await mkdtemp(
    path.join(os.tmpdir(), "workspace-dev-pack-extract-"),
  );
  await run("tar", ["-xzf", tarballPath, "-C", extractRoot], {
    stdio: "ignore",
  });
  return extractRoot;
};

const formatBytes = (bytes) => `${bytes.toLocaleString("en-US")} bytes`;

const assertTarballSizeBudget = async ({ profile, tarballPath }) => {
  const tarballStat = await stat(tarballPath);
  const sizeBudgetBytes = profileTarballSizeBudgetsBytes[profile.id];
  if (tarballStat.size > sizeBudgetBytes) {
    throw new Error(
      `Profile '${profile.id}' tarball exceeds size budget: ${path.basename(tarballPath)} is ${formatBytes(tarballStat.size)} but the limit is ${formatBytes(sizeBudgetBytes)}.`,
    );
  }
};

const assertRequiredFiles = ({ files, profile }) => {
  const nonPackagePaths = files.filter((file) => !file.startsWith("package/"));
  if (nonPackagePaths.length > 0) {
    throw new Error(
      `Profile '${profile.id}' pack contains non-package tarball path(s):\n${nonPackagePaths
        .slice(0, 20)
        .join("\n")}`,
    );
  }

  const fileSet = new Set(
    files.map((file) => file.replace(/^package\//u, "")),
  );
  const requiredFiles = [
    ...commonRequiredFiles,
    ...profile.templates.flatMap(
      (templateId) => templateRequiredFiles[templateId],
    ),
  ];
  const missing = requiredFiles.filter(
    (relativePath) => !fileSet.has(relativePath),
  );
  if (missing.length > 0) {
    throw new Error(
      `Profile '${profile.id}' pack is missing required file(s):\n${missing.join("\n")}`,
    );
  }

  if (
    !files.some((file) => /^package\/dist\/ui\/assets\/.+\.js$/u.test(file))
  ) {
    throw new Error(
      `Profile '${profile.id}' pack is missing dist/ui JavaScript assets.`,
    );
  }
  if (
    !files.some((file) => /^package\/dist\/ui\/assets\/.+\.css$/u.test(file))
  ) {
    throw new Error(
      `Profile '${profile.id}' pack is missing dist/ui CSS assets.`,
    );
  }
};

const assertNoForbiddenPaths = ({ files, profile }) => {
  const violations = files.filter((file) =>
    forbiddenPackagePathPatterns.some((pattern) => pattern.test(file)),
  );
  if (!profile.templates.includes("react-tailwind-app")) {
    violations.push(
      ...files.filter((file) =>
        file.startsWith("package/template/react-tailwind-app/"),
      ),
    );
  }
  if (!profile.templates.includes("react-mui-app")) {
    violations.push(
      ...files.filter((file) =>
        file.startsWith("package/template/react-mui-app/"),
      ),
    );
  }
  if (violations.length > 0) {
    throw new Error(
      `Profile '${profile.id}' pack contains forbidden path(s):\n${[
        ...new Set(violations),
      ]
        .slice(0, 20)
        .join("\n")}`,
    );
  }
};

const assertManifestShape = (manifest, profile) => {
  const requiredStringFields = [
    "name",
    "version",
    "main",
    "module",
    "types",
    "license",
  ];
  const missingStringFields = requiredStringFields.filter(
    (field) =>
      typeof manifest[field] !== "string" || manifest[field].trim() === "",
  );
  if (missingStringFields.length > 0) {
    throw new Error(
      `Profile '${profile.id}' pack manifest is missing required field(s): ${missingStringFields.join(", ")}.`,
    );
  }
  if (manifest.dependencies !== undefined) {
    throw new Error(
      `Profile '${profile.id}' pack manifest must not include runtime dependencies.`,
    );
  }
  if (manifest.devDependencies !== undefined) {
    throw new Error(
      `Profile '${profile.id}' pack manifest must not include devDependencies.`,
    );
  }
  if (manifest.files !== undefined) {
    throw new Error(
      `Profile '${profile.id}' pack manifest must not include files.`,
    );
  }
  if (manifest.scripts !== undefined) {
    throw new Error(
      `Profile '${profile.id}' pack manifest must not include scripts.`,
    );
  }
  if (!manifest.exports || typeof manifest.exports !== "object") {
    throw new Error(
      `Profile '${profile.id}' pack manifest must include package exports.`,
    );
  }
  if (!manifest.bin || typeof manifest.bin["workspace-dev"] !== "string") {
    throw new Error(
      `Profile '${profile.id}' pack manifest must include the workspace-dev bin entry.`,
    );
  }
  if (manifest.peerDependencies?.typescript !== ">=5.0.0") {
    throw new Error(
      `Profile '${profile.id}' pack manifest must keep the TypeScript >=5.0.0 peer dependency.`,
    );
  }
  if (manifest.peerDependenciesMeta?.typescript?.optional !== true) {
    throw new Error(
      `Profile '${profile.id}' pack manifest must mark the TypeScript peer dependency optional.`,
    );
  }

  if (manifest.workspaceDev === undefined) {
    throw new Error(
      `Profile '${profile.id}' pack manifest is missing workspaceDev metadata.`,
    );
  }
  if (manifest.workspaceDev.buildProfile !== profile.id) {
    throw new Error(
      `Profile '${profile.id}' pack manifest buildProfile mismatch: expected '${profile.id}', found '${manifest.workspaceDev.buildProfile}'.`,
    );
  }
  if (
    !Array.isArray(manifest.workspaceDev.pipelineIds) ||
    manifest.workspaceDev.pipelineIds.length !== profile.pipelineIds.length ||
    manifest.workspaceDev.pipelineIds.some(
      (pipelineId, index) => pipelineId !== profile.pipelineIds[index],
    )
  ) {
    throw new Error(
      `Profile '${profile.id}' pack manifest pipelineIds mismatch: expected [${profile.pipelineIds.join(", ")}], found [${Array.isArray(manifest.workspaceDev.pipelineIds) ? manifest.workspaceDev.pipelineIds.join(", ") : ""}].`,
    );
  }
};

const runPackedRuntimeSmokes = async (packageRootPath) => {
  await run("node", [path.join(packageRootPath, "dist", "cli.js"), "--help"], {
    cwd: packageRootPath,
    stdio: "ignore",
  });

  await run(
    "node",
    [
      "--input-type=module",
      "-e",
      `
import { pathToFileURL } from "node:url";
const mod = await import(pathToFileURL(process.argv[1]).href);
if (typeof mod.createWorkspaceServer !== "function") {
  throw new Error("ESM import failed");
}
`,
      path.join(packageRootPath, "dist", "index.js"),
    ],
    { cwd: packageRootPath, stdio: "ignore" },
  );

  await run(
    "node",
    [
      "--input-type=module",
      "-e",
      `
import { pathToFileURL } from "node:url";
const mod = await import(pathToFileURL(process.argv[1]).href);
if (typeof mod.CONTRACT_VERSION !== "string" || !Array.isArray(mod.ALLOWED_FIGMA_SOURCE_MODES)) {
  throw new Error("contracts ESM import failed");
}
`,
      path.join(packageRootPath, "dist", "contracts", "index.js"),
    ],
    { cwd: packageRootPath, stdio: "ignore" },
  );

  await run(
    "node",
    [
      "-e",
      `
const mod = require(process.argv[1]);
if (typeof mod.CONTRACT_VERSION !== "string" || !Array.isArray(mod.ALLOWED_FIGMA_SOURCE_MODES)) {
  throw new Error("contracts CJS require failed");
}
`,
      path.join(packageRootPath, "dist", "contracts", "index.cjs"),
    ],
    { cwd: packageRootPath, stdio: "ignore" },
  );
};

const assertDefaultTemplateDependencies = async (extractRoot, profile) => {
  if (!profile.templates.includes("react-tailwind-app")) {
    return;
  }

  const templatePackageJsonPath = path.join(
    extractRoot,
    "package",
    "template",
    "react-tailwind-app",
    "package.json",
  );
  let packageJson;
  try {
    packageJson = await readJson(templatePackageJsonPath);
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return;
    }
    throw error;
  }

  const dependencySections = [
    packageJson.dependencies,
    packageJson.devDependencies,
    packageJson.optionalDependencies,
    packageJson.peerDependencies,
  ];
  const dependencyNames = dependencySections.flatMap((section) =>
    section && typeof section === "object" ? Object.keys(section) : [],
  );
  const denied = dependencyNames.filter(matchesDeniedPackage);
  if (denied.length > 0) {
    throw new Error(
      `Default template includes denied Rocket runtime dependencies: ${denied.join(", ")}`,
    );
  }

  const lockfilePath = path.join(
    extractRoot,
    "package",
    "template",
    "react-tailwind-app",
    "pnpm-lock.yaml",
  );
  const lockfile = await readFile(lockfilePath, "utf8");
  const deniedLockfilePackages = [
    ...extractRootImporterPackages(lockfile),
    ...extractLockfilePackageEntries(lockfile),
  ]
    .filter(({ packageName }) => matchesDeniedPackage(packageName))
    .map(({ packageName }) => packageName);
  if (deniedLockfilePackages.length > 0) {
    throw new Error(
      `Default template lockfile includes denied Rocket runtime dependencies: ${deniedLockfilePackages.join(", ")}`,
    );
  }
};

const validateTarball = async ({ profile, tarballPath }) => {
  await assertTarballSizeBudget({ profile, tarballPath });

  const files = await listTarball(tarballPath);
  assertRequiredFiles({ files, profile });
  assertNoForbiddenPaths({ files, profile });

  const extractRoot = await extractTarball(tarballPath);
  try {
    const extractedPackageRoot = path.join(extractRoot, "package");
    const manifest = await readJson(
      path.join(extractedPackageRoot, "package.json"),
    );
    assertManifestShape(manifest, profile);

    for (const templateId of profile.templates) {
      const templatePackageJsonPath = path.join(
        extractRoot,
        "package",
        "template",
        templateId,
        "package.json",
      );
      await stat(templatePackageJsonPath);
    }

    await runPackedRuntimeSmokes(extractedPackageRoot);
    await assertDefaultTemplateDependencies(extractRoot, profile);
  } finally {
    await rm(extractRoot, { recursive: true, force: true });
  }
};

export const validatePackProfileTarballs = async ({
  profileId,
  tarballPaths,
}) => {
  const normalizedProfileId = normalizeBuildProfileId(profileId);
  const profile = profileDefinitions[normalizedProfileId];
  if (!Array.isArray(tarballPaths) || tarballPaths.length === 0) {
    throw new Error(
      `Profile '${profile.id}' validation requires at least one tarball path.`,
    );
  }

  for (const rawTarballPath of tarballPaths) {
    const tarballPath = path.resolve(process.cwd(), rawTarballPath);
    await validateTarball({ profile, tarballPath });
  }
};

const printUsage = () => {
  console.log(
    [
      "Usage:",
      "  node scripts/validate-pack-profile.mjs --profile <default|rocket|default-rocket|default,rocket> <tarball...>",
      "",
      "Validates one or more npm pack tarballs against the selected build profile.",
    ].join("\n"),
  );
};

const parseArgs = (argv) => {
  const options = {
    help: false,
    profile: undefined,
    tarballPaths: [],
  };

  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    if (current === "--help" || current === "-h") {
      options.help = true;
      continue;
    }
    if (current === "--profile" || current === "-p") {
      const next = argv[index + 1];
      if (!next) {
        throw new Error(`Missing value for ${current}.`);
      }
      if (options.profile !== undefined) {
        throw new Error("Only one --profile value may be provided.");
      }
      options.profile = next;
      index += 1;
      continue;
    }
    if (current.startsWith("--profile=")) {
      if (options.profile !== undefined) {
        throw new Error("Only one --profile value may be provided.");
      }
      options.profile = current.slice("--profile=".length);
      continue;
    }
    if (current.startsWith("-")) {
      throw new Error(`Unknown argument: ${current}`);
    }
    options.tarballPaths.push(current);
  }

  return options;
};

const main = async () => {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printUsage();
    return;
  }
  if (options.profile === undefined) {
    throw new Error(
      "Missing required --profile <default|rocket|default-rocket|default,rocket>.",
    );
  }
  if (options.tarballPaths.length === 0) {
    throw new Error("Missing tarball path(s) to validate.");
  }

  await validatePackProfileTarballs({
    profileId: options.profile,
    tarballPaths: options.tarballPaths,
  });
};

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((error) => {
    console.error("[validate-pack-profile] Failed:", error);
    process.exit(1);
  });
}

export { parseArgs as parseValidatePackProfileArgs };
