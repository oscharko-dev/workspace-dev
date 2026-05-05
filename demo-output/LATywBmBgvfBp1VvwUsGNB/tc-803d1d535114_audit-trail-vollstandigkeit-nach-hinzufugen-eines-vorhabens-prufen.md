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