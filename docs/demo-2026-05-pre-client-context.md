# Banking-Domain-Kontext für Pre-Client-Demo (Mai 2026)

Dieses Dokument ist der Custom-Context-Markdown-Input für den Live-Re-Run
gegen `Test-View-04` (Figma-File-Key `LATywBmBgvfBp1VvwUsGNB`,
Node `1-48176`). Der Production-Runner kanonalisiert den Inhalt vor
jedem LLM-Aufruf (PII-Redaktion, Prompt-Injection-Neutralisierung,
Link-/HTML-/MDX-/Image-Refusal); das Original wird unter
`compiled-prompt.json` als eigene Sektion `[N] custom_context_markdown`
in den Generator-Prompt eingehängt.

Der Inhalt ist bewusst kurz und beschreibend, ohne PII, ohne
externe Links und ohne Code-Blöcke. Er richtet sich an einen
deutschen Bankenkunden mit aufsichtsrechtlicher Tiefe (DORA, EU-AI-Act,
BAIT, MaRisk) und definiert die fachlichen Erwartungen, die der
Logic-Judge und der Faithfulness-Judge in den generierten Test-Cases
sehen müssen.

## Geschäftsdomäne

Test-View-04 zeigt eine Eingabe-Maske im Vorhaben-Verwaltungsmodul
einer regulierten Geschäftsbank. Die Maske wird von Sachbearbeitern in
der Mittelmarkt-Finanzierung benutzt, um Kreditvorhaben mit hohem
Volumen zu erfassen, zu prüfen und an die Risikofunktion zu übergeben.

Die Domäne unterliegt dem Kreditwesengesetz (KWG), der MaRisk
(Mindestanforderungen an das Risikomanagement) und der BAIT
(Bankaufsichtliche Anforderungen an die IT). Der Empty-State-Bildschirm
führt den Sachbearbeiter durch die Erst-Anlage; der Eingabe-Bildschirm
zwingt zu einer fachlich konsistenten und vollständigen Erfassung
inklusive Vier-Augen-Prüfung.

## Verbindliche Geschäftsregeln

### Vier-Augen-Prinzip (MaRisk AT 4.3.1, BAIT)

- Jedes neu angelegte Kreditvorhaben muss vor Statuswechsel auf
  "freigegeben" durch eine zweite, fachlich qualifizierte Person
  geprüft und gegengezeichnet werden.
- Der Erfasser darf nicht zugleich Freigeber sein. Das System muss die
  Identität von Erfasser und Freigeber zwingend trennen und die
  Trennung im Audit-Trail festhalten.
- Ein Test-Case der Maske muss zumindest implizit prüfen, dass der
  Erfasser keinen "Freigeben"-Pfad ausführen kann.

### Audit-Trail (DORA Art. 18, BAIT, MaRisk AT 4.3.2)

- Jede Anlage, jede Änderung und jede Statusänderung eines
  Kreditvorhabens muss revisionssicher, lückenlos und unveränderlich
  protokolliert werden.
- Mindestumfang pro Eintrag: Zeitstempel (UTC), handelnde Person
  (Pseudonym oder fachliche Rolle), vorheriger Wert, neuer Wert,
  Begründungspflicht-Token bei Statuswechsel.
- Test-Cases müssen mindestens einen End-To-End-Pfad abdecken, der die
  Vollständigkeit des Audit-Trails verifiziert.

### Pflicht- und Plausibilitätsprüfungen

- Eingabefelder dürfen keine impliziten Defaults für regulatorisch
  relevante Werte verwenden (Vorhabens-Volumen, Laufzeit, Zinsbindung,
  Branche, Kreditart).
- Der Gesamtfinanzierungsbedarf muss in Euro mit fester
  Dezimaltrennung (Komma) und Tausenderpunkten dargestellt werden.
  Negative Werte und Werte über der konfigurierten
  Single-Borrower-Grenze sind sofort und mit klar lesbarer
  Fehlermeldung abzulehnen.
- Eingabefelder müssen XSS-, SQL-Injection- und Encoding-Angriffe
  abweisen, ohne den Sachbearbeiter mit technischen Details zu
  konfrontieren.

### Statusübergänge und Schritt-Reihenfolge

- "Vorhaben hinzufügen" ist nur aus dem Empty-State oder der Liste
  heraus erreichbar; ein direkter Aufruf ohne kontextuellen Eintritt
  ist abzuweisen.
- Vor jedem Speichern ist die Eingabe gegen die zuletzt gespeicherte
  Version zu prüfen, um stille Überschreibungen durch parallele
  Sitzungen zu verhindern (Optimistic-Concurrency-Guard).

## Fachliche Begriffe

- "Vorhaben" — ein einzelnes, eindeutig identifizierbares
  Kreditprojekt, das in einem Mappenverbund mit anderen Vorhaben des
  Kunden steht.
- "Mappe" — ein logischer Container für mehrere Vorhaben desselben
  Kunden mit gemeinsamer Risikohülle.
- "Sachbearbeiter" — interne Person mit fachlicher Anlage- und
  Bearbeitungsbefugnis, ohne Freigabebefugnis.
- "Freigeber" — interne Person mit Vier-Augen-Pflicht-Berechtigung,
  ohne Anlagebefugnis.
- "Audit-Trail" — chronologisch geordnete, nachträglich nicht
  veränderbare Ereignisliste pro Vorhaben mit forensischer
  Beweiskraft.

## Erwartungen an die generierten Test-Cases

Die im Live-Re-Run erzeugten Cases müssen die folgenden Eigenschaften
erfüllen, damit der Logic-Judge und der Faithfulness-Judge sie
akzeptieren:

- Mindestens ein Case zitiert das Vier-Augen-Prinzip explizit
  (Stichworte: "Vier-Augen", "Erfasser", "Freigeber",
  "Gegenzeichnung").
- Mindestens ein Case prüft die Vollständigkeit des Audit-Trails
  (Stichworte: "Audit-Trail", "Protokoll", "Revisionssicher",
  "Zeitstempel").
- Felder und Aktionen werden über `qualitySignals.coveredFieldIds`
  und `qualitySignals.coveredActionIds` referenziert; der
  Coverage-Hard-Gate aus Welle 3 (Issue #1901) blockt Cases mit
  leeren Coverage-Listen.
- Jeder Case hat einen klaren Vorbedingungs-Block, eine geordnete
  Schritt-Liste mit präzisen Erwartungswerten und einen
  Nachbedingungs-Block, der den Audit-Trail-Eintrag oder den
  Statuswechsel beschreibt.
- Fehlerpfade werden nicht in einen Optimal-Pfad-Case zusammengezogen,
  sondern erhalten dedizierte negative Test-Cases.

## Compliance-Rahmen für die Demo

Die Demo läuft unter dem Policy-Profil `eu-banking-default`. Daraus
ergeben sich harte Gates, die die Pipeline durchsetzt und die in der
Demo nicht abgeschaltet werden:

- DORA Art. 5 — IKT-Risikorahmen und Identifikation kritischer
  Funktionen, sichtbar in der Compliance-Block-Sektion des
  `policy-report.json`.
- DORA Art. 18 — Vorfallklassifikation und Meldepflicht; jeder Case,
  der einen Sicherheits- oder Verfügbarkeitsdefekt provoziert, muss
  ein Audit-Trail-Ergebnis fordern.
- EU-AI-Act Annex III, Punkt 5 (b) — Kreditwürdigkeitsbeurteilung
  natürlicher Personen ist Hochrisiko-KI; daher ist der Test-Case-Output
  ohne menschliche Prüfung nicht produktionsfreigegeben. Die Demo zeigt
  diese Pflichtprüfung im Inspector.
- BAIT 7.4 — Identitäts- und Berechtigungsmanagement, sichtbar im
  Vier-Augen-Test-Case.
- MaRisk AT 4.3.2 — Funktionsrolle Erfasser vs. Freigeber, sichtbar
  in der expliziten Trennung im generierten Test-Case-Text.

## Was nicht in den Cases erscheinen darf

Der Faithfulness-Judge weist Cases zurück, die folgende Klassen
verletzen, und der Repair-Loop muss sie korrigieren:

- Erfundene Feld-Identifier oder Aktions-Identifier, die nicht in der
  IR enthalten sind (Hallucination-Eval, Welle 4 Issue #1904).
- Erfundene Domänenbegriffe, die nicht in diesem Kontext-Dokument
  oder in der Figma-IR vorkommen.
- Aussagen, die das Vier-Augen-Prinzip relativieren oder die
  Audit-Trail-Pflicht aufweichen ("optional", "kann", "in
  Ausnahmefällen").
- Spekulationen über Performance-Werte, Latenzen oder
  Mengen-Schätzungen, die weder in Figma noch in diesem Dokument
  belegt sind.
