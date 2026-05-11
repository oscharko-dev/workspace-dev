/**
 * Compliance rule pack — DORA (Digital Operational Resilience Act).
 *
 * Focus: third-party ICT risk obligations (Article 28) and incident
 * reporting boundaries. Cross-cutting: applies to both banking and
 * insurance entities.
 */

export const DORA_RULE_PACK = {
  schemaVersion: "1.0.0",
  framework: "DORA",
  title: "Digital Operational Resilience Act (DORA)",
  citationRoot: "Regulation (EU) 2022/2554",
  description:
    "Operational obligations for ICT third-party risk and incident-reporting flows under DORA.",
  rules: [
    {
      id: "DORA-Third-Party-Art-28",
      citation: "Regulation (EU) 2022/2554 Article 28",
      description:
        "ICT third-party risk-management: tests must verify the contract-clause boundary checks (exit, audit rights, data location) and refuse a contract that lacks a mandatory clause.",
      domain: "both",
      mandatoryTestClasses: ["functional", "negative", "boundary"],
      severity: "error",
      keywords: [
        "third party",
        "third-party",
        "drittpartei",
        "ict provider",
        "ikt-anbieter",
        "outsourcing",
        "auslagerung",
        "exit clause",
        "ausstiegsklausel",
        "audit right",
        "prüfrecht",
      ],
    },
    {
      id: "DORA-Incident-Reporting-Art-19",
      citation: "Regulation (EU) 2022/2554 Article 19",
      description:
        "Major ICT-related incident reporting: tests must verify the initial / intermediate / final-report boundary on the reporting form and exercise the negative path when a required severity field is empty.",
      domain: "both",
      mandatoryTestClasses: ["functional", "validation", "boundary"],
      severity: "warning",
      keywords: [
        "incident",
        "vorfall",
        "major incident",
        "schwerer vorfall",
        "incident reporting",
        "vorfallsmeldung",
        "severity",
        "schweregrad",
      ],
    },
  ],
} as const;
