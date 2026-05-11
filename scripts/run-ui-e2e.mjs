#!/usr/bin/env node
import { spawnSync } from "node:child_process";

const [mode, ...rawArgs] = process.argv.slice(2);
if (mode !== "chromium" && mode !== "matrix" && mode !== "live") {
  console.error(`Unsupported ui e2e mode: ${mode ?? "<missing>"}`);
  process.exit(1);
}

const forwardedArgs = rawArgs[0] === "--" ? rawArgs.slice(1) : rawArgs;

const buildResult = spawnSync("pnpm", ["run", "ui:build"], {
  stdio: "inherit",
  shell: process.platform === "win32"
});
if ((buildResult.status ?? 1) !== 0) {
  process.exit(buildResult.status ?? 1);
}

const playwrightArgs = ["exec", "playwright", "test", "--config", "ui-src/playwright.config.ts"];
if (mode === "chromium") {
  playwrightArgs.push("--project=chromium");
}
if (mode === "live") {
  playwrightArgs.push("--project=chromium", "live.spec.ts");
}
playwrightArgs.push(...forwardedArgs);

const testResult = spawnSync("pnpm", playwrightArgs, {
  stdio: "inherit",
  shell: process.platform === "win32",
  env:
    mode === "live"
      ? {
          ...process.env,
          WORKSPACE_DEV_E2E_INCLUDE_LIVE: "1",
          INSPECTOR_LIVE_E2E: "1"
        }
      : process.env
});
process.exit(testResult.status ?? 1);
