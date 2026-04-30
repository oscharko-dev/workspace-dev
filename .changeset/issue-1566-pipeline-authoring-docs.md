---
"workspace-dev": patch
---

Document the pipeline authoring, packaging, Rocket migration, and compatibility fallback contract for Issue #1566.

- Add a maintainer guide that explains how future pipelines are authored through registered definitions, fixed stage plans, delegates, artifact contracts, and package profiles.
- Document how the `default`, `rocket`, and `default-rocket` profiles map to runtime pipeline IDs and packaged template bundles.
- Clarify the explicit `pipelineId: "rocket"` migration path and the deprecated omitted-`pipelineId` Rocket compatibility fallback removal policy.
