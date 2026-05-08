# Provenance Graph

Issue #2037 adds a run-level provenance artifact at
`<artifactRoot>/<jobId>/provenance.jsonld`.

The artifact is JSON-LD, but the contract is intentionally narrow:

- it records how the run’s QC bundle relates to upstream inputs and downstream
  outputs;
- it uses hash-only references and opaque identifiers already present in the
  run artifacts;
- it does not persist raw prompt text, raw screenshots, bearer tokens, API
  keys, or PII.

This keeps the artifact useful for audit replay while keeping the sensitive
payloads in the rest of the surface where they are already redacted or absent.

## What it contains

The graph is a provenance index for the job. Operators should expect the
artifact to identify:

- the job id and job-scoped run directory;
- the artifact set that was produced for the job;
- hash-bearing references to upstream inputs such as source IR or evidence
  records;
- hash-bearing references to downstream outputs such as QC mappings or export
  artifacts;
- timestamps and other run metadata needed to tie the graph to a specific
  execution.

The graph is not a replay bundle. It should not contain:

- raw prompt bodies;
- raw screenshots or screenshot bytes;
- PII values copied out of the source material;
- bearer tokens, API keys, or other credentials.

## Privacy guardrails

The provenance graph follows the same privacy posture as the rest of the
test-intelligence surface:

- hashes are acceptable;
- raw payloads are not;
- opaque references are acceptable when they resolve to artifacts already on
  disk;
- credentials never belong in the graph;
- any PII that would have appeared in the original material stays in the
  redacted artifacts, not in the provenance graph.

If a field needs to identify content, the graph should use the digest of that
content or a stable artifact reference instead of the content itself.

## Verify a run dir

Given an existing run dir, verify the provenance artifact with the job’s other
artifacts:

1. Confirm the file exists:

```bash
test -f "<runDir>/test-intelligence/provenance.jsonld"
```

2. Inspect the graph structure:

```bash
jq '.' "<runDir>/test-intelligence/provenance.jsonld"
```

3. Check that the graph references only job-scoped artifacts already present in
   the same run dir.

4. Compare any digest fields in the graph with the bytes of the referenced
   artifacts.

5. If you need a full bundle integrity check, run the evidence manifest
   verifier from the operator runbook:

```bash
pnpm exec tsx scripts/verify-evidence-manifest.ts \
  --job-dir <artifactRoot>/<jobId>
```

## Worked example

The checked-in `issue-1365` fixture provides concrete provenance-bearing
artifacts that make the shape of the graph easy to reason about without using
fabricated values.

- [`src/test-intelligence/fixtures/issue-1365.expected.qc-mapping-preview.json`](../../src/test-intelligence/fixtures/issue-1365.expected.qc-mapping-preview.json)
  contains `visualProvenance.evidenceHash` values for the approved test cases.
- [`src/test-intelligence/fixtures/issue-1365.expected.testcases.alm.xml`](../../src/test-intelligence/fixtures/issue-1365.expected.testcases.alm.xml)
  renders the same hash-only provenance in the export surface as XML
  attributes.

Those files illustrate the intended pattern for `provenance.jsonld`: the graph
names the run and points to the same hash-bearing evidence already emitted by
the job, rather than duplicating raw prompt or screenshot content.

