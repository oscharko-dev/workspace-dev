---
"workspace-dev": minor
---

Add a self-service customer-onboarding CLI (Issue #2185, Wave 8) so a
tier-1 bank's operator can stand up a tenant directory in one command
instead of requiring half-a-day of operator hand-holding. Closes the
gating operational scalability bottleneck above ~5 tenants.

- New `src/test-intelligence/tenant-onboarding.ts` module with
  `runTenantOnboarding` (the provision flow) and
  `runTenantOnboardingDoctor` (the safety-net validator). Pure over
  its inputs and the filesystem; no env-var reads, no network calls,
  no secret material printed.
- New CLI subcommand
  `pnpm exec tsx src/cli.ts test-intelligence onboard --tenant-id <id> --legal-name <name> --policy-profile <id> --output-root <dir>`
  that lays down `tenant-bundle.json` (W8-2), an empty
  `calibration-corpus/`, three locally-generated signing keys
  (audit-dossier W6-1, region-attestation W6-3, reviewer-signing
  W6-5), `ict-register.json` (DORA Art. 28-conformant), and
  `onboarding-evidence.json` audit trail. Refuses to overwrite an
  existing tenant directory unless `--force`.
- Doctor subcommand
  `pnpm exec tsx src/cli.ts test-intelligence onboard --doctor --tenant-id <id> --output-root <dir>`
  validates the layout, parses every key, cross-checks public-key
  fingerprints against the ICT register, and refuses tenant-scope
  mismatches as multi-tenant isolation violations (W6-2).
- Key generation is strictly local via
  `crypto.generateKeyPairSync("ed25519")` and `crypto.randomBytes(32)`;
  private keys are written with mode `0600` and never reprinted by the
  harness. The operator owns key custody from the moment they land on
  disk. (HSM / KMS integration is the W8-5 sovereign-cloud follow-on.)
- Documentation: `docs/test-intelligence/onboarding.md` — the
  five-minute onboarding walkthrough plus the doctor checklist.
- Tests: 15 unit tests in
  `src/test-intelligence/tenant-onboarding.test.ts` and
  `src/test-intelligence-onboard-cli.test.ts`; 4 new CLI contract
  tests in `src/cli.contract.test.ts` covering help text, missing
  flags, doctor on a missing tenant, and the
  end-to-end provision-then-doctor handshake.
