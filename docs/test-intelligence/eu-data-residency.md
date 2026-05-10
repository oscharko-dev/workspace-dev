# EU Data Residency Attestation

Issue #2177 adds a cryptographic region-attestation layer to the
test-intelligence runtime. The goal is narrow: every persisted run artifact can
be traced back to the LLM deployments that contributed to it, and every such
contribution carries evidence for the serving region that handled the request.

This is an auditability control, not a network firewall. It does not geo-fence
traffic by itself. It proves what region evidence the runtime observed for the
calls that produced the run bundle.

## Threat model

The control is designed to catch the failure modes that matter for DORA
Article 28 and GDPR Chapter V review:

- An operator points an EU-labelled deployment at a non-EU endpoint.
- A provider-side fallback serves traffic from an unexpected region.
- A run bundle records only deployment names, leaving no evidence of actual
  serving geography.
- An operator hand-pins a region because cloud metadata is unavailable and
  tries to pass that weaker evidence off as a cryptographic attestation.

The control does not attempt to prove per-byte residency, packet routing, or
cloud control-plane configuration. Those remain infrastructure and vendor
assurance concerns.

## Evidence flow

For each contributing model call, the runtime resolves a hosting region in
priority order:

1. Azure Instance Metadata Service at
   `http://169.254.169.254/metadata/instance?api-version=2021-02-01`
2. Endpoint hostname / TLS certificate CN or SAN parsing
3. Operator-pinned fallback via
   `WORKSPACE_TEST_SPACE_REGION_ATTESTED_REGION`

The runtime signs each observation with
`WORKSPACE_TEST_SPACE_REGION_ATTESTATION_SIGNING_KEY` and stores the result as
`RegionAttestation` records. When the runtime falls back to the operator-pinned
region, the attestation is marked with `severity: "warning"` so auditors can
distinguish weaker evidence from provider-backed metadata.

If no supported region can be resolved, the run fails closed. If any resolved
region falls outside the active policy profile's allowed list, the runner
raises `G8_EU_REGION_ATTESTED` and aborts the run.

## Persisted artifacts

The runtime emits region-residency evidence in three places:

- `evidence.manifest.json`
  Every artifact row carries a `regionAttestations` array that names the LLM
  calls that informed that artifact.
- `region-attestations.json`
  Canonical per-run report of artifact hashes, their attached attestations, and
  the run-wide `distinctRegions` set.
- `finops/budget-report.json`
  Audit summary under `regionAttestation` and `bySource.*.regionAttestation`
  so finance / vendor-governance review can confirm the cumulative serving
  regions without parsing the full report.

The audit dossier consumes `region-attestations.json` and renders a compact
per-artifact region table for regulator-facing review.

## Allowed regions

The contract exports the closed set of supported hosting regions:

- `eu-central-1`
- `eu-west-1`
- `eu-west-3`
- `eu-north-1`
- `eu-south-1`
- `eu-de-1`
- `eu-fr-1`
- `switzerland-north`
- `norway-east`

The default `eu-banking-default` profile allows the full set above. Derived
profiles can narrow the list through `allowedHostingRegions`, but they should
not broaden it unless the operator has an explicit legal basis and contract
coverage for non-EU transfers.

## Auditor verification path

An auditor can validate residency evidence without replaying the run:

1. Verify the run bundle with
   `workspace-dev test-intelligence audit-verify --bundle <bundle.json>`.
2. Inspect `region-attestations.json` for the artifact under review.
3. Confirm that every `servedFromRegion` value is allowed by the active policy
   profile and note any `severity: "warning"` entries.
4. Cross-check `finops/budget-report.json` `distinctRegions` against the report
   to confirm that the governance summary matches the raw attestation set.
5. Review `subprocessor-register.json` and the model card to confirm the
   provider / deployment identifiers align with the attested regions.

If the bundle verifies, the attestation signatures are present, and no artifact
shows a disallowed region, the runtime has preserved an auditable chain of
residency evidence for that run.
