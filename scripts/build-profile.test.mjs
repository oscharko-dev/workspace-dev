import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import test from "node:test";

const runBuildProfileDryRun = async (args) =>
  await new Promise((resolve, reject) => {
    const child = spawn(
      "node",
      ["scripts/build-profile.mjs", "--dry-run", ...args],
      {
        cwd: new URL("..", import.meta.url),
        stdio: ["ignore", "pipe", "pipe"],
      },
    );

    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      reject(new Error(`build-profile exited ${code ?? 1}: ${stderr}`));
    });
  });

test("build-profile dry run exposes profile-specific template allowlists", async () => {
  const { stdout } = await runBuildProfileDryRun(["--profile", "default"]);
  const plan = JSON.parse(stdout);

  assert.deepEqual(
    plan.map((entry) => entry.profile),
    ["default"],
  );
  assert.deepEqual(plan[0].pipelines, ["default"]);
  assert.deepEqual(plan[0].templates, ["react-tailwind-app"]);
  assert.ok(
    plan[0].allowlists.templates["react-tailwind-app"].includes(
      "template/react-tailwind-app/package.json",
    ),
  );
  assert.equal(plan[0].allowlists.templates["react-mui-app"], undefined);
});

test("build-profile dry run normalizes default,rocket profile alias", async () => {
  const { stdout } = await runBuildProfileDryRun([
    "--profile",
    "default,rocket",
  ]);
  const plan = JSON.parse(stdout);

  assert.deepEqual(
    plan.map((entry) => entry.profile),
    ["default-rocket"],
  );
  assert.deepEqual(plan[0].pipelines, ["default", "rocket"]);
  assert.deepEqual(plan[0].templates, ["react-tailwind-app", "react-mui-app"]);
});
