/**
 * Vendored Tricentis qTest mock server (Issue #2183, Wave 8).
 *
 * Implements the minimal surface required by `qtest-adapter.ts`:
 *   - GET  /api/v3/users/current
 *   - GET  /api/v3/projects/:projectId
 *   - POST /api/v3/projects/:projectId/test-cases
 *   - GET  /api/v3/projects/:projectId/test-cases/:id
 *
 * Idempotency: the mock returns 409 with the prior id when the same
 * `Idempotency-Key` header is replayed.
 */

import {
  startMockServer,
  type MockResponse,
  type MockRoute,
  type MockServerHandle,
} from "../shared/mock-server.js";

export interface QtestMockHandle extends MockServerHandle {
  readonly testCases: ReadonlyMap<string, QtestMockTestCase>;
}

export interface QtestMockTestCase {
  id: number;
  name: string;
  approve_status: string;
}

const PROJECT_PATTERN = /^\/api\/v3\/projects\/(?<projectId>[^/]+)$/;
const CREATE_PATTERN = /^\/api\/v3\/projects\/(?<projectId>[^/]+)\/test-cases$/;
const READ_PATTERN = /^\/api\/v3\/projects\/(?<projectId>[^/]+)\/test-cases\/(?<id>[^/]+)$/;

export interface StartQtestMockServerInput {
  knownProjectIds?: readonly string[];
}

export const startQtestMockServer = async (
  input: StartQtestMockServerInput = {},
): Promise<QtestMockHandle> => {
  const knownProjects = new Set<string>(input.knownProjectIds ?? ["mock-project"]);
  const testCases = new Map<string, QtestMockTestCase>();
  const idempotencyIndex = new Map<string, number>();
  let nextId = 100;

  const routes: MockRoute[] = [
    {
      method: "GET",
      pathPattern: "/api/v3/users/current",
      handler: (): MockResponse => ({
        status: 200,
        body: { id: 1, username: "mock-user" },
      }),
    },
    {
      method: "GET",
      pathPattern: PROJECT_PATTERN,
      handler: ({ pathParams }): MockResponse => {
        const projectId = pathParams.projectId;
        if (projectId === undefined || !knownProjects.has(projectId)) {
          return { status: 404, body: { message: `project ${projectId} not found` } };
        }
        return {
          status: 200,
          body: { id: projectId, name: `${projectId} mock` },
        };
      },
    },
    {
      method: "POST",
      pathPattern: CREATE_PATTERN,
      handler: ({ request, body, pathParams }): MockResponse => {
        const projectId = pathParams.projectId;
        if (projectId === undefined || !knownProjects.has(projectId)) {
          return { status: 404, body: { message: `project ${projectId} not found` } };
        }
        const idemKey = (request.headers["idempotency-key"] as string | undefined) ?? "";
        if (idemKey.length > 0 && idempotencyIndex.has(idemKey)) {
          const id = idempotencyIndex.get(idemKey)!;
          return { status: 409, body: { id, message: "duplicate" } };
        }
        if (typeof body !== "object" || body === null) {
          return { status: 400, body: { message: "body required" } };
        }
        const name = (body as Record<string, unknown>).name;
        if (typeof name !== "string" || name.length === 0) {
          return { status: 400, body: { message: "name required" } };
        }
        const id = nextId;
        nextId += 1;
        testCases.set(String(id), { id, name, approve_status: "approved" });
        if (idemKey.length > 0) {
          idempotencyIndex.set(idemKey, id);
        }
        return { status: 201, body: { id } };
      },
    },
    {
      method: "GET",
      pathPattern: READ_PATTERN,
      handler: ({ pathParams }): MockResponse => {
        const id = pathParams.id;
        if (id === undefined) {
          return { status: 400, body: { message: "missing id" } };
        }
        const testCase = testCases.get(id);
        if (testCase === undefined) {
          return { status: 404, body: { message: `test case ${id} not found` } };
        }
        return {
          status: 200,
          body: {
            id: testCase.id,
            name: testCase.name,
            approve_status: testCase.approve_status,
          },
        };
      },
    },
  ];

  const handle = await startMockServer({
    routes,
    authPredicate: (req) => {
      const auth = req.headers.authorization;
      return typeof auth === "string" && auth.startsWith("Bearer ") && auth.length > 7;
    },
  });
  return Object.assign(handle, { testCases });
};
