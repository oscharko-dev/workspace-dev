/**
 * Issue #2187 — sovereign-cloud / air-gap LLM gateway adapter.
 *
 * DE Sparkassen / Volksbanken / on-prem insurers cannot route requests
 * through Microsoft Azure OpenAI or any other public-cloud LLM endpoint.
 * Their deployments terminate at a sovereign-cloud gateway (STACKIT
 * Hosted GPT-OSS, T-Systems Open Sovereign Cloud, OVHcloud sovereign,
 * or a fully on-prem inference cluster) that exposes the same
 * OpenAI-compatible HTTP surface the standard `llm-gateway.ts` client
 * already understands.
 *
 * This module is a **thin wrapper** around {@link createLlmGatewayClient}
 * that:
 *
 *  1. Pins the `baseUrl` host into the air-gap fetch allow-list. Every
 *     other request emitted by the resulting client (incl. internal
 *     retries) is funnelled through a {@link createAirGapFetchGuard}
 *     instance, so a misconfigured deployment that points at a
 *     public-cloud URL fails closed *before* the first HTTP request.
 *  2. Reuses the existing circuit-breaker, idempotency-cache, and
 *     in-flight-dedup machinery — sovereign deployments inherit all of
 *     the harness's failure-class taxonomy and retry policy untouched.
 *
 * The wrapper does **not** change wire format, schema validation,
 * structured-output handling, or constrained decoding: those concerns
 * live in {@link createLlmGatewayClient} and remain identical so an
 * operator can A/B a sovereign deployment against the standard one
 * without changing test contracts.
 */

import type { LlmGatewayClientConfig } from "../contracts/index.js";
import { createAirGapFetchGuard } from "./air-gap-guard.js";
import {
  createLlmGatewayClient,
  type LlmGatewayClient,
  type LlmGatewayRuntime,
} from "./llm-gateway.js";

export interface SovereignLlmGatewayOptions {
  /**
   * Explicit list of hostnames the sovereign gateway is allowed to reach.
   * The `baseUrl` host is always added on top of this list, so an
   * operator that exposes only one endpoint can leave this empty. When
   * the deployment fronts the LLM behind a regional load balancer in
   * front of a private CA, list every hostname (LB + backing pool) here.
   */
  readonly additionalAllowedHosts?: readonly string[];
  /**
   * Override `process.env` (used by tests so they can assert behaviour
   * with `WORKSPACE_TEST_SPACE_AIR_GAP_MODE` set without mutating the
   * real environment).
   */
  readonly env?: NodeJS.ProcessEnv;
}

const extractHost = (baseUrl: string): string => {
  try {
    return new URL(baseUrl).hostname.toLowerCase();
  } catch {
    throw new RangeError(
      `createSovereignLlmGatewayClient: baseUrl "${baseUrl}" is not a valid absolute URL.`,
    );
  }
};

/**
 * Build an LLM gateway client targeting a sovereign-cloud or on-prem
 * endpoint. The returned client has the same shape as the one produced
 * by {@link createLlmGatewayClient}; the only operational difference is
 * that every outbound HTTP request is filtered by an air-gap fetch
 * guard whose allow-list is seeded from the configured `baseUrl`.
 *
 * When the operator has **not** enabled
 * `WORKSPACE_TEST_SPACE_AIR_GAP_MODE`, the guard is a transparent
 * pass-through and behaviour is byte-identical to the regular gateway
 * client. The wrapper therefore stays the recommended construction path
 * for any sovereign deployment, even pre-rollout dry runs.
 */
export const createSovereignLlmGatewayClient = (
  config: LlmGatewayClientConfig,
  runtime: LlmGatewayRuntime = {},
  options: SovereignLlmGatewayOptions = {},
): LlmGatewayClient => {
  const baseHost = extractHost(config.baseUrl);
  const env = options.env ?? process.env;
  const additional = (options.additionalAllowedHosts ?? []).map((entry) =>
    entry.trim().toLowerCase(),
  );
  const allowedHosts = Array.from(
    new Set([baseHost, ...additional.filter((entry) => entry.length > 0)]),
  );
  // Always install the guard. Outside air-gap mode it is a pass-through
  // so single construction path stays correct in both topologies. Inside
  // air-gap mode the operator may have left the env allow-list empty —
  // the gateway client is still functional because we seed the
  // allow-list from the explicit `baseUrl`.
  const guardedFetch = createAirGapFetchGuard({
    allowedHosts,
    env,
    ...(runtime.fetchImpl !== undefined ? { fetchImpl: runtime.fetchImpl } : {}),
  });
  const sovereignRuntime: LlmGatewayRuntime = {
    ...runtime,
    fetchImpl: guardedFetch,
  };
  return createLlmGatewayClient(config, sovereignRuntime);
};

/**
 * Convenience accessor for callers that want to know whether the
 * current runtime is operating under strict air-gap mode without
 * importing the env-flag module directly. Re-exported so the sovereign
 * gateway surface stays self-contained.
 */
export { isAirGapModeEnabled } from "./air-gap-guard.js";

/**
 * Re-export the typed error so callers can `instanceof`-narrow without
 * pulling in the air-gap module by name.
 */
export { AirGapNetworkPolicyError } from "./air-gap-guard.js";
