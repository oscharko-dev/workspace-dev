import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { parseValidationDiagnostics, runValidationFeedback } from "./validation-feedback.js";

const linkLocalTypescript = async ({ generatedProjectDir }: { generatedProjectDir: string }): Promise<void> => {
  const repositoryTypescriptPath = path.resolve(process.cwd(), "node_modules", "typescript");
  await access(repositoryTypescriptPath);
  const nodeModulesDir = path.join(generatedProjectDir, "node_modules");
  await mkdir(nodeModulesDir, { recursive: true });
  await symlink(repositoryTypescriptPath, path.join(nodeModulesDir, "typescript"));
};

const writeMinimalProject = async ({
  generatedProjectDir,
  source
}: {
  generatedProjectDir: string;
  source: string;
}): Promise<void> => {
  await writeFile(path.join(generatedProjectDir, "package.json"), '{"name":"generated-app","private":true}\n', "utf8");
  await writeFile(
    path.join(generatedProjectDir, "tsconfig.json"),
    `${JSON.stringify(
      {
        compilerOptions: {
          target: "ES2022",
          module: "ESNext",
          moduleResolution: "Bundler",
          strict: true,
          noUnusedLocals: true
        },
        include: ["src/**/*.ts", "src/**/*.tsx"]
      },
      null,
      2
    )}\n`,
    "utf8"
  );
  await mkdir(path.join(generatedProjectDir, "src"), { recursive: true });
  await writeFile(path.join(generatedProjectDir, "src", "math.ts"), "export const add = (a: number, b: number): number => a + b;\n", "utf8");
  await writeFile(path.join(generatedProjectDir, "src", "main.ts"), source, "utf8");
};

test("parseValidationDiagnostics parses eslint stylish diagnostics", () => {
  const generatedProjectDir = "/tmp/generated-project";
  const filePath = path.join(generatedProjectDir, "src", "main.ts");
  const output = `${filePath}\n  1:15  error  'unused' is defined but never used  @typescript-eslint/no-unused-vars`;

  const diagnostics = parseValidationDiagnostics({
    stage: "lint",
    output,
    generatedProjectDir
  });

  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0]?.stage, "lint");
  assert.equal(diagnostics[0]?.filePath, filePath);
  assert.equal(diagnostics[0]?.line, 1);
  assert.equal(diagnostics[0]?.column, 15);
  assert.equal(diagnostics[0]?.rule, "@typescript-eslint/no-unused-vars");
});

test("parseValidationDiagnostics parses TypeScript diagnostics", () => {
  const generatedProjectDir = "/tmp/generated-project";
  const output = "src/main.ts(3,9): error TS2304: Cannot find name 'Button'.";

  const diagnostics = parseValidationDiagnostics({
    stage: "typecheck",
    output,
    generatedProjectDir
  });

  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0]?.stage, "typecheck");
  assert.match(String(diagnostics[0]?.filePath), /src[\\/]main\.ts$/);
  assert.equal(diagnostics[0]?.code, "TS2304");
  assert.equal(diagnostics[0]?.line, 3);
  assert.equal(diagnostics[0]?.column, 9);
});

test("parseValidationDiagnostics parses esbuild build diagnostics", () => {
  const generatedProjectDir = "/tmp/generated-project";
  const output = "src/main.ts:7:2: ERROR: Expected \";\" but found \"}\"";

  const diagnostics = parseValidationDiagnostics({
    stage: "build",
    output,
    generatedProjectDir
  });

  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0]?.stage, "build");
  assert.match(String(diagnostics[0]?.filePath), /src[\\/]main\.ts$/);
  assert.equal(diagnostics[0]?.line, 7);
  assert.equal(diagnostics[0]?.column, 2);
});

test("runValidationFeedback removes unused imports via organize imports", async (t) => {
  const generatedProjectDir = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-feedback-unused-import-"));
  const logs: string[] = [];

  try {
    await writeMinimalProject({
      generatedProjectDir,
      source: 'import { add, unused } from "./math";\nconst value = add(1, 2);\nconsole.log(value);\n'
    });
    await writeFile(path.join(generatedProjectDir, "src", "math.ts"), "export const add = (a: number, b: number): number => a + b;\nexport const unused = 1;\n", "utf8");
    try {
      await linkLocalTypescript({ generatedProjectDir });
    } catch {
      t.skip("Local TypeScript runtime unavailable for feedback tests.");
      return;
    }

    const lintOutput = `${path.join(generatedProjectDir, "src", "main.ts")}\n  1:15  error  'unused' is defined but never used  @typescript-eslint/no-unused-vars`;

    const result = await runValidationFeedback({
      generatedProjectDir,
      stage: "lint",
      output: lintOutput,
      onLog: (message) => {
        logs.push(message);
      }
    });

    const content = await readFile(path.join(generatedProjectDir, "src", "main.ts"), "utf8");
    assert.equal(content.includes("unused"), false);
    assert.equal(result.changedFiles.includes("src/main.ts"), true);
    assert.equal(result.correctionsApplied > 0, true);
    assert.equal(logs.some((entry) => entry.includes("Auto-correction src/main.ts")), true);
  } finally {
    await rm(generatedProjectDir, { recursive: true, force: true });
  }
});

test("runValidationFeedback adds missing imports from TS2304 diagnostics when possible", async (t) => {
  const generatedProjectDir = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-feedback-missing-import-"));

  try {
    await writeMinimalProject({
      generatedProjectDir,
      source: "const value = add(1, 2);\nconsole.log(value);\n"
    });

    try {
      await linkLocalTypescript({ generatedProjectDir });
    } catch {
      t.skip("Local TypeScript runtime unavailable for feedback tests.");
      return;
    }

    const typecheckOutput = "src/main.ts(1,15): error TS2304: Cannot find name 'add'.";

    const result = await runValidationFeedback({
      generatedProjectDir,
      stage: "typecheck",
      output: typecheckOutput,
      onLog: () => {
        // no-op
      }
    });

    const content = await readFile(path.join(generatedProjectDir, "src", "main.ts"), "utf8");
    assert.equal(content.includes('import { add } from "./math";'), true);
    assert.equal(result.changedFiles.includes("src/main.ts"), true);
  } finally {
    await rm(generatedProjectDir, { recursive: true, force: true });
  }
});
