---
"workspace-dev": minor
---

Promote customer-supplied markdown to a dedicated `[5] CustomerDomainContext` prompt section for Issue #1941.

- Move `custom_context_markdown` out of `[7] Findings / RepairInstructions / Iteration Inputs` (now `[8]`) into a new authoritative `[5] CustomerDomainContext` section that signals "customer-supplied banking/insurance domain rules — cite via `figmaTraceRefs (screenId="custom_context_markdown")` or `assumptions/openQuestions` prefixes".
- Re-number downstream sections so the canonical order is `[1] System Instructions`, `[2] AgentRoleProfile`, `[3] TestDesignModel`, `[4] CoveragePlan`, `[5] CustomerDomainContext` (optional), `[6] Customer Rubric`, `[7] AgentLessons`, `[8] Findings / RepairInstructions / Iteration Inputs`, `[9] Output Schema-Hint`, `[10] RiskPriorities`.
- Tighten the system-prompt wording so the model treats `[5] CustomerDomainContext` as the authoritative customer source rather than as supporting evidence.
- Bump `TEST_INTELLIGENCE_PROMPT_TEMPLATE_VERSION` from `1.2.0` to `1.3.0` so the replay cache picks up the new layout.
- Mark the customer-domain category as `priority: "required"` (compactible, non-droppable) so the budget analyzer compacts it instead of silently dropping authoritative customer rules.
- Backwards-compat: when `customContextMarkdown` is absent the `[5]` section is omitted entirely; the structured-attributes payload stays in `[8] Findings`.
