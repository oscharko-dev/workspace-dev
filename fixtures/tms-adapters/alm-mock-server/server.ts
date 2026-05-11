/**
 * Vendored OpenText / HP ALM mock server (Issue #2183, Wave 8).
 *
 * Implements the minimal surface required by `alm-adapter.ts`:
 *   - POST /authentication-point/authenticate            → mints LWSSO cookie
 *   - POST /qcbin/rest/site-session                      → mints QCSession + XSRF
 *   - GET  /qcbin/rest/domains/:d/projects/:p            → validateProject
 *   - GET  /qcbin/rest/domains/:d/projects/:p/tests?query=...  → idempotency lookup
 *   - POST /qcbin/rest/domains/:d/projects/:p/tests       → create
 *   - GET  /qcbin/rest/domains/:d/projects/:p/tests/:id   → poll
 *   - POST /qcbin/rest/site-session/sign-out             → disconnect
 *
 * Auth on `/authentication-point/authenticate`: any `Authorization`
 * header of the form `Bearer <token>` with a non-empty token is
 * accepted (the adapter sends Bearer for both PAT and Bearer kinds).
 * Subsequent requests must include the LWSSO + QCSession cookies.
 */

import {
  startMockServer,
  type MockResponse,
  type MockRoute,
  type MockServerHandle,
} from "../shared/mock-server.js";

export interface AlmMockHandle extends MockServerHandle {
  readonly tests: ReadonlyMap<string, AlmMockTest>;
}

export interface AlmMockTest {
  id: string;
  name: string;
  status: string;
}

const PROJECT_PATTERN =
  /^\/qcbin\/rest\/domains\/(?<domain>[^/]+)\/projects\/(?<project>[^/]+)$/;
const LIST_TESTS_PATTERN =
  /^\/qcbin\/rest\/domains\/(?<domain>[^/]+)\/projects\/(?<project>[^/]+)\/tests$/;
const READ_TEST_PATTERN =
  /^\/qcbin\/rest\/domains\/(?<domain>[^/]+)\/projects\/(?<project>[^/]+)\/tests\/(?<id>[^/]+)$/;

export interface StartAlmMockServerInput {
  knownProjects?: ReadonlyArray<{ domain: string; project: string }>;
}

const LWSSO_VALUE = "mock-lwsso";
const QC_SESSION_VALUE = "mock-qcsession";
const XSRF_VALUE = "mock-xsrf";

export const startAlmMockServer = async (
  input: StartAlmMockServerInput = {},
): Promise<AlmMockHandle> => {
  const knownProjects = new Set<string>(
    (input.knownProjects ?? [{ domain: "DEFAULT", project: "mock-project" }]).map(
      (p) => `${p.domain}/${p.project}`,
    ),
  );
  const tests = new Map<string, AlmMockTest>();
  let nextId = 1000;

  const routes: MockRoute[] = [
    {
      method: "POST",
      pathPattern: "/authentication-point/authenticate",
      handler: ({ request }): MockResponse => {
        const auth = request.headers.authorization;
        if (typeof auth !== "string" || !auth.startsWith("Bearer ") || auth.length <= 7) {
          return {
            status: 401,
            body: { Title: "auth rejected" },
          };
        }
        return {
          status: 200,
          headers: {
            "Set-Cookie": `LWSSO_COOKIE_KEY=${LWSSO_VALUE}; Path=/; HttpOnly`,
          },
        };
      },
    },
    {
      method: "POST",
      pathPattern: "/qcbin/rest/site-session",
      handler: ({ request }): MockResponse => {
        const cookie = request.headers.cookie;
        if (typeof cookie !== "string" || !cookie.includes(`LWSSO_COOKIE_KEY=${LWSSO_VALUE}`)) {
          return { status: 401, body: { Title: "missing LWSSO cookie" } };
        }
        return {
          status: 201,
          headers: {
            "Set-Cookie": `QCSession=${QC_SESSION_VALUE}; Path=/, XSRF-TOKEN=${XSRF_VALUE}; Path=/`,
          },
        };
      },
    },
    {
      method: "GET",
      pathPattern: PROJECT_PATTERN,
      handler: ({ pathParams }): MockResponse => {
        const key = `${pathParams.domain}/${pathParams.project}`;
        if (!knownProjects.has(key)) {
          return { status: 404, body: { Title: `project ${key} not found` } };
        }
        return {
          status: 200,
          body: { domain: pathParams.domain, name: pathParams.project },
        };
      },
    },
    {
      method: "GET",
      pathPattern: LIST_TESTS_PATTERN,
      handler: ({ url }): MockResponse => {
        const query = url.searchParams.get("query") ?? "";
        // Match the adapter's `{name[<value>]}` query shape. The
        // value may contain `[` and `]` (e.g. idempotency-prefixed
        // names like `[abc123] My Test`), so we anchor on `{name[`
        // ... `]}` and consume everything in between greedily.
        const match = /^\{name\[(?<name>.+)\]\}$/.exec(query);
        if (match === null) {
          return { status: 200, body: { entities: [] } };
        }
        const expected = match.groups?.name ?? "";
        const matches = Array.from(tests.values()).filter((t) => t.name === expected);
        return {
          status: 200,
          body: { entities: matches.map((m) => ({ id: m.id, name: m.name })) },
        };
      },
    },
    {
      method: "POST",
      pathPattern: LIST_TESTS_PATTERN,
      handler: ({ body, pathParams }): MockResponse => {
        const key = `${pathParams.domain}/${pathParams.project}`;
        if (!knownProjects.has(key)) {
          return { status: 404, body: { Title: `project ${key} not found` } };
        }
        if (typeof body !== "object" || body === null) {
          return { status: 400, body: { Title: "body required" } };
        }
        const name = (body as Record<string, unknown>).name;
        if (typeof name !== "string" || name.length === 0) {
          return { status: 400, body: { Title: "name required" } };
        }
        const id = String(nextId);
        nextId += 1;
        tests.set(id, { id, name, status: "Active" });
        return { status: 201, body: { id, name } };
      },
    },
    {
      method: "GET",
      pathPattern: READ_TEST_PATTERN,
      handler: ({ pathParams }): MockResponse => {
        const id = pathParams.id;
        if (id === undefined) {
          return { status: 400, body: { Title: "missing id" } };
        }
        const test = tests.get(id);
        if (test === undefined) {
          return { status: 404, body: { Title: `test ${id} not found` } };
        }
        return {
          status: 200,
          body: { id: test.id, name: test.name, status: test.status },
        };
      },
    },
    {
      method: "POST",
      pathPattern: "/qcbin/rest/site-session/sign-out",
      handler: (): MockResponse => ({ status: 200 }),
    },
  ];

  // ALM auth flow needs special handling — the first call has no
  // cookies and should pass auth; subsequent calls must include them.
  const handle = await startMockServer({
    routes,
    authPredicate: (req) => {
      const url = req.url ?? "";
      if (url.startsWith("/authentication-point/")) {
        return true;
      }
      if (url.startsWith("/qcbin/rest/site-session")) {
        // site-session requires LWSSO; sign-out requires QCSession.
        const cookie = req.headers.cookie;
        if (typeof cookie !== "string") return false;
        return cookie.includes(`LWSSO_COOKIE_KEY=${LWSSO_VALUE}`);
      }
      const cookie = req.headers.cookie;
      if (typeof cookie !== "string") return false;
      return (
        cookie.includes(`LWSSO_COOKIE_KEY=${LWSSO_VALUE}`) &&
        cookie.includes(`QCSession=${QC_SESSION_VALUE}`)
      );
    },
  });
  return Object.assign(handle, { tests });
};
