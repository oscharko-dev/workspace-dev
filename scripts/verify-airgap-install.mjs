#!/usr/bin/env node

import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";
import {
  defaultBuildProfileIds,
  profileDefinitions,
  resolveBuildProfiles,
} from "./pack-profile-contract.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(__dirname, "..");
const workspaceDevLauncher = "pnpm";
const workspaceDevLauncherArgs = ["exec", "workspace-dev"];

const parseArgs = (argv) => {
  const profiles = [];

  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    if (current === "--profile" || current === "-p") {
      const next = argv[index + 1];
      if (!next) {
        throw new Error(`Missing value for ${current}.`);
      }
      profiles.push(next);
      index += 1;
      continue;
    }
    if (current.startsWith("--profile=")) {
      profiles.push(current.slice("--profile=".length));
      continue;
    }
    if (!current.startsWith("-")) {
      profiles.push(current);
      continue;
    }
    throw new Error(`Unknown argument: ${current}`);
  }

  return profiles.length > 0 ? resolveBuildProfiles(profiles) : defaultBuildProfileIds;
};

const resolveCommandEnv = () => {
  const commandEnv = {
    ...process.env,
    npm_config_registry: "http://127.0.0.1:9",
    npm_config_audit: "false",
    npm_config_fund: "false",
  };

  // npm publish --dry-run propagates this flag into lifecycle scripts.
  // The airgap check must perform a real local install of the tarball.
  delete commandEnv.npm_config_dry_run;
  delete commandEnv.NPM_CONFIG_DRY_RUN;

  return commandEnv;
};

const run = ({ command, args, cwd }) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: resolveCommandEnv(),
      stdio: "inherit",
    });

    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(
        new Error(
          `Command failed with exit code ${code ?? 1}: ${command} ${args.join(" ")} (cwd=${cwd})`,
        ),
      );
    });
  });

const runWorkspaceDev = async ({ args, cwd }) =>
  await run({
    command: workspaceDevLauncher,
    args: [...workspaceDevLauncherArgs, ...args],
    cwd,
  });

const spawnWorkspaceDev = ({ args, cwd, stdio }) =>
  spawn(workspaceDevLauncher, [...workspaceDevLauncherArgs, ...args], {
    cwd,
    env: resolveCommandEnv(),
    stdio,
  });

const delay = async (milliseconds) =>
  await new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });

const getAvailableLoopbackPort = async (host = "127.0.0.1") =>
  await new Promise((resolve, reject) => {
    const server = createServer();

    server.unref();
    server.once("error", reject);
    server.listen(0, host, () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close(() => {
          reject(new Error("Failed to allocate an available loopback port."));
        });
        return;
      }

      const { port } = address;
      server.close(() => {
        resolve(port);
      });
    });
  });

const formatChildOutput = (output) => {
  const trimmed = output.trim();
  return trimmed.length > 0 ? `\n\nChild output:\n${trimmed}` : "";
};

const createChildExitError = (code, signal, output = "") =>
  Object.assign(
    new Error(
      `workspace-dev exited before readiness (code=${code ?? "unknown"}${signal ? `, signal=${signal}` : ""}).${formatChildOutput(output)}`,
    ),
    {
      name: "ChildProcessExitedError",
    },
  );

const createChildSpawnError = (error, output = "") =>
  Object.assign(error instanceof Error ? error : new Error(String(error)), {
    name: "ChildProcessSpawnError",
    message: `${error instanceof Error ? error.message : String(error)}${formatChildOutput(output)}`,
  });

const createBoundedOutputBuffer = (maxBytes = 32 * 1024) => {
  let buffered = "";

  const append = (chunk) => {
    const text = Buffer.isBuffer(chunk)
      ? chunk.toString("utf8")
      : String(chunk);
    buffered += text;
    if (buffered.length > maxBytes) {
      buffered = buffered.slice(buffered.length - maxBytes);
    }
  };

  const snapshot = () => buffered;

  return { append, snapshot };
};

const isChildProcessFailureError = (error) =>
  error instanceof Error &&
  (error.name === "ChildProcessExitedError" ||
    error.name === "ChildProcessSpawnError");

const waitForHttpOk = async ({
  baseUrl,
  expectedOutputRoot,
  child,
  output,
  paths,
  timeoutMs = 30_000,
}) => {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  let rejectChildFailure = () => {};
  const onChildError = (error) => {
    rejectChildFailure(createChildSpawnError(error, output.snapshot()));
  };
  const onChildExit = (code, signal) => {
    rejectChildFailure(createChildExitError(code, signal, output.snapshot()));
  };
  const childFailure = new Promise((_, reject) => {
    rejectChildFailure = reject;
    child.once("error", onChildError);
    child.once("exit", onChildExit);
  });

  try {
    while (Date.now() < deadline) {
      try {
        await Promise.race([
          (async () => {
            for (const pathname of paths) {
              const response = await fetch(new URL(pathname, baseUrl), {
                signal: AbortSignal.timeout(2_000),
              });

              if (response.status !== 200) {
                throw new Error(
                  `Expected 200 from ${pathname}, received ${response.status}.`,
                );
              }

              if (pathname === "/workspace") {
                const status = await response.json();
                if (typeof status !== "object" || status === null) {
                  throw new Error(
                    "Expected /workspace to return a JSON object.",
                  );
                }

                const outputRoot = status.outputRoot;
                if (outputRoot !== expectedOutputRoot) {
                  throw new Error(
                    `Expected /workspace outputRoot to equal ${expectedOutputRoot}, received ${String(outputRoot)}.`,
                  );
                }
              }
            }
          })(),
          childFailure,
        ]);

        return;
      } catch (error) {
        if (isChildProcessFailureError(error)) {
          throw error;
        }

        lastError = error;
        await Promise.race([delay(250), childFailure]);
      }
    }

    throw new Error(
      `Timed out waiting for ${paths.join(", ")} to return HTTP 200 at ${baseUrl}.` +
        (lastError instanceof Error
          ? ` Last error: ${lastError.message}`
          : "") +
        formatChildOutput(output.snapshot()),
    );
  } finally {
    child.off("error", onChildError);
    child.off("exit", onChildExit);
  }
};

const stopChildProcess = async (child, timeoutMs = 5_000) => {
  if (child.exitCode !== null || child.signalCode !== null) {
    return;
  }

  await new Promise((resolve, reject) => {
    let finished = false;
    const killTimeout = setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill("SIGKILL");
      }
    }, timeoutMs);

    const cleanup = () => {
      clearTimeout(killTimeout);
      child.off("error", onError);
      child.off("exit", onExit);
    };

    const finish = () => {
      if (finished) {
        return;
      }
      finished = true;
      cleanup();
      resolve();
    };

    const fail = (error) => {
      if (finished) {
        return;
      }
      finished = true;
      cleanup();
      reject(error);
    };

    const onError = (error) => {
      fail(error);
    };

    const onExit = () => {
      finish();
    };

    child.once("error", onError);
    child.once("exit", onExit);

    if (child.exitCode !== null || child.signalCode !== null) {
      finish();
      return;
    }

    try {
      child.kill("SIGTERM");
    } catch (error) {
      fail(error);
    }
  });
};

const verifyProfileAirgap = async (profile) => {
  const tmpRoot = await mkdtemp(
    path.join(os.tmpdir(), `workspace-dev-${profile.id}-airgap-`),
  );
  const packDir = path.join(tmpRoot, "pack");
  const installDir = path.join(tmpRoot, "install");
  const host = "127.0.0.1";
  let startChild;
  const startOutput = createBoundedOutputBuffer();

  try {
    await run({
      command: "node",
      args: [
        "scripts/build-profile.mjs",
        "--skip-build",
        "--profile",
        profile.id,
        "--pack-destination",
        packDir,
      ],
      cwd: packageRoot,
    });

    const files = await readdir(packDir);
    const tarball = files.find((file) => file.endsWith(".tgz"));
    if (!tarball) {
      throw new Error("pnpm pack did not produce a tarball.");
    }

    const tarballPath = path.join(packDir, tarball);
    await mkdir(installDir, { recursive: true });
    await writeFile(
      path.join(installDir, "package.json"),
      `${JSON.stringify(
        {
          name: "workspace-dev-airgap-smoke",
          private: true,
          version: "1.0.0",
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    await run({
      command: "npm",
      args: ["install", "--offline", "--ignore-scripts", tarballPath],
      cwd: installDir,
    });

    await runWorkspaceDev({
      args: ["--help"],
      cwd: installDir,
    });

    await run({
      command: "node",
      args: [
        "--input-type=module",
        "-e",
        "const mod = await import('workspace-dev'); if (typeof mod.createWorkspaceServer !== 'function') throw new Error('ESM import failed');",
      ],
      cwd: installDir,
    });

    await run({
      command: "node",
      args: [
        "-e",
        "const mod = require('workspace-dev'); if (typeof mod.createWorkspaceServer !== 'function') throw new Error('CJS require failed');",
      ],
      cwd: installDir,
    });

    const port = await getAvailableLoopbackPort(host);
    const outputRoot = path.join(installDir, "output-root");
    await mkdir(outputRoot, { recursive: true });

    startChild = spawnWorkspaceDev({
      args: [
        "start",
        "--host",
        host,
        "--port",
        String(port),
        "--output-root",
        outputRoot,
        "--preview",
        "true",
      ],
      cwd: installDir,
      stdio: ["ignore", "pipe", "pipe"],
    });

    startChild.stdout?.on("data", startOutput.append);
    startChild.stderr?.on("data", startOutput.append);

    await waitForHttpOk({
      baseUrl: `http://${host}:${port}`,
      child: startChild,
      output: startOutput,
      expectedOutputRoot: outputRoot,
      paths: ["/healthz", "/workspace", "/workspace/ui/inspector"],
    });

    await stopChildProcess(startChild);
    startChild = undefined;

    console.log(
      `[airgap] Offline install, bin, module, and start smoke checks passed for profile '${profile.id}'.`,
    );
  } finally {
    if (startChild) {
      try {
        await stopChildProcess(startChild);
      } catch {
        // Best-effort cleanup during teardown.
      }
    }
    await rm(tmpRoot, { recursive: true, force: true });
  }
};

const main = async () => {
  const profileIds = parseArgs(process.argv.slice(2));
  for (const profileId of profileIds) {
    const profile = profileDefinitions[profileId];
    await verifyProfileAirgap(profile);
  }
};

main().catch((error) => {
  console.error("[airgap] Offline install verification failed:", error);
  process.exit(1);
});

export { parseArgs as parseAirgapArgs };
