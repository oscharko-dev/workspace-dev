/**
 * Unit tests for the Polarion adapter (Issue #2183).
 *
 * Acceptance:
 *   - `connect` probes `/polarion/rest/v1/projects?page[size]=1`.
 *   - `pushTestCase` records `pushed` on 201 and `skipped-dup` on 200.
 *   - The deterministic `data.id` field is the SHA-256 first 12 chars
 *     of the idempotency key.
 *   - `pollSyncStatus` returns the `attributes.status` as `state`.
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  type QcMappingPreviewEntry,
} from "../../contracts/index.js";
import { createPolarionAdapter } from "./polarion-adapter.js";
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
  testName: `Polarion ${id}`,
  objective: "verify",
  priority: "P0",
  riskCategory: "regulated",
  targetFolderPath: "/Subject/X",
  preconditions: ["pre"],
  testData: ["data"],
  designSteps: [{ index: 1, action: "Step", expected: "Result" }],
  expectedResults: ["Result"],
  sourceTraceRefs: [],
  exportable: true,
  blockingReasons: [],
});

const credentials: TmsCredentials = { kind: "pat", token: "x" };

test("polarion-adapter: connect probes projects endpoint", async () => {
  const fake = buildFakeHttp();
  fake.pushResponse({
    status: 200,
    headers: {},
    body: { data: [{ id: "p1" }] },
  });
  const adapter = createPolarionAdapter({ http: fake.client, sleep: async () => {} });
  const session = await adapter.connect({
    endpointAlias: "polarion-test",
    projectId: "p1",
    tenantId: "t",
    credentials,
  });
  assert.equal(session.projectId, "p1");
  assert.match(fake.requests[0]!.path, /^\/polarion\/rest\/v1\/projects/);
});

test("polarion-adapter: mapTestCase encodes data.id as first 12 hex chars", async () => {
  const fake = buildFakeHttp();
  fake.pushResponse({
    status: 200,
    headers: {},
    body: { data: [{ id: "p1" }] },
  });
  const adapter = createPolarionAdapter({ http: fake.client, sleep: async () => {} });
  const session = await adapter.connect({
    endpointAlias: "polarion-test",
    projectId: "p1",
    tenantId: "t",
    credentials,
  });
  const mapped = adapter.mapTestCase({
    session,
    runId: "run-1",
    entry: sampleEntry("tc-1"),
  });
  const data = (mapped.payload as { data: { id: string } }).data;
  assert.equal(data.id, mapped.idempotencyKey.slice(0, 12));
});

test("polarion-adapter: pushTestCase records pushed on 201", async () => {
  const fake = buildFakeHttp();
  fake.pushResponse({
    status: 200,
    headers: {},
    body: { data: [{ id: "p1" }] },
  });
  fake.pushResponse({
    status: 201,
    headers: {},
    body: { data: { id: "WI-100" } },
  });
  const adapter = createPolarionAdapter({ http: fake.client, sleep: async () => {} });
  const session = await adapter.connect({
    endpointAlias: "polarion-test",
    projectId: "p1",
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
  assert.equal(result.tmsTestCaseId, "WI-100");
});

test("polarion-adapter: pushTestCase records skipped-dup on 200", async () => {
  const fake = buildFakeHttp();
  fake.pushResponse({
    status: 200,
    headers: {},
    body: { data: [{ id: "p1" }] },
  });
  fake.pushResponse({
    status: 200,
    headers: {},
    body: { data: { id: "WI-100" } },
  });
  const adapter = createPolarionAdapter({ http: fake.client, sleep: async () => {} });
  const session = await adapter.connect({
    endpointAlias: "polarion-test",
    projectId: "p1",
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
  assert.equal(result.tmsTestCaseId, "WI-100");
});

test("polarion-adapter: pollSyncStatus returns attributes.status", async () => {
  const fake = buildFakeHttp();
  fake.pushResponse({
    status: 200,
    headers: {},
    body: { data: [{ id: "p1" }] },
  });
  fake.pushResponse({
    status: 200,
    headers: {},
    body: {
      data: { id: "WI-100", attributes: { status: "approved" } },
    },
  });
  const adapter = createPolarionAdapter({ http: fake.client, sleep: async () => {} });
  const session = await adapter.connect({
    endpointAlias: "polarion-test",
    projectId: "p1",
    tenantId: "t",
    credentials,
  });
  const status = await adapter.pollSyncStatus({
    session,
    tmsTestCaseId: "WI-100",
  });
  assert.equal(status.found, true);
  if (!status.found) return;
  assert.equal(status.state, "approved");
});
