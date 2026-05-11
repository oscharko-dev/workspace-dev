# Per-locale terminology glossaries

Banking + insurance term glossaries used by `prompt-compiler.ts`
when emitting locale-tagged prompts. Each `<locale>.json` file has
exactly two top-level maps:

- `banking` — at least 50 banking terms (account, IBAN, transfer,
  card, loan, etc.) translated into the locale's native language.
- `insurance` — at least 30 insurance terms (policy, premium,
  deductible, etc.) translated into the locale's native language.

These glossaries are operator-curated. The harness consumes them but
never edits them. New locales are added by extending the
`SupportedLocale` union in `src/contracts/index.ts` and dropping a
new `<locale>.json` file here following the same shape.
