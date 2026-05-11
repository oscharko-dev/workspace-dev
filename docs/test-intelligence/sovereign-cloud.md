# Sovereign-cloud / Air-gap Deployment Profile

Issue #2187 (Wave 8) adds an end-to-end deployment topology for customers
that cannot run the test-intelligence harness against Microsoft Azure or
any other public-cloud LLM endpoint. The target customers are German
Sparkassen, Volksbanken, and on-prem-only insurers — roughly 30 % of the
regulated EU banking surface treated as either sovereign-cloud (STACKIT,
T-Systems Open Sovereign Cloud, OVHcloud sovereign) or fully air-gapped.

This profile is a **topology overlay**: every hard gate, threshold, and
audit signal from `eu-banking-default` still applies. The differences are
that all model traffic terminates on a customer-controlled gateway, no
public-cloud egress is permitted at runtime, and the Figma payload is
delivered to the harness pre-fetched.

## Deployment topology

```
┌──────────────────────────────┐         ┌─────────────────────────────────────┐
│  Connected machine           │         │  Air-gapped harness                 │
│  (outside the air-gap)       │         │  (sovereign-cloud / on-prem)        │
│                              │         │                                     │
│  workspace-dev               │ payload │  workspace-dev test-intelligence    │
│   test-intelligence          │────────▶│   run --figma-payload <path> ...    │
│   figma-export               │  .json  │                                     │
│   --figma-url <url>          │         │  HTTP egress refused except         │
│   --output figma-payload.json│         │  WORKSPACE_TEST_SPACE_AIR_GAP_      │
│                              │         │  ALLOWED_HOSTS                      │
└──────────────────────────────┘         │                                     │
                                         │  LLM calls → sovereign gateway      │
                                         │  (llm-gateway-sovereign.ts)         │
                                         │                                     │
                                         │  Replay cache: filesystem only      │
                                         │  (s3://, https://, gs:// refused)   │
                                         └─────────────────────────────────────┘
```

## Components

### 1. Policy profile `eu-banking-sovereign`

The profile is identified by
`EU_BANKING_SOVEREIGN_POLICY_PROFILE_ID = "eu-banking-sovereign"` and
version `1.0.0`. It inherits the **complete** `eu-banking-default` rule
set so:

- PII still blocks export.
- Regulated-data and financial-transaction risk categories are review-only.
- `G-NEG-CASE`, `G8_EU_REGION_ATTESTED`, faithfulness/a11y gates, and
  every other Wave 1–7 hard gate remain in force.
- Negative-case-lift, coverage, and faithfulness defaults are unchanged.

Sovereign customers narrow the attested region allow-list to the regions
covered by their contract via
`cloneEuBankingSovereignProfile({ allowedHostingRegions: [...] })`.
Typical configurations:

- STACKIT sovereign: `["eu-de-1"]`
- T-Systems Open Sovereign Cloud: `["eu-de-1"]` (Frankfurt) or
  `["eu-de-1", "eu-fr-1"]` (DE + FR active-active)
- OVHcloud sovereign: `["eu-fr-1"]` or `["eu-fr-1", "eu-west-3"]`
- On-prem with no public-cloud presence: any subset of
  `SUPPORTED_REGION_ATTESTATION_HOSTING_REGIONS` matching the customer's
  signed deployment manifest.

### 2. Sovereign LLM gateway adapter (`llm-gateway-sovereign.ts`)

The sovereign adapter is a thin wrapper around the existing
`createLlmGatewayClient`. It pins the configured `baseUrl` host into an
operator-supplied air-gap allow-list and routes every outbound HTTP call
through `createAirGapFetchGuard`. Every other behaviour — circuit
breaker, idempotency cache, in-flight deduplication, failure-class
taxonomy — is reused unchanged.

```ts
import { createSovereignLlmGatewayClient } from "@workspace-dev/test-intelligence";

const client = createSovereignLlmGatewayClient(
  {
    role: "test_generation",
    compatibilityMode: "openai_chat",
    baseUrl: "https://gpt-oss.sovereign.example.de/v1/chat/completions",
    deployment: "gpt-oss-120b-onprem",
    modelRevision: "stackit-2026-05",
    gatewayRelease: "sovereign-2026-05-11",
    authMode: "api_key",
    declaredCapabilities: { /* ... */ },
    timeoutMs: 30_000,
    maxRetries: 1,
    circuitBreaker: { failureThreshold: 4, resetTimeoutMs: 30_000 },
  },
  { apiKeyProvider: () => process.env.WORKSPACE_TEST_SPACE_LLM_API_KEY },
  { additionalAllowedHosts: ["telemetry.sovereign.example.de"] },
);
```

Outside strict air-gap mode the wrapper is a transparent pass-through,
so this is the recommended construction path for sovereign deployments
even during pre-rollout dry runs.

### 3. Air-gap mode (`WORKSPACE_TEST_SPACE_AIR_GAP_MODE=1`)

Setting the env flag to `1` / `true` / `yes` enables strict air-gap
enforcement across every subsystem that touches HTTP or filesystem:

| Subsystem                       | Strict-mode behaviour                                     |
|---------------------------------|-----------------------------------------------------------|
| `air-gap-guard.fetchGuard`      | Refuses every host not in allow-list (typed error)        |
| `llm-gateway-sovereign`         | Refuses public-cloud egress before the first socket opens |
| `replay-cache-persistent`       | Rejects `s3://`, `https://`, `gs://`, … as cache roots    |
| `region-attestation`            | Bypasses IMDS / TLS-probe and uses `sovereign-cloud`      |

The allow-list is supplied either as a comma-separated env list
(`WORKSPACE_TEST_SPACE_AIR_GAP_ALLOWED_HOSTS`) or programmatically via
the explicit `allowedHosts` / `additionalAllowedHosts` options on the
sovereign gateway. An empty allow-list refuses every request — this is
the secure default.

### 4. Figma-export CLI

```sh
# Run on a CONNECTED machine, outside the air-gap.
pnpm exec tsx src/cli.ts test-intelligence figma-export \
  --figma-url "https://www.figma.com/design/ABCDEF/Order-Flow?node-id=12-34" \
  --output ./figma-payload.json \
  --figma-token "$FIGMA_ACCESS_TOKEN"

# Carry the resulting figma-payload.json across the air-gap, then on the
# air-gapped harness:
WORKSPACE_TEST_SPACE_AIR_GAP_MODE=1 \
WORKSPACE_TEST_SPACE_AIR_GAP_ALLOWED_HOSTS=gpt-oss.sovereign.example.de \
WORKSPACE_TEST_SPACE_REGION_ATTESTED_REGION=eu-de-1 \
WORKSPACE_TEST_SPACE_REGION_ATTESTATION_SOVEREIGN_SOURCE=1 \
pnpm exec tsx src/cli.ts test-intelligence run \
  --figma-payload ./figma-payload.json \
  --output ./run \
  --policy-profile eu-banking-sovereign \
  # ... remaining run flags ...
```

The packaged payload is a `FigmaRestFileSnapshot` extended with a
`schemaVersion: "1.0.0"` and `exportedAt` ISO-8601 timestamp. The same
file works under both `--figma-payload` and the legacy
`--figma-json-file` flag; the alias exists so customer documentation
can use one shared term across the sovereign-cloud playbooks.

### 5. Region attestation

The W6-3 region-attestation layer (Issue #2177) is extended with a
`sovereign-cloud` attestation source. When operators set either
`WORKSPACE_TEST_SPACE_REGION_ATTESTATION_SOVEREIGN_SOURCE=1` or the
strict air-gap mode flag, the resolver:

1. Skips Azure IMDS (unreachable from the air-gap).
2. Skips TLS-certificate probing (the sovereign gateway typically uses a
   private CA whose SAN/CN does not encode the upstream region).
3. Trusts the pinned region from
   `WORKSPACE_TEST_SPACE_REGION_ATTESTED_REGION` and stamps the
   attestation as `attestedBy: "sovereign-cloud"`.

`sovereign-cloud` attestations are **not** flagged with
`severity: "warning"` (unlike `operator-pinned`). The operator-signed
deployment manifest embedded in the air-gapped image is treated as
first-class evidence equivalent in trust strength to Azure IMDS within
its own boundary.

### 6. Replay-cache filesystem-only enforcement

`createPersistentReplayCache(rootDir, options)` runs
`assertLocalFilesystemPath(rootDir)` at construction. Outside air-gap
mode this is a no-op. Inside air-gap mode, any root that parses as a
remote URL (`s3://`, `http://`, `https://`, `gs://`, `azure://`, `az://`,
`ftp://`, `sftp://`, `wasb(s)://`, `abfs(s)://`) is refused with
`AirGapResourceLocationError` so a misconfigured operator cannot
exfiltrate replay-cache content out of the sovereign boundary.

## Operator runbook

1. **Pre-rollout (connected)**
   - Install the harness on a connected machine.
   - Generate `figma-payload.json` via `test-intelligence figma-export`.
   - Carry the payload (and any compiled prompt artefacts) across the
     air-gap via the customer's approved transfer mechanism (signed
     USB, customer artefact store, SSCP).

2. **Air-gapped harness boot**
   - Set environment:
     ```
     WORKSPACE_TEST_SPACE_AIR_GAP_MODE=1
     WORKSPACE_TEST_SPACE_AIR_GAP_ALLOWED_HOSTS=<sovereign-host>
     WORKSPACE_TEST_SPACE_REGION_ATTESTATION_SOVEREIGN_SOURCE=1
     WORKSPACE_TEST_SPACE_REGION_ATTESTED_REGION=<eu-de-1|switzerland-north|…>
     WORKSPACE_TEST_SPACE_REGION_ATTESTATION_SIGNING_KEY=<signing-key>
     WORKSPACE_TEST_SPACE_LLM_API_KEY=<sovereign-gateway-key>
     ```
   - Verify the LLM gateway is reachable via the configured allow-list
     host; verify it refuses every other host (`curl` smoke test).

3. **Run**
   - Drive the harness via
     `workspace-dev test-intelligence run --figma-payload ... --policy-profile eu-banking-sovereign`.
   - Confirm the run bundle's region-attestation report records every
     deployment as `attestedBy: "sovereign-cloud"` in the contractually
     allowed regions; any `operator-pinned` row is a configuration bug.

## Failure modes

- **`AirGapNetworkPolicyError`** — the harness attempted an HTTP call to
  a host outside the allow-list. The error message names the URL and
  the env flag to set; do **not** broaden the allow-list without
  reviewing what the upstream call actually does. Most legitimate
  expansions are limited to the sovereign LLM gateway and an optional
  customer-controlled telemetry sink.
- **`AirGapResourceLocationError`** — a cache or artifact root was
  pointed at a remote scheme. Re-point to a local absolute path.
- **`Sovereign-cloud attestation enabled but no pinned region`** — the
  operator forgot to set `WORKSPACE_TEST_SPACE_REGION_ATTESTED_REGION`.
  Set it to the contractually attested region and re-run.
- **`G8_EU_REGION_ATTESTED failed for profile "eu-banking-sovereign"`**
  — a deployment served from a region outside the customer's
  contractually approved allow-list. Confirm the
  `allowedHostingRegions` on the policy-profile clone matches the
  customer contract and that the deployment manifest signed by the
  vendor matches the attested region.

## Scope

In scope: end-to-end harness operation under sovereign-cloud /
air-gapped conditions, policy parity with `eu-banking-default`,
auditable attestation surface, deterministic Figma payload handoff.

Out of scope: customer-deployment automation (Helm charts, Terraform),
hardware-attested key escrow / HSM integration, sovereign-cloud-specific
UI. Operators follow the standard deployment guide manually first; HSM
key handling falls back to the same filesystem-keys + operator
responsibility model the rest of the harness uses.
