/**
 * Unit tests for the OpenText / HP ALM adapter (Issue #2183).
 *
 * Acceptance:
 *   - `connect` performs the LWSSO + QCSession handshake and surfaces
 *     `domain` + `project` on `session.internal`.
 *   - `connect` refuses a project id without `domain/project` shape.
 *   - `pushTestCase` performs lookup-by-name first; on a hit it
 *     short-circuits to `skipped-dup`.
 *   - `pushTestCase` records `pushed` on a fresh create.
 *   - `disconnect` issues sign-out best-effort.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { type QcMappingPreviewEntry } from "../../contracts/index.js";
import { createAlmAdapter } from "./alm-adapter.js";
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
  testName: `ALM ${id}`,
  objective: "verify",
  priority: "P3",
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

const credentials: TmsCredentials = {
  kind: "pat",
  token: "x",
  principalId: "alice",
};

const lwssoResp = (): TmsHttpResponse => ({
  status: 200,
  headers: {
    "set-cookie": "LWSSO_COOKIE_KEY=lwsso-1; Path=/",
  },
});

const sessionResp = (): TmsHttpResponse => ({
  status: 201,
  headers: {
    "set-cookie": "QCSession=qc-1; Path=/, XSRF-TOKEN=xsrf-1; Path=/",
  },
});

test("alm-adapter: connect performs LWSSO + QCSession handshake", async () => {
  const fake = buildFakeHttp();
  fake.pushResponse(lwssoResp());
  fake.pushResponse(sessionResp());
  const adapter = createAlmAdapter({ http: fake.client, sleep: async () => {} });
  const session = await adapter.connect({
    endpointAlias: "alm-test",
    projectId: "DEFAULT/mock-project",
    tenantId: "t",
    credentials,
  });
  assert.equal(session.principalId, "alice");
  assert.equal(
    (session.internal as { domain?: string }).domain,
    "DEFAULT",
  );
  assert.equal(
    (session.internal as { project?: string }).project,
    "mock-project",
  );
});

test("alm-adapter: connect refuses malformed project id", async () => {
  const fake = buildFakeHttp();
  const adapter = createAlmAdapter({ http: fake.client, sleep: async () => {} });
  await assert.rejects(
    adapter.connect({
      endpointAlias: "alm-test",
      projectId: "no-slash",
      tenantId: "t",
      credentials,
    }),
    /invalid_project_id/,
  );
});

test("alm-adapter: pushTestCase lookup-then-create on miss", async () => {
  const fake = buildFakeHttp();
  fake.pushResponse(lwssoResp());
  fake.pushResponse(sessionResp());
  fake.pushResponse({ status: 200, headers: {}, body: { entities: [] } });
  fake.pushResponse({
    status: 201,
    headers: {},
    body: { id: "555", name: "x" },
  });
  const adapter = createAlmAdapter({ http: fake.client, sleep: async () => {} });
  const session = await adapter.connect({
    endpointAlias: "alm-test",
    projectId: "DEFAULT/mock-project",
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
  assert.equal(result.tmsTestCaseId, "555");
});

test("alm-adapter: pushTestCase short-circuits to skipped-dup on lookup hit", async () => {
  const fake = buildFakeHttp();
  fake.pushResponse(lwssoResp());
  fake.pushResponse(sessionResp());
  fake.pushResponse({
    status: 200,
    headers: {},
    body: { entities: [{ id: "777", name: "x" }] },
  });
  const adapter = createAlmAdapter({ http: fake.client, sleep: async () => {} });
  const session = await adapter.connect({
    endpointAlias: "alm-test",
    projectId: "DEFAULT/mock-project",
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
  assert.equal(result.tmsTestCaseId, "777");
});

test("alm-adapter: disconnect issues sign-out best-effort", async () => {
  const fake = buildFakeHttp();
  fake.pushResponse(lwssoResp());
  fake.pushResponse(sessionResp());
  fake.pushResponse({ status: 200, headers: {}, body: {} });
  const adapter = createAlmAdapter({ http: fake.client, sleep: async () => {} });
  const session = await adapter.connect({
    endpointAlias: "alm-test",
    projectId: "DEFAULT/mock-project",
    tenantId: "t",
    credentials,
  });
  await adapter.disconnect(session);
  assert.equal(
    fake.requests[fake.requests.length - 1]!.path,
    "/qcbin/rest/site-session/sign-out",
  );
});
