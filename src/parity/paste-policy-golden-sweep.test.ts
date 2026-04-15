import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const currentFile = fileURLToPath(import.meta.url);
const goldenRoot = path.resolve(path.dirname(currentFile), "fixtures/golden");

const TAILWIND_CLASSNAME_PATTERN =
  /className=(?:"[^"]*\b[a-zA-Z]+-[a-zA-Z0-9-]+\b[^"]*"|`[^`]*\b[a-zA-Z]+-[a-zA-Z0-9-]+\b[^`]*`|\{[^}]*\b[a-zA-Z]+-[a-zA-Z0-9-]+\b[^}]*\})/;
const TAILWIND_CONFIG_PATTERN = /tailwind\.config/;
const STYLESHEET_EXTENSIONS = new Set([".css", ".scss"]);

type CollectedFile = {
  absolutePath: string;
  relativePath: string;
};

const collectFilesRecursive = async (
  rootDir: string,
  currentDir: string,
  accumulator: CollectedFile[],
): Promise<void> => {
  const entries = await readdir(currentDir, { withFileTypes: true });
  for (const entry of entries) {
    const absolutePath = path.join(currentDir, entry.name);
    if (entry.isDirectory()) {
      await collectFilesRecursive(rootDir, absolutePath, accumulator);
    } else if (entry.isFile()) {
      accumulator.push({
        absolutePath,
        relativePath: path.relative(rootDir, absolutePath),
      });
    }
  }
};

interface GoldenManifest {
  version: number;
  fixtures: Array<{ id: string }>;
}

const listGoldenFixtures = async (): Promise<string[]> => {
  const manifestPath = path.join(goldenRoot, "manifest.json");
  const raw = await readFile(manifestPath, "utf8");
  const manifest = JSON.parse(raw) as GoldenManifest;
  return manifest.fixtures.map((f) => f.id);
};

const goldenFixtureNames = await listGoldenFixtures();

for (const fixtureName of goldenFixtureNames) {
  test(`policy: no Tailwind in golden fixture '${fixtureName}' (issue #1009)`, async () => {
    const fixtureDir = path.join(goldenRoot, fixtureName);
    const expectedDir = path.join(fixtureDir, "expected");

    const collected: CollectedFile[] = [];
    await collectFilesRecursive(expectedDir, expectedDir, collected);

    const stylesheetFiles = collected.filter((file) =>
      STYLESHEET_EXTENSIONS.has(path.extname(file.relativePath).toLowerCase()),
    );
    assert.deepEqual(
      stylesheetFiles.map((file) => file.relativePath),
      [],
      `Expected no .css/.scss files in '${fixtureName}/expected/' listing.`,
    );

    const tailwindConfigFiles = collected.filter((file) =>
      TAILWIND_CONFIG_PATTERN.test(file.relativePath),
    );
    assert.deepEqual(
      tailwindConfigFiles.map((file) => file.relativePath),
      [],
      `Expected no tailwind.config file in '${fixtureName}/expected/' listing.`,
    );

    const tsxFiles = collected.filter(
      (file) => path.extname(file.relativePath) === ".tsx",
    );

    for (const tsxFile of tsxFiles) {
      const content = await readFile(tsxFile.absolutePath, "utf8");
      assert.ok(
        !TAILWIND_CLASSNAME_PATTERN.test(content),
        `Expected no Tailwind utility className patterns in '${fixtureName}/expected/${tsxFile.relativePath}'.`,
      );
    }
  });
}
