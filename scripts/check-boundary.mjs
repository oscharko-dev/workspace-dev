#!/usr/bin/env node
/**
 * Boundary check: ensures workspace-dev has no imports from
 * internal services, infrastructure, or other monorepo-internal modules.
 *
 * Also verifies that package.json keeps zero runtime dependencies.
 */
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC_DIR = path.resolve(__dirname, "../src");
const PKG_JSON = path.resolve(__dirname, "../package.json");

// ── Source-level forbidden import patterns ──────────────────────────────────
const FORBIDDEN_PATTERNS = [
  // Relative imports to internal modules
  /from\s+["']\.\.\/\.\.\/services\//,
  /from\s+["']\.\.\/\.\.\/workspace\//,
  /from\s+["']\.\.\/\.\.\/infra\//,
  /from\s+["']\.\.\/\.\.\/quality\//,
  /from\s+["']\.\.\/\.\.\/scripts\//,
  // Package-level internal imports
  /from\s+["']figmapipe-api/,
  /from\s+["']@figmapipe\/api/,
  // Forbidden Node builtins for a public package
  /from\s+["']node:sqlite/,
  // require() variants
  /require\s*\(\s*["']\.\.\/\.\.\/services\//,
  /require\s*\(\s*["']\.\.\/\.\.\/workspace\//,
  /require\s*\(\s*["']\.\.\/\.\.\/infra\//,
  /require\s*\(\s*["']figmapipe-api/,
  /require\s*\(\s*["']@figmapipe\/api/
];

// ── Package.json forbidden runtime dependencies ─────────────────────────────
const FORBIDDEN_DEPENDENCIES = ["pg", "ioredis", "bullmq", "figmapipe-api", "@figmapipe/api", "sqlite3", "better-sqlite3", "fastify", "zod"];

const collectTsFiles = async (dir) => {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory() && entry.name !== "node_modules" && entry.name !== "dist") {
      files.push(...(await collectTsFiles(fullPath)));
    } else if (entry.isFile() && (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx"))) {
      files.push(fullPath);
    }
  }
  return files;
};

const main = async () => {
  const violations = [];

  // ── Check source files ────────────────────────────────────────────────────
  const files = await collectTsFiles(SRC_DIR);

  for (const filePath of files) {
    const content = await readFile(filePath, "utf-8");
    const lines = content.split("\n");
    for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
      const line = lines[lineIndex];
      for (const pattern of FORBIDDEN_PATTERNS) {
        if (pattern.test(line)) {
          violations.push({
            file: path.relative(process.cwd(), filePath),
            line: lineIndex + 1,
            content: line.trim(),
            type: "import"
          });
        }
      }
    }
  }

  // ── Check package.json dependencies ───────────────────────────────────────
  const pkgContent = await readFile(PKG_JSON, "utf-8");
  const pkg = JSON.parse(pkgContent);
  const runtimeDeps = { ...(pkg.dependencies ?? {}) };
  const allDeps = {
    ...runtimeDeps,
    ...(pkg.peerDependencies ?? {})
  };

  const runtimeDependencyNames = Object.keys(runtimeDeps);
  if (runtimeDependencyNames.length > 0) {
    violations.push({
      file: "package.json",
      line: 0,
      content: `Runtime dependencies must be empty. Found: ${runtimeDependencyNames.join(", ")}`,
      type: "dependency"
    });
  }

  for (const forbidden of FORBIDDEN_DEPENDENCIES) {
    if (forbidden in allDeps) {
      violations.push({
        file: "package.json",
        line: 0,
        content: `Forbidden dependency: ${forbidden}`,
        type: "dependency"
      });
    }
  }

  // ── Report ────────────────────────────────────────────────────────────────
  if (violations.length === 0) {
    console.log("✅ Boundary check passed: no forbidden imports or dependencies found.");
    console.log(`   Checked: ${files.length} source files + package.json`);
    console.log(`   Patterns: ${FORBIDDEN_PATTERNS.length} import patterns, ${FORBIDDEN_DEPENDENCIES.length} dependency names`);
    process.exit(0);
  }

  console.error(`❌ Boundary check failed: ${violations.length} violation(s) found.\n`);
  for (const v of violations) {
    if (v.type === "import") {
      console.error(`  ${v.file}:${v.line}`);
      console.error(`    ${v.content}\n`);
    } else {
      console.error(`  ${v.file}: ${v.content}\n`);
    }
  }
  process.exit(1);
};

main().catch((error) => {
  console.error("Boundary check failed:", error);
  process.exit(1);
});
