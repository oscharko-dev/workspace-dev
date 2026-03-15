import assert from "node:assert/strict";
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
    "pnpm lint",
    "pnpm typecheck",
    "pnpm build",
    "pnpm run perf:assert"
  ]);
  assert.match(String(envByCommand["pnpm run perf:assert"]?.FIGMAPIPE_PERF_ARTIFACT_DIR), /\.figmapipe\/performance$/);
  assert.match(String(envByCommand["pnpm run perf:assert"]?.FIGMAPIPE_PERF_BASELINE_PATH), /perf-baseline\.json$/);
});

test("runProjectValidationWithDeps throws on first failing command", async () => {
  let invocation = 0;

  await assert.rejects(
    () =>
      runProjectValidationWithDeps({
        generatedProjectDir: "/tmp/generated-project",
        onLog: () => {
          // no-op
        },
        deps: {
          runCommand: async ({ args }) => {
            invocation += 1;
            if (args[0] === "lint") {
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
          }
        }
      }),
    /lint failed/
  );

  assert.ok(invocation >= 2);
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
