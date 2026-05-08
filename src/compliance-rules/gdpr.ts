/**
 * Compliance rule pack — GDPR (General Data Protection Regulation).
 *
 * Focus: Article 32 (security of processing) — operational tests for
 * personal-data input handling. Reuses the existing PII detection
 * pipeline at runtime; this rule pack ensures generated test cases
 * exercise the boundary explicitly.
 */

export const GDPR_RULE_PACK = {
  schemaVersion: "1.0.0",
  framework: "GDPR",
  title: "General Data Protection Regulation (GDPR)",
  citationRoot: "Regulation (EU) 2016/679",
  description:
    "Operational obligations for personal-data handling under GDPR — focused on Article 32 (security of processing) and Article 25 (data protection by design).",
  rules: [
    {
      id: "GDPR-Security-Art-32",
      citation: "Regulation (EU) 2016/679 Article 32",
      description:
        "Security of processing: tests must verify that personal-data input fields refuse plaintext storage, exercise the redaction boundary, and exercise the negative path when an unredacted value attempts to flow into an export.",
      domain: "both",
      mandatoryTestClasses: ["negative", "validation", "boundary"],
      severity: "error",
      keywords: [
        "personal data",
        "personenbezogene daten",
        "pii",
        "redaction",
        "anonymisierung",
        "encryption",
        "verschlüsselung",
        "verschluesselung",
        "data security",
        "datensicherheit",
      ],
    },
    {
      id: "GDPR-By-Design-Art-25",
      citation: "Regulation (EU) 2016/679 Article 25",
      description:
        "Data protection by design and by default: tests must verify that consent / opt-in defaults are off, that the user can change the default, and that a missing-consent negative path blocks processing.",
      domain: "both",
      mandatoryTestClasses: ["functional", "negative"],
      severity: "warning",
      keywords: [
        "consent",
        "einwilligung",
        "opt-in",
        "opt out",
        "by design",
        "datenschutz",
        "data minimisation",
        "datenminimierung",
      ],
    },
  ],
} as const;
