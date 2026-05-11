/**
 * Vendored Jira Xray mock server (Issue #2183, Wave 8).
 *
 * Implements the minimal surface required by `xray-adapter.ts`:
 *   - GET  /rest/api/3/myself
 *   - GET  /rest/api/3/project/:projectKey
 *   - POST /rest/raven/2.0/api/import/test
 *   - GET  /rest/api/3/issue/:issueKey
 *
 * Auth: requires `Authorization: Bearer <token>` (any non-empty token
 * is accepted). The mock keeps an in-memory store keyed by
 * `Idempotency-Key` so re-runs return the same issue id.
 */

import {
  startMockServer,
  type MockResponse,
  type MockRoute,
  type MockServerHandle,
} from "../shared/mock-server.js";

export interface XrayMockHandle extends MockServerHandle {
  /** Read-only view into the persisted issues, keyed by issue key. */
  readonly issues: ReadonlyMap<string, XrayMockIssue>;
}

export interface XrayMockIssue {
  id: string;
  key: string;
  summary: string;
  status: string;
}

const PROJECT_KEY_PATTERN = /^\/rest\/api\/3\/project\/(?<key>[^/]+)$/;
const ISSUE_KEY_PATTERN = /^\/rest\/api\/3\/issue\/(?<key>[^/]+)$/;

/** Inputs for `startXrayMockServer`. */
export interface StartXrayMockServerInput {
  /** Allowed project keys; requests for any other key respond with 404. */
  knownProjectKeys?: readonly string[];
}

/** Start the Xray mock server. */
export const startXrayMockServer = async (
  input: StartXrayMockServerInput = {},
): Promise<XrayMockHandle> => {
  const knownKeys = new Set<string>(input.knownProjectKeys ?? ["MOCK"]);
  const issues = new Map<string, XrayMockIssue>();
  const idempotencyIndex = new Map<string, string>();
  let nextIssueNumber = 1;

  const routes: MockRoute[] = [
    {
      method: "GET",
      pathPattern: "/rest/api/3/myself",
      handler: (): MockResponse => ({
        status: 200,
        body: { accountId: "mock-account", displayName: "Mock User" },
      }),
    },
    {
      method: "GET",
      pathPattern: PROJECT_KEY_PATTERN,
      handler: ({ pathParams }): MockResponse => {
        const key = pathParams.key;
        if (key === undefined || !knownKeys.has(key)) {
          return {
            status: 404,
            body: { errorMessages: [`project ${key} not found`] },
          };
        }
        return {
          status: 200,
          body: { id: `${key}-id`, key, name: `${key} Project` },
        };
      },
    },
    {
      method: "POST",
      pathPattern: "/rest/raven/2.0/api/import/test",
      handler: ({ request, body }): MockResponse => {
        const idempotencyKey = (request.headers["idempotency-key"] as string | undefined) ?? "";
        if (idempotencyKey.length > 0 && idempotencyIndex.has(idempotencyKey)) {
          const existingKey = idempotencyIndex.get(idempotencyKey)!;
          const existing = issues.get(existingKey)!;
          return {
            status: 200,
            body: {
              id: existing.id,
              key: existing.key,
              deduplicated: true,
            },
          };
        }
        if (typeof body !== "object" || body === null) {
          return { status: 400, body: { errorMessages: ["body required"] } };
        }
        const fields = (body as Record<string, unknown>).fields as
          | Record<string, unknown>
          | undefined;
        const summary =
          fields !== undefined && typeof fields.summary === "string"
            ? fields.summary
            : "(no summary)";
        const project =
          fields !== undefined &&
          typeof fields.project === "object" &&
          fields.project !== null
            ? ((fields.project as Record<string, unknown>).key as string | undefined)
            : undefined;
        const projectKey = project ?? "MOCK";
        if (!knownKeys.has(projectKey)) {
          return {
            status: 404,
            body: { errorMessages: [`project ${projectKey} not found`] },
          };
        }
        const issueNumber = nextIssueNumber;
        nextIssueNumber += 1;
        const issueKey = `${projectKey}-${issueNumber}`;
        const issue: XrayMockIssue = {
          id: `${issueNumber}`,
          key: issueKey,
          summary,
          status: "Active",
        };
        issues.set(issueKey, issue);
        if (idempotencyKey.length > 0) {
          idempotencyIndex.set(idempotencyKey, issueKey);
        }
        return {
          status: 201,
          body: { id: issue.id, key: issue.key },
        };
      },
    },
    {
      method: "GET",
      pathPattern: ISSUE_KEY_PATTERN,
      handler: ({ pathParams }): MockResponse => {
        const key = pathParams.key;
        if (key === undefined) {
          return { status: 400, body: { errorMessages: ["missing key"] } };
        }
        const issue = issues.get(key);
        if (issue === undefined) {
          return {
            status: 404,
            body: { errorMessages: [`issue ${key} not found`] },
          };
        }
        return {
          status: 200,
          body: {
            id: issue.id,
            key: issue.key,
            fields: { summary: issue.summary, status: { name: issue.status } },
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
  return Object.assign(handle, { issues });
};
