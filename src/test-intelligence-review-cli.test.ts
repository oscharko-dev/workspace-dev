import assert from "node:assert/strict";
import {
  generateKeyPairSync,
} from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  HUMAN_REVIEW_QUEUE_ITEM_SCHEMA_VERSION,
  TEST_INTELLIGENCE_CONTRACT_VERSION,
  type HumanReviewQueueItem,
} from "./contracts/index.js";
import {
  enqueueHumanReview,
  computeHumanReviewItemId,
} from "./test-intelligence/human-review-queue.js";
import {
  parseTestIntelligenceReviewDecideArgs,
  parseTestIntelligenceReviewGetArgs,
  parseTestIntelligenceReviewListArgs,
  runTestIntelligenceReviewDecideCommand,
  runTestIntelligenceReviewGetCommand,
  runTestIntelligenceReviewListCommand,
  TestIntelligenceReviewOperatorError,
} from "./test-intelligence-review-cli.js";

const collectingSink = () => {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    sink: {
      stdout: (m: string) => stdout.push(m),
      stderr: (m: string) => stderr.push(m),
    },
    stdout,
    stderr,
  };
};

const buildItem = (overrides: Partial<HumanReviewQueueItem> = {}): HumanReviewQueueItem => {
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

test("parseTestIntelligenceReviewListArgs: requires --tenant", () => {
  assert.throws(
    () => parseTestIntelligenceReviewListArgs([]),
    TestIntelligenceReviewOperatorError,
  );
  const ok = parseTestIntelligenceReviewListArgs(["--tenant", "acme"]);
  assert.equal(ok.tenant, "acme");
});

test("parseTestIntelligenceReviewListArgs: optional flags", () => {
  const ok = parseTestIntelligenceReviewListArgs([
    "--tenant",
    "acme",
    "--profile",
    "default",
    "--sla-due-by",
    "2026-05-11T00:00:00Z",
    "--root",
    "/tmp/root",
  ]);
  assert.equal(ok.profile, "default");
  assert.equal(ok.slaDueBy, "2026-05-11T00:00:00Z");
  assert.equal(ok.rootDir, "/tmp/root");
});

test("parseTestIntelligenceReviewListArgs: rejects unknown flag", () => {
  assert.throws(
    () => parseTestIntelligenceReviewListArgs(["--tenant", "acme", "--bogus"]),
    TestIntelligenceReviewOperatorError,
  );
});

test("parseTestIntelligenceReviewGetArgs: requires positional itemId and --tenant", () => {
  assert.throws(
    () => parseTestIntelligenceReviewGetArgs(["--tenant", "acme"]),
    TestIntelligenceReviewOperatorError,
  );
  assert.throws(
    () => parseTestIntelligenceReviewGetArgs(["the-id"]),
    TestIntelligenceReviewOperatorError,
  );
  const ok = parseTestIntelligenceReviewGetArgs(["the-id", "--tenant", "acme"]);
  assert.equal(ok.itemId, "the-id");
  assert.equal(ok.tenant, "acme");
});

test("parseTestIntelligenceReviewDecideArgs: validates verdict + flag dependencies", () => {
  assert.throws(
    () =>
      parseTestIntelligenceReviewDecideArgs([
        "the-id",
        "--tenant",
        "acme",
        "--verdict",
        "bogus",
        "--rationale",
        "/tmp/r.md",
        "--sign-key",
        "/tmp/k.pem",
        "--decided-at",
        "2026-05-10T10:00:00Z",
      ]),
    TestIntelligenceReviewOperatorError,
  );
  assert.throws(
    () =>
      parseTestIntelligenceReviewDecideArgs([
        "the-id",
        "--tenant",
        "acme",
        "--verdict",
        "approved",
        "--rationale",
        "/tmp/r.md",
        "--sign-key",
        "/tmp/k.pem",
        "--decided-at",
        "2026-05-10T10:00:00Z",
        "--revised-tc",
        "/tmp/tc.json",
      ]),
    TestIntelligenceReviewOperatorError,
  );
  assert.throws(
    () =>
      parseTestIntelligenceReviewDecideArgs([
        "the-id",
        "--tenant",
        "acme",
        "--verdict",
        "revised",
        "--rationale",
        "/tmp/r.md",
        "--sign-key",
        "/tmp/k.pem",
        "--decided-at",
        "2026-05-10T10:00:00Z",
      ]),
    TestIntelligenceReviewOperatorError,
  );

  const ok = parseTestIntelligenceReviewDecideArgs([
    "the-id",
    "--tenant",
    "acme",
    "--verdict",
    "approved",
    "--rationale",
    "/tmp/r.md",
    "--sign-key",
    "/tmp/k.pem",
    "--decided-at",
    "2026-05-10T10:00:00Z",
  ]);
  assert.equal(ok.verdict, "approved");
});

test("runTestIntelligenceReviewListCommand: emits empty items list when queue is empty", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ti-review-cli-"));
  try {
    const { sink, stdout } = collectingSink();
    const code = await runTestIntelligenceReviewListCommand(
      { tenant: "acme", rootDir: root },
      sink,
    );
    assert.equal(code, 0);
    const out = JSON.parse(stdout.join("")) as { items: unknown[] };
    assert.deepEqual(out.items, []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("runTestIntelligenceReviewGetCommand: 404-style stderr when item missing", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ti-review-cli-"));
  try {
    const { sink, stderr } = collectingSink();
    const code = await runTestIntelligenceReviewGetCommand(
      { itemId: "missing", tenant: "acme", rootDir: root },
      sink,
    );
    assert.equal(code, 2);
    assert.match(stderr.join(""), /not found/u);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("runTestIntelligenceReviewDecideCommand: end-to-end signs + persists with a generated ed25519 key", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ti-review-cli-"));
  try {
    const item = buildItem();
    await enqueueHumanReview(root, item);
    const { privateKey } = generateKeyPairSync("ed25519");
    const pem = privateKey
      .export({ format: "pem", type: "pkcs8" })
      .toString();
    const keyPath = path.join(root, "reviewer.pem");
    await writeFile(keyPath, pem, "utf8");
    const rationalePath = path.join(root, "rationale.md");
    await writeFile(
      rationalePath,
      "Reviewer confirms the test case is valid under DSGVO Art. 22 and EU AI Act Art. 14.",
      "utf8",
    );

    const { sink, stdout } = collectingSink();
    const code = await runTestIntelligenceReviewDecideCommand(
      {
        itemId: item.itemId,
        tenant: "acme",
        verdict: "approved",
        rationaleFile: rationalePath,
        signKeyPath: keyPath,
        decidedAt: "2026-05-10T10:00:00.000Z",
        rootDir: root,
      },
      sink,
    );
    assert.equal(code, 0);
    const out = JSON.parse(stdout.join("")) as {
      recorded: { itemId: string; verdict: string };
    };
    assert.equal(out.recorded.itemId, item.itemId);
    assert.equal(out.recorded.verdict, "approved");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
