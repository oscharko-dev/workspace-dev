/**
 * Human-review queue + decision-capture surface (Issue #2179).
 *
 * Tier-1 / W6-5 — surfaces the existing `human_review` agent role
 * (Issue #2038) as a queryable per-tenant queue + a signed verdict-
 * capture API so a competent human operator can satisfy DSGVO Art. 22
 * ("automated decisions with significant legal effect") and EU AI Act
 * Art. 14 ("human oversight") for banking-test generation runs.
 *
 * The queue is filesystem-backed and tenant-partitioned:
 *
 *   <root>/<tenantId>/queue/<itemId>.json    — pending queue items
 *   <root>/<tenantId>/verdicts/<itemId>.json — recorded verdicts
 *   <root>/<tenantId>/runs/<runId>.log.json  — per-run audit log
 *
 * Hard invariants:
 *
 *   - Every persisted record is canonical-JSON (sorted keys), atomic
 *     write (`tmp + rename`), and byte-stable for byte-identical input.
 *   - Tenant ids and run ids are validated to single-segment values
 *     before being used as path components — there is no API to address
 *     paths outside a queue's root, and `..`, `/`, `\`, control chars
 *     are rejected.
 *   - Verdicts carry a detached ed25519 signature over the canonical-
 *     JSON serialisation of the verdict body (every field except
 *     `signatureHex`). `recordHumanReviewVerdict` verifies the signature
 *     against the supplied public key before accepting the verdict; a
 *     bad signature throws and writes nothing.
 *   - Reviewer identity is captured as `reviewerPrincipalHash`
 *     (sha256 of the reviewer's stable id), reusing the convention
 *     from `human-review-agent.ts`. The raw id is never persisted.
 *   - SLA tracking: every queue item carries `slaDeadlineAt`. The
 *     module exposes `findSlaBreaches(now)` so a follow-up run can
 *     surface a `policy:human-review-sla-breach` warning.
 *   - Replay determinism: `loadVerdictsForRun(runId)` returns the
 *     persisted verdict map so a replay can short-circuit the LLM
 *     and re-emit the prior decision byte-identically.
 *
 * The module is clock-free: every timestamp is supplied by the caller
 * as an ISO-8601 string. This keeps every artifact deterministic and
 * lets fixtures pin time with no monkey-patching.
 */

import {
  createHash,
  createPublicKey,
  verify as cryptoVerify,
  type KeyObject,
} from "node:crypto";
import { mkdir, readdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import {
  HUMAN_REVIEW_LOG_ARTIFACT_FILENAME,
  HUMAN_REVIEW_LOG_SCHEMA_VERSION,
  HUMAN_REVIEW_POLICY_WARNING_RULES,
  HUMAN_REVIEW_QUEUE_ITEM_SCHEMA_VERSION,
  HUMAN_REVIEW_QUEUE_VERDICT_LABELS,
  HUMAN_REVIEW_VERDICT_RATIONALE_MAX_CHARS,
  HUMAN_REVIEW_VERDICT_SCHEMA_VERSION,
  TEST_INTELLIGENCE_CONTRACT_VERSION,
  type HumanReviewFilter,
  type HumanReviewLog,
  type HumanReviewPolicyWarningRule,
  type HumanReviewQueueItem,
  type HumanReviewQueueVerdictLabel,
  type HumanReviewSlaBreachEntry,
  type HumanReviewVerdict,
  type JudgeDisagreementSnapshot,
} from "../contracts/index.js";
import { canonicalJson } from "./content-hash.js";

export {
  HUMAN_REVIEW_LOG_ARTIFACT_FILENAME,
  HUMAN_REVIEW_LOG_SCHEMA_VERSION,
  HUMAN_REVIEW_POLICY_WARNING_RULES,
  HUMAN_REVIEW_QUEUE_ITEM_SCHEMA_VERSION,
  HUMAN_REVIEW_QUEUE_VERDICT_LABELS,
  HUMAN_REVIEW_VERDICT_RATIONALE_MAX_CHARS,
  HUMAN_REVIEW_VERDICT_SCHEMA_VERSION,
};

const ISO_8601 =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/u;

const SAFE_PATH_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;

const FORBIDDEN_RATIONALE_CHARS: readonly string[] = Object.freeze([
  "\n",
  "\r",
  "\u2028",
  "\u2029",
  "\u0000",
]);
/** Stable error code raised by every refusal in this module. */
export class HumanReviewQueueError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "HumanReviewQueueError";
    this.code = code;
  }
}

const fail = (code: string, message: string): never => {
  throw new HumanReviewQueueError(code, message);
};

const sha256Hex = (value: Uint8Array | string): string =>
  createHash("sha256").update(value).digest("hex");

const isHex = (value: string, length: number): boolean =>
  typeof value === "string" &&
  value.length === length &&
  /^[0-9a-f]+$/u.test(value);

const assertSafeSegment = (value: string, label: string): void => {
  if (typeof value !== "string" || value.length === 0) {
    fail("E_INVALID_SEGMENT", `${label} must be a non-empty string`);
  }
  if (
    value === "." ||
    value === ".." ||
    value.includes("/") ||
    value.includes("\\") ||
    !SAFE_PATH_SEGMENT.test(value)
  ) {
    fail(
      "E_INVALID_SEGMENT",
      `${label} "${value}" is not a safe single-path-segment value (must match ${SAFE_PATH_SEGMENT})`,
    );
  }
};

const assertIso8601 = (value: string, label: string): void => {
  if (typeof value !== "string" || !ISO_8601.test(value)) {
    fail(
      "E_INVALID_TIMESTAMP",
      `${label} must be a strict ISO-8601 timestamp, got "${value}"`,
    );
  }
};

const assertRationale = (rationale: string, label: string): void => {
  if (typeof rationale !== "string" || rationale.length === 0) {
    fail("E_INVALID_RATIONALE", `${label} must be a non-empty string`);
  }
  if (rationale.length > HUMAN_REVIEW_VERDICT_RATIONALE_MAX_CHARS) {
    fail(
      "E_INVALID_RATIONALE",
      `${label} exceeds HUMAN_REVIEW_VERDICT_RATIONALE_MAX_CHARS (${HUMAN_REVIEW_VERDICT_RATIONALE_MAX_CHARS}), got ${rationale.length}`,
    );
  }
  for (const ch of FORBIDDEN_RATIONALE_CHARS) {
    if (rationale.includes(ch)) {
      const codepoint = ch
        .charCodeAt(0)
        .toString(16)
        .toUpperCase()
        .padStart(4, "0");
      fail(
        "E_INVALID_RATIONALE",
        `${label} contains a forbidden control / line-separator codepoint (U+${codepoint})`,
      );
    }
  }
};

const assertVerdictLabel = (
  verdict: HumanReviewQueueVerdictLabel,
  label: string,
): void => {
  const value: string = verdict;
  if (
    !(HUMAN_REVIEW_QUEUE_VERDICT_LABELS as readonly string[]).includes(value)
  ) {
    fail(
      "E_INVALID_VERDICT",
      `${label} "${value}" is not a known HumanReviewQueueVerdictLabel`,
    );
  }
};

/**
 * Validate the structural shape of a {@link HumanReviewQueueItem}. Throws
 * on any structural violation; never returns a partially-validated record.
 */
export const assertHumanReviewQueueItemInvariants = (
  item: HumanReviewQueueItem,
): void => {
  const schemaVersion: string = item.schemaVersion;
  if (schemaVersion !== HUMAN_REVIEW_QUEUE_ITEM_SCHEMA_VERSION) {
    fail(
      "E_INVALID_SCHEMA",
      `HumanReviewQueueItem.schemaVersion must be "${HUMAN_REVIEW_QUEUE_ITEM_SCHEMA_VERSION}", got "${schemaVersion}"`,
    );
  }
  const contractVersion: string = item.contractVersion;
  if (contractVersion !== TEST_INTELLIGENCE_CONTRACT_VERSION) {
    fail(
      "E_INVALID_SCHEMA",
      `HumanReviewQueueItem.contractVersion must be "${TEST_INTELLIGENCE_CONTRACT_VERSION}", got "${contractVersion}"`,
    );
  }
  assertSafeSegment(item.itemId, "HumanReviewQueueItem.itemId");
  assertSafeSegment(item.tenantId, "HumanReviewQueueItem.tenantId");
  assertSafeSegment(item.profileId, "HumanReviewQueueItem.profileId");
  assertSafeSegment(item.runId, "HumanReviewQueueItem.runId");
  const testCaseId: string = item.testCaseId;
  if (typeof testCaseId !== "string" || testCaseId.length === 0) {
    fail(
      "E_INVALID_FIELD",
      "HumanReviewQueueItem.testCaseId must be a non-empty string",
    );
  }
  assertIso8601(item.enqueuedAt, "HumanReviewQueueItem.enqueuedAt");
  assertIso8601(item.slaDeadlineAt, "HumanReviewQueueItem.slaDeadlineAt");
  if (item.slaDeadlineAt < item.enqueuedAt) {
    fail(
      "E_INVALID_SLA",
      `HumanReviewQueueItem.slaDeadlineAt (${item.slaDeadlineAt}) must be >= enqueuedAt (${item.enqueuedAt})`,
    );
  }
  const proposedDecision: string = item.proposedDecision;
  if (typeof proposedDecision !== "string") {
    fail(
      "E_INVALID_FIELD",
      "HumanReviewQueueItem.proposedDecision must be a TestCasePolicyDecision string",
    );
  }
  const snapshot = item.judgeDisagreement as unknown as
    | JudgeDisagreementSnapshot
    | null
    | undefined;
  if (
    typeof snapshot !== "object" ||
    snapshot === null ||
    typeof snapshot.disagreementRate !== "number" ||
    !Number.isFinite(snapshot.disagreementRate) ||
    snapshot.disagreementRate < 0 ||
    snapshot.disagreementRate > 1
  ) {
    fail(
      "E_INVALID_FIELD",
      "HumanReviewQueueItem.judgeDisagreement.disagreementRate must be a finite number in [0,1]",
    );
    return;
  }
  if (!Array.isArray(snapshot.judges)) {
    fail(
      "E_INVALID_FIELD",
      "HumanReviewQueueItem.judgeDisagreement.judges must be an array",
    );
  }
};

/**
 * Validate the structural shape of a {@link HumanReviewVerdict} and verify
 * its detached ed25519 signature. Throws on any structural violation or
 * if the signature does not match the canonical-JSON of the verdict body.
 */
export const assertHumanReviewVerdictInvariants = (
  verdict: HumanReviewVerdict,
): void => {
  const schemaVersion: string = verdict.schemaVersion;
  if (schemaVersion !== HUMAN_REVIEW_VERDICT_SCHEMA_VERSION) {
    fail(
      "E_INVALID_SCHEMA",
      `HumanReviewVerdict.schemaVersion must be "${HUMAN_REVIEW_VERDICT_SCHEMA_VERSION}", got "${schemaVersion}"`,
    );
  }
  const contractVersion: string = verdict.contractVersion;
  if (contractVersion !== TEST_INTELLIGENCE_CONTRACT_VERSION) {
    fail(
      "E_INVALID_SCHEMA",
      `HumanReviewVerdict.contractVersion must be "${TEST_INTELLIGENCE_CONTRACT_VERSION}", got "${contractVersion}"`,
    );
  }
  assertSafeSegment(verdict.itemId, "HumanReviewVerdict.itemId");
  assertVerdictLabel(verdict.verdict, "HumanReviewVerdict.verdict");
  assertRationale(verdict.rationale, "HumanReviewVerdict.rationale");
  assertIso8601(verdict.decidedAt, "HumanReviewVerdict.decidedAt");
  if (!isHex(verdict.reviewerPrincipalHash, 64)) {
    fail(
      "E_INVALID_FIELD",
      `HumanReviewVerdict.reviewerPrincipalHash must be 64 lowercase hex chars (sha256), got "${verdict.reviewerPrincipalHash}"`,
    );
  }
  if (!isHex(verdict.signatureHex, 128)) {
    fail(
      "E_INVALID_SIGNATURE",
      `HumanReviewVerdict.signatureHex must be 128 lowercase hex chars (ed25519 detached), got "${verdict.signatureHex}"`,
    );
  }
  if (!isHex(verdict.publicKeyFingerprintSha256, 64)) {
    fail(
      "E_INVALID_FIELD",
      `HumanReviewVerdict.publicKeyFingerprintSha256 must be 64 lowercase hex chars (sha256)`,
    );
  }
  if (
    typeof verdict.publicKeyPem !== "string" ||
    !verdict.publicKeyPem.includes("BEGIN PUBLIC KEY")
  ) {
    fail(
      "E_INVALID_FIELD",
      "HumanReviewVerdict.publicKeyPem must be a PEM-encoded SPKI public key",
    );
  }
  if (verdict.verdict !== "revised" && verdict.revisedTestCase !== undefined) {
    fail(
      "E_INVALID_FIELD",
      'HumanReviewVerdict.revisedTestCase is only allowed when verdict === "revised"',
    );
  }
  if (verdict.verdict === "revised") {
    const revised = verdict.revisedTestCase as unknown;
    if (
      typeof revised !== "object" ||
      revised === null ||
      Array.isArray(revised)
    ) {
      fail(
        "E_INVALID_FIELD",
        'HumanReviewVerdict.revisedTestCase must be a JSON object when verdict === "revised"',
      );
    }
  }
};

const verdictBodyForSigning = (
  verdict: Omit<HumanReviewVerdict, "signatureHex">,
): string => canonicalJson(verdict);

/**
 * Compute the canonical message bytes the reviewer's signature must
 * cover for the given verdict body. Exposed so the CLI / UI can
 * compute the signature payload off-line, hand it to a hardware key,
 * and submit the resulting signature without ever sending the
 * private key over the wire.
 */
export const buildVerdictSigningPayload = (
  verdictWithoutSignature: Omit<HumanReviewVerdict, "signatureHex">,
): Uint8Array => new TextEncoder().encode(verdictBodyForSigning(verdictWithoutSignature));

const importPublicKey = (publicKeyPem: string): KeyObject => {
  try {
    return createPublicKey({ key: publicKeyPem, format: "pem" });
  } catch (err) {
    fail(
      "E_INVALID_KEY",
      `HumanReviewVerdict.publicKeyPem could not be parsed as a PEM-encoded SPKI key: ${(err as Error).message}`,
    );
    /* istanbul ignore next — fail throws */
    throw err;
  }
};

const verifyVerdictSignature = (verdict: HumanReviewVerdict): void => {
  const publicKey = importPublicKey(verdict.publicKeyPem);
  if (publicKey.asymmetricKeyType !== "ed25519") {
    fail(
      "E_INVALID_KEY",
      `HumanReviewVerdict.publicKeyPem must encode an ed25519 key, got "${publicKey.asymmetricKeyType}"`,
    );
  }
  const spkiDer = publicKey.export({ format: "der", type: "spki" }) as Buffer;
  const fingerprint = sha256Hex(
    new Uint8Array(spkiDer.buffer, spkiDer.byteOffset, spkiDer.byteLength),
  );
  if (fingerprint !== verdict.publicKeyFingerprintSha256) {
    fail(
      "E_KEY_FINGERPRINT_MISMATCH",
      `HumanReviewVerdict.publicKeyFingerprintSha256 (${verdict.publicKeyFingerprintSha256}) does not match the SPKI sha256 of the supplied PEM (${fingerprint})`,
    );
  }
  const { signatureHex: _omitted, ...body } = verdict;
  void _omitted;
  const payload = buildVerdictSigningPayload(body);
  const signatureBytes = Buffer.from(verdict.signatureHex, "hex");
  const ok = cryptoVerify(null, payload, publicKey, signatureBytes);
  if (!ok) {
    fail(
      "E_SIGNATURE_INVALID",
      `HumanReviewVerdict.signatureHex did not verify against the supplied ed25519 public key`,
    );
  }
};

const writeAtomicJson = async (path: string, value: unknown): Promise<void> => {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  await writeFile(tmp, canonicalJson(value), "utf8");
  await rename(tmp, path);
};

const readJsonFile = async <T>(path: string): Promise<T> => {
  const raw = await readFile(path, "utf8");
  return JSON.parse(raw) as T;
};

const exists = async (path: string): Promise<boolean> => {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
};

/** Per-tenant directory layout for the on-disk queue. */
export interface HumanReviewQueueLayout {
  readonly tenantRoot: string;
  readonly queueDir: string;
  readonly verdictsDir: string;
  readonly runsDir: string;
}

const resolveLayout = (
  rootDir: string,
  tenantId: string,
): HumanReviewQueueLayout => {
  assertSafeSegment(tenantId, "tenantId");
  const tenantRoot = resolve(join(rootDir, tenantId));
  return {
    tenantRoot,
    queueDir: join(tenantRoot, "queue"),
    verdictsDir: join(tenantRoot, "verdicts"),
    runsDir: join(tenantRoot, "runs"),
  };
};

const queueItemPath = (layout: HumanReviewQueueLayout, itemId: string): string => {
  assertSafeSegment(itemId, "itemId");
  return join(layout.queueDir, `${itemId}.json`);
};

const verdictPath = (layout: HumanReviewQueueLayout, itemId: string): string => {
  assertSafeSegment(itemId, "itemId");
  return join(layout.verdictsDir, `${itemId}.json`);
};

const runLogPath = (layout: HumanReviewQueueLayout, runId: string): string => {
  assertSafeSegment(runId, "runId");
  return join(layout.runsDir, `${runId}.log.json`);
};

/**
 * Backing store for the queue. The default implementation persists
 * canonical-JSON files to a tenant-partitioned directory; tests can
 * supply an in-memory map by using {@link createInMemoryQueueStore}.
 */
export interface HumanReviewQueueStore {
  enqueue(item: HumanReviewQueueItem): Promise<void>;
  fetchPending(filter: HumanReviewFilter): Promise<readonly HumanReviewQueueItem[]>;
  getItem(tenantId: string, itemId: string): Promise<HumanReviewQueueItem | undefined>;
  /**
   * Persist a signed verdict alongside its queue item. When `tenantId`
   * is supplied the lookup is constrained to that tenant's partition;
   * otherwise the store falls back to scanning every tenant directory
   * (legacy callers that did not yet thread tenant through).
   */
  recordVerdict(
    verdict: HumanReviewVerdict,
    tenantId?: string,
  ): Promise<HumanReviewQueueItem>;
  loadRunLog(tenantId: string, runId: string): Promise<HumanReviewLog | undefined>;
  writeRunLog(log: HumanReviewLog): Promise<string>;
  loadVerdictsForRun(
    tenantId: string,
    runId: string,
  ): Promise<readonly HumanReviewVerdict[]>;
  findSlaBreaches(
    tenantId: string,
    nowIso: string,
  ): Promise<readonly HumanReviewSlaBreachEntry[]>;
}

interface FilesystemQueueStoreOptions {
  readonly rootDir: string;
}

/**
 * Create the default filesystem-backed queue store. Each tenant's data
 * lives under `<rootDir>/<tenantId>/{queue,verdicts,runs}/`.
 */
export const createFilesystemQueueStore = (
  options: FilesystemQueueStoreOptions,
): HumanReviewQueueStore => {
  const rootDir = resolve(options.rootDir);

  const enqueue = async (item: HumanReviewQueueItem): Promise<void> => {
    assertHumanReviewQueueItemInvariants(item);
    const layout = resolveLayout(rootDir, item.tenantId);
    const path = queueItemPath(layout, item.itemId);
    if (await exists(path)) {
      // Idempotent: if the existing item is byte-identical, accept it.
      const existing = await readJsonFile<HumanReviewQueueItem>(path);
      if (canonicalJson(existing) !== canonicalJson(item)) {
        fail(
          "E_QUEUE_ITEM_ALREADY_EXISTS",
          `queue item "${item.itemId}" already exists for tenant "${item.tenantId}" with a different payload`,
        );
      }
      return;
    }
    await writeAtomicJson(path, item);
  };

  const matchesFilter = (
    item: HumanReviewQueueItem,
    filter: HumanReviewFilter,
  ): boolean => {
    if (item.tenantId !== filter.tenantId) return false;
    if (filter.profileId !== undefined && item.profileId !== filter.profileId) {
      return false;
    }
    if (filter.slaDueBy !== undefined && item.slaDeadlineAt > filter.slaDueBy) {
      return false;
    }
    return true;
  };

  const listQueueDir = async (
    layout: HumanReviewQueueLayout,
  ): Promise<readonly HumanReviewQueueItem[]> => {
    if (!(await exists(layout.queueDir))) return [];
    const names = await readdir(layout.queueDir);
    const items: HumanReviewQueueItem[] = [];
    for (const name of names.sort()) {
      if (!name.endsWith(".json")) continue;
      const item = await readJsonFile<HumanReviewQueueItem>(
        join(layout.queueDir, name),
      );
      assertHumanReviewQueueItemInvariants(item);
      items.push(item);
    }
    return items;
  };

  const fetchPending = async (
    filter: HumanReviewFilter,
  ): Promise<readonly HumanReviewQueueItem[]> => {
    if (filter.slaDueBy !== undefined) {
      assertIso8601(filter.slaDueBy, "HumanReviewFilter.slaDueBy");
    }
    const layout = resolveLayout(rootDir, filter.tenantId);
    const items = await listQueueDir(layout);
    // "Pending" excludes items that already carry a recorded verdict —
    // queue entries are immutable on disk for the audit trail, so the
    // verdict file's presence is the authoritative "decided" signal.
    const undecided: HumanReviewQueueItem[] = [];
    for (const item of items) {
      if (!matchesFilter(item, filter)) continue;
      if (await exists(verdictPath(layout, item.itemId))) continue;
      undecided.push(item);
    }
    return undecided.sort((a, b) => a.itemId.localeCompare(b.itemId));
  };

  const getItem = async (
    tenantId: string,
    itemId: string,
  ): Promise<HumanReviewQueueItem | undefined> => {
    const layout = resolveLayout(rootDir, tenantId);
    const path = queueItemPath(layout, itemId);
    if (!(await exists(path))) return undefined;
    const item = await readJsonFile<HumanReviewQueueItem>(path);
    assertHumanReviewQueueItemInvariants(item);
    return item;
  };

  const loadRunLog = async (
    tenantId: string,
    runId: string,
  ): Promise<HumanReviewLog | undefined> => {
    const layout = resolveLayout(rootDir, tenantId);
    const path = runLogPath(layout, runId);
    if (!(await exists(path))) return undefined;
    return readJsonFile<HumanReviewLog>(path);
  };

  const writeRunLog = async (log: HumanReviewLog): Promise<string> => {
    const logSchemaVersion: string = log.schemaVersion;
    if (logSchemaVersion !== HUMAN_REVIEW_LOG_SCHEMA_VERSION) {
      fail(
        "E_INVALID_SCHEMA",
        `HumanReviewLog.schemaVersion must be "${HUMAN_REVIEW_LOG_SCHEMA_VERSION}"`,
      );
    }
    const logContractVersion: string = log.contractVersion;
    if (logContractVersion !== TEST_INTELLIGENCE_CONTRACT_VERSION) {
      fail(
        "E_INVALID_SCHEMA",
        `HumanReviewLog.contractVersion must be "${TEST_INTELLIGENCE_CONTRACT_VERSION}"`,
      );
    }
    const layout = resolveLayout(rootDir, log.tenantId);
    const path = runLogPath(layout, log.jobId);
    const sortedItems = [...log.items].sort((a, b) =>
      a.itemId.localeCompare(b.itemId),
    );
    const sortedVerdicts = [...log.verdicts].sort((a, b) =>
      a.itemId.localeCompare(b.itemId),
    );
    const sortedBreaches = [...log.slaBreaches].sort((a, b) =>
      a.itemId.localeCompare(b.itemId),
    );
    const canonical: HumanReviewLog = {
      ...log,
      items: sortedItems,
      verdicts: sortedVerdicts,
      slaBreaches: sortedBreaches,
    };
    await writeAtomicJson(path, canonical);
    return path;
  };

  const loadVerdictsForRun = async (
    tenantId: string,
    runId: string,
  ): Promise<readonly HumanReviewVerdict[]> => {
    assertSafeSegment(runId, "runId");
    const layout = resolveLayout(rootDir, tenantId);
    if (!(await exists(layout.verdictsDir))) return [];
    const names = await readdir(layout.verdictsDir);
    const collected: HumanReviewVerdict[] = [];
    for (const name of names.sort()) {
      if (!name.endsWith(".json")) continue;
      const verdict = await readJsonFile<HumanReviewVerdict>(
        join(layout.verdictsDir, name),
      );
      assertHumanReviewVerdictInvariants(verdict);
      // Match the verdict to the queue item by itemId to filter by runId.
      const item = await getItem(tenantId, verdict.itemId);
      if (item !== undefined && item.runId === runId) {
        collected.push(verdict);
      }
    }
    return collected.sort((a, b) => a.itemId.localeCompare(b.itemId));
  };

  const findSlaBreaches = async (
    tenantId: string,
    nowIso: string,
  ): Promise<readonly HumanReviewSlaBreachEntry[]> => {
    assertIso8601(nowIso, "findSlaBreaches.nowIso");
    const layout = resolveLayout(rootDir, tenantId);
    const items = await listQueueDir(layout);
    const breaches: HumanReviewSlaBreachEntry[] = [];
    for (const item of items) {
      if (item.slaDeadlineAt < nowIso) {
        // Items that already have a verdict do not breach.
        const vp = verdictPath(layout, item.itemId);
        if (await exists(vp)) continue;
        breaches.push({
          itemId: item.itemId,
          testCaseId: item.testCaseId,
          slaDeadlineAt: item.slaDeadlineAt,
          observedAt: nowIso,
        });
      }
    }
    return breaches.sort((a, b) => a.itemId.localeCompare(b.itemId));
  };

  const recordVerdict = async (
    verdict: HumanReviewVerdict,
    tenantId?: string,
  ): Promise<HumanReviewQueueItem> => {
    assertHumanReviewVerdictInvariants(verdict);
    verifyVerdictSignature(verdict);
    // Locate the queue item under the supplied tenant (preferred) or by
    // scanning every tenant directory as a backwards-compatible fallback.
    // Only single-segment values pass `SAFE_PATH_SEGMENT`, so directory
    // names can never escape the queue root.
    const tenantNames =
      tenantId !== undefined
        ? (assertSafeSegment(tenantId, "tenantId"), [tenantId])
        : (await readdir(rootDir).catch(() => [] as string[]))
            .filter((name) => SAFE_PATH_SEGMENT.test(name))
            .sort();
    for (const tenant of tenantNames) {
      const layout = resolveLayout(rootDir, tenant);
      const itemPath = queueItemPath(layout, verdict.itemId);
      if (!(await exists(itemPath))) continue;
      const item = await readJsonFile<HumanReviewQueueItem>(itemPath);
      assertHumanReviewQueueItemInvariants(item);
      const target = verdictPath(layout, verdict.itemId);
      // Append-only audit trail: refuse to overwrite an existing
      // verdict with different bytes. Idempotent re-submission of the
      // same canonical verdict is accepted (network retries, manual
      // re-runs of `ti review decide` with the same inputs).
      if (await exists(target)) {
        const existing = await readJsonFile<HumanReviewVerdict>(target);
        if (canonicalJson(existing) !== canonicalJson(verdict)) {
          fail(
            "E_VERDICT_ALREADY_RECORDED",
            `verdict for item "${verdict.itemId}" is already recorded; verdicts are append-only`,
          );
        }
        return item;
      }
      await writeAtomicJson(target, verdict);
      return item;
    }
    fail(
      "E_QUEUE_ITEM_NOT_FOUND",
      tenantId !== undefined
        ? `queue item "${verdict.itemId}" not found for tenant "${tenantId}"`
        : `queue item "${verdict.itemId}" not found in any tenant under root "${rootDir}"`,
    );
    /* istanbul ignore next — fail throws */
    throw new Error("unreachable");
  };

  return {
    enqueue,
    fetchPending,
    getItem,
    loadRunLog,
    writeRunLog,
    loadVerdictsForRun,
    findSlaBreaches,
    recordVerdict,
  };
};

/**
 * Convenience top-level wrapper around the filesystem store. Most
 * callers (CLI, HTTP route, tests) will use these helpers and pass the
 * queue root via `rootDir`.
 */
export const enqueueHumanReview = (
  rootDir: string,
  item: HumanReviewQueueItem,
): Promise<void> =>
  createFilesystemQueueStore({ rootDir }).enqueue(item);

export const fetchPendingReviews = (
  rootDir: string,
  filter: HumanReviewFilter,
): Promise<readonly HumanReviewQueueItem[]> =>
  createFilesystemQueueStore({ rootDir }).fetchPending(filter);

export const recordHumanReviewVerdict = (
  rootDir: string,
  verdict: HumanReviewVerdict,
  tenantId?: string,
): Promise<HumanReviewQueueItem> =>
  createFilesystemQueueStore({ rootDir }).recordVerdict(verdict, tenantId);

export const getHumanReviewQueueItem = (
  rootDir: string,
  tenantId: string,
  itemId: string,
): Promise<HumanReviewQueueItem | undefined> =>
  createFilesystemQueueStore({ rootDir }).getItem(tenantId, itemId);

export const loadHumanReviewVerdictsForRun = (
  rootDir: string,
  tenantId: string,
  runId: string,
): Promise<readonly HumanReviewVerdict[]> =>
  createFilesystemQueueStore({ rootDir }).loadVerdictsForRun(tenantId, runId);

export const findHumanReviewSlaBreaches = (
  rootDir: string,
  tenantId: string,
  nowIso: string,
): Promise<readonly HumanReviewSlaBreachEntry[]> =>
  createFilesystemQueueStore({ rootDir }).findSlaBreaches(tenantId, nowIso);

/**
 * Build a per-run audit log from the queue contents. Resolves verdicts
 * by `runId`, computes SLA breaches against `nowIso`, and emits a
 * canonical-JSON {@link HumanReviewLog}. Pure — does not write to disk.
 */
export const buildHumanReviewLog = async (input: {
  readonly rootDir: string;
  readonly tenantId: string;
  readonly jobId: string;
  readonly generatedAt: string;
  readonly nowIso: string;
}): Promise<HumanReviewLog> => {
  assertSafeSegment(input.tenantId, "tenantId");
  assertSafeSegment(input.jobId, "jobId");
  assertIso8601(input.generatedAt, "generatedAt");
  assertIso8601(input.nowIso, "nowIso");
  const store = createFilesystemQueueStore({ rootDir: input.rootDir });
  const layout = resolveLayout(resolve(input.rootDir), input.tenantId);
  const items = (await listQueueDirOrEmpty(layout)).filter(
    (item) => item.runId === input.jobId,
  );
  const verdicts = await store.loadVerdictsForRun(input.tenantId, input.jobId);
  const breaches = await store.findSlaBreaches(input.tenantId, input.nowIso);
  return Object.freeze({
    schemaVersion: HUMAN_REVIEW_LOG_SCHEMA_VERSION,
    contractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
    jobId: input.jobId,
    tenantId: input.tenantId,
    generatedAt: input.generatedAt,
    items: Object.freeze([...items].sort((a, b) => a.itemId.localeCompare(b.itemId))),
    verdicts: Object.freeze([...verdicts].sort((a, b) => a.itemId.localeCompare(b.itemId))),
    slaBreaches: Object.freeze(
      [...breaches].sort((a, b) => a.itemId.localeCompare(b.itemId)),
    ),
  });
};

const listQueueDirOrEmpty = async (
  layout: HumanReviewQueueLayout,
): Promise<readonly HumanReviewQueueItem[]> => {
  if (!(await exists(layout.queueDir))) return [];
  const names = await readdir(layout.queueDir);
  const out: HumanReviewQueueItem[] = [];
  for (const name of names.sort()) {
    if (!name.endsWith(".json")) continue;
    const item = await readJsonFile<HumanReviewQueueItem>(
      join(layout.queueDir, name),
    );
    assertHumanReviewQueueItemInvariants(item);
    out.push(item);
  }
  return out;
};

/**
 * Compute a {@link HumanReviewQueueItem.itemId} that is stable across
 * replays of the same logical case. The id is sha256(tenantId + runId +
 * testCaseId) truncated to 32 hex chars — long enough to make collisions
 * astronomically unlikely while keeping the on-disk filename short.
 */
export const computeHumanReviewItemId = (input: {
  readonly tenantId: string;
  readonly runId: string;
  readonly testCaseId: string;
}): string => {
  if (
    typeof input.tenantId !== "string" ||
    input.tenantId.length === 0 ||
    typeof input.runId !== "string" ||
    input.runId.length === 0 ||
    typeof input.testCaseId !== "string" ||
    input.testCaseId.length === 0
  ) {
    fail(
      "E_INVALID_FIELD",
      "computeHumanReviewItemId: tenantId, runId, testCaseId must be non-empty strings",
    );
  }
  return sha256Hex(
    canonicalJson({
      tenantId: input.tenantId,
      runId: input.runId,
      testCaseId: input.testCaseId,
    }),
  ).slice(0, 32);
};

/** sha256 hex of an arbitrary stable reviewer principal id. */
export const hashReviewerPrincipalId = (principalId: string): string => {
  if (typeof principalId !== "string" || principalId.length === 0) {
    fail(
      "E_INVALID_FIELD",
      "hashReviewerPrincipalId: principalId must be a non-empty string",
    );
  }
  return sha256Hex(principalId);
};

/**
 * Build the on-disk policy warning that the next run should surface
 * for an SLA-breached queue item. Pure helper — wired into
 * `policy-gate.ts` consumers via {@link findSlaBreaches}.
 */
export const buildSlaBreachPolicyWarning = (
  breach: HumanReviewSlaBreachEntry,
): {
  readonly rule: HumanReviewPolicyWarningRule;
  readonly outcome: "human_review_sla_breach";
  readonly severity: "warning";
  readonly reason: string;
} =>
  Object.freeze({
    rule: HUMAN_REVIEW_POLICY_WARNING_RULES[0],
    outcome: "human_review_sla_breach",
    severity: "warning",
    reason: `human-review item ${breach.itemId} for case ${breach.testCaseId} missed SLA deadline ${breach.slaDeadlineAt} (observed ${breach.observedAt})`,
  });
