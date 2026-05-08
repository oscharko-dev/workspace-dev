/**
 * Compliance rule pack — PSD2 (Payment Services Directive 2).
 *
 * Operational rules covering Strong Customer Authentication (Article
 * 97) and the supporting Articles 73–74 (chargeback / authorisation
 * boundary). Curated for operational test coverage; not legal advice.
 *
 * Source citations point to the consolidated PSD2 text (Directive
 * (EU) 2015/2366) and EBA RTS 2018/389. Updates are manual.
 */

export const PSD2_RULE_PACK = {
  schemaVersion: "1.0.0",
  framework: "PSD2",
  title: "Payment Services Directive 2 (PSD2)",
  citationRoot: "Directive (EU) 2015/2366; EBA RTS 2018/389",
  description:
    "Operational test obligations for PSD2 — Strong Customer Authentication, transaction risk analysis, and chargeback / authorisation boundaries.",
  rules: [
    {
      id: "PSD2-SCA-Art-97",
      citation: "PSD2 Article 97; EBA RTS Article 4",
      description:
        "Strong Customer Authentication (SCA) must be enforced for online payments and account access; tests must cover successful 2-factor flows and explicit refusal of single-factor attempts on regulated screens.",
      domain: "banking",
      mandatoryTestClasses: ["functional", "negative"],
      severity: "error",
      keywords: [
        "sca",
        "strong customer authentication",
        "starke kundenauthentifizierung",
        "2fa",
        "two-factor",
        "zwei-faktor",
        "otp",
        "tan",
        "authentication",
        "authentifizierung",
      ],
    },
    {
      id: "PSD2-Risk-Analysis-Art-18-RTS",
      citation: "EBA RTS 2018/389 Article 18 (Transaction Risk Analysis)",
      description:
        "Transaction Risk Analysis exemptions require boundary tests at the configured exemption thresholds and negative-path tests for thresholds exceeded.",
      domain: "banking",
      mandatoryTestClasses: ["boundary", "negative"],
      severity: "warning",
      keywords: [
        "risk analysis",
        "risikoanalyse",
        "exemption",
        "ausnahme",
        "transaction limit",
        "betragslimit",
        "low value",
        "geringer betrag",
      ],
    },
    {
      id: "PSD2-Charge-Auth-Art-73-74",
      citation: "PSD2 Articles 73–74",
      description:
        "Unauthorised payment liability boundary: tests must cover authorised-payment success, dispute / chargeback path, and refusal on missing consent.",
      domain: "banking",
      mandatoryTestClasses: ["functional", "negative", "validation"],
      severity: "warning",
      keywords: [
        "chargeback",
        "rückerstattung",
        "rueckerstattung",
        "consent",
        "einwilligung",
        "authorisation",
        "autorisierung",
        "dispute",
        "widerspruch",
        "unauthorised",
        "unautorisiert",
      ],
    },
  ],
} as const;
