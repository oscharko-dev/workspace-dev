#!/usr/bin/env tsx

/**
 * Faithfulness-Eval runner (Issue #1903).
 *
 * Builds the production-baseline faithfulness-eval artefact for every
 * baseline archetype fixture and writes the per-fixture report under
 * `storybook-static/eval-reports/faithfulness-<fixture>.json`. Exits
 * non-zero on any threshold violation so the release-quality-gate
 * orchestrator attributes the breakage to this gate with a clear log
 * link.
 *
 * Usage:
 *   tsx scripts/run-faithfulness-eval.ts [--output-dir <path>]
 *
 * The default output directory matches the documented Storybook
 * static-build location so operators reading the deployed Storybook can
 * inspect the latest production-baseline report alongside the rest of
 * the eval-reports bundle.
 */

import {
  FAITHFULNESS_EVAL_REPORT_DIRNAME,
  buildAllFaithfulnessEvalArtifacts,
  writeFaithfulnessEvalArtifact,
} from "../src/test-intelligence/faithfulness-eval.js";

const parseArgs = (argv: ReadonlyArray<string>): { outputDir: string } => {
  let outputDir = FAITHFULNESS_EVAL_REPORT_DIRNAME;
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
    }
  }
  return { outputDir };
};

const main = async (): Promise<void> => {
  const { outputDir } = parseArgs(process.argv.slice(2));
  const artifacts = await buildAllFaithfulnessEvalArtifacts({
    mode: "with-repair",
  });
  const failures: string[] = [];
  for (const artifact of artifacts) {
    const outputPath = await writeFaithfulnessEvalArtifact({
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
      `faithfulness-eval gate failed for ${failures.length} fixture(s):\n`,
    );
    for (const failure of failures) {
      process.stderr.write(`  - ${failure}\n`);
    }
    process.exit(1);
  }
  process.stdout.write(
    `faithfulness-eval gate passed for ${artifacts.length} fixture(s)\n`,
  );
};

main().catch((error) => {
  process.stderr.write(
    `faithfulness-eval runner crashed: ${error instanceof Error ? error.stack ?? error.message : String(error)}\n`,
  );
  process.exit(1);
});
