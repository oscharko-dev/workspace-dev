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

// ── IR boundary: generator modules must not import from ir.ts internals ─────
// Generator modules should depend only on types-ir.ts / types.ts, never on ir.ts directly.
const IR_BOUNDARY_PATTERN = /from\s+["']\.\/ir\.js["']/;
const IR_BOUNDARY_SCOPE_PREFIX = "src/parity/generator-";
const GENERATOR_CORE_BACKEDGE_PATTERN = /from\s+["'](?:\.\.?\/)+generator-core\.js["']/;
const GENERATOR_CORE_BACKEDGE_REQUIRE_PATTERN = /require\s*\(\s*["'](?:\.\.?\/)+generator-core\.js["']\s*\)/;
const STAGE_SERVICE_PATH_PATTERN = /^src\/job-engine\/services\/(.+)-service\.ts$/;
const STAGE_SERVICE_IMPORT_PATTERN = /from\s+["']\.\/([a-z0-9-]+-service)\.js["']/i;
const STAGE_SERVICE_REQUIRE_PATTERN = /require\s*\(\s*["']\.\/([a-z0-9-]+-service)\.js["']\s*\)/i;
const CUSTOMER_PROFILE_TEMPLATE_IMPORT_PATTERN = /from\s+["'](?:\.\.?\/)+customer-profile-template\.js["']/;
const CUSTOMER_PROFILE_TEMPLATE_REQUIRE_PATTERN = /require\s*\(\s*["'](?:\.\.?\/)+customer-profile-template\.js["']\s*\)/;
const CUSTOMER_PROFILE_TEMPLATE_IMPORT_ALLOWLIST = new Set([
  "src/job-engine/services/rocket-template-prepare-service.ts"
]);

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
    const relativePath = path.relative(process.cwd(), filePath);
    const relativePathPosix = relativePath.split(path.sep).join("/");
    const isGeneratorModule =
      relativePathPosix.startsWith(IR_BOUNDARY_SCOPE_PREFIX) &&
      !relativePathPosix.endsWith(".test.ts");
    const isParityGeneratorInternal =
      (relativePathPosix.startsWith("src/parity/generator-") && relativePathPosix !== "src/parity/generator-core.ts" && !relativePathPosix.endsWith(".test.ts")) ||
      relativePathPosix.startsWith("src/parity/templates/");
    const stageServiceMatch = relativePathPosix.match(STAGE_SERVICE_PATH_PATTERN);
    const currentStageServiceName = stageServiceMatch ? `${stageServiceMatch[1]}-service` : undefined;
    const isTestFile = relativePathPosix.endsWith(".test.ts") || relativePathPosix.endsWith(".test.tsx");
    for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
      const line = lines[lineIndex];
      for (const pattern of FORBIDDEN_PATTERNS) {
        if (pattern.test(line)) {
          violations.push({
            file: relativePath,
            line: lineIndex + 1,
            content: line.trim(),
            type: "import"
          });
        }
      }
      if (isGeneratorModule && IR_BOUNDARY_PATTERN.test(line)) {
        violations.push({
          file: relativePath,
          line: lineIndex + 1,
          content: `IR boundary violation: generator module imports from ir.ts directly. Use types.js instead. [${line.trim()}]`,
          type: "import"
        });
      }
      if (
        isParityGeneratorInternal &&
        (GENERATOR_CORE_BACKEDGE_PATTERN.test(line) || GENERATOR_CORE_BACKEDGE_REQUIRE_PATTERN.test(line))
      ) {
        violations.push({
          file: relativePath,
          line: lineIndex + 1,
          content:
            `Generator boundary violation: parity internals must not import generator-core.js. ` +
            `Import the owning submodule directly instead. [${line.trim()}]`,
          type: "import"
        });
      }
      if (currentStageServiceName) {
        const importedStageService = line.match(STAGE_SERVICE_IMPORT_PATTERN)?.[1] ?? line.match(STAGE_SERVICE_REQUIRE_PATTERN)?.[1];
        if (importedStageService && importedStageService !== currentStageServiceName) {
          violations.push({
            file: relativePath,
            line: lineIndex + 1,
            content:
              `Stage service coupling violation: '${currentStageServiceName}' imports '${importedStageService}'. ` +
              "Use pipeline orchestrator wiring instead of direct stage-to-stage imports.",
            type: "import"
          });
        }
      }
      if (
        !isTestFile &&
        !CUSTOMER_PROFILE_TEMPLATE_IMPORT_ALLOWLIST.has(relativePathPosix) &&
        (CUSTOMER_PROFILE_TEMPLATE_IMPORT_PATTERN.test(line) || CUSTOMER_PROFILE_TEMPLATE_REQUIRE_PATTERN.test(line))
      ) {
        violations.push({
          file: relativePath,
          line: lineIndex + 1,
          content:
            "Rocket boundary violation: customer-profile-template.js may only be imported by " +
            "rocket-template-prepare-service.ts in production code.",
          type: "import"
        });
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
