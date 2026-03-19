import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { shouldIncludeTemplateCopyPath } from "./template-copy-filter.js";

const templateRoot = path.join(path.sep, "tmp", "react-mui-app-template");

const toSourcePath = (relativePath: string): string => {
  return path.join(templateRoot, ...relativePath.split("/"));
};

const include = (relativePath: string): boolean => {
  return shouldIncludeTemplateCopyPath({
    templateRoot,
    sourcePath: toSourcePath(relativePath)
  });
};

test("template copy filter includes essential source files", () => {
  assert.equal(
    shouldIncludeTemplateCopyPath({
      templateRoot,
      sourcePath: templateRoot
    }),
    true
  );
  assert.equal(include("package.json"), true);
  assert.equal(include("pnpm-lock.yaml"), true);
  assert.equal(include("src/App.tsx"), true);
});

test("template copy filter excludes configured artifact directories recursively", () => {
  assert.equal(include("node_modules/react/index.js"), false);
  assert.equal(include(".git/objects/xx/yy"), false);
  assert.equal(include(".idea/workspace.xml"), false);
  assert.equal(include(".vscode/settings.json"), false);
  assert.equal(include(".vite/deps/chunk.js"), false);
  assert.equal(include("dist/assets/index.js"), false);
  assert.equal(include("build/output/index.html"), false);
  assert.equal(include("artifacts/performance/report.json"), false);
});

test("template copy filter excludes configured files and log suffixes", () => {
  assert.equal(include(".DS_Store"), false);
  assert.equal(include("src/.DS_Store"), false);
  assert.equal(include("Thumbs.db"), false);
  assert.equal(include(".env.local"), false);
  assert.equal(include("error.log"), false);
  assert.equal(include("logs/build.log"), false);
});

test("template copy filter rejects paths outside template root", () => {
  assert.equal(
    shouldIncludeTemplateCopyPath({
      templateRoot,
      sourcePath: path.join(path.sep, "tmp", "outside", "file.ts")
    }),
    false
  );
});
