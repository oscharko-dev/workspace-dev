#!/usr/bin/env tsx

/**
 * Form-screen A11y-Coverage-Eval runner (Issue #1905).
 *
 * Builds the production-baseline a11y-coverage-eval artefact for every
 * baseline archetype fixture plus the two Wave 1 validation fixtures
 * (`validation-onboarding`, `validation-payment-auth`) and writes the
 * per-fixture report under
 * `storybook-static/eval-reports/a11y-<fixture>.json`. Exits non-zero on
 * any hard-gate violation so the release-quality-gate orchestrator
 * attributes the breakage to this gate with a clear log link.
 *
 * Usage:
 *   tsx scripts/run-a11y-coverage-eval.ts [--output-dir <path>]
 *
 * The default output directory matches the documented Storybook
 * static-build location so operators reading the deployed Storybook can
 * inspect the latest a11y-coverage report alongside the rest of the
 * eval-reports bundle.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  A11Y_COVERAGE_EVAL_REPORT_DIRNAME,
  buildA11yCoverageEvalArtifactForValidationFixture,
  buildAllBaselineA11yCoverageEvalArtifacts,
  writeA11yCoverageEvalArtifact,
  type A11yCoverageEvalArtifact,
} from "../src/test-intelligence/a11y-coverage-eval.js";
import { WAVE1_VALIDATION_FIXTURE_IDS } from "../src/contracts/index.js";
import type { IntentDerivationFigmaInput } from "../src/test-intelligence/intent-derivation.js";

const FIXTURES_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "src",
  "test-intelligence",
  "fixtures",
);

const parseArgs = (argv: ReadonlyArray<string>): { outputDir: string } => {
  let outputDir = A11Y_COVERAGE_EVAL_REPORT_DIRNAME;
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

const formatSourceId = (artifact: A11yCoverageEvalArtifact): string =>
  artifact.source.kind === "baseline-archetype"
    ? artifact.source.id
    : `validation-fixture:${artifact.source.id}`;

const main = async (): Promise<void> => {
  const { outputDir } = parseArgs(process.argv.slice(2));
  const baselineArtifacts = await buildAllBaselineA11yCoverageEvalArtifacts();
  const validationArtifacts: A11yCoverageEvalArtifact[] = [];
  for (const fixtureId of WAVE1_VALIDATION_FIXTURE_IDS) {
    const figmaPath = path.join(FIXTURES_DIR, `${fixtureId}.figma.json`);
    const raw = await readFile(figmaPath, "utf8");
    const figma = JSON.parse(raw) as IntentDerivationFigmaInput;
    validationArtifacts.push(
      buildA11yCoverageEvalArtifactForValidationFixture({
        fixtureId,
        figma,
      }),
    );
  }
  const artifacts: A11yCoverageEvalArtifact[] = [
    ...baselineArtifacts,
    ...validationArtifacts,
  ];

  const failures: string[] = [];
  for (const artifact of artifacts) {
    const outputPath = await writeA11yCoverageEvalArtifact({
      artifact,
      outputDir,
    });
    process.stdout.write(`wrote ${outputPath}\n`);
    if (!artifact.verdict.passed) {
      const reasons = artifact.verdict.failures
        .filter((failure) => failure.severity === "error")
        .map(
          (failure) =>
            `${failure.reason}(screen=${failure.screenId},threshold=${failure.threshold},observed=${failure.observed})`,
        )
        .join(", ");
      failures.push(`${formatSourceId(artifact)}: ${reasons}`);
    }
  }
  if (failures.length > 0) {
    process.stderr.write(
      `a11y-coverage-eval gate failed for ${failures.length} fixture(s):\n`,
    );
    for (const failure of failures) {
      process.stderr.write(`  - ${failure}\n`);
    }
    process.exit(1);
  }
  process.stdout.write(
    `a11y-coverage-eval gate passed for ${artifacts.length} fixture(s)\n`,
  );
};

main().catch((error) => {
  process.stderr.write(
    `a11y-coverage-eval runner crashed: ${error instanceof Error ? error.stack ?? error.message : String(error)}\n`,
  );
  process.exit(1);
});
