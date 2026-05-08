/**
 * Compliance rule pack — EU AI Act.
 *
 * Operational obligations for high-risk AI systems used in banking and
 * insurance (creditworthiness assessment, life / health insurance
 * pricing, risk assessment). Operational rules only — legal
 * classification of "high risk" itself is out of scope.
 */

export const EU_AI_ACT_RULE_PACK = {
  schemaVersion: "1.0.0",
  framework: "EU_AI_ACT",
  title: "EU AI Act",
  citationRoot: "Regulation (EU) 2024/1689",
  description:
    "High-risk AI obligations relevant to banking / insurance use cases: human oversight, transparency, and risk-management system requirements.",
  rules: [
    {
      id: "EU_AI_ACT-Human-Oversight-Art-14",
      citation: "Regulation (EU) 2024/1689 Article 14",
      description:
        "Human oversight: tests must verify the operator can override an AI-driven decision, that an override is logged, and that the override-refusal path on out-of-policy operators is exercised.",
      domain: "both",
      mandatoryTestClasses: ["functional", "negative"],
      severity: "error",
      keywords: [
        "human oversight",
        "menschliche aufsicht",
        "override",
        "übersteuerung",
        "uebersteuerung",
        "operator",
        "intervention",
        "eingriff",
      ],
    },
    {
      id: "EU_AI_ACT-Transparency-Art-13",
      citation: "Regulation (EU) 2024/1689 Article 13",
      description:
        "Transparency to users: tests must verify the AI-driven recommendation surfaces an explanation, the explanation is reachable from the recommendation screen, and a missing-explanation negative-path is covered.",
      domain: "both",
      mandatoryTestClasses: ["functional", "validation"],
      severity: "warning",
      keywords: [
        "transparency",
        "transparenz",
        "explanation",
        "erklärung",
        "erklaerung",
        "explainability",
        "erklärbarkeit",
        "ai disclosure",
        "ki-hinweis",
      ],
    },
    {
      id: "EU_AI_ACT-Risk-Mgmt-Art-9",
      citation: "Regulation (EU) 2024/1689 Article 9",
      description:
        "Risk management system: tests must verify identified risks are surfaced, the user can review the risk assessment, and a refusal path triggers when residual risk exceeds a documented threshold.",
      domain: "both",
      mandatoryTestClasses: ["functional", "boundary"],
      severity: "warning",
      keywords: [
        "risk management",
        "risikomanagement",
        "residual risk",
        "restrisiko",
        "risk assessment",
        "risikobewertung",
      ],
    },
  ],
} as const;
