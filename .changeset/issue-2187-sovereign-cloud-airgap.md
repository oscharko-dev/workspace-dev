---
"workspace-dev": minor
---

Add sovereign-cloud / air-gap deployment profile for Issue #2187 (Wave 8).

DE Sparkassen, Volksbanken, and on-prem-only insurers can now run the
test-intelligence harness without any internet connectivity to public
Azure / external LLM endpoints. The standard EU banking compliance gate
(`eu-banking-default`) is unchanged; the new topology overlay adds:

- **Policy profile `eu-banking-sovereign`** (id + version distinct from
  default; rule set inherits the full default profile so every Wave 1–7
  hard gate stays in force). `cloneEuBankingSovereignProfile({ allowedHostingRegions })`
  narrows the attested region allow-list to the customer's contract.
- **`createSovereignLlmGatewayClient`** in `llm-gateway-sovereign.ts` —
  thin wrapper around `createLlmGatewayClient` that pins the `baseUrl`
  host into an air-gap fetch allow-list. Reuses the existing
  circuit-breaker, idempotency, and failure-class taxonomy unchanged.
- **`WORKSPACE_TEST_SPACE_AIR_GAP_MODE=1`** strict env flag and
  `air-gap-guard.ts` utilities (`createAirGapFetchGuard`,
  `assertLocalFilesystemPath`). Refuses every HTTP request outside the
  operator-configured allow-list and rejects `s3://`, `https://`,
  `gs://`, … as replay-cache roots.
- **`workspace-dev test-intelligence figma-export`** sub-command —
  runs on a connected machine, packages the Figma payload as
  `figma-payload.json` for the air-gapped harness, which consumes it
  via the new `--figma-payload <path>` alias of `--figma-json-file`.
- **`sovereign-cloud` region-attestation source** — extends W6-3
  with a first-class attestation label for sovereign-cloud / on-prem
  deployments that don't implement Azure IMDS. Driven by
  `WORKSPACE_TEST_SPACE_REGION_ATTESTATION_SOVEREIGN_SOURCE=1` or
  implied by strict air-gap mode.
- **CI air-gap smoke (`pnpm run test:ti-airgap-smoke`)** — runs every
  air-gap-mode invariant test under the strict env flag so a
  silently-leaking HTTP call fails the build.
- **Documentation** — `docs/test-intelligence/sovereign-cloud.md`
  covers deployment topology, env flags, operator runbook, and
  failure modes.

No regression on G1–G7 + G8 + G9 hard gates for the default profile.
