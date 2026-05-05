## Grenzwert‑Test für Gesamtfinanzierungsbedarf – Negativer Betrag

**Beschreibung:**

Prüfen, dass ein negativer Finanzierungsbedarf abgewiesen wird.

**Typ:** boundary · **Priorität:** p2 · **Risiko:** regulated_data · **Technik:** boundary_value_analysis

**Vorbedingungen:**
- Der Nutzer befindet sich im Empty‑State‑Bildschirm.

**Testdaten:**
- Finanzierungsbedarf: -1.000,00 €

**Schritte:**

### Step 1

**Beschreibung:**

Versuchen, den Betrag "-1.000,00 €" im Feld "Gesamtfinanzierungsbedarf" einzugeben

**Erwartetes Ergebnis:**

Das System zeigt eine Fehlermeldung und verhindert das Speichern.

**Gesamterwartung:**
- Fehlermeldung: "Der Betrag muss positiv sein" (oder ähnlich) wird angezeigt.

**Figma-Bezug:** 1:48176 — (1:48176::field::I1:48283;11963:15964;1898:124453;9445:27738;5213:6557;9445:28932;7841:102624)

**Regulatorische Relevanz:** banking — Negative Beträge sind regulatorisch unzulässig und müssen abgelehnt werden.

*Test-ID:* `tc-f2ed83154d2c`