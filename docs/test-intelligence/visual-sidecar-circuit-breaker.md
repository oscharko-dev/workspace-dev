# Visual Sidecar Circuit Breaker

Issue #2069 wires the existing LLM circuit-breaker primitive into visual-sidecar
primary deployment selection so repeated protocol-class failures stop consuming
budget on a known-bad primary path.

## Scope

- Applies only to the visual-sidecar primary deployment.
- The fallback deployment is still attempted when the primary is unavailable or
  skipped because the breaker is open.
- The generic gateway-side breaker still exists per client; this document covers
  the caller-side breaker the production runner now persists across runs.

## State model

The persisted breaker uses the existing three-state machine:

- `closed`: primary requests are admitted normally.
- `open`: the primary is skipped immediately and the runner dispatches straight
  to the fallback deployment.
- `half_open`: after cooldown expiry the next run may probe the primary once; a
  success closes the breaker and a protocol failure re-opens it.

The runner opens the breaker after `2` consecutive protocol-class primary
failures. Non-protocol failures do not contribute to this counter.

## Persistence

State is stored at:

```text
<outputRoot>/replay-cache/circuit-breaker-state.json
```

Entries are keyed by:

```text
<tenantId>:<environmentId>:<projectId>:visual_primary:<deployment>
```

Each entry stores:

- `updatedAt`
- `snapshot.state`
- `snapshot.consecutiveFailures`
- `snapshot.openedAtMs` when the breaker is open

Writes are atomic. The file survives across runs that share the same
`outputRoot` and replay-cache tenant scope, so a broken primary deployment is
avoided on the next job rather than rediscovered from scratch.

## Cooldown

The default cooldown is `30s`, inherited from the primary deployment's
configured LLM circuit-breaker reset timeout. When the persisted `openedAtMs +
resetTimeoutMs` window expires, the next run may perform a half-open probe.

## Policy outcomes

Issue #2069 splits visual-sidecar outcomes into two operator-visible classes:

- `policy:visual-sidecar:fallback_used` with
  `outcome = visual_sidecar_fallback_used_succeeded`, `severity = info`
  when the fallback succeeds after the primary failed or was skipped.
- `policy:visual-sidecar:both_failed` with
  `outcome = visual_sidecar_both_failed`, `severity = error`
  when both sidecars fail and no visual evidence can be produced.

`visualVerificationRequired` still controls whether a refusal is copied onto
each case decision. Without that flag, `both_sidecars_failed` remains a
job-level blocker while the per-case decisions stay unchanged.

## FinOps and artifacts

FinOps `bySource[*].circuitBreakerStates` now preserves the observed caller-side
breaker state in dispatch-decision order, including cooldown skips that happen
before any primary gateway request is sent. This lets operators distinguish:

- normal primary usage (`closed`)
- cooldown skips (`open`)
- first probe after cooldown (`half_open`)

The persisted visual-sidecar result artifact also preserves the exact fallback
reason (`primary_failed` vs `primary_unavailable`) for audit replay.
