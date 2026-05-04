#!/usr/bin/env tsx

/**
 * Emit the per-release library-coverage report
 * (Issue #1803, gate `release_library_coverage_report`).
 *
 * Loads the canonical baseline fixture committed under
 * `fixtures/release-readiness/library-coverage-baseline.json` (which mirrors
 * the per-release primitive-map snapshot the readiness pipeline expects),
 * builds the coverage report via {@link buildLibraryCoverageReport}, and
 * atomically writes it via {@link writeLibraryCoverageReport}.
 *
 * The artifact is byte-stable for byte-identical inputs (canonical-JSON
 * with sorted entries) so a release rebuild produces a binary-equal
 * report. Exits non-zero on any validation failure so the readiness
 * orchestrator attributes the breakage to this gate with a clear log link.
 *
 * Usage:
 *   tsx scripts/release-library-coverage-report.ts \
 *     [--input <path>] \
 *     [--run-dir <path>] \
 *     [--release-id <label>] \
 *     [--generated-at <iso8601>]
 *
 * Defaults:
 *   --input         fixtures/release-readiness/library-coverage-baseline.json
 *   --run-dir       artifacts/release-readiness
 *   --release-id    derived from package.json version
 *   --generated-at  current UTC time
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { writeLibraryCoverageReport } from "../src/test-intelligence/library-coverage-report.js";
import {
  ALLOWED_LIBRARY_PRIMITIVE_STATUSES,
  LIBRARY_COVERAGE_REPORT_ARTIFACT_FILENAME,
  type LibraryPrimitiveCoverageEntry,
  type LibraryPrimitiveStatus,
} from "../src/contracts/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

const RELEASE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;

const DEFAULT_INPUT_PATH = path.resolve(
  repoRoot,
  "fixtures/release-readiness/library-coverage-baseline.json",
);

const DEFAULT_RUN_DIR = path.resolve(
  repoRoot,
  "artifacts/release-readiness",
);

interface CliOptions {
  readonly inputPath: string;
  readonly runDir: string;
  readonly releaseId: string | null;
  readonly generatedAt: string;
}

const resolveWithinRepo = (flag: string, value: string): string => {
  const resolved = path.resolve(repoRoot, value);
  if (resolved !== repoRoot && !resolved.startsWith(`${repoRoot}${path.sep}`)) {
    throw new Error(
      `${flag}: path must resolve inside the repo root (${repoRoot}); got ${resolved}`,
    );
  }
  return resolved;
};

const parseArgs = (argv: readonly string[]): CliOptions => {
  let inputPath = DEFAULT_INPUT_PATH;
  let runDir = DEFAULT_RUN_DIR;
  let releaseId: string | null = null;
  let generatedAt = new Date().toISOString();
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (flag === "--input") {
      if (typeof value !== "string" || value.length === 0) {
        throw new Error("--input requires a path argument");
      }
      inputPath = resolveWithinRepo("--input", value);
      index += 1;
      continue;
    }
    if (flag === "--run-dir") {
      if (typeof value !== "string" || value.length === 0) {
        throw new Error("--run-dir requires a path argument");
      }
      runDir = resolveWithinRepo("--run-dir", value);
      index += 1;
      continue;
    }
    if (flag === "--release-id") {
      if (
        typeof value !== "string" ||
        value.length === 0 ||
        !RELEASE_ID_PATTERN.test(value)
      ) {
        throw new Error(
          `--release-id must match RELEASE_ID_PATTERN; got ${String(value)}`,
        );
      }
      releaseId = value;
      index += 1;
      continue;
    }
    if (flag === "--generated-at") {
      if (typeof value !== "string" || value.length === 0) {
        throw new Error("--generated-at requires an ISO-8601 argument");
      }
      generatedAt = value;
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${String(flag)}`);
  }
  return { inputPath, runDir, releaseId, generatedAt };
};

interface BaselineFixture {
  readonly releaseId?: string;
  readonly primitives: readonly LibraryPrimitiveCoverageEntry[];
}

const isLibraryPrimitiveStatus = (
  value: unknown,
): value is LibraryPrimitiveStatus =>
  typeof value === "string" &&
  (ALLOWED_LIBRARY_PRIMITIVE_STATUSES as readonly string[]).includes(value);

const isPrimitiveEntry = (
  value: unknown,
): value is LibraryPrimitiveCoverageEntry => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const v = value as Record<string, unknown>;
  if (typeof v["primitiveId"] !== "string" || v["primitiveId"].length === 0) {
    return false;
  }
  if (typeof v["libraryName"] !== "string" || v["libraryName"].length === 0) {
    return false;
  }
  if (
    typeof v["libraryVersion"] !== "string" ||
    v["libraryVersion"].length === 0
  ) {
    return false;
  }
  if (!isLibraryPrimitiveStatus(v["status"])) return false;
  if (!Number.isInteger(v["testCaseCount"]) || (v["testCaseCount"] as number) < 0) {
    return false;
  }
  if (v["notes"] !== undefined && typeof v["notes"] !== "string") return false;
  return true;
};

const parseBaseline = async (inputPath: string): Promise<BaselineFixture> => {
  const raw = await readFile(inputPath, "utf8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (cause) {
    throw new Error(
      `[release-library-coverage-report] could not parse JSON at ${inputPath}: ${(cause as Error).message}`,
    );
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(
      `[release-library-coverage-report] baseline at ${inputPath} must be a JSON object`,
    );
  }
  const obj = parsed as Record<string, unknown>;
  if (
    obj["releaseId"] !== undefined &&
    (typeof obj["releaseId"] !== "string" ||
      !RELEASE_ID_PATTERN.test(obj["releaseId"] as string))
  ) {
    throw new Error(
      `[release-library-coverage-report] baseline.releaseId must match RELEASE_ID_PATTERN`,
    );
  }
  if (!Array.isArray(obj["primitives"])) {
    throw new Error(
      `[release-library-coverage-report] baseline.primitives must be an array`,
    );
  }
  const primitives = (obj["primitives"] as readonly unknown[]).map(
    (entry, index) => {
      if (!isPrimitiveEntry(entry)) {
        throw new Error(
          `[release-library-coverage-report] baseline.primitives[${index}] failed structural validation`,
        );
      }
      return entry;
    },
  );
  return {
    releaseId: obj["releaseId"] as string | undefined,
    primitives,
  };
};

const readPackageVersion = async (): Promise<string> => {
  const raw = await readFile(path.resolve(repoRoot, "package.json"), "utf8");
  const parsed: unknown = JSON.parse(raw);
  if (typeof parsed !== "object" || parsed === null) return "0.0.0";
  const version = (parsed as { version?: unknown }).version;
  return typeof version === "string" ? version : "0.0.0";
};

const main = async (): Promise<number> => {
  const options = parseArgs(process.argv.slice(2));
  const baseline = await parseBaseline(options.inputPath);
  const version = await readPackageVersion();
  const releaseId =
    options.releaseId ?? baseline.releaseId ?? `release-readiness-${version}`;

  if (!RELEASE_ID_PATTERN.test(releaseId)) {
    throw new Error(
      `[release-library-coverage-report] releaseId ${releaseId} did not match RELEASE_ID_PATTERN`,
    );
  }

  const written = await writeLibraryCoverageReport({
    runDir: options.runDir,
    releaseId,
    generatedAt: options.generatedAt,
    primitives: baseline.primitives,
  });

  const relativePath = path.relative(repoRoot, written.artifactPath);
  const counts = written.artifact.counts;

  console.log(
    `[release-library-coverage-report] release-id=${releaseId} generated-at=${options.generatedAt}`,
  );
  console.log(
    `[release-library-coverage-report] artifact=${LIBRARY_COVERAGE_REPORT_ARTIFACT_FILENAME}`,
  );
  console.log(`[release-library-coverage-report] path=${relativePath}`);
  console.log(
    `[release-library-coverage-report] counts: total=${counts.total} implemented=${counts.implemented} stub=${counts.stub} unimplemented=${counts.unimplemented} deprecated=${counts.deprecated}`,
  );
  return 0;
};

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main()
    .then((code) => {
      process.exit(code);
    })
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[release-library-coverage-report] Failed: ${message}`);
      process.exit(1);
    });
}
