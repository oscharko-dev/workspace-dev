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
    "pnpm install --frozen-lockfile",
    "pnpm lint",
    "pnpm typecheck",
    "pnpm build"
  ]);
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
