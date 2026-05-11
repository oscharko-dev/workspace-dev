/**
 * Compliance rule pack — IDD (Insurance Distribution Directive).
 *
 * Demands-and-needs and product-information obligations for insurance
 * distribution. Operational rules; legal classification out of scope.
 */

export const IDD_RULE_PACK = {
  schemaVersion: "1.0.0",
  framework: "IDD",
  title: "Insurance Distribution Directive (IDD)",
  citationRoot: "Directive (EU) 2016/97; Commission Delegated Regulation (EU) 2017/2358",
  description:
    "Demands-and-needs assessment, advice statement and product information obligations for insurance distribution.",
  rules: [
    {
      id: "IDD-Demands-Needs-Art-20",
      citation: "Directive (EU) 2016/97 Article 20",
      description:
        "Demands-and-needs assessment: tests must validate that the customer's stated demands are captured, that the recommendation aligns, and that the negative path covers a mismatch between recommended product and demands.",
      domain: "insurance",
      mandatoryTestClasses: ["functional", "negative", "validation"],
      severity: "error",
      keywords: [
        "demands and needs",
        "wünsche und bedürfnisse",
        "wuensche und beduerfnisse",
        "bedarfsanalyse",
        "demand analysis",
        "needs analysis",
        "kundenwunsch",
      ],
    },
    {
      id: "IDD-Advice-Statement-Art-20-1",
      citation: "Directive (EU) 2016/97 Article 20(1)",
      description:
        "Personalised advice statement: tests must verify that an advice statement is generated and presented before contract conclusion when advice is given.",
      domain: "insurance",
      mandatoryTestClasses: ["functional"],
      severity: "warning",
      keywords: [
        "advice statement",
        "beratungsdokumentation",
        "beratungsprotokoll",
        "personal recommendation",
        "persönliche empfehlung",
      ],
    },
    {
      id: "IDD-IPID-Art-20-5",
      citation: "Directive (EU) 2016/97 Article 20(5); IR (EU) 2017/1469",
      description:
        "Insurance Product Information Document (IPID): tests must verify the IPID is presented for non-life products before contract conclusion and that the customer can access / download it.",
      domain: "insurance",
      mandatoryTestClasses: ["functional", "validation"],
      severity: "warning",
      keywords: [
        "ipid",
        "produktinformationsblatt",
        "non-life",
        "schadenversicherung",
        "product information",
        "produktinformation",
      ],
    },
  ],
} as const;
