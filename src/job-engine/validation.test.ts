import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { runProjectValidationWithDeps } from "./validation.js";

test("runProjectValidationWithDeps executes deterministic pnpm command sequence", async () => {
  const calls: string[] = [];

  await runProjectValidationWithDeps({
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
    "pnpm install --frozen-lockfile --reporter append-only --prefer-offline",
    "pnpm lint --fix",
    "pnpm lint",
    "pnpm typecheck",
    "pnpm build"
  ]);
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
    "pnpm install --frozen-lockfile --reporter append-only --prefer-offline",
    "pnpm lint",
    "pnpm typecheck",
    "pnpm build"
  ]);
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
    "pnpm install --frozen-lockfile --reporter append-only --prefer-offline",
    "pnpm lint --fix",
    "pnpm lint",
    "pnpm typecheck",
    "pnpm build",
    "pnpm run perf:assert"
  ]);
  assert.match(String(envByCommand["pnpm run perf:assert"]?.FIGMAPIPE_PERF_ARTIFACT_DIR), /\.figmapipe\/performance$/);
  assert.match(String(envByCommand["pnpm run perf:assert"]?.FIGMAPIPE_PERF_BASELINE_PATH), /perf-baseline\.json$/);
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
    "pnpm install --frozen-lockfile --reporter append-only --prefer-offline",
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
    "pnpm install --frozen-lockfile --reporter append-only --prefer-offline",
    "pnpm lint --fix",
    "pnpm lint",
    "pnpm lint --fix",
    "pnpm lint",
    "pnpm typecheck",
    "pnpm build"
  ]);
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

test("runProjectValidationWithDeps runs ui validation when enabled", async () => {
  const calls: string[] = [];

  await runProjectValidationWithDeps({
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
});

test("runProjectValidationWithDeps runs unit tests when enabled", async () => {
  const calls: string[] = [];

  await runProjectValidationWithDeps({
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
