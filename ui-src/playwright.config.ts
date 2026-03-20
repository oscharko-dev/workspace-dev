import { defineConfig, devices } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const e2ePort = 19831;

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  expect: {
    timeout: 10_000
  },
  use: {
    trace: "retain-on-failure"
  },
  webServer: {
    command: `node --import tsx ./src/cli.ts start --host 127.0.0.1 --port ${String(e2ePort)} --preview true`,
    cwd: repoRoot,
    url: `http://127.0.0.1:${String(e2ePort)}/healthz`,
    timeout: 120_000,
    reuseExistingServer: false
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"]
      }
    }
  ]
});
