#!/usr/bin/env tsx

/**
 * Hallucination-Eval runner (Issue #1904).
 *
 * Builds the production-baseline hallucination-eval artefact for every
 * baseline archetype fixture and writes the per-fixture report under
 * `storybook-static/eval-reports/hallucination-<fixture>.json`. Exits
 * non-zero on any threshold violation so the release-quality-gate
 * orchestrator attributes the breakage to this gate with a clear log
 * link.
 *
 * Usage:
 *   tsx scripts/run-hallucination-eval.ts [--output-dir <path>]
 *                                          [--mode faithful|adversarial-prompt-injection]
 *
 * Default mode is `faithful`. The adversarial mode is intended for
 * targeted CI runs that want to assert prompt-injection robustness in
 * isolation; the faithful mode is the canonical pre-release gate.
 */

import {
  HALLUCINATION_EVAL_REPORT_DIRNAME,
  buildAllHallucinationEvalArtifacts,
  writeHallucinationEvalArtifact,
  type HallucinationEvalMode,
} from "../src/test-intelligence/hallucination-eval.js";

interface ParsedArgs {
  outputDir: string;
  mode: HallucinationEvalMode;
}

const isHallucinationEvalMode = (
  value: string,
): value is HallucinationEvalMode =>
  value === "faithful" || value === "adversarial-prompt-injection";

const parseArgs = (argv: ReadonlyArray<string>): ParsedArgs => {
  let outputDir: string = HALLUCINATION_EVAL_REPORT_DIRNAME;
  let mode: HallucinationEvalMode = "faithful";
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--output-dir") {
      const value = argv[i + 1];
      if (value === undefined) {
        throw new Error("--output-dir requires a path argument");
      }
      outputDir = value;
      i += 1;
    } else if (arg !== undefined && arg.startsWith("--output-dir=")) {
      outputDir = arg.slice("--output-dir=".length);
    } else if (arg === "--mode") {
      const value = argv[i + 1];
      if (value === undefined) {
        throw new Error("--mode requires a value argument");
      }
      if (!isHallucinationEvalMode(value)) {
        throw new Error(
          `--mode must be one of: faithful, adversarial-prompt-injection (got "${value}")`,
        );
      }
      mode = value;
      i += 1;
    } else if (arg !== undefined && arg.startsWith("--mode=")) {
      const value = arg.slice("--mode=".length);
      if (!isHallucinationEvalMode(value)) {
        throw new Error(
          `--mode must be one of: faithful, adversarial-prompt-injection (got "${value}")`,
        );
      }
      mode = value;
    }
  }
  return { outputDir, mode };
};

const main = async (): Promise<void> => {
  const { outputDir, mode } = parseArgs(process.argv.slice(2));
  const artifacts = await buildAllHallucinationEvalArtifacts({ mode });
  const failures: string[] = [];
  for (const artifact of artifacts) {
    const outputPath = await writeHallucinationEvalArtifact({
      artifact,
      outputDir,
    });
    process.stdout.write(`wrote ${outputPath}\n`);
    if (!artifact.verdict.passed) {
      const reasons = artifact.verdict.failures
        .map(
          (failure) =>
            `${failure.reason}(threshold=${failure.threshold},observed=${failure.observed})`,
        )
        .join(", ");
      failures.push(`${artifact.archetypeId}: ${reasons}`);
    }
  }
  if (failures.length > 0) {
    process.stderr.write(
      `hallucination-eval gate failed for ${failures.length} fixture(s):\n`,
    );
    for (const failure of failures) {
      process.stderr.write(`  - ${failure}\n`);
    }
    process.exit(1);
  }
  process.stdout.write(
    `hallucination-eval gate passed for ${artifacts.length} fixture(s) (mode=${mode})\n`,
  );
};

main().catch((err: unknown) => {
  process.stderr.write(
    `hallucination-eval runner crashed: ${err instanceof Error ? err.message : String(err)}\n`,
  );
  process.exit(1);
});
