/**
 * Unit tests for the Tricentis qTest adapter (Issue #2183).
 *
 * Acceptance:
 *   - `connect` probes `/api/v3/users/current`.
 *   - `validateProject` resolves the project id from the response body.
 *   - `pushTestCase` reads numeric ids and records `pushed`.
 *   - 409 from qTest is treated as `skipped-dup`.
 *   - `pollSyncStatus` returns the `approve_status` as `state`.
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  type QcMappingPreviewEntry,
} from "../../contracts/index.js";
import { createQtestAdapter } from "./qtest-adapter.js";
import {
  type TmsCredentials,
  type TmsHttpClient,
  type TmsHttpRequest,
  type TmsHttpResponse,
} from "./tms-adapter-contract.js";

const buildFakeHttp = (): {
  client: TmsHttpClient;
  requests: TmsHttpRequest[];
  pushResponse: (resp: TmsHttpResponse) => void;
} => {
  const requests: TmsHttpRequest[] = [];
  const queue: TmsHttpResponse[] = [];
  return {
    client: {
      async request(req: TmsHttpRequest): Promise<TmsHttpResponse> {
        requests.push(req);
        const resp = queue.shift();
        if (resp === undefined) {
          throw new Error(`no queued response for ${req.method} ${req.path}`);
        }
        return resp;
      },
    },
    requests,
    pushResponse(r) {
      queue.push(r);
    },
  };
};

const sampleEntry = (id: string): QcMappingPreviewEntry => ({
  testCaseId: id,
  externalIdCandidate: `ext-${id}`,
  testName: `qTest ${id}`,
  objective: "verify",
  priority: "P1",
  riskCategory: "regulated",
  targetFolderPath: "/Subject/X",
  preconditions: [],
  testData: [],
  designSteps: [{ index: 1, action: "Step", expected: "Result" }],
  expectedResults: ["Result"],
  sourceTraceRefs: [],
  exportable: true,
  blockingReasons: [],
});

const credentials: TmsCredentials = { kind: "oauth2", accessToken: "x" };

test("qtest-adapter: connect probes /api/v3/users/current", async () => {
  const fake = buildFakeHttp();
  fake.pushResponse({ status: 200, headers: {}, body: { id: 1 } });
  const adapter = createQtestAdapter({ http: fake.client, sleep: async () => {} });
  const session = await adapter.connect({
    endpointAlias: "qtest-test",
    projectId: "1234",
    tenantId: "t",
    credentials,
  });
  assert.equal(session.projectId, "1234");
  assert.equal(fake.requests[0]!.path, "/api/v3/users/current");
});

test("qtest-adapter: pushTestCase pushes and records numeric id", async () => {
  const fake = buildFakeHttp();
  fake.pushResponse({ status: 200, headers: {}, body: { id: 1 } });
  fake.pushResponse({ status: 201, headers: {}, body: { id: 42 } });
  const adapter = createQtestAdapter({ http: fake.client, sleep: async () => {} });
  const session = await adapter.connect({
    endpointAlias: "qtest-test",
    projectId: "1234",
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
  assert.equal(result.tmsTestCaseId, "42");
});

test("qtest-adapter: pushTestCase 409 → skipped-dup", async () => {
  const fake = buildFakeHttp();
  fake.pushResponse({ status: 200, headers: {}, body: { id: 1 } });
  fake.pushResponse({
    status: 409,
    headers: {},
    body: { id: 99, message: "duplicate" },
  });
  const adapter = createQtestAdapter({ http: fake.client, sleep: async () => {} });
  const session = await adapter.connect({
    endpointAlias: "qtest-test",
    projectId: "1234",
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
  assert.equal(result.tmsTestCaseId, "99");
});

test("qtest-adapter: validateProject 404 returns project_not_found", async () => {
  const fake = buildFakeHttp();
  fake.pushResponse({ status: 200, headers: {}, body: { id: 1 } });
  fake.pushResponse({
    status: 404,
    headers: {},
    body: { message: "project missing" },
  });
  const adapter = createQtestAdapter({ http: fake.client, sleep: async () => {} });
  const session = await adapter.connect({
    endpointAlias: "qtest-test",
    projectId: "missing",
    tenantId: "t",
    credentials,
  });
  const result = await adapter.validateProject(session);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.code, "project_not_found");
});

test("qtest-adapter: pollSyncStatus returns approve_status", async () => {
  const fake = buildFakeHttp();
  fake.pushResponse({ status: 200, headers: {}, body: { id: 1 } });
  fake.pushResponse({
    status: 200,
    headers: {},
    body: { id: 42, approve_status: "approved" },
  });
  const adapter = createQtestAdapter({ http: fake.client, sleep: async () => {} });
  const session = await adapter.connect({
    endpointAlias: "qtest-test",
    projectId: "1234",
    tenantId: "t",
    credentials,
  });
  const status = await adapter.pollSyncStatus({
    session,
    tmsTestCaseId: "42",
  });
  assert.equal(status.found, true);
  if (!status.found) return;
  assert.equal(status.state, "approved");
});
