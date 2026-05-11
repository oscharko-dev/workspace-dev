import assert from "node:assert/strict";
import {
  generateKeyPairSync,
  sign as cryptoSign,
} from "node:crypto";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  parseTestIntelligenceExecutionPullArgs,
  runTestIntelligenceExecutionPullCommand,
  TestIntelligenceExecutionPullOperatorError,
  TMS_ADMIN_VERIFYING_KEY_FILENAME,
} from "./test-intelligence-execution-pull-cli.js";
import { canonicalJson } from "./test-intelligence/content-hash.js";
import {
  EXECUTION_EVIDENCE_REPORT_FILENAME,
  G12_EXECUTION_EVIDENCE_SIGNED,
} from "./test-intelligence/test-execution-evidence-ingest.js";
import type {
  TmsAdapter,
  TmsAdapterSession,
  TmsHttpClient,
  TmsRawExecutionEvidence,
} from "./test-intelligence/tms-adapters/index.js";

const TENANT_ID = "acme-bank";
const PROJECT_ID = "ACME";
const SINCE_ISO = "2026-04-01T00:00:00.000Z";

const buildSignedRawEvidence = (
  privateKey: ReturnType<typeof generateKeyPairSync>["privateKey"],
): TmsRawExecutionEvidence => {
  // A reviewer-approved + execution-fail case is the canonical
  // conflict the harness must surface for human re-review (W6-5).
  const body = {
    testCaseId: "TC-LOGIN-0007",
    tenantId: TENANT_ID,
    tmsAdapterId: "xray" as const,
    tmsCaseId: "JIRA-1234",
    executionVerdict: "fail" as const,
    reviewerVerdict: "approved" as const,
    reviewerRationale: "production team approved despite TMS fail",
    executedAt: "2026-05-10T14:32:11.000Z",
  };
  const signingBytes = Buffer.from(canonicalJson(body), "utf8");
  const sig = cryptoSign(null, signingBytes, privateKey);
  return {
    ...body,
    attestationSignatureHex: sig.toString("hex"),
  };
};

const stubAdapter = (rows: readonly TmsRawExecutionEvidence[]): TmsAdapter => {
  const session: TmsAdapterSession = Object.freeze({
    endpointAlias: "xray-test",
    projectId: PROJECT_ID,
    tenantId: TENANT_ID,
    principalId: "tms-principal:test",
    internal: Object.freeze({}),
  });
  return {
    adapterId: "xray",
    version: "test",
    supportedAuthKinds: new Set(["pat"]),
    async connect() {
      return session;
    },
    async validateProject() {
      return { ok: true, resolvedProjectId: PROJECT_ID };
    },
    mapTestCase() {
      throw new Error("not used in execution-pull");
    },
    async pushTestCase() {
      throw new Error("not used in execution-pull");
    },
    async pushTestCaseBatch() {
      throw new Error("not used in execution-pull");
    },
    async pollSyncStatus() {
      throw new Error("not used in execution-pull");
    },
    async pullExecutions() {
      return { evidence: rows };
    },
    async disconnect() {
      // no-op
    },
  };
};

const stubHttp: TmsHttpClient = {
  async request() {
    throw new Error("not used in execution-pull tests");
  },
};

const setupTenantDir = async (
  publicKeyPem: string,
): Promise<{ outputRoot: string; tenantDir: string }> => {
  const outputRoot = await mkdtemp(join(tmpdir(), "ti-execpull-"));
  const tenantDir = join(outputRoot, "tenants", TENANT_ID);
  await mkdir(join(tenantDir, "signing-keys"), { recursive: true });
  await writeFile(
    join(tenantDir, "signing-keys", TMS_ADMIN_VERIFYING_KEY_FILENAME),
    publicKeyPem,
    "utf8",
  );
  return { outputRoot, tenantDir };
};

test("parseTestIntelligenceExecutionPullArgs: requires every mandatory flag", () => {
  assert.throws(
    () => parseTestIntelligenceExecutionPullArgs([]),
    TestIntelligenceExecutionPullOperatorError,
  );
  assert.throws(
    () =>
      parseTestIntelligenceExecutionPullArgs([
        "--tms",
        "xray",
        "--project",
        PROJECT_ID,
      ]),
    TestIntelligenceExecutionPullOperatorError,
  );
  assert.throws(
    () =>
      parseTestIntelligenceExecutionPullArgs([
        "--tms",
        "xray",
        "--project",
        PROJECT_ID,
        "--since",
        "2026-04-01T00:00:00Z",
      ]),
    TestIntelligenceExecutionPullOperatorError,
  );
});

test("parseTestIntelligenceExecutionPullArgs: rejects unknown flag", () => {
  assert.throws(
    () =>
      parseTestIntelligenceExecutionPullArgs([
        "--tms",
        "xray",
        "--project",
        PROJECT_ID,
        "--since",
        "2026-04-01T00:00:00Z",
        "--tenant",
        TENANT_ID,
        "--output-root",
        "/tmp/x",
        "--bogus",
      ]),
    TestIntelligenceExecutionPullOperatorError,
  );
});

test("parseTestIntelligenceExecutionPullArgs: rejects malformed --since", () => {
  assert.throws(
    () =>
      parseTestIntelligenceExecutionPullArgs([
        "--tms",
        "xray",
        "--project",
        PROJECT_ID,
        "--since",
        "yesterday",
        "--tenant",
        TENANT_ID,
        "--output-root",
        "/tmp/x",
      ]),
    TestIntelligenceExecutionPullOperatorError,
  );
});

test("parseTestIntelligenceExecutionPullArgs: parses the canonical happy path", () => {
  const parsed = parseTestIntelligenceExecutionPullArgs([
    "--tms",
    "xray",
    "--project",
    PROJECT_ID,
    "--since",
    SINCE_ISO,
    "--tenant",
    TENANT_ID,
    "--output-root",
    "/tmp/x",
    "--strict-signature",
  ]);
  assert.equal(parsed.tms, "xray");
  assert.equal(parsed.projectId, PROJECT_ID);
  assert.equal(parsed.sinceIso, SINCE_ISO);
  assert.equal(parsed.tenantId, TENANT_ID);
  assert.equal(parsed.outputRoot, "/tmp/x");
  assert.equal(parsed.endpointAlias, "xray-default");
  assert.equal(parsed.strictSignature, true);
});

test("runTestIntelligenceExecutionPullCommand: end-to-end happy path writes report", async () => {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const publicKeyPem = publicKey
    .export({ type: "spki", format: "pem" })
    .toString();
  const { outputRoot, tenantDir } = await setupTenantDir(publicKeyPem);
  const stub = stubAdapter([buildSignedRawEvidence(privateKey)]);
  const stdoutChunks: string[] = [];
  const stderrChunks: string[] = [];
  const code = await runTestIntelligenceExecutionPullCommand({
    options: {
      tms: "xray",
      projectId: PROJECT_ID,
      sinceIso: SINCE_ISO,
      tenantId: TENANT_ID,
      outputRoot,
      endpointAlias: "xray-test",
      strictSignature: false,
    },
    sink: {
      stdout: (chunk) => stdoutChunks.push(chunk),
      stderr: (chunk) => stderrChunks.push(chunk),
    },
    env: {
      WORKSPACE_TEST_SPACE_TMS_XRAY_TOKEN: "test-token",
    },
    adapterFactory: () => stub,
    httpFactory: () => stubHttp,
  });
  assert.equal(code, 0, `stderr: ${stderrChunks.join("")}`);
  const reportRaw = await readFile(
    join(tenantDir, "calibration-corpus", EXECUTION_EVIDENCE_REPORT_FILENAME),
    "utf8",
  );
  const report = JSON.parse(reportRaw);
  assert.equal(report.acceptedCount, 1);
  assert.equal(report.rejectedCount, 0);
  assert.equal(report.conflictCount, 1);
  const stdout = stdoutChunks.join("");
  assert.match(stdout, /accepted=1/);
  assert.match(stdout, /conflicts=1/);
});

test("runTestIntelligenceExecutionPullCommand: --strict-signature exits 2 on bad sig", async () => {
  const { publicKey } = generateKeyPairSync("ed25519");
  const publicKeyPem = publicKey
    .export({ type: "spki", format: "pem" })
    .toString();
  const { outputRoot } = await setupTenantDir(publicKeyPem);
  // Sign with a *different* key — verification must fail.
  const { privateKey: otherKey } = generateKeyPairSync("ed25519");
  const stub = stubAdapter([buildSignedRawEvidence(otherKey)]);
  const stdoutChunks: string[] = [];
  const stderrChunks: string[] = [];
  const code = await runTestIntelligenceExecutionPullCommand({
    options: {
      tms: "xray",
      projectId: PROJECT_ID,
      sinceIso: SINCE_ISO,
      tenantId: TENANT_ID,
      outputRoot,
      endpointAlias: "xray-test",
      strictSignature: true,
    },
    sink: {
      stdout: (chunk) => stdoutChunks.push(chunk),
      stderr: (chunk) => stderrChunks.push(chunk),
    },
    env: {
      WORKSPACE_TEST_SPACE_TMS_XRAY_TOKEN: "test-token",
    },
    adapterFactory: () => stub,
    httpFactory: () => stubHttp,
  });
  assert.equal(code, 2);
  assert.match(stderrChunks.join(""), new RegExp(G12_EXECUTION_EVIDENCE_SIGNED));
});

test("runTestIntelligenceExecutionPullCommand: missing tenant dir → exit 1", async () => {
  const outputRoot = await mkdtemp(join(tmpdir(), "ti-execpull-no-tenant-"));
  const stdoutChunks: string[] = [];
  const stderrChunks: string[] = [];
  const code = await runTestIntelligenceExecutionPullCommand({
    options: {
      tms: "xray",
      projectId: PROJECT_ID,
      sinceIso: SINCE_ISO,
      tenantId: TENANT_ID,
      outputRoot,
      endpointAlias: "xray-test",
      strictSignature: false,
    },
    sink: {
      stdout: (chunk) => stdoutChunks.push(chunk),
      stderr: (chunk) => stderrChunks.push(chunk),
    },
    env: {
      WORKSPACE_TEST_SPACE_TMS_XRAY_TOKEN: "test-token",
    },
    adapterFactory: () => stubAdapter([]),
    httpFactory: () => stubHttp,
  });
  assert.equal(code, 1);
  assert.match(stderrChunks.join(""), /tenant directory does not exist/);
});

test("runTestIntelligenceExecutionPullCommand: missing TMS credentials → exit 1", async () => {
  const { publicKey } = generateKeyPairSync("ed25519");
  const publicKeyPem = publicKey
    .export({ type: "spki", format: "pem" })
    .toString();
  const { outputRoot } = await setupTenantDir(publicKeyPem);
  const stdoutChunks: string[] = [];
  const stderrChunks: string[] = [];
  const code = await runTestIntelligenceExecutionPullCommand({
    options: {
      tms: "xray",
      projectId: PROJECT_ID,
      sinceIso: SINCE_ISO,
      tenantId: TENANT_ID,
      outputRoot,
      endpointAlias: "xray-test",
      strictSignature: false,
    },
    sink: {
      stdout: (chunk) => stdoutChunks.push(chunk),
      stderr: (chunk) => stderrChunks.push(chunk),
    },
    env: {}, // no token
    adapterFactory: () => stubAdapter([]),
    httpFactory: () => stubHttp,
  });
  assert.equal(code, 1);
});
