import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(__dirname, "..");

const readRepoFile = async (relativePath: string): Promise<string> => {
  return await readFile(path.resolve(packageRoot, relativePath), "utf8");
};

test("integration: published docs and manifest stay aligned on the TypeScript support floor", async () => {
  const packageJson = JSON.parse(await readRepoFile("package.json")) as {
    peerDependencies: {
      typescript: string;
    };
    peerDependenciesMeta: {
      typescript: {
        optional: boolean;
      };
    };
  };
  const readmeDoc = await readRepoFile("README.md");
  const compatibilityDoc = await readRepoFile("COMPATIBILITY.md");

  assert.equal(packageJson.peerDependencies.typescript, ">=5.0.0");
  assert.equal(packageJson.peerDependenciesMeta.typescript.optional, true);
  assert.match(readmeDoc, /TypeScript `>=5\.0\.0` for typed package consumption/);
  assert.match(readmeDoc, /published dual ESM\/CJS type surface is validated only for TypeScript 5\+ consumers/i);
  assert.match(compatibilityDoc, /\| TypeScript consumer compiler \| 5\.0\.0 \| >=5\.0\.0 \|/);
  assert.match(compatibilityDoc, /TypeScript 4\.x consumers are unsupported and must upgrade to TypeScript `>=5\.0\.0`/);
});
