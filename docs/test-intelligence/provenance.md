# Provenance Graph

Issue #2037 adds a run-level provenance artifact at
`<artifactRoot>/<jobId>/provenance.jsonld`. The artifact is a W3C
[PROV-DM] graph serialized as JSON-LD. It captures the causal chain
that produced each generated test case: source artifacts ➜ compiled
prompt ➜ generator activity ➜ test cases ➜ judge verdicts ➜
consensus.

The contract is intentionally narrow:

- it records how the run's QC bundle relates to upstream inputs and
  downstream outputs;
- it uses hash-only references and opaque identifiers already present
  in the run artifacts;
- it does not persist raw prompt text, raw screenshots, bearer tokens,
  API keys, or PII.

This keeps the artifact useful for audit replay while keeping the
sensitive payloads in the rest of the surface where they are already
redacted or absent.

## Standards alignment

| Concern                        | Standard                              | Where it lives                                                                                                                                                                                                                                                          |
| ------------------------------ | ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PROV terminology and relations | W3C PROV-DM 1.0 / PROV-O              | `@type` values such as `prov:Entity`, `prov:Activity`, `prov:SoftwareAgent`; relations `prov:wasGeneratedBy`, `prov:wasInformedBy`, `prov:wasDerivedFrom`, `prov:wasAttributedTo`, `prov:wasRevisionOf`, `prov:hadPrimarySource`, `prov:wasAssociatedWith`, `prov:used` |
| Audit record-keeping           | DORA Article 28; EU AI Act Article 12 | `provenance.jsonld` plus `policy-report.json#provenance.merkleRoot`                                                                                                                                                                                                     |
| Tamper evidence                | Sorted SHA-256 binary Merkle tree     | `ti:merkleSeal.root` and per-node `ti:leafHash`                                                                                                                                                                                                                         |
| JSON-LD context                | Official PROV-O JSON-LD context       | `@context[0] === "https://www.w3.org/ns/prov.jsonld"`                                                                                                                                                                                                                   |

## What it contains

The graph is a per-run provenance index. It identifies:

- the job id and job-scoped run directory;
- the workspace runner and every model deployment that participated, as
  `prov:SoftwareAgent` nodes (the runner carries `ti:agentKind:
"software"`, model deployments carry `ti:agentKind: "model"`);
- every required artifact (`business-intent-ir.json`,
  `compiled-prompt.json`, `coverage-plan.json`,
  `workflow-topology.json`, `risk-ranking.json`,
  `generated-testcases.json`, the logic judge verdict artifact, and the
  judge consensus artifact) as `prov:Entity` nodes with
  `ti:artifactPath`, `ti:sha256`, `ti:bytes`;
- the source-preparation, generation, repair, judge, and consensus
  activities as `prov:Activity` nodes;
- the generated test-case list and each individual test case as
  `prov:Entity` nodes (test cases keep only their id, risk category,
  technique, title, and prompt/schema/input hashes — never raw step
  bodies);
- a verdict entity per (judge × test case) carrying
  `prov:wasAttributedTo` to the agent that produced the verdict
  (the model deployment for `logic_judge`, `faithfulness_judge`, and
  `a11y_judge`; the workspace runner for the deterministic
  `judge_consensus`);
- a Merkle seal (`ti:merkleSeal`) over the canonical-JSON form of every
  graph node, with the same root mirrored into
  `policy-report.json#provenance.merkleRoot`.

The graph is not a replay bundle. It must not contain:

- raw prompt bodies;
- raw screenshots or screenshot bytes;
- PII values copied out of the source material;
- bearer tokens, API keys, or other credentials.

## Privacy guardrails

The provenance graph follows the same privacy posture as the rest of
the test-intelligence surface:

- hashes are acceptable;
- raw payloads are not;
- opaque references are acceptable when they resolve to artifacts
  already on disk;
- credentials never belong in the graph;
- any PII that would have appeared in the original material stays in
  the redacted artifacts, not in the provenance graph.

If a field needs to identify content, the graph should use the digest
of that content or a stable artifact reference instead of the content
itself.

## Worked example

The following excerpt is a real graph produced by the deterministic
fixture used in the regression test
(`src/test-intelligence/production-runner.test.ts`, "Issue #2037:
production runner writes provenance.jsonld and policy report carries
the Merkle root"). It is shown pretty-printed for readability; the
on-disk file is canonical-JSON serialized for stable hashing.

```jsonld
{
  "@context": [
    "https://www.w3.org/ns/prov.jsonld",
    {
      "label": "http://www.w3.org/2000/01/rdf-schema#label",
      "ti": "https://workspace-dev.local/ns/test-intelligence#"
    }
  ],
  "@id": "urn:workspace-dev:test-intelligence:job-2037-prov:bundle:provenance",
  "@type": "prov:Bundle",
  "ti:schemaVersion": "1.0.0",
  "ti:jobId": "job-2037-prov",
  "ti:generatedAt": "2026-05-08T10:00:00Z",
  "ti:sourceKind": "figma_paste_normalized",
  "ti:merkleSeal": {
    "algorithm": "sha256_merkle_v1",
    "leafCount": 18,
    "root": "a6b9e7bf2c2bb2eb139f0f121168b73a431804f598541c52499dc5e247ba1682"
  },
  "@graph": [
    {
      "@id": "urn:workspace-dev:test-intelligence:job-2037-prov:agent:workspace-dev",
      "@type": "prov:SoftwareAgent",
      "label": "workspace-dev production runner",
      "ti:agentKind": "software",
      "ti:leafHash": "9d01e264279393037de538b9b6b1e28c1ff8655d734079db481614ec9cd7d11c"
    },
    {
      "@id": "urn:workspace-dev:test-intelligence:job-2037-prov:agent:model-gpt-oss-120b-mock",
      "@type": "prov:SoftwareAgent",
      "label": "gpt-oss-120b-mock",
      "ti:agentKind": "model",
      "ti:modelDeployment": "gpt-oss-120b-mock",
      "ti:leafHash": "d05c476668ac8433dfd5059ed6d8a82fb308fdaa9183581353f65dbd1e2aba5a"
    },
    {
      "@id": "urn:workspace-dev:test-intelligence:job-2037-prov:artifact:compiled-prompt.json",
      "@type": "prov:Entity",
      "label": "Compiled generator prompt",
      "ti:artifactPath": "compiled-prompt.json",
      "ti:sha256": "05eaae8a4e573f56d414540e7c9618a8ad5245da3589b8776023318eedbcd5c7",
      "ti:bytes": 37077,
      "prov:wasDerivedFrom": [
        { "@id": "urn:workspace-dev:test-intelligence:job-2037-prov:artifact:business-intent-ir.json" },
        { "@id": "urn:workspace-dev:test-intelligence:job-2037-prov:artifact:coverage-plan.json" },
        { "@id": "urn:workspace-dev:test-intelligence:job-2037-prov:artifact:risk-ranking.json" },
        { "@id": "urn:workspace-dev:test-intelligence:job-2037-prov:artifact:workflow-topology.json" }
      ],
      "ti:leafHash": "a93e9020e405cc07c2f566dc28cf4ce54452a974274d0cc51a308889a95d2d2f"
    },
    {
      "@id": "urn:workspace-dev:test-intelligence:job-2037-prov:activity:test_generation",
      "@type": "prov:Activity",
      "label": "Initial test generation",
      "ti:role": "generator",
      "prov:startedAtTime": "2026-05-08T10:00:00Z",
      "prov:endedAtTime": "2026-05-08T10:00:00Z",
      "prov:wasAssociatedWith": [
        { "@id": "urn:workspace-dev:test-intelligence:job-2037-prov:agent:model-gpt-oss-120b-mock" },
        { "@id": "urn:workspace-dev:test-intelligence:job-2037-prov:agent:workspace-dev" }
      ],
      "prov:used": [
        { "@id": "urn:workspace-dev:test-intelligence:job-2037-prov:artifact:compiled-prompt.json" }
      ],
      "prov:wasInformedBy": [
        { "@id": "urn:workspace-dev:test-intelligence:job-2037-prov:activity:source_preparation" }
      ],
      "ti:leafHash": "cd01b0a1cdd4abe40d2e3acbce1adb648b6ab1820ee8ed0332d2f83719d7df10"
    },
    {
      "@id": "urn:workspace-dev:test-intelligence:job-2037-prov:entity:test-case-tc-f062ea553541",
      "@type": "prov:Entity",
      "label": "Eingabe einer gültigen Investitionssumme",
      "ti:testCaseId": "tc-f062ea553541",
      "ti:riskCategory": "low",
      "ti:technique": "use_case",
      "ti:promptHash": "e75a348394f5dd48a6948f53c23c026bfc27391b286298a693bc0e43e888df5c",
      "ti:schemaHash": "2175ca5698525f71e127b8f4e5058e5202e68e577d9abc851d642f410e31101f",
      "ti:inputHash": "c5b888c1b8db2b10822c0bf907933e9434c2aad7b8c9766349ec1aa94d3e583e",
      "prov:wasGeneratedBy": {
        "@id": "urn:workspace-dev:test-intelligence:job-2037-prov:activity:test_generation"
      },
      "prov:hadPrimarySource": {
        "@id": "urn:workspace-dev:test-intelligence:job-2037-prov:entity:generated-list-initial"
      },
      "ti:leafHash": "b2a58cec1b997fb3247032b902505ef4cfc968baf12a816f258563fc003b9bf0"
    },
    {
      "@id": "urn:workspace-dev:test-intelligence:job-2037-prov:entity:logic_judge-verdict-tc-f062ea553541",
      "@type": "prov:Entity",
      "label": "logic_judge verdict for tc-f062ea553541",
      "ti:judgeRole": "logic_judge",
      "ti:testCaseId": "tc-f062ea553541",
      "ti:verdict": "repair",
      "prov:wasGeneratedBy": {
        "@id": "urn:workspace-dev:test-intelligence:job-2037-prov:activity:logic_judge"
      },
      "prov:wasAttributedTo": {
        "@id": "urn:workspace-dev:test-intelligence:job-2037-prov:agent:model-gpt-oss-120b-mock"
      },
      "prov:wasDerivedFrom": [
        { "@id": "urn:workspace-dev:test-intelligence:job-2037-prov:entity:test-case-tc-f062ea553541" },
        { "@id": "urn:workspace-dev:test-intelligence:job-2037-prov:artifact:agent-role-runs-logic_judge.json" }
      ],
      "ti:leafHash": "63f847b4f95213f9459e8bb9bffa0ceaa857565db5bbdb4e5f2d3d3f6b2bfcea"
    }
  ]
}
```

How to read the slice:

- The two agents (`workspace-dev` and `model-gpt-oss-120b-mock`) are
  every actor in the run. Both are `prov:SoftwareAgent`; they are
  distinguished by `ti:agentKind`.
- The `compiled-prompt.json` artifact is `prov:wasDerivedFrom` the
  four upstream IR artifacts. Its `ti:sha256` matches the bytes on
  disk; the `--verify-provenance` CLI re-reads the file and rejects
  the run if the digest changes.
- The `test_generation` activity is `prov:wasAssociatedWith` both
  agents and `prov:used` the compiled prompt. Repair iterations (not
  shown in this happy-path slice) form a chain via `prov:wasRevisionOf`
  on the generated-list entities.
- The test-case entity records only ids and hashes — no step bodies,
  no expected results, no PII. `prov:hadPrimarySource` points back at
  the generated-list entity that contained it.
- The verdict entity carries `prov:wasAttributedTo` to the agent that
  produced the verdict. Logic, faithfulness, and accessibility judges
  attribute to the model deployment; the deterministic `judge_consensus`
  attributes to the workspace runner.

## Verify a run dir

Use the bundled CLI to recompute the Merkle root from the artifacts on
disk and compare it to the seal embedded in the graph and mirrored in
the policy report:

```bash
pnpm exec tsx src/cli.ts test-intelligence verify-provenance \
  <artifactRoot>/<jobId>
```

Exit code `0` means every attested artifact hashed correctly and the
seal matches; exit code `2` means at least one of:

- the provenance file is missing or unparseable;
- an attested artifact has been added, removed, or mutated;
- the Merkle seal has been mutated;
- the policy report's `provenance.merkleRoot` does not match.

For ad-hoc inspection without the CLI:

```bash
test -f "<runDir>/provenance.jsonld"
jq '.["ti:merkleSeal"]' "<runDir>/provenance.jsonld"
jq '.provenance' "<runDir>/policy-report.json"
```

If you need a full bundle integrity check across the rest of the
artifact set, run the evidence manifest verifier from the operator
runbook:

```bash
pnpm exec tsx scripts/verify-evidence-manifest.ts \
  --job-dir <artifactRoot>/<jobId>
```

[PROV-DM]: https://www.w3.org/TR/prov-dm/
