#!/usr/bin/env node

/**
 * Canonical, sorted list of test-intelligence eval files.
 *
 * The list is sorted so shard assignment is reproducible: a file's shard
 * index is `sortedIndex % total`, which means appending a new file at the
 * end of the alphabet only shifts assignment for that suffix range, not
 * the whole list. This keeps shard caches and timing baselines stable.
 *
 * If you add a new test file under `src/test-intelligence/`, add it here
 * AND in `package.json#scripts['test:ti-eval']` (kept in sync intentionally
 * — `test:ti-eval` lists files explicitly so its CLI is searchable).
 */

import { spawn } from "node:child_process";

export const TI_EVAL_FILES = Object.freeze([
  "src/test-intelligence/adversarial-2025.test.ts",
  "src/test-intelligence/adversarial-fixtures.test.ts",
  "src/test-intelligence/agent-iterations.test.ts",
  "src/test-intelligence/eval-ab.test.ts",
  "src/test-intelligence/baseline-eval.test.ts",
  "src/test-intelligence/baseline-fixtures.test.ts",
  "src/test-intelligence/cache-break-events-log.test.ts",
  "src/test-intelligence/compact-boundary-log.test.ts",
  "src/test-intelligence/custom-context-boundaries.test.ts",
  "src/test-intelligence/custom-context-markdown-canonicalization.test.ts",
  "src/test-intelligence/custom-context-markdown-pii-redaction.test.ts",
  "src/test-intelligence/custom-context-markdown-prompt-injection.test.ts",
  "src/test-intelligence/custom-context-markdown-resource-exhaustion.test.ts",
  "src/test-intelligence/custom-context-markdown-xss.test.ts",
  "src/test-intelligence/custom-context-markdown.test.ts",
  "src/test-intelligence/custom-context-store.test.ts",
  "src/test-intelligence/dry-run-report.test.ts",
  "src/test-intelligence/evidence-attestation.airgapped.test.ts",
  "src/test-intelligence/evidence-attestation.concurrency.test.ts",
  "src/test-intelligence/evidence-attestation.fuzz.test.ts",
  "src/test-intelligence/evidence-attestation.keyless.test.ts",
  "src/test-intelligence/evidence-attestation.signing.test.ts",
  "src/test-intelligence/evidence-attestation.tampering.test.ts",
  "src/test-intelligence/evidence-attestation.test.ts",
  "src/test-intelligence/evidence-manifest.test.ts",
  "src/test-intelligence/evidence-tampering.test.ts",
  "src/test-intelligence/evidence-unexpected-artifact.test.ts",
  "src/test-intelligence/export-pipeline.golden.test.ts",
  "src/test-intelligence/export-pipeline.test.ts",
  "src/test-intelligence/finops-budget.test.ts",
  "src/test-intelligence/finops-report.test.ts",
  "src/test-intelligence/golden.test.ts",
  "src/test-intelligence/harness-artifact-manifest.test.ts",
  "src/test-intelligence/human-review-calibration.test.ts",
  "src/test-intelligence/intent-delta.property.test.ts",
  "src/test-intelligence/intent-delta.test.ts",
  "src/test-intelligence/jira-field-overcollection.test.ts",
  "src/test-intelligence/jira-gateway-client.test.ts",
  "src/test-intelligence/jira-jql-injection.test.ts",
  "src/test-intelligence/jira-only-no-figma-side-effects.test.ts",
  "src/test-intelligence/jira-paste-html-xss.test.ts",
  "src/test-intelligence/jira-paste-ingest.test.ts",
  "src/test-intelligence/jira-paste-required-fields.test.ts",
  "src/test-intelligence/jira-rate-limit-and-quota.test.ts",
  "src/test-intelligence/jira-ssrf-and-host-allowlist.test.ts",
  "src/test-intelligence/jira-token-leakage.test.ts",
  "src/test-intelligence/lbom-cyclonedx-schema.test.ts",
  "src/test-intelligence/lbom-emitter.test.ts",
  "src/test-intelligence/library-coverage-report.test.ts",
  "src/test-intelligence/ml-bom.test.ts",
  "src/test-intelligence/llm-gateway-bundle.test.ts",
  "src/test-intelligence/llm-gateway.test.ts",
  "src/test-intelligence/llm-mock-gateway.test.ts",
  "src/test-intelligence/multi-source-conflict-bypass.test.ts",
  "src/test-intelligence/multi-source-envelope.property.test.ts",
  "src/test-intelligence/multi-source-envelope.test.ts",
  "src/test-intelligence/multi-source-evidence-tampering.test.ts",
  "src/test-intelligence/multi-source-link-expansion-bomb.test.ts",
  "src/test-intelligence/multi-source-paste-collision.test.ts",
  "src/test-intelligence/multi-source-pii-leakage.test.ts",
  "src/test-intelligence/multi-source-prompt-injection.test.ts",
  "src/test-intelligence/multi-source-reconciliation.test.ts",
  "src/test-intelligence/multi-source-source-spoofing.test.ts",
  "src/test-intelligence/validation-eval.test.ts",
  "src/test-intelligence/validation-fixtures.test.ts",
  "src/test-intelligence/validation-harness.self-verify.test.ts",
  "src/test-intelligence/validation-harness.test.ts",
  "src/test-intelligence/validation-harness.visual-captures.test.ts",
  "src/test-intelligence/policy-bypass.test.ts",
  "src/test-intelligence/qc-adapter.test.ts",
  "src/test-intelligence/qc-alm-api-transfer.test.ts",
  "src/test-intelligence/qc-alm-dry-run.golden.test.ts",
  "src/test-intelligence/qc-alm-dry-run.test.ts",
  "src/test-intelligence/qc-alm-mapping-profile.test.ts",
  "src/test-intelligence/qc-xlsx-writer.test.ts",
  "src/test-intelligence/reconciliation.test.ts",
  "src/test-intelligence/resource-budget.test.ts",
  "src/test-intelligence/secret-leakage.test.ts",
  "src/test-intelligence/self-verify-rubric.fuzz.test.ts",
  "src/test-intelligence/spreadsheet-formula-guard.test.ts",
  "src/test-intelligence/self-verify-rubric.test.ts",
  "src/test-intelligence/test-case-dedupe.property.test.ts",
  "src/test-intelligence/test-case-dedupe.test.ts",
  "src/test-intelligence/test-case-delta.property.test.ts",
  "src/test-intelligence/test-case-delta.test.ts",
  "src/test-intelligence/traceability-matrix.property.test.ts",
  "src/test-intelligence/traceability-matrix.test.ts",
  "src/test-intelligence/traceability-pipeline.test.ts",
  "src/test-intelligence/untrusted-content-normalizer.property.test.ts",
  "src/test-intelligence/untrusted-content-normalizer.test.ts",
  "src/test-intelligence/validation-pipeline.golden.test.ts",
  "src/test-intelligence/validation-pipeline.self-verify.test.ts",
  "src/test-intelligence/visual-sidecar-adversarial.test.ts",
  "src/test-intelligence/visual-sidecar-client.test.ts",
  "src/test-intelligence/visual-sidecar-validation.test.ts",
  "src/test-intelligence/wave4-adversarial-edge-coverage.test.ts",
]);

const isInteger = (value) =>
  typeof value === "number" && Number.isInteger(value);

export const shardFiles = (shard, total, files = TI_EVAL_FILES) => {
  if (!isInteger(total) || total < 1) {
    throw new Error(
      `[ti-eval-files] TOTAL must be a positive integer, got: ${total}`,
    );
  }
  if (!isInteger(shard) || shard < 0 || shard >= total) {
    throw new Error(
      `[ti-eval-files] SHARD must be in [0, ${total}), got: ${shard}`,
    );
  }
  if (!Array.isArray(files) || files.length === 0) {
    throw new Error("[ti-eval-files] file list must be a non-empty array");
  }
  const slice = [];
  for (let i = 0; i < files.length; i += 1) {
    if (i % total === shard) {
      slice.push(files[i]);
    }
  }
  return slice;
};

const parseEnvInteger = (name, value) => {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`[ti-eval-files] env ${name} is required`);
  }
  const trimmed = value.trim();
  if (!/^-?\d+$/.test(trimmed)) {
    throw new Error(
      `[ti-eval-files] env ${name} must be an integer, got: ${value}`,
    );
  }
  return Number.parseInt(trimmed, 10);
};

const runShardCommand = ({
  env = process.env,
  spawnFn = spawn,
  stdout = process.stdout,
  stderr = process.stderr,
} = {}) =>
  new Promise((resolve, reject) => {
    const shard = parseEnvInteger("SHARD", env.SHARD);
    const total = parseEnvInteger("TOTAL", env.TOTAL);
    const slice = shardFiles(shard, total);
    if (slice.length === 0) {
      stdout.write(
        `[ti-eval-files] shard ${shard}/${total} has no files; skipping.\n`,
      );
      resolve(0);
      return;
    }
    stdout.write(
      `[ti-eval-files] shard ${shard}/${total}: running ${slice.length} file(s)\n`,
    );
    const child = spawnFn("pnpm", ["exec", "tsx", "--test", ...slice], {
      stdio: "inherit",
      env,
    });
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (signal !== null && signal !== undefined) {
        stderr.write(`[ti-eval-files] terminated by signal ${signal}\n`);
        resolve(1);
        return;
      }
      resolve(code ?? 0);
    });
  });

import { fileURLToPath } from "node:url";
import path from "node:path";

const isCliEntry = () => {
  const entryPath = process.argv[1];
  return (
    typeof entryPath === "string" &&
    path.resolve(entryPath) === fileURLToPath(import.meta.url)
  );
};

if (isCliEntry()) {
  const exitCode = await runShardCommand();
  process.exit(exitCode);
}
