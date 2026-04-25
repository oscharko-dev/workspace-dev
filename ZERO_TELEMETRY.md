# ZERO_TELEMETRY

`workspace-dev` follows a zero-telemetry policy for runtime usage data.

## Policy Statement

- The package does not emit runtime analytics, usage metrics, or behavioral telemetry to external services.
- No user-identifying runtime payloads are transmitted by default.
- Network calls are not performed for telemetry collection.

## Allowed Exceptions

- CI release evidence uploads performed by GitHub Actions (SBOM artifacts under `artifacts/sbom/`).
- Manual incident reporting initiated by operators outside package runtime.

## Verification Procedure

1. Run static telemetry guard on every release:
    - `pnpm run lint:no-telemetry`
2. Validate publish artifact contents with `scripts/validate-pack.sh`.
3. Verify workflows only upload release evidence artifacts and do not post runtime usage data.

## Test-intelligence subsurface boundary

The opt-in test-intelligence subsurface (see [docs/test-intelligence.md](docs/test-intelligence.md)) does not change the zero-telemetry posture of the package. The bundled CI gate (`pnpm run test:ti-eval`) uses a deterministic mock LLM and fixture captures and performs no outbound network calls. The only test-intelligence code paths that may reach the public network are:

- Operator-controlled gateway endpoints for the `gpt-oss-120b`, `llama-4-maverick-vision`, and `phi-4-multimodal-poc` deployments, when the operator explicitly opts in via the role-specific `WORKSPACE_TEST_SPACE_*` environment variables documented in [docs/local-runtime.md](docs/local-runtime.md).
- The optional live smoke (`pnpm run test:ti-live-smoke`), gated by `WORKSPACE_TEST_SPACE_LIVE_SMOKE=1` plus the role-specific endpoint, deployment, and API key environment variables. The live smoke is intended for operator-controlled integration verification and is never run by default CI.

These outbound paths target operator-controlled inference endpoints, not telemetry collectors. They carry prompt and capture data scoped to the active job and never carry analytics, usage metrics, or behavioral telemetry. Endpoints, deployment names, and API keys are read at request time via injected providers; they are never embedded in package source and never persisted to artifacts.
