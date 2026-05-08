/**
 * Compliance rule pack — MiFID II (Markets in Financial Instruments
 * Directive II).
 *
 * Focus: investment-services suitability and appropriateness assessment
 * obligations. Operational rules only; legal classification is out of
 * scope per the rule pack contract.
 */

export const MIFID_II_RULE_PACK = {
  schemaVersion: "1.0.0",
  framework: "MIFID_II",
  title: "Markets in Financial Instruments Directive II (MiFID II)",
  citationRoot: "Directive 2014/65/EU; Commission Delegated Regulation (EU) 2017/565",
  description:
    "Investment-services obligations: suitability (Art. 25(2)), appropriateness (Art. 25(3)), and required client-information disclosures.",
  rules: [
    {
      id: "MIFID_II-Suitability-Art-25-2",
      citation: "Directive 2014/65/EU Article 25(2); CDR 2017/565 Article 54",
      description:
        "Suitability assessment for advised investment services: tests must verify the suitability questionnaire is completed, validate negative outcomes when required fields are missing, and exercise the recommendation refusal path.",
      domain: "banking",
      mandatoryTestClasses: ["functional", "negative", "validation"],
      severity: "error",
      keywords: [
        "suitability",
        "geeignetheit",
        "geeignetheitsprüfung",
        "investment advice",
        "anlageberatung",
        "questionnaire",
        "fragebogen",
        "risk profile",
        "risikoprofil",
      ],
    },
    {
      id: "MIFID_II-Appropriateness-Art-25-3",
      citation: "Directive 2014/65/EU Article 25(3); CDR 2017/565 Article 56",
      description:
        "Appropriateness check for non-advised execution: tests must cover knowledge / experience capture and the explicit warning path when a product is deemed inappropriate.",
      domain: "banking",
      mandatoryTestClasses: ["functional", "validation"],
      severity: "warning",
      keywords: [
        "appropriateness",
        "angemessenheit",
        "angemessenheitsprüfung",
        "execution only",
        "kenntnisse",
        "erfahrung",
        "warning",
        "warnhinweis",
      ],
    },
    {
      id: "MIFID_II-Client-Info-Art-24",
      citation: "Directive 2014/65/EU Article 24; CDR 2017/565 Articles 44–51",
      description:
        "Client-information disclosure: cost, risk and conflict-of-interest disclosures must be presented before order entry — tests must cover the disclosure visibility and the disclosure-acknowledgement boundary.",
      domain: "banking",
      mandatoryTestClasses: ["functional", "boundary"],
      severity: "warning",
      keywords: [
        "disclosure",
        "offenlegung",
        "cost",
        "kosten",
        "conflict of interest",
        "interessenkonflikt",
        "risk warning",
        "risikohinweis",
      ],
    },
  ],
} as const;
