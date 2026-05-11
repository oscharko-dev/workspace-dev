# ADR: Issue #1809 Roadmap — Multi-Agent Harness Implementation Order and Closing Gates (Closure)

- Status: Accepted
- Date: 2026-05-04
- Issue: #1809 (Roadmap)
- Parent Epic: #1753 (Multi-Agent Harness for Figma-to-QC Test Case Intelligence)
- Children: Stories #1754, #1755, #1756, #1757, #1758, #1759, #1760, #1761

## Context

Issue #1809 is the governance roadmap for Epic #1753. It defines the hard
wave order (`MA-0 -> MA-1 -> MA-2 -> MA-2.5 -> MA-3 -> MA-4 -> MA-5 -> MA-6`)
and the closing-gate signal that must be satisfied before each wave can be
considered complete.

The implementation work described by the roadmap has already landed on `dev`
through the epic and wave stories. The repository now contains:

- the epic-level closure ADR at
  `docs/decisions/2026-05-04-issue-1753-multi-agent-harness-epic-closure.md`
- the wave-level closure ADR for MA-5 at
  `docs/decisions/2026-05-04-issue-1760-ma5-wave-closure.md`
- the operator runbook and DPIA required by the later roadmap waves
- the release-gate and readiness scripts that enforce the closing criteria

What is missing is a dedicated roadmap-closure artifact for Issue #1809
itself. Without that record, the roadmap is effectively complete in behavior
but not closed with the same auditable, issue-scoped governance trail used for
the epic and wave stories.

## Decision

Close Issue #1809 as `Done`. The roadmap's required wave order was preserved,
every referenced wave story is closed, and the corresponding closing gates are
implemented and wired into the repository's release process.

No `CONTRACT_VERSION` bump is required for this ADR. This change is
documentation-only and records closure of a governance issue; all contract and
runtime changes were versioned in the originating wave PRs.

Wave MA-6 remains intentionally ADR-deferred. The roadmap marked MA-6 as
optional, the issue thread records that it will not be implemented for now,
and Epic #1753 already documents the decision to keep zero-runtime-deps and
avoid a LangGraph / LangSmith adapter unless a future customer requirement
re-opens that work.

## Roadmap Closure Matrix

| Wave | Story | Roadmap closing gate | Closure evidence |
|---|---|---|---|
| MA-0 | #1754 | Baseline metrics persisted for all archetypes; live-E2E discipline established | Story closed on GitHub; epic closure ADR records MA-0 closed and references the baseline + live-E2E discipline as part of the delivered wave chain. |
| MA-1 | #1755 | TestDesignModel + CoveragePlan canonical-JSON; stable prefix hash byte-stable; branded-ID failures verified; genealogy signed | Story closed on GitHub; epic closure ADR records MA-1 closed as delivered foundation work. |
| MA-2 | #1756 | Visual sidecar production wiring closed with schema `1.1.0` baseline and reproducible evidence manifests | Story closed on GitHub; merged PR #1824 fixed the production deployment configuration; epic closure ADR records MA-2 closed. |
| MA-2.5 | #1757 | Untrusted-content hardening, per-source cost sealing, cache-break detector gates green | Story closed on GitHub; epic closure ADR records MA-2.5 closed and cites the adversarial fixture coverage as the hardening basis. |
| MA-3 | #1758 | Judge panel, mutation oracle, idempotent replay, Merkle checkpoints, sticky repair, boundary lint enforced | Story closed on GitHub; epic closure ADR records MA-3 closed and points to Merkle-chain and repair-loop closure evidence. |
| MA-4 | #1759 | Evidence sealing real; ML-BOM emitted; ICT register enforced; runbook + DPIA updated | Story closed on GitHub; epic closure ADR traces these artifacts directly to the runbook, DPIA, and release-readiness surfaces. |
| MA-5 | #1760 | Eval gates and release quality wired into CI and release gates | Story closed on GitHub; `docs/decisions/2026-05-04-issue-1760-ma5-wave-closure.md` provides the 13-criterion closure matrix; `package.json` wires `release:quality-gates` and `release:readiness`. |
| MA-6 | #1761 | Optional adapter closes only if ADR-gated decision is satisfied | Story closed on GitHub as ADR-deferred; epic closure ADR and issue comments record that the adapter is intentionally not built and remains out of scope. |

## Repository Enforcement and Evidence

- `package.json` wires the roadmap-critical gates through
  `pnpm run test:ti-eval`, `pnpm run test:ti-live-e2e`,
  `pnpm run release:quality-gates`, and `pnpm run release:readiness`.
- `docs/test-intelligence-operator-runbook.md` records the operator-facing
  harness modes, recovery procedures, and FinOps interpretation required by
  the later waves.
- `docs/test-intelligence-dpia-production-runner.md` records the multi-agent
  harness data flows and controls required for auditability.
- `docs/decisions/2026-05-04-issue-1753-multi-agent-harness-epic-closure.md`
  consolidates the epic-level acceptance-criteria traceability and explicitly
  states that Roadmap #1809 is ready to close.

## Consequences

- The roadmap issue now has the same issue-scoped closure record as the wave
  and epic governance work.
- Auditors can verify roadmap completion from one ADR plus the linked epic and
  wave closure records, without reconstructing the dependency chain from issue
  history alone.
- No customer-visible behavior changes. This ADR is documentation-only and
  leaves runtime behavior, contracts, and release defaults unchanged.

## References

- Issue #1809 (this roadmap)
- Issue #1753 (parent epic)
- Stories #1754, #1755, #1756, #1757, #1758, #1759, #1760, #1761
- `docs/decisions/2026-05-04-issue-1753-multi-agent-harness-epic-closure.md`
- `docs/decisions/2026-05-04-issue-1760-ma5-wave-closure.md`
- `docs/test-intelligence-operator-runbook.md`
- `docs/test-intelligence-dpia-production-runner.md`
- `package.json`
