# Testfall eines Anwendungstests - Bewertungsrubrik 2026

Diese Rubrik beschreibt, wann ein generierter Testfall fuer einen Anwendungstest in Banken und Versicherungen in Europa als kundenfaehig gilt. Sie ist auf fachliche Anwendungstests ausgerichtet, nicht auf reine Penetrationstests oder technische Unit-Tests. Sicherheits-, Datenschutz-, Barrierefreiheits- und Resilienzanforderungen muessen aber abgedeckt werden, wenn sie aus Quelle, Maske, Prozess oder Nutzungskontext ableitbar sind.

## 1. Zielbild

Ein Testfall beschreibt genau einen fachlich zusammenhaengenden Nutzungskontext oder einen klar abgegrenzten Teilbereich einer komplexen Maske. Er muss durch eine fachkundige Testperson ohne Rueckfragen ausfuehrbar sein, ohne fachliche Regeln zu erfinden.

Gute Testfaelle sind:

- quellgetreu: jede fachliche Erwartung ist aus Maske, Story, Akzeptanzkriterium, Prozessbeschreibung oder einer explizit markierten Annahme ableitbar.
- pruefbar: jeder Step hat genau eine Testaktion und ein beobachtbares erwartetes Ergebnis.
- risikobewusst: kritische Finanz-, Versicherungs-, Datenschutz-, Resilienz- und Barrierefreiheitsaspekte werden priorisiert.
- auditierbar: Traceability, Testdaten, Annahmen, offene Fragen und Evidenzanforderungen sind nachvollziehbar.
- kundentauglich: Sprache ist klar, professionell, deutsch und frei von internen IDs, technischen Hashes oder Prompt-Artefakten.

## 2. Mindestformat je Testfall

Jeder Testfall MUSS enthalten:

- Titel: kurz, eindeutig, unterscheidbar; ein fachliches Praefix wie `TC01` ist erlaubt.
- Beschreibung: Zweck, Umfang, Nutzungskontext und fachliches Risiko in 1-3 Saetzen.
- Vorbedingungen: notwendiger Systemzustand, Rolle/Berechtigung, Vertrags-/Kundenstatus, Testumgebung und relevante Konfiguration.
- Testdaten: synthetisch oder maskiert; keine produktiven personenbezogenen Daten, keine echten IBANs, Zugangsdaten, Tokens oder Kundennummern.
- Schritte: fortlaufend nummeriert; genau eine Testaktion pro Step; keine versteckten Mehrfachaktionen.
- Erwartetes Ergebnis je Step: konkreter beobachtbarer Zustand der Anwendung, inklusive UI-Feedback, Berechnung, Persistenz, Status, Fehlertext oder Folgeaktion, soweit durch Quellen gestuetzt.
- Nachbedingungen oder Ruecksetzung: falls der Test Daten veraendert, Zahlungen ausloest, Antraege speichert, Policenstatus aendert oder Folgeprozesse startet.
- Traceability: Bezug zu Akzeptanzkriterien, Quellelementen, fachlichen Regeln oder Screen-Bereichen.
- Klassifikation: positiv, negativ, Grenzwert, Barrierefreiheit, Berechtigung, Fehlerbehandlung, Regression oder End-to-End.

## 3. Umfang und Schnitt

Ein Testfall darf nicht zu gross werden. Als Standard gilt: eine Maske in einem konkreten fachlichen Kontext entspricht einem Testfall. Fuer andere Kontexte, Rollen, Produktarten, Status oder Datenklassen werden eigene Testfaelle erstellt.

Komplexe Masken muessen aufgeteilt werden, wenn:

- mehrere fachliche Bereiche unabhaengig voneinander funktionieren oder ausfallen koennen.
- ein Defect in einem Bereich die Pruefung anderer Bereiche nicht blockieren soll.
- Eingabe, Berechnung, Freigabe, Versand, Persistenz oder Folgeprozess unterschiedliche Risiken haben.
- unterschiedliche Rollen beteiligt sind, z. B. Sachbearbeitung, Vier-Augen-Freigabe, Kunde, Vermittler, Backoffice oder Revision.

Ein Testfall darf mehrere Schritte enthalten, aber nur so viele, wie zur Pruefung des einen Nutzungskontexts noetig sind.

## 4. Inhaltliche Abdeckung

Eine gute Testsuite fuer einen Anwendungsbereich enthaelt mindestens:

- Positive Hauptpfade fuer die wichtigsten fachlichen Workflows.
- Negative Faelle fuer ungueltige, fehlende, widerspruechliche oder nicht berechtigte Eingaben.
- Grenzwerte und Aequivalenzklassen fuer Betraege, Datumswerte, Prozentwerte, Laufzeiten, Deckungssummen, Limite, Fristen und Pflichtfelder, wenn Regeln spezifiziert sind.
- Fehlerbehandlung: fachliche Fehlermeldung, Feldmarkierung, Fokus, keine Datenkorruption, keine stillen Teilbuchungen.
- Rollen und Berechtigungen: erlaubte und verbotene Aktionen, soweit Rollen aus der Quelle hervorgehen.
- Status- und Zustandsuebergaenge: Entwurf, eingereicht, geprueft, freigegeben, abgelehnt, storniert, abgelaufen oder vergleichbare Prozesszustaende.
- Persistenz und Wiederaufnahme: Speichern, Aktualisieren, Neuladen, Session-Ablauf und Wiederaufnahme, wenn relevant.
- Barrierefreiheit fuer digitale Kunden- und Mitarbeiterkanaele: Tastaturbedienung, Fokusreihenfolge, Screen-Reader-Name, Fehlerankuedigung, Kontrast, genug Zeit, konsistente Navigation.
- Resilienz- und Fehlerpfade: Timeout, nicht erreichbarer Umsystemdienst, Retry, Doppelabsendung, idempotente Verarbeitung, Fallback oder klare Stoerungsmeldung, wenn die Quelle oder Kritikalitaet dies nahelegt.

## 5. Banken- und Versicherungsleitplanken Europa 2026

Testfaelle fuer Banken und Versicherungen muessen regulatorisch vorsichtig formuliert sein. Es duerfen keine Regeln erfunden werden, die nicht in den Quellen stehen.

Pflichtleitplanken:

- DORA / digitale operationale Resilienz: Kritische oder wichtige Funktionen muessen risikobasiert getestet werden. Bei incident-relevanten Pfaden sind beobachtbare Resilienz-, Fehler- oder Recovery-Erwartungen zu formulieren, sofern sie aus Quelle oder Kontext ableitbar sind.
- Datenschutz / DSGVO: Testdaten muessen zweckgebunden, minimiert, synthetisch oder maskiert sein. Produktive personenbezogene Daten, echte Kontodaten, echte Versicherungsnummern oder Secrets sind unzulaessig.
- European Accessibility Act / digitale Barrierefreiheit: Fuer Consumer-Banking, Zahlungs-, Self-Service-, Online- und Mobile-Kanaele sind Accessibility-Testfaelle Teil der erwarteten Abdeckung.
- Auditierbarkeit: Bei finanziellem Risiko, Vertragsabschluss, Deckungsentscheidung, Zahlung, Tarifierung, Limit, Freigabe oder Ablehnung muss der erwartete Zustand nachvollziehbar sein. Audit- oder Protokollierungsanforderungen duerfen nur behauptet werden, wenn sie aus Quelle oder Systemkontext hervorgehen.
- Fachliche Sorgfalt: Betraege, Steuer-/Abgabenlogik, Zinssaetze, Praemien, Deckungen, Schwellen, Rundungsregeln, Fristen und Fehlermeldungen duerfen nur konkret erwartet werden, wenn sie spezifiziert sind. Sonst ist eine offene Frage oder ein Klaerungstest zu erzeugen.

## 6. Umgang mit unklaren Anforderungen

Wenn eine fachliche Regel nicht spezifiziert ist, MUSS der Testfall dies sichtbar machen. Nicht erlaubt ist, fehlende Regeln durch plausible Annahmen zu ersetzen.

Bei unklaren Anforderungen:

- konkrete Berechnungsergebnisse, Fehlermeldungen, Grenzwerte oder Validierungsregeln nicht erfinden.
- die Unsicherheit als `Offene Frage` oder als klaerender negativer Testfall formulieren.
- Testdaten nur verwenden, wenn sie als Beispiel oder UI-Evidenz markiert sind und keine normative Erwartung daraus abgeleitet wird.
- erwartete Ergebnisse so formulieren, dass sie den Klaerungsbedarf sichtbar machen, z. B. "Das System zeigt eine fachlich spezifizierte Validierungsreaktion" nur wenn die Spezifikation auf eine noch zu klaerende Validierung verweist.
- keine IBAN, BIC, Vertragsnummer, Kundennummer, Audit-Trail, Vier-Augen-Freigabe, Submit-Button oder Backend-Verhalten hinzuerfinden.

## 7. Qualitaetskriterien und Scoring

Gesamtscore: 100 Punkte.

| Kategorie | Punkte | Erwartung |
| --- | ---: | --- |
| Struktur und Ausfuehrbarkeit | 15 | Vollstaendiges Mindestformat, klare Vorbedingungen, ein Step pro Aktion, erwartetes Ergebnis je Step, sinnvolle Nachbedingungen. |
| Quelltreue und fachliche Korrektheit | 25 | Keine Halluzinationen, keine Widersprueche, keine erfundenen Regeln; Annahmen und offene Fragen sind sauber markiert. |
| Fachliche Abdeckung | 20 | Positive, negative, Grenzwert-, Status-, Rollen- und Fehlerpfade decken den Nutzungskontext angemessen ab. |
| Regulatorische und Risikoabdeckung | 15 | DORA-, Datenschutz-, Accessibility-, Auditierbarkeits- und Kritikalitaetsaspekte sind risikobasiert beruecksichtigt. |
| Testdatenqualitaet | 10 | Testdaten sind realistisch, synthetisch/maskiert, minimal, eindeutig und passen zu Rolle, Produkt und Kontext. |
| Traceability und Evidenz | 10 | Testfaelle sind auf Quellen, Akzeptanzkriterien, Screen-Bereiche oder fachliche Regeln rueckverfolgbar; benoetigte Evidenz ist klar. |
| Kundentaugliche Sprache | 5 | Professionelles Deutsch, keine internen IDs, keine Prompt-Artefakte, konsistente Begriffe und Formatierung. |

Mindestschwelle:

- 90+ Punkte: kundenfaehig.
- 80-89 Punkte: fachlich brauchbar, aber Review vor Kundenfreigabe erforderlich.
- 70-79 Punkte: nur intern nutzbar; relevante Luecken beheben.
- unter 70 Punkte: nicht akzeptieren.

## 8. Harte Ablehnungskriterien

Ein Testfall oder eine Testsuite ist nicht akzeptabel, wenn eines der folgenden Kriterien zutrifft:

- Ein Step hat kein erwartetes Ergebnis.
- Mehrere Testaktionen werden in einem Step vermischt.
- Fachliche Erwartungen widersprechen den Quellen.
- Unklare Berechnungs-, Steuer-, Zins-, Praemien-, Deckungs-, Limit- oder Validierungsregeln werden konkret erfunden.
- Produktive oder realistisch identifizierbare personenbezogene Daten, Secrets, echte Kontodaten oder echte Vertragsdaten werden verwendet.
- Negative Faelle fehlen vollstaendig, obwohl Eingaben oder Entscheidungen validiert werden muessen.
- Barrierefreiheit fehlt bei einem digitalen Kundenkanal oder einer relevanten Mitarbeitermaske vollstaendig.
- Interne IDs, technische Hashes, Prompt-Labels oder Rohquellenpraefixe erscheinen im kundenfaehigen Testfall.
- Der Testfall ist nicht reproduzierbar, weil Rolle, Vorbedingung, Testdaten oder Systemzustand fehlen.

## 9. Gute Formulierungen

Bevorzugt:

- "Gib einen synthetischen Kaufpreis von 45.000,00 EUR ein."
- "Das Feld akzeptiert den Wert und zeigt ihn im spezifizierten Format an."
- "Das System zeigt eine fachlich spezifizierte Validierungsreaktion; genaue Regel ist als offene Frage zu klaeren."
- "Die Fehlermeldung ist per Screen Reader wahrnehmbar und der Fokus bleibt am fehlerhaften Feld."
- "Der Antrag bleibt im Status `Entwurf`; es wird keine Buchung und kein Folgeprozess ausgeloest."

Zu vermeiden:

- "Das System berechnet 53.550,00 EUR", wenn Rundung, Steuer- oder Berechnungsregel nicht spezifiziert ist.
- "Eine Audit-Trail-Meldung wird geschrieben", wenn Protokollierung nicht aus der Quelle hervorgeht.
- "Der Nutzer klickt Submit", wenn kein Submit-Element sichtbar oder spezifiziert ist.
- "Nutze echte Kontodaten" oder echte Kundendaten.
- "Pruefe alles auf der Maske" ohne klaren Nutzungskontext.

## 10. Grounding Stand 2026

Diese Rubrik orientiert sich an folgenden aktuellen Leitplanken:

- EU DORA, Regulation (EU) 2022/2554: digitale operationale Resilienz, ICT-Risikomanagement, Incident Management, Resilienztests und Third-Party-Risiken fuer Finanzunternehmen.
- EBA Guidelines on ICT and security risk management: robuste ICT- und Security-Risikosteuerung fuer Banken, Investmentfirmen und Zahlungsdienstleister.
- EIOPA ICT security and governance guidance sowie DORA-Uebergang fuer Versicherungs- und Rueckversicherungsunternehmen.
- European Accessibility Act, Directive (EU) 2019/882: Accessibility-Anforderungen fuer u. a. Banking Services, ATMs, Payment Terminals und digitale Services seit 28. Juni 2025.
- WCAG 2.2: aktueller W3C-Standard fuer pruefbare digitale Barrierefreiheit.
- DSGVO, insbesondere Grundsaetze der Zweckbindung, Datenminimierung, Richtigkeit, Speicherbegrenzung sowie Integritaet und Vertraulichkeit.
- ISO/IEC/IEEE 29119-4:2021: etablierte Testdesign-Techniken als Referenz fuer Aequivalenzklassen, Grenzwertanalyse, zustandsbasierte und andere systematische Testverfahren.
