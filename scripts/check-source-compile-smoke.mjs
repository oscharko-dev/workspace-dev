#!/usr/bin/env node

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(__dirname, "..");
const sourceExtensions = new Set([".ts", ".tsx"]);

const resolveSourceRoot = () => {
  const raw = process.env.WORKSPACE_DEV_SOURCE_COMPILE_SMOKE_ROOT?.trim();
  if (!raw) {
    return path.resolve(packageRoot, "src");
  }
  return path.isAbsolute(raw) ? raw : path.resolve(packageRoot, raw);
};

const collectSourceFiles = async (rootDir) => {
  const files = [];
  const walk = async (dir) => {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === "node_modules" || entry.name === "dist") {
        continue;
      }
      const absolutePath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(absolutePath);
        continue;
      }
      if (!entry.isFile()) {
        continue;
      }
      if (sourceExtensions.has(path.extname(entry.name))) {
        files.push(absolutePath);
      }
    }
  };

  await walk(rootDir);
  return files.sort((first, second) => first.localeCompare(second));
};

const toCompilerOptions = (filePath) => {
  const compilerOptions = {
    target: ts.ScriptTarget.ES2023,
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    isolatedModules: true,
    verbatimModuleSyntax: true
  };
  if (path.extname(filePath) === ".tsx") {
    compilerOptions.jsx = ts.JsxEmit.ReactJSX;
  }
  return compilerOptions;
};

const formatDiagnostic = (diagnostic) => {
  const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n");
  if (!diagnostic.file || diagnostic.start === undefined) {
    return message;
  }

  const { line, character } = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start);
  return `${diagnostic.file.fileName}:${line + 1}:${character + 1} - ${message}`;
};

const collectTranspileErrors = async (filePath) => {
  const sourceText = await readFile(filePath, "utf8");
  const result = ts.transpileModule(sourceText, {
    fileName: filePath,
    reportDiagnostics: true,
    compilerOptions: toCompilerOptions(filePath)
  });

  return (result.diagnostics ?? [])
    .filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error)
    .map((diagnostic) => formatDiagnostic(diagnostic));
};

const main = async () => {
  const sourceRoot = resolveSourceRoot();
  const sourceFiles = await collectSourceFiles(sourceRoot);

  const errors = [];
  for (const sourceFile of sourceFiles) {
    errors.push(...(await collectTranspileErrors(sourceFile)));
  }

  if (errors.length > 0) {
    console.error(`[source-compile-smoke] Found ${errors.length} transpile diagnostic error(s).`);
    for (const error of errors) {
      console.error(`[source-compile-smoke] ${error}`);
    }
    process.exit(1);
  }

  console.log(`[source-compile-smoke] Parsed ${sourceFiles.length} TypeScript source files without errors.`);
};

main().catch((error) => {
  console.error("[source-compile-smoke] Failed:", error);
  process.exit(1);
});
