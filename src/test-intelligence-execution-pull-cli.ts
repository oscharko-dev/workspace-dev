/**
 * `workspace-dev test-intelligence execution-pull` sub-command
 * (Issue #2186, W8-4).
 *
 * Pulls execution evidence from a customer's TMS, verifies every
 * entry against the tenant's TMS-admin Ed25519 public key, and
 * writes the accepted entries under the per-tenant calibration
 * corpus. Operators run this on a schedule (e.g. nightly cron) so
 * the next quarterly judge-calibration refit (W7-3) automatically
 * picks up production execution outcomes.
 *
 *   pnpm exec tsx src/cli.ts test-intelligence execution-pull \
 *     --tms <xray|alm|qtest|polarion> \
 *     --project <id> \
 *     --since <iso-time> \
 *     --tenant <id> \
 *     --output-root <path> \
 *     [--endpoint <alias>] \
 *     [--verifying-key <path>] \
 *     [--strict-signature]
 *
 * The verifying-key flag points at the customer's TMS-admin Ed25519
 * SPKI PEM file. When omitted, the CLI looks under
 * `<output-root>/tenants/<tenant>/signing-keys/tms-admin.ed25519.public.pem`
 * (the path laid down by `test-intelligence onboard` once the
 * customer registers their key). Either way, the key NEVER touches
 * the report or stdout.
 *
 * Exit codes:
 *   0  pull completed (report written; rejected entries listed).
 *   1  operator/config error (missing flag, unknown adapter, bad
 *      key, missing credentials, output-root not a tenant dir).
 *   2  hard signature gate failed under `--strict-signature`.
 */

import { readFile, stat } from "node:fs/promises";
import { join, resolve } from "node:path";

import {
  ALLOWED_TMS_ADAPTER_IDS,
  type TmsAdapterId,
} from "./contracts/index.js";
import { sanitizeErrorMessage } from "./error-sanitization.js";
import {
  asTenantId,
  EXECUTION_EVIDENCE_REPORT_FILENAME,
  ExecutionEvidenceSignatureGateError,
  G12_EXECUTION_EVIDENCE_SIGNED,
  ingestExecutionEvidence,
  type ExecutionEvidence,
  type ExecutionEvidenceIngestContext,
  type IngestExecutionEvidenceResult,
  type TenantId,
} from "./test-intelligence/test-execution-evidence-ingest.js";
import {
  createAlmAdapter,
  createPolarionAdapter,
  createQtestAdapter,
  createXrayAdapter,
  loadTmsCredentialsFromEnv,
  type TmsAdapter,
  type TmsAdapterSession,
  type TmsCredentials,
  type TmsHttpClient,
  type TmsRawExecutionEvidence,
} from "./test-intelligence/tms-adapters/index.js";
import { createDefaultTmsHttpClient } from "./test-intelligence/tms-adapters/default-http-client.js";

const ALLOWED_ADAPTER_SET = new Set<TmsAdapterId>(ALLOWED_TMS_ADAPTER_IDS);

/** Default filename for the TMS-admin verifying key (laid down at onboard). */
export const TMS_ADMIN_VERIFYING_KEY_FILENAME =
  "tms-admin.ed25519.public.pem" as const;

/** Operator-facing error class for the execution-pull CLI parser/handler. */
export class TestIntelligenceExecutionPullOperatorError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TestIntelligenceExecutionPullOperatorError";
  }
}

/** Parsed flags for `test-intelligence execution-pull`. */
export interface TestIntelligenceExecutionPullOptions {
  readonly tms: TmsAdapterId;
  readonly projectId: string;
  readonly sinceIso: string;
  readonly tenantId: string;
  readonly outputRoot: string;
  readonly endpointAlias: string;
  readonly verifyingKeyPath?: string;
  readonly strictSignature: boolean;
}

const ISO_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/;
const TENANT_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/u;

/**
 * Parse the kebab-case flag form documented above. Refuses unknown
 * flags so a typo never silently downgrades to a default.
 */
export const parseTestIntelligenceExecutionPullArgs = (
  argv: readonly string[],
): TestIntelligenceExecutionPullOptions => {
  let tms: string | undefined;
  let projectId: string | undefined;
  let sinceIso: string | undefined;
  let tenantId: string | undefined;
  let outputRoot: string | undefined;
  let endpointAlias: string | undefined;
  let verifyingKeyPath: string | undefined;
  let strictSignature = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1]?.trim();
    if (arg === "--tms") {
      if (next === undefined || next.length === 0) {
        throw new TestIntelligenceExecutionPullOperatorError(
          "--tms requires one of xray|alm|qtest|polarion",
        );
      }
      tms = next;
      i += 1;
      continue;
    }
    if (arg === "--project") {
      if (next === undefined || next.length === 0) {
        throw new TestIntelligenceExecutionPullOperatorError(
          "--project requires a non-empty TMS project id",
        );
      }
      projectId = next;
      i += 1;
      continue;
    }
    if (arg === "--since") {
      if (next === undefined || next.length === 0) {
        throw new TestIntelligenceExecutionPullOperatorError(
          "--since requires an ISO-8601 UTC timestamp",
        );
      }
      sinceIso = next;
      i += 1;
      continue;
    }
    if (arg === "--tenant") {
      if (next === undefined || next.length === 0) {
        throw new TestIntelligenceExecutionPullOperatorError(
          "--tenant requires a non-empty tenant id",
        );
      }
      tenantId = next;
      i += 1;
      continue;
    }
    if (arg === "--output-root") {
      if (next === undefined || next.length === 0) {
        throw new TestIntelligenceExecutionPullOperatorError(
          "--output-root requires a non-empty path",
        );
      }
      outputRoot = next;
      i += 1;
      continue;
    }
    if (arg === "--endpoint") {
      if (next === undefined || next.length === 0) {
        throw new TestIntelligenceExecutionPullOperatorError(
          "--endpoint requires a non-empty endpoint alias",
        );
      }
      endpointAlias = next;
      i += 1;
      continue;
    }
    if (arg === "--verifying-key") {
      if (next === undefined || next.length === 0) {
        throw new TestIntelligenceExecutionPullOperatorError(
          "--verifying-key requires a path to an Ed25519 SPKI PEM",
        );
      }
      verifyingKeyPath = next;
      i += 1;
      continue;
    }
    if (arg === "--strict-signature") {
      strictSignature = true;
      continue;
    }
    throw new TestIntelligenceExecutionPullOperatorError(
      `Unknown flag for "test-intelligence execution-pull": ${arg}`,
    );
  }

  if (!tms) {
    throw new TestIntelligenceExecutionPullOperatorError(
      "--tms is required (xray|alm|qtest|polarion)",
    );
  }
  if (!ALLOWED_ADAPTER_SET.has(tms as TmsAdapterId)) {
    throw new TestIntelligenceExecutionPullOperatorError(
      `--tms must be one of ${ALLOWED_TMS_ADAPTER_IDS.join("|")}, received ${tms}`,
    );
  }
  if (!projectId) {
    throw new TestIntelligenceExecutionPullOperatorError(
      "--project is required (TMS-specific project id)",
    );
  }
  if (!sinceIso) {
    throw new TestIntelligenceExecutionPullOperatorError(
      "--since is required (ISO-8601 UTC timestamp ending with Z)",
    );
  }
  if (!ISO_PATTERN.test(sinceIso)) {
    throw new TestIntelligenceExecutionPullOperatorError(
      `--since must be an ISO-8601 UTC timestamp ending with Z (received "${sinceIso}")`,
    );
  }
  if (!tenantId) {
    throw new TestIntelligenceExecutionPullOperatorError(
      "--tenant is required (must match the onboarded tenant id)",
    );
  }
  if (!TENANT_ID_PATTERN.test(tenantId)) {
    throw new TestIntelligenceExecutionPullOperatorError(
      `--tenant must match ${TENANT_ID_PATTERN.source}`,
    );
  }
  if (!outputRoot) {
    throw new TestIntelligenceExecutionPullOperatorError(
      "--output-root is required (path containing tenants/<id>/)",
    );
  }

  return {
    tms: tms as TmsAdapterId,
    projectId,
    sinceIso,
    tenantId,
    outputRoot,
    endpointAlias: endpointAlias ?? `${tms}-default`,
    ...(verifyingKeyPath !== undefined ? { verifyingKeyPath } : {}),
    strictSignature,
  };
};

/** Sink used by the handler — mirrors the other test-intelligence CLI subcommands. */
export interface TestIntelligenceExecutionPullSink {
  stdout(message: string): void;
  stderr(message: string): void;
}

/** Inputs for `runTestIntelligenceExecutionPullCommand`. */
export interface RunTestIntelligenceExecutionPullCommandInput {
  options: TestIntelligenceExecutionPullOptions;
  sink: TestIntelligenceExecutionPullSink;
  /** Optional env override (tests pin a deterministic env). */
  env?: NodeJS.ProcessEnv;
  /** Optional clock override (tests pin a deterministic timestamp). */
  now?: () => Date;
  /** Optional adapter factory override (tests inject a fake). */
  adapterFactory?: (input: {
    adapterId: TmsAdapterId;
    http: TmsHttpClient;
  }) => TmsAdapter;
  /** Optional HTTP client override (tests inject a fake). */
  httpFactory?: (adapterId: TmsAdapterId) => TmsHttpClient;
}

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
      throw new TestIntelligenceExecutionPullOperatorError(
        `unsupported adapter id: ${exhaustive as string}`,
      );
    }
  }
};

const resolveTenantDir = (outputRoot: string, tenantId: string): string =>
  resolve(outputRoot, "tenants", tenantId);

const resolveDefaultVerifyingKeyPath = (
  outputRoot: string,
  tenantId: string,
): string =>
  join(
    resolveTenantDir(outputRoot, tenantId),
    "signing-keys",
    TMS_ADMIN_VERIFYING_KEY_FILENAME,
  );

/**
 * Drive the execution-pull command end-to-end. Returns the process
 * exit code per the contract documented at the top of the file.
 */
export const runTestIntelligenceExecutionPullCommand = async (
  input: RunTestIntelligenceExecutionPullCommandInput,
): Promise<number> => {
  const env = input.env ?? process.env;
  const adapterFactory = input.adapterFactory ?? defaultAdapterFactory;
  const httpFactory =
    input.httpFactory ??
    ((adapterId: TmsAdapterId) =>
      createDefaultTmsHttpClient({ adapterId, env }));
  const tenantDir = resolveTenantDir(
    input.options.outputRoot,
    input.options.tenantId,
  );
  const tenantDirExists = await stat(tenantDir)
    .then((s) => s.isDirectory())
    .catch(() => false);
  if (!tenantDirExists) {
    input.sink.stderr(
      `error: tenant directory does not exist: ${tenantDir}\n` +
        `       run \`workspace-dev test-intelligence onboard --tenant-id ${input.options.tenantId} ` +
        `--output-root ${input.options.outputRoot} ...\` first.\n`,
    );
    return 1;
  }

  const verifyingKeyPath =
    input.options.verifyingKeyPath ??
    resolveDefaultVerifyingKeyPath(
      input.options.outputRoot,
      input.options.tenantId,
    );
  let verifyingPublicKeyPem: string;
  try {
    verifyingPublicKeyPem = await readFile(verifyingKeyPath, "utf8");
    if (!verifyingPublicKeyPem.includes("BEGIN PUBLIC KEY")) {
      throw new Error(
        `verifying key file does not look like a PEM SPKI public key`,
      );
    }
  } catch (err) {
    input.sink.stderr(
      `error: cannot read verifying key from ${verifyingKeyPath}: ${sanitizeErrorMessage(
        {
          error: err,
          fallback: "verifying key load failed",
        },
      )}\n`,
    );
    return 1;
  }

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

  let session: TmsAdapterSession;
  try {
    session = await adapter.connect({
      endpointAlias: input.options.endpointAlias,
      projectId: input.options.projectId,
      tenantId: input.options.tenantId,
      credentials,
    });
  } catch (err) {
    input.sink.stderr(
      `error: TMS connect failed: ${sanitizeErrorMessage({
        error: err,
        fallback: "tms connect failed",
      })}\n`,
    );
    return 1;
  }

  let rawEvidence: readonly TmsRawExecutionEvidence[];
  try {
    const pull = await adapter.pullExecutions({
      session,
      sinceIso: input.options.sinceIso,
    });
    rawEvidence = pull.evidence;
  } catch (err) {
    try {
      await adapter.disconnect(session);
    } catch {
      // disconnect is best-effort.
    }
    input.sink.stderr(
      `error: TMS pullExecutions failed: ${sanitizeErrorMessage({
        error: err,
        fallback: "tms pullExecutions failed",
      })}\n`,
    );
    return 1;
  }
  try {
    await adapter.disconnect(session);
  } catch {
    // disconnect is best-effort.
  }

  const tenantId: TenantId = asTenantId(input.options.tenantId);
  const evidence: ExecutionEvidence[] = rawEvidence.map((row) => ({
    ...row,
    tenantId,
  }));
  const context: ExecutionEvidenceIngestContext = {
    tenantId,
    tenantDir,
    verifyingPublicKeyPem,
    tmsAdapterId: input.options.tms,
    projectId: input.options.projectId,
    sinceIso: input.options.sinceIso,
    ...(input.now !== undefined ? { now: input.now } : {}),
  };

  let result: IngestExecutionEvidenceResult;
  try {
    result = await ingestExecutionEvidence({ evidence, context });
  } catch (err) {
    input.sink.stderr(
      `error: execution-evidence ingest failed: ${sanitizeErrorMessage({
        error: err,
        fallback: "ingest failed",
      })}\n`,
    );
    return 1;
  }

  const summary =
    `execution-pull complete (${input.options.tms} project=${input.options.projectId}): ` +
    `accepted=${result.accepted} rejected=${result.rejected} ` +
    `conflicts=${result.report.conflictCount} ` +
    `report=${result.reportPath}\n`;
  input.sink.stdout(summary);
  if (result.report.conflictCount > 0) {
    input.sink.stdout(
      `note: ${result.report.conflictCount} reviewer/execution conflict(s) flagged for human re-review (W6-5).\n`,
    );
  }
  if (
    input.options.strictSignature &&
    result.report.rejections.some((r) => r.code === "signature_invalid")
  ) {
    const signatureRejections = result.report.rejections.filter(
      (r) => r.code === "signature_invalid",
    );
    const gateError = new ExecutionEvidenceSignatureGateError(signatureRejections);
    input.sink.stderr(
      `error: ${G12_EXECUTION_EVIDENCE_SIGNED} hard gate failed: ${gateError.rejectedCount} unsigned/tampered entr${
        gateError.rejectedCount === 1 ? "y" : "ies"
      }.\n`,
    );
    return 2;
  }
  return 0;
};

/** Help text for `test-intelligence execution-pull`. */
export const TEST_INTELLIGENCE_EXECUTION_PULL_HELP: string = `\
workspace-dev test-intelligence execution-pull — pull TMS execution evidence

Usage:
  workspace-dev test-intelligence execution-pull \\
    --tms <xray|alm|qtest|polarion> \\
    --project <id> \\
    --since <iso-time> \\
    --tenant <id> \\
    --output-root <path> \\
    [--endpoint <alias>] \\
    [--verifying-key <path>] \\
    [--strict-signature]

Required flags:
  --tms <id>          TMS adapter id (xray|alm|qtest|polarion)
  --project <id>      TMS-specific project id
  --since <iso-time>  ISO-8601 UTC timestamp (lower bound on executedAt)
  --tenant <id>       Tenant id (must match the onboarded tenant directory)
  --output-root <path> Path containing tenants/<id>/ from \`onboard\`

Optional flags:
  --endpoint <alias>  Symbolic endpoint alias (default: <tms>-default)
  --verifying-key <path>
                      Ed25519 SPKI PEM with the customer's TMS-admin
                      public key (default: <output-root>/tenants/<id>/
                      signing-keys/${TMS_ADMIN_VERIFYING_KEY_FILENAME})
  --strict-signature  Promote ${G12_EXECUTION_EVIDENCE_SIGNED} from a soft
                      drop to a hard CI failure (exit 2)

Credentials are read from the env (NEVER printed):
  WORKSPACE_TEST_SPACE_TMS_<NAME>_TOKEN              (PAT)
  WORKSPACE_TEST_SPACE_TMS_<NAME>_OAUTH_ACCESS_TOKEN (OAuth 2.0)
  WORKSPACE_TEST_SPACE_TMS_<NAME>_BEARER             (Bearer)

Where <NAME> ∈ {XRAY, ALM, QTEST, POLARION}.

Outputs (atomic writes, tenant-isolated):
  <output-root>/tenants/<id>/calibration-corpus/execution-evidence/<yyyy-MM>/<sha256>.json
  <output-root>/tenants/<id>/calibration-corpus/${EXECUTION_EVIDENCE_REPORT_FILENAME}

Exit codes:
  0  pull complete (report written; rejected entries listed)
  1  operator/config error
  2  ${G12_EXECUTION_EVIDENCE_SIGNED} hard gate failed (--strict-signature)
`;
