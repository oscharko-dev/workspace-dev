# `test-intelligence run` CLI flag reference

This page documents operator-facing CLI flags for the
`workspace-dev test-intelligence run` subcommand. The full flag list is also
printed by `workspace-dev test-intelligence run --help`. Issue-specific flags
are linked back to the originating issue for audit context.

## `--max-figma-payload-bytes <n>` (Issue #2172)

Overrides the maximum Figma REST payload (in bytes) the runner will accept
before failing fast with `FIGMA_PAYLOAD_TOO_LARGE`.

| Property      | Value                                                     |
| ------------- | --------------------------------------------------------- |
| Soft default  | `10485760` (10 MiB, `MAX_FIGMA_PAYLOAD_BYTES`)            |
| Hard ceiling  | `67108864` (64 MiB, `MAX_FIGMA_PAYLOAD_BYTES_CEILING`)    |
| Env override  | `WORKSPACE_TEST_SPACE_MAX_FIGMA_PAYLOAD_BYTES`            |
| Validation    | Positive safe integer ≤ ceiling; otherwise CLI exits `1`. |

### Why the cap exists

Oversized Figma payloads put memory pressure on the runner and create a DoS
surface for any caller that can hand the runner an arbitrary `figma_url`. The
soft default was calibrated for synthetic fixtures and the live-E2E lane
(<= 10 MiB). Real Banking-scale design files (e.g. the customer's
Test-View-03 frame, ~28 MiB of REST JSON) need a larger budget, but only as
far as 64 MiB — above that ceiling the runner refuses to ingest the payload
regardless of operator intent. Streaming larger payloads is tracked as a
separate follow-up.

### Defense in depth

The hard ceiling is enforced twice on every run:

1. **CLI parse time** (`src/test-intelligence-run-cli.ts`) — operator-supplied
   values above 64 MiB exit `1` before any IO. The same ceiling applies to
   the env-override path.
2. **Runtime validator**
   (`src/test-intelligence/production-runner.ts:resolveFigmaPayloadCap`) —
   programmatic API consumers that pass `maxFigmaPayloadBytes` directly to
   `runFigmaToQcTestCases` are also rejected when the override exceeds the
   ceiling, surfaced as a `FIGMA_URL_REJECTED` runner error.

### Audit trail in the FinOps report

Every run stamps the resolved cap and the actual ingested payload size onto
the `figmaPayload` block of `finops/budget-report.json`:

```json
{
  "figmaPayload": {
    "resolvedCapBytes": 33554432,
    "actualBytes": 28714421,
    "defaultCapBytes": 10485760,
    "ceilingBytes": 67108864,
    "overrideApplied": true
  }
}
```

`overrideApplied` is `true` only when the operator passed
`--max-figma-payload-bytes` (or the env var); the cap-vs-actual delta is
visible without re-running the job.

### Examples

Default run (10 MiB cap, no override):

```bash
workspace-dev test-intelligence run \
  --figma-url "https://figma.com/design/abc" \
  --output ./out/runs
```

Tier-1 banking mask run with a 32 MiB override:

```bash
workspace-dev test-intelligence run \
  --figma-url "https://figma.com/design/banking-tier1" \
  --max-figma-payload-bytes 33554432 \
  --output ./out/runs
```

A value above the ceiling fails fast:

```bash
$ workspace-dev test-intelligence run \
    --figma-url "https://figma.com/design/abc" \
    --max-figma-payload-bytes 134217728 \
    --output ./out/runs
error: --max-figma-payload-bytes 134217728 exceeds the security hard ceiling
of 67108864 bytes (64 MiB). [...]
```
