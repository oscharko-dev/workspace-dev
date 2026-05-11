/**
 * `workspace-dev test-intelligence tms-push` sub-command (Issue #2183).
 *
 * Wires the production-grade TMS adapters family to the package CLI:
 *
 *   pnpm exec tsx src/cli.ts test-intelligence tms-push \
 *     --run-dir <path>           # directory containing qc-mapping-preview.json
 *     --tms <xray|alm|qtest|polarion>
 *     --project <id>             # TMS-specific project id
 *     [--endpoint <alias>]       # symbolic endpoint alias
 *     [--tenant <id>]            # tenant id used in idempotency keys
 *     [--run-id <id>]            # run id stamped on idempotency keys + report
 *     [--batch-size <n>]         # default 50
 *     [--dry-run]                # no state-mutating TMS calls
 *
 * Per-tenant credentials are loaded from the env via
 * `loadTmsCredentialsFromEnv` (`WORKSPACE_TEST_SPACE_TMS_<NAME>_TOKEN`,
 * `*_OAUTH_ACCESS_TOKEN`, or `*_BEARER`). The CLI NEVER prints the
 * resolved token and NEVER persists it.
 *
 * Exit codes:
 *   0  — push completed (every entry got a verdict; report written).
 *        Note: a fully-failed run still exits 0, so an operator can
 *        rely on the persisted report. Refusal-only runs exit 2.
 *   1  — operator/config error (missing flag, unknown adapter, bad
 *        run-dir, missing credentials).
 *   2  — pipeline refused (no mapping preview, project not found, all
 *        cases failed).
 */

import { basename } from "node:path";

import {
  ALLOWED_TMS_ADAPTER_IDS,
  type TmsAdapterId,
} from "./contracts/index.js";
import { sanitizeErrorMessage } from "./error-sanitization.js";
import {
  createAlmAdapter,
  createPolarionAdapter,
  createQtestAdapter,
  createXrayAdapter,
  loadTmsCredentialsFromEnv,
  runTmsPushPipeline,
  type RunTmsPushPipelineResult,
  type TmsAdapter,
  type TmsAdapterClock,
  type TmsCredentials,
  type TmsHttpClient,
} from "./test-intelligence/tms-adapters/index.js";
import { createDefaultTmsHttpClient } from "./test-intelligence/tms-adapters/default-http-client.js";

const ALLOWED_ADAPTER_SET = new Set<TmsAdapterId>(ALLOWED_TMS_ADAPTER_IDS);

/** Operator-facing error class for the tms-push CLI parser/handler. */
export class TestIntelligenceTmsPushOperatorError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TestIntelligenceTmsPushOperatorError";
  }
}

/** Parsed flags for `test-intelligence tms-push`. */
export interface TestIntelligenceTmsPushOptions {
  runDir: string;
  tms: TmsAdapterId;
  projectId: string;
  endpointAlias: string;
  tenantId: string;
  runId: string;
  batchSize: number;
  dryRun: boolean;
}

const DEFAULT_BATCH_SIZE = 50;
const DEFAULT_TENANT_ID = "default";

/**
 * Parse the kebab-case flag form documented above. The parser refuses
 * unknown flags so a typo never silently downgrades to a default.
 */
export const parseTestIntelligenceTmsPushArgs = (
  argv: readonly string[],
): TestIntelligenceTmsPushOptions => {
  let runDir: string | undefined;
  let tms: string | undefined;
  let projectId: string | undefined;
  let endpointAlias: string | undefined;
  let tenantId: string | undefined;
  let runId: string | undefined;
  let batchSize: number | undefined;
  let dryRun = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1]?.trim();
    if (arg === "--run-dir") {
      if (next === undefined || next.length === 0) {
        throw new TestIntelligenceTmsPushOperatorError(
          "--run-dir requires a non-empty path",
        );
      }
      runDir = next;
      i += 1;
      continue;
    }
    if (arg === "--tms") {
      if (next === undefined || next.length === 0) {
        throw new TestIntelligenceTmsPushOperatorError(
          "--tms requires one of xray|alm|qtest|polarion",
        );
      }
      tms = next;
      i += 1;
      continue;
    }
    if (arg === "--project") {
      if (next === undefined || next.length === 0) {
        throw new TestIntelligenceTmsPushOperatorError(
          "--project requires a non-empty TMS project id",
        );
      }
      projectId = next;
      i += 1;
      continue;
    }
    if (arg === "--endpoint") {
      if (next === undefined || next.length === 0) {
        throw new TestIntelligenceTmsPushOperatorError(
          "--endpoint requires a non-empty endpoint alias",
        );
      }
      endpointAlias = next;
      i += 1;
      continue;
    }
    if (arg === "--tenant") {
      if (next === undefined || next.length === 0) {
        throw new TestIntelligenceTmsPushOperatorError(
          "--tenant requires a non-empty tenant id",
        );
      }
      tenantId = next;
      i += 1;
      continue;
    }
    if (arg === "--run-id") {
      if (next === undefined || next.length === 0) {
        throw new TestIntelligenceTmsPushOperatorError(
          "--run-id requires a non-empty run id",
        );
      }
      runId = next;
      i += 1;
      continue;
    }
    if (arg === "--batch-size") {
      if (next === undefined || next.length === 0) {
        throw new TestIntelligenceTmsPushOperatorError(
          "--batch-size requires a positive integer",
        );
      }
      const parsed = Number.parseInt(next, 10);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        throw new TestIntelligenceTmsPushOperatorError(
          `--batch-size must be a positive integer, received ${next}`,
        );
      }
      batchSize = parsed;
      i += 1;
      continue;
    }
    if (arg === "--dry-run") {
      dryRun = true;
      continue;
    }
    throw new TestIntelligenceTmsPushOperatorError(
      `Unknown flag for "test-intelligence tms-push": ${arg}`,
    );
  }

  if (!runDir) {
    throw new TestIntelligenceTmsPushOperatorError(
      "usage: workspace-dev test-intelligence tms-push --run-dir <path> --tms <xray|alm|qtest|polarion> --project <id> [--endpoint <alias>] [--tenant <id>] [--run-id <id>] [--batch-size <n>] [--dry-run]",
    );
  }
  if (!tms) {
    throw new TestIntelligenceTmsPushOperatorError(
      "--tms is required (xray|alm|qtest|polarion)",
    );
  }
  if (!ALLOWED_ADAPTER_SET.has(tms as TmsAdapterId)) {
    throw new TestIntelligenceTmsPushOperatorError(
      `--tms must be one of ${ALLOWED_TMS_ADAPTER_IDS.join("|")}, received ${tms}`,
    );
  }
  if (!projectId) {
    throw new TestIntelligenceTmsPushOperatorError(
      "--project is required (TMS-specific project id)",
    );
  }

  return {
    runDir,
    tms: tms as TmsAdapterId,
    projectId,
    endpointAlias: endpointAlias ?? `${tms}-default`,
    tenantId: tenantId ?? DEFAULT_TENANT_ID,
    runId: runId ?? deriveRunIdFromPath(runDir),
    batchSize: batchSize ?? DEFAULT_BATCH_SIZE,
    dryRun,
  };
};

const deriveRunIdFromPath = (runDir: string): string => {
  const base = basename(runDir).trim();
  return base.length > 0 ? base : "run";
};

/** Sink used by the handler — mirrors the other test-intelligence CLI subcommands. */
export interface TestIntelligenceTmsPushSink {
  stdout(message: string): void;
  stderr(message: string): void;
}

/** Inputs for `runTestIntelligenceTmsPushCommand`. */
export interface RunTestIntelligenceTmsPushCommandInput {
  options: TestIntelligenceTmsPushOptions;
  sink: TestIntelligenceTmsPushSink;
  /** Optional env override (tests pin a deterministic env). */
  env?: NodeJS.ProcessEnv;
  /** Optional clock override (tests pin a deterministic timestamp). */
  clock?: TmsAdapterClock;
  /** Optional adapter factory override (tests inject a fake). */
  adapterFactory?: (input: {
    adapterId: TmsAdapterId;
    http: TmsHttpClient;
  }) => TmsAdapter;
  /** Optional HTTP client override (tests inject a fake). */
  httpFactory?: (adapterId: TmsAdapterId) => TmsHttpClient;
}

/** Default real-clock implementation. */
const defaultClock: TmsAdapterClock = {
  now(): string {
    return new Date().toISOString();
  },
};

const defaultAdapterFactory = (input: {
  adapterId: TmsAdapterId;
  http: TmsHttpClient;
}): TmsAdapter => {
  switch (input.adapterId) {
    case "xray":
      return createXrayAdapter({ http: input.http });
    case "alm":
      return createAlmAdapter({ http: input.http });
    case "qtest":
      return createQtestAdapter({ http: input.http });
    case "polarion":
      return createPolarionAdapter({ http: input.http });
    default: {
      const exhaustive: never = input.adapterId;
      throw new TestIntelligenceTmsPushOperatorError(
        `unsupported adapter id: ${exhaustive as string}`,
      );
    }
  }
};

/**
 * Drive the tms-push command end-to-end. Returns the process exit
 * code per the contract documented at the top of the file.
 */
export const runTestIntelligenceTmsPushCommand = async (
  input: RunTestIntelligenceTmsPushCommandInput,
): Promise<number> => {
  const env = input.env ?? process.env;
  const clock = input.clock ?? defaultClock;
  const adapterFactory = input.adapterFactory ?? defaultAdapterFactory;
  const httpFactory =
    input.httpFactory ??
    ((adapterId: TmsAdapterId) =>
      createDefaultTmsHttpClient({ adapterId, env }));

  const credentialsResult = loadTmsCredentialsFromEnv({
    adapterId: input.options.tms,
    env,
  });
  if (!credentialsResult.ok) {
    input.sink.stderr(
      `error: ${sanitizeErrorMessage({
        error: new Error(credentialsResult.message),
        fallback: "credentials missing",
      })}\n`,
    );
    return 1;
  }
  const credentials: TmsCredentials = credentialsResult.credentials;

  let http: TmsHttpClient;
  try {
    http = httpFactory(input.options.tms);
  } catch (err) {
    input.sink.stderr(
      `error: failed to construct TMS HTTP client: ${sanitizeErrorMessage({
        error: err,
        fallback: "http client construction failed",
      })}\n`,
    );
    return 1;
  }

  let adapter: TmsAdapter;
  try {
    adapter = adapterFactory({
      adapterId: input.options.tms,
      http,
    });
  } catch (err) {
    input.sink.stderr(
      `error: failed to construct adapter: ${sanitizeErrorMessage({
        error: err,
        fallback: "adapter construction failed",
      })}\n`,
    );
    return 1;
  }

  let result: RunTmsPushPipelineResult;
  try {
    result = await runTmsPushPipeline({
      adapter,
      endpointAlias: input.options.endpointAlias,
      projectId: input.options.projectId,
      tenantId: input.options.tenantId,
      runDir: input.options.runDir,
      runId: input.options.runId,
      credentials,
      clock,
      dryRun: input.options.dryRun,
      batchSize: input.options.batchSize,
    });
  } catch (err) {
    input.sink.stderr(
      `error: TMS push pipeline failed: ${sanitizeErrorMessage({
        error: err,
        fallback: "tms push pipeline failed",
      })}\n`,
    );
    return 2;
  }

  const summary =
    `TMS push complete (${input.options.tms}): ` +
    `pushed=${result.report.pushedCount} ` +
    `skipped-dup=${result.report.skippedDuplicateCount} ` +
    `failed=${result.report.failedCount} ` +
    `report=${result.reportPath}\n`;
  input.sink.stdout(summary);

  if (result.report.refused) {
    input.sink.stderr(
      `error: pipeline refused with codes: ${result.report.refusalCodes.join(
        ",",
      )}\n`,
    );
    return 2;
  }
  return 0;
};

/** Help text for `test-intelligence tms-push`. */
export const TEST_INTELLIGENCE_TMS_PUSH_HELP = `\
workspace-dev test-intelligence tms-push — push approved test cases to a TMS

Usage:
  workspace-dev test-intelligence tms-push \\
    --run-dir <path> \\
    --tms <xray|alm|qtest|polarion> \\
    --project <id> \\
    [--endpoint <alias>] \\
    [--tenant <id>] \\
    [--run-id <id>] \\
    [--batch-size <n>] \\
    [--dry-run]

Required flags:
  --run-dir <path>    Directory containing qc-mapping-preview.json
  --tms <id>          TMS adapter id (xray|alm|qtest|polarion)
  --project <id>      TMS-specific project id (Jira key, ALM domain/project,
                      qTest project id, Polarion project id)

Optional flags:
  --endpoint <alias>  Symbolic endpoint alias (default: <tms>-default)
  --tenant <id>       Tenant id used in idempotency keys (default: default)
  --run-id <id>       Stamp on idempotency keys + report (default: dirname)
  --batch-size <n>    Bulk push size (default: 50)
  --dry-run           Skip every state-mutating call (still writes report)

Credentials are read from the env (NEVER printed):
  WORKSPACE_TEST_SPACE_TMS_<NAME>_TOKEN              (PAT)
  WORKSPACE_TEST_SPACE_TMS_<NAME>_OAUTH_ACCESS_TOKEN (OAuth 2.0)
  WORKSPACE_TEST_SPACE_TMS_<NAME>_BEARER             (Bearer)

Where <NAME> ∈ {XRAY, ALM, QTEST, POLARION}.

Exit codes:
  0  push complete (report written)
  1  operator/config error
  2  pipeline refused (report still written)
`;
