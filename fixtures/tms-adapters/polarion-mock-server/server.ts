/**
 * Vendored Siemens Polarion mock server (Issue #2183, Wave 8).
 *
 * Implements the minimal surface required by `polarion-adapter.ts`:
 *   - GET  /polarion/rest/v1/projects?page[size]=1
 *   - GET  /polarion/rest/v1/projects/:projectId
 *   - POST /polarion/rest/v1/projects/:projectId/workitems
 *   - GET  /polarion/rest/v1/projects/:projectId/workitems/:id
 *
 * Idempotency: the mock dedupes by the `data.id` field on the create
 * payload (Polarion-stable). A re-run with the same id returns 200
 * (the adapter records this as `skipped-dup`).
 */

import {
  startMockServer,
  type MockResponse,
  type MockRoute,
  type MockServerHandle,
} from "../shared/mock-server.js";

export interface PolarionMockHandle extends MockServerHandle {
  readonly workItems: ReadonlyMap<string, PolarionMockWorkItem>;
}

export interface PolarionMockWorkItem {
  id: string;
  title: string;
  status: string;
}

const PROJECT_PATTERN = /^\/polarion\/rest\/v1\/projects\/(?<projectId>[^/]+)$/;
const CREATE_PATTERN = /^\/polarion\/rest\/v1\/projects\/(?<projectId>[^/]+)\/workitems$/;
const READ_PATTERN = /^\/polarion\/rest\/v1\/projects\/(?<projectId>[^/]+)\/workitems\/(?<id>[^/]+)$/;

export interface StartPolarionMockServerInput {
  knownProjectIds?: readonly string[];
}

export const startPolarionMockServer = async (
  input: StartPolarionMockServerInput = {},
): Promise<PolarionMockHandle> => {
  const knownProjects = new Set<string>(input.knownProjectIds ?? ["mock-project"]);
  const workItems = new Map<string, PolarionMockWorkItem>();

  const routes: MockRoute[] = [
    {
      method: "GET",
      pathPattern: "/polarion/rest/v1/projects",
      handler: (): MockResponse => ({
        status: 200,
        body: { data: [{ id: "mock-project", type: "projects" }] },
      }),
    },
    {
      method: "GET",
      pathPattern: PROJECT_PATTERN,
      handler: ({ pathParams }): MockResponse => {
        const projectId = pathParams.projectId;
        if (projectId === undefined || !knownProjects.has(projectId)) {
          return {
            status: 404,
            body: { errors: [{ title: `project ${projectId} not found` }] },
          };
        }
        return {
          status: 200,
          body: { data: { id: projectId, type: "projects" } },
        };
      },
    },
    {
      method: "POST",
      pathPattern: CREATE_PATTERN,
      handler: ({ body, pathParams }): MockResponse => {
        const projectId = pathParams.projectId;
        if (projectId === undefined || !knownProjects.has(projectId)) {
          return {
            status: 404,
            body: { errors: [{ title: `project ${projectId} not found` }] },
          };
        }
        if (typeof body !== "object" || body === null) {
          return { status: 400, body: { errors: [{ title: "body required" }] } };
        }
        const data = (body as Record<string, unknown>).data;
        if (typeof data !== "object" || data === null) {
          return {
            status: 400,
            body: { errors: [{ title: "data envelope required" }] },
          };
        }
        const id = (data as Record<string, unknown>).id;
        if (typeof id !== "string" || id.length === 0) {
          return {
            status: 400,
            body: { errors: [{ title: "data.id required" }] },
          };
        }
        const attributes = (data as Record<string, unknown>).attributes as
          | Record<string, unknown>
          | undefined;
        const title =
          attributes !== undefined && typeof attributes.title === "string"
            ? attributes.title
            : "(no title)";
        if (workItems.has(id)) {
          // Idempotent dedupe — return 200 with the prior record.
          return {
            status: 200,
            body: { data: { id, type: "workitems" } },
          };
        }
        workItems.set(id, { id, title, status: "proposed" });
        return {
          status: 201,
          body: { data: { id, type: "workitems" } },
        };
      },
    },
    {
      method: "GET",
      pathPattern: READ_PATTERN,
      handler: ({ pathParams }): MockResponse => {
        const id = pathParams.id;
        if (id === undefined) {
          return { status: 400, body: { errors: [{ title: "missing id" }] } };
        }
        const workItem = workItems.get(id);
        if (workItem === undefined) {
          return {
            status: 404,
            body: { errors: [{ title: `work item ${id} not found` }] },
          };
        }
        return {
          status: 200,
          body: {
            data: {
              id: workItem.id,
              type: "workitems",
              attributes: {
                title: workItem.title,
                status: workItem.status,
              },
            },
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
  return Object.assign(handle, { workItems });
};
