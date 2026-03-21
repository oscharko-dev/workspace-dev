#!/usr/bin/env node
import { spawnSync } from "node:child_process";

const [mode, ...rawArgs] = process.argv.slice(2);
if (mode !== "chromium" && mode !== "matrix") {
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
playwrightArgs.push(...forwardedArgs);

const testResult = spawnSync("pnpm", playwrightArgs, {
  stdio: "inherit",
  shell: process.platform === "win32"
});
process.exit(testResult.status ?? 1);
