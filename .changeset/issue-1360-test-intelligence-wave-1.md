---
"workspace-dev": minor
---

Introduce opt-in Figma-to-QC test case contract surface for Issue #1360.

- Add `WorkspaceJobType` discriminator with values `"figma_to_code"` (default) and `"figma_to_qc_test_cases"`.
- Add `WorkspaceTestIntelligenceMode` namespace (`"deterministic_llm" | "offline_eval" | "dry_run"`) isolated from `llmCodegenMode`.
- Add `WorkspaceStartOptions.testIntelligence?: { enabled: boolean }` startup feature gate.
- Add `FIGMAPIPE_WORKSPACE_TEST_INTELLIGENCE=1` environment gate.
- `POST /workspace/submit` with `jobType="figma_to_qc_test_cases"` fails closed with `503 FEATURE_DISABLED` unless both gates are enabled.
- Export contract/schema/prompt-template version constants for the new surface.
- `llmCodegenMode=deterministic` mode-lock is unchanged and remains isolated.
