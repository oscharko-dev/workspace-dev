# Changelog

All notable user-facing changes to `workspace-dev` are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Contract-level surface changes remain tracked in `CONTRACT_CHANGELOG.md`.

## [Unreleased]

### Added

- Test Intelligence — explicit synthetic oracle provenance replaces
  redaction-token-only semantics for deterministic test-data entries
  (#2106):
    - `OracleValue` now carries `synthetic: true` so deterministic
      oracle emissions can be identified structurally instead of only via
      the legacy `[REDACTED:DOC_EXAMPLE]` suffix.
    - The oracle governance report now persists per-entry synthetic
      provenance, including the migration note
      `"synthesized by deterministic oracle"` and a test-data-index
      context that the validator can consult explicitly.
    - `validatePiiInTextFields` now skips PII detection for
      oracle-governed synthetic entries via that provenance context
      rather than relying solely on token-shape heuristics.
    - The legacy `[REDACTED:DOC_EXAMPLE]` rendering remains dual-emitted
      for one migration sprint for documentation examples and ISO
      date/datetime oracle samples; downstream consumers should migrate
      to the structural `synthetic` provenance signal before the suffix
      is removed.

- Test Intelligence — llguidance constrained-decoding adapter for the
  `openai_chat` transport (#2065):
    - New transport-specific adapter under
      `src/test-intelligence/constrained-decoding/openai-chat-adapter.ts`
      that implements the existing `ConstrainedDecodingAdapter` contract
      using the `openai_chat` transport's tool-calling and
      `response_format=json_schema` hooks. Both Outlines-style
      (FSM-bound) and llguidance-style (provider-bound) integrations
      sit behind the same internal contract and resolve with
      `enforcement: "provider"`.
    - Adapter selection is automatic and deterministic: when the
      deployment is reachable via `openai_chat` and the operator config
      prefers `llguidance` or `outlines`, the new adapter is used;
      otherwise the legacy registry resolves (e.g.
      `openai_json_schema`), and transports without a constrained mode
      fall back gracefully with a redacted `fallbackReason`.
    - `LlmConstrainedDecodingMetadata.adapterVersion` is now populated
      on every resolved metadata record (success and fallback paths)
      so FinOps and provenance graphs always have a deterministic
      version pin to correlate cost/quality shifts with adapter
      rollouts.
    - `CONTRACT_VERSION` bumps from `4.56.0` to `4.57.0`;
      `TEST_INTELLIGENCE_CONTRACT_VERSION` bumps from `1.17.0` to
      `1.18.0` (additive — new exported module, new runtime constants,
      no removals or renames).
    - Documentation: `docs/test-intelligence/constrained-decoding.md`.

- Test Intelligence — 2026-Q3 Innovation Roadmap epic closure (#2034):
    - Closure ADR (`docs/decisions/2026-05-08-issue-2034-ti-2026-q3-innovation-roadmap-closure.md`)
      records the AC-traceability matrix for all eight epic acceptance
      criteria and links the ten child issues (#2035–#2044) shipped
      across Wave 1 (action topology, schema-first decoding, W3C PROV-DM
      provenance), Wave 2 (cross-family judge ensemble + human review,
      adversarial-critic self-play, property-based invariants,
      mutation-killing eval), and Wave 3 (compliance-as-code rule packs,
      cost-aware smart routing, DSPy-style prompt optimization).
    - DPIA §3.7.1 (`docs/test-intelligence-dpia-production-runner.md`)
      now documents the closed set of multi-agent harness agent roles,
      including the three roles introduced by this epic
      (`action_topology` from #2035, `human_review` from #2038, and
      `adversarial_critic` from #2039 / #2052 / #2053). The new
      sub-section restates the LLM-role capability invariant
      (`LLM_ROLE_FORBIDDEN_CAPABILITIES = ["propose_changes"]`) and the
      `ictRegisterRef` requirement under `eu-banking-default`.
    - No `CONTRACT_VERSION` bump: every contract surface used by the
      epic was bumped in the originating wave PRs and is reflected in
      `CONTRACT_CHANGELOG.md` and `COMPATIBILITY.md`. KPI thresholds
      (`mutationKillRate >= 0.85`, `actionCoverage.ratio >= 0.7`,
      `G-NEG-CASE >= 0.30`) remain enforced by the contract constants
      in `src/contracts/index.ts` and the `eu-banking-default` policy
      profile.

- OSS default demo and documentation story completion (#1532):
    - The default pipeline now has a synthetic, OSS-neutral financial demo
      fixture pack covering global banking dashboard, payment authorization
      card, login/MFA, transaction table, risk alert modal, mobile navigation,
      token-heavy board, forms, responsive layout, and unsupported-node
      evidence scenarios.
    - Maintainer and evaluator docs now cover local install, token-free
      `local_json` / paste / plugin source modes, default-vs-Rocket pipeline
      selection, quality-passport evidence, troubleshooting, future pipeline
      authoring, package-profile boundaries, and Rocket migration guidance.
- Pipeline quality passport story completion (#1529):
    - Jobs now persist deterministic `quality-passport.json` evidence even
      when a pipeline fails before `validate.project`; successful validation
      passports remain unchanged, while early-failure passports record the
      failed stage, failure code, available stage state, generated-file
      evidence, and warning summary.
    - Release evidence now generates and verifies separate SBOM pairs for the
      shipped React MUI and React Tailwind generated-app templates.
- Default design-token compiler output (#1546):
    - Generated apps now include deterministic `src/theme/tokens.css` CSS
      custom properties and `src/theme/token-report.json` coverage evidence
      beside the existing `src/theme/tokens.json` artifact.
    - The token bridge now classifies and emits border, shadow, and z-index
      token variables in addition to color, typography, spacing, radius, size,
      and opacity variables.
- OSS default React + TypeScript + Tailwind template story completion (#1525):
    - `template/react-tailwind-app/` now ships as a private Vite React TS
      template with Tailwind CSS v4 through `@tailwindcss/vite`, strict
      DOM/JSX TypeScript settings, `.tsx` entrypoints, Vitest, Testing Library,
      ESLint, Playwright UI validation, and performance baseline/assertion
      scripts.
    - Root template gates install, lint, typecheck, test, build, validate UI,
      run Playwright validation, assert performance budgets, and enforce the
      default-template dependency denylist for the OSS template path.
- Default Tailwind template dependency denylist gate:
    - `pnpm run template:tailwind:dependency-denylist` now blocks direct
      MUI, Emotion, customer/Rocket, telemetry SDK, and unreviewed static
      asset additions to `template/react-tailwind-app/`.
    - Release quality gates run the denylist after the Tailwind template
      frozen-lockfile install, and template maintenance docs describe the
      review workflow for future template dependency or asset changes. (#1545)

- Wave 4 multi-source test-intent ingestion — Jira REST, paste-only Jira,
  and reviewer Markdown/structured-attribute custom context (#1431–#1439):
    - Three new primary-and-supporting source paths: `jira_rest` (Jira Cloud
      / Data Center / OAuth 2.0), `jira_paste` (air-gap safe; no outbound
      API calls), and `custom_text` / `custom_structured` (reviewer-authored
      supporting evidence).
    - Dual-gate: `FIGMAPIPE_WORKSPACE_TEST_INTELLIGENCE_MULTISOURCE=1` plus
      `testIntelligence.multiSourceEnabled: true`; fails closed before any
      source artifact is persisted.
    - Jira IR (`jira-issue-ir.json`) is canonical, PII-redacted, and
      deterministically hashed; ADF documents are parsed in memory and
      discarded. Byte caps: description 32 KiB, comment body 4 KiB, ADF
      input 1 MiB, REST calls 20 per job, paste budget 512 KiB per job.
    - Custom context Markdown is parsed with a strict allow-list subset
      (headings, lists, tables, blockquotes, inline code, fenced code blocks,
      emphasis, links with redacted hrefs); raw HTML, `javascript:`, and
      private-host URLs are rejected fail-closed.
    - Source reconciliation (Wave 4.F): conflict-resolution policy
      (`priority` / `reviewer_decides` / `keep_both`); conflicts persisted
      as `multi-source-conflicts.json`; four-eyes review triggered on
      `multi_source_conflict_present`.
    - Wave 4 production-readiness gate: `runWave4ProductionReadiness` +
      `evaluateWave4ProductionReadiness` wired into `pnpm run test:ti-eval`.
    - Single-source Figma-only jobs unchanged; backward-compatible in all
      Wave 1–3 artifact paths.
- Compliance and operations documentation for Wave 4 multi-source (#1440):
    - GDPR DPIA addenda: `docs/dpia/jira-source.md` and
      `docs/dpia/custom-context-source.md` — per-artifact data category
      and redaction tables, legal basis, retention, and DPO escalation.
    - Operator runbooks: `docs/runbooks/jira-source-setup.md` (Jira Cloud /
      Data Center / OAuth 2.0 setup, least-privilege scopes, token rotation,
      SSRF allow-list, end-to-end verification) and
      `docs/runbooks/multi-source-air-gap.md` (paste-only deployment,
      reviewer onboarding, Markdown editor guidance, paste-collision
      resolution, evidence-export-only workflow).
    - DORA mapping: `docs/dora/multi-source.md` — Art. 6/8/9/28 mapping,
      register-of-information template entry for Jira Cloud as ICT
      third-party, supply-chain integrity notes.
    - EU AI Act: `docs/eu-ai-act/human-oversight.md` — how the conflict-
      resolution gate and four-eyes trigger on `multi_source_conflict_present`
      discharge Art. 14 human oversight requirements.
    - Public API reference: `docs/api/test-intelligence-multi-source.md` —
      feature-flag matrix, source-mix decision table, envelope/Jira IR/
      reconciliation contract shapes, full HTTP route reference, worked
      request/response examples for Jira REST-only, paste-only, Figma+Jira,
      primary+custom, and Markdown+Jira-only jobs.
    - Migration note: `docs/migration/wave-4-additive.md` — additive contract
      diff, artifact tree additions, fallback rules, migration checklist.
    - Architecture diagram: `docs/architecture/multi-source-flow.mmd` —
      Mermaid source for the source-merge flow.

- Wave 1 Figma-to-Test end-to-end POC harness, evidence manifest, and CI evaluation gate (#1366):
    - Two public synthetic fixtures under `src/test-intelligence/fixtures/` — `poc-onboarding` (sign-up + identity verification) and `poc-payment-auth` (SEPA payment + 3-D Secure authorisation) — each shipped with a companion visual sidecar fixture.
    - `runWave1Poc(input)` composes the full chain (Figma → IR → redacted prompt → mock LLM → validation → review gate → export-only QC artifacts) into a deterministic run directory; replay produces byte-identical artifact hashes for the same fixture.
    - `wave1-poc-evidence-manifest.json` records SHA-256 + byte length for every emitted artifact, plus the prompt / schema / model / policy / export profile identities used during the run. `verifyWave1PocEvidenceManifest` and `verifyWave1PocEvidenceFromDisk` re-hash artifacts to detect tampering fail-closed.
    - Two type-level negative invariants are stamped on every manifest: `rawScreenshotsIncluded: false` and `imagePayloadSentToTestGeneration: false`. The harness additionally asserts the recorded mock-LLM requests carried no image payloads — `gpt-oss-120b` never receives screenshots.
    - `evaluateWave1Poc` enforces threshold-driven pass/fail across trace coverage (fields/actions/validations), QC mapping completeness, duplicate similarity, expected-results-per-case count, and policy/visual/export gate outcomes. Default thresholds match `eu-banking-default`.
    - New `pnpm run test:ti-eval` script runs the POC end-to-end + golden + verification + threshold tests; wired into the `dev-quality-gate` workflow.
- Onboarding and troubleshooting guide for the direct Figma import path at [`docs/figma-import.md`](docs/figma-import.md): Figma plugin install steps (Design and Dev Mode), Inspector paste-zone behaviour (paste / drop / upload), SmartBanner intent labels and override flow, payload-size limits, an example `workspace-dev/figma-selection@1` envelope, a REST `JSON_REST_V1` skeleton, FAQ, and a troubleshooting matrix covering "nothing happens on ⌘V/Ctrl+V", invalid JSON, unrecognised component, payload too large, and secure-context requirements. (#990)
- Incremental delta import scaffolding for Figma paste imports (#992):
    - Persistent paste-fingerprint store keyed by `{figmaFileKey, rootNodeIds}` under `${outputRoot}/paste-fingerprints/` (LRU + TTL, contract-version gated).
    - Tree-diff module classifies node changes as `baseline_created`, `no_changes`, `delta`, or `structural_break` with a configurable structural-change threshold (default 0.5).
    - New submit-time field `WorkspaceJobInput.importMode?: "full" | "delta" | "auto"`; auto mode falls back to full when the diff exceeds the threshold or when no prior manifest exists.
    - `WorkspaceSubmitAccepted.pasteDeltaSummary` returns mode, strategy, `nodesReused`, `nodesReprocessed`, structural ratio, and paste identity key so clients can render delta insight immediately on accept.
    - Inspector paste-pipeline now surfaces a "Delta Update" vs "Full Build" badge with an "N/M reused" detail on the pipeline status bar.
- Template web-performance pipeline:
    - `perf-budget.json` policy
    - `scripts/perf-runner.mjs`
    - scripts `perf:baseline` and `perf:assert`
- Field metric hook for CWV reporting in template app (`web-vitals` for INP/LCP/CLS).
- CI `performance-web` jobs in release workflows with artifact upload.
- Responsive viewport configuration for visual benchmark: declare per-fixture or per-screen viewport lists with `id/width/height/deviceScaleFactor/weight` in `visual-quality.config.json`. Default behavior is a single `desktop` viewport (1280x800) for byte-identical back-compat. Explicit viewports are honored by the `validate-project` service via `visualQualityViewportHeight` + `visualQualityDeviceScaleFactor` runtime fields. (#838)
- `--viewport <id>` CLI flag on `pnpm benchmark:visual` for future per-viewport filtering. Flag is parsed and validated today; runner integration follows. (#838)
- Proactive Figma MCP plan-budget warning (#1093): a non-blocking banner appears in the Inspector when usage reaches ≥80% (5/6 calls) of the Figma Starter MCP budget. Counter is local-only (localStorage), driven by backend-reported successful MCP tool usage, and dismissal is session- and month-scoped.

### Changed

- Rocket compatibility fallback documentation (#1554):
    - Added migration-guide examples that move customer-profile submissions
      from omitted `pipelineId` to explicit `pipelineId: "rocket"`.
    - Added downstream release-note wording for the `default,rocket`
      compatibility window and its deprecation warning.
    - Documented that removing omitted-`pipelineId` Rocket auto-selection is a
      future package-major release only and must ship with changelog,
      migration-guide, contract-evidence, and regression-test updates.
- Inspector bootstrap now submits confirmed plugin-envelope imports as `figma_plugin`, and plugin-ingress telemetry logs expose `payload_size`, `node_count`, and `runtime_ms` aliases. (#987)
- Public docs and compatibility tables now advertise `figma_plugin` anywhere the backend already supports it. (#987)
- Deterministic app generation now uses route-level lazy loading for non-initial screens (`React.lazy` + `Suspense`).
- Deterministic generated app shell defaults to `BrowserRouter` and supports runtime router mode override (`--router browser|hash`).
- Documented BrowserRouter rewrite requirements and hash compatibility mode in README router guidance.
- Added offline local Figma JSON ingestion mode (`figmaSourceMode=local_json`, `figmaJsonPath`) with strict submit-source exclusivity validation.
- `validate.project` can execute optional performance assertion when `FIGMAPIPE_WORKSPACE_ENABLE_PERF_VALIDATION=true` (or `FIGMAPIPE_ENABLE_PERF_VALIDATION=true`).
- Hardened deterministic MUI icon import emission with tuple-based dedupe and stable ordering for reproducible outputs.
- Extended `WorkspaceVisualReferenceFixtureMetadata.viewport` with optional `deviceScaleFactor`. Back-compatible for v1/v2 fixtures. (#838)
- Composite score key in visual-benchmark runner is now `fixtureId::screenId::viewportId` with `"default"` fallback when viewportId is missing. Back-compatible for baseline v3 entries without viewportId. (#838)

## [1.0.0] - 2026-03-13

### Changed

- Promoted `workspace-dev` to standalone OSS package release line.
- Removed legacy CLI alias; only `workspace-dev` remains.
- Replaced monorepo-coupled template parity test with self-contained template integrity snapshots.
- Updated governance and contribution docs for standalone repository operations.

### Migration notes

- Replace all legacy CLI alias invocations with `workspace-dev`.
- No HTTP API contract changes in `/workspace` runtime endpoints.

## [0.3.0] - 2026-03-12

### Changed

- Switched generation runtime to parity-aligned deterministic pipeline:
    - `figma.source`
    - `ir.derive`
    - `template.prepare`
    - `codegen.generate`
    - `validate.project`
    - `repro.export`
    - optional `git.pr`
- Bundled Workspace Dev React + TypeScript + MUI v7 template into `workspace-dev`.
- Replaced simplified generator with parity deterministic IR + codegen core.
- Added optional Git/PR flow (`enableGitPr`) with contract-safe repo credential handling.
- UI now exposes explicit Git/PR toggle and keeps `Generate` CTA visible in header and form.
- Added no-store cache headers for UI and preview routes to avoid stale asset rendering.

## [0.2.0] - 2026-03-12

### Changed

- `workspace-dev` evolved from validator-only runtime to autonomous local generator.
- `POST /workspace/submit` now accepts jobs (`202`) and starts real local execution.
- Added async job polling endpoints (`/workspace/jobs/:id`, `/workspace/jobs/:id/result`).
- Added integrated local preview serving (`/workspace/repros/:id/*`).
- Updated UI to reduced but functional workspace flow with required inputs:
    - `figmaFileKey`
    - `figmaAccessToken`
    - `repoUrl`
    - `repoToken`
- Added deterministic local artifact pipeline:
    - Figma REST fetch
    - IR derivation
    - local code generation
    - local preview export

### Maintained constraints

- Mode lock remains strict:
    - `figmaSourceMode=rest`
    - `llmCodegenMode=deterministic`
- No MCP, no hybrid, no `llm_strict`.
- No dependency on Workspace Dev platform backend services.

## [0.1.1] - 2026-03-12

### Changed

- Hardened npm release readiness for `workspace-dev`:
    - release governance changelog
    - `sideEffects` metadata
    - CJS guard export paths with ESM migration guidance
    - package quality checks (`publint`, `attw`, `size-limit`)
    - package-local changesets + OIDC provenance publish

## [0.1.0] - 2026-03-11

### Added

- Initial `workspace-dev` package release for local mode-locked workspace validation.
- Public status and validation endpoints (`/workspace`, `/healthz`, `/workspace/submit`).
