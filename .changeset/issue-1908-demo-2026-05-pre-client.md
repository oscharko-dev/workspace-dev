---
"workspace-dev": patch
---

Pre-client demo walk-through deliverables for Issue #1908 (audit-2026-05 Welle 5).

- New `docs/demo-2026-05-pre-client.md` 12-15-minute Drehbuch covering input → CLI → multi-agent pipeline → output → compliance-block; references the live re-run job `ti-cli-1778014435317` against Figma file `LATywBmBgvfBp1VvwUsGNB`, node `1-48176`.
- New `docs/demo-2026-05-pre-client-context.md` banking-domain custom-context-markdown (Vier-Augen-Prinzip, Audit-Trail, DORA / EU-AI-Act / BAIT / MaRisk references), canonicalization-safe (no links, HTML, MDX, frontmatter).
- New `docs/demo-2026-05-pre-client-finops-budget.json` permissive demo FinOps envelope; production default stays unchanged (operator directive).
- New `demo-output/LATywBmBgvfBp1VvwUsGNB/` committed sample output from the live re-run with all three Live-Azure deployments active (`gpt-oss-120b` generator + Logic-Judge, `mistral-document-ai-2512` visual primary, `llama-4-maverick-vision` visual fallback) so a customer can drill into the artefact tree (compiled-prompt, generated-testcases, coverage-report, finops/budget-report, agent-role-runs/logic_judge, visual-sidecar-result, evidence-seal, customer-markdown, genealogy) without re-running the live pipeline.

No public contract surface changes; `CONTRACT_VERSION` is not bumped.
