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
