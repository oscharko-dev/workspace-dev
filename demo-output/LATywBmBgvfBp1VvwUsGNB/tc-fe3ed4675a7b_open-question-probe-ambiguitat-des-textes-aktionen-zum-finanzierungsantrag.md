## Open‑Question‑Probe – Ambiguität des Textes "Aktionen zum Finanzierungsantrag"

**Beschreibung:**

Klärung, ob der Text als reine Information oder als Anweisung behandelt wird.

**Typ:** exploratory · **Priorität:** p3 · **Risiko:** low · **Technik:** error_guessing

**Vorbedingungen:**
- Der Empty‑State‑Bildschirm ist geladen.

**Schritte:**

### Step 1

**Beschreibung:**

Den Text "Aktionen zum Finanzierungsantrag" lesen und prüfen, ob weitere UI‑Elemente als Hinweis darauf existieren

**Erwartetes Ergebnis:**

Der Text wird als reine Überschrift ohne interaktive Elemente dargestellt.

**Gesamterwartung:**
- Kein Hinweis auf interaktive Anweisungen; der Text bleibt informativ.

**Offene Fragen:**
- open-question-e77385a9a423

**Figma-Bezug:** 1:48176 — (1:48176::field::I1:48303;5213:6541;15753:46099)

**Regulatorische Relevanz:** general — Klärung von UI‑Ambiguitäten ist wichtig für Usability, hat aber keine regulatorische Auswirkung.

*Test-ID:* `tc-fe3ed4675a7b`