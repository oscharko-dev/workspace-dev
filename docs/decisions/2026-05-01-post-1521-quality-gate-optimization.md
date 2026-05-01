# ADR: Post-#1521 Quality-gate Optimization

- Status: Accepted
- Date: 2026-05-01
- Issue: post-#1521

## Context

The CI quality-gate stack accumulated organically across 16 workflows and 38 custom guard scripts. Two formal audits conducted in 2026-05 identified concrete gaps:

- The dev-quality-gate runs on the `dev-gate` branch (PRs land on `dev`), so PRs to `dev` only get eslint, codeql, dependency-review, and visual-benchmark. The full quality matrix runs only on the `dev-gate → dev` fast-forward path.
- A single 360-minute monolithic `quality` job in `dev-quality-gate.yml` serializes approximately 40 steps that could parallelize.
- No `concurrency:` cancellation groups exist, so duplicate runs stack on PR updates.
- Mutation testing (35–40 min) blocks every dev-gate run; could be PR-opt-in or scheduled.
- `changesets-release.yml` duplicates `pnpm run release:quality-gates:publish-lifecycle` inline (lines 84–118) and has drifted (missing `perf:web:tailwind:*`).
- npm publish uses provenance (SLSA L2); regulated customers need SLSA L3 and cosign keyless signing.
- `eslint.yml` runs the same checks as `dev-quality-gate.yml` and `release-gate.yml`.

## Decision

Adopt a 5-wave optimization across the CI/CD stack, repository hygiene, and supply-chain trust:

1. **Wave 1**: Concurrency groups, ubuntu-22.04 pinning, paths-filter, job-split, mutation-off-dev, test-intelligence eval matrix, dependabot grouping, `eslint.yml` retirement, changesets dedup, Playwright cache, zizmor lint.
2. **Wave 2**: SLSA L3 generator, `actions/attest-build-provenance`, `actions/attest-sbom`, and SHA256 sums. (Standalone cosign signing was deliberately omitted — `actions/attest-*` already produce Sigstore-verifiable attestations via Fulcio + Rekor, so a separate `cosign sign-blob` step would be redundant.)
3. **Wave 3**: GitHub-side rulesets, signed-commit requirement on `main`, and repository settings hygiene.
4. **Wave 4**: Mutation threshold 58 → 65, dependency-review runtime-only on release-gate, coverage-diff PR comment, load-test harness redesign.
5. **Wave 5**: `FUNDING.yml`, GitHub Discussions, devcontainer, OSSF Scorecard floor documentation.

## Branching Flow

The repository uses a deliberate 3-branch flow:

- Feature branch → PR → `dev-gate` (full dev-quality-gate runs as a required check)
- `dev-gate` → `dev` (fast-forward; gate already validated)
- `dev` → `main` (release-gate: full quality matrix on Node 22 and 24)

All workflow `branches:` triggers in PR scope must respect this flow. It is intentional: it keeps a separation between in-flight integration (`dev`) and gate-passed integration (`dev-gate`) for the regulated-customer audit trail.

## Consequences

- **PR feedback time**: p50 wall-time drops from approximately 90 minutes to approximately 30 minutes on the dev-gate path (Wave 1 job-split, paths-filter, mutation-off-dev).
- **Supply-chain trust**: Wave 2 satisfies DORA and EU-banking artifact-provenance requirements via Sigstore and SLSA L3.
- **Operational complexity**: more workflow files; offset by the deletion of `eslint.yml` and the changesets deduplication.
- **Reversibility**: every wave is one or more PR-revertable commits except Wave 3 (live GitHub-side state, reversible via `gh api -X DELETE`).
- **No CONTRACT_VERSION bump**: this optimization touches CI/CD and repository configuration only; the public runtime contract surface is unchanged.
