import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { runA11yChecks, runInteractionChecks } from "./validate-ui-report-lib.mjs";

const SOURCE_EXTENSIONS = new Set([".tsx", ".ts", ".jsx", ".js"]);

const normalizePath = (value) => {
  return value.replace(/\\/g, "/").replace(/^\.\//, "");
};

const resolveReportPath = () => {
  const configured = process.env.FIGMAPIPE_UI_GATE_REPORT_PATH?.trim();
  if (configured) {
    return configured;
  }
  return path.join(process.cwd(), "ui-gate-report.json");
};

const parseStringArray = (value) => {
  if (!value) {
    return [];
  }
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter((entry) => typeof entry === "string").map((entry) => entry.trim()).filter((entry) => entry.length > 0);
  } catch {
    return [];
  }
};

const readChangedSurfaces = async () => {
  const fromJson = parseStringArray(process.env.FIGMAPIPE_UI_GATE_CHANGED_SURFACES_JSON);
  const filePath = process.env.FIGMAPIPE_UI_GATE_CHANGED_SURFACES_FILE?.trim();
  const fromFile = filePath ? parseStringArray(await readFile(filePath, "utf-8").catch(() => "")) : [];
  return [...new Set([...fromJson, ...fromFile].map((entry) => normalizePath(entry)))];
};

const collectSourceFiles = async (rootDir) => {
  const files = [];
  const walk = async (dir) => {
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (entry.name === "node_modules" || entry.name === "dist" || entry.name.startsWith(".")) {
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
      if (SOURCE_EXTENSIONS.has(path.extname(entry.name))) {
        files.push(absolutePath);
      }
    }
  };

  await walk(rootDir);
  return files;
};

const toSurfaceSourcePath = (input) => {
  const normalized = normalizePath(input);
  if (normalized.startsWith("src/")) {
    return normalized;
  }
  const srcIndex = normalized.indexOf("/src/");
  if (srcIndex >= 0) {
    return normalized.slice(srcIndex + 1);
  }
  return undefined;
};

const filterSurfaceFiles = ({ changedSurfaces, sourceFiles, sourceRoot }) => {
  const sourceByRelativePath = new Map(
    sourceFiles.map((absolutePath) => [normalizePath(path.relative(process.cwd(), absolutePath)), absolutePath])
  );
  const sourceByBaseName = new Map();
  for (const absolutePath of sourceFiles) {
    const baseName = path.basename(absolutePath);
    const current = sourceByBaseName.get(baseName) ?? [];
    sourceByBaseName.set(baseName, [...current, absolutePath]);
  }

  const resolved = [];
  for (const surface of changedSurfaces) {
    const normalizedSurface = toSurfaceSourcePath(surface);
    if (!normalizedSurface) {
      continue;
    }

    const direct = sourceByRelativePath.get(normalizedSurface);
    if (direct) {
      resolved.push(direct);
      continue;
    }

    const fromSourceRoot = path.join(sourceRoot, path.basename(normalizedSurface));
    if (sourceByRelativePath.has(normalizePath(path.relative(process.cwd(), fromSourceRoot)))) {
      resolved.push(fromSourceRoot);
      continue;
    }

    const byName = sourceByBaseName.get(path.basename(normalizedSurface));
    if (byName && byName.length === 1) {
      resolved.push(byName[0]);
    }
  }

  const deduped = [...new Set(resolved)];
  return deduped.length > 0 ? deduped : sourceFiles;
};

const hasFile = async (filePath) => {
  try {
    const fileStat = await stat(filePath);
    return fileStat.isFile();
  } catch {
    return false;
  }
};

const readJsonIfExists = async (filePath) => {
  if (!(await hasFile(filePath))) {
    return undefined;
  }
  try {
    const raw = await readFile(filePath, "utf-8");
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
};

const signatureOf = (content) => {
  const normalized = content.replace(/\r/g, "").trim();
  return createHash("sha256").update(normalized).digest("hex");
};

const toCheckStatus = (count) => {
  return count > 0 ? "failed" : "passed";
};

const resolveBaselinePath = () => {
  const configured = process.env.FIGMAPIPE_UI_GATE_BASELINE_PATH?.trim();
  if (configured) {
    return configured;
  }
  return path.join(process.cwd(), ".figmapipe", "ui-gate-visual-baseline.json");
};

const shouldUpdateBaseline = () => {
  const raw = process.env.FIGMAPIPE_UI_GATE_UPDATE_BASELINE?.trim().toLowerCase();
  return raw === "1" || raw === "true";
};

const writeJson = async (targetPath, payload) => {
  await mkdir(path.dirname(targetPath), { recursive: true });
  await writeFile(targetPath, `${JSON.stringify(payload, null, 2)}\n`, "utf-8");
};

const reportPath = resolveReportPath();
const artifactDir = path.dirname(reportPath);
const sourceRoot = path.join(process.cwd(), "src");
const changedSurfaces = await readChangedSurfaces();
const sourceFiles = await collectSourceFiles(sourceRoot);
const selectedSourceFiles = filterSurfaceFiles({
  changedSurfaces,
  sourceFiles,
  sourceRoot
});
const selectedRelativePaths = selectedSourceFiles.map((filePath) => normalizePath(path.relative(process.cwd(), filePath)));

const baselinePath = resolveBaselinePath();
const baseline = await readJsonIfExists(baselinePath);
const baselineSignatures = baseline && typeof baseline === "object" && baseline.signatures && typeof baseline.signatures === "object"
  ? baseline.signatures
  : {};

const currentSignatures = {};
const visualDiffs = [];
const a11yFindings = [];
const interactionFindings = [];

for (const absolutePath of selectedSourceFiles) {
  const relativePath = normalizePath(path.relative(process.cwd(), absolutePath));
  const content = await readFile(absolutePath, "utf-8").catch(() => "");
  if (!content) {
    continue;
  }

  const signature = signatureOf(content);
  currentSignatures[relativePath] = signature;

  if (baselineSignatures[relativePath] && baselineSignatures[relativePath] !== signature) {
    visualDiffs.push({
      path: relativePath,
      before: baselineSignatures[relativePath],
      after: signature
    });
  }

  a11yFindings.push(...runA11yChecks(relativePath, content));
  interactionFindings.push(...runInteractionChecks(relativePath, content));
}

const updateBaseline = shouldUpdateBaseline();
const baselineExists = Object.keys(baselineSignatures).length > 0;
if (!baselineExists || updateBaseline) {
  await writeJson(baselinePath, {
    generatedAt: new Date().toISOString(),
    signatures: currentSignatures
  });
}

const visualDiffCount = baselineExists ? visualDiffs.length : 0;
const a11yViolationCount = a11yFindings.reduce((total, item) => total + item.occurrences, 0);
const interactionViolationCount = interactionFindings.reduce((total, item) => total + item.occurrences, 0);

const changedSurfacesArtifactPath = path.join(artifactDir, "changed-surfaces-resolved.json");
const visualArtifactPath = path.join(artifactDir, "ui-gate-visual-diffs.json");
const a11yArtifactPath = path.join(artifactDir, "ui-gate-a11y-findings.json");
const interactionArtifactPath = path.join(artifactDir, "ui-gate-interaction-findings.json");

await Promise.all([
  writeJson(changedSurfacesArtifactPath, {
    requestedSurfaces: changedSurfaces,
    evaluatedSourceFiles: selectedRelativePaths
  }),
  writeJson(visualArtifactPath, visualDiffs),
  writeJson(a11yArtifactPath, a11yFindings),
  writeJson(interactionArtifactPath, interactionFindings)
]);

const checks = [
  {
    name: "visual-baseline",
    status: !baselineExists ? "passed" : toCheckStatus(visualDiffCount),
    count: visualDiffCount,
    details: !baselineExists
      ? "Visual baseline created from current surfaces"
      : `Compared ${selectedRelativePaths.length} source surfaces against baseline`
  },
  {
    name: "a11y-static",
    status: toCheckStatus(a11yViolationCount),
    count: a11yViolationCount,
    details: `Static accessibility checks over ${selectedRelativePaths.length} source files`
  },
  {
    name: "interaction-static",
    status: toCheckStatus(interactionViolationCount),
    count: interactionViolationCount,
    details: `Keyboard and semantic interaction checks over ${selectedRelativePaths.length} source files`
  }
];

const report = {
  visualDiffCount,
  a11yViolationCount,
  interactionViolationCount,
  artifacts: [changedSurfacesArtifactPath, visualArtifactPath, a11yArtifactPath, interactionArtifactPath, baselinePath],
  summary: `UI gate evaluated ${selectedRelativePaths.length} source file(s): visual=${visualDiffCount}, a11y=${a11yViolationCount}, interaction=${interactionViolationCount}`,
  checks
};

await writeJson(reportPath, report);
process.exitCode = checks.some((check) => check.status === "failed") ? 1 : 0;
console.log(`validate:ui wrote report -> ${reportPath}`);
