/**
 * Unit tests for the Jira Xray adapter (Issue #2183).
 *
 * Acceptance:
 *   - `connect` calls `/rest/api/3/myself` with the bearer token and
 *     returns a session carrying the supplied tenant + endpoint.
 *   - `validateProject` returns `{ ok: true, resolvedProjectId }` on
 *     success and `{ ok: false, code: "project_not_found" }` on 404.
 *   - `mapTestCase` produces a payload with the deterministic
 *     `idempotencyKey` derived from `(tenantId, runId, testCaseId)`.
 *   - `pushTestCase` sends the `Idempotency-Key` header and reads the
 *     `key` field as the assigned issue id.
 *   - Re-runs against the same idempotency key short-circuit to
 *     `skipped-dup` (when the mock returns `deduplicated: true`).
 *   - `pollSyncStatus` returns `{ found: false, code: "issue_not_found" }`
 *     for 404.
 *   - `dryRun: true` never issues a state-mutating request.
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  type QcMappingPreviewEntry,
} from "../../contracts/index.js";
import { createXrayAdapter } from "./xray-adapter.js";
import {
  type TmsCredentials,
  type TmsHttpClient,
  type TmsHttpRequest,
  type TmsHttpResponse,
} from "./tms-adapter-contract.js";

interface FakeHttpFixture {
  client: TmsHttpClient;
  requests: TmsHttpRequest[];
  responses: TmsHttpResponse[];
  pushResponse: (resp: TmsHttpResponse) => void;
}

const buildFakeHttp = (): FakeHttpFixture => {
  const requests: TmsHttpRequest[] = [];
  const responses: TmsHttpResponse[] = [];
  return {
    client: {
      async request(req: TmsHttpRequest): Promise<TmsHttpResponse> {
        requests.push(req);
        const resp = responses.shift();
        if (resp === undefined) {
          throw new Error(
            `fake http: no queued response for ${req.method} ${req.path}`,
          );
        }
        return resp;
      },
    },
    requests,
    responses,
    pushResponse(resp): void {
      responses.push(resp);
    },
  };
};

const sampleEntry = (id: string): QcMappingPreviewEntry => ({
  testCaseId: id,
  externalIdCandidate: `ext-${id}`,
  testName: `Test ${id}`,
  objective: `Verify behavior of ${id}`,
  priority: "P2",
  riskCategory: "regulated",
  targetFolderPath: "/Subject/Bank/Login",
  preconditions: ["pre 1"],
  testData: ["data 1"],
  designSteps: [
    { index: 1, action: "Step 1", expected: "Result 1" },
    { index: 2, action: "Step 2", expected: "Result 2" },
  ],
  expectedResults: ["Result 1", "Result 2"],
  sourceTraceRefs: [],
  exportable: true,
  blockingReasons: [],
});

const credentials: TmsCredentials = { kind: "pat", token: "x" };

test("xray-adapter: connect probes /rest/api/3/myself", async () => {
  const fake = buildFakeHttp();
  fake.pushResponse({ status: 200, headers: {}, body: { accountId: "1" } });
  const adapter = createXrayAdapter({ http: fake.client, sleep: async () => {} });
  const session = await adapter.connect({
    endpointAlias: "xray-test",
    projectId: "MOCK",
    tenantId: "tenant-1",
    credentials,
  });
  assert.equal(session.endpointAlias, "xray-test");
  assert.equal(session.projectId, "MOCK");
  assert.equal(session.tenantId, "tenant-1");
  assert.equal(fake.requests[0]!.path, "/rest/api/3/myself");
});

test("xray-adapter: validateProject ok on 200", async () => {
  const fake = buildFakeHttp();
  fake.pushResponse({ status: 200, headers: {}, body: { accountId: "1" } });
  fake.pushResponse({ status: 200, headers: {}, body: { key: "MOCK" } });
  const adapter = createXrayAdapter({ http: fake.client, sleep: async () => {} });
  const session = await adapter.connect({
    endpointAlias: "xray-test",
    projectId: "MOCK",
    tenantId: "t",
    credentials,
  });
  const result = await adapter.validateProject(session);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.resolvedProjectId, "MOCK");
});

test("xray-adapter: validateProject project_not_found on 404", async () => {
  const fake = buildFakeHttp();
  fake.pushResponse({ status: 200, headers: {}, body: { accountId: "1" } });
  fake.pushResponse({
    status: 404,
    headers: {},
    body: { errorMessages: ["not found"] },
  });
  const adapter = createXrayAdapter({ http: fake.client, sleep: async () => {} });
  const session = await adapter.connect({
    endpointAlias: "xray-test",
    projectId: "DOES_NOT_EXIST",
    tenantId: "t",
    credentials,
  });
  const result = await adapter.validateProject(session);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.code, "project_not_found");
});

test("xray-adapter: mapTestCase produces deterministic idempotency key", async () => {
  const fake = buildFakeHttp();
  fake.pushResponse({ status: 200, headers: {}, body: { accountId: "1" } });
  const adapter = createXrayAdapter({ http: fake.client, sleep: async () => {} });
  const session = await adapter.connect({
    endpointAlias: "xray-test",
    projectId: "MOCK",
    tenantId: "tenant-1",
    credentials,
  });
  const mapped = adapter.mapTestCase({
    session,
    runId: "run-1",
    entry: sampleEntry("tc-1"),
  });
  assert.match(mapped.idempotencyKey, /^[a-f0-9]{64}$/);
  assert.equal(mapped.testCaseId, "tc-1");
  // Same input → same key.
  const again = adapter.mapTestCase({
    session,
    runId: "run-1",
    entry: sampleEntry("tc-1"),
  });
  assert.equal(again.idempotencyKey, mapped.idempotencyKey);
});

test("xray-adapter: pushTestCase records pushed verdict on 201", async () => {
  const fake = buildFakeHttp();
  fake.pushResponse({ status: 200, headers: {}, body: { accountId: "1" } });
  fake.pushResponse({
    status: 201,
    headers: {},
    body: { id: "10001", key: "MOCK-1" },
  });
  const adapter = createXrayAdapter({ http: fake.client, sleep: async () => {} });
  const session = await adapter.connect({
    endpointAlias: "xray-test",
    projectId: "MOCK",
    tenantId: "t",
    credentials,
  });
  const mapped = adapter.mapTestCase({
    session,
    runId: "run-1",
    entry: sampleEntry("tc-1"),
  });
  const result = await adapter.pushTestCase({
    session,
    mapped,
    dryRun: false,
  });
  assert.equal(result.verdict, "pushed");
  assert.equal(result.tmsTestCaseId, "MOCK-1");
  // Confirm idempotency-key header sent.
  const createReq = fake.requests[1]!;
  assert.equal(createReq.idempotencyKey, mapped.idempotencyKey);
});

test("xray-adapter: pushTestCase dryRun never issues request", async () => {
  const fake = buildFakeHttp();
  fake.pushResponse({ status: 200, headers: {}, body: { accountId: "1" } });
  const adapter = createXrayAdapter({ http: fake.client, sleep: async () => {} });
  const session = await adapter.connect({
    endpointAlias: "xray-test",
    projectId: "MOCK",
    tenantId: "t",
    credentials,
  });
  const mapped = adapter.mapTestCase({
    session,
    runId: "run-1",
    entry: sampleEntry("tc-1"),
  });
  const result = await adapter.pushTestCase({
    session,
    mapped,
    dryRun: true,
  });
  assert.equal(result.verdict, "skipped-dup");
  assert.equal(fake.requests.length, 1);
});

test("xray-adapter: pushTestCase records skipped-dup on dedup response", async () => {
  const fake = buildFakeHttp();
  fake.pushResponse({ status: 200, headers: {}, body: { accountId: "1" } });
  fake.pushResponse({
    status: 200,
    headers: {},
    body: { id: "10001", key: "MOCK-1", deduplicated: true },
  });
  const adapter = createXrayAdapter({ http: fake.client, sleep: async () => {} });
  const session = await adapter.connect({
    endpointAlias: "xray-test",
    projectId: "MOCK",
    tenantId: "t",
    credentials,
  });
  const mapped = adapter.mapTestCase({
    session,
    runId: "run-1",
    entry: sampleEntry("tc-1"),
  });
  const result = await adapter.pushTestCase({
    session,
    mapped,
    dryRun: false,
  });
  assert.equal(result.verdict, "skipped-dup");
});

test("xray-adapter: pushTestCase records failed verdict on 422", async () => {
  const fake = buildFakeHttp();
  fake.pushResponse({ status: 200, headers: {}, body: { accountId: "1" } });
  fake.pushResponse({
    status: 422,
    headers: {},
    body: { errorMessages: ["validation failed"] },
  });
  const adapter = createXrayAdapter({ http: fake.client, sleep: async () => {} });
  const session = await adapter.connect({
    endpointAlias: "xray-test",
    projectId: "MOCK",
    tenantId: "t",
    credentials,
  });
  const mapped = adapter.mapTestCase({
    session,
    runId: "run-1",
    entry: sampleEntry("tc-1"),
  });
  const result = await adapter.pushTestCase({
    session,
    mapped,
    dryRun: false,
  });
  assert.equal(result.verdict, "failed");
  assert.equal(result.tmsTestCaseId, "");
  assert.match(result.tmsErrorMessage, /validation/i);
});

test("xray-adapter: pollSyncStatus returns issue state on 200", async () => {
  const fake = buildFakeHttp();
  fake.pushResponse({ status: 200, headers: {}, body: { accountId: "1" } });
  fake.pushResponse({
    status: 200,
    headers: {},
    body: {
      id: "10001",
      key: "MOCK-1",
      fields: { summary: "x", status: { name: "Active" } },
    },
  });
  const adapter = createXrayAdapter({ http: fake.client, sleep: async () => {} });
  const session = await adapter.connect({
    endpointAlias: "xray-test",
    projectId: "MOCK",
    tenantId: "t",
    credentials,
  });
  const status = await adapter.pollSyncStatus({
    session,
    tmsTestCaseId: "MOCK-1",
  });
  assert.equal(status.found, true);
  if (!status.found) return;
  assert.equal(status.state, "Active");
});

test("xray-adapter: disconnect releases session credentials", async () => {
  const fake = buildFakeHttp();
  fake.pushResponse({ status: 200, headers: {}, body: { accountId: "1" } });
  const adapter = createXrayAdapter({ http: fake.client, sleep: async () => {} });
  const session = await adapter.connect({
    endpointAlias: "xray-test",
    projectId: "MOCK",
    tenantId: "t",
    credentials,
  });
  await adapter.disconnect(session);
  // Subsequent pushTestCase should fail with session_credentials_unbound.
  const mapped = adapter.mapTestCase({
    session,
    runId: "run-1",
    entry: sampleEntry("tc-1"),
  });
  const result = await adapter.pushTestCase({
    session,
    mapped,
    dryRun: false,
  });
  assert.equal(result.verdict, "failed");
  assert.equal(result.tmsErrorCode, "session_credentials_unbound");
});
