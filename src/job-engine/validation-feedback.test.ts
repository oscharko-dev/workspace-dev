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

test("parseValidationDiagnostics filters unsupported and out-of-project paths while preserving rule-less lint diagnostics", () => {
  const generatedProjectDir = "/tmp/generated-project";
  const supportedPath = path.join(generatedProjectDir, "src", "main.ts");
  const unsupportedPath = path.join(generatedProjectDir, "README.md");
  const outsidePath = path.join(os.tmpdir(), "outside-project", "escape.ts");
  const output = [
    unsupportedPath,
    "  1:1  error  ignored markdown issue  markdown/nope",
    outsidePath,
    "  2:2  error  ignored outside issue  @typescript-eslint/no-unused-vars",
    supportedPath,
    "  3:4  error  missing semicolon"
  ].join("\n");

  const diagnostics = parseValidationDiagnostics({
    stage: "lint",
    output,
    generatedProjectDir
  });

  assert.deepEqual(diagnostics, [
    {
      stage: "lint",
      filePath: supportedPath,
      line: 3,
      column: 4,
      message: "missing semicolon"
    }
  ]);
});

test("parseValidationDiagnostics ignores orphaned lint detail lines until a supported file header is seen", () => {
  const generatedProjectDir = "/tmp/generated-project";
  const supportedPath = path.join(generatedProjectDir, "src", "main.ts");
  const output = [
    "  1:1  error  orphaned detail  @typescript-eslint/no-unused-vars",
    path.join(generatedProjectDir, "README.md"),
    "  2:2  error  ignored markdown issue  markdown/nope",
    supportedPath,
    "  3:4  error  keep me  @typescript-eslint/no-unused-vars"
  ].join("\n");

  const diagnostics = parseValidationDiagnostics({
    stage: "lint",
    output,
    generatedProjectDir
  });

  assert.deepEqual(diagnostics, [
    {
      stage: "lint",
      filePath: supportedPath,
      line: 3,
      column: 4,
      message: "keep me",
      rule: "@typescript-eslint/no-unused-vars"
    }
  ]);
});

test("parseValidationDiagnostics filters unsupported TypeScript diagnostics and malformed build lines", () => {
  const generatedProjectDir = "/tmp/generated-project";
  const insidePath = path.join(generatedProjectDir, "src", "main.ts");
  const outsidePath = path.join(os.tmpdir(), "outside-generated-project", "escape.ts");

  const typecheckDiagnostics = parseValidationDiagnostics({
    stage: "typecheck",
    output: [
      `${outsidePath}(1,1): error TS2304: Cannot find name 'Outside'.`,
      `${path.join(generatedProjectDir, "README.md")}(2,2): error TS2304: Cannot find name 'Ignored'.`,
      `${insidePath}(3,9): error TS2304: Cannot find name 'Button'.`,
      "this line does not match the TypeScript format"
    ].join("\n"),
    generatedProjectDir
  });

  assert.deepEqual(typecheckDiagnostics, [
    {
      stage: "typecheck",
      filePath: insidePath,
      line: 3,
      column: 9,
      code: "TS2304",
      message: "Cannot find name 'Button'."
    }
  ]);

  const buildDiagnostics = parseValidationDiagnostics({
    stage: "build",
    output: [
      `${path.join(generatedProjectDir, "src", "styles.css")}:7:2: ERROR: Unsupported stylesheet error`,
      `${insidePath}:7:2: ERROR: Expected ";" but found "}"`,
      "vite build output without a diagnostic shape"
    ].join("\n"),
    generatedProjectDir
  });

  assert.deepEqual(buildDiagnostics, [
    {
      stage: "build",
      filePath: insidePath,
      line: 7,
      column: 2,
      message: 'Expected ";" but found "}"'
    }
  ]);
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

test("runValidationFeedback skips unsupported code fixes but still organizes imports for candidate files", async (t) => {
  const generatedProjectDir = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-feedback-unsupported-codefix-"));

  try {
    await writeMinimalProject({
      generatedProjectDir,
      source: 'import { add } from "./math";\nconst mainValue: number = 1;\nconsole.log(mainValue);\n'
    });

    try {
      await linkLocalTypescript({ generatedProjectDir });
    } catch {
      t.skip("Local TypeScript runtime unavailable for feedback tests.");
      return;
    }

    const result = await runValidationFeedback({
      generatedProjectDir,
      stage: "typecheck",
      output: "src/main.ts(2,7): error TS2322: Type 'string' is not assignable to type 'number'.",
      onLog: () => {
        // no-op
      }
    });

    const content = await readFile(path.join(generatedProjectDir, "src", "main.ts"), "utf8");
    assert.equal(content.includes('import { add } from "./math";'), false);
    assert.equal(result.changedFiles.includes("src/main.ts"), true);
    assert.match(result.summary, /\[TS2322] src\/main\.ts:2:7 Type 'string' is not assignable to type 'number'\./);
  } finally {
    await rm(generatedProjectDir, { recursive: true, force: true });
  }
});

test("runValidationFeedback returns parsed summary when the generated project has no local TypeScript runtime", async () => {
  const generatedProjectDir = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-feedback-no-ts-"));
  const logs: string[] = [];

  try {
    await writeMinimalProject({
      generatedProjectDir,
      source: "const value = missingOne + missingTwo + missingThree + missingFour + missingFive + missingSix;\n"
    });

    const typecheckOutput = [
      "src/main.ts(1,1): error TS2304: Cannot find name 'missingOne'.",
      "src/main.ts(1,12): error TS2304: Cannot find name 'missingTwo'.",
      "src/main.ts(1,24): error TS2304: Cannot find name 'missingThree'.",
      "src/main.ts(1,38): error TS2304: Cannot find name 'missingFour'.",
      "src/main.ts(1,51): error TS2304: Cannot find name 'missingFive'.",
      "src/main.ts(1,64): error TS2304: Cannot find name 'missingSix'."
    ].join("\n");

    const result = await runValidationFeedback({
      generatedProjectDir,
      stage: "typecheck",
      output: typecheckOutput,
      onLog: (message) => {
        logs.push(message);
      }
    });

    assert.equal(result.correctionsApplied, 0);
    assert.deepEqual(result.changedFiles, []);
    assert.match(result.summary, /\[TS2304] src\/main\.ts:1:1 Cannot find name 'missingOne'\./);
    assert.match(result.summary, /\(\+1 more diagnostics\)/);
    assert.equal(
      logs.includes("Validation feedback skipped: generated project does not provide a local TypeScript runtime."),
      true
    );
  } finally {
    await rm(generatedProjectDir, { recursive: true, force: true });
  }
});

test("runValidationFeedback skips when tsconfig cannot initialize a TypeScript language service", async (t) => {
  const generatedProjectDir = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-feedback-invalid-tsconfig-"));
  const logs: string[] = [];

  try {
    await writeFile(path.join(generatedProjectDir, "package.json"), '{"name":"generated-app","private":true}\n', "utf8");
    await writeFile(path.join(generatedProjectDir, "tsconfig.json"), "{ invalid json\n", "utf8");
    await mkdir(path.join(generatedProjectDir, "src"), { recursive: true });
    await writeFile(path.join(generatedProjectDir, "src", "main.ts"), "const value = add(1, 2);\n", "utf8");

    try {
      await linkLocalTypescript({ generatedProjectDir });
    } catch {
      t.skip("Local TypeScript runtime unavailable for feedback tests.");
      return;
    }

    const result = await runValidationFeedback({
      generatedProjectDir,
      stage: "typecheck",
      output: "src/main.ts(1,15): error TS2304: Cannot find name 'add'.",
      onLog: (message) => {
        logs.push(message);
      }
    });

    assert.equal(result.correctionsApplied, 0);
    assert.deepEqual(result.changedFiles, []);
    assert.equal(
      logs.includes("Validation feedback skipped: unable to initialize TypeScript language service from generated project."),
      true
    );
  } finally {
    await rm(generatedProjectDir, { recursive: true, force: true });
  }
});

test("runValidationFeedback falls back to project files and logs overflow when organizeImports updates many files", async (t) => {
  const generatedProjectDir = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-feedback-overflow-"));
  const logs: string[] = [];

  try {
    await writeMinimalProject({
      generatedProjectDir,
      source: 'import { add } from "./math";\nexport const mainValue = 1;\n'
    });

    for (let index = 0; index < 21; index += 1) {
      await writeFile(
        path.join(generatedProjectDir, "src", `extra-${String(index).padStart(2, "0")}.ts`),
        'import { add } from "./math";\nexport const value = 1;\n',
        "utf8"
      );
    }

    try {
      await linkLocalTypescript({ generatedProjectDir });
    } catch {
      t.skip("Local TypeScript runtime unavailable for feedback tests.");
      return;
    }

    const result = await runValidationFeedback({
      generatedProjectDir,
      stage: "lint",
      output: "lint failed without structured diagnostics",
      onLog: (message) => {
        logs.push(message);
      }
    });

    const sampleContent = await readFile(path.join(generatedProjectDir, "src", "extra-00.ts"), "utf8");
    assert.equal(sampleContent.includes('import { add } from "./math";'), false);
    assert.equal(result.summary, "No structured diagnostics parsed from command output.");
    assert.equal(result.changedFiles.length, 22);
    assert.equal(result.correctionsApplied > 0, true);
    assert.equal(logs.some((entry) => entry.includes("Auto-correction src/extra-00.ts")), true);
    assert.equal(logs.includes("Auto-correction: +2 additional file(s) updated."), true);
  } finally {
    await rm(generatedProjectDir, { recursive: true, force: true });
  }
});
