#!/usr/bin/env tsx

/**
 * DSPy-style prompt-optimization cycle runner (Issue #2044).
 *
 * Wires the offline `--optimize-prompts` mode into the local benchmark
 * runner: builds an eval set + accepted-run pool from the active dataset
 * baseline fixtures, runs a deterministic search cycle through
 * {@link runPromptOptimizationCycle}, persists
 * `prompt-optimization-report.json`, and *additively* appends the
 * optimized template entry to
 * `docs/test-intelligence-prompt-template-version.lock.json`.
 *
 * Standard runs do not invoke this script. Operators trigger it
 * explicitly via:
 *
 *   pnpm tsx scripts/run-prompt-optimization.ts [--seed <n>] \
 *     [--search-budget <n>] [--quality-gate <n>] \
 *     [--budget-multiplier <n>] [--max-few-shots <n>] \
 *     [--output-dir <path>] [--dry-run]
 *
 * The runner exits non-zero if the optimized template fails to clear the
 * issue's empirical-lift floor (>= 3 points). `--dry-run` skips the
 * lock-file mutation so CI matrices can pre-flight a configuration
 * change without producing a writable diff.
 */

import { readFile } from "node:fs/promises";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  PROMPT_OPTIMIZER_DEFAULT_BUDGET_MULTIPLIER,
  PROMPT_OPTIMIZER_DEFAULT_MAX_FEW_SHOTS,
  PROMPT_OPTIMIZER_DEFAULT_QUALITY_GATE,
  PROMPT_OPTIMIZER_DEFAULT_SEARCH_BUDGET,
  TEST_INTELLIGENCE_PROMPT_TEMPLATE_VERSION,
  type GeneratedTestCase,
  type PromptOptimizerAcceptedRun,
} from "../src/contracts/index.js";
import {
  appendOptimizedTemplateToLockFile,
  runPromptOptimizationCycle,
  writePromptOptimizationReportArtifact,
} from "../src/test-intelligence/prompt-optimizer.js";

const PACKAGE_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const LOCK_FILE_PATH = path.join(
  PACKAGE_ROOT,
  "docs/test-intelligence-prompt-template-version.lock.json",
);
const DEFAULT_OUTPUT_DIR = path.join(
  PACKAGE_ROOT,
  "storybook-static/eval-reports",
);
const DEFAULT_DATASET_ID = "active-dataset";
const DEFAULT_ROLE_STEP_ID = "test_generation";
const MIN_REQUIRED_LIFT = 3 as const;

interface CliArgs {
  readonly seed?: number;
  readonly searchBudget: number;
  readonly qualityGate: number;
  readonly budgetMultiplier: number;
  readonly maxFewShots: number;
  readonly outputDir: string;
  readonly dryRun: boolean;
  readonly fixturePath?: string;
}

const parseArgs = (argv: ReadonlyArray<string>): CliArgs => {
  let seed: number | undefined;
  let searchBudget = PROMPT_OPTIMIZER_DEFAULT_SEARCH_BUDGET;
  let qualityGate = PROMPT_OPTIMIZER_DEFAULT_QUALITY_GATE;
  let budgetMultiplier = PROMPT_OPTIMIZER_DEFAULT_BUDGET_MULTIPLIER;
  let maxFewShots = PROMPT_OPTIMIZER_DEFAULT_MAX_FEW_SHOTS;
  let outputDir = DEFAULT_OUTPUT_DIR;
  let dryRun = false;
  let fixturePath: string | undefined;

  const consume = (i: number, flag: string): { value: string; next: number } => {
    const value = argv[i + 1];
    if (value === undefined) {
      throw new Error(`${flag} requires an argument`);
    }
    return { value, next: i + 2 };
  };

  for (let i = 0; i < argv.length; ) {
    const arg = argv[i];
    if (arg === "--seed") {
      const { value, next } = consume(i, arg);
      seed = Number.parseInt(value, 10);
      i = next;
    } else if (arg === "--search-budget") {
      const { value, next } = consume(i, arg);
      searchBudget = Number.parseInt(value, 10);
      i = next;
    } else if (arg === "--quality-gate") {
      const { value, next } = consume(i, arg);
      qualityGate = Number.parseInt(value, 10);
      i = next;
    } else if (arg === "--budget-multiplier") {
      const { value, next } = consume(i, arg);
      budgetMultiplier = Number.parseFloat(value);
      i = next;
    } else if (arg === "--max-few-shots") {
      const { value, next } = consume(i, arg);
      maxFewShots = Number.parseInt(value, 10);
      i = next;
    } else if (arg === "--output-dir") {
      const { value, next } = consume(i, arg);
      outputDir = path.resolve(value);
      i = next;
    } else if (arg === "--fixture") {
      const { value, next } = consume(i, arg);
      fixturePath = path.resolve(value);
      i = next;
    } else if (arg === "--dry-run") {
      dryRun = true;
      i += 1;
    } else if (arg === undefined) {
      i += 1;
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }

  return {
    ...(seed !== undefined ? { seed } : {}),
    searchBudget,
    qualityGate,
    budgetMultiplier,
    maxFewShots,
    outputDir,
    dryRun,
    ...(fixturePath !== undefined ? { fixturePath } : {}),
  };
};

interface OptimizationFixture {
  readonly evalSet: readonly GeneratedTestCase[];
  readonly acceptedRuns: readonly PromptOptimizerAcceptedRun[];
}

const loadFixture = async (
  fixturePath: string | undefined,
): Promise<OptimizationFixture> => {
  if (fixturePath === undefined) {
    throw new Error(
      "scripts/run-prompt-optimization.ts: --fixture <path> is required.\n" +
        "Provide a JSON file with `{ evalSet: GeneratedTestCase[], acceptedRuns: PromptOptimizerAcceptedRun[] }`.\n" +
        "See docs/test-intelligence/prompt-optimization.md for the expected shape.",
    );
  }
  const raw = await readFile(fixturePath, "utf8");
  const parsed = JSON.parse(raw) as OptimizationFixture;
  if (!Array.isArray(parsed.evalSet) || !Array.isArray(parsed.acceptedRuns)) {
    throw new Error(
      `scripts/run-prompt-optimization.ts: fixture at ${fixturePath} must declare \`evalSet\` and \`acceptedRuns\` arrays.`,
    );
  }
  return parsed;
};

const main = async (): Promise<void> => {
  const args = parseArgs(process.argv.slice(2));
  const fixture = await loadFixture(args.fixturePath);
  const generatedAt = new Date().toISOString();
  const jobId = `prompt-opt-${generatedAt.replace(/[^0-9]/g, "")}`;

  const report = runPromptOptimizationCycle({
    jobId,
    datasetId: DEFAULT_DATASET_ID,
    roleStepId: DEFAULT_ROLE_STEP_ID,
    basePromptTemplateVersion: TEST_INTELLIGENCE_PROMPT_TEMPLATE_VERSION,
    generatedAt,
    evalSet: fixture.evalSet,
    acceptedRuns: fixture.acceptedRuns,
    ...(args.seed !== undefined ? { seed: args.seed } : {}),
    searchBudget: args.searchBudget,
    qualityGate: args.qualityGate,
    budgetMultiplier: args.budgetMultiplier,
    maxFewShots: args.maxFewShots,
  });

  await mkdir(args.outputDir, { recursive: true });
  const written = await writePromptOptimizationReportArtifact({
    artifactDir: args.outputDir,
    report,
  });

  process.stdout.write(
    `[prompt-optimizer] report=${path.relative(PACKAGE_ROOT, written.path)} ` +
      `baseline=${report.baselineScore} optimized=${report.optimizedScore} ` +
      `lift=${report.improvementPoints} budget=${report.tokenBudget.consumed}/${report.tokenBudget.cap}\n`,
  );

  if (!report.tokenBudget.withinCap) {
    process.stderr.write(
      `[prompt-optimizer] FAIL — token budget exceeded (${report.tokenBudget.consumed} > ${report.tokenBudget.cap}).\n`,
    );
    process.exit(2);
  }

  if (report.improvementPoints < MIN_REQUIRED_LIFT) {
    process.stderr.write(
      `[prompt-optimizer] FAIL — empirical lift ${report.improvementPoints} < ${MIN_REQUIRED_LIFT} required points.\n`,
    );
    process.exit(3);
  }

  if (args.dryRun) {
    process.stdout.write(
      "[prompt-optimizer] dry-run: skipping lock-file append.\n",
    );
    return;
  }

  const result = await appendOptimizedTemplateToLockFile({
    lockFilePath: LOCK_FILE_PATH,
    entry: report.lockEntry,
  });
  if (result.updated) {
    process.stdout.write(
      `[prompt-optimizer] appended ${report.lockEntry.optimizedTemplateId} ` +
        `to ${path.relative(PACKAGE_ROOT, LOCK_FILE_PATH)} (entries=${result.entries})\n`,
    );
  } else {
    process.stdout.write(
      `[prompt-optimizer] ${report.lockEntry.optimizedTemplateId} already present (idempotent no-op)\n`,
    );
  }

  // Belt-and-braces: the report's report-sha pin participates in the
  // lock entry, so a downstream check can confirm round-trip stability.
  void writeFile;
};

main().catch((error) => {
  process.stderr.write(
    `[prompt-optimizer] ${error instanceof Error ? error.stack ?? error.message : String(error)}\n`,
  );
  process.exit(1);
});
