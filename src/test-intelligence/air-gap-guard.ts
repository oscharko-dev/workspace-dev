/**
 * Issue #2187 — sovereign-cloud / air-gap deployment guard.
 *
 * Customer deployments at DE Sparkassen / Volksbanken / on-prem insurers
 * run the harness inside a hermetic network boundary: the runtime must
 * **prove** that no public-cloud egress (Azure OpenAI, Figma REST, AWS S3,
 * public model gateways) can leak when the operator flips on
 * `WORKSPACE_TEST_SPACE_AIR_GAP_MODE=1`.
 *
 * Two guards land in this module:
 *
 * 1. {@link createAirGapFetchGuard} — wraps a `fetch` implementation. Any
 *    URL whose host is not in the operator-provided allow-list is refused
 *    with a typed {@link AirGapNetworkPolicyError}. The error message
 *    names the URL and the env flag so operators can diagnose the
 *    violation from one line of audit log.
 * 2. {@link assertLocalFilesystemPath} — refuses cache / artifact roots
 *    that look like remote resources (`s3://`, `http://`, `https://`,
 *    `gs://`, `azure://`, …). Used by `replay-cache-persistent` and other
 *    file-rooted subsystems to fail closed when the operator misconfigures
 *    a remote backend under air-gap mode.
 *
 * The guard fails closed: when `AIR_GAP_MODE=1`, every HTTP request must
 * resolve to a host in the explicit allow-list (typically only the on-prem
 * LLM gateway hostname) or it is rejected. The IMDS endpoint
 * (`169.254.169.254`) is implicitly refused because it is a public-cloud
 * affordance — sovereign-cloud topologies must use the
 * `sovereign-cloud` region-attestation source instead (see
 * `region-attestation.ts`).
 */

/** Env flag operators set to `"1"` (or `"true"`) to enable strict air-gap mode. */
export const AIR_GAP_MODE_ENV =
  "WORKSPACE_TEST_SPACE_AIR_GAP_MODE" as const;

/**
 * Optional comma-separated env flag listing hostnames the air-gapped
 * runtime is allowed to call. Empty / unset = refuse every HTTP request.
 * Typical sovereign-cloud configurations list exactly one entry
 * (the on-prem LLM-gateway hostname).
 */
export const AIR_GAP_ALLOWED_HOSTS_ENV =
  "WORKSPACE_TEST_SPACE_AIR_GAP_ALLOWED_HOSTS" as const;

/** Typed error raised when an HTTP request is refused by the air-gap guard. */
export class AirGapNetworkPolicyError extends Error {
  readonly url: string;
  constructor(url: string, reason: string) {
    super(
      `Air-gap mode refused HTTP request to "${url}": ${reason}. ` +
        `Set ${AIR_GAP_ALLOWED_HOSTS_ENV} to the comma-separated list of ` +
        `permitted hostnames, or clear ${AIR_GAP_MODE_ENV} to disable the guard.`,
    );
    this.name = "AirGapNetworkPolicyError";
    this.url = url;
  }
}

/** Typed error raised when a filesystem-or-resource path is rejected. */
export class AirGapResourceLocationError extends Error {
  readonly location: string;
  constructor(location: string, reason: string) {
    super(
      `Air-gap mode refused non-local resource "${location}": ${reason}. ` +
        `Provide a local absolute filesystem path or clear ${AIR_GAP_MODE_ENV}.`,
    );
    this.name = "AirGapResourceLocationError";
    this.location = location;
  }
}

const truthy = (value: string | undefined): boolean => {
  if (value === undefined) return false;
  const lowered = value.trim().toLowerCase();
  return lowered === "1" || lowered === "true" || lowered === "yes";
};

/** Returns `true` when the operator has set the strict air-gap env flag. */
export const isAirGapModeEnabled = (
  env: NodeJS.ProcessEnv = process.env,
): boolean => truthy(env[AIR_GAP_MODE_ENV]);

/**
 * Parse the optional allowed-hosts env flag into a normalised set of
 * lowercase hostnames. Operators provide a comma-separated list; empty
 * tokens are dropped.
 */
export const readAirGapAllowedHosts = (
  env: NodeJS.ProcessEnv = process.env,
): readonly string[] => {
  const raw = env[AIR_GAP_ALLOWED_HOSTS_ENV];
  if (raw === undefined) return [];
  return raw
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry.length > 0);
};

const extractHost = (
  resource: Parameters<typeof fetch>[0],
): { host: string; href: string } | undefined => {
  const href =
    typeof resource === "string"
      ? resource
      : resource instanceof URL
        ? resource.toString()
        : // Request — read .url (Request type avoids cross-realm globals).
          (resource as { url?: unknown }).url instanceof String ||
            typeof (resource as { url?: unknown }).url === "string"
          ? (resource as { url: string }).url
          : "";
  if (href.length === 0) return undefined;
  // Allow data: URIs and explicit blob: schemes (no network egress).
  if (href.startsWith("data:") || href.startsWith("blob:")) {
    return undefined;
  }
  try {
    const url = new URL(href);
    return { host: url.hostname.toLowerCase(), href: url.toString() };
  } catch {
    // Relative URL with no base — disallow under air-gap mode.
    return { host: "", href };
  }
};

export interface AirGapFetchGuardOptions {
  /** Hostnames the wrapped fetch is allowed to reach. */
  readonly allowedHosts?: readonly string[];
  /** Override `process.env` (used by tests). */
  readonly env?: NodeJS.ProcessEnv;
  /**
   * Optional underlying fetch. Defaults to `globalThis.fetch`. The guard
   * never instantiates a new HTTP client; it only filters which requests
   * are forwarded to the inner implementation.
   */
  readonly fetchImpl?: typeof fetch;
}

/**
 * Wrap a `fetch` implementation so every outbound request is checked
 * against the operator's air-gap policy. When
 * {@link AIR_GAP_MODE_ENV} is `"1"`, hosts outside the allow-list throw
 * {@link AirGapNetworkPolicyError} *before* the inner fetch is invoked —
 * the wrapped client never opens a socket.
 *
 * When air-gap mode is **not** enabled the wrapper is a transparent
 * pass-through, so production callers can install the guard once at
 * startup without conditional branches.
 */
export const createAirGapFetchGuard = (
  options: AirGapFetchGuardOptions = {},
): typeof fetch => {
  const env = options.env ?? process.env;
  const inner = options.fetchImpl ?? globalThis.fetch;
  if (typeof inner !== "function") {
    throw new TypeError(
      "createAirGapFetchGuard: no fetch implementation available (pass " +
        "fetchImpl explicitly or run on a runtime that provides globalThis.fetch).",
    );
  }
  const explicitHosts = (options.allowedHosts ?? []).map((host) =>
    host.toLowerCase(),
  );

  const guarded: typeof fetch = async (
    input: Parameters<typeof fetch>[0],
    init?: RequestInit,
  ) => {
    if (!isAirGapModeEnabled(env)) {
      return inner(input, init);
    }
    const extracted = extractHost(input);
    if (extracted === undefined) {
      // Non-network scheme (data:, blob:) — allowed.
      return inner(input, init);
    }
    if (extracted.host.length === 0) {
      throw new AirGapNetworkPolicyError(
        extracted.href,
        "request URL is relative or unparseable under air-gap mode",
      );
    }
    const allowList = explicitHosts.length > 0
      ? explicitHosts
      : readAirGapAllowedHosts(env);
    if (allowList.includes(extracted.host)) {
      return inner(input, init);
    }
    throw new AirGapNetworkPolicyError(
      extracted.href,
      `host "${extracted.host}" is not in the air-gap allow-list ` +
        `(allowed: ${allowList.length === 0 ? "<empty>" : allowList.join(", ")})`,
    );
  };
  return guarded;
};

const REMOTE_SCHEMES = [
  "s3:",
  "http:",
  "https:",
  "gs:",
  "azure:",
  "az:",
  "ftp:",
  "ftps:",
  "sftp:",
  "wasb:",
  "wasbs:",
  "abfs:",
  "abfss:",
] as const;

/**
 * Reject filesystem / cache / artifact roots that point at a remote
 * resource. Pure path inputs (absolute or relative POSIX/Windows paths)
 * are accepted; anything that parses as a URL with one of the remote
 * schemes in {@link REMOTE_SCHEMES} raises
 * {@link AirGapResourceLocationError}.
 *
 * Idempotent and side-effect-free; safe to call from constructors.
 */
export const assertLocalFilesystemPath = (
  location: string,
  options: { env?: NodeJS.ProcessEnv; subsystem?: string } = {},
): void => {
  const env = options.env ?? process.env;
  if (!isAirGapModeEnabled(env)) return;
  const trimmed = location.trim();
  if (trimmed.length === 0) {
    throw new AirGapResourceLocationError(
      location,
      `${options.subsystem ?? "resource"} path is empty`,
    );
  }
  const lowered = trimmed.toLowerCase();
  for (const scheme of REMOTE_SCHEMES) {
    if (lowered.startsWith(scheme)) {
      throw new AirGapResourceLocationError(
        location,
        `${options.subsystem ?? "resource"} uses remote scheme "${scheme}"`,
      );
    }
  }
};
