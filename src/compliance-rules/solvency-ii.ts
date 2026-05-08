/**
 * Compliance rule pack — Solvency II.
 *
 * Insurer prudential framework with focus on the Solvency Capital
 * Requirement (SCR) reporting templates. Operational checks at the
 * data-input boundary — not the actuarial model itself.
 */

export const SOLVENCY_II_RULE_PACK = {
  schemaVersion: "1.0.0",
  framework: "SOLVENCY_II",
  title: "Solvency II",
  citationRoot:
    "Directive 2009/138/EC; Commission Implementing Regulation (EU) 2015/2450",
  description:
    "Operational test obligations on Solvency II reporting surfaces — Quantitative Reporting Templates (QRT) and SCR computation inputs.",
  rules: [
    {
      id: "SOLVENCY_II-SCR-Templates-QRT",
      citation:
        "Directive 2009/138/EC Article 100; CIR (EU) 2015/2450 Annex I (S.25)",
      description:
        "SCR Quantitative Reporting Templates: tests must verify required QRT cells accept valid inputs, reject negatives where the field semantics forbid them, and exercise the boundary at the reporting submission deadline.",
      domain: "insurance",
      mandatoryTestClasses: ["functional", "negative", "boundary"],
      severity: "error",
      keywords: [
        "scr",
        "solvency capital requirement",
        "qrt",
        "quantitative reporting template",
        "s.25",
        "solvency",
        "solvabilität",
        "solvabilitaet",
        "berichtsvorlage",
      ],
    },
    {
      id: "SOLVENCY_II-Own-Funds-Art-87",
      citation: "Directive 2009/138/EC Article 87; CDR (EU) 2015/35 Articles 69–82",
      description:
        "Own-funds tiering inputs: tests must validate tier-classification at boundary values and refuse a downgrade that violates the tiering hierarchy.",
      domain: "insurance",
      mandatoryTestClasses: ["validation", "boundary"],
      severity: "warning",
      keywords: [
        "own funds",
        "eigenmittel",
        "tier 1",
        "tier 2",
        "tier 3",
        "tiering",
        "klassifizierung",
      ],
    },
  ],
} as const;
