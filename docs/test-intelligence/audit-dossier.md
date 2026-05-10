# Audit-Dossier Bundle

Issue #2175 adds an operator-facing CLI that turns one completed
test-intelligence run directory into a deterministic, signed audit bundle for
external review. The bundle is intentionally narrow: it packages attested
metadata, digests, provenance, and a concise PDF summary, but it does not copy
raw prompts, screenshot bytes, secrets, or PII into the manifest surface.

## Bundle layout

Running the generator writes four files with a shared basename:

- `<runId>-audit-dossier.json` — canonical JSON manifest.
- `<runId>-audit-dossier.sig` — detached Ed25519 signature envelope.
- `<runId>-audit-dossier.pdf` — compact regulator-facing dossier summary.
- `<runId>-audit-dossier.merkle.txt` — plain-text Merkle proof for the
  manifest leaf inventory.

The manifest and signature are deterministic for the same run artifacts,
operator key, and CLI metadata inputs.

## Required input artifacts

The generator reads one run directory and requires this evidence set to be
present before it will produce a bundle:

- `provenance.jsonld`
- `compliance-coverage-report.json`
- `compliance-annotations.json`
- `judge-calibration-eval.json`
- `locale-calibration-curves.json`
- `inter-rater-agreement.json`
- `distribution-shift-report.json`
- `incidents.json`
- `subprocessor-register.json`
- `region-attestations.json`
- `finops/budget-report.json`
- `faithfulness-tier-report.json`
- `self-consistency-arbitration.json`
- `production-runner-evidence-seal.json`
- exactly one `*.model-card.json`

`policy-report.json` is included when present, but it is not required.

## Generate a bundle

Use the package CLI from the repository root or from an installed package:

```bash
workspace-dev test-intelligence audit-dossier \
  --run-dir <artifactRoot>/<jobId> \
  --output <bundleDir> \
  [--sign-key <ed25519-private-key.pem>]
```

Flags:

- `--run-dir` points at the completed run directory.
- `--output` is the destination directory for the four generated files.
- `--sign-key` is required unless the operator provides
  `WORKSPACE_TEST_SPACE_AUDIT_SIGN_KEY`.

The command fails closed when:

- any required artifact is missing;
- the run directory contains zero or multiple model-card files;
- the signing key is missing or not a valid Ed25519 private key;
- the provenance graph lacks a stable run id or Merkle root.

## Verify a bundle

The verifier recomputes integrity from the bundle itself:

```bash
workspace-dev test-intelligence audit-verify \
  --bundle <bundleDir>/<jobId>-audit-dossier.json
```

Verification checks:

- the manifest JSON exists and parses;
- the detached signature JSON exists and parses;
- `signing.manifestSha256` matches the unsigned-manifest view;
- the public-key fingerprint and embedded PEM match across manifest and
  signature;
- the Ed25519 signature validates against the final manifest bytes;
- the Merkle proof text matches the leaf hashes declared in the manifest.

Exit code `0` means the bundle is intact. Exit code `2` means the bundle is
missing, malformed, tampered with, or internally inconsistent.

## Fixture-backed example

The repository includes a stable acceptance fixture under
`fixtures/test-intelligence/audit-dossiers/`:

```bash
workspace-dev test-intelligence audit-dossier \
  --run-dir fixtures/test-intelligence/audit-dossiers/accepted-run \
  --output /tmp/issue-2175-bundle \
  --sign-key fixtures/test-intelligence/audit-dossiers/operator-ed25519.private-key.json

workspace-dev test-intelligence audit-verify \
  --bundle /tmp/issue-2175-bundle/ti-cli-1778405189341-audit-dossier.json
```

The deterministic regression test compares the generated files against the
checked-in expected bundle in
`fixtures/test-intelligence/audit-dossiers/expected-bundle/`.

## Regulation coverage table

The manifest carries a `regulatorCoverage` section that maps each policy area
to the artifact kinds that satisfy it. The current bundle covers:

- BaFin / Bundesbank
- EIOPA
- EBA
- DORA Art. 10
- DORA Art. 28
- EU AI Act Art. 12
- EU AI Act Art. 13
- EU AI Act Art. 14
- GDPR Ch. V

The `region-attestations.json` artifact is documented in
[eu-data-residency.md](./eu-data-residency.md). The dossier renders the
artifact as a per-file table so auditors can see which persisted outputs were
supported by Azure instance metadata, endpoint-certificate evidence, or the
weaker operator-pinned fallback.

This table is descriptive, not a legal opinion. The operator remains
responsible for deciding whether the emitted evidence is sufficient for a given
control framework and retention policy.
