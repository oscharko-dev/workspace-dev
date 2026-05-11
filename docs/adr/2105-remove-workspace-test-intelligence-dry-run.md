# ADR 2105: Remove `dry_run` From `WorkspaceTestIntelligenceMode`

- Status: Accepted
- Date: 2026-05-09
- Deciders: CTO delegate via Issue #2105 autonomous implementation

## Context

`WorkspaceTestIntelligenceMode` was published as part of the submit API
contract with the values `"deterministic_llm" | "offline_eval" | "dry_run"`.
The repository also ships a local CLI-only `workspace-dev test-intelligence run
--mode dry_run` path that validates operator inputs without dispatching the LLM
runner.

The problem is that the public submit contract never defined distinct
`dry_run` semantics beyond the enum literal itself. The issue acceptance
criteria allowed either:

1. formalizing `dry_run` as a first-class typed report flow, or
2. removing the unsupported contract value entirely.

The current codebase does not implement the typed report surface required to
make submit-API `dry_run` production-ready. Keeping the public enum literal
would preserve ambiguous API surface and force consumers to guess whether it
behaves like the CLI shortcut, the synchronous submit runner, or a future QC
artifact path.

## Decision

Remove `dry_run` from the public `WorkspaceTestIntelligenceMode` contract and
from the `/workspace/submit` request validation allowlist.

Keep the repository CLI's `workspace-dev test-intelligence run --mode dry_run`
path as an explicitly local operator workflow. It remains documented as a
CLI-only validation mode and is not part of the submit API contract.

## Consequences

- `WorkspaceTestIntelligenceMode` is now limited to
  `"deterministic_llm" | "offline_eval"`.
- `ALLOWED_TEST_INTELLIGENCE_MODES` and submit-schema validation reject
  `"dry_run"`.
- Generated contract docs and test-intelligence docs must describe `dry_run`
  only where it is explicitly supported, such as the local CLI or unrelated QC
  / Jira dry-run systems.
- No typed submit-API `DryRunReport` is introduced in this change.

## Follow-up

If a future release needs a submit-API preflight mode, it must be designed as a
new explicit contract with a typed response payload, dedicated tests, and
documentation that does not overload the CLI-only `dry_run` behavior.
