import assert from "node:assert/strict";
import { access, lstat, mkdir, mkdtemp, readFile, readlink, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { getUiGateReportPaths, runProjectValidationWithDeps } from "./validation.js";

const linkLocalTypescript = async ({ generatedProjectDir }: { generatedProjectDir: string }): Promise<void> => {
  const repositoryTypescriptPath = path.resolve(process.cwd(), "node_modules", "typescript");
  await access(repositoryTypescriptPath);
  const nodeModulesDir = path.join(generatedProjectDir, "node_modules");
  await mkdir(nodeModulesDir, { recursive: true });
  await symlink(repositoryTypescriptPath, path.join(nodeModulesDir, "typescript"));
};

const writeValidationFeedbackProject = async ({
  generatedProjectDir
}: {
  generatedProjectDir: string;
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
  await writeFile(path.join(generatedProjectDir, "src", "main.ts"), "const value = add(1, 2);\nconsole.log(value);\n", "utf8");
};

test("runProjectValidationWithDeps executes deterministic pnpm command sequence", async () => {
  const calls: string[] = [];

  const result = await runProjectValidationWithDeps({
    generatedProjectDir: "/tmp/generated-project",
    onLog: () => {
      // no-op
    },
    deps: {
      runCommand: async ({ command, args }) => {
        calls.push(`${command} ${args.join(" ")}`);
        return {
          success: true,
          code: 0,
          stdout: "",
          stderr: "",
          combined: ""
        };
      }
    }
  });

  assert.deepEqual(calls, [
    "pnpm install --ignore-scripts --frozen-lockfile --reporter append-only --prefer-offline",
    "pnpm lint --fix",
    "pnpm lint",
    "pnpm typecheck",
    "pnpm build"
  ]);
  assert.equal(result.attempts, 1);
  assert.equal(result.install.status, "completed");
  assert.equal(result.install.strategy, "fresh_install");
  assert.equal(result.lintAutofix?.status, "completed");
  assert.deepEqual(result.lint.args, ["lint"]);
  assert.deepEqual(result.typecheck.args, ["typecheck"]);
  assert.deepEqual(result.build.args, ["build"]);
});

test("runProjectValidationWithDeps forwards output capture settings and abort signal", async () => {
  const abortController = new AbortController();
  const captures: Array<{
    command: string;
    outputCapture?: {
      jobDir: string;
      key: string;
      stdoutMaxBytes: number;
      stderrMaxBytes: number;
    };
    abortSignal?: AbortSignal;
  }> = [];

  await runProjectValidationWithDeps({
    generatedProjectDir: "/tmp/generated-project",
    jobDir: "/tmp/workspace-dev-job",
    commandStdoutMaxBytes: 4_096,
    commandStderrMaxBytes: 8_192,
    abortSignal: abortController.signal,
    onLog: () => {
      // no-op
    },
    deps: {
      runCommand: async ({ args, outputCapture, abortSignal: receivedAbortSignal }) => {
        captures.push({
          command: args.join(" "),
          ...(outputCapture
            ? {
                outputCapture: {
                  jobDir: outputCapture.jobDir,
                  key: outputCapture.key,
                  stdoutMaxBytes: outputCapture.stdoutMaxBytes,
                  stderrMaxBytes: outputCapture.stderrMaxBytes
                }
              }
            : {}),
          ...(receivedAbortSignal ? { abortSignal: receivedAbortSignal } : {})
        });
        return {
          success: true,
          code: 0,
          stdout: "",
          stderr: "",
          combined: ""
        };
      }
    }
  });

  assert.deepEqual(
    captures.map((entry) => entry.outputCapture?.key),
    [
      "validate.project.install",
      "validate.project.attempt-1.lint-autofix",
      "validate.project.attempt-1.lint",
      "validate.project.attempt-1.typecheck",
      "validate.project.attempt-1.build"
    ]
  );
  for (const capture of captures) {
    assert.equal(capture.outputCapture?.jobDir, "/tmp/workspace-dev-job");
    assert.equal(capture.outputCapture?.stdoutMaxBytes, 4_096);
    assert.equal(capture.outputCapture?.stderrMaxBytes, 8_192);
    assert.equal(capture.abortSignal, abortController.signal);
  }
});

test("runProjectValidationWithDeps can disable lint autofix", async () => {
  const calls: string[] = [];

  await runProjectValidationWithDeps({
    generatedProjectDir: "/tmp/generated-project",
    onLog: () => {
      // no-op
    },
    enableLintAutofix: false,
    deps: {
      runCommand: async ({ command, args }) => {
        calls.push(`${command} ${args.join(" ")}`);
        return {
          success: true,
          code: 0,
          stdout: "",
          stderr: "",
          combined: ""
        };
      }
    }
  });

  assert.deepEqual(calls, [
    "pnpm install --ignore-scripts --frozen-lockfile --reporter append-only --prefer-offline",
    "pnpm lint",
    "pnpm typecheck",
    "pnpm build"
  ]);
});

test("runProjectValidationWithDeps reuses seeded node_modules and cleans up the temporary link", async () => {
  const generatedProjectDir = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-validation-seeded-"));
  const seedRoot = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-validation-seed-root-"));
  const seedNodeModulesDir = path.join(seedRoot, "node_modules");
  const calls: string[] = [];
  const nodeModulesDir = path.join(generatedProjectDir, "node_modules");

  await mkdir(seedNodeModulesDir, { recursive: true });

  try {
    await runProjectValidationWithDeps({
      generatedProjectDir,
      seedNodeModulesDir,
      onLog: () => {
        // no-op
      },
      deps: {
        runCommand: async ({ command, args }) => {
          const metadata = await lstat(nodeModulesDir);
          assert.equal(metadata.isSymbolicLink(), true);
          assert.equal(path.resolve(generatedProjectDir, await readlink(nodeModulesDir)), seedNodeModulesDir);
          calls.push(`${command} ${args.join(" ")}`);
          return {
            success: true,
            code: 0,
            stdout: "",
            stderr: "",
            combined: ""
          };
        }
      }
    });

    assert.deepEqual(calls, [
      "pnpm lint --fix",
      "pnpm lint",
      "pnpm typecheck",
      "pnpm build"
    ]);

    await assert.rejects(
      () => lstat(nodeModulesDir),
      (error: Error & { code?: string }) => error.code === "ENOENT"
    );
  } finally {
    await rm(generatedProjectDir, { recursive: true, force: true });
    await rm(seedRoot, { recursive: true, force: true });
  }
});

test("runProjectValidationWithDeps skips seeded node_modules reuse when lockfileMutable is true", async () => {
  const generatedProjectDir = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-validation-seeded-mutable-"));
  const seedRoot = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-validation-seeded-mutable-root-"));
  const seedNodeModulesDir = path.join(seedRoot, "node_modules");
  const nodeModulesDir = path.join(generatedProjectDir, "node_modules");
  const calls: string[] = [];

  await mkdir(seedNodeModulesDir, { recursive: true });

  try {
    await writeValidationFeedbackProject({ generatedProjectDir });
    await linkLocalTypescript({ generatedProjectDir });

    await runProjectValidationWithDeps({
      generatedProjectDir,
      seedNodeModulesDir,
      lockfileMutable: true,
      onLog: () => {
        // no-op
      },
      deps: {
        runCommand: async ({ command, args }) => {
          calls.push(`${command} ${args.join(" ")}`);
          return {
            success: true,
            code: 0,
            stdout: "",
            stderr: "",
            combined: ""
          };
        }
      }
    });

    const nodeModulesMetadata = await lstat(nodeModulesDir);
    assert.equal(nodeModulesMetadata.isSymbolicLink(), false);
    assert.deepEqual(calls, [
      "pnpm install --ignore-scripts --no-frozen-lockfile --reporter append-only --prefer-offline",
      "pnpm lint --fix",
      "pnpm lint",
      "pnpm typecheck",
      "pnpm build"
    ]);
  } finally {
    await rm(generatedProjectDir, { recursive: true, force: true });
    await rm(seedRoot, { recursive: true, force: true });
  }
});

test("runProjectValidationWithDeps replaces a preexisting node_modules file before seeding dependencies", async () => {
  const generatedProjectDir = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-validation-seeded-file-"));
  const seedRoot = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-validation-seeded-file-root-"));
  const seedNodeModulesDir = path.join(seedRoot, "node_modules");
  const nodeModulesDir = path.join(generatedProjectDir, "node_modules");
  const calls: string[] = [];

  await mkdir(seedNodeModulesDir, { recursive: true });
  await writeFile(nodeModulesDir, "stale file\n", "utf8");

  try {
    await runProjectValidationWithDeps({
      generatedProjectDir,
      seedNodeModulesDir,
      onLog: () => {
        // no-op
      },
      deps: {
        runCommand: async ({ command, args }) => {
          const metadata = await lstat(nodeModulesDir);
          assert.equal(metadata.isSymbolicLink(), true);
          assert.equal(path.resolve(generatedProjectDir, await readlink(nodeModulesDir)), seedNodeModulesDir);
          calls.push(`${command} ${args.join(" ")}`);
          return {
            success: true,
            code: 0,
            stdout: "",
            stderr: "",
            combined: ""
          };
        }
      }
    });
  } finally {
    await rm(generatedProjectDir, { recursive: true, force: true });
    await rm(seedRoot, { recursive: true, force: true });
  }

  assert.deepEqual(calls, ["pnpm lint --fix", "pnpm lint", "pnpm typecheck", "pnpm build"]);
});

test("runProjectValidationWithDeps appends perf assertion when enabled", async () => {
  const calls: string[] = [];
  const envByCommand: Record<string, NodeJS.ProcessEnv | undefined> = {};

  await runProjectValidationWithDeps({
    generatedProjectDir: "/tmp/generated-project",
    onLog: () => {
      // no-op
    },
    enablePerfValidation: true,
    deps: {
      runCommand: async ({ command, args, env }) => {
        const key = `${command} ${args.join(" ")}`;
        calls.push(key);
        envByCommand[key] = env;
        return {
          success: true,
          code: 0,
          stdout: "",
          stderr: "",
          combined: ""
        };
      }
    }
  });

  assert.deepEqual(calls, [
    "pnpm install --ignore-scripts --frozen-lockfile --reporter append-only --prefer-offline",
    "pnpm lint --fix",
    "pnpm lint",
    "pnpm typecheck",
    "pnpm build",
    "pnpm run perf:assert"
  ]);
  assert.match(String(envByCommand["pnpm run perf:assert"]?.FIGMAPIPE_PERF_ARTIFACT_DIR), /\.figmapipe\/performance$/);
  assert.match(String(envByCommand["pnpm run perf:assert"]?.FIGMAPIPE_PERF_BASELINE_PATH), /perf-baseline\.json$/);
});

test("runProjectValidationWithDeps uses the committed perf baseline when requested", async () => {
  const generatedProjectDir = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-validation-perf-baseline-"));
  const calls: string[] = [];
  const envByCommand: Record<string, NodeJS.ProcessEnv | undefined> = {};

  try {
    await runProjectValidationWithDeps({
      generatedProjectDir,
      onLog: () => {
        // no-op
      },
      enablePerfValidation: true,
      useCommittedPerfBaseline: true,
      deps: {
        runCommand: async ({ command, args, env }) => {
          const key = `${command} ${args.join(" ")}`;
          calls.push(key);
          envByCommand[key] = env;
          return {
            success: true,
            code: 0,
            stdout: "",
            stderr: "",
            combined: ""
          };
        }
      }
    });
  } finally {
    await rm(generatedProjectDir, { recursive: true, force: true });
  }

  assert.equal(calls.includes("pnpm run perf:assert"), true);
  assert.equal(
    envByCommand["pnpm run perf:assert"]?.FIGMAPIPE_PERF_BASELINE_PATH,
    path.join(generatedProjectDir, "perf-baseline.json")
  );
  assert.equal(envByCommand["pnpm run perf:assert"]?.FIGMAPIPE_PERF_ALLOW_BASELINE_BOOTSTRAP, "false");
  assert.match(String(envByCommand["pnpm run perf:assert"]?.FIGMAPIPE_PERF_ARTIFACT_DIR), /\.figmapipe\/performance$/);
});

test("runProjectValidationWithDeps falls back to install when the seeded node_modules path does not exist", async () => {
  const generatedProjectDir = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-validation-seed-missing-"));
  const calls: string[] = [];
  const logs: string[] = [];

  try {
    await runProjectValidationWithDeps({
      generatedProjectDir,
      seedNodeModulesDir: path.join(generatedProjectDir, "missing-node-modules"),
      onLog: (message) => {
        logs.push(message);
      },
      deps: {
        runCommand: async ({ command, args }) => {
          calls.push(`${command} ${args.join(" ")}`);
          return {
            success: true,
            code: 0,
            stdout: "",
            stderr: "",
            combined: ""
          };
        }
      }
    });
  } finally {
    await rm(generatedProjectDir, { recursive: true, force: true });
  }

  assert.deepEqual(calls, [
    "pnpm install --ignore-scripts --frozen-lockfile --reporter append-only --prefer-offline",
    "pnpm lint --fix",
    "pnpm lint",
    "pnpm typecheck",
    "pnpm build"
  ]);
  assert.equal(logs.some((entry) => entry.includes("operation=prepareValidationNodeModules.seed-stat")), true);
});

test("runProjectValidationWithDeps still installs when a generated node_modules directory already exists", async () => {
  const generatedProjectDir = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-validation-existing-node-modules-"));
  const seedRoot = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-validation-existing-node-modules-seed-"));
  const seedNodeModulesDir = path.join(seedRoot, "node_modules");
  const calls: string[] = [];

  await mkdir(path.join(generatedProjectDir, "node_modules"), { recursive: true });
  await mkdir(seedNodeModulesDir, { recursive: true });

  try {
    await runProjectValidationWithDeps({
      generatedProjectDir,
      seedNodeModulesDir,
      onLog: () => {
        // no-op
      },
      deps: {
        runCommand: async ({ command, args }) => {
          calls.push(`${command} ${args.join(" ")}`);
          return {
            success: true,
            code: 0,
            stdout: "",
            stderr: "",
            combined: ""
          };
        }
      }
    });
  } finally {
    await rm(generatedProjectDir, { recursive: true, force: true });
    await rm(seedRoot, { recursive: true, force: true });
  }

  assert.equal(calls[0], "pnpm install --ignore-scripts --frozen-lockfile --reporter append-only --prefer-offline");
});

test("runProjectValidationWithDeps continues when lint autofix fails", async () => {
  const calls: string[] = [];
  const logs: string[] = [];

  await runProjectValidationWithDeps({
    generatedProjectDir: "/tmp/generated-project",
    onLog: (message) => {
      logs.push(message);
    },
    deps: {
      runCommand: async ({ command, args }) => {
        const invoked = `${command} ${args.join(" ")}`;
        calls.push(invoked);
        if (args[0] === "lint" && args[1] === "--fix") {
          return {
            success: false,
            code: 1,
            stdout: "",
            stderr: "autofix failed",
            combined: "autofix failed"
          };
        }
        return {
          success: true,
          code: 0,
          stdout: "",
          stderr: "",
          combined: ""
        };
      }
    }
  });

  assert.deepEqual(calls, [
    "pnpm install --ignore-scripts --frozen-lockfile --reporter append-only --prefer-offline",
    "pnpm lint --fix",
    "pnpm lint",
    "pnpm typecheck",
    "pnpm build"
  ]);
  assert.equal(
    logs.some((entry) => entry.includes("Lint auto-fix failed") && entry.includes("continuing with final lint check")),
    true
  );
});

test("runProjectValidationWithDeps distinguishes canceled and timed-out lint autofix runs", async (t) => {
  await t.test("canceled lint-autofix commands abort validation immediately", async () => {
    await assert.rejects(
      () =>
        runProjectValidationWithDeps({
          generatedProjectDir: "/tmp/generated-project",
          onLog: () => {
            // no-op
          },
          deps: {
            runCommand: async ({ args }) => {
              if (args[0] === "lint" && args[1] === "--fix") {
                return {
                  success: false,
                  code: 1,
                  stdout: "",
                  stderr: "",
                  combined: "lint autofix canceled",
                  canceled: true
                };
              }
              return {
                success: true,
                code: 0,
                stdout: "",
                stderr: "",
                combined: ""
              };
            }
          }
        }),
      /lint-autofix canceled by job cancellation request/
    );
  });

  await t.test("timed-out lint-autofix failures include an explicit timeout suffix in logs", async () => {
    const logs: string[] = [];

    await runProjectValidationWithDeps({
      generatedProjectDir: "/tmp/generated-project",
      onLog: (message) => {
        logs.push(message);
      },
      deps: {
        runCommand: async ({ args }) => {
          if (args[0] === "lint" && args[1] === "--fix") {
            return {
              success: false,
              code: 1,
              stdout: "",
              stderr: "autofix timed out",
              combined: "autofix timed out",
              timedOut: true
            };
          }
          return {
            success: true,
            code: 0,
            stdout: "",
            stderr: "",
            combined: ""
          };
        }
      }
    });

    assert.equal(logs.some((entry) => entry.includes("Lint auto-fix failed (command timeout);")), true);
  });
});

test("runProjectValidationWithDeps retries lint/typecheck/build after successful feedback corrections", async () => {
  const calls: string[] = [];
  const feedbackStages: string[] = [];
  let lintFailuresRemaining = 1;

  await runProjectValidationWithDeps({
    generatedProjectDir: "/tmp/generated-project",
    onLog: () => {
      // no-op
    },
    deps: {
      runCommand: async ({ command, args }) => {
        const invocation = `${command} ${args.join(" ")}`;
        calls.push(invocation);
        if (args[0] === "lint" && args.length === 1 && lintFailuresRemaining > 0) {
          lintFailuresRemaining -= 1;
          return {
            success: false,
            code: 1,
            stdout: "",
            stderr: "lint failed",
            combined: "src/main.ts(1,1): error TS2304: Cannot find name 'Button'."
          };
        }
        return {
          success: true,
          code: 0,
          stdout: "",
          stderr: "",
          combined: ""
        };
      },
      runValidationFeedback: async ({ stage }) => {
        feedbackStages.push(stage);
        return {
          diagnostics: [],
          changedFiles: ["src/main.ts"],
          correctionsApplied: 2,
          fileCorrections: [{ filePath: "src/main.ts", editCount: 2, descriptions: ["Organized imports"] }],
          summary: "[TS2304] src/main.ts:1:1 Cannot find name 'Button'."
        };
      }
    }
  });

  assert.deepEqual(feedbackStages, ["lint"]);
  assert.deepEqual(calls, [
    "pnpm install --ignore-scripts --frozen-lockfile --reporter append-only --prefer-offline",
    "pnpm lint --fix",
    "pnpm lint",
    "pnpm lint --fix",
    "pnpm lint",
    "pnpm typecheck",
    "pnpm build"
  ]);
});

test("runProjectValidationWithDeps integrates real validation feedback for retryable typecheck failures", async (t) => {
  const generatedProjectDir = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-validation-real-feedback-"));
  const logs: string[] = [];
  const calls: string[] = [];
  let typecheckInvocations = 0;

  try {
    await writeValidationFeedbackProject({ generatedProjectDir });

    try {
      await linkLocalTypescript({ generatedProjectDir });
    } catch {
      t.skip("Local TypeScript runtime unavailable for validation integration tests.");
      return;
    }

    await runProjectValidationWithDeps({
      generatedProjectDir,
      skipInstall: true,
      onLog: (message) => {
        logs.push(message);
      },
      deps: {
        runCommand: async ({ command, args }) => {
          calls.push(`${command} ${args.join(" ")}`);
          if (args[0] === "typecheck") {
            typecheckInvocations += 1;
            if (typecheckInvocations === 1) {
              return {
                success: false,
                code: 1,
                stdout: "",
                stderr: "typecheck failed",
                combined: "src/main.ts(1,15): error TS2304: Cannot find name 'add'."
              };
            }
          }
          return {
            success: true,
            code: 0,
            stdout: "",
            stderr: "",
            combined: ""
          };
        }
      }
    });

    const content = await readFile(path.join(generatedProjectDir, "src", "main.ts"), "utf8");
    assert.equal(content.includes('import { add } from "./math";'), true);
    assert.equal(typecheckInvocations, 2);
    assert.deepEqual(calls, [
      "pnpm lint --fix",
      "pnpm lint",
      "pnpm typecheck",
      "pnpm lint --fix",
      "pnpm lint",
      "pnpm typecheck",
      "pnpm build"
    ]);
    assert.equal(logs.includes("Validation attempt 1/3"), true);
    assert.equal(logs.includes("Validation attempt 2/3"), true);
    assert.equal(
      logs.some((entry) => /Applied \d+ correction edit\(s\) across 1 file\(s\) after typecheck failure\./.test(entry)),
      true
    );
    assert.equal(logs.includes("Retrying validation after typecheck corrections (2/3)."), true);
  } finally {
    await rm(generatedProjectDir, { recursive: true, force: true });
  }
});

test("runProjectValidationWithDeps aborts retry loop when feedback cannot apply corrections", async () => {
  await assert.rejects(
    () =>
      runProjectValidationWithDeps({
        generatedProjectDir: "/tmp/generated-project",
        onLog: () => {
          // no-op
        },
        deps: {
          runCommand: async ({ args }) => {
            if (args[0] === "lint" && args.length === 1) {
              return {
                success: false,
                code: 1,
                stdout: "",
                stderr: "lint failed",
                combined: "src/main.ts(1,1): error TS2304: Cannot find name 'Button'."
              };
            }
            return {
              success: true,
              code: 0,
              stdout: "",
              stderr: "",
              combined: ""
            };
          },
          runValidationFeedback: async () => ({
            diagnostics: [],
            changedFiles: [],
            correctionsApplied: 0,
            fileCorrections: [],
            summary: "[TS2304] src/main.ts:1:1 Cannot find name 'Button'."
          })
        }
      }),
    /no auto-corrections were applied/i
  );
});

test("runProjectValidationWithDeps includes rule/code diagnostics even when code context cannot be read", async () => {
  const generatedProjectDir = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-validation-detail-diagnostics-"));

  try {
    await assert.rejects(
      () =>
        runProjectValidationWithDeps({
          generatedProjectDir,
          onLog: () => {
            // no-op
          },
          deps: {
            runCommand: async ({ args }) => {
              if (args[0] === "typecheck") {
                return {
                  success: false,
                  code: 1,
                  stdout: "",
                  stderr: "typecheck failed",
                  combined: "typecheck failed"
                };
              }
              return {
                success: true,
                code: 0,
                stdout: "",
                stderr: "",
                combined: ""
              };
            },
            runValidationFeedback: async () => ({
              diagnostics: [
                {
                  stage: "typecheck",
                  message: "missing import",
                  filePath: path.join(generatedProjectDir, "missing.ts"),
                  line: 4,
                  column: 2,
                  code: "TS2304"
                },
                {
                  stage: "lint",
                  message: "rule only diagnostic",
                  rule: "custom/rule"
                }
              ],
              changedFiles: [],
              correctionsApplied: 0,
              fileCorrections: [],
              summary: "structured diagnostics available"
            })
          }
        }),
      (error: unknown) => {
        assert.equal(error instanceof Error, true);
        const typed = error as Error & {
          diagnostics?: Array<{
            message?: string;
            details?: Record<string, unknown>;
          }>;
        };
        assert.equal(
          typed.diagnostics?.[1]?.details?.filePath,
          "[redacted-path]/missing.ts"
        );
        assert.equal(
          String(typed.diagnostics?.[1]?.details?.filePath ?? "").includes(generatedProjectDir),
          false
        );
        assert.equal("codeContext" in (typed.diagnostics?.[1]?.details ?? {}), false);
        assert.match(String(typed.diagnostics?.[2]?.message), /custom\/rule/);
        return true;
      }
    );
  } finally {
    await rm(generatedProjectDir, { recursive: true, force: true });
  }
});

test("runProjectValidationWithDeps emits structured diagnostics for failed retryable command", async () => {
  const generatedProjectDir = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-validation-diagnostics-"));
  const sourceDir = path.join(generatedProjectDir, "src");
  const sourceFile = path.join(sourceDir, "main.ts");
  await mkdir(path.join(generatedProjectDir, "node_modules"), { recursive: true });
  await mkdir(sourceDir, { recursive: true });
  await writeFile(sourceFile, "const unused = 1;\n", "utf8");

  try {
    await assert.rejects(
      () =>
        runProjectValidationWithDeps({
          generatedProjectDir,
          onLog: () => {
            // no-op
          },
          skipInstall: true,
          deps: {
            runCommand: async ({ args }) => {
              if (args[0] === "lint" && args.length === 1) {
                return {
                  success: false,
                  code: 1,
                  stdout: "",
                  stderr: "lint failed",
                  combined: "lint failed"
                };
              }
              return {
                success: true,
                code: 0,
                stdout: "",
                stderr: "",
                combined: ""
              };
            },
            runValidationFeedback: async () => ({
              diagnostics: [
                {
                  stage: "lint",
                  message: "unused variable",
                  filePath: sourceFile,
                  line: 1,
                  column: 7,
                  rule: "no-unused-vars"
                }
              ],
              changedFiles: [],
              correctionsApplied: 0,
              fileCorrections: [],
              summary: "unused variable"
            })
          }
        }),
      (error: unknown) => {
        assert.equal(error instanceof Error, true);
        const typed = error as Error & {
          code?: string;
          diagnostics?: Array<{
            code?: string;
            details?: Record<string, unknown>;
          }>;
        };
        assert.equal(typed.code, "E_VALIDATE_PROJECT");
        assert.equal(typed.diagnostics?.[0]?.code, "E_VALIDATE_PROJECT");
        assert.equal(typed.diagnostics?.[0]?.details?.command, "lint");
        assert.equal(typed.diagnostics?.[1]?.code, "E_VALIDATE_PROJECT_DETAIL");
        assert.equal(
          typed.diagnostics?.[1]?.details?.filePath,
          "[redacted-path]/main.ts"
        );
        assert.equal(String(typed.diagnostics?.[1]?.details?.filePath ?? "").includes(sourceFile), false);
        assert.equal(String(typed.diagnostics?.[1]?.details?.codeContext ?? "").includes("1: const unused = 1;"), true);
        return true;
      }
    );
  } finally {
    await rm(generatedProjectDir, { recursive: true, force: true });
  }
});

test("runProjectValidationWithDeps preserves bounded truncation diagnostics for failed commands", async () => {
  const artifactPath = "/tmp/workspace-dev-job/.stage-store/cmd-output/validate_project_attempt-1_lint.stdout.log";
  const generatedProjectDir = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-validation-truncated-output-"));

  await mkdir(path.join(generatedProjectDir, "node_modules"), { recursive: true });

  try {
    await assert.rejects(
      () =>
        runProjectValidationWithDeps({
          generatedProjectDir,
          jobDir: "/tmp/workspace-dev-job",
          skipInstall: true,
          onLog: () => {
            // no-op
          },
          deps: {
            runCommand: async ({ args }) => {
              if (args[0] === "lint" && args.length === 1) {
                return {
                  success: false,
                  code: 1,
                  stdout: "lint failed prefix",
                  stderr: "",
                  combined: [
                    "lint failed prefix",
                    `stdout truncated after retaining 64 of 256 bytes; full output stored at ${artifactPath}`
                  ].join("\n"),
                  stdoutMetadata: {
                    observedBytes: 256,
                    retainedBytes: 64,
                    truncated: true,
                    artifactPath
                  },
                  stderrMetadata: {
                    observedBytes: 0,
                    retainedBytes: 0,
                    truncated: false
                  }
                };
              }
              return {
                success: true,
                code: 0,
                stdout: "",
                stderr: "",
                combined: ""
              };
            },
            runValidationFeedback: async () => ({
              diagnostics: [],
              changedFiles: [],
              correctionsApplied: 0,
              fileCorrections: [],
              summary: "lint failed"
            })
          }
        }),
      (error: unknown) => {
        assert.equal(error instanceof Error, true);
        const typed = error as Error & {
          diagnostics?: Array<{
            details?: Record<string, unknown>;
          }>;
        };
        assert.equal(typed.message.length <= 320, true);
        assert.equal(String(typed.diagnostics?.[0]?.details?.output).includes(artifactPath), false);
        assert.equal(String(typed.diagnostics?.[0]?.details?.output ?? "").length <= 320, true);
        assert.match(String(typed.diagnostics?.[0]?.details?.output ?? ""), /\[redacted-path\]\/validate_project_attempt-1_lint\.stdout\.log/);
        assert.deepEqual(typed.diagnostics?.[0]?.details?.outputCapture, {
          stdout: {
            observedBytes: 256,
            retainedBytes: 64,
            truncated: true,
            artifactPath: "[redacted-path]/validate_project_attempt-1_lint.stdout.log"
          },
          stderr: {
            observedBytes: 0,
            retainedBytes: 0,
            truncated: false
          }
        });
        return true;
      }
    );
  } finally {
    await rm(generatedProjectDir, { recursive: true, force: true });
  }
});

test("runProjectValidationWithDeps enforces max validation attempts", async () => {
  let feedbackInvocations = 0;

  await assert.rejects(
    () =>
      runProjectValidationWithDeps({
        generatedProjectDir: "/tmp/generated-project",
        onLog: () => {
          // no-op
        },
        deps: {
          runCommand: async ({ args }) => {
            if (args[0] === "lint" && args.length === 1) {
              return {
                success: false,
                code: 1,
                stdout: "",
                stderr: "lint failed",
                combined: "lint failed"
              };
            }
            return {
              success: true,
              code: 0,
              stdout: "",
              stderr: "",
              combined: ""
            };
          },
          runValidationFeedback: async () => {
            feedbackInvocations += 1;
            return {
              diagnostics: [],
              changedFiles: ["src/main.ts"],
              correctionsApplied: 1,
              fileCorrections: [{ filePath: "src/main.ts", editCount: 1, descriptions: ["Organized imports"] }],
              summary: "lint failed"
            };
          }
        }
      }),
    /after 3 attempts/i
  );

  assert.equal(feedbackInvocations, 2);
});

test("runProjectValidationWithDeps honors configured maxValidationAttempts", async () => {
  let feedbackInvocations = 0;

  await assert.rejects(
    () =>
      runProjectValidationWithDeps({
        generatedProjectDir: "/tmp/generated-project",
        maxValidationAttempts: 2,
        onLog: () => {
          // no-op
        },
        deps: {
          runCommand: async ({ args }) => {
            if (args[0] === "lint" && args.length === 1) {
              return {
                success: false,
                code: 1,
                stdout: "",
                stderr: "lint failed",
                combined: "lint failed"
              };
            }
            return {
              success: true,
              code: 0,
              stdout: "",
              stderr: "",
              combined: ""
            };
          },
          runValidationFeedback: async () => {
            feedbackInvocations += 1;
            return {
              diagnostics: [],
              changedFiles: ["src/main.ts"],
              correctionsApplied: 1,
              fileCorrections: [{ filePath: "src/main.ts", editCount: 1, descriptions: ["Organized imports"] }],
              summary: "lint failed"
            };
          }
        }
      }),
    /after 2 attempts/i
  );

  assert.equal(feedbackInvocations, 1);
});

test("runProjectValidationWithDeps respects configured maxValidationAttempts", async () => {
  let feedbackInvocations = 0;

  await assert.rejects(
    () =>
      runProjectValidationWithDeps({
        generatedProjectDir: "/tmp/generated-project",
        onLog: () => {
          // no-op
        },
        maxValidationAttempts: 5,
        deps: {
          runCommand: async ({ args }) => {
            if (args[0] === "lint" && args.length === 1) {
              return {
                success: false,
                code: 1,
                stdout: "",
                stderr: "lint failed",
                combined: "lint failed"
              };
            }
            return {
              success: true,
              code: 0,
              stdout: "",
              stderr: "",
              combined: ""
            };
          },
          runValidationFeedback: async () => {
            feedbackInvocations += 1;
            return {
              diagnostics: [],
              changedFiles: ["src/main.ts"],
              correctionsApplied: 1,
              fileCorrections: [{ filePath: "src/main.ts", editCount: 1, descriptions: ["Organized imports"] }],
              summary: "lint failed"
            };
          }
        }
      }),
    /after 5 attempts/i
  );

  assert.equal(feedbackInvocations, 4);
});

test("runProjectValidationWithDeps retries build failures and reports exhaustion after the max attempts", async () => {
  const feedbackStages: string[] = [];

  await assert.rejects(
    () =>
      runProjectValidationWithDeps({
        generatedProjectDir: "/tmp/generated-project",
        onLog: () => {
          // no-op
        },
        deps: {
          runCommand: async ({ args }) => {
            if (args[0] === "build") {
              return {
                success: false,
                code: 1,
                stdout: "",
                stderr: "build failed",
                combined: "src/main.ts:7:2: ERROR: Expected \";\" but found \"}\""
              };
            }
            return {
              success: true,
              code: 0,
              stdout: "",
              stderr: "",
              combined: ""
            };
          },
          runValidationFeedback: async ({ stage }) => {
            feedbackStages.push(stage);
            return {
              diagnostics: [
                {
                  stage: "build",
                  message: 'Expected ";" but found "}"',
                  filePath: "/tmp/generated-project/src/main.ts",
                  line: 7,
                  column: 2
                }
              ],
              changedFiles: ["src/main.ts"],
              correctionsApplied: 1,
              fileCorrections: [{ filePath: "src/main.ts", editCount: 1, descriptions: ["Applied build fix"] }],
              summary: 'Expected ";" but found "}"'
            };
          }
        }
      }),
    (error: unknown) => {
      assert.equal(error instanceof Error, true);
      const typed = error as Error & {
        diagnostics?: Array<{ details?: Record<string, unknown> }>;
      };
      assert.match(typed.message, /after 3 attempts/);
      assert.equal(typed.diagnostics?.[0]?.details?.command, "build");
      return true;
    }
  );

  assert.deepEqual(feedbackStages, ["build", "build"]);
});

test("runProjectValidationWithDeps does not retry validate-ui failures", async () => {
  let feedbackInvocations = 0;
  await assert.rejects(
    () =>
      runProjectValidationWithDeps({
        generatedProjectDir: "/tmp/generated-project",
        onLog: () => {
          // no-op
        },
        enableUiValidation: true,
        deps: {
          runCommand: async ({ args }) => {
            if (args[0] === "run" && args[1] === "validate:ui") {
              return {
                success: false,
                code: 1,
                stdout: "",
                stderr: "ui validation failed",
                combined: "ui validation failed"
              };
            }
            return {
              success: true,
              code: 0,
              stdout: "",
              stderr: "",
              combined: ""
            };
          },
          runValidationFeedback: async () => {
            feedbackInvocations += 1;
            return {
              diagnostics: [],
              changedFiles: ["src/main.ts"],
              correctionsApplied: 1,
              fileCorrections: [{ filePath: "src/main.ts", editCount: 1, descriptions: ["Organized imports"] }],
              summary: "ui validation failed"
            };
          }
        }
      }),
    /validate-ui failed/i
  );

  assert.equal(feedbackInvocations, 0);
});

test("runProjectValidationWithDeps logs changed files from lint autofix", async () => {
  const generatedProjectDir = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-validation-lint-autofix-"));
  const sourceDir = path.join(generatedProjectDir, "src");
  const sourceFile = path.join(sourceDir, "main.ts");
  const logs: string[] = [];

  await mkdir(path.join(generatedProjectDir, "node_modules"), { recursive: true });
  await mkdir(sourceDir, { recursive: true });
  await writeFile(sourceFile, "const value = 1\n", "utf8");

  try {
    await runProjectValidationWithDeps({
      generatedProjectDir,
      onLog: (message) => {
        logs.push(message);
      },
      skipInstall: true,
      deps: {
        runCommand: async ({ args }) => {
          if (args[0] === "lint" && args[1] === "--fix") {
            await writeFile(sourceFile, "const value = 1;\n", "utf8");
          }
          return {
            success: true,
            code: 0,
            stdout: "",
            stderr: "",
            combined: ""
          };
        }
      }
    });
  } finally {
    await rm(generatedProjectDir, { recursive: true, force: true });
  }

  assert.equal(logs.some((entry) => /Lint auto-fix changed 1 lint-relevant file\(s\): src\/main\.ts/.test(entry)), true);
});

test("runProjectValidationWithDeps truncates lint-autofix changed-file logs when more than twenty files change", async () => {
  const generatedProjectDir = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-validation-lint-autofix-overflow-"));
  const sourceDir = path.join(generatedProjectDir, "src");
  const logs: string[] = [];

  await mkdir(path.join(generatedProjectDir, "node_modules"), { recursive: true });
  await mkdir(sourceDir, { recursive: true });

  try {
    for (let index = 0; index < 22; index += 1) {
      await writeFile(path.join(sourceDir, `file-${String(index).padStart(2, "0")}.ts`), "const value = 1\n", "utf8");
    }

    await runProjectValidationWithDeps({
      generatedProjectDir,
      skipInstall: true,
      onLog: (message) => {
        logs.push(message);
      },
      deps: {
        runCommand: async ({ args }) => {
          if (args[0] === "lint" && args[1] === "--fix") {
            for (let index = 0; index < 22; index += 1) {
              await writeFile(path.join(sourceDir, `file-${String(index).padStart(2, "0")}.ts`), "const value = 1;\n", "utf8");
            }
          }
          return {
            success: true,
            code: 0,
            stdout: "",
            stderr: "",
            combined: ""
          };
        }
      }
    });
  } finally {
    await rm(generatedProjectDir, { recursive: true, force: true });
  }

  assert.equal(logs.some((entry) => /\(\+2 more\)/.test(entry)), true);
});

test("runProjectValidationWithDeps runs ui validation when enabled", async () => {
  const calls: string[] = [];

  const result = await runProjectValidationWithDeps({
    generatedProjectDir: "/tmp/generated-project",
    onLog: () => {
      // no-op
    },
    enableUiValidation: true,
    deps: {
      runCommand: async ({ command, args }) => {
        calls.push(`${command} ${args.join(" ")}`);
        return {
          success: true,
          code: 0,
          stdout: "",
          stderr: "",
          combined: ""
        };
      }
    }
  });

  assert.equal(calls.includes("pnpm run validate:ui"), true);
  assert.equal(calls.includes("pnpm run --if-present validate:playwright"), true);
  assert.deepEqual(result.validateUi?.args, ["run", "validate:ui"]);
  assert.deepEqual(result.validatePlaywright?.args, [
    "run",
    "--if-present",
    "validate:playwright"
  ]);
});

test("runProjectValidationWithDeps configures deterministic ui gate report paths when jobDir is available", async () => {
  const calls: Array<{
    args: string[];
    env?: NodeJS.ProcessEnv;
  }> = [];
  const jobDir = "/tmp/workspace-dev-job";
  const { artifactDir, reportPath, baselinePath } = getUiGateReportPaths({ jobDir });

  await runProjectValidationWithDeps({
    generatedProjectDir: "/tmp/generated-project",
    jobDir,
    onLog: () => {
      // no-op
    },
    enableUiValidation: true,
    deps: {
      runCommand: async ({ args, env }) => {
        calls.push({
          args,
          ...(env ? { env } : {})
        });
        return {
          success: true,
          code: 0,
          stdout: "",
          stderr: "",
          combined: ""
        };
      }
    }
  });

  const uiValidationCall = calls.find((call) => call.args[0] === "run" && call.args[1] === "validate:ui");
  assert.notEqual(uiValidationCall, undefined);
  assert.equal(uiValidationCall?.env?.FIGMAPIPE_UI_GATE_REPORT_PATH, reportPath);
  assert.equal(uiValidationCall?.env?.FIGMAPIPE_UI_GATE_BASELINE_PATH, baselinePath);
  assert.equal(
    uiValidationCall?.env?.FIGMAPIPE_UI_GATE_VISUAL_AUDIT_ARTIFACT_DIR,
    path.join(artifactDir, "visual-audit")
  );

  const playwrightValidationCall = calls.find(
    (call) =>
      call.args[0] === "run" &&
      call.args[1] === "--if-present" &&
      call.args[2] === "validate:playwright"
  );
  assert.notEqual(playwrightValidationCall, undefined);
  assert.equal(playwrightValidationCall?.env?.FIGMAPIPE_UI_GATE_REPORT_PATH, reportPath);
  assert.equal(playwrightValidationCall?.env?.FIGMAPIPE_UI_GATE_BASELINE_PATH, baselinePath);
  assert.equal(
    playwrightValidationCall?.env?.FIGMAPIPE_UI_GATE_VISUAL_AUDIT_ARTIFACT_DIR,
    path.join(artifactDir, "visual-audit")
  );
});

test("runProjectValidationWithDeps runs unit tests when enabled", async () => {
  const calls: string[] = [];

  const result = await runProjectValidationWithDeps({
    generatedProjectDir: "/tmp/generated-project",
    onLog: () => {
      // no-op
    },
    enableUnitTestValidation: true,
    deps: {
      runCommand: async ({ command, args }) => {
        calls.push(`${command} ${args.join(" ")}`);
        return {
          success: true,
          code: 0,
          stdout: "",
          stderr: "",
          combined: ""
        };
      }
    }
  });

  assert.equal(calls.includes("pnpm run test"), true);
  assert.deepEqual(result.test?.args, ["run", "test"]);
});

test("runProjectValidationWithDeps does not retry test failures", async () => {
  let feedbackInvocations = 0;
  await assert.rejects(
    () =>
      runProjectValidationWithDeps({
        generatedProjectDir: "/tmp/generated-project",
        onLog: () => {
          // no-op
        },
        enableUnitTestValidation: true,
        deps: {
          runCommand: async ({ args }) => {
            if (args[0] === "run" && args[1] === "test") {
              return {
                success: false,
                code: 1,
                stdout: "",
                stderr: "test failed",
                combined: "test failed"
              };
            }
            return {
              success: true,
              code: 0,
              stdout: "",
              stderr: "",
              combined: ""
            };
          },
          runValidationFeedback: async () => {
            feedbackInvocations += 1;
            return {
              diagnostics: [],
              changedFiles: ["src/main.ts"],
              correctionsApplied: 1,
              fileCorrections: [{ filePath: "src/main.ts", editCount: 1, descriptions: ["Organized imports"] }],
              summary: "test failed"
            };
          }
        }
      }),
    /test failed/i
  );

  assert.equal(feedbackInvocations, 0);
});

test("runProjectValidationWithDeps fails fast when skipInstall=true and node_modules is missing", async () => {
  let invocationCount = 0;

  await assert.rejects(
    () =>
      runProjectValidationWithDeps({
        generatedProjectDir: "/tmp/workspace-dev-missing-node-modules",
        onLog: () => {
          // no-op
        },
        skipInstall: true,
        deps: {
          runCommand: async () => {
            invocationCount += 1;
            return {
              success: true,
              code: 0,
              stdout: "",
              stderr: "",
              combined: ""
            };
          }
        }
      }),
    /skipInstall=true requires an existing node_modules directory/
  );

  assert.equal(invocationCount, 0);
});

test("runProjectValidationWithDeps skips install command when skipInstall=true and node_modules exists", async () => {
  const generatedProjectDir = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-validation-skip-"));
  await mkdir(path.join(generatedProjectDir, "node_modules"), { recursive: true });

  const calls: string[] = [];
  try {
    await runProjectValidationWithDeps({
      generatedProjectDir,
      onLog: () => {
        // no-op
      },
      skipInstall: true,
      deps: {
        runCommand: async ({ command, args }) => {
          calls.push(`${command} ${args.join(" ")}`);
          return {
            success: true,
            code: 0,
            stdout: "",
            stderr: "",
            combined: ""
          };
        }
      }
    });
  } finally {
    await rm(generatedProjectDir, { recursive: true, force: true });
  }

  assert.deepEqual(calls, ["pnpm lint --fix", "pnpm lint", "pnpm typecheck", "pnpm build"]);
});

test("runProjectValidationWithDeps surfaces install command timeouts as validation pipeline errors", async () => {
  await assert.rejects(
    () =>
      runProjectValidationWithDeps({
        generatedProjectDir: "/tmp/generated-project",
        onLog: () => {
          // no-op
        },
        deps: {
          runCommand: async ({ args }) => {
            if (args[0] === "install") {
              return {
                success: false,
                code: 1,
                stdout: "",
                stderr: "install timed out",
                combined: "install timed out",
                timedOut: true
              };
            }
            return {
              success: true,
              code: 0,
              stdout: "",
              stderr: "",
              combined: ""
            };
          }
        }
      }),
    (error: unknown) => {
      assert.equal(error instanceof Error, true);
      const typed = error as Error & {
        code?: string;
        diagnostics?: Array<{ details?: Record<string, unknown> }>;
      };
      assert.equal(typed.code, "E_VALIDATE_PROJECT");
      assert.match(typed.message, /install failed \(command timeout\)/);
      assert.equal(typed.diagnostics?.[0]?.details?.command, "install");
      return true;
    }
  );
});

test("runProjectValidationWithDeps surfaces non-timeout install failures without adding a timeout suffix", async () => {
  await assert.rejects(
    () =>
      runProjectValidationWithDeps({
        generatedProjectDir: "/tmp/generated-project",
        onLog: () => {
          // no-op
        },
        deps: {
          runCommand: async ({ args }) => {
            if (args[0] === "install") {
              return {
                success: false,
                code: 1,
                stdout: "",
                stderr: "install failed",
                combined: "install failed"
              };
            }
            return {
              success: true,
              code: 0,
              stdout: "",
              stderr: "",
              combined: ""
            };
          }
        }
      }),
    (error: unknown) => {
      assert.equal(error instanceof Error, true);
      const typed = error as Error & {
        diagnostics?: Array<{ message?: string }>;
      };
      assert.match(typed.message, /^install failed: install failed$/);
      assert.equal(typed.diagnostics?.[0]?.message, "install failed.");
      return true;
    }
  );
});

test("runProjectValidationWithDeps omits prefer-offline when disabled and falls back to install when seeded node_modules is not a directory", async () => {
  const generatedProjectDir = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-validation-install-fallback-"));
  const seedNodeModulesDir = path.join(generatedProjectDir, "seed-node-modules.txt");
  const calls: string[] = [];

  await writeFile(seedNodeModulesDir, "not a directory\n", "utf8");

  try {
    await runProjectValidationWithDeps({
      generatedProjectDir,
      seedNodeModulesDir,
      installPreferOffline: false,
      onLog: () => {
        // no-op
      },
      deps: {
        runCommand: async ({ command, args }) => {
          calls.push(`${command} ${args.join(" ")}`);
          return {
            success: true,
            code: 0,
            stdout: "",
            stderr: "",
            combined: ""
          };
        }
      }
    });
  } finally {
    await rm(generatedProjectDir, { recursive: true, force: true });
  }

  assert.deepEqual(calls, [
    "pnpm install --ignore-scripts --frozen-lockfile --reporter append-only",
    "pnpm lint --fix",
    "pnpm lint",
    "pnpm typecheck",
    "pnpm build"
  ]);
});

test("runProjectValidationWithDeps logs lint autofix diff scan failures and zero-change summaries without aborting validation", async (t) => {
  await t.test("logs pre-scan failures when lint-autofix cannot read the project before running", async () => {
    const generatedProjectDir = path.join(os.tmpdir(), `workspace-dev-validation-missing-${Date.now()}`);
    const logs: string[] = [];

    await runProjectValidationWithDeps({
      generatedProjectDir,
      onLog: (message) => {
        logs.push(message);
      },
      deps: {
        runCommand: async () => ({
          success: true,
          code: 0,
          stdout: "",
          stderr: "",
          combined: ""
        })
      }
    });

    assert.equal(logs.some((entry) => entry.startsWith("Lint auto-fix file-diff pre-scan failed:")), true);
  });

  await t.test("logs post-scan failures when lint-autofix invalidates the project tree after pre-scan", async () => {
    const generatedProjectDir = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-validation-postscan-"));
    const logs: string[] = [];

    await mkdir(path.join(generatedProjectDir, "src"), { recursive: true });
    await writeFile(path.join(generatedProjectDir, "src", "main.ts"), "const value = 1;\n", "utf8");

    try {
      await runProjectValidationWithDeps({
        generatedProjectDir,
        onLog: (message) => {
          logs.push(message);
        },
        deps: {
          runCommand: async ({ args }) => {
            if (args[0] === "lint" && args[1] === "--fix") {
              await rm(generatedProjectDir, { recursive: true, force: true });
            }
            return {
              success: true,
              code: 0,
              stdout: "",
              stderr: "",
              combined: ""
            };
          }
        }
      });
    } finally {
      await rm(generatedProjectDir, { recursive: true, force: true });
    }

    assert.equal(logs.some((entry) => entry.startsWith("Lint auto-fix file-diff post-scan failed:")), true);
  });

  await t.test("logs a zero-change summary when lint-autofix does not modify any lint-relevant files", async () => {
    const generatedProjectDir = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-validation-zero-diff-"));
    const logs: string[] = [];

    await mkdir(path.join(generatedProjectDir, "node_modules"), { recursive: true });

    try {
      await runProjectValidationWithDeps({
        generatedProjectDir,
        skipInstall: true,
        onLog: (message) => {
          logs.push(message);
        },
        deps: {
          runCommand: async () => ({
            success: true,
            code: 0,
            stdout: "",
            stderr: "",
            combined: ""
          })
        }
      });
    } finally {
      await rm(generatedProjectDir, { recursive: true, force: true });
    }

    assert.equal(logs.includes("Lint auto-fix changed 0 lint-relevant file(s)."), true);
  });
});

test("runProjectValidationWithDeps aborts before or during command execution when cancellation is requested", async (t) => {
  await t.test("pre-aborted validation stops before invoking pnpm", async () => {
    const controller = new AbortController();
    controller.abort();
    let invocations = 0;

    await assert.rejects(
      () =>
        runProjectValidationWithDeps({
          generatedProjectDir: "/tmp/generated-project",
          abortSignal: controller.signal,
          onLog: () => {
            // no-op
          },
          deps: {
            runCommand: async () => {
              invocations += 1;
              return {
                success: true,
                code: 0,
                stdout: "",
                stderr: "",
                combined: ""
              };
            }
          }
        }),
      /Validation canceled by job cancellation request/
    );

    assert.equal(invocations, 0);
  });

  await t.test("canceled install commands surface a deterministic cancellation envelope", async () => {
    await assert.rejects(
      () =>
        runProjectValidationWithDeps({
          generatedProjectDir: "/tmp/generated-project",
          onLog: () => {
            // no-op
          },
          deps: {
            runCommand: async ({ args }) => ({
              success: false,
              code: 1,
              stdout: "",
              stderr: "",
              combined: `${args[0]} canceled`,
              canceled: args[0] === "install"
            })
          }
        }),
      /install canceled by job cancellation request/
    );
  });
});

test("runProjectValidation forwards optional seed and abort settings to the shared validator", async () => {
  const generatedProjectDir = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-validation-wrapper-"));
  const controller = new AbortController();
  controller.abort();

  await mkdir(path.join(generatedProjectDir, "node_modules"), { recursive: true });

  try {
    await assert.rejects(
      () =>
        import("./validation.js").then(({ runProjectValidation }) =>
          runProjectValidation({
            generatedProjectDir,
            skipInstall: true,
            seedNodeModulesDir: path.join(generatedProjectDir, "seed-node-modules"),
            abortSignal: controller.signal,
            onLog: () => {
              // no-op
            }
          })
        ),
      /Validation canceled by job cancellation request/
    );
  } finally {
    await rm(generatedProjectDir, { recursive: true, force: true });
  }
});

test("#698 lockfileMutable disables frozen-lockfile enforcement for generated-project installs", async () => {
  const generatedProjectDir = await mkdtemp(
    path.join(os.tmpdir(), "workspace-dev-validation-lockfile-mutable-")
  );
  try {
    await writeValidationFeedbackProject({ generatedProjectDir });
    await linkLocalTypescript({ generatedProjectDir });

    const calls: string[] = [];
    await runProjectValidationWithDeps({
      generatedProjectDir,
      onLog: () => {},
      lockfileMutable: true,
      deps: {
        runCommand: async ({ command, args }) => {
          calls.push(`${command} ${args.join(" ")}`);
          return { success: true, code: 0, stdout: "", stderr: "", combined: "" };
        },
        runValidationFeedback: async () => ({ applied: false })
      }
    });

    const installCall = calls.find((call) => call.startsWith("pnpm install"));
    assert.ok(installCall, "Expected a pnpm install call");
    assert.match(installCall, /--ignore-scripts/, "Expected --ignore-scripts in mutable lockfile install");
    assert.match(
      installCall,
      /--no-frozen-lockfile/,
      "Expected --no-frozen-lockfile in mutable lockfile install"
    );
    assert.ok(
      !installCall.includes("--frozen-lockfile"),
      "Expected no --frozen-lockfile in mutable lockfile install"
    );
  } finally {
    await rm(generatedProjectDir, { recursive: true, force: true });
  }
});
