# Cross-locale regulator citation maps

Each `<locale>.json` file maps clauses from the local financial
regulator (KNF, BdE, DNB, ČNB, MNB, …) to the EU regulation those
clauses implement (PSD2, AMLD5, DORA, Solvency II, IDD, the EU AI Act,
the Consumer Credit Directive). The harness's
`compliance-rules` module uses these maps to surface the correct
regulator-specific evidence when generating tests under a given
locale's policy profile.

These maps are operator-curated. New locales are added by extending the
`SupportedLocale` union in `src/contracts/index.ts` and dropping a
new `<locale>.json` file here.
