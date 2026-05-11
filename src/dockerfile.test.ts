import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const MODULE_DIR =
  typeof __dirname === "string"
    ? __dirname
    : path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(MODULE_DIR, "..");
const dockerfilePath = path.join(packageRoot, "Dockerfile");

test("Dockerfile provisions the Tailwind template and Playwright Chromium for runtime validation", async () => {
  const dockerfile = await readFile(dockerfilePath, "utf8");

  assert.match(
    dockerfile,
    /COPY template\/react-tailwind-app\/package\.json template\/react-tailwind-app\/pnpm-lock\.yaml template\/react-tailwind-app\/\.npmrc \.\/template\/react-tailwind-app\//,
  );
  assert.match(
    dockerfile,
    /pnpm --dir template\/react-tailwind-app install --frozen-lockfile --ignore-scripts --store-dir \/app\/\.pnpm-store/,
  );
  assert.match(
    dockerfile,
    /PLAYWRIGHT_BROWSERS_PATH=\/opt\/workspace-dev\/\.cache\/ms-playwright/,
  );
  assert.match(
    dockerfile,
    /COPY --from=deps --chown=workspace-dev:workspace-dev \/app\/template\/react-tailwind-app\/node_modules \.\/template\/react-tailwind-app\/node_modules/,
  );
  assert.match(
    dockerfile,
    /pnpm --dir template\/react-tailwind-app exec playwright install --with-deps chromium/,
  );

  const installIndex = dockerfile.indexOf(
    "pnpm --dir template/react-tailwind-app exec playwright install --with-deps chromium",
  );
  const userIndex = dockerfile.indexOf("USER workspace-dev");

  assert.ok(installIndex !== -1, "Expected Playwright install command.");
  assert.ok(userIndex !== -1, "Expected runtime user switch.");
  assert.ok(
    installIndex < userIndex,
    "Expected Chromium installation to occur before switching to the app user.",
  );
});
