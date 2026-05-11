/**
 * `workspace-dev test-intelligence figma-export` sub-command (Issue #2187).
 *
 * Runs **outside** the air-gap on a connected machine: downloads a Figma
 * file via the existing REST adapter and packages the response as a
 * canonical `figma-payload.json`. The packaged file is then carried
 * across the air-gap boundary and consumed by the air-gapped harness
 * via `workspace-dev test-intelligence run --figma-payload <path>`.
 *
 * The export deliberately reuses {@link fetchFigmaFileForTestIntelligence}
 * so the security guarantees (SSRF defence, token discipline, failure-
 * class disjointness) the standard runner enjoys also apply here. The
 * exported file is a `FigmaRestFileSnapshot` — the exact shape the
 * `--figma-payload` consumer validates — so the round-trip is byte-stable
 * and contract-checked at load time.
 *
 * Exit codes:
 *   0  success
 *   1  operator/config error (missing flag, bad value, missing token)
 *   2  Figma fetch error (`auth_failed`, `not_found`, `rate_limited`,
 *      `transport`, `timeout`, `parse_error`, `ssrf_refused`)
 */

import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, resolve, sep } from "node:path";
import { randomUUID } from "node:crypto";

import { sanitizeErrorMessage } from "./error-sanitization.js";
import {
  FigmaRestFetchError,
  fetchFigmaFileForTestIntelligence,
  parseFigmaUrl,
  type FigmaRestFileSnapshot,
} from "./test-intelligence/figma-rest-adapter.js";

/** Schema version baked into the packaged payload for forward compat. */
export const FIGMA_PAYLOAD_SCHEMA_VERSION = "1.0.0" as const;

/** Default basename when `--output` points at a directory. */
export const DEFAULT_FIGMA_PAYLOAD_FILENAME = "figma-payload.json" as const;

/**
 * Packaged sovereign-cloud / air-gap payload. The shape extends
 * {@link FigmaRestFileSnapshot} with a top-level `schemaVersion` and
 * `exportedAt` timestamp so the consumer can:
 *
 *  - reject payloads that pre-date a breaking shape change, and
 *  - audit when the connected-machine export ran (relative to the
 *    air-gapped harness run).
 *
 * Both extra fields are additive: the underlying `FigmaRestFileSnapshot`
 * still validates cleanly under the existing `--figma-json-file`
 * coercer, so the same payload can be consumed by either flag.
 */
export interface SovereignFigmaPayload extends FigmaRestFileSnapshot {
  /** Stable schema version. */
  readonly schemaVersion: typeof FIGMA_PAYLOAD_SCHEMA_VERSION;
  /** ISO-8601 timestamp of the export run. */
  readonly exportedAt: string;
}

export class TestIntelligenceFigmaExportOperatorError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TestIntelligenceFigmaExportOperatorError";
  }
}

export interface FigmaExportArgs {
  readonly figmaUrl: string;
  readonly outputPath: string;
  readonly figmaToken: string;
  readonly timeoutMs?: number;
  readonly nowUtcIso?: string;
}

const parseArgValue = (
  args: readonly string[],
  index: number,
  flag: string,
): string => {
  const value = args[index + 1]?.trim();
  if (!value || value.length === 0) {
    throw new TestIntelligenceFigmaExportOperatorError(
      `${flag} requires a non-empty value`,
    );
  }
  return value;
};

const parseTimeoutValue = (raw: string, flag: string): number => {
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new TestIntelligenceFigmaExportOperatorError(
      `${flag} must be a positive integer (milliseconds)`,
    );
  }
  return parsed;
};

/**
 * Parse CLI argv for the `figma-export` sub-command. Order of
 * precedence for the Figma access token: explicit `--figma-token` flag,
 * then the `FIGMA_ACCESS_TOKEN` env variable, then error out — exactly
 * the rules `test-intelligence run` enforces, so operators get one
 * mental model across both commands.
 */
export const parseFigmaExportArgs = (
  argv: readonly string[],
  env: NodeJS.ProcessEnv = process.env,
): FigmaExportArgs => {
  let figmaUrl: string | undefined;
  let outputPath: string | undefined;
  let figmaToken: string | undefined = env.FIGMA_ACCESS_TOKEN?.trim() || undefined;
  let timeoutMs: number | undefined;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--figma-url") {
      figmaUrl = parseArgValue(argv, index, "--figma-url");
      index += 1;
      continue;
    }
    if (arg === "--output") {
      outputPath = parseArgValue(argv, index, "--output");
      index += 1;
      continue;
    }
    if (arg === "--figma-token") {
      figmaToken = parseArgValue(argv, index, "--figma-token");
      index += 1;
      continue;
    }
    if (arg === "--timeout-ms") {
      timeoutMs = parseTimeoutValue(
        parseArgValue(argv, index, "--timeout-ms"),
        "--timeout-ms",
      );
      index += 1;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      throw new TestIntelligenceFigmaExportOperatorError("__HELP__");
    }
    throw new TestIntelligenceFigmaExportOperatorError(
      `Unknown flag for "test-intelligence figma-export": ${arg}`,
    );
  }
  if (figmaUrl === undefined) {
    throw new TestIntelligenceFigmaExportOperatorError(
      "--figma-url is required",
    );
  }
  if (outputPath === undefined) {
    throw new TestIntelligenceFigmaExportOperatorError(
      "--output is required (path to figma-payload.json or a directory)",
    );
  }
  if (figmaToken === undefined || figmaToken.length === 0) {
    throw new TestIntelligenceFigmaExportOperatorError(
      "--figma-token or FIGMA_ACCESS_TOKEN is required for Figma export",
    );
  }
  return {
    figmaUrl,
    outputPath,
    figmaToken,
    ...(timeoutMs !== undefined ? { timeoutMs } : {}),
  };
};

const resolveOutputPath = (outputPath: string): string => {
  const absolute = isAbsolute(outputPath) ? outputPath : resolve(outputPath);
  // If the operator passes an explicit `.json` filename, treat the
  // whole path as the destination. Otherwise treat as a directory and
  // append the canonical filename via `path.join` so the separator is
  // OS-correct (POSIX `/` vs. Windows `\`).
  if (basename(absolute).toLowerCase().endsWith(".json")) {
    return absolute;
  }
  // Strip a trailing separator (any platform) and join.
  const trimmed = absolute.endsWith(sep) ? absolute.slice(0, -1) : absolute;
  return join(trimmed, DEFAULT_FIGMA_PAYLOAD_FILENAME);
};

const buildPayload = (
  snapshot: FigmaRestFileSnapshot,
  exportedAt: string,
): SovereignFigmaPayload => ({
  schemaVersion: FIGMA_PAYLOAD_SCHEMA_VERSION,
  exportedAt,
  ...snapshot,
});

export interface FigmaExportResult {
  readonly path: string;
  readonly fileKey: string;
  readonly bytes: number;
  readonly exportedAt: string;
}

/**
 * Programmatic entry point for `figma-export`. Resolves the Figma URL to
 * a file key (+ optional node id), downloads the snapshot, packages
 * it under {@link FIGMA_PAYLOAD_SCHEMA_VERSION}, and writes the result
 * atomically via `<path>.<pid>.<uuid>.tmp` → rename so a crash mid-write
 * never leaves a partial payload on disk.
 *
 * Returns the absolute destination path and byte size for the CLI to
 * surface to the operator. The Figma access token is **not** part of
 * the result; it is forwarded once to the REST adapter and never
 * persisted.
 */
export const runFigmaExport = async (
  args: FigmaExportArgs,
): Promise<FigmaExportResult> => {
  const exportedAt = args.nowUtcIso ?? new Date().toISOString();
  const { fileKey, nodeId } = parseFigmaUrl(args.figmaUrl);
  const snapshot = await fetchFigmaFileForTestIntelligence({
    fileKey,
    accessToken: args.figmaToken,
    ...(nodeId !== undefined ? { nodeId } : {}),
    ...(args.timeoutMs !== undefined ? { timeoutMs: args.timeoutMs } : {}),
  });
  const payload = buildPayload(snapshot, exportedAt);
  const serialized = `${JSON.stringify(payload, null, 2)}\n`;
  const bytes = Buffer.byteLength(serialized, "utf8");
  const destination = resolveOutputPath(args.outputPath);
  await mkdir(dirname(destination), { recursive: true });
  const tmpPath = `${destination}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(tmpPath, serialized, "utf8");
  // `fs.rename` overwrites the destination on POSIX, but Windows `rename(2)`
  // rejects when the target already exists. Remove the prior payload first
  // so repeated `figma-export` runs in the same directory succeed across
  // platforms. `rm` with `force` is a no-op when the destination is absent
  // (first run) so this is safe in both cases.
  await rm(destination, { force: true });
  await rename(tmpPath, destination);
  return { path: destination, fileKey, bytes, exportedAt };
};

const HELP_TEXT = `\nworkspace-dev test-intelligence figma-export — sovereign-cloud Figma payload exporter (Issue #2187)

Usage:
  workspace-dev test-intelligence figma-export --figma-url <url> --output <path> [--figma-token <token>] [--timeout-ms <ms>]

Run this command on a **connected** machine (outside the air-gap). The
generated figma-payload.json is then carried across the air-gap boundary
and consumed by the air-gapped harness:

  workspace-dev test-intelligence run --figma-payload <path> ...

Arguments:
  --figma-url <url>     Figma file URL (deep-linkable; node-id supported)
  --output <path>       Destination file or directory. When a directory,
                        writes "${DEFAULT_FIGMA_PAYLOAD_FILENAME}" inside it.
  --figma-token <token> default: env FIGMA_ACCESS_TOKEN
  --timeout-ms <ms>     Per-request wall-clock timeout (default: 30000)
`;

/**
 * CLI entry. Parses argv (slice starting at the sub-command, e.g.
 * `["--figma-url", "...", "--output", "..."]`) and writes status to the
 * provided stdout/stderr writers. Returns the process exit code.
 */
export const runFigmaExportCli = async (
  argv: readonly string[],
  io: {
    stdout: (chunk: string) => void;
    stderr: (chunk: string) => void;
    env?: NodeJS.ProcessEnv;
  },
): Promise<number> => {
  let parsed: FigmaExportArgs;
  try {
    parsed = parseFigmaExportArgs(argv, io.env ?? process.env);
  } catch (err) {
    if (err instanceof TestIntelligenceFigmaExportOperatorError) {
      if (err.message === "__HELP__") {
        io.stdout(HELP_TEXT);
        return 0;
      }
      io.stderr(`error: ${err.message}\n`);
      io.stderr(HELP_TEXT);
      return 1;
    }
    io.stderr(
      `error: ${sanitizeErrorMessage({ error: err, fallback: "argument parse failed" })}\n`,
    );
    return 1;
  }
  try {
    const result = await runFigmaExport(parsed);
    io.stdout(
      `figma-export: wrote ${result.bytes} bytes for fileKey=${result.fileKey} ` +
        `to ${result.path} at ${result.exportedAt}\n`,
    );
    return 0;
  } catch (err) {
    const message =
      err instanceof FigmaRestFetchError
        ? `[${err.errorClass}] ${sanitizeErrorMessage({ error: err, fallback: err.message })}`
        : sanitizeErrorMessage({ error: err, fallback: "figma-export failed" });
    io.stderr(`figma-export failed: ${message}\n`);
    return 2;
  }
};
