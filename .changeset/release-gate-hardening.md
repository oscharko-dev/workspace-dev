---
"workspace-dev": patch
---

Harden npm release readiness for `workspace-dev`:

- add release governance changelog (`CHANGELOG.md`)
- add explicit `sideEffects` metadata
- add CommonJS guard export paths with ESM migration guidance
- add quality signals (`publint`, `attw`, `size-limit`) and REUSE metadata
- add package-local changesets release workflow with OIDC provenance publish
