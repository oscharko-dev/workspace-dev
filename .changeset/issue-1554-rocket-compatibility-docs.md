---
"workspace-dev": patch
---

Document the Rocket compatibility fallback migration and deprecation policy for Issue #1554.

- Add copy-pastable before/after examples for customer-profile jobs migrating from omitted `pipelineId` to explicit `pipelineId: "rocket"`.
- Provide downstream release-note wording for the `default,rocket` compatibility window, including the deprecation warning for omitted-`pipelineId` Rocket auto-selection.
- State that removing the compatibility fallback is a future package-major release only, with changelog, migration-guide, contract-evidence, and regression-test requirements in the same change set.
