---
"workspace-dev": minor
---

Add BYO-rubric / BYO-guidelines tenant-bundle resolver (Issue #2184,
Wave 8) so customer banks and insurers can register their own naming
conventions, compliance house standards, design-system tokens,
terminology, and customer-eval rubric references without forking the
harness.

- New `src/test-intelligence/tenant-bundle.ts` module exposing the
  `TenantBundleInput` schema, a structured parse + canonicalize
  function, the resolver, and a deep-clone-safe merge against the
  active `TestCasePolicyProfile`. The hard
  `TENANT_BUNDLE_OVERRIDE_ALLOW_LIST` is the customer-facing contract
  surface; unknown top-level fields are rejected. Hard
  `TENANT_BUNDLE_SAFETY_FLOORS` invariants stop any future numeric or
  gate-mode override from weakening the base policy profile.
- New CLI flag `--tenant-bundle <path>` on `test-intelligence run`.
  256 KiB hard cap is stat'd before read; an invalid or
  allow-list-violating bundle aborts with exit code 1 before the LLM
  is dispatched.
- Production runner emits `tenant-bundle-resolved.json` per run,
  threads the bundle's `terminologyGlossary` into the prompt
  compiler's `[5] CustomerDomainContext` section, and applies the
  bundle's `riskClassTaxonomy[].mode === "review_only"` overrides to
  the base profile's `reviewOnlyRiskCategories`. The override surface
  is intentionally additive only — a customer cannot weaken the base
  policy.
- Multi-tenant isolation (Issue #2176): the resolver calls
  `assertTenantBundleScope` which throws `TenantIsolationViolation`
  when an active `TenantScope` does not match the bundle's
  `tenantId`. Single-tenant CLI use (no ALS scope) is unaffected.
- Audit dossier (`audit-dossier.json`) gains an optional
  `customerBundle` summary block and a new `tenant_bundle_resolved`
  artifact kind; the PDF renderer adds a *Customer-Specific
  Configuration* section when a bundle is present. Legacy runs that
  omit `--tenant-bundle` keep the dossier shape stable.
- Documentation: `docs/test-intelligence/tenant-bundles.md` with one
  banking and one insurance example bundle, the safety-floor table,
  and the authoring checklist.
- New `ProductionRunnerFailureClass`: `TENANT_BUNDLE_INVALID` for
  schema, allow-list, safety-floor, and base-profile-mismatch
  failures.

Backwards-compatible: omitting `--tenant-bundle` runs with the default
`eu-banking-default` profile, no behaviour change. No regression on
G1–G7 + G8 + G9 hard gates.
