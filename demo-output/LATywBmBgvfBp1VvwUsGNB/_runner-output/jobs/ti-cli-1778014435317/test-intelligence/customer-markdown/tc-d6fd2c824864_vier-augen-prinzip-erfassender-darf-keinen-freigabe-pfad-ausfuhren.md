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