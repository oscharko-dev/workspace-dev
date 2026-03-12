# ARCHITECTURE

## Purpose

`workspace-dev` is a local-only developer runtime for FigmaPipe contract validation.
It provides deterministic HTTP behavior for:

- `GET /workspace`
- `GET /healthz`
- `POST /workspace/submit` (validation + mode lock only)

Execution of Figma fetch, LLM code generation, and filesystem output is intentionally out of scope.

## Runtime Architecture (Zero Runtime Dependencies)

- Network stack: Node.js built-ins (`node:http`, `URL`, `fetch` for local inject testing only).
- Validation stack: internal manual schema validators (`src/schemas.ts`).
- Process isolation: per-project child processes (`src/isolation.ts` + `src/isolated-server-entry.ts`).
- No external runtime packages in `dependencies`.

This design is intentional for enterprise air-gap compatibility and supply-chain minimization.

## Module and Artifact Strategy

- Build tool: `tsup`.
- Outputs:
  - ESM: `dist/**/*.js`
  - CJS: `dist/**/*.cjs`
  - Type declarations:
    - ESM types: `dist/**/*.d.ts`
    - CJS types: `dist/**/*.d.cts`
- Package exports use split `import`/`require` conditions with matching type conditions.

This provides true dual ESM/CJS interoperability without guard-throw wrappers.

## Security Boundaries and Threat Assumptions

- Default bind host is `127.0.0.1`.
- Mode lock is enforced at runtime:
  - `figmaSourceMode=rest`
  - `llmCodegenMode=deterministic`
- Request body size is limited to 1 MiB.
- Error messages are sanitized before emission to reduce accidental PII or secret leakage.
- No telemetry or call-home SDKs are permitted (`lint:no-telemetry`).

Threat model assumptions:

- The process runs in trusted local developer environments.
- Host-level compromise is out of scope.
- Network-exposed production deployment is out of scope for this package.

## Air-Gap and Install Behavior

- No `preinstall`/`install`/`postinstall` scripts.
- Zero runtime dependencies.
- Offline installation from packed tarball is verified via `verify:airgap`.
- SBOM generation (CycloneDX + SPDX) is provided for release evidence.

## Reproducibility and Compliance Controls

- Reproducible build check: `verify:reproducible-build`.
- License allowlist gate for package/runtime tree: `verify:licenses`.
- FIPS smoke gate (skip when host OpenSSL FIPS module is unavailable): `verify:fips`.
- OIDC trusted publishing + provenance via CI workflows and `publishConfig.provenance=true`.
