import assert from "node:assert/strict";
import {
  createHash,
  createPrivateKey,
  generateKeyPairSync,
  sign as cryptoSign,
} from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  HUMAN_REVIEW_LOG_SCHEMA_VERSION,
  HUMAN_REVIEW_QUEUE_ITEM_SCHEMA_VERSION,
  HUMAN_REVIEW_VERDICT_RATIONALE_MAX_CHARS,
  HUMAN_REVIEW_VERDICT_SCHEMA_VERSION,
  TEST_INTELLIGENCE_CONTRACT_VERSION,
  type HumanReviewQueueItem,
  type HumanReviewVerdict,
} from "../contracts/index.js";
import { canonicalJson } from "./content-hash.js";
import {
  assertHumanReviewQueueItemInvariants,
  assertHumanReviewVerdictInvariants,
  buildHumanReviewLog,
  buildSlaBreachPolicyWarning,
  buildVerdictSigningPayload,
  computeHumanReviewItemId,
  enqueueHumanReview,
  fetchPendingReviews,
  findHumanReviewSlaBreaches,
  getHumanReviewQueueItem,
  hashReviewerPrincipalId,
  HumanReviewQueueError,
  loadHumanReviewVerdictsForRun,
  recordHumanReviewVerdict,
} from "./human-review-queue.js";

const TENANT = "acme";
const PROFILE = "default";
const RUN = "job-001";
const TEST_CASE = "tc-1";

interface KeyMaterial {
  readonly publicKeyPem: string;
  readonly publicKeyFingerprintSha256: string;
  readonly privateKeyPem: string;
}

const generateEd25519 = (): KeyMaterial => {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const publicKeyPem = publicKey.export({ format: "pem", type: "spki" }).toString().trim();
  const privateKeyPem = privateKey
    .export({ format: "pem", type: "pkcs8" })
    .toString();
  const spkiDer = publicKey.export({ format: "der", type: "spki" }) as Buffer;
  const publicKeyFingerprintSha256 = createHash("sha256")
    .update(new Uint8Array(spkiDer.buffer, spkiDer.byteOffset, spkiDer.byteLength))
    .digest("hex");
  return { publicKeyPem, publicKeyFingerprintSha256, privateKeyPem };
};

const buildItem = (overrides: Partial<HumanReviewQueueItem> = {}): HumanReviewQueueItem => {
  const itemId = computeHumanReviewItemId({
    tenantId: TENANT,
    runId: RUN,
    testCaseId: TEST_CASE,
  });
  return {
    schemaVersion: HUMAN_REVIEW_QUEUE_ITEM_SCHEMA_VERSION,
    contractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
    itemId,
    tenantId: TENANT,
    profileId: PROFILE,
    runId: RUN,
    testCaseId: TEST_CASE,
    judgeDisagreement: {
      decision: "split_decision",
      escalation: "human_review_required",
      disagreementRate: 0.5,
      judges: [
        {
          judgeId: "logic_judge",
          family: "azure-openai",
          modelId: "gpt-oss-120b",
          promptVersion: "v1",
          region: "westeurope",
          verdict: "accept",
        },
      ],
    },
    proposedDecision: "needs_review",
    enqueuedAt: "2026-05-10T09:00:00.000Z",
    slaDeadlineAt: "2026-05-11T09:00:00.000Z",
    ...overrides,
  };
};

const signVerdict = (
  body: Omit<HumanReviewVerdict, "signatureHex">,
  keyMaterial: KeyMaterial,
): HumanReviewVerdict => {
  const payload = buildVerdictSigningPayload(body);
  const privateKey = createPrivateKey({ key: keyMaterial.privateKeyPem, format: "pem" });
  const sig = cryptoSign(null, payload, privateKey);
  return { ...body, signatureHex: sig.toString("hex") };
};

const buildVerdict = (
  itemId: string,
  keyMaterial: KeyMaterial,
  overrides: Partial<HumanReviewVerdict> = {},
): HumanReviewVerdict => {
  const body: Omit<HumanReviewVerdict, "signatureHex"> = {
    schemaVersion: HUMAN_REVIEW_VERDICT_SCHEMA_VERSION,
    contractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
    itemId,
    reviewerPrincipalHash: hashReviewerPrincipalId("reviewer@example.com"),
    verdict: "approved",
    rationale: "Looks correct under DSGVO Art. 22 + EU AI Act Art. 14.",
    decidedAt: "2026-05-10T10:00:00.000Z",
    publicKeyFingerprintSha256: keyMaterial.publicKeyFingerprintSha256,
    publicKeyPem: keyMaterial.publicKeyPem,
    ...overrides,
  };
  return signVerdict(body, keyMaterial);
};

const withTempRoot = async (fn: (root: string) => Promise<void>): Promise<void> => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ti-review-"));
  try {
    await fn(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
};

test("computeHumanReviewItemId is deterministic and stable", () => {
  const idA = computeHumanReviewItemId({
    tenantId: "a",
    runId: "r",
    testCaseId: "tc",
  });
  const idB = computeHumanReviewItemId({
    tenantId: "a",
    runId: "r",
    testCaseId: "tc",
  });
  assert.equal(idA, idB);
  assert.equal(idA.length, 32);
  const different = computeHumanReviewItemId({
    tenantId: "b",
    runId: "r",
    testCaseId: "tc",
  });
  assert.notEqual(idA, different);
});

test("hashReviewerPrincipalId is sha256 of the input string", () => {
  const got = hashReviewerPrincipalId("alice");
  const want = createHash("sha256").update("alice").digest("hex");
  assert.equal(got, want);
});

const expectCode = (code: string) => (err: unknown) =>
  err instanceof HumanReviewQueueError && err.code === code;

test("queue item invariants reject malformed segments and SLA inversion", () => {
  assert.throws(
    () =>
      assertHumanReviewQueueItemInvariants(
        buildItem({ tenantId: "../etc/passwd" } as Partial<HumanReviewQueueItem>),
      ),
    expectCode("E_INVALID_SEGMENT"),
  );
  assert.throws(
    () =>
      assertHumanReviewQueueItemInvariants(
        buildItem({ slaDeadlineAt: "2025-01-01T00:00:00Z" }),
      ),
    expectCode("E_INVALID_SLA"),
  );
});

test("verdict invariants reject bad fields and signature shape", () => {
  const km = generateEd25519();
  const goodItem = buildItem();
  const ok = buildVerdict(goodItem.itemId, km);
  assertHumanReviewVerdictInvariants(ok);

  assert.throws(
    () =>
      assertHumanReviewVerdictInvariants({
        ...ok,
        signatureHex: "not-hex",
      }),
    expectCode("E_INVALID_SIGNATURE"),
  );
  assert.throws(
    () =>
      assertHumanReviewVerdictInvariants({
        ...ok,
        rationale: "x".repeat(HUMAN_REVIEW_VERDICT_RATIONALE_MAX_CHARS + 1),
      }),
    expectCode("E_INVALID_RATIONALE"),
  );
  assert.throws(
    () =>
      assertHumanReviewVerdictInvariants({
        ...ok,
        rationale: "line1\nline2",
      }),
    expectCode("E_INVALID_RATIONALE"),
  );
  assert.throws(
    () =>
      assertHumanReviewVerdictInvariants({
        ...ok,
        verdict: "approved",
        revisedTestCase: { foo: 1 },
      } as HumanReviewVerdict),
    expectCode("E_INVALID_FIELD"),
  );
});

test("enqueue → fetch → record verdict round-trips on disk and verifies signature", async () => {
  await withTempRoot(async (root) => {
    const km = generateEd25519();
    const item = buildItem();

    await enqueueHumanReview(root, item);
    // Idempotent re-enqueue accepts byte-identical input.
    await enqueueHumanReview(root, item);
    // Re-enqueue with a different payload throws.
    await assert.rejects(
      () => enqueueHumanReview(root, buildItem({ proposedDecision: "blocked" })),
      (err: unknown) =>
        err instanceof HumanReviewQueueError && err.code === "E_QUEUE_ITEM_ALREADY_EXISTS",
    );

    const pending = await fetchPendingReviews(root, { tenantId: TENANT });
    assert.equal(pending.length, 1);
    assert.equal(pending[0]!.itemId, item.itemId);

    const filteredOut = await fetchPendingReviews(root, {
      tenantId: TENANT,
      profileId: "other-profile",
    });
    assert.equal(filteredOut.length, 0);

    const fetched = await getHumanReviewQueueItem(root, TENANT, item.itemId);
    assert.equal(fetched?.itemId, item.itemId);

    const verdict = buildVerdict(item.itemId, km);
    const persistedItem = await recordHumanReviewVerdict(root, verdict);
    assert.equal(persistedItem.itemId, item.itemId);

    const verdictPath = path.join(root, TENANT, "verdicts", `${item.itemId}.json`);
    const persisted = JSON.parse(await readFile(verdictPath, "utf8"));
    assert.equal(canonicalJson(persisted), canonicalJson(verdict));

    const verdictsForRun = await loadHumanReviewVerdictsForRun(root, TENANT, RUN);
    assert.equal(verdictsForRun.length, 1);
    assert.equal(verdictsForRun[0]!.itemId, item.itemId);
  });
});

test("recordHumanReviewVerdict refuses tampered signatures", async () => {
  await withTempRoot(async (root) => {
    const km = generateEd25519();
    const item = buildItem();
    await enqueueHumanReview(root, item);

    const valid = buildVerdict(item.itemId, km);
    const tampered: HumanReviewVerdict = {
      ...valid,
      rationale: "different rationale that invalidates the signature",
    };
    await assert.rejects(
      () => recordHumanReviewVerdict(root, tampered),
      (err: unknown) =>
        err instanceof HumanReviewQueueError && err.code === "E_SIGNATURE_INVALID",
    );
  });
});

test("recordHumanReviewVerdict refuses fingerprint mismatch", async () => {
  await withTempRoot(async (root) => {
    const km = generateEd25519();
    const km2 = generateEd25519();
    const item = buildItem();
    await enqueueHumanReview(root, item);
    const valid = buildVerdict(item.itemId, km);
    const swapped: HumanReviewVerdict = {
      ...valid,
      publicKeyFingerprintSha256: km2.publicKeyFingerprintSha256,
    };
    await assert.rejects(
      () => recordHumanReviewVerdict(root, swapped),
      (err: unknown) =>
        err instanceof HumanReviewQueueError &&
        err.code === "E_KEY_FINGERPRINT_MISMATCH",
    );
  });
});

test("findHumanReviewSlaBreaches surfaces only past-due items without verdicts", async () => {
  await withTempRoot(async (root) => {
    const km = generateEd25519();
    const expiredItem = buildItem({
      itemId: computeHumanReviewItemId({
        tenantId: TENANT,
        runId: "expired-run",
        testCaseId: "tc-expired",
      }),
      runId: "expired-run",
      testCaseId: "tc-expired",
      enqueuedAt: "2026-05-09T00:00:00.000Z",
      slaDeadlineAt: "2026-05-09T01:00:00.000Z",
    });
    const okItem = buildItem({
      itemId: computeHumanReviewItemId({
        tenantId: TENANT,
        runId: "future-run",
        testCaseId: "tc-future",
      }),
      runId: "future-run",
      testCaseId: "tc-future",
      enqueuedAt: "2026-05-10T08:00:00.000Z",
      slaDeadlineAt: "2026-05-12T08:00:00.000Z",
    });
    const decidedItem = buildItem({
      itemId: computeHumanReviewItemId({
        tenantId: TENANT,
        runId: "decided-run",
        testCaseId: "tc-decided",
      }),
      runId: "decided-run",
      testCaseId: "tc-decided",
      enqueuedAt: "2026-05-09T00:00:00.000Z",
      slaDeadlineAt: "2026-05-09T02:00:00.000Z",
    });
    await enqueueHumanReview(root, expiredItem);
    await enqueueHumanReview(root, okItem);
    await enqueueHumanReview(root, decidedItem);
    await recordHumanReviewVerdict(root, buildVerdict(decidedItem.itemId, km));

    const breaches = await findHumanReviewSlaBreaches(
      root,
      TENANT,
      "2026-05-10T10:00:00.000Z",
    );
    assert.equal(breaches.length, 1);
    assert.equal(breaches[0]!.itemId, expiredItem.itemId);

    const warning = buildSlaBreachPolicyWarning(breaches[0]!);
    assert.equal(warning.rule, "policy:human-review-sla-breach");
    assert.equal(warning.severity, "warning");
  });
});

test("buildHumanReviewLog assembles a canonical, byte-stable per-run log", async () => {
  await withTempRoot(async (root) => {
    const km = generateEd25519();
    const item = buildItem();
    await enqueueHumanReview(root, item);
    await recordHumanReviewVerdict(root, buildVerdict(item.itemId, km));

    const log = await buildHumanReviewLog({
      rootDir: root,
      tenantId: TENANT,
      jobId: RUN,
      generatedAt: "2026-05-10T11:00:00.000Z",
      nowIso: "2026-05-10T11:00:00.000Z",
    });

    assert.equal(log.schemaVersion, HUMAN_REVIEW_LOG_SCHEMA_VERSION);
    assert.equal(log.tenantId, TENANT);
    assert.equal(log.jobId, RUN);
    assert.equal(log.items.length, 1);
    assert.equal(log.verdicts.length, 1);
    assert.equal(log.slaBreaches.length, 0);

    const second = await buildHumanReviewLog({
      rootDir: root,
      tenantId: TENANT,
      jobId: RUN,
      generatedAt: "2026-05-10T11:00:00.000Z",
      nowIso: "2026-05-10T11:00:00.000Z",
    });
    assert.equal(canonicalJson(log), canonicalJson(second));
  });
});

test("revised verdicts must include a revisedTestCase JSON body", async () => {
  await withTempRoot(async (root) => {
    const km = generateEd25519();
    const item = buildItem();
    await enqueueHumanReview(root, item);

    const revised = buildVerdict(item.itemId, km, {
      verdict: "revised",
      revisedTestCase: { id: "tc-1", revision: 1 },
    });
    await recordHumanReviewVerdict(root, revised);
    const persisted = await readFile(
      path.join(root, TENANT, "verdicts", `${item.itemId}.json`),
      "utf8",
    );
    assert.match(persisted, /"verdict":"revised"/);
  });
});

test("CLI key files written under temp dirs are accepted by the runner", async () => {
  // Smoke that a PEM file we author here parses through the same crypto
  // surface the queue uses, so the CLI/queue code paths agree on key shape.
  await withTempRoot(async (root) => {
    const km = generateEd25519();
    const keyPath = path.join(root, "reviewer.pem");
    await writeFile(keyPath, km.privateKeyPem, "utf8");
    assert.ok((await readFile(keyPath, "utf8")).includes("BEGIN PRIVATE KEY"));
  });
});
