# Testfälle: Test-View-04

Quelle: https://www.figma.com/design/LATywBmBgvfBp1VvwUsGNB/Test-View-04
Generiert am: 2026-05-05T20:53:55.317Z
Anzahl Testfälle: 4

---

## Audit‑Trail – Vollständigkeit nach Hinzufügen eines Vorhabens prüfen

**Beschreibung:**

Sicherstellen, dass nach dem Hinzufügen eines Vorhabens ein vollständiger Audit‑Trail‑Eintrag erzeugt wird.

**Typ:** functional · **Priorität:** p0 · **Risiko:** financial_transaction · **Technik:** error_guessing

**Vorbedingungen:**
- Ein Sachbearbeiter mit Rolle "Erfasser" ist angemeldet.
- Der Empty‑State‑Bildschirm ist sichtbar.

**Testdaten:**
- Vorhaben‑Name: "TestVorhaben"
- Finanzierungsbedarf: 100.000,00 €

**Schritte:**

### Step 1

**Beschreibung:**

Auf "Vorhaben hinzufügen" klicken

**Erwartetes Ergebnis:**

Eingabemaske für ein neues Vorhaben wird geöffnet.

### Step 2

**Beschreibung:**

Daten eingeben und speichern

**Erwartetes Ergebnis:**

Vorhaben wird gespeichert und die Ansicht kehrt zum Empty‑State zurück.

### Step 3

**Beschreibung:**

Audit‑Trail‑Log prüfen

**Erwartetes Ergebnis:**

Ein Eintrag mit Zeitstempel, Nutzer‑ID, vorheriger Wert (null) und neuem Wert ist vorhanden.

**Gesamterwartung:**
- Der Audit‑Trail enthält einen vollständigen, revisionssicheren Eintrag.

**Annahmen:**
- custom_context_markdown:Audit‑Trail

**Figma-Bezug:** 1:48176 — (1:48176::action::I1:48300;9445:27735;11963:15964;1898:124453;26900:18826)

**Regulatorische Relevanz:** banking — Der Test validiert die vorgeschriebene lückenlose Protokollierung von Vorgängen.

*Test-ID:* `tc-803d1d535114`

---

## Vier‑Augen‑Prinzip – Erfassender darf keinen Freigabe‑Pfad ausführen

**Beschreibung:**

Verifizieren, dass ein Nutzer mit Anlagedaten nicht die Aktion "Freigeben" sehen oder ausführen kann.

**Typ:** negative · **Priorität:** p0 · **Risiko:** financial_transaction · **Technik:** error_guessing

**Vorbedingungen:**
- Ein Sachbearbeiter (Erfasser) hat die Rolle "Erfasser" zugewiesen.
- Der Empty‑State‑Bildschirm ist geöffnet.

**Schritte:**

### Step 1

**Beschreibung:**

Im Empty‑State‑Bildschirm nach der Schaltfläche "Freigeben" suchen

**Erwartetes Ergebnis:**

Die Schaltfläche ist nicht sichtbar.

### Step 2

**Beschreibung:**

Versuchen, die Aktion "Freigeben" über die URL oder Shortcut aufzurufen

**Erwartetes Ergebnis:**

Zugriff wird verweigert und es erscheint eine Fehlermeldung.

**Gesamterwartung:**
- Der Erfassende kann keine Freigabe‑Aktion ausführen; das System verhindert den Zugriff.

**Annahmen:**
- custom_context_markdown:Vier‑Augen‑Prinzip

**Figma-Bezug:** 1:48176 — (1:48176::action::I1:48300;9445:27735;11963:15964;1898:124453;26900:18826); custom_context_markdown — Vier‑Augen‑Prinzip

**Regulatorische Relevanz:** banking — Der Test stellt sicher, dass das Vier‑Augen‑Prinzip im System durchgesetzt wird.

*Test-ID:* `tc-d6fd2c824864`

---

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

---

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
