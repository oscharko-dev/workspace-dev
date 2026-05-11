/**
 * Default `node:fetch`-backed `TmsHttpClient` (Issue #2183, Wave 8).
 *
 * Resolves endpoint aliases via env vars (one per adapter), assembles
 * authentication headers, enforces a per-request timeout via
 * `AbortController`, and surfaces transport errors as
 * `TmsTransportError`. The client is intentionally minimal — adapters
 * own retry, idempotency-key composition, and TMS-specific error
 * classification.
 *
 * Endpoint resolution:
 *
 *   1. `WORKSPACE_TEST_SPACE_TMS_<NAME>_<ALIAS>_BASE_URL` — alias-specific.
 *   2. `WORKSPACE_TEST_SPACE_TMS_<NAME>_BASE_URL`         — adapter default.
 *
 * The alias path supports per-tenant deployments (e.g. `xray-eu-west-1`,
 * `xray-eu-central-1`) without the operator hard-coding URLs into the
 * mapping profile. The fallback applies when only one TMS endpoint is
 * configured. If neither is set, `request` throws
 * `TmsTransportError("endpoint_alias_unresolved")`.
 *
 * SSRF guard: the resolved URL MUST use the `https:` protocol (or
 * `http:` when the alias starts with `mock-` — used by the vendored
 * mock servers in `fixtures/tms-adapters/`). Anything else is refused
 * fail-closed.
 *
 * The client NEVER:
 *   - Logs the resolved URL.
 *   - Logs the credential token.
 *   - Persists request/response bodies.
 */

import { TMS_ADAPTER_ENV_NAMES } from "./tms-shared.js";
import {
  TmsAdapterError,
  TmsTransportError,
  type TmsCredentials,
  type TmsHttpClient,
  type TmsHttpRequest,
  type TmsHttpResponse,
} from "./tms-adapter-contract.js";
import { type TmsAdapterId } from "../../contracts/index.js";

/** Inputs for `createDefaultTmsHttpClient`. */
export interface CreateDefaultTmsHttpClientInput {
  adapterId: TmsAdapterId;
  /** Process env reference, injected so tests can pin it. */
  env: NodeJS.ProcessEnv;
  /** Optional fetch override (tests inject a deterministic stub). */
  fetchImpl?: typeof fetch;
}

const MOCK_ALIAS_PREFIX = "mock-";

/** Construct the default `TmsHttpClient` for the given adapter. */
export const createDefaultTmsHttpClient = (
  input: CreateDefaultTmsHttpClientInput,
): TmsHttpClient => {
  const fetchImpl = input.fetchImpl ?? globalThis.fetch.bind(globalThis);
  return {
    async request(req: TmsHttpRequest): Promise<TmsHttpResponse> {
      const baseUrl = resolveBaseUrl({
        adapterId: input.adapterId,
        env: input.env,
        endpointAlias: req.endpointAlias,
      });
      const url = buildUrl(baseUrl, req.path);
      assertSafeUrl(url, req.endpointAlias);
      const headers = buildHeaders(req);
      const init: RequestInit = {
        method: req.method,
        headers,
      };
      if (req.bodyBytes !== undefined) {
        init.body = req.bodyBytes;
      } else if (req.body !== undefined) {
        init.body = JSON.stringify(req.body);
      }
      const controller = new AbortController();
      const timer = setTimeout(() => {
        controller.abort();
      }, req.timeoutMs);
      init.signal = controller.signal;
      let response: Response;
      try {
        response = await fetchImpl(url.toString(), init);
      } catch (err) {
        clearTimeout(timer);
        const detail =
          err instanceof Error ? err.message : "transport failure";
        throw new TmsTransportError(input.adapterId, detail);
      } finally {
        clearTimeout(timer);
      }
      const respHeaders: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        respHeaders[key.toLowerCase()] = value;
      });
      const contentType = (respHeaders["content-type"] ?? "").toLowerCase();
      if (contentType.includes("application/json")) {
        let body: unknown;
        try {
          body = await response.json();
        } catch {
          body = undefined;
        }
        return {
          status: response.status,
          headers: respHeaders,
          body,
        };
      }
      let bytes: Uint8Array;
      try {
        bytes = new Uint8Array(await response.arrayBuffer());
      } catch (err) {
        throw new TmsTransportError(
          input.adapterId,
          err instanceof Error ? err.message : "response body read failed",
        );
      }
      return {
        status: response.status,
        headers: respHeaders,
        bodyBytes: bytes,
      };
    },
  };
};

const resolveBaseUrl = (input: {
  adapterId: TmsAdapterId;
  env: NodeJS.ProcessEnv;
  endpointAlias: string;
}): string => {
  const suffix = TMS_ADAPTER_ENV_NAMES[input.adapterId];
  const aliasUpper = input.endpointAlias
    .replace(/[^A-Za-z0-9]+/g, "_")
    .toUpperCase();
  const aliasName = `WORKSPACE_TEST_SPACE_TMS_${suffix}_${aliasUpper}_BASE_URL`;
  const defaultName = `WORKSPACE_TEST_SPACE_TMS_${suffix}_BASE_URL`;
  const aliasUrl = nonEmptyEnv(input.env, aliasName);
  if (aliasUrl !== undefined) return aliasUrl;
  const defaultUrl = nonEmptyEnv(input.env, defaultName);
  if (defaultUrl !== undefined) return defaultUrl;
  throw new TmsTransportError(
    input.adapterId,
    `endpoint_alias_unresolved: set ${aliasName} or ${defaultName}`,
  );
};

const nonEmptyEnv = (
  env: NodeJS.ProcessEnv,
  name: string,
): string | undefined => {
  const raw = env[name];
  if (typeof raw !== "string") return undefined;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const buildUrl = (baseUrl: string, path: string): URL => {
  const trimmedBase = baseUrl.replace(/\/+$/, "");
  const normalisedPath = path.startsWith("/") ? path : `/${path}`;
  return new URL(`${trimmedBase}${normalisedPath}`);
};

const assertSafeUrl = (url: URL, endpointAlias: string): void => {
  const isMock = endpointAlias.startsWith(MOCK_ALIAS_PREFIX);
  if (url.protocol === "https:") return;
  if (isMock && url.protocol === "http:") return;
  throw new TmsAdapterError(
    "alm",
    "ssrf_refused",
    `refused non-https endpoint ${url.protocol} for alias ${endpointAlias}`,
  );
};

const buildHeaders = (req: TmsHttpRequest): Headers => {
  const headers = new Headers();
  if (req.headers !== undefined) {
    for (const [name, value] of Object.entries(req.headers)) {
      headers.set(name, value);
    }
  }
  if (req.bodyBytes !== undefined && req.contentType !== undefined) {
    headers.set("Content-Type", req.contentType);
  } else if (req.body !== undefined && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  if (!headers.has("Accept")) {
    headers.set("Accept", "application/json");
  }
  if (req.idempotencyKey !== undefined) {
    headers.set("Idempotency-Key", req.idempotencyKey);
  }
  applyAuthHeader(headers, req.credentials);
  return headers;
};

const applyAuthHeader = (
  headers: Headers,
  credentials: TmsCredentials,
): void => {
  switch (credentials.kind) {
    case "pat":
    case "bearer":
      headers.set("Authorization", `Bearer ${credentials.token}`);
      return;
    case "oauth2":
      headers.set("Authorization", `Bearer ${credentials.accessToken}`);
      return;
    default: {
      // Exhaustive switch — `credentials` narrows to `never` here. We
      // still surface a typed error in case a hostile caller tunnels
      // an unknown discriminant past the type system.
      throw new TmsAdapterError(
        "alm",
        "unsupported_auth_kind",
        `unsupported credential kind: ${(credentials as { kind?: string }).kind ?? "unknown"}`,
      );
    }
  }
};
