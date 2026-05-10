import assert from "node:assert/strict";
import {
  createHash,
  createPrivateKey,
  generateKeyPairSync,
  sign as cryptoSign,
} from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  HUMAN_REVIEW_QUEUE_ITEM_SCHEMA_VERSION,
  HUMAN_REVIEW_VERDICT_SCHEMA_VERSION,
  TEST_INTELLIGENCE_CONTRACT_VERSION,
  type HumanReviewQueueItem,
  type HumanReviewVerdict,
} from "../contracts/index.js";
import {
  handleGetItem,
  handleListQueue,
  handlePostDecision,
} from "./human-review-http-routes.js";
import {
  buildVerdictSigningPayload,
  computeHumanReviewItemId,
  enqueueHumanReview,
  hashReviewerPrincipalId,
} from "./human-review-queue.js";

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

const buildItem = (
  overrides: Partial<HumanReviewQueueItem> = {},
): HumanReviewQueueItem => {
  const itemId = computeHumanReviewItemId({
    tenantId: "acme",
    runId: "job-001",
    testCaseId: "tc-1",
  });
  return {
    schemaVersion: HUMAN_REVIEW_QUEUE_ITEM_SCHEMA_VERSION,
    contractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
    itemId,
    tenantId: "acme",
    profileId: "default",
    runId: "job-001",
    testCaseId: "tc-1",
    judgeDisagreement: {
      decision: "split_decision",
      escalation: "human_review_required",
      disagreementRate: 0.5,
      judges: [],
    },
    proposedDecision: "needs_review",
    enqueuedAt: "2026-05-10T09:00:00.000Z",
    slaDeadlineAt: "2026-05-11T09:00:00.000Z",
    ...overrides,
  };
};

const signedVerdict = (
  itemId: string,
  km: KeyMaterial,
  overrides: Partial<HumanReviewVerdict> = {},
): HumanReviewVerdict => {
  const body: Omit<HumanReviewVerdict, "signatureHex"> = {
    schemaVersion: HUMAN_REVIEW_VERDICT_SCHEMA_VERSION,
    contractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
    itemId,
    reviewerPrincipalHash: hashReviewerPrincipalId("alice@example.com"),
    verdict: "approved",
    rationale: "approved per Art. 14 oversight checklist",
    decidedAt: "2026-05-10T10:00:00.000Z",
    publicKeyFingerprintSha256: km.publicKeyFingerprintSha256,
    publicKeyPem: km.publicKeyPem,
    ...overrides,
  };
  const payload = buildVerdictSigningPayload(body);
  const sig = cryptoSign(
    null,
    payload,
    createPrivateKey({ key: km.privateKeyPem, format: "pem" }),
  );
  return { ...body, signatureHex: sig.toString("hex") };
};

const withTempRoot = async (fn: (root: string) => Promise<void>): Promise<void> => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ti-routes-"));
  try {
    await fn(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
};

test("GET /queue requires tenant and returns the pending list", async () => {
  await withTempRoot(async (root) => {
    const noTenant = await handleListQueue(root, { tenant: "" });
    assert.equal(noTenant.status, 400);

    const item = buildItem();
    await enqueueHumanReview(root, item);

    const ok = await handleListQueue(root, { tenant: "acme" });
    assert.equal(ok.status, 200);
    const body = JSON.parse(ok.body) as { items: HumanReviewQueueItem[] };
    assert.equal(body.items.length, 1);
    assert.equal(body.items[0]!.itemId, item.itemId);
  });
});

test("GET /items/:id returns 404 when missing and 200 when present", async () => {
  await withTempRoot(async (root) => {
    const missing = await handleGetItem(root, {
      tenant: "acme",
      itemId: "deadbeef",
    });
    assert.equal(missing.status, 404);

    const item = buildItem();
    await enqueueHumanReview(root, item);

    const present = await handleGetItem(root, {
      tenant: "acme",
      itemId: item.itemId,
    });
    assert.equal(present.status, 200);
    const parsed = JSON.parse(present.body) as HumanReviewQueueItem;
    assert.equal(parsed.itemId, item.itemId);
  });
});

test("POST /decisions accepts a valid signed verdict and refuses tampered ones", async () => {
  await withTempRoot(async (root) => {
    const km = generateEd25519();
    const item = buildItem();
    await enqueueHumanReview(root, item);

    const verdict = signedVerdict(item.itemId, km);
    const ok = await handlePostDecision(root, { verdict });
    assert.equal(ok.status, 201);
    const okBody = JSON.parse(ok.body) as {
      recorded: { itemId: string; verdict: string };
    };
    assert.equal(okBody.recorded.itemId, item.itemId);
    assert.equal(okBody.recorded.verdict, "approved");

    const tampered = { ...verdict, rationale: "tampered" };
    const bad = await handlePostDecision(root, { verdict: tampered });
    // Verdict body changed → signature no longer verifies → 403.
    assert.equal(bad.status, 403);
  });
});

test("POST /decisions rejects malformed bodies with 400", async () => {
  await withTempRoot(async (root) => {
    const noBody = await handlePostDecision(root, {
      verdict: undefined as unknown as HumanReviewVerdict,
    });
    assert.equal(noBody.status, 400);
  });
});
