#!/usr/bin/env tsx

/**
 * Release-readiness orchestrator (Issue #1803).
 *
 * Runs the canonical twelve harness gates as ordered subprocesses,
 * captures each gate's stdout+stderr to a per-gate log file under
 * `<runDir>/logs/`, and writes the consolidated canonical-JSON report
 * to `<evidenceDir>/release-readiness-report.json`.
 *
 * Acceptance contract (Issue #1803):
 * - Single command produces a complete release-readiness report.
 * - Report is canonical-JSON and committed to evidence.
 * - Failures are attributable to the offending gate with a clear log link.
 *
 * Behaviour:
 * - Gates run sequentially (the pipeline order encodes prerequisites:
 *   `typecheck` before `build`, etc.).
 * - The orchestrator does NOT short-circuit on the first failure: every
 *   gate runs so the report attributes each failure independently.
 * - `test_ti_live_e2e` is opt-in: when `WORKSPACE_TEST_SPACE_LIVE_E2E` is
 *   not set to `"1"`, the gate is recorded as `skipped` (not failed).
 * - The orchestrator's exit code is `0` iff every non-skipped gate
 *   passed — matching the report's top-level `passed` field.
 *
 * Usage:
 *   tsx scripts/run-release-readiness.ts \
 *     [--run-dir <path>] \
 *     [--evidence-dir <path>] \
 *     [--release-id <label>] \
 *     [--skip <gateId>[,<gateId>...]]
 *
 * Defaults:
 *   --run-dir       artifacts/release-readiness
 *   --evidence-dir  evidence/release-readiness
 *   --release-id    derived from package.json version + git short-sha
 *   --skip          (none; supports orchestrator dry-runs)
 */

import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  ALLOWED_RELEASE_READINESS_GATE_IDS,
  RELEASE_READINESS_ARTIFACT_DIRECTORY,
  RELEASE_READINESS_REPORT_ARTIFACT_FILENAME,
  type ReleaseReadinessGateId,
  type ReleaseReadinessGateResult,
  type ReleaseReadinessGateStatus,
} from "../src/contracts/index.js";
import {
  buildReleaseReadinessReport,
  RELEASE_READINESS_GATE_SPECS,
  writeReleaseReadinessReport,
  type ReleaseReadinessGateSpec,
} from "../src/test-intelligence/release-readiness-report.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

const RELEASE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;

const DEFAULT_RUN_DIR = path.resolve(repoRoot, "artifacts/release-readiness");
const DEFAULT_EVIDENCE_DIR = path.resolve(
  repoRoot,
  RELEASE_READINESS_ARTIFACT_DIRECTORY,
);

interface CliOptions {
  readonly runDir: string;
  readonly evidenceDir: string;
  readonly releaseIdOverride: string | null;
  readonly skip: ReadonlySet<ReleaseReadinessGateId>;
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

const isReleaseReadinessGateId = (
  value: string,
): value is ReleaseReadinessGateId =>
  (ALLOWED_RELEASE_READINESS_GATE_IDS as readonly string[]).includes(value);

const parseArgs = (argv: readonly string[]): CliOptions => {
  let runDir = DEFAULT_RUN_DIR;
  let evidenceDir = DEFAULT_EVIDENCE_DIR;
  let releaseIdOverride: string | null = null;
  const skip = new Set<ReleaseReadinessGateId>();
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (flag === "--run-dir") {
      if (typeof value !== "string" || value.length === 0) {
        throw new Error("--run-dir requires a path argument");
      }
      runDir = resolveWithinRepo("--run-dir", value);
      index += 1;
      continue;
    }
    if (flag === "--evidence-dir") {
      if (typeof value !== "string" || value.length === 0) {
        throw new Error("--evidence-dir requires a path argument");
      }
      evidenceDir = resolveWithinRepo("--evidence-dir", value);
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
      releaseIdOverride = value;
      index += 1;
      continue;
    }
    if (flag === "--skip") {
      if (typeof value !== "string" || value.length === 0) {
        throw new Error("--skip requires a comma-separated list of gateIds");
      }
      for (const id of value.split(",")) {
        const trimmed = id.trim();
        if (trimmed.length === 0) continue;
        if (!isReleaseReadinessGateId(trimmed)) {
          throw new Error(
            `--skip received unknown gateId ${trimmed}; allowed: ${ALLOWED_RELEASE_READINESS_GATE_IDS.join(",")}`,
          );
        }
        skip.add(trimmed);
      }
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${String(flag)}`);
  }
  return { runDir, evidenceDir, releaseIdOverride, skip };
};

const sanitizeReleaseIdSegment = (value: string): string => {
  // Replace whitespace with `-`, then strip any character outside the
  // RELEASE_ID_PATTERN class. The result is then validated.
  const collapsed = value.replace(/\s+/g, "-");
  return collapsed.replace(/[^A-Za-z0-9_.:-]/g, "");
};

const deriveReleaseId = async (override: string | null): Promise<string> => {
  if (override !== null) return override;
  let version = "0.0.0";
  try {
    const raw = await readFile(path.resolve(repoRoot, "package.json"), "utf8");
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed === "object" && parsed !== null) {
      const v = (parsed as { version?: unknown }).version;
      if (typeof v === "string" && v.length > 0) version = v;
    }
  } catch {
    // ignore — caller handles the fallback below.
  }
  const baseSeg = sanitizeReleaseIdSegment(`release-readiness-${version}`);
  const tsSeg = `${Math.floor(Date.now() / 1000)}`;
  const candidate = `${baseSeg}-${tsSeg}`;
  if (!RELEASE_ID_PATTERN.test(candidate)) {
    return `release-readiness-${tsSeg}`;
  }
  return candidate;
};

interface SubprocessOutcome {
  readonly status: ReleaseReadinessGateStatus;
  readonly exitCode: number | null;
  readonly durationMs: number;
}

const runGate = async (
  spec: ReleaseReadinessGateSpec,
  logPath: string,
): Promise<SubprocessOutcome> => {
  // We intentionally invoke pnpm via the user shell to get the same
  // resolution the developer sees: pnpm scripts inherit the repo's
  // node_modules/.bin and our package.json scripts. Each gate command is
  // a fixed string drawn from RELEASE_READINESS_GATE_SPECS, so there is
  // no shell-injection surface from user input here.
  const command = spec.command;
  const start = Date.now();
  return await new Promise<SubprocessOutcome>((resolve, reject) => {
    const child = spawn(command, {
      cwd: repoRoot,
      shell: true,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    const writePromise = (async () => {
      const chunks: Buffer[] = [];
      const collect = (chunk: Buffer | string): void => {
        chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
      };
      child.stdout?.on("data", collect);
      child.stderr?.on("data", collect);
      await new Promise<void>((res, rej) => {
        let pendingClose = 2;
        const maybeDone = (): void => {
          pendingClose -= 1;
          if (pendingClose <= 0) res();
        };
        child.stdout?.once("end", maybeDone);
        child.stderr?.once("end", maybeDone);
        child.once("error", rej);
      }).catch(() => {
        // close errors fall through to the close handler below.
      });
      const header = Buffer.from(
        `# release-readiness gate: ${spec.gateId}\n# command: ${spec.command}\n# started-at: ${new Date(start).toISOString()}\n\n`,
        "utf8",
      );
      await writeFile(logPath, Buffer.concat([header, ...chunks]));
    })();

    child.once("error", (err) => reject(err));
    child.once("close", (code) => {
      writePromise
        .then(() => {
          const durationMs = Date.now() - start;
          const exitCode = typeof code === "number" ? code : null;
          const status: ReleaseReadinessGateStatus =
            exitCode === 0 ? "passed" : "failed";
          resolve({ status, exitCode, durationMs });
        })
        .catch(reject);
    });
  });
};

const repoRelative = (absolutePath: string): string =>
  path.relative(repoRoot, absolutePath).split(path.sep).join("/");

const sanitizeForFilename = (gateId: ReleaseReadinessGateId): string =>
  gateId.replace(/[^A-Za-z0-9_-]/g, "_");

const main = async (): Promise<number> => {
  const options = parseArgs(process.argv.slice(2));
  await mkdir(options.runDir, { recursive: true });
  const logsDir = path.join(options.runDir, "logs");
  await mkdir(logsDir, { recursive: true });
  await mkdir(options.evidenceDir, { recursive: true });

  const releaseId = await deriveReleaseId(options.releaseIdOverride);
  const startedAt = new Date().toISOString();
  console.log(
    `[release-readiness] release-id=${releaseId} started-at=${startedAt}`,
  );

  const results: ReleaseReadinessGateResult[] = [];

  for (const spec of RELEASE_READINESS_GATE_SPECS) {
    const logBasename = `${sanitizeForFilename(spec.gateId)}.log`;
    const logPath = path.join(logsDir, logBasename);
    const relativeLogPath = repoRelative(logPath);

    if (options.skip.has(spec.gateId)) {
      console.log(
        `[release-readiness] ${spec.gateId} status=skipped (--skip)`,
      );
      const skipNote = `# release-readiness gate: ${spec.gateId}\n# status: skipped (--skip)\n`;
      await writeFile(logPath, skipNote, "utf8");
      results.push({
        gateId: spec.gateId,
        command: spec.command,
        status: "skipped",
        exitCode: null,
        durationMs: 0,
        logPath: null,
        attribution: ["skipped_by_flag"],
      });
      continue;
    }

    if (
      spec.livePolicy === "live_credentials_required" &&
      process.env["WORKSPACE_TEST_SPACE_LIVE_E2E"] !== "1"
    ) {
      console.log(
        `[release-readiness] ${spec.gateId} status=skipped (live credentials absent — set WORKSPACE_TEST_SPACE_LIVE_E2E=1 to enable)`,
      );
      const skipNote = `# release-readiness gate: ${spec.gateId}\n# status: skipped (live credentials absent)\n`;
      await writeFile(logPath, skipNote, "utf8");
      results.push({
        gateId: spec.gateId,
        command: spec.command,
        status: "skipped",
        exitCode: null,
        durationMs: 0,
        logPath: null,
        attribution: ["live_credentials_absent"],
      });
      continue;
    }

    console.log(
      `[release-readiness] ${spec.gateId} command=${spec.command} log=${relativeLogPath}`,
    );

    let outcome: SubprocessOutcome;
    try {
      outcome = await runGate(spec, logPath);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(
        `[release-readiness] ${spec.gateId} subprocess error: ${message}`,
      );
      outcome = {
        status: "failed",
        exitCode: -1,
        durationMs: 0,
      };
      const failNote = `# release-readiness gate: ${spec.gateId}\n# status: subprocess_spawn_error\n# message: ${message}\n`;
      await writeFile(logPath, failNote, "utf8");
    }

    const attribution: string[] =
      outcome.status === "failed"
        ? [`exit_code_${outcome.exitCode ?? "null"}`]
        : [];

    results.push({
      gateId: spec.gateId,
      command: spec.command,
      status: outcome.status,
      exitCode: outcome.exitCode,
      durationMs: outcome.durationMs,
      logPath: relativeLogPath,
      attribution,
    });

    console.log(
      `[release-readiness] ${spec.gateId} status=${outcome.status} exitCode=${outcome.exitCode} duration=${outcome.durationMs}ms`,
    );
  }

  const generatedAt = new Date().toISOString();
  const report = buildReleaseReadinessReport({
    releaseId,
    generatedAt,
    gates: results,
  });

  const written = await writeReleaseReadinessReport({
    report,
    runDir: options.evidenceDir,
  });

  // Mirror the report into the run-dir so CI consumers can attach both
  // the evidence-tree path and the per-run path without recomputing.
  const runDirReportPath = path.join(
    options.runDir,
    RELEASE_READINESS_REPORT_ARTIFACT_FILENAME,
  );
  await writeFile(runDirReportPath, written.serialized, "utf8");

  const failed = report.gates.filter((gate) => gate.status === "failed");
  console.log(
    `[release-readiness] report=${repoRelative(written.artifactPath)}`,
  );
  console.log(
    `[release-readiness] mirror=${repoRelative(runDirReportPath)}`,
  );
  console.log(
    `[release-readiness] passed=${report.passed} failed=${failed.length} of ${report.gates.length} gates`,
  );
  for (const gate of failed) {
    console.error(
      `[release-readiness] FAIL ${gate.gateId} command=${gate.command} log=${gate.logPath ?? "<no-log>"} attribution=[${gate.attribution.join(",")}]`,
    );
  }

  return report.passed ? 0 : 1;
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
      console.error(`[release-readiness] Failed: ${message}`);
      process.exit(1);
    });
}
