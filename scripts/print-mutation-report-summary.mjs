import { readFile } from "node:fs/promises";
import path from "node:path";

const DEFAULT_REPORT_PATH = "artifacts/testing/mutation/mutation.json";
const TARGET_FILES = [
  "src/mode-lock.ts",
  "src/schemas.ts",
  "src/server/request-security.ts",
  "src/job-engine/pipeline/orchestrator.ts",
  "src/parity/ir.ts"
];

const toMetrics = (mutants) => {
  const count = (status) => mutants.filter((mutant) => mutant?.status === status).length;
  const killed = count("Killed");
  const timeout = count("Timeout");
  const survived = count("Survived");
  const noCoverage = count("NoCoverage");
  const runtimeErrors = count("RuntimeError");
  const compileErrors = count("CompileError");
  const ignored = count("Ignored");
  const pending = count("Pending");
  const totalDetected = killed + timeout;
  const totalUndetected = survived + noCoverage;
  const totalValid = totalDetected + totalUndetected;

  return {
    killed,
    timeout,
    survived,
    noCoverage,
    runtimeErrors,
    compileErrors,
    ignored,
    pending,
    totalDetected,
    totalUndetected,
    totalValid,
    totalMutants: totalValid + runtimeErrors + compileErrors + ignored + pending,
    mutationScore: totalValid > 0 ? (totalDetected / totalValid) * 100 : Number.NaN
  };
};

const formatScore = (value) => {
  if (Number.isNaN(value)) {
    return "n/a";
  }
  return `${value.toFixed(2)}%`;
};

const resolveBaselineStatus = ({ score, thresholds }) => {
  if (Number.isNaN(score)) {
    return "no-valid-mutants";
  }
  if (score >= thresholds.high) {
    return "meets-or-exceeds-baseline";
  }
  if (score >= thresholds.low) {
    return "within-warning-band";
  }
  return "below-baseline";
};

const main = async () => {
  const reportPath = process.argv[2] ?? DEFAULT_REPORT_PATH;
  const absolutePath = path.resolve(reportPath);
  const raw = await readFile(absolutePath, "utf8");
  const report = JSON.parse(raw);
  const thresholds = report.thresholds ?? { high: 0, low: 0, break: null };
  const fileEntries = Object.entries(report.files ?? {});
  const overallMetrics = toMetrics(
    fileEntries.flatMap(([, fileResult]) => Array.isArray(fileResult?.mutants) ? fileResult.mutants : [])
  );
  const baselineStatus = resolveBaselineStatus({
    score: overallMetrics.mutationScore,
    thresholds
  });

  console.log(`[mutation-summary] report=${absolutePath}`);
  console.log(
    `[mutation-summary] score=${formatScore(overallMetrics.mutationScore)} baseline=${formatScore(thresholds.high)} status=${baselineStatus}`
  );
  console.log(
    `[mutation-summary] killed=${overallMetrics.killed} timeout=${overallMetrics.timeout} survived=${overallMetrics.survived} no_coverage=${overallMetrics.noCoverage} errors=${overallMetrics.runtimeErrors + overallMetrics.compileErrors} ignored=${overallMetrics.ignored} pending=${overallMetrics.pending}`
  );

  for (const filePath of TARGET_FILES) {
    const fileResult = report.files?.[filePath];
    if (!fileResult || !Array.isArray(fileResult.mutants)) {
      console.log(`[mutation-summary][file] ${filePath} score=n/a mutants=0`);
      continue;
    }
    const fileMetrics = toMetrics(fileResult.mutants);
    console.log(
      `[mutation-summary][file] ${filePath} score=${formatScore(fileMetrics.mutationScore)} mutants=${fileMetrics.totalMutants} survived=${fileMetrics.survived} no_coverage=${fileMetrics.noCoverage} errors=${fileMetrics.runtimeErrors + fileMetrics.compileErrors}`
    );
  }
};

main().catch((error) => {
  console.error("[mutation-summary] Failed to summarize report:", error);
  process.exitCode = 1;
});
