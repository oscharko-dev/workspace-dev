import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const MODULE_DIR = typeof __dirname === "string" ? __dirname : path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(MODULE_DIR, "..");
const scriptPath = path.resolve(packageRoot, "scripts/check-source-compile-smoke.mjs");

const runCheck = async ({
  sourceFiles
}: {
  sourceFiles: Record<string, string>;
}): Promise<{ code: number; stdout: string; stderr: string; sourceRoot: string }> => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-source-compile-smoke-"));
  const sourceRoot = path.join(tempRoot, "src");

  try {
    await mkdir(sourceRoot, { recursive: true });
    const entries = Object.entries(sourceFiles).sort(([first], [second]) => first.localeCompare(second));
    for (const [relativePath, content] of entries) {
      const filePath = path.join(sourceRoot, relativePath);
      await mkdir(path.dirname(filePath), { recursive: true });
      await writeFile(filePath, content, "utf8");
    }

    const result = await new Promise<{ code: number; stdout: string; stderr: string }>((resolve, reject) => {
      const child = spawn(process.execPath, [scriptPath], {
        cwd: packageRoot,
        env: {
          ...process.env,
          WORKSPACE_DEV_SOURCE_COMPILE_SMOKE_ROOT: sourceRoot
        },
        stdio: ["ignore", "pipe", "pipe"]
      });

      let stdout = "";
      let stderr = "";

      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => {
        stdout += chunk;
      });
      child.stderr.on("data", (chunk: string) => {
        stderr += chunk;
      });
      child.on("error", (error) => {
        reject(error);
      });
      child.on("close", (code, signal) => {
        if (signal) {
          reject(new Error(`check-source-compile-smoke exited via signal '${signal}'.`));
          return;
        }
        resolve({
          code: code ?? 1,
          stdout,
          stderr
        });
      });
    });

    return {
      ...result,
      sourceRoot
    };
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
};

test("source compile smoke check passes for parser-clean source files", async () => {
  const result = await runCheck({
    sourceFiles: {
      "ok.ts": "export const answer = 42;\n",
      "nested/view.tsx": "export const View = () => <section>ok</section>;\n"
    }
  });

  assert.equal(result.code, 0, `Expected success, got stderr:\n${result.stderr}`);
  assert.match(result.stdout, /Parsed 2 TypeScript source files without errors\./);
  assert.equal(result.stderr, "");
});

test("source compile smoke check fails for syntax errors with file and position output", async () => {
  const result = await runCheck({
    sourceFiles: {
      "broken.ts": "export const broken = ;\n"
    }
  });

  assert.equal(result.code, 1, `Expected parser failure, got stdout:\n${result.stdout}`);
  assert.match(result.stderr, /\[source-compile-smoke\] Found 1 transpile diagnostic error\(s\)\./);
  assert.match(
    result.stderr,
    new RegExp(`${result.sourceRoot.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\/broken\\.ts:\\d+:\\d+ -`)
  );
  assert.match(result.stderr, /Expression expected\./);
});
