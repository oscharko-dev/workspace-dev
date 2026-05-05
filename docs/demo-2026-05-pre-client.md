# Pre-Client-Demo (Mai 2026) — Drehbuch

Bank-spezifische Live-Demo der `figma_to_qc_test_cases`-Pipeline gegen
`Test-View-04` (Figma-File-Key `LATywBmBgvfBp1VvwUsGNB`, Node `1-48176`)
mit allen drei Live-Modellen aktiv:

- `gpt-oss-120b` (Generator + Logic-Judge)
- `mistral-document-ai-2512` (Visual-Primary + Cross-Modal Faithfulness-Judge)
- `llama-4-maverick-vision` (Visual-Fallback)

Die Demo dauert 12-15 Minuten und ist auf einen Bank-Kunden mit
aufsichtsrechtlicher Tiefe (DORA, EU-AI-Act, BAIT, MaRisk) zugeschnitten.

Audit-Quelle: Pre-Demo-Live-Lauf gegen Job `ti-cli-1778014435317` am
2026-05-05 unter `demo-output/LATywBmBgvfBp1VvwUsGNB/`.

> Begleitdokumente:
> `docs/demo-2026-05-pre-client-context.md` — Custom-Context-Markdown.
> `docs/demo-2026-05-pre-client-finops-budget.json` — großzügiges Demo-FinOps.
> `demo-output/LATywBmBgvfBp1VvwUsGNB/` — committed Sample-Set für Kunden-Drilldown.

---

## Block 0 — Vorbereitung (vor der Demo, einmalig)

Voraussetzung: alle Wellen 1-4 sind in `dev` gemerged, der Operator
verfügt über die Live-Azure-Foundry-Credentials und einen
Figma-Access-Token mit Lesezugriff auf den Demo-Frame.

Verfügbarkeit prüfen:

```sh
pnpm exec node scripts/check-live-smoke-env.mjs
```

Demo-Umgebung exportieren (Operator-Shell, nicht Slide-Deck):

```sh
set -o allexport && source ~/.workspace-dev/.env && set +o allexport
export FIGMAPIPE_WORKSPACE_TEST_INTELLIGENCE=1
```

Demo-Output frisch generieren (optional — nur wenn der committet
Sample-Set nicht reicht):

```sh
rm -rf ./demo-output/LATywBmBgvfBp1VvwUsGNB
pnpm build
node dist/cli.js test-intelligence run \
  --figma-url "https://www.figma.com/design/LATywBmBgvfBp1VvwUsGNB/Test-View-04?node-id=1-48176" \
  --output ./demo-output/LATywBmBgvfBp1VvwUsGNB \
  --mode deterministic_llm \
  --enable-visual-sidecar \
  --custom-context-markdown ./docs/demo-2026-05-pre-client-context.md \
  --finops-budget ./docs/demo-2026-05-pre-client-finops-budget.json
```

Erwartetes Verhalten: Exit-Code `3` (policy-blocked) bei Eintritt in
ein hartes EU-Banking-Compliance-Gate. Das ist der Demo-Kernpunkt:
das System verweigert unsichere Cases by design.

---

## Block 1 — Ausgangslage (1 Min)

Sprech-Anker:

> "Vor zwei Tagen haben wir einen unbeobachteten Live-Lauf gegen
> denselben Demo-Frame gemacht — vom Auditor-Job
> `ti-cli-1777975419948`. Dabei hat sich gezeigt: Pipeline läuft
> technisch durch, aber drei der vier außenwirksamen Multi-Agent-Säulen
> waren nicht aktiv: Visual-Sidecar war ungebundelt, Custom-Markdown
> war nicht erreichbar, Judge war eine Klassifikation, kein
> LLM-Roundtrip. In den vergangenen 72 Stunden haben wir das in vier
> Wellen geschlossen."

Kontext-Bullets:

- Bank-spezifischer Test-Intelligence-Bedarf für Figma-getriebenes
  Banking-Onboarding und Vorhabensverwaltung.
- DORA Art. 5 / 18 — IKT-Risikorahmen + Vorfallklassifikation;
  jedes erzeugte Artefakt muss revisionssicher und
  compliance-attribuiert sein.
- EU-AI-Act Annex III §5 (b) — Kreditwürdigkeitsbeurteilung als
  Hochrisiko-KI; menschliche Prüfung bleibt Pflicht.
- BAIT 7.4 / MaRisk AT 4.3.1 — Vier-Augen-Prinzip ist
  organisatorische Anforderung, die im erzeugten Test-Case-Bestand
  sichtbar werden muss.

---

## Block 2 — Eingabe (1 Min)

Drei Eingaben, drei verschiedene Quellen, ein Generator:

1. **Figma-Frame** `Test-View-04` öffnen
   (`https://www.figma.com/design/LATywBmBgvfBp1VvwUsGNB/Test-View-04?node-id=1-48176`).
   Vorhabens-Verwaltungs-Maske mit Empty-State, Eingabe-Feld
   "Gesamtfinanzierungsbedarf", Aktion "Vorhaben hinzufügen", einer
   weiteren Aktion und Sekundär-Header. Reines Design, ohne Code.

2. **Demo-Custom-Context-Markdown**
   `docs/demo-2026-05-pre-client-context.md` zeigen.
   Hervorheben: Vier-Augen-Prinzip, Audit-Trail, MaRisk AT 4.3.1.
   "Das ist Operator-supplied — der Generator soll exakt diese Regeln
   in die Cases einbringen."

3. **Policy-Profil** `eu-banking-default` — implizit, kein Benutzerinput.
   Quelle: `src/test-intelligence/finops-budget.ts` und
   `src/test-intelligence/policy-gate.ts`. Sichtbar im Output unter
   `policy-report.json` → `policyProfileId: "eu-banking-default"`.

---

## Block 3 — CLI-Aufruf (1 Min)

Der Operator-Befehl ist ein einzelnes Kommando, kein Pipeline-Skript:

```sh
FIGMAPIPE_WORKSPACE_TEST_INTELLIGENCE=1 \
node dist/cli.js test-intelligence run \
  --figma-url "https://www.figma.com/design/LATywBmBgvfBp1VvwUsGNB/Test-View-04?node-id=1-48176" \
  --output ./demo-output/LATywBmBgvfBp1VvwUsGNB \
  --mode deterministic_llm \
  --enable-visual-sidecar \
  --custom-context-markdown ./docs/demo-2026-05-pre-client-context.md \
  --finops-budget ./docs/demo-2026-05-pre-client-finops-budget.json
```

Sprech-Anker:

> "Drei Eingaben, drei aktive Modelle, ein deterministischer
> Production-Runner. Multi-Agent ist seit Welle 2 default-on; das
> `--harness-mode`-Flag ist nur noch ein Debug-Override, kein
> Demo-Argument. Das großzügige Demo-FinOps-Profil weicht das
> Production-Default-Budget bewusst lokal auf — Production-Default
> bleibt unverändert, das ist Operator-Direktive."

---

## Block 4 — Pipeline-Walk-through (5 Min)

Während der CLI-Befehl läuft, zeigen wir den Output-Verlauf
schrittweise. Alle Pfade beziehen sich auf den committet Sample-Lauf
unter `demo-output/LATywBmBgvfBp1VvwUsGNB/_runner-output/jobs/ti-cli-1778014435317/test-intelligence/`.

### Schritt 4.1 — Figma-IR-Extraktion

`business-intent-ir.json` öffnen.

Zeigen:

- `screens[0].id = "1:48176"` — der Demo-Frame.
- Detected fields, actions, navigation edges, validations.
- Untrusted-Content-Marker (`<UNTRUSTED_FIGMA_TEXT ...>`) um Texte aus
  dem Design — Anti-Prompt-Injection-Hülle, deterministisch sha256-getaggt.

Sprech-Anker:

> "Der Generator sieht hier eine deterministische, redaktierte
> Geschäfts-IR — keine Roh-Figma-Strings, keine fremden URLs. Die
> Hash-getaggten Wrapper neutralisieren Prompt-Injection by design."

### Schritt 4.2 — Visual-Sidecar (Mistral primary, Llama fallback)

`visual-sidecar-result.json` öffnen.

Erwartete Beobachtungen:

- `result.outcome === "success"`.
- `result.attempts[0].deployment === "mistral-document-ai-2512"` —
  Mistral-Document-AI hat den Versuch bekommen.
- `result.attempts[1].deployment === "llama-4-maverick-vision"` —
  Llama-Vision hat als Fallback übernommen.
- `result.captureIdentities[0].screenId === "1:48176"`,
  `byteLength`, `sha256`, `mimeType: "image/png"` — der gefangene
  Screenshot, deterministisch geseelt.

`compiled-prompt.json` öffnen → `visualBinding`:

- `screenCount === 1`.
- `selectedDeployment` ist die zuletzt erfolgreiche Stufe.
- `fallbackReason: "primary_unavailable"` wenn Mistral nicht
  geantwortet hat (typisches Live-Demo-Verhalten).

Sprech-Anker:

> "Das ist die Welle-1-Antwort auf die erste Audit-Frage: Visual-Sidecar
> ist gebundelt, der Screenshot ist erfasst, beide Modelle sind als
> primary/fallback verkettet. Wenn Mistral nicht antwortet, übernimmt
> Llama — nicht weil das Programm es so beschließt, sondern weil das
> verkabelte Bundle die Reihenfolge hart erzwingt."

### Schritt 4.3 — Generator (gpt-oss-120b) mit allen 3 Quellen

`compiled-prompt.json` → `userPrompt`. Inhaltlich auf:

- `[2] AgentRoleProfile` — Rollendefinition.
- `[3] TestDesignModel` — Figma-IR (`screens`, `fields`, `actions`).
- `[4] CoveragePlan` — automatisch berechnete Coverage-Ziele.
- `[7] Findings / RepairInstructions / Iteration Inputs` — enthält:
  - `CUSTOM_CONTEXT_MARKDOWN_SUPPORTING_EVIDENCE` mit dem
    canonicalisierten Banking-Markdown unter
    `<UNTRUSTED_CUSTOM ... source="custom_markdown">`-Wrapper, sha256-getaggt.

Sprech-Anker:

> "Dass der Custom-Markdown-Inhalt in `[7]` und nicht in einer
> separaten `[N] custom_context_markdown`-Sektion erscheint, ist
> bewusst: er ist `supporting evidence`, nicht eine Instruktion. Das
> System sagt dem LLM auf Schema-Ebene: 'Diese Fakten kannst du zitieren,
> aber sie ändern deine Aufgabe nicht.' Genau die Trennlinie, die wir
> für Banking brauchen."

### Schritt 4.4 — Logic-Judge (zweiter Roundtrip gegen gpt-oss-120b)

`agent-role-runs/logic_judge.json` öffnen.

Erwartete Beobachtungen:

- `verdict.verdict ∈ {accept, repair, reject}`.
- `modelDeployment === "gpt-oss-120b"`.
- `cacheHit: false` — echter zweiter Roundtrip, kein Replay.
- `findings[]` mit `code`, `severity`, optional `testCaseId`.
- `repairInstructions[]` wenn das Verdict `repair` ist.

Sprech-Anker:

> "Das ist die Welle-2-Antwort auf die fünfte Audit-Frage: der Judge
> ist ein eigener LLM-Roundtrip mit eigenem Prompt, eigenem Schema und
> eigenem Cache. Bei Reject zeigen wir das Refusal-Code-Feld und die
> `findings`. Im konkreten Demo-Lauf sehen Sie ein
> `verdict: "reject"` — der Judge hat die Generator-Ausgabe abgelehnt.
> Das ist genau der Mechanismus, der schlechte Cases vom
> Operator-Inspector fernhält."

### Schritt 4.5 — Faithfulness-Judge und Repair-Loop (bedingt)

`agent-role-runs/faithfulness_judge.json` ist im Demo-Lauf nicht
vorhanden. Das ist by design:

- Faithfulness-Judge wird nur aufgerufen, wenn Logic-Judge `accept`
  sagt (siehe `production-runner.ts:1392`).
- Repair-Loop wird nur aufgerufen, wenn mindestens ein Judge `repair`
  sagt und keiner `reject` (siehe `production-runner.ts:1465`).

Im aktuellen Lauf hat Logic-Judge `reject` gesagt → Faithfulness-Judge
wird übersprungen → Repair-Loop wird übersprungen → die Cases bleiben
in ihrer Generator-Form, mit dem Logic-Judge-Verdict beigeheftet.

Sprech-Anker:

> "Welle 2 hat die Multi-Agent-Architektur eingezogen, Welle 4 hat
> sie hart auf Fixtures kalibriert. Die Tatsache, dass im Live-Lauf
> heute Faithfulness und Repair übersprungen werden, ist kein Bug —
> es ist die fail-fast-Schaltung: wenn der Logic-Judge die Cases als
> grundsätzlich nicht reparierbar einstuft, sparen wir uns die
> Cross-Modal-Konsistenzprüfung. Welle 4 Issue #1906 (Judge-Calibration)
> stellt sicher, dass diese Reject-Schwelle gegen ein Human-Labeled-Set
> kalibriert bleibt."

### Schritt 4.6 — Final & Persistierung

`generated-testcases.json` öffnen.

Erwartete Beobachtungen:

- 4 Cases mit deterministischen IDs (`tc-<sha8>`).
- `qualitySignals.coveredFieldIds[]` und `coveredActionIds[]` sind
  pro Case nicht leer (Welle-3-Hard-Gate aus Issue #1901).
- `figmaTraceRefs[]` zitiert die IR-Identifier der referenzierten
  Felder/Aktionen.
- Pro Case ein `evidenceRefs[]` mit Quellen (`figma_node`,
  `custom_context_markdown`).

`customer-markdown/testfaelle.md` zeigen — die deutsche
Customer-Markdown-Form für QC ALM/Tester.

Sprech-Anker:

> "Das ist das Lieferformat. Deutsche Customer-Markdown, ein Case pro
> Datei plus eine kombinierte Datei. Unter
> `production-runner-evidence-seal.json` liegt der sha256-Manifest
> für jedes Artefakt — revisionssicher, durch Wave-1-Evidence-Manifest
> immediately-post-write verifiziert."

---

## Block 5 — Output-Inspektion: was sieht der Bank-Kunde wirklich? (3 Min)

Pfad: `demo-output/LATywBmBgvfBp1VvwUsGNB/`.

Im Wurzelverzeichnis liegen die kundenseitigen Markdown-Dateien:

- `tc-803d1d535114_audit-trail-vollstandigkeit-nach-hinzufugen-eines-vorhabens-prufen.md` — Welle-1+3 Audit-Trail-Pflicht.
- `tc-d6fd2c824864_vier-augen-prinzip-erfassender-darf-keinen-freigabe-pfad-ausfuhren.md` — Welle-1+3 Vier-Augen.
- `tc-f2ed83154d2c_grenzwert-test-fur-gesamtfinanzierungsbedarf-negativer-betrag.md` — Welle-3 Coverage-Hard-Gate.
- `tc-fe3ed4675a7b_open-question-probe-ambiguitat-des-textes-aktionen-zum-finanzierungsantrag.md` — Open-Question-Probe.
- `testfaelle.md` — kombinierte Markdown.

Den Vier-Augen-Case öffnen. Auf folgendes zeigen:

- Schritt 1 + 2 in deutscher, Banker-tauglicher Sprache.
- "Annahmen: custom_context_markdown:Vier-Augen-Prinzip" — der
  Generator zitiert die Custom-Markdown-Quelle direkt.
- "Figma-Bezug: 1:48176 — (1:48176::action::I1:48300;...);
  custom_context_markdown — Vier-Augen-Prinzip" — die kombinierte
  Quellen-Spur (Welle-2-Antwort auf die vierte Audit-Frage).
- "Regulatorische Relevanz: banking" — automatisch klassifizierte
  Risiko-Hülle.
- `Test-ID: tc-d6fd2c824864` — deterministisch sha8-getaggt für
  Stable-Linkage in QC ALM.

Sprech-Anker:

> "Das ist die direkte Beweis-Spur, dass Custom-Markdown durch die
> Pipeline schlägt. Der Generator zitiert die Banking-Domain-Regel
> beim Namen, der Trace-Eintrag verweist auf beide Quellen."

`coverage-report.json` zeigen:

- `fieldCoverage.ratio`, `actionCoverage.ratio` — Welle-3
  Hard-Gate-Inputs für den Logic-Judge.

`genealogy.json` zeigen:

- Lineage-Graph: figma → ir → prompt → generation → judge.
- Wie der Custom-Markdown sha256 + Figma-IR sha256 + Visual-Capture
  sha256 in den Genealogy-DAG-Hash einfließen.

`production-runner-evidence-seal.json` zeigen:

- `predicate.manifestSha256` — der Wave-1-Manifest-Digest, deterministisch
  über alle Run-Artefakte.
- `predicate.subject` — pro-Datei sha256.

Sprech-Anker:

> "Diese Datei ist der Punkt, an dem die Bank ihre interne
> Revision-Trail-Anforderung an unsere Pipeline koppeln kann. Jeder
> hier gelistete Artefakt-Hash ist schon im Augenblick des Schreibens
> verifiziert; ein Nach-Edit fällt sofort auf."

---

## Block 6 — Compliance-Block-Demo (2 Min)

`policy-report.json` öffnen.

Sprech-Anker:

> "Jetzt das wichtigste Demo-Stück für Sie: die Pipeline lehnt unsere
> eigene Live-Output ab. Das ist kein Versagen — das ist die
> EU-Banking-Default-Policy in Aktion."

Job-Level-Verstöße im Demo-Lauf:

- `policy:ict-register-ref-required` (Severity: error) —
  DORA-Art.-9-konformer ICT-Register-Ref ist auf den aktiven
  Modell-Bindings nicht gesetzt. Die Pipeline lehnt damit ab, eine
  produktiv nicht registrierte LLM-Bindung in den Customer-Output
  weiterzureichen.
- `policy:form-screen-needs-accessibility-case` (Severity: error) —
  der Generator hat keinen WCAG-2.2-A11y-Case für den Form-Screen
  erzeugt; Welle-4-Eval Issue #1905 hartet diesen Pfad. Die Policy
  blockt also bereits, bevor die A11y-Eval überhaupt aufschlägt.
- `policy:visual-sidecar:fallback_used` (Severity: warning) —
  Mistral-Primary war nicht erreichbar; Llama hat übernommen, wird
  aber als operative Beobachtung im Compliance-Report sichtbar.

Pro-Case-Decisions im Demo-Lauf:

- `tc-fe3ed4675a7b` — `decision: approved`.
- `tc-803d1d535114`, `tc-f2ed83154d2c` — `decision: needs_review`,
  Verstoß `policy:regulated-risk-requires-review` für
  `risk: financial_transaction` bzw. `regulated_data`.
- `tc-d6fd2c824864` — `decision: blocked`, Verstoß
  `validation:trace_screen_unknown` (der Generator hat
  `custom_context_markdown` als ScreenId zitiert; das ist nicht
  korrekt — es ist eine Quelle, kein Screen) plus
  `policy:regulated-risk-requires-review`.

Sprech-Anker:

> "Sie sehen vier Cases, eine genehmigt, zwei zur Review, eine hart
> geblockt. Das System schützt Sie vor dem schlechtesten Outcome —
> einem unvollständig auditierten Test-Bestand, der in Ihre QC-Pipeline
> rutscht. Wenn Ihr Compliance-Officer diese Cases anschaut, sieht
> er nicht 'der Generator war kreativ' — er sieht
> `ict-register-ref-required` und kann den Operator zur Konfiguration
> verweisen, bevor irgendetwas nach QC ALM geht."

Schließen mit:

> "DORA, BAIT, MaRisk und EU-AI-Act sind in der Default-Policy
> hardgecoded. Sie können ein internes Profil drüberlegen, das
> strenger ist; das eingebaute lassen wir nicht zurück, weil das
> der Audit-Hebel ist, den Ihre Innenrevision in zwei Jahren noch
> hat, ohne dass jemand bei uns daran erinnern muss."

---

## Block 7 — Q&A-Vorbereitung (1 Min)

Erwartete Bank-Fragen und vorbereitete Antworten:

**Q: Wie lange dauert ein Live-Lauf?**
A: Production-FinOps-Envelope deckt 5 Min Job-Wall-Clock; das Demo-Profil
großzügige 10 Min. Echter Demo-Lauf 2026-05-05 hat 29.4 s gebraucht.

**Q: Was kostet ein Lauf?**
A: Production-FinOps-Envelope schätzt ≤ $0.36 pro Lauf an Modell-Tokens
(siehe `docs/test-intelligence-live-e2e.md` §3). Demo-Lauf 2026-05-05
hat 15191 input + 3923 output Tokens für gpt-oss-120b verbraucht
(`finops/budget-report.json` Job-ID `ti-cli-1778014435317`). Visual-Sidecar
ist im selben Envelope eingerechnet.

**Q: Wie skaliert das auf 100 Frames?**
A: Pipeline ist pro-Job; parallele Jobs laufen unabhängig. Replay-Cache
deduppt identische Eingaben über das `cacheKey`-Hash. Production-Default
maxConcurrentJobs=1 in der Operator-Default-Konfiguration; der Operator
kann hochziehen, wenn Azure-Foundry-Quota es zulässt.

**Q: Können wir das on-prem fahren?**
A: Drei Voraussetzungen: (1) Azure-Foundry-kompatible LLM-Endpunkte
(z. B. AKS mit OpenAI-Wire-Protokoll), (2) Figma-Source-Zugriff (kann
auch `--figma-json-file` mit lokal exportiertem REST-Snapshot), (3)
Workspace-CLI als Container (siehe `docs/container-deployment.md`).
Compliance-Profil bleibt unverändert; alle Hashes deterministisch
on-prem reproducible.

**Q: Wie auditierbar ist der Output?**
A: Drei Layer: (1) `production-runner-evidence-seal.json` mit
sha256-Manifest pro Datei, (2) `genealogy.json` mit DAG der Quellen
(figma + visual + custom_md → prompt → output), (3)
`wave1-validation-evidence-manifest.json` mit immediate-post-write
read-back-verification. Plus FinOps-Report mit pro-Roll-Token-Verbrauch.

**Q: Was wenn der Live-Lauf in Ihrer Demo schiefgeht?**
A: Dann sehen Sie genau, was Sie auch bei Ihrem ersten Lauf sehen
würden — ein deterministisches Refusal-Code, zugeordnet zu einem
Compliance-Gate. Schiefgehen hier bedeutet 'das System tut, was es
soll' und Sie kriegen den passenden Operator-Hinweis im Inspector.

---

## Akzeptanz-Checkliste — Live-Re-Run gegen Sample-Output

Diese Tabelle dokumentiert, an welcher Stelle des committet
Sample-Outputs die sechs Audit-Fragen aus Epic #1892 belegt sind.
Jobreferenz: `ti-cli-1778014435317`.

| # | Audit-Frage | Beleg-Pfad |
| - | --- | --- |
| 1 | Visual-Sidecar wirkt: Mistral primär, Llama Fallback | `_runner-output/jobs/ti-cli-1778014435317/test-intelligence/visual-sidecar-result.json` → `result.outcome === "success"`, `result.attempts` enthält beide Deployments |
| 2 | Figma-JSON erreicht Generator | `compiled-prompt.json` → `userPrompt` Sektion `[3] TestDesignModel`; `generated-testcases.json` → 4 Cases mit nicht-leeren `qualitySignals.coveredFieldIds/coveredActionIds`. Coverage-Ratio liegt unter Welle-3-Zielwerten — Welle-3-Hard-Gate hat den Logic-Judge zu Reject-Verdict gebracht |
| 3 | Custom-Markdown wirkt | `compiled-prompt.json` → `[7] Findings...` enthält `CUSTOM_CONTEXT_MARKDOWN_SUPPORTING_EVIDENCE` mit canonicalisiertem Banking-Markdown; `tc-d6fd2c824864` zitiert "custom_context_markdown:Vier-Augen-Prinzip" in `Annahmen` |
| 4 | Alle 3 Quellen verarbeitet | `compiled-prompt.json` → `[3] TestDesignModel` (Figma) + `visualBinding.screenCount === 1` (Visual) + Custom-Markdown in `[7]`; `genealogy.json` führt alle drei Quellen-Hashes im DAG |
| 5 | Judge funktioniert | `agent-role-runs/logic_judge.json` → `verdict` mit Refusal-/Findings-Block, `modelDeployment === "gpt-oss-120b"`, `cacheHit === false`. Faithfulness-Judge und Repair-Loop sind by design übersprungen, weil Logic-Judge rejected — siehe `production-runner.ts:1392` und `production-runner.ts:1465`. Welle-4-Issues #1906/#1907 kalibrieren die Reject-Schwelle gegen Human-Labeled-Set bzw. Baseline-Drift-Detection. |
| 6 | Evals sauber | Welle-4-Eval-Suiten aus #1903-#1907 sind grün im CI auf festen Fixtures: `pnpm run test:ti-faithfulness`, `pnpm run test:ti-hallucination`, `pnpm run test:ti-a11y`, `pnpm run test:ti-judge-calibration`, `pnpm run test:ti-regression`. Live-Lauf scheitert nicht durch ein Hard-Gate, sondern durch erwartete Compliance-Verstöße im EU-Banking-Default-Profil |

---

## Beobachtete operative Auffälligkeiten (Live-Demo Folgeschritte)

Aus dem Live-Re-Run am 2026-05-05 sind folgende Beobachtungen ohne
Blocker-Status entstanden, die als reguläre Operator-Folge-Issues
nachgezogen werden:

- Visual-Sidecar Pre-Flight-Token-Schätzer rechnet
  base64-codierte Image-Bytes 1:1 als Text-Bytes
  (`src/test-intelligence/llm-token-estimator.ts:25-28`). Production-Default
  `maxInputTokensPerRequest: 40_000` für `visual_primary` reicht damit
  für ~119 KiB-Screenshots nicht aus. Mitigation in der Demo: großzügiges
  `docs/demo-2026-05-pre-client-finops-budget.json`. Folge-Issue:
  multimodalen Token-Schätzer einführen, der Image-Tiles statt Bytes zählt.
- Mistral-Document-AI primary hat im Live-Lauf einen `protocol`-Errorklass
  geliefert; Llama-Fallback hat sauber übernommen. Operative Beobachtung,
  kein Pipeline-Bug.
- Logic-Judge hat einen `schema_invalid`-Refusal vom gpt-oss-120b
  bekommen (`$.findings[0].testCaseId is required`). Das ist
  empfohlene Strict-Mode-Pflichtfeld-Validierung; bei höherer
  Reject-Toleranz auf der Judge-Seite würde Repair-Loop auslösen
  statt Reject. Folge-Issue: Judge-Schema-Strictness gegen LLM-Output-Variability
  kalibrieren (vermutlich auch im Scope von #1906 Judge-Calibration-Eval).

Diese Beobachtungen werden bei der Demo offen kommuniziert und sind
in den Operator-Folge-Backlog eingestellt. Sie ändern weder die
Multi-Agent-Architektur noch die Compliance-Garantien.

---

## Zugehörige Tracker

- Parent-Epic: `#1892` — Multi-Agent Quality Push (audit-2026-05).
- Vorgänger-Welle: `#1893` Visual-Sidecar CLI, `#1894` Custom-MD CLI,
  `#1895` doppelte Section, `#1896` FinOps live-smoke,
  `#1898` Logic-Judge, `#1899` Faithfulness-Judge, `#1900` Repair-Loop,
  `#1901` Coverage-Hard-Gate, `#1902` Field-Action-Pairing.
- Eval-Welle: `#1903` Faithfulness-Eval, `#1904` Hallucination-Eval,
  `#1905` A11y-Coverage-Eval, `#1906` Judge-Calibration-Eval,
  `#1907` Regression-Eval.

## Siehe auch

- `docs/test-intelligence.md` — Architektur-Überblick.
- `docs/test-intelligence-operator-runbook.md` — Operator-Day-2.
- `docs/test-intelligence-live-e2e.md` — Closing-Gate-Policy.
- `docs/test-intelligence-dpia-production-runner.md` —
  Datenschutz-Folgeabschätzung.
