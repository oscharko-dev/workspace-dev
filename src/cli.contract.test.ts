import assert from "node:assert/strict";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { readFile } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createWorkspaceServer } from "./server.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cliSourcePath = path.resolve(__dirname, "cli.ts");
const packageJsonPath = path.resolve(__dirname, "../package.json");
const readmePath = path.resolve(__dirname, "../README.md");

interface CliResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

const runCliToExit = async ({
  args,
  env = {},
  timeoutMs = 8_000
}: {
  args: string[];
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
}): Promise<CliResult> => {
  return await new Promise<CliResult>((resolve, reject) => {
    const child = spawn(process.execPath, ["--import", "tsx", cliSourcePath, ...args], {
      env: {
        ...process.env,
        ...env
      },
      stdio: ["ignore", "pipe", "pipe"]
    });

    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`CLI timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");

    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });

    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });

    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });

    child.on("exit", (code) => {
      clearTimeout(timer);
      resolve({
        exitCode: code ?? 1,
        stdout,
        stderr
      });
    });
  });
};

const acquireFreePort = async (): Promise<number> => {
  return await new Promise<number>((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close(() => reject(new Error("Failed to resolve free port")));
        return;
      }
      const port = address.port;
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(port);
      });
    });
    server.on("error", reject);
  });
};

const waitForStdout = async (
  child: ChildProcessWithoutNullStreams,
  pattern: RegExp,
  timeoutMs = 8_000
): Promise<string> => {
  return await new Promise<string>((resolve, reject) => {
    let output = "";
    const timer = setTimeout(() => {
      reject(new Error(`Timed out waiting for output pattern ${pattern}`));
    }, timeoutMs);

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      output += chunk;
      if (pattern.test(output)) {
        clearTimeout(timer);
        resolve(output);
      }
    });

    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });

    child.on("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`CLI exited before ready signal (exit=${code ?? "unknown"})`));
    });
  });
};

const waitForExitCode = async (child: ChildProcessWithoutNullStreams, timeoutMs = 8_000): Promise<number> => {
  return await new Promise<number>((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`Timed out waiting for process exit after ${timeoutMs}ms`));
    }, timeoutMs);

    child.on("exit", (code) => {
      clearTimeout(timer);
      resolve(code ?? 1);
    });

    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
};

test("cli contract: --help prints usage and exits with code 0", async () => {
  const result = await runCliToExit({ args: ["--help"] });
  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, /workspace-dev start/i);
  assert.match(result.stdout, /FIGMAPIPE_WORKSPACE_OUTPUT_ROOT/i);
  assert.match(result.stdout, /FIGMAPIPE_WORKSPACE_FIGMA_BOOTSTRAP_DEPTH/i);
  assert.match(result.stdout, /FIGMAPIPE_WORKSPACE_FIGMA_CACHE_TTL_MS/i);
  assert.match(result.stdout, /FIGMAPIPE_WORKSPACE_ICON_MAP_FILE/i);
  assert.match(result.stdout, /FIGMAPIPE_WORKSPACE_FIGMA_SCREEN_NAME_PATTERN/i);
  assert.match(result.stdout, /FIGMAPIPE_WORKSPACE_FIGMA_SCREEN_ELEMENT_MAX_DEPTH/i);
  assert.match(result.stdout, /FIGMAPIPE_WORKSPACE_BRAND/i);
  assert.match(result.stdout, /FIGMAPIPE_WORKSPACE_SKIP_INSTALL/i);
  assert.match(result.stdout, /--no-cache/i);
  assert.match(result.stdout, /--icon-map-file/i);
  assert.match(result.stdout, /--skip-install/i);
  assert.match(result.stdout, /--figma-screen-name-pattern/i);
  assert.match(result.stdout, /--brand/i);
  assert.match(result.stdout, /--figma-screen-element-budget/i);
  assert.match(result.stdout, /--figma-screen-element-max-depth/i);
  assert.match(result.stdout, /workspace\/jobs\/\:id/i);
});

test("cli contract: unknown command exits with code 1", async () => {
  const result = await runCliToExit({ args: ["nope"] });
  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /Unknown command/i);
});

test("cli contract: CLI flag overrides environment port", async () => {
  const envPort = await acquireFreePort();
  const cliPort = await acquireFreePort();

  const child = spawn(process.execPath, ["--import", "tsx", cliSourcePath, "start", "--port", String(cliPort)], {
    env: {
      ...process.env,
      FIGMAPIPE_WORKSPACE_PORT: String(envPort),
      FIGMAPIPE_WORKSPACE_HOST: "127.0.0.1"
    },
    stdio: ["ignore", "pipe", "pipe"]
  });

  try {
    await waitForStdout(child, /Server ready at/i);

    const response = await fetch(`http://127.0.0.1:${cliPort}/workspace`);
    assert.equal(response.status, 200);

    const body = (await response.json()) as Record<string, unknown>;
    assert.equal(body.port, cliPort);
  } finally {
    child.kill("SIGTERM");
    const exitCode = await waitForExitCode(child, 8_000);
    assert.equal(exitCode, 0);
  }
});

test("cli contract: perf validation flag is applied and logged", async () => {
  const port = await acquireFreePort();
  const child = spawn(process.execPath, ["--import", "tsx", cliSourcePath, "start", "--port", String(port), "--perf-validation", "true"], {
    env: {
      ...process.env,
      FIGMAPIPE_WORKSPACE_HOST: "127.0.0.1"
    },
    stdio: ["ignore", "pipe", "pipe"]
  });

  try {
    const output = await waitForStdout(child, /Perf validation enabled: true/i);
    assert.match(output, /Perf validation enabled: true/i);
  } finally {
    child.kill("SIGTERM");
    const exitCode = await waitForExitCode(child, 8_000);
    assert.equal(exitCode, 0);
  }
});

test("cli contract: --skip-install is applied and logged", async () => {
  const port = await acquireFreePort();
  const child = spawn(process.execPath, ["--import", "tsx", cliSourcePath, "start", "--port", String(port), "--skip-install"], {
    env: {
      ...process.env,
      FIGMAPIPE_WORKSPACE_HOST: "127.0.0.1"
    },
    stdio: ["ignore", "pipe", "pipe"]
  });

  try {
    const output = await waitForStdout(child, /Skip install: true/i);
    assert.match(output, /Skip install: true/i);
  } finally {
    child.kill("SIGTERM");
    const exitCode = await waitForExitCode(child, 8_000);
    assert.equal(exitCode, 0);
  }
});

test("cli contract: --no-cache disables figma cache and is logged", async () => {
  const port = await acquireFreePort();
  const child = spawn(process.execPath, ["--import", "tsx", cliSourcePath, "start", "--port", String(port), "--no-cache"], {
    env: {
      ...process.env,
      FIGMAPIPE_WORKSPACE_HOST: "127.0.0.1"
    },
    stdio: ["ignore", "pipe", "pipe"]
  });

  try {
    const output = await waitForStdout(child, /Figma cache enabled: false/i);
    assert.match(output, /Figma cache enabled: false/i);
  } finally {
    child.kill("SIGTERM");
    const exitCode = await waitForExitCode(child, 8_000);
    assert.equal(exitCode, 0);
  }
});

test("cli contract: --figma-screen-name-pattern is applied and logged", async () => {
  const port = await acquireFreePort();
  const child = spawn(
    process.execPath,
    ["--import", "tsx", cliSourcePath, "start", "--port", String(port), "--figma-screen-name-pattern", "^auth/"],
    {
      env: {
        ...process.env,
        FIGMAPIPE_WORKSPACE_HOST: "127.0.0.1"
      },
      stdio: ["ignore", "pipe", "pipe"]
    }
  );

  try {
    const output = await waitForStdout(child, /Figma screen name pattern: \^auth\//i);
    assert.match(output, /Figma screen name pattern: \^auth\//i);
  } finally {
    child.kill("SIGTERM");
    const exitCode = await waitForExitCode(child, 8_000);
    assert.equal(exitCode, 0);
  }
});

test("cli contract: --icon-map-file is applied and logged", async () => {
  const port = await acquireFreePort();
  const child = spawn(
    process.execPath,
    ["--import", "tsx", cliSourcePath, "start", "--port", String(port), "--icon-map-file", "./tmp/icon-map.json"],
    {
      env: {
        ...process.env,
        FIGMAPIPE_WORKSPACE_HOST: "127.0.0.1"
      },
      stdio: ["ignore", "pipe", "pipe"]
    }
  );

  try {
    const output = await waitForStdout(child, /Icon fallback map file: .*tmp\/icon-map\.json/i);
    assert.match(output, /Icon fallback map file: .*tmp\/icon-map\.json/i);
  } finally {
    child.kill("SIGTERM");
    const exitCode = await waitForExitCode(child, 8_000);
    assert.equal(exitCode, 0);
  }
});

test("cli contract: --brand is applied and logged", async () => {
  const port = await acquireFreePort();
  const child = spawn(process.execPath, ["--import", "tsx", cliSourcePath, "start", "--port", String(port), "--brand", "sparkasse"], {
    env: {
      ...process.env,
      FIGMAPIPE_WORKSPACE_HOST: "127.0.0.1"
    },
    stdio: ["ignore", "pipe", "pipe"]
  });

  try {
    const output = await waitForStdout(child, /Brand theme default: sparkasse/i);
    assert.match(output, /Brand theme default: sparkasse/i);
  } finally {
    child.kill("SIGTERM");
    const exitCode = await waitForExitCode(child, 8_000);
    assert.equal(exitCode, 0);
  }
});

test("cli contract: --figma-screen-element-max-depth is applied and logged", async () => {
  const port = await acquireFreePort();
  const child = spawn(
    process.execPath,
    ["--import", "tsx", cliSourcePath, "start", "--port", String(port), "--figma-screen-element-max-depth", "7"],
    {
      env: {
        ...process.env,
        FIGMAPIPE_WORKSPACE_HOST: "127.0.0.1"
      },
      stdio: ["ignore", "pipe", "pipe"]
    }
  );

  try {
    const output = await waitForStdout(child, /Figma screen depth max: 7/i);
    assert.match(output, /Figma screen depth max: 7/i);
  } finally {
    child.kill("SIGTERM");
    const exitCode = await waitForExitCode(child, 8_000);
    assert.equal(exitCode, 0);
  }
});

test("cli contract: port collision returns deterministic error", async () => {
  const collisionPort = await acquireFreePort();
  const running = await createWorkspaceServer({ host: "127.0.0.1", port: collisionPort });

  try {
    const result = await runCliToExit({ args: ["start", "--port", String(collisionPort)] });
    assert.equal(result.exitCode, 1);
    assert.match(result.stderr, /Port .* is already in use/i);
    assert.match(result.stderr, /FIGMAPIPE_WORKSPACE_PORT/i);
  } finally {
    await running.app.close();
  }
});

test("cli contract: published binaries and quickstart command are in sync", async () => {
  const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8")) as {
    name: string;
    bin?: Record<string, string>;
  };
  const readme = await readFile(readmePath, "utf8");

  assert.equal(packageJson.name, "workspace-dev");
  assert.equal(packageJson.bin?.["workspace-dev"], "./dist/cli.js");
  assert.deepEqual(Object.keys(packageJson.bin ?? {}).sort(), ["workspace-dev"]);
  assert.match(readme, /npx workspace-dev start/i);
});
