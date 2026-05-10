/**
 * `workspace-dev test-intelligence review …` sub-commands (Issue #2179).
 *
 * Three reviewer-facing subcommands surface the human-review queue
 * (`human-review-queue.ts`):
 *
 *   - `ti review list  --tenant <id> [--profile <id>] [--sla-due-by <iso>]`
 *     Lists pending queue items as canonical JSON.
 *   - `ti review get   <item-id> --tenant <id>`
 *     Emits one queue item as canonical JSON ready for inspection.
 *   - `ti review decide <item-id> --tenant <id>
 *                       --verdict <approved|rejected|revised>
 *                       --rationale <md-file>
 *                       [--revised-tc <json-file>]
 *                       --sign-key <pem>
 *                       --decided-at <iso-8601>`
 *     Builds a signed verdict, verifies the signature locally, and
 *     persists it through the queue store.
 *
 * The CLI never reads the reviewer's private key into a long-lived
 * variable — it loads it, signs the verdict body, and lets the buffer
 * fall out of scope. Signature verification on persist is the
 * authoritative tampering check.
 *
 * Exit codes mirror the rest of the test-intelligence CLI surface:
 *   0  success
 *   1  operator/config error (missing flag, bad value, missing file)
 *   2  queue / signature / persist error
 */

import {
  createHash,
  createPrivateKey,
  createPublicKey,
  sign as cryptoSign,
  type KeyObject,
} from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  TEST_INTELLIGENCE_CONTRACT_VERSION,
  HUMAN_REVIEW_QUEUE_VERDICT_LABELS,
  HUMAN_REVIEW_VERDICT_SCHEMA_VERSION,
  type HumanReviewQueueVerdictLabel,
  type HumanReviewVerdict,
} from "./contracts/index.js";
import { canonicalJson, sha256Hex } from "./test-intelligence/content-hash.js";
import {
  buildVerdictSigningPayload,
  fetchPendingReviews,
  getHumanReviewQueueItem,
  hashReviewerPrincipalId,
  HumanReviewQueueError,
  recordHumanReviewVerdict,
} from "./test-intelligence/human-review-queue.js";
import { sanitizeErrorMessage } from "./error-sanitization.js";

/** Stable operator-config error for the review CLI surface. */
export class TestIntelligenceReviewOperatorError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TestIntelligenceReviewOperatorError";
  }
}

/** Sink shape shared with the rest of the package CLI. */
export interface TestIntelligenceReviewSink {
  stdout(message: string): void;
  stderr(message: string): void;
}

/** Default queue-root resolver: env var override, else `<cwd>/.ti-review`. */
const resolveQueueRoot = (override?: string): string => {
  if (typeof override === "string" && override.length > 0) {
    return resolve(override);
  }
  const fromEnv = process.env["WORKSPACE_TI_REVIEW_ROOT"];
  if (typeof fromEnv === "string" && fromEnv.length > 0) {
    return resolve(fromEnv);
  }
  return resolve(process.cwd(), ".ti-review");
};

const requireFlag = (
  args: ReadonlyArray<string>,
  flag: string,
  index: number,
): string => {
  const value = args[index + 1];
  if (typeof value !== "string" || value.length === 0) {
    throw new TestIntelligenceReviewOperatorError(
      `Flag "${flag}" requires a value.`,
    );
  }
  return value;
};

// -----------------------------------------------------------------------------
// `review list`
// -----------------------------------------------------------------------------

export interface TestIntelligenceReviewListOptions {
  tenant: string;
  profile?: string;
  slaDueBy?: string;
  rootDir?: string;
}

export const parseTestIntelligenceReviewListArgs = (
  args: ReadonlyArray<string>,
): TestIntelligenceReviewListOptions => {
  const out: Partial<TestIntelligenceReviewListOptions> = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === "--tenant") {
      out.tenant = requireFlag(args, arg, i);
      i++;
    } else if (arg === "--profile") {
      out.profile = requireFlag(args, arg, i);
      i++;
    } else if (arg === "--sla-due-by") {
      out.slaDueBy = requireFlag(args, arg, i);
      i++;
    } else if (arg === "--root") {
      out.rootDir = requireFlag(args, arg, i);
      i++;
    } else {
      throw new TestIntelligenceReviewOperatorError(
        `Unknown flag for "test-intelligence review list": ${arg}`,
      );
    }
  }
  if (typeof out.tenant !== "string" || out.tenant.length === 0) {
    throw new TestIntelligenceReviewOperatorError(
      "--tenant <id> is required for review list",
    );
  }
  return out as TestIntelligenceReviewListOptions;
};

export const runTestIntelligenceReviewListCommand = async (
  options: TestIntelligenceReviewListOptions,
  sink: TestIntelligenceReviewSink,
): Promise<number> => {
  try {
    const root = resolveQueueRoot(options.rootDir);
    const items = await fetchPendingReviews(root, {
      tenantId: options.tenant,
      ...(options.profile !== undefined ? { profileId: options.profile } : {}),
      ...(options.slaDueBy !== undefined ? { slaDueBy: options.slaDueBy } : {}),
    });
    sink.stdout(`${canonicalJson({ items })}\n`);
    return 0;
  } catch (error) {
    return failReviewError(error, sink, "Failed to list pending reviews.");
  }
};

// -----------------------------------------------------------------------------
// `review get`
// -----------------------------------------------------------------------------

export interface TestIntelligenceReviewGetOptions {
  itemId: string;
  tenant: string;
  rootDir?: string;
}

export const parseTestIntelligenceReviewGetArgs = (
  args: ReadonlyArray<string>,
): TestIntelligenceReviewGetOptions => {
  let itemId: string | undefined;
  const out: Partial<TestIntelligenceReviewGetOptions> = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === "--tenant") {
      out.tenant = requireFlag(args, arg, i);
      i++;
    } else if (arg === "--root") {
      out.rootDir = requireFlag(args, arg, i);
      i++;
    } else if (!arg.startsWith("--")) {
      if (itemId !== undefined) {
        throw new TestIntelligenceReviewOperatorError(
          'review get accepts exactly one positional <item-id>',
        );
      }
      itemId = arg;
    } else {
      throw new TestIntelligenceReviewOperatorError(
        `Unknown flag for "test-intelligence review get": ${arg}`,
      );
    }
  }
  if (typeof out.tenant !== "string" || out.tenant.length === 0) {
    throw new TestIntelligenceReviewOperatorError(
      "--tenant <id> is required for review get",
    );
  }
  if (typeof itemId !== "string" || itemId.length === 0) {
    throw new TestIntelligenceReviewOperatorError(
      "review get requires a positional <item-id>",
    );
  }
  return { itemId, tenant: out.tenant, ...(out.rootDir !== undefined ? { rootDir: out.rootDir } : {}) };
};

export const runTestIntelligenceReviewGetCommand = async (
  options: TestIntelligenceReviewGetOptions,
  sink: TestIntelligenceReviewSink,
): Promise<number> => {
  try {
    const root = resolveQueueRoot(options.rootDir);
    const item = await getHumanReviewQueueItem(
      root,
      options.tenant,
      options.itemId,
    );
    if (item === undefined) {
      sink.stderr(
        `error: queue item "${options.itemId}" not found for tenant "${options.tenant}"\n`,
      );
      return 2;
    }
    sink.stdout(`${canonicalJson(item)}\n`);
    return 0;
  } catch (error) {
    return failReviewError(error, sink, "Failed to fetch queue item.");
  }
};

// -----------------------------------------------------------------------------
// `review decide`
// -----------------------------------------------------------------------------

export interface TestIntelligenceReviewDecideOptions {
  itemId: string;
  tenant: string;
  verdict: HumanReviewQueueVerdictLabel;
  rationaleFile: string;
  revisedTcFile?: string;
  signKeyPath: string;
  decidedAt: string;
  reviewerPrincipalId?: string;
  rootDir?: string;
}

export const parseTestIntelligenceReviewDecideArgs = (
  args: ReadonlyArray<string>,
): TestIntelligenceReviewDecideOptions => {
  let itemId: string | undefined;
  const out: Partial<TestIntelligenceReviewDecideOptions> = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === "--tenant") {
      out.tenant = requireFlag(args, arg, i);
      i++;
    } else if (arg === "--verdict") {
      const value = requireFlag(args, arg, i);
      if (
        !(HUMAN_REVIEW_QUEUE_VERDICT_LABELS as readonly string[]).includes(value)
      ) {
        throw new TestIntelligenceReviewOperatorError(
          `--verdict must be one of ${HUMAN_REVIEW_QUEUE_VERDICT_LABELS.join("|")}, got "${value}"`,
        );
      }
      out.verdict = value as HumanReviewQueueVerdictLabel;
      i++;
    } else if (arg === "--rationale") {
      out.rationaleFile = requireFlag(args, arg, i);
      i++;
    } else if (arg === "--revised-tc") {
      out.revisedTcFile = requireFlag(args, arg, i);
      i++;
    } else if (arg === "--sign-key") {
      out.signKeyPath = requireFlag(args, arg, i);
      i++;
    } else if (arg === "--decided-at") {
      out.decidedAt = requireFlag(args, arg, i);
      i++;
    } else if (arg === "--reviewer-principal") {
      out.reviewerPrincipalId = requireFlag(args, arg, i);
      i++;
    } else if (arg === "--root") {
      out.rootDir = requireFlag(args, arg, i);
      i++;
    } else if (!arg.startsWith("--")) {
      if (itemId !== undefined) {
        throw new TestIntelligenceReviewOperatorError(
          "review decide accepts exactly one positional <item-id>",
        );
      }
      itemId = arg;
    } else {
      throw new TestIntelligenceReviewOperatorError(
        `Unknown flag for "test-intelligence review decide": ${arg}`,
      );
    }
  }
  if (typeof itemId !== "string" || itemId.length === 0) {
    throw new TestIntelligenceReviewOperatorError(
      "review decide requires a positional <item-id>",
    );
  }
  if (typeof out.tenant !== "string" || out.tenant.length === 0) {
    throw new TestIntelligenceReviewOperatorError(
      "--tenant <id> is required for review decide",
    );
  }
  if (out.verdict === undefined) {
    throw new TestIntelligenceReviewOperatorError(
      "--verdict <approved|rejected|revised> is required for review decide",
    );
  }
  if (
    typeof out.rationaleFile !== "string" ||
    out.rationaleFile.length === 0
  ) {
    throw new TestIntelligenceReviewOperatorError(
      "--rationale <md-file> is required for review decide",
    );
  }
  if (typeof out.signKeyPath !== "string" || out.signKeyPath.length === 0) {
    throw new TestIntelligenceReviewOperatorError(
      "--sign-key <pem> is required for review decide",
    );
  }
  if (typeof out.decidedAt !== "string" || out.decidedAt.length === 0) {
    throw new TestIntelligenceReviewOperatorError(
      "--decided-at <iso-8601> is required for review decide",
    );
  }
  if (out.verdict !== "revised" && out.revisedTcFile !== undefined) {
    throw new TestIntelligenceReviewOperatorError(
      '--revised-tc may only be used with --verdict revised',
    );
  }
  if (out.verdict === "revised" && out.revisedTcFile === undefined) {
    throw new TestIntelligenceReviewOperatorError(
      '--verdict revised requires --revised-tc <json-file>',
    );
  }
  return {
    itemId,
    tenant: out.tenant,
    verdict: out.verdict,
    rationaleFile: out.rationaleFile,
    signKeyPath: out.signKeyPath,
    decidedAt: out.decidedAt,
    ...(out.revisedTcFile !== undefined ? { revisedTcFile: out.revisedTcFile } : {}),
    ...(out.reviewerPrincipalId !== undefined
      ? { reviewerPrincipalId: out.reviewerPrincipalId }
      : {}),
    ...(out.rootDir !== undefined ? { rootDir: out.rootDir } : {}),
  };
};

const loadEd25519PrivateKey = async (
  path: string,
): Promise<{
  privateKey: KeyObject;
  publicKey: KeyObject;
  publicKeyPem: string;
  publicKeyFingerprintSha256: string;
}> => {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (err) {
    if (
      typeof err === "object" &&
      err !== null &&
      (err as { code?: string }).code === "ENOENT"
    ) {
      throw new TestIntelligenceReviewOperatorError(
        `--sign-key file not found: ${path}`,
      );
    }
    throw err;
  }
  const trimmed = raw.trim();
  let privateKey: KeyObject;
  try {
    privateKey = trimmed.startsWith("{")
      ? createPrivateKey({
          key: JSON.parse(trimmed) as Record<string, string>,
          format: "jwk",
        })
      : createPrivateKey({ key: raw, format: "pem" });
  } catch (err) {
    throw new TestIntelligenceReviewOperatorError(
      `--sign-key file is not a valid PEM/JWK ed25519 private key: ${(err as Error).message}`,
    );
  }
  if (privateKey.asymmetricKeyType !== "ed25519") {
    throw new TestIntelligenceReviewOperatorError(
      `--sign-key must be an ed25519 private key, got ${privateKey.asymmetricKeyType ?? "unknown"}`,
    );
  }
  const publicKey = createPublicKey(privateKey);
  const publicKeyPem = (
    publicKey.export({ format: "pem", type: "spki" }) as string
  ).trim();
  const spkiDer = publicKey.export({ format: "der", type: "spki" }) as Buffer;
  const publicKeyFingerprintSha256 = createHash("sha256")
    .update(new Uint8Array(spkiDer.buffer, spkiDer.byteOffset, spkiDer.byteLength))
    .digest("hex");
  return {
    privateKey,
    publicKey,
    publicKeyPem,
    publicKeyFingerprintSha256,
  };
};

export const runTestIntelligenceReviewDecideCommand = async (
  options: TestIntelligenceReviewDecideOptions,
  sink: TestIntelligenceReviewSink,
): Promise<number> => {
  try {
    const root = resolveQueueRoot(options.rootDir);
    const item = await getHumanReviewQueueItem(
      root,
      options.tenant,
      options.itemId,
    );
    if (item === undefined) {
      sink.stderr(
        `error: queue item "${options.itemId}" not found for tenant "${options.tenant}"\n`,
      );
      return 2;
    }

    const rationale = await readRationale(options.rationaleFile);

    let revisedTestCase: Record<string, unknown> | undefined;
    if (options.revisedTcFile !== undefined) {
      const rawTc = await readFile(options.revisedTcFile, "utf8").catch(
        (err: unknown) => {
          if (
            typeof err === "object" &&
            err !== null &&
            (err as { code?: string }).code === "ENOENT"
          ) {
            throw new TestIntelligenceReviewOperatorError(
              `--revised-tc file not found: ${options.revisedTcFile}`,
            );
          }
          throw err;
        },
      );
      let parsed: unknown;
      try {
        parsed = JSON.parse(rawTc);
      } catch (err) {
        throw new TestIntelligenceReviewOperatorError(
          `--revised-tc file is not valid JSON: ${(err as Error).message}`,
        );
      }
      if (
        typeof parsed !== "object" ||
        parsed === null ||
        Array.isArray(parsed)
      ) {
        throw new TestIntelligenceReviewOperatorError(
          "--revised-tc file must contain a JSON object",
        );
      }
      revisedTestCase = parsed as Record<string, unknown>;
    }

    const principalId = options.reviewerPrincipalId ?? sha256OfKeyPath(options.signKeyPath);
    const principalHash = hashReviewerPrincipalId(principalId);

    const key = await loadEd25519PrivateKey(options.signKeyPath);

    const verdictBody: Omit<HumanReviewVerdict, "signatureHex"> = {
      schemaVersion: HUMAN_REVIEW_VERDICT_SCHEMA_VERSION,
      contractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
      itemId: item.itemId,
      reviewerPrincipalHash: principalHash,
      verdict: options.verdict,
      rationale,
      ...(revisedTestCase !== undefined ? { revisedTestCase } : {}),
      decidedAt: options.decidedAt,
      publicKeyFingerprintSha256: key.publicKeyFingerprintSha256,
      publicKeyPem: key.publicKeyPem,
    };
    const payload = buildVerdictSigningPayload(verdictBody);
    const signature = cryptoSign(null, payload, key.privateKey);
    const verdict: HumanReviewVerdict = {
      ...verdictBody,
      signatureHex: signature.toString("hex"),
    };

    const persistedItem = await recordHumanReviewVerdict(root, verdict);
    sink.stdout(
      `${canonicalJson({ recorded: { itemId: persistedItem.itemId, verdict: verdict.verdict, decidedAt: verdict.decidedAt, reviewerPrincipalHash: verdict.reviewerPrincipalHash } })}\n`,
    );
    return 0;
  } catch (error) {
    return failReviewError(error, sink, "Failed to record human-review verdict.");
  }
};

const readRationale = async (path: string): Promise<string> => {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (err) {
    if (
      typeof err === "object" &&
      err !== null &&
      (err as { code?: string }).code === "ENOENT"
    ) {
      throw new TestIntelligenceReviewOperatorError(
        `--rationale file not found: ${path}`,
      );
    }
    throw err;
  }
  // Strip trailing whitespace so the same Markdown body produces the
  // same canonical rationale across editors.
  return raw.replace(/[\s]+$/u, "").trim();
};

const sha256OfKeyPath = (keyPath: string): string => sha256Hex(resolve(keyPath));

const failReviewError = (
  error: unknown,
  sink: TestIntelligenceReviewSink,
  fallback: string,
): number => {
  if (error instanceof TestIntelligenceReviewOperatorError) {
    sink.stderr(`error: ${error.message}\n`);
    return 1;
  }
  if (error instanceof HumanReviewQueueError) {
    sink.stderr(`error: [${error.code}] ${error.message}\n`);
    return 2;
  }
  sink.stderr(
    `error: ${sanitizeErrorMessage({
      error,
      fallback,
    })}\n`,
  );
  return 2;
};

// -----------------------------------------------------------------------------
// Help text
// -----------------------------------------------------------------------------

export const TEST_INTELLIGENCE_REVIEW_HELP = `workspace-dev test-intelligence review - human-oversight queue + decision capture (DSGVO Art. 22 / EU AI Act Art. 14)

Usage:
  workspace-dev test-intelligence review list   --tenant <id> [--profile <id>] [--sla-due-by <iso-8601>] [--root <dir>]
  workspace-dev test-intelligence review get    <item-id> --tenant <id> [--root <dir>]
  workspace-dev test-intelligence review decide <item-id> --tenant <id>
                                                --verdict <approved|rejected|revised>
                                                --rationale <md-file>
                                                [--revised-tc <json-file>]
                                                --sign-key <pem>
                                                --decided-at <iso-8601>
                                                [--reviewer-principal <stable-id>]
                                                [--root <dir>]

Options:
  --tenant <id>              Tenant id the queue is partitioned under (required)
  --profile <id>             Optional policy-profile id filter for "list"
  --sla-due-by <iso-8601>    Inclusive upper bound on slaDeadlineAt for "list"
  --verdict <label>          One of: approved | rejected | revised
  --rationale <md-file>      File containing the reviewer's rationale (Markdown).
                             Length-capped, no LF/CR/U+2028/U+2029 after trim.
  --revised-tc <json-file>   Required when --verdict=revised; JSON object body
  --sign-key <pem>           Path to the reviewer's ed25519 private key (PEM/JWK)
  --decided-at <iso-8601>    Strict ISO-8601 timestamp the verdict was decided at
  --reviewer-principal <id>  Stable, non-PII reviewer id; defaults to a stable
                             hash of the key path so dry runs stay deterministic
  --root <dir>               Override the queue root directory.
                             Default: $WORKSPACE_TI_REVIEW_ROOT or "<cwd>/.ti-review"

Exit codes:
  0  success
  1  operator/config error
  2  queue / signature / persist error
`;
