# Changelog

All notable user-facing changes to `workspace-dev` are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Contract-level surface changes remain tracked in `CONTRACT_CHANGELOG.md`.

## [Unreleased]

### Changed
- Added explicit npm release-hardening metadata (`sideEffects`, publish quality scripts, REUSE metadata).
- Added CommonJS guard exports that fail fast with a clear migration message to ESM imports.
- Added package-local changesets release automation with OIDC and provenance publishing.

## [0.1.0] - 2026-03-11

### Added
- Initial `workspace-dev` package release for local mode-locked workspace validation.
- Public status and validation server endpoints (`/workspace`, `/healthz`, `/workspace/submit`).
- Runtime mode lock enforcement for `rest + deterministic`.
