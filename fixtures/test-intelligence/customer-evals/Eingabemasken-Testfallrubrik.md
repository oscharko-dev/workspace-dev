# Eingabemasken-Testfallrubrik fuer Banken und Versicherungen 2026

Diese Rubrik ergaenzt `Testfall-eines-Anwendungstests.md` um konkrete
Pruefkriterien fuer die fuenfzehn Eingabemasken-Fixtures unter
`src/test-intelligence/fixtures/eingabemaske-*.figma.json`. Sie
beschreibt, welche Testfaelle ein generischer Generator je
Maskenarchetyp mindestens erzeugen muss, damit das Ergebnis
kundenfaehig im Sinne der Mutterrubrik (Score 90+) ist.

Begriffsabgrenzung: "Eingabemaske" ist hier eine konkrete UI-Maske
einer Banken- oder Versicherungsanwendung. Die Eingabemasken-Suite
sitzt eine Tier ueber den generischen MA-0-Baselines: wo MA-0 nur
prueft ob das System grundsaetzlich Felder, Aktionen und Validierungen
ableiten kann, prueft Eingabemasken ob es regulatorisch belastbare
Testfaelle erzeugt.

## 1. Geltungsbereich

Diese Rubrik gilt verbindlich fuer alle Testfaelle, die der Harness
gegen eine Eingabemasken-Fixture erzeugt. Sie gilt ergaenzend zu, nicht
ersetzend gegenueber:

- der allgemeinen Bewertungsrubrik in `Testfall-eines-Anwendungstests.md`
  (Punkte 1 bis 9, insbesondere Section 8 zu harten Ablehnungskriterien)
- den Policy-Profilen in `policy-profile.ts`, namentlich
  `EU_BANKING_DEFAULT_TECHNIQUE_COVERAGE_MINIMUM` (tier-elastic) und
  den `policy:technique-coverage-minimum`-Quoten je Archetyp
- der Faithfulness-Schwelle in `faithfulness-judge.ts` und der
  zugehoerigen Tier-Klassifikation `label_only` vs `concrete_data`

## 2. Tier-Definition der Eingabemasken-Suite

Die fuenfzehn Fixtures sind in drei Tiers gegliedert. Tier-Stufen
beschreiben Anforderungen an den Generator, nicht das Risiko der
modellierten Anwendung.

### Tier 1: smoke / baseline

Vier Fixtures (SEPA-Ueberweisung, Online-Banking-Login, KFZ-Tarif
Schritt 1, Hausrat-Schadenmeldung). Pflichtabdeckung je Fixture:

- ein Hauptpfad-Testfall der die Maske vollstaendig ausfuellt und das
  primaere Action-Element ausloest
- mindestens ein negativer Testfall fuer das aerteste Pflichtfeld der
  Maske (typischerweise das, dessen Fehlen den Hauptpfad sofort
  blockiert: IBAN, PIN, HSN, Schadendatum)
- mindestens ein Format- oder Bereichs-Negativtest, wenn die Maske
  format- oder bereichsgebundene Validierungen enthaelt (Mod-97 IBAN,
  ISO-Datum, Length-Constraint, Numeric-Range)
- wenn die Maske >= 2 Screens hat: ein Testfall der den
  Navigations-Pfad inklusive Rueckweg pruelt (Cancel-Button,
  Zurueck-Button, Browser-Zurueck wenn modelliert)

Tier-1-Suiten sind klein. Eine Suite mit weniger als drei Testfaellen
je Fixture wird abgelehnt.

### Tier 2: realistic / regulatorisch belastbar

Sechs Fixtures (MiFID-Order, Konsumentenkredit-Antrag, KYC-Onboarding,
BU-Antrag, KFZ-Vollkasko-Schaden, LV-Bezugsberechtigung). Pflichtabdeckung
zusaetzlich zu Tier 1:

- Conditional-Requiredness: jeder Zweig einer Bedingung muss durch
  einen positiven und einen negativen Testfall abgedeckt sein. Z. B.
  bei der MiFID-Order der Limit-Preis: ein Testfall mit Order-Typ Limit
  und gesetztem Preis, ein Testfall mit Order-Typ Market und leerem
  Preis (positiv), ein Testfall mit Order-Typ Limit und leerem Preis
  (negativ).
- Cross-field-Constraints: jeder Cross-field-Constraint muss durch einen
  Plausibilitaetstest abgedeckt sein. Z. B. BU-Rente <= 60 Prozent
  Jahresbrutto / 12, Quoten-Summe = 100 Prozent in der LV-Bezugsberechtigung,
  DTI-Quote als Funktion von Rate und Nettoeinkommen.
- Computed-Fields: jeder RESULT_DISPLAY-Knoten muss durch mindestens
  einen Klaerungstest abgedeckt sein, sofern die Berechnungsregel nicht
  vollstaendig spezifiziert ist (siehe Section 6 der Mutterrubrik).
- Compliance-Gates: jedes RADIO_OPTION mit Required-Validierung das eine
  regulatorische Einwilligung kodiert (SCHUFA-Einwilligung, AGB,
  Datenschutz, Wahrheitsgemaesse-Bestaetigung, Risiko-Aufklaerung) muss
  einen negativen Testfall haben der versucht abzusenden ohne die
  Einwilligung gesetzt zu haben.
- Repeating-Rows: bei Fixtures mit Repeating-Rows (KFZ-Vollkasko
  Beteiligte, LV Beguenstigte, GwG Personen und Transaktionen) muss
  mindestens je ein Testfall fuer eine, zwei und drei Zeilen entstehen.
  Nur die erste Zeile darf Required-Validierungen tragen, sofern die
  Fixture so modelliert ist.

### Tier 3: adversarial

Fuenf Fixtures (Anlegerprofil-Wizard, GwG-Verdachtsmeldung,
Cyber-Risikoassessment, Mehrsprachig DE/EN, A11y-High-Contrast).
Pflichtabdeckung zusaetzlich zu Tier 2:

- Cross-Screen-Branching: bei Wizards mit konditionalem Inhalt
  (Anlegerprofil: Erfahrung Derivate Required only if Risikobereitschaft
  hoch) muss der Pfad sowohl Forward als auch Back getestet werden,
  inklusive Erhalt des Zustands. Ein Testfall der die Risikobereitschaft
  nach dem ersten Forward zurueck springt und aendert muss explizit
  beobachtbares Verhalten beschreiben (entweder: Aenderung wirksam und
  Folgemaske aktualisiert; oder: Aenderung erst nach Bestaetigung
  wirksam). Welcher der beiden Faelle gilt, muss aus der Quelle
  hervorgehen; sonst ist eine Offene Frage zu erzeugen.
- PII-sensitive Inhalte (GwG): generierte Testdaten muessen synthetisch
  oder maskiert sein. Beispiel-Namen sind als solche zu kennzeichnen,
  echte IBANs, echte Vertragsnummern oder echte Klarnamen sind verboten
  (Mutterrubrik Section 8). Sanctions-Match RESULT_DISPLAY darf nicht
  als Beweis fuer eine konkrete Disposition gewertet werden ("entbindet
  nicht von Verdachtsmeldung").
- High-density / Tooltip-driven (Cyber-Risikoassessment): Tooltip-Texte
  in INFORMATIVE_LABEL-Knoten sind cross-modal Pflicht. Ein Testfall der
  fragt ob plain Antivirus oder ein unbeobachteter SIEM die EDR/SOC-Frage
  positiv beantwortet, muss explizit den Tooltip-Text als Evidenz
  zitieren. Wenn der Generator den Tooltip ignoriert und EDR
  faelschlicherweise als Antivirus wertet, ist das eine Halluzination.
- Mehrsprachig: DE- und EN-Pfade muessen jeweils eigene Testfaelle
  erhalten. Validierungs-Strings sind nicht zu uebersetzen
  (Mutterrubrik Section 5: keine Regeln erfinden); "Pflichtfeld" und
  "Required" sind als verschiedene Sprachfassungen derselben Regel zu
  verstehen, nicht als verschiedene Regeln. Ein Testfall der zwischen
  den Locales wechselt muss den State-Erhalt explizit als Erwartung
  formulieren oder als Offene Frage markieren.
- A11y-High-Contrast: Testfaelle muessen mindestens je einen
  Tastatur-Pfad (Tab/Shift-Tab/Enter), eine Live-Region-Beobachtung
  (Monatliche Rate aktualisiert sich, Screen-Reader kuendigt das an),
  und einen Fehlerfokus-Pfad (Submit fehlgeschlagen, Fokus auf erstem
  Fehler) enthalten. Konkrete WCAG-Erfolgskriterien duerfen nicht
  hinzuerfunden werden, sofern die Fixture sie nicht explizit nennt.

## 3. Pflicht-Techniken nach ISO 29119 je Maskentyp

Diese Tabelle bindet die Tier-elastic `technique-coverage-minimum`-Quote
an konkrete Eingabemasken-Felder. Maximalwerte greifen nur bei
hochkardinalen Domaenen (mehr als 50 Felder).

| Technique                  | Tier 1 min | Tier 2 min | Tier 3 min | Anwendungs-Heuristik |
| --- | ---: | ---: | ---: | --- |
| equivalence_partitioning   | 1 | 3 | 5 | Pflicht je Numeric-Range, je Length-Constraint, je Select-Domain mit > 2 Optionen |
| boundary_value_analysis    | 1 | 2 | 4 | Pflicht je Numeric-Range, je Length-Constraint, je Date-Range |
| state_transition           | 0 | 1 | 2 | Pflicht je Multi-Screen-Flow, je Conditional-Section |
| decision_table             | 0 | 1 | 2 | Pflicht je Cross-field-Constraint, je Conditional-Requiredness |
| error_guessing             | 1 | 2 | 3 | Pflicht je Pflicht-Compliance-Gate, je File-Upload (Format/Groesse) |
| repeating_row              | 0 | 1 | 1 | Pflicht je Repeating-Group: 1, 2, 3 Zeilen |
| accessibility              | 0 | 0 | 1 | Pflicht ausschliesslich auf der A11y-Variante; auf andere Masken nur wenn Quelle a11y-Anforderungen explizit nennt |

Werte sind Minima auf Suite-Ebene je Fixture. Der Generator darf hoehere
Quoten produzieren; das System soll dann ueber `technique-quota-report.json`
ausweisen, wo das Minimum knapp verfehlt wurde.

## 4. Cross-Modal Faithfulness-Anker

Fuer jede Eingabemasken-Fixture sind die folgenden Anker im sense von
`faithfulness-calibration/anchors.json` zu hinterlegen, sobald
Reference-PNGs und Visual-Sidecar-Captures verfuegbar sind:

- ein `label_only`-Anker je Pflicht-Compliance-Gate, der prueft ob ein
  generischer Step "click submit" die Anwesenheit des Bestaetigungs-RADIO
  beobachtet. Erwarteter Verdict: `match` wenn der RADIO sichtbar im
  Capture, `mismatch` wenn der Step die Bestaetigung uebergeht.
- ein `concrete_data`-Anker je RESULT_DISPLAY der eine Berechnung
  modelliert. Erwarteter Verdict: `evidence_partial` (das System darf
  die konkrete Zahl nicht erfinden, muss aber das Vorhandensein der
  Komponente und ihre Abhaengigkeit beobachten).
- ein `mismatch`-Anker je Tooltip-INFORMATIVE_LABEL der eine Definition
  enthaelt, die der Generator typischerweise mit einem Synonym verwechselt
  (EDR mit Antivirus, SOC mit Security-Audit). Erwarteter Verdict:
  `mismatch` wenn der generierte Step das Synonym verwendet.

Diese Anker sind kein Bestandteil der `eingabemasken-fixtures.test.ts`
Suite; sie gehoeren in eine separate Calibration-Run, sobald die
visuelle Referenz fuer eine Fixture eingefroren wurde.

## 5. Harte Ablehnungskriterien zusaetzlich zur Mutterrubrik

Eine Eingabemasken-Suite ist abzulehnen, wenn eines der folgenden
Kriterien zutrifft (zusaetzlich zu den allgemeinen Kriterien in
Mutterrubrik Section 8):

- Eine konkrete IBAN abseits der dokumentations-IBAN
  `DE89370400440532013000` erscheint in einem Testfall.
- Eine elfstellige Steuer-ID, die nicht explizit als
  Beispieldaten-Marker getaggt ist, erscheint in einem Testfall.
- Ein Testfall verwendet einen produktiv-aussehenden Klarnamen
  (Vorname und Nachname) ohne synthetic-Marker.
- Ein Testfall fuer den Cyber-Risikoassessment-Fixture beantwortet die
  EDR-Frage positiv unter Zitat eines Antivirus-Produkts.
- Ein Testfall fuer den GwG-Fixture konstruiert eine Sanctions-Listen-Logik,
  die die Fixture nicht enthaelt (Listen-Schwellen, automatische
  FIU-Eskalations-Trigger, "ab Betrag X muss gemeldet werden").
- Ein Testfall fuer den Anlegerprofil-Wizard behauptet eine
  R-Klassifizierung mit konkreter Asset-Allocation-Quote.
- Ein A11y-Testfall behauptet ein konkretes WCAG-Erfolgskriterium das die
  Fixture nicht zitiert.
- Ein mehrsprachiger Testfall uebersetzt Validierungsregeln eigenmaechtig.

## 6. Pflege

Diese Rubrik wird angepasst, wenn:

- eine neue Eingabemasken-Fixture hinzukommt: dann ist der Bereich der
  Pflichtabdeckung zu erweitern und der entsprechende Tier zu kalibrieren;
- die `EU_BANKING_DEFAULT`-Policy-Profile geaendert werden: dann ist
  Section 3 anzupassen;
- die Mutterrubrik geaendert wird: dann sind Sections 1, 2, 5 zu
  pruefen;
- die Faithfulness-Tier-Klassifikation geaendert wird: dann ist Section
  4 anzupassen.

Aenderungen an dieser Rubrik werden in `CONTRACT_CHANGELOG.md` als
nicht-bricht-konformes Update eingetragen, wenn sie die Suite-Quotas
verschaerfen, und als brechendes Update, wenn sie die akzeptierten
Defaultwerte aendern.
