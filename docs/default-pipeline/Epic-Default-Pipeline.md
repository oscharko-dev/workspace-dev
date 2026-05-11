# Epic: WorkspaceDev Pluggable Pipeline Platform & OSS Default React/TypeScript/Tailwind Code Generation

**Datei:** `Epic-Default-Pipeline.md`  
**Projekt:** OSS-NPM-Paket `workspace-dev` / WorkspaceDev  
**Ziel:** State-of-the-Art Epic für eine neue `default`-Pipeline und die Umbenennung der bestehenden kundenspezifischen Pipeline in `rocket`  
**Stand der Online-Prüfung:** 2026-04-27  
**Primärer Branch der Prüfung:** `dev`

---

## 1. Executive Summary

WorkspaceDev soll von einer heute im Kern fest verdrahteten, deterministischen Figma-to-Code-Pipeline zu einer **pluggable Pipeline Platform** ausgebaut werden. Die neue Pipeline mit dem Namen **`default`** wird als OSS-Showcase-Pipeline eingeführt und generiert aus einem vollständigen Figma Board, einer einzelnen View, einer einzelnen Komponente oder einer ausgewählten Teilmenge hochwertigen Anwendungscode auf Basis von:

- React
- TypeScript
- Tailwind CSS
- Vite als schlankem OSS-Build- und Preview-Stack

Die aktuell vorhandene kundenspezifische Pipeline wird unter dem Namen **`rocket`** weitergeführt. Sie bleibt funktional stabil, wird aber architektonisch, paketierungsseitig und testseitig vollständig von der neuen `default`-Pipeline isoliert.

Das Epic ist bewusst mehr als eine reine Generator-Erweiterung. Es beschreibt eine produktfähige Architektur, mit der WorkspaceDev künftig mehrere Pipelines ausliefern kann:

- nur `default`
- nur `rocket`
- `default` und `rocket` gemeinsam
- zukünftig weitere spezialisierte Pipelines

Wenn mehr als eine Pipeline im ausgelieferten Paket verfügbar ist, wählt der User die gewünschte Pipeline über ein UI-Dropdown. Wenn nur eine Pipeline verfügbar ist, arbeitet WorkspaceDev ohne unnötige UI-Komplexität automatisch mit dieser Pipeline.

Die neue `default`-Pipeline demonstriert die Fähigkeiten von WorkspaceDev eindrucksvoll, ohne proprietäre oder kundenspezifische Bibliotheken offenzulegen. Sie bleibt — wie die heutige Pipeline — deterministisch, lokal ausführbar, auditierbar, release-gate-fähig und enterprise-tauglich.

---

## 2. Grounding aus der Repository- und Web-Prüfung

Die folgenden Punkte wurden aus den öffentlich zugänglichen Projektartefakten und offiziellen Framework-Dokumentationen abgeleitet. Sie sind die technische Grundlage für dieses Epic.

### 2.1 Aktueller WorkspaceDev-Stand

WorkspaceDev ist laut README ein **autonomous local Workspace runtime** für deterministische Figma-to-Code-Generierung über REST, lokale JSON-Dateien oder Inline-Paste/Plugin-Payloads. Das Paket läuft direkt als Dev-Dependency im Kundenprojekt und benötigt nicht den vollständigen Workspace-Backend-Stack.  
Quelle: [WorkspaceDev README](https://github.com/oscharko-dev/workspace-dev/blob/dev/README.md)

Das Repository beschreibt als aktive Branch-Struktur: `dev` für Feature-Entwicklung, `dev-gate` als geschützte Quality-Gate-Branch und `main` als Release-Branch.  
Quelle: [WorkspaceDev README](https://github.com/oscharko-dev/workspace-dev/blob/dev/README.md)

Die aktuelle Pipeline ist laut `PIPELINE.md` eine deterministische lokale Figma-to-Code-Pipeline mit sieben Stages:

1. `figma.source`
2. `ir.derive`
3. `template.prepare`
4. `codegen.generate`
5. `validate.project`
6. `repro.export`
7. optional `git.pr`

Quelle: [PIPELINE.md](https://github.com/oscharko-dev/workspace-dev/blob/dev/PIPELINE.md)

`template.prepare` startet aktuell immer aus dem gebündelten Template `template/react-mui-app`, das im Pipeline-Dokument als React 19 + MUI v7 + Vite 8 Seed beschrieben wird.  
Quelle: [PIPELINE.md](https://github.com/oscharko-dev/workspace-dev/blob/dev/PIPELINE.md)

Das aktuelle Template `template/react-mui-app/package.json` enthält unter anderem MUI- und Emotion-Abhängigkeiten wie `@mui/material`, `@mui/icons-material`, `@mui/x-date-pickers`, `@emotion/react` und `@emotion/styled`. Für die neue OSS-Default-Pipeline ist daher ein separates `react-tailwind-app`-Template erforderlich, statt das vorhandene Template umzubauen.  
Quelle: [template/react-mui-app/package.json](https://github.com/oscharko-dev/workspace-dev/blob/dev/template/react-mui-app/package.json)

Der aktuelle öffentliche Contract erlaubt mehrere Figma-Source-Modes: `rest`, `hybrid`, `local_json`, `figma_paste` und `figma_plugin`. Der Codegen-Modus ist aktuell ausschließlich `deterministic`.  
Quelle: [src/contracts/index.ts](https://github.com/oscharko-dev/workspace-dev/blob/dev/src/contracts/index.ts)

Der Inspector-Import unterstützt Plugin-Envelope, Raw JSON Paste/Drop/Upload und Direct Plugin Handoff. Besonders wichtig für die neue Anforderung: Die Dokumentation beschreibt Multi-Select Scope und `Generate Selected`, inklusive der Möglichkeit, nur den aktuell ausgewählten Node, Node plus Children, alle Screens oder geänderte Nodes neu zu generieren.  
Quelle: [docs/figma-import.md](https://github.com/oscharko-dev/workspace-dev/blob/dev/docs/figma-import.md)

Die WorkspaceDev-UI selbst ist laut README bereits als **Vite + React + TypeScript + Tailwind** App umgesetzt. Das ist ein starker interner Architekturbeleg dafür, dass ein React/Tailwind-Template technologisch sehr gut zum Projekt passt.  
Quelle: [WorkspaceDev README](https://github.com/oscharko-dev/workspace-dev/blob/dev/README.md)

Das Projekt verfügt bereits über hochwertige Gates und Testoberflächen: Golden-Fixture-Tests, UI-E2E-Tests, DAST-Smoke, Load-Smoke, Property-Based Tests, Coverage-Gates, SBOM, License-Checks, Reproducible Build, Airgap-Install und Pack-Verification sind in README, `PIPELINE.md` und `package.json` verankert.  
Quellen: [WorkspaceDev README](https://github.com/oscharko-dev/workspace-dev/blob/dev/README.md), [PIPELINE.md](https://github.com/oscharko-dev/workspace-dev/blob/dev/PIPELINE.md), [package.json](https://github.com/oscharko-dev/workspace-dev/blob/dev/package.json)

WorkspaceDev verfolgt laut `ZERO_TELEMETRY.md` eine Zero-Telemetry-Policy: Das Paket sendet keine Runtime Analytics, Usage Metrics oder Behavioral Telemetry an externe Services.  
Quelle: [ZERO_TELEMETRY.md](https://github.com/oscharko-dev/workspace-dev/blob/dev/ZERO_TELEMETRY.md)

Das Compliance Manifest verweist auf Enterprise-OSS-Evidence für Banken und Versicherungen, inklusive DORA-, GDPR- und EU-AI-Act-bezogener Evidence-Strukturen für die opt-in Test-Intelligence-Oberfläche. Diese Qualitätshaltung sollte für das neue Pipeline-Epic übernommen werden.  
Quelle: [COMPLIANCE.md](https://github.com/oscharko-dev/workspace-dev/blob/dev/COMPLIANCE.md)

### 2.2 Framework-Grounding

Reacts offizielle Dokumentation beschreibt TypeScript als verbreiteten Weg, Typdefinitionen in JavaScript-Codebases zu ergänzen; JSX-Dateien mit TypeScript nutzen `.tsx`, und Props können über `type` oder `interface` typisiert werden.  
Quelle: [React — Using TypeScript](https://react.dev/learn/typescript)

Tailwind CSS beschreibt die Vite-Integration über `tailwindcss` und `@tailwindcss/vite`; Tailwind scannt HTML, JavaScript Components und Templates nach Klassen, generiert passende Styles und schreibt sie in eine statische CSS-Datei. Die Dokumentation bezeichnet Tailwind als schnell, flexibel, zuverlässig und zero-runtime.  
Quelle: [Tailwind CSS — Installing with Vite](https://tailwindcss.com/docs/installation/using-vite)

Vite unterstützt laut offizieller Dokumentation unter anderem `react-ts` Templates. Außerdem ist `index.html` in Vite bewusst Teil des Projekt-Roots und Entry Point der Anwendung; die Standard-Scripts sind `vite`, `vite build` und `vite preview`.  
Quelle: [Vite Guide](https://vite.dev/guide/)

### 2.3 Schlussfolgerung aus dem Grounding

Die neue Anforderung sollte nicht als weiterer `if pipeline === ...`-Block in `codegen.generate` umgesetzt werden. Der aktuelle Stand zeigt eine starke Pipeline- und Quality-Gate-Basis, aber auch eine klare Kopplung an das aktuelle MUI-Template und kundenspezifische Erweiterungspunkte. Die richtige Lösung ist daher:

- eine **Pipeline Registry**
- pipeline-spezifische Stage Services oder Stage Service Delegates
- pipeline-spezifische Templates
- pipeline-spezifische Validation Policies
- pipeline-spezifische Golden Fixtures
- pipeline-spezifische Packaging Profiles
- UI- und API-seitige Pipeline-Auswahl
- strikte Import-, Pack- und Dependency-Boundaries

---

## 3. Epic Name

**WorkspaceDev Pluggable Pipelines & OSS Default React/TypeScript/Tailwind Code Generation**

---

## 4. Epic Goal

WorkspaceDev wird zu einer erweiterbaren Pipeline-Plattform ausgebaut. Eine neue **`default`**-Pipeline generiert deterministisch hochwertigen React + TypeScript + Tailwind Anwendungscode aus Figma Boards, Views, Komponenten oder selektierten Teilbäumen. Die bestehende kundenspezifische Pipeline wird als **`rocket`** isoliert weitergeführt und kann separat oder gemeinsam mit `default` ausgeliefert werden.

---

## 5. Epic Value

Das OSS-NPM-Paket WorkspaceDev kann einem weltweit tätigen Finanzunternehmen und der OSS-Community eindrucksvoll demonstrieren, dass WorkspaceDev ohne proprietäre oder kundenspezifische UI-Bibliotheken hochwertigen, auditierbaren und reproduzierbaren Anwendungscode generieren kann.

Gleichzeitig entsteht eine Plattformarchitektur, die zukünftige kundenspezifische, branchenspezifische oder Open-Source-orientierte Pipelines sauber ergänzbar macht, ohne den Runtime-Kern mit Sonderfällen zu belasten.

---

## 6. Business-Kontext

Der Kunde ist ein sehr großes weltweit tätiges Finanzunternehmen. Für diese Zielgruppe sind folgende Eigenschaften entscheidend:

- Auditierbarkeit
- Reproduzierbarkeit
- deterministisches Verhalten
- lokale Ausführbarkeit
- minimale externe Abhängigkeiten
- klare Supply-Chain-Evidence
- starke Testabdeckung
- kontrollierbare Paketgrenzen
- keine versteckten kundenspezifischen Artefakte im OSS-Bundle
- professionelle Demo-Fähigkeit ohne Offenlegung interner Bibliotheken

Die neue `default`-Pipeline muss daher nicht nur „funktionieren“, sondern als **vertrauensbildendes Showcase-Artefakt** dienen.

---

## 7. Problem Statement

Die bestehende Pipeline ist leistungsfähig, aber die aktuelle Architektur und das aktuelle Template sind für die neue OSS-Default-Anforderung nicht optimal:

- Die Pipeline ist heute konzeptionell eine feste Stage-Abfolge mit einem gebündelten Template-Stack.
- `template.prepare` startet aktuell aus `template/react-mui-app`.
- Das bestehende Template enthält MUI-/Emotion-Abhängigkeiten.
- Kundenspezifische Profile und Mappings sind für die bisherige Kundensituation wertvoll, aber nicht geeignet als OSS-Default-Demo.
- Weitere Pipelines würden ohne Registry- und Boundary-Konzept schnell zu Sonderfalllogik führen.
- Die UI hat noch keine Pipeline-Auswahl als Produktkonzept.
- Packaging muss sicherstellen, dass `default`, `rocket` oder beide Pipelines ausgeliefert werden können, ohne unerwünschte Dateien oder Dependencies einzuschleppen.

Die neue Anforderung ist daher eine Architektur-, Produkt-, Qualitäts- und Demo-Anforderung zugleich.

---

## 8. Product Vision

WorkspaceDev wird zur lokalen, deterministischen **Design-to-Code Pipeline Platform**.

Die neue `default`-Pipeline ist die OSS-Showcase-Pipeline:

> „Select or paste a Figma board, view, or component and receive a clean, typed, responsive React + TypeScript + Tailwind application with traceable token mapping, semantic components, validation evidence and reproducible output.“

Die `rocket`-Pipeline bleibt die kundenspezifische Enterprise-Pipeline:

> „Use the customer-specific high-fidelity path where proprietary libraries, customer profiles and enterprise-specific mappings are intentionally available.“

Die Plattform erlaubt zukünftig weitere Pipelines:

- `banking-design-system`
- `insurance-claims`
- `internal-admin-ui`
- `storybook-first`
- `wcag-strict`
- `marketing-site`
- `mobile-first`

Der Runtime-Kern bleibt stabil; Pipelines werden über registrierte Definitionen, eigene Templates, eigene Generatoren und eigene Quality Policies ergänzt.

---

## 9. Scope

### 9.1 In Scope

Dieses Epic umfasst:

- Einführung einer Pipeline Registry
- Einführung von Pipeline Manifesten
- Einführung der Pipeline-ID `default`
- Umbenennung der bestehenden Pipeline in `rocket`
- neue `default`-Pipeline für React + TypeScript + Tailwind CSS
- neues Template `template/react-tailwind-app`
- pipeline-spezifische Stage-Service-Delegation
- pipeline-spezifische Validation Policies
- API-/Contract-Erweiterung um `pipelineId`
- Runtime-Status mit `availablePipelines`
- optionaler Endpoint `GET /workspace/pipelines`
- UI-Dropdown zur Pipeline-Auswahl bei mehr als einer verfügbaren Pipeline
- Packaging Profiles für `default`, `rocket` und `default,rocket`
- Pack-Verification pro Profil
- Golden-, Contract-, Unit-, Property-, Visual-, UI-, E2E- und Packaging-Tests
- Release-Gate-Erweiterung für Pipeline-Bundles
- Dokumentation, Migration Guide, Pipeline Authoring Guide und Demo Guide
- Generierungs-Evidence pro Job über einen Pipeline Quality Passport

### 9.2 Out of Scope

Nicht Bestandteil dieses Epics:

- nicht-deterministische LLM-Codegenerierung
- Abhängigkeit der `default`-Pipeline von MUI, Emotion oder kundenspezifischen Bibliotheken
- vollständige Rekonstruktion beliebiger proprietärer Design-System-Komponenten
- Entfernung der bestehenden Rocket-Funktionalität
- Änderung der Zero-Telemetry-Policy
- neue kundenspezifische HSM/KMS-Integrationen
- zentrale Cloud-Plattform oder Backend-Abhängigkeit
- automatische Produktivsetzung generierten Codes ohne Review

---

## 10. Requirement Traceability Matrix

| Kundenanforderung                                                        | Umsetzung im Epic                                                                            |
| ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| Weitere Pipeline als default mit dem Namen `default`                     | Neue Pipeline Definition `default` in Pipeline Registry                                      |
| Aktuelle Kunden Pipeline bekommt den Namen `rocket`                      | Migration der bestehenden Pipeline in isoliertes `rocket`-Modul                              |
| `default` generiert Figma Board/View/Komponente in React + TS + Tailwind | Neue `default`-Codegen-Engine, neues `react-tailwind-app`-Template, Scoped Generation        |
| `default` arbeitet zunächst deterministisch                              | `deterministic: true`, kein LLM-Codegen, byte-stabile Snapshots                              |
| Auslieferbar mit `default`, `rocket` oder beiden                         | Build-/Pack-Profile und Manifest-basierte Registry                                           |
| Pipelines eigenständig                                                   | getrennte Templates, Services, Tests, Artifacts, Import-Boundaries                           |
| Dropdown bei mehr als einer Pipeline                                     | UI liest `availablePipelines` und zeigt Auswahl nur bei `length > 1`                         |
| Zukunftsfähig für weitere Pipelines                                      | Pipeline Authoring Contract und Registry Pattern                                             |
| State-of-the-Art Implementierung                                         | Clean Architecture, manifestbasierte Paketierung, deterministische Reports, Quality Passport |
| Hochwertige Testabdeckung                                                | Unit, Contract, Golden, Property, Visual, E2E, Packaging, Release Gates                      |

---

## 11. Zielarchitektur

### 11.1 Architekturprinzipien

Die Zielarchitektur folgt diesen Prinzipien:

1. **Pipeline Isolation by Design**  
   Jede Pipeline hat eigene Generatorlogik, eigene Template-Bundles, eigene Validation Policies und eigene Golden Fixtures.

2. **Shared Kernel, Pluggable Pipeline**  
   Gemeinsame Infrastruktur wie Job Queue, Source Ingestion, Artifact Store, Public Job Projection, Preview, Inspector und Release Gates bleibt im Core. Pipeline-spezifische Entscheidungen wandern in Pipeline-Module.

3. **Determinism First**  
   Alle Pipelines, insbesondere `default`, erzeugen bei gleichem Input byte-stabile Outputs.

4. **No Hidden Customer Coupling**  
   Die OSS-Default-Pipeline darf keine Kundendateien, kundenspezifischen Aliases, MUI/Emotion Runtime Dependencies oder proprietären Mappings enthalten.

5. **Evidence by Default**  
   Jeder Job erzeugt nachvollziehbare Artefakte: Pipeline-ID, Template-ID, Token Coverage, unsupported nodes, Validation Summary und Packaging Context.

6. **Progressive Extension**  
   Neue Pipelines werden durch Registrierung ergänzt, nicht durch Verzweigungen im Orchestrator-Kern.

7. **Small Public Contract, Strong Internal Boundaries**  
   Public API bleibt verständlich; interne Pipeline-Details bleiben modular.

---

## 12. Pipeline Registry

### 12.1 Konzept

Es wird eine zentrale Pipeline Registry eingeführt. Sie kennt nur die Pipelines, die im aktuellen Build-/Pack-Profil enthalten sind.

Konzeptionelles Interface:

```ts
export type WorkspacePipelineId = "default" | "rocket" | string;

export interface WorkspacePipelineDefinition {
    id: WorkspacePipelineId;
    displayName: string;
    description: string;
    visibility: "oss" | "customer" | "internal";
    deterministic: true;
    stack: {
        framework: "react" | string;
        language: "typescript" | string;
        styling: "tailwind" | "mui" | string;
        bundler: "vite" | string;
    };
    templateBundleId: string;
    supportedSourceModes: WorkspaceFigmaSourceMode[];
    supportedScopes: Array<"board" | "view" | "component" | "selection">;
    createSubmissionPlan(
        context: PipelinePlanContext,
    ): PipelineStagePlanEntry[];
    createRegenerationPlan(
        context: PipelinePlanContext,
    ): PipelineStagePlanEntry[];
    createRetryPlan(
        context: PipelineRetryPlanContext,
    ): PipelineStagePlanEntry[];
    validateInput(input: WorkspaceJobInput): PipelineValidationResult;
    validationPolicy: PipelineValidationPolicy;
    evidencePolicy: PipelineEvidencePolicy;
}
```

### 12.2 Registry-Regeln

- `default` ist der bevorzugte Default, wenn sie verfügbar ist.
- Wenn nur eine Pipeline verfügbar ist, wird diese automatisch verwendet.
- Wenn mehrere Pipelines verfügbar sind und `default` verfügbar ist, wird `default` automatisch vorausgewählt.
- Wenn mehrere Pipelines verfügbar sind und `default` nicht verfügbar ist, muss die Runtime eine klare Auswahl erzwingen oder einen eindeutig erklärten Fehler liefern.
- Eine nicht ausgelieferte Pipeline darf weder in der API noch in der UI erscheinen.
- Eine unbekannte Pipeline-ID erzeugt `400 INVALID_PIPELINE`.
- Eine inkompatible Kombination aus Pipeline, Source Mode oder Scope erzeugt `400 PIPELINE_INPUT_UNSUPPORTED`.

### 12.3 Registry-Struktur

Empfohlene Struktur:

```text
src/
  pipelines/
    core/
      pipeline-definition.ts
      pipeline-registry.ts
      pipeline-manifest.ts
      pipeline-selection.ts
      pipeline-boundaries.ts
      pipeline-errors.ts
      pipeline-evidence.ts
    default/
      index.ts
      default-pipeline.ts
      default-template-prepare-service.ts
      default-codegen-generate-service.ts
      default-token-compiler.ts
      default-layout-solver.ts
      default-component-synthesizer.ts
      default-tailwind-emitter.ts
      default-validation-policy.ts
      default-quality-passport.ts
    rocket/
      index.ts
      rocket-pipeline.ts
      rocket-template-prepare-service.ts
      rocket-codegen-generate-service.ts
      rocket-validation-policy.ts
```

### 12.4 Warum nicht nur ein neues Flag?

Ein einzelnes Flag wie `useTailwindTemplate` wäre kurzfristig schneller, aber langfristig falsch. Die Kundenanforderung verlangt eigenständige Pipelines, unterschiedliche Auslieferungsprofile, UI-Auswahl, Zukunftsfähigkeit und hochwertige Tests. Das erfordert eine echte Pipeline-Abstraktion.

---

## 13. API- und Contract-Erweiterung

### 13.1 `WorkspaceJobInput`

Der Submit Contract wird um `pipelineId` erweitert:

```ts
export interface WorkspaceJobInput {
    figmaSourceMode: WorkspaceFigmaSourceMode;
    llmCodegenMode: "deterministic";
    pipelineId?: WorkspacePipelineId;
    figmaFileKey?: string;
    figmaAccessToken?: string;
    figmaJsonPath?: string;
    figmaJsonPayload?: string;
    enableGitPr?: boolean;
    repoUrl?: string;
    repoToken?: string;
    projectName?: string;
    targetPath?: string;
    customerProfilePath?: string;
    storybookStaticDir?: string;
}
```

### 13.2 Runtime Status

`GET /workspace` wird erweitert:

```ts
export interface WorkspaceRuntimeStatus {
    status: "ready" | "starting" | "draining";
    contractVersion: string;
    availablePipelines: WorkspacePipelineDescriptor[];
    defaultPipelineId: WorkspacePipelineId;
}

export interface WorkspacePipelineDescriptor {
    id: WorkspacePipelineId;
    displayName: string;
    description: string;
    deterministic: true;
    default: boolean;
    visibility: "oss" | "customer" | "internal";
    stack: {
        framework: string;
        language: string;
        styling: string;
        bundler: string;
    };
    supportedSourceModes: WorkspaceFigmaSourceMode[];
    supportedScopes: Array<"board" | "view" | "component" | "selection">;
}
```

### 13.3 Neuer Endpoint

Optionaler, aber empfohlener Endpoint:

```http
GET /workspace/pipelines
```

Response:

```json
{
    "defaultPipelineId": "default",
    "pipelines": [
        {
            "id": "default",
            "displayName": "Default — React + TypeScript + Tailwind",
            "description": "OSS pipeline for deterministic React/Tailwind code generation.",
            "deterministic": true,
            "default": true,
            "stack": {
                "framework": "react",
                "language": "typescript",
                "styling": "tailwind",
                "bundler": "vite"
            },
            "supportedSourceModes": [
                "rest",
                "hybrid",
                "local_json",
                "figma_paste",
                "figma_plugin"
            ],
            "supportedScopes": ["board", "view", "component", "selection"]
        }
    ]
}
```

### 13.4 Job Result Metadata

Jeder Job erhält Pipeline-Metadaten:

```ts
export interface WorkspaceJobPipelineMetadata {
    pipelineId: WorkspacePipelineId;
    pipelineDisplayName: string;
    templateBundleId: string;
    generatorVersion: string;
    deterministic: true;
    buildProfile: string;
}
```

Diese Metadaten werden in Job Status, Job Result, Inspector, Evidence Manifest und Generation Report ausgegeben.

---

## 14. UI-/UX-Anforderung

### 14.1 Dropdown-Verhalten

Die WorkspaceDev-UI lädt `availablePipelines` aus dem Runtime Status oder aus `GET /workspace/pipelines`.

Regeln:

- Wenn `availablePipelines.length === 1`: kein Dropdown anzeigen.
- Wenn `availablePipelines.length > 1`: Dropdown anzeigen.
- Default-Auswahl ist `defaultPipelineId`.
- Auswahl wird als `pipelineId` in den Submit Payload übernommen.
- Job Status zeigt verwendete Pipeline.
- Inspector zeigt verwendete Pipeline.
- Regeneration übernimmt standardmäßig die Pipeline des Source Jobs.
- User kann bei neuer Submission eine andere Pipeline wählen.

### 14.2 Beispieloptionen

```text
Default — React + TypeScript + Tailwind
Rocket — Customer-specific pipeline
```

### 14.3 Accessibility

Das Dropdown muss:

- ein sichtbares Label haben
- keyboard-bedienbar sein
- Screenreader-kompatibel sein
- den aktiven Pipeline-Stack anzeigen
- bei nicht verfügbarer Pipeline verständliche Fehlermeldungen anzeigen

### 14.4 UX Copy

Empfohlene UI-Copy:

```text
Pipeline
Choose how WorkspaceDev should transform the selected Figma design.

Default — Open-source React + TypeScript + Tailwind output.
Rocket — Customer-specific generation profile.
```

---

## 15. Neue `default`-Pipeline

### 15.1 Pipeline-Ziel

Die `default`-Pipeline generiert aus Figma Input eine eigenständige, lauffähige React + TypeScript + Tailwind Anwendung.

Sie soll nicht nur ein visuelles Abbild erzeugen, sondern einen wartbaren, verständlichen und überprüfbaren Frontend-Code liefern.

### 15.2 Unterstützte Inputs

Die Pipeline unterstützt:

- vollständiges Figma Board
- einzelner Screen / View
- einzelnes Component Node
- Mehrfachauswahl
- Figma Plugin Envelope
- Raw JSON Paste / Drop / Upload
- REST / Hybrid Pfade, sofern Token und File Key verfügbar sind
- lokale JSON Fixtures für CI und Airgap-Szenarien

### 15.3 Output-Ziele

Der generierte Code soll:

- typisiert sein
- buildbar sein
- lintbar sein
- deterministisch formatiert sein
- semantisches HTML bevorzugen
- Tailwind Utility Classes sinnvoll einsetzen
- CSS Custom Properties für Design Tokens verwenden
- responsive Layouts erzeugen
- Barrierefreiheit grundlegend berücksichtigen
- wiederverwendbare Komponenten extrahieren
- unsupported oder unsichere Figma-Strukturen transparent reporten
- ohne MUI, Emotion oder kundenspezifische Runtime Dependencies auskommen

### 15.4 Empfohlener Template-Stack

Neues Template:

```text
template/react-tailwind-app/
```

Empfohlene Baseline:

- React
- React DOM
- TypeScript
- Vite
- Tailwind CSS
- `@tailwindcss/vite`
- ESLint
- Vitest
- Testing Library
- optional `react-router-dom`, wenn mehrere Screens als Routen erzeugt werden
- optional `zod` nur, wenn generierte Forms oder Reports Laufzeitvalidierung benötigen

Explizit nicht erlaubt:

- `@mui/*`
- `@emotion/*`
- kundenspezifische UI Libraries
- kundenspezifische Import Aliases
- proprietäre Assets oder Profile
- Telemetry SDKs

### 15.5 Output-Struktur

Beispiel:

```text
figma-generated/
  package.json
  index.html
  vite.config.ts
  tsconfig.json
  eslint.config.js
  src/
    main.tsx
    App.tsx
    routes.tsx
    styles.css
    components/
      Button.tsx
      Card.tsx
      Input.tsx
      Navigation.tsx
      GeneratedIcon.tsx
    pages/
      DashboardPage.tsx
      LoginPage.tsx
    design/
      tokens.css
      token-report.json
    generated/
      figma-map.json
      generation-report.json
      unsupported-nodes.json
      quality-passport.json
```

### 15.6 Design Token Compiler

Der Default Token Compiler übersetzt Figma-Daten deterministisch in CSS Custom Properties und Tailwind-kompatible Utility-Patterns.

Token-Kategorien:

- Farben
- Typografie
- Font Weights
- Spacing
- Radius
- Borders
- Shadows
- Opacity
- Breakpoints
- Z-Index-Heuristiken
- Dark-/Light-Hinweise, sofern eindeutig ableitbar

Output:

```css
:root {
    --color-surface-default: #ffffff;
    --color-text-primary: #101828;
    --radius-card: 1rem;
    --spacing-section-y: 4rem;
}
```

Token Report:

```json
{
    "schemaVersion": "1.0.0",
    "pipelineId": "default",
    "tokenCoverage": 0.94,
    "conflicts": [],
    "fallbacks": [
        {
            "kind": "typography",
            "nodeId": "42:17",
            "reason": "missing_figma_text_style",
            "fallback": "text-base"
        }
    ]
}
```

### 15.7 Layout Solver

Der Layout Solver erkennt und übersetzt:

- Figma Auto Layout zu Flexbox/Tailwind
- wiedererkennbare Raster zu CSS Grid/Tailwind
- Constraints zu responsiven Container-Regeln
- Frame-Größen zu Page/Section/Container-Konzepten
- visuelle Lesereihenfolge zu stabiler DOM-Reihenfolge
- absolute Positionierung nur als Fallback

Priorität:

1. semantic layout
2. flex/grid layout
3. responsive container layout
4. absolute fallback with warning

### 15.8 Semantic Component Synthesizer

Der Synthesizer erzeugt semantische React-Komponenten aus Design-Strukturen:

- `Button`
- `Card`
- `Input`
- `Textarea`
- `Select`
- `Checkbox`
- `FormField`
- `Navigation`
- `Sidebar`
- `Header`
- `Table`
- `List`
- `MetricCard`
- `Dialog` / `Modal`
- `Avatar`
- `Badge`

Der Synthesizer soll nicht jedes Figma-Node blind als `div` ausgeben. Er entscheidet deterministisch anhand von:

- Node Type
- Name Pattern
- Auto Layout Pattern
- Textinhalt
- Wiederholungen
- Layer-Hierarchie
- Interaktionssignalen
- Component/Instance-Beziehungen
- Design Token Nutzung

### 15.9 Accessibility Baseline

Die `default`-Pipeline erzeugt mindestens:

- saubere Heading-Hierarchie, soweit aus Figma ableitbar
- `button` für klickbare Aktionen
- `label` für Formularfelder, soweit Textbezug erkennbar ist
- `aria-label` Fallbacks aus Figma-Namen
- `alt` Fallbacks für Bild-/Icon-Elemente
- Fokusreihenfolge entsprechend DOM-Lesereihenfolge
- Kontrastwarnungen im Generation Report
- keine bewusst unsemantischen Click-Divs ohne Warnung

### 15.10 Asset-Strategie

Die Asset-Strategie muss source-mode-sicher sein:

- Bei REST/Hybrid mit Token kann Asset Export genutzt werden.
- Bei Paste/Plugin ohne Token darf die Pipeline nicht stillschweigend externe Figma Calls ausführen.
- Vektorstrukturen können, soweit im Payload vorhanden, deterministisch als SVG oder inline Icon abgebildet werden.
- Fehlende Rasterdaten werden im `unsupported-nodes.json` oder `generation-report.json` ausgewiesen.
- Die Pipeline muss lieber ehrlich reporten als unkontrolliert nachzuladen.

### 15.11 Determinismus-Regeln

Die Pipeline muss:

- stabile Sortierung verwenden
- stabile Dateinamen generieren
- stabile Komponentennamen generieren
- Canonical JSON für Reports nutzen
- keine timestamps in Golden-relevanten Artefakten verwenden, außer sie sind normalisiert oder explizit ausgeschlossen
- atomic writes verwenden, wo Reports persistiert werden
- bei gleichem Input byte-identische Outputs erzeugen

---

## 16. Bestehende Pipeline als `rocket`

### 16.1 Ziel

Die bestehende kundenspezifische Pipeline wird in `rocket` überführt.

### 16.2 Anforderungen

- Funktionales Verhalten bleibt stabil.
- Bestehende Golden Fixtures werden auf `rocket` migriert.
- Bestehende kundenspezifische Bibliotheken, Profile und Component Mappings bleiben ausschließlich in `rocket`.
- Keine Rocket-spezifischen Imports dürfen in `default` vorkommen.
- `rocket` kann separat ausgeliefert werden.
- `rocket` kann gemeinsam mit `default` ausgeliefert werden.
- `rocket` kann aus OSS-Default-Bundles vollständig ausgeschlossen werden.

### 16.3 Migrationsverhalten

- Wenn ein Bundle nur `rocket` enthält und kein `pipelineId` gesetzt ist, wird `rocket` verwendet.
- Wenn ein Bundle `default` und `rocket` enthält und kein `pipelineId` gesetzt ist, wird `default` verwendet.
- Bestehende Kundenintegrationen erhalten eine Migrationsempfehlung: `pipelineId: "rocket"` explizit setzen.
- Ein Compatibility Guard warnt bei Nutzung von kundenspezifischen Inputs mit `default`, z. B. `customerProfilePath`.

---

## 17. Pipeline Packaging Profiles

### 17.1 Build-Profile

Empfohlene Build-Profile:

```bash
WORKSPACE_DEV_PIPELINES=default pnpm run build
WORKSPACE_DEV_PIPELINES=rocket pnpm run build
WORKSPACE_DEV_PIPELINES=default,rocket pnpm run build
```

Alternativ:

```bash
pnpm run build:pipelines:default
pnpm run build:pipelines:rocket
pnpm run build:pipelines:all
```

### 17.2 Packaging-Regeln

`default` only:

- enthält Core Runtime
- enthält `src/pipelines/default` kompiliert in `dist`
- enthält `template/react-tailwind-app`
- enthält keine Rocket-Templates
- enthält keine MUI-/Emotion-Runtime Dependencies im Default Template
- enthält keine kundenspezifischen Profile

`rocket` only:

- enthält Core Runtime
- enthält `rocket`
- enthält bestehendes Rocket Template / MUI Template
- enthält keine Default-Demo-Fixtures, außer ausdrücklich als Shared Docs erlaubt

`default,rocket`:

- enthält beide Pipeline Manifeste
- enthält beide Templates
- UI zeigt Dropdown
- Pack Verification prüft beide Pipeline-Grenzen

### 17.3 Pack Verification

Neue Tests:

- Tarball enthält erwartete Template-Verzeichnisse.
- Tarball enthält keine ausgeschlossenen Pipeline-Verzeichnisse.
- `default`-Tarball enthält keine `@mui/*` oder `@emotion/*` Template Runtime Dependencies.
- `default`-Tarball enthält keine kundenspezifischen Profile.
- `rocket`-Tarball enthält `rocket`-Manifest.
- `default,rocket`-Tarball enthält beide Manifeste.
- SBOM wird pro Profil erzeugt.
- License Allowlist wird pro Profil geprüft.
- Pack Size Gate wird pro Profil geprüft.

---

## 18. Pipeline Quality Passport

### 18.1 Konzept

Jeder Job erzeugt einen `quality-passport.json`. Dieser ist ein maschinenlesbarer Nachweis zur Generierung.

Beispiel:

```json
{
    "schemaVersion": "1.0.0",
    "pipelineId": "default",
    "templateBundleId": "react-tailwind-app",
    "buildProfile": "default",
    "scope": {
        "sourceMode": "figma_plugin",
        "scope": "selection",
        "selectedNodeCount": 3
    },
    "generatedFiles": [
        {
            "path": "src/App.tsx",
            "sizeBytes": 12048,
            "sha256": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
        }
    ],
    "validation": {
        "status": "passed",
        "stages": [
            {
                "name": "figma.source",
                "status": "completed"
            },
            {
                "name": "validate.project",
                "status": "completed"
            }
        ]
    },
    "coverage": {
        "token": {
            "status": "passed",
            "covered": 94,
            "total": 100,
            "ratio": 0.94
        },
        "semantic": {
            "status": "warning",
            "covered": 81,
            "total": 100,
            "ratio": 0.81
        }
    },
    "warnings": [
        {
            "code": "W_ABSOLUTE_LAYOUT_FALLBACK",
            "severity": "warning",
            "source": "codegen.generate",
            "message": "Absolute layout fallback used because constraints were ambiguous."
        }
    ],
    "metadata": {
        "status": "ok"
    }
}
```

### 18.2 Nutzen

Der Quality Passport macht die `default`-Pipeline enterprise-tauglich:

- Nachvollziehbarkeit
- Debugbarkeit
- Demo-Fähigkeit
- Compliance-Evidence
- Release-Vergleichbarkeit
- einfache Integration in Kundenevaluierungen

---

## 19. Teststrategie

### 19.1 Unit Tests

Abzudecken:

- Pipeline Registry
- Pipeline Manifest Resolver
- Pipeline Selection Rules
- Invalid Pipeline Handling
- Build Profile Resolver
- Pipeline Boundary Checker
- Default Token Compiler
- Default Layout Solver
- Default Component Synthesizer
- Default Tailwind Class Emitter
- Default Quality Passport Writer
- Rocket Compatibility Wrapper
- Error Codes

### 19.2 Contract Tests

Abzudecken:

- `WorkspaceJobInput.pipelineId`
- `GET /workspace` mit `availablePipelines`
- `GET /workspace/pipelines`
- Submit ohne `pipelineId`
- Submit mit `pipelineId=default`
- Submit mit `pipelineId=rocket`
- Submit mit unbekannter Pipeline
- Submit mit nicht ausgelieferter Pipeline
- Submit mit inkompatiblem Source Mode
- Job Result enthält Pipeline Metadata
- Regeneration übernimmt Source Pipeline

### 19.3 Golden Fixture Tests

Neue Fixture-Struktur:

```text
src/parity/fixtures/golden/
  default/
    fintech-dashboard/
    login-view/
    payment-card-component/
    form-heavy-view/
    responsive-marketing-page/
    dense-table-view/
    mobile-navigation/
    design-token-heavy-board/
  rocket/
    existing-customer-fixtures/
```

Jede Default Fixture prüft:

- generierte Dateien
- Snapshot-Stabilität
- Typecheck
- Build
- Token Report
- Quality Passport
- Unsupported Node Report
- Pipeline Metadata
- keine unerlaubten Dependencies

### 19.4 Property-Based Tests

Abzudecken:

- zufällige Node-Namen
- tiefe Node-Bäume
- leere Frames
- fehlende Styles
- doppelte Komponenten
- extreme Spacing-Werte
- ungewöhnliche Farbwerte
- sehr lange Texte
- ungültige Selektionen
- kollidierende Component-Namen
- responsive Edge Cases

### 19.5 Visual Tests

Abzudecken:

- Desktop Viewport
- Tablet Viewport
- Mobile Viewport
- Layout-Diff gegen Baseline
- Screenshot-Diff-Schwellenwerte
- Kontrastwarnungen
- Fallback-Visualisierung
- no-layout-collapse Checks

### 19.6 UI Tests

Abzudecken:

- Dropdown erscheint bei mehreren Pipelines.
- Dropdown erscheint nicht bei einer Pipeline.
- Auswahl wird in Submit Payload übernommen.
- Inspector zeigt verwendete Pipeline.
- Job Status zeigt verwendete Pipeline.
- Regeneration nutzt Source Pipeline.
- Deep Link mit Pipeline Parameter funktioniert, falls eingeführt.
- Nicht verfügbare Pipeline wird benutzerfreundlich erklärt.

### 19.7 E2E Tests

Abzudecken:

- `default` Pipeline über lokale JSON Fixture
- `default` Pipeline über Paste Payload
- `default` Pipeline über Plugin Envelope
- `rocket` Pipeline über bestehende Kundenfixture
- beide Pipelines in einem Bundle mit UI-Auswahl
- Regeneration mit `default`
- Regeneration mit `rocket`
- Cancellation während Pipeline-Run
- Error Recovery bei ungültigem Pipeline Request

### 19.8 Packaging Tests

Abzudecken:

- `npm pack` / `pnpm pack` pro Profil
- Tarball File List pro Profil
- SBOM pro Profil
- License Check pro Profil
- Dependency Denylist pro Profil
- Secret Scanner pro Profil
- Customer Artifact Scanner für `default`
- Pack Size Gate pro Profil

### 19.9 Release Gates

Die bestehenden Gates werden erweitert, nicht ersetzt.

Erforderlich:

- Typecheck
- Lint
- Unit Tests
- Contract Tests
- Golden Tests pro Pipeline
- Property-Based Tests
- UI Tests
- UI E2E Tests
- Visual Tests
- DAST Smoke
- Load Smoke
- Coverage Gate
- Mutation Tests für Registry und Selection Rules
- Boundary Lint
- No Telemetry Lint
- Secret Scan
- License Check
- SBOM
- Pack Verification
- Reproducible Build
- Airgap Install

---

## 20. Acceptance Criteria

### AC1 — Pipeline Registry ist eingeführt

**Given** WorkspaceDev startet  
**When** das ausgelieferte Paket eine oder mehrere Pipelines enthält  
**Then** registriert die Runtime ausschließlich die ausgelieferten Pipelines  
**And** `availablePipelines` enthält nur diese Pipelines  
**And** `defaultPipelineId` ist deterministisch auflösbar.

### AC2 — Neue `default`-Pipeline verfügbar

**Given** WorkspaceDev wird mit `default` ausgeliefert  
**When** ein User ein Figma Board, eine View oder Komponente generiert  
**Then** erzeugt WorkspaceDev eine lauffähige React + TypeScript + Tailwind App  
**And** die App besteht Typecheck, Lint und Build  
**And** der Output enthält keine MUI-, Emotion- oder kundenspezifischen Runtime Dependencies.

### AC3 — Bestehende Pipeline ist `rocket`

**Given** die bestehende kundenspezifische Pipeline wird migriert  
**When** bestehende Golden Fixtures ausgeführt werden  
**Then** laufen sie unter `pipelineId=rocket`  
**And** der Output bleibt funktional äquivalent  
**And** die Migration ist dokumentiert.

### AC4 — Pipeline-Auswahl in der UI

**Given** WorkspaceDev wird mit `default` und `rocket` ausgeliefert  
**When** der User die WorkspaceDev-UI öffnet  
**Then** sieht er ein Pipeline-Dropdown  
**And** die Auswahl wird als `pipelineId` gesendet  
**And** Job Status und Inspector zeigen die verwendete Pipeline.

### AC5 — Single-Pipeline UX

**Given** WorkspaceDev wird nur mit `default` ausgeliefert  
**When** der User die UI öffnet  
**Then** wird kein unnötiges Pipeline-Dropdown angezeigt  
**And** `default` wird automatisch verwendet.

### AC6 — Packaging Profile funktionieren

**Given** das Paket wird mit `WORKSPACE_DEV_PIPELINES=default` gebaut  
**When** der erzeugte Tarball geprüft wird  
**Then** enthält er nur Core, Default Pipeline und `react-tailwind-app` Template  
**And** keine Rocket Artefakte  
**And** keine MUI-/Emotion Runtime Dependencies im Default Template.

### AC7 — Determinismus

**Given** dieselbe Figma Fixture wird mehrfach mit derselben Pipeline ausgeführt  
**When** die Generierung wiederholt wird  
**Then** sind alle generierten Dateien byte-stabil  
**And** Quality Passport, Token Report und Generation Report sind reproduzierbar.

### AC8 — Scoped Generation

**Given** ein Figma Board enthält mehrere Views und Komponenten  
**When** der User eine einzelne View oder Komponente auswählt  
**Then** generiert die `default`-Pipeline nur den ausgewählten Scope  
**And** der Output bleibt buildbar  
**And** der Quality Passport weist den Scope aus.

### AC9 — Pipeline Boundaries

**Given** `default` und `rocket` existieren im Codebase  
**When** Boundary Tests laufen  
**Then** darf `default` keine Rocket-spezifischen Module importieren  
**And** `rocket` darf nicht implizit vom Default Template abhängen  
**And** Core darf keine Pipeline-spezifischen Sonderfälle enthalten.

### AC10 — Future Pipeline Readiness

**Given** ein Entwickler möchte eine dritte Pipeline hinzufügen  
**When** er eine neue `WorkspacePipelineDefinition` implementiert und registriert  
**Then** sind keine Änderungen am Orchestrator-Kern und keine UI-Sonderfälle erforderlich  
**And** die Pipeline kann eigene Golden Fixtures und Packaging Tests definieren.

### AC11 — Enterprise Evidence

**Given** ein Release Candidate wird erstellt  
**When** die Release Gates laufen  
**Then** enthalten die Evidence Artifacts Pipeline-ID, Build-Profil, Template-ID, SBOM, License Check, Golden-Test-Ergebnisse und Pack Verification  
**And** die Zero-Telemetry-Policy bleibt erfüllt.

### AC12 — Customer Demo Readiness

**Given** ein Evaluator des Finanzunternehmens installiert WorkspaceDev  
**When** er die Default Demo ausführt  
**Then** kann er ohne kundenspezifische Bibliotheken eine überzeugende React/Tailwind App generieren  
**And** die Demo zeigt Board-, View- und Component-Generierung  
**And** alle Artefakte sind lokal nachvollziehbar.

---

## 21. User Stories

### Story 1 — Pipeline Registry Foundation

Als Maintainer möchte ich Pipelines über eine Registry definieren, damit WorkspaceDev mehrere Pipeline-Implementierungen sauber verwalten kann.

**Akzeptanz:**

- Registry existiert.
- `default` und `rocket` können registriert werden.
- Runtime gibt verfügbare Pipelines aus.
- Nicht ausgelieferte Pipelines sind nicht sichtbar.
- Tests decken Auswahl, Fehler und Default-Auflösung ab.

### Story 2 — Public Contract um `pipelineId` erweitern

Als API Consumer möchte ich eine Pipeline explizit auswählen können, damit ich deterministisch kontrollieren kann, welcher Generator verwendet wird.

**Akzeptanz:**

- `pipelineId` ist optional im Submit Contract.
- Validierung erkennt unbekannte oder nicht verfügbare Pipelines.
- Job Result enthält Pipeline Metadata.
- Contract Changelog dokumentiert die Änderung.

### Story 3 — Bestehende Pipeline in `rocket` migrieren

Als Bestandskunde möchte ich die bisherige Pipeline ohne Funktionsverlust weiter nutzen können.

**Akzeptanz:**

- bestehende Pipeline ist als `rocket` registriert.
- bestehende Golden Tests laufen unter `rocket`.
- Migration Guide existiert.
- Backward Compatibility ist getestet.

### Story 4 — `react-tailwind-app` Template erstellen

Als OSS-User möchte ich ein generiertes Projekt ohne kundenspezifische UI Libraries erhalten.

**Akzeptanz:**

- Template existiert unter `template/react-tailwind-app`.
- Template nutzt React, TypeScript, Tailwind und Vite.
- Template hat eigene `package.json`, `vite.config.ts`, `tsconfig.json`, `eslint.config.js` und `src/styles.css`.
- Template Build, Typecheck, Lint und Tests laufen.
- Keine MUI-/Emotion Runtime Dependencies.

### Story 5 — Default Token Compiler implementieren

Als Entwickler möchte ich Figma Styles deterministisch in Design Tokens übersetzen.

**Akzeptanz:**

- `tokens.css` wird erzeugt.
- Token-Namen sind stabil.
- Token Report wird erzeugt.
- Konflikte und Fallbacks werden dokumentiert.
- Golden Fixtures decken tokenlastige Designs ab.

### Story 6 — Default Layout Solver implementieren

Als User möchte ich responsive, wartbare Layouts statt absolut positionierter Div-Wüsten erhalten.

**Akzeptanz:**

- Auto Layout wird zu Flex/Tailwind.
- Grid-ähnliche Muster werden erkannt.
- Absolute Layouts sind Fallbacks mit Warnung.
- Responsive Breakpoints werden erzeugt.
- Visual Tests decken Desktop und Mobile ab.

### Story 7 — Semantic Component Synthesizer implementieren

Als User möchte ich semantische, wiederverwendbare Komponenten erhalten.

**Akzeptanz:**

- Buttons, Cards, Inputs, Forms, Navigation, Tables und Lists werden erkannt.
- Komponenten haben TypeScript Props.
- Namen sind deterministisch.
- Duplikate werden vermieden.
- Accessibility-Basics werden umgesetzt.

### Story 8 — Pipeline Dropdown in der UI

Als User möchte ich bei mehreren Pipelines auswählen können, welche Pipeline genutzt wird.

**Akzeptanz:**

- Dropdown erscheint nur bei mehr als einer Pipeline.
- Auswahl wird im Submit Payload gesendet.
- Auswahl ist keyboard- und screenreader-freundlich.
- Job Status zeigt Pipeline.
- Inspector zeigt Pipeline.

### Story 9 — Pipeline-spezifische Validation Policies

Als Maintainer möchte ich je Pipeline eigene Validierungsregeln, damit `default` und `rocket` unterschiedliche Qualitätsprofile haben können.

**Akzeptanz:**

- Default Policy prüft Tailwind/React/TS Build.
- Rocket Policy erhält bestehende Validierungslogik.
- Validation Summary enthält Pipeline-ID.
- Tests decken beide Policies ab.

### Story 10 — Build-/Pack-Profile einführen

Als Maintainer möchte ich das Paket mit `default`, `rocket` oder beiden Pipelines ausliefern können.

**Akzeptanz:**

- Build-Profile existieren.
- Pack Verification prüft Profilgrenzen.
- SBOM wird pro Profil erzeugt.
- License Check läuft pro Profil.
- Tarball Tests laufen pro Profil.

### Story 11 — Quality Passport

Als Enterprise Evaluator möchte ich pro Generierung einen nachvollziehbaren Qualitätsnachweis erhalten.

**Akzeptanz:**

- `quality-passport.json` wird erzeugt.
- Enthält Pipeline-ID, Template-ID, Scope, Validierung und Warnings.
- Keine Secrets im Report.
- Report ist deterministic.
- Inspector kann Report anzeigen.

### Story 12 — Default Demo Experience

Als OSS-User möchte ich WorkspaceDev mit einer überzeugenden Demo evaluieren können.

**Akzeptanz:**

- Demo Fixture Pack existiert.
- Demo zeigt Board-, View- und Component-Generierung.
- Demo läuft lokal ohne Figma Token über lokale JSON/Plugin Payloads.
- Dokumentation erklärt den Ablauf.
- Quality Passport ist Bestandteil der Demo.

---

## 22. Innovative Product Add-ons

Diese Elemente sind nicht zwingend für eine Minimalumsetzung, würden aber die Demo- und Enterprise-Wirkung deutlich erhöhen.

### 22.1 Pipeline Quality Passport Viewer

Die UI zeigt den Quality Passport nicht nur als JSON, sondern als visuelle Übersicht:

- Pipeline
- Scope
- Generated Files
- Token Coverage
- Semantic Coverage
- Build Status
- Warnings
- Unsupported Nodes

### 22.2 Design Token Ledger

Ein Ledger zeigt, welche Figma Styles in welche CSS Custom Properties übersetzt wurden:

```text
Figma Color Style / Surface / Primary -> --color-surface-primary
Figma Text Style / Heading / XL -> --font-heading-xl
Figma Effect / Card Shadow -> --shadow-card
```

### 22.3 Semantic Confidence Map

Die Pipeline kann im Report ausweisen, welche Komponenten sicher semantisch erkannt wurden und wo Fallbacks genutzt wurden.

```json
{
    "components": [
        {
            "name": "PrimaryButton",
            "confidence": 0.98,
            "reason": "component_name_and_shape_match"
        },
        {
            "name": "MetricCard",
            "confidence": 0.84,
            "reason": "repeated_card_grid_pattern"
        }
    ]
}
```

### 22.4 Demo Narrative für Finanzunternehmen

Empfohlene Demo-Fixtures:

- Global Banking Dashboard
- Payment Authorization Card
- Login / MFA View
- Transaction Table
- Risk Alert Modal
- Mobile Navigation
- Design Token Heavy Board

Diese Demo wirkt branchennah, bleibt aber OSS-neutral und enthält keine Kundendaten.

---

## 23. Definition of Done

Das Epic ist abgeschlossen, wenn:

- `default` als neue OSS-Pipeline verfügbar ist.
- Die bestehende Pipeline als `rocket` verfügbar ist.
- Pipeline Registry und Manifest-System eingeführt sind.
- `WorkspaceJobInput.pipelineId` unterstützt wird.
- Runtime `availablePipelines` ausgibt.
- UI-Dropdown bei mehreren Pipelines funktioniert.
- `default` React + TypeScript + Tailwind Code generiert.
- `default` keine MUI-/Emotion-/kundenspezifischen Runtime Dependencies enthält.
- Board-, View-, Component- und Selection-Scopes unterstützt werden.
- `rocket` regressionsfrei migriert ist.
- Build-/Pack-Profile für `default`, `rocket` und beide Pipelines funktionieren.
- Pack Verification, SBOM und License Checks pro Profil laufen.
- Golden Tests für beide Pipelines existieren.
- Visual Tests für Default Fixtures existieren.
- Property-Based Tests für Default Generator Edge Cases existieren.
- UI-/E2E-Tests für Pipeline-Auswahl existieren.
- Quality Passport pro Job erzeugt wird.
- Dokumentation, Migration Guide und Pipeline Authoring Guide existieren.
- Zero-Telemetry-Policy unverändert erfüllt bleibt.

---

## 24. Qualitäts-KPIs

Empfohlene Zielwerte:

| KPI                                               |                                       Zielwert |
| ------------------------------------------------- | ---------------------------------------------: |
| Default Fixture Build Success                     |                                          100 % |
| Default Fixture Typecheck Success                 |                                          100 % |
| Default Fixture Lint Success                      |                                          100 % |
| Byte-stabile Wiederholung identischer Fixtures    |                                          100 % |
| MUI-/Emotion Dependencies im `default` Template   |                                              0 |
| Kundenspezifische Artefakte im `default` Bundle   |                                              0 |
| Pipeline-Auswahl Contract-Test-Abdeckung          |                                100 % der Pfade |
| Pack-Profile Tarball Verification                 |                              100 % der Profile |
| Token Coverage für Showcase Fixtures              |                                         ≥ 90 % |
| Semantic Component Coverage für Showcase Fixtures |                                         ≥ 75 % |
| Backend Coverage Gates                            | bestehende Projektgates halten oder verbessern |
| UI Dropdown Accessibility Tests                   |                                      bestanden |
| No-Telemetry Guard                                |                                      bestanden |
| SBOM pro Profil                                   |                                      vorhanden |

---

## 25. Risiken und Gegenmaßnahmen

| Risiko                                               |                      Auswirkung | Gegenmaßnahme                                                     |
| ---------------------------------------------------- | ------------------------------: | ----------------------------------------------------------------- |
| `default` und `rocket` koppeln sich unbeabsichtigt   |  Wartungs- und Packaging-Risiko | Import-Boundary-Tests, Tarball Verification, getrennte Templates  |
| Default Output wirkt zu generisch                    | Demo überzeugt den Kunden nicht | Showcase Fixtures, Semantic Synthesizer, Quality Passport Viewer  |
| Rocket regressiert durch Umbenennung                 |            Bestandskundenrisiko | Rocket-Golden-Fixtures, Compatibility Tests, Migration Guide      |
| Paketgröße steigt stark                              |          NPM-/Enterprise-Risiko | Pack-Profile, Size Gates, Bundle Analysis                         |
| Determinismus bricht                                 |           Auditierbarkeit sinkt | Canonical JSON, stabile Sortierung, byte-stabile Snapshots        |
| Tailwind Mapping wird unwartbar                      | Langfristige Codequalität sinkt | Token Compiler modularisieren, Property-Based Tests               |
| Kundenspezifische Artefakte landen im OSS-Bundle     |    Compliance-/Vertrauensrisiko | Customer Artifact Scanner, SBOM, Tarball Inspection               |
| UI wird zu komplex                                   |                    Schlechte UX | Dropdown nur bei mehreren Pipelines, Default Auto-Selection       |
| Asset Export bei Paste/Plugin versucht externe Calls |         Airgap-/Security-Risiko | Source-mode-aware Asset Resolver, explizite Reports               |
| Qualität wird nur visuell bewertet                   |              Wartbarkeit leidet | Typecheck, lint, semantic coverage, a11y checks, quality passport |

---

## 26. Rollout-Plan

### Phase 1 — Architecture Foundation

- Pipeline Definition Interface
- Pipeline Registry
- Pipeline Manifest Resolver
- `pipelineId` Contract
- Runtime `availablePipelines`
- Error Codes
- Unit und Contract Tests

### Phase 2 — Rocket Migration

- bestehende Pipeline als `rocket` registrieren
- bestehende Plan Builder migrieren
- Golden Fixtures auf `rocket` umstellen
- Migration Guide schreiben
- Backward Compatibility testen

### Phase 3 — Default Template

- `template/react-tailwind-app` erstellen
- Vite/React/TS/Tailwind konfigurieren
- Template Tests und Validation Scripts ergänzen
- Dependency Denylist für Default einführen

### Phase 4 — Default Generator

- Token Compiler
- Layout Solver
- Component Synthesizer
- Tailwind Emitter
- Asset Resolver
- Quality Passport
- Golden Fixtures

### Phase 5 — UI Selection

- Runtime Pipelines laden
- Dropdown implementieren
- Submit Payload erweitern
- Job Status und Inspector erweitern
- UI Tests und E2E Tests

### Phase 6 — Packaging & Release Gates

- Build Profiles
- Pack Verification
- SBOM pro Profil
- License Check pro Profil
- Reproducible Build pro Profil
- Airgap Verification

### Phase 7 — Demo & Documentation

- Default Demo Guide
- Pipeline Authoring Guide
- Migration Guide
- OSS Showcase Fixtures
- Customer Demo Narrative

---

## 27. Jira-ready Epic

### Epic Name

WorkspaceDev Pluggable Pipelines & OSS Default React/TypeScript/Tailwind Codegen

### Epic Description

WorkspaceDev wird zu einer erweiterbaren Pipeline-Plattform ausgebaut. Eine neue `default`-Pipeline generiert deterministisch hochwertigen React + TypeScript + Tailwind Anwendungscode aus vollständigen Figma Boards, einzelnen Views, Komponenten oder selektierten Teilbäumen. Die bestehende kundenspezifische Pipeline wird als `rocket` isoliert weitergeführt.

Die Pipelines können künftig paketierungsseitig einzeln oder gemeinsam ausgeliefert werden. Wenn mehr als eine Pipeline verfügbar ist, kann der User die gewünschte Pipeline über ein UI-Dropdown auswählen. Die neue `default`-Pipeline nutzt ausschließlich verbreitete Open-Source-Bibliotheken und demonstriert die Fähigkeiten von WorkspaceDev ohne kundenspezifische Bibliotheken.

### Business Value

Das OSS-NPM-Paket kann einem weltweit tätigen Finanzunternehmen und der Open-Source-Community eindrucksvoll zeigen, dass WorkspaceDev lokal, deterministisch, auditierbar und ohne proprietäre UI Libraries hochwertigen Anwendungscode generieren kann. Gleichzeitig entsteht eine nachhaltige Architektur für zukünftige kundenspezifische oder branchenspezifische Pipelines.

### Epic Acceptance

Die neue `default`-Pipeline ist verfügbar, erzeugt React/TypeScript/Tailwind-Code, ist vollständig deterministisch, durch Golden-, Visual-, Contract-, Unit-, Property-, UI-, E2E- und Packaging-Tests abgesichert, kann unabhängig von `rocket` ausgeliefert werden und ist bei mehreren Pipelines über die WorkspaceDev-UI auswählbar. Die bestehende Pipeline ist als `rocket` migriert, isoliert und regressionsfrei. Build-/Pack-Profile, SBOM, License Check, Pack Verification und Zero-Telemetry-Gates bestehen.

---

## 28. Empfohlene initiale Jira Tickets

1. **Introduce Pipeline Registry and PipelineDefinition Contract**
2. **Extend WorkspaceJobInput and Runtime Status with Pipeline Metadata**
3. **Migrate Existing Pipeline to Rocket Pipeline Module**
4. **Create React Tailwind App Template**
5. **Implement Default Token Compiler**
6. **Implement Default Layout Solver**
7. **Implement Default Semantic Component Synthesizer**
8. **Implement Default Tailwind Emitter**
9. **Implement Pipeline Quality Passport**
10. **Add Pipeline Dropdown to Workspace UI**
11. **Add Pipeline Contract and Error Handling Tests**
12. **Add Default Golden Fixtures**
13. **Add Rocket Regression Golden Fixtures**
14. **Add Packaging Profiles and Tarball Verification**
15. **Add SBOM and License Checks per Pipeline Profile**
16. **Add Pipeline Authoring Guide**
17. **Add Default Pipeline Demo Guide**
18. **Add Migration Guide for Rocket Pipeline**

---

## 29. Architekturentscheidung: Canonical Stage Order beibehalten

Da die bestehende Pipeline laut Projektunterlagen bereits eine kanonische Stage-Reihenfolge besitzt und der Orchestrator diese Reihenfolge validiert, sollte die neue Architektur diese Reihenfolge zunächst bewusst beibehalten.

Statt Stage-Namen zu ändern, sollten Pipelines eigene Services oder Delegates für bestehende Stages liefern:

```text
figma.source        shared or pipeline-aware
ir.derive          shared deterministic IR derivation with pipeline hints
template.prepare   pipeline-specific template bundle
codegen.generate   pipeline-specific generator
validate.project   pipeline-specific validation policy
repro.export       shared preview/export
git.pr             shared opt-in integration
```

Vorteil:

- geringe Orchestrator-Risiken
- bestehende Logs und Stage States bleiben verständlich
- bestehende UI kann weiter Stage-Namen anzeigen
- Pipeline-spezifische Qualität entsteht dort, wo sie hingehört: Template, Codegen und Validation

---

## 30. Nichtfunktionale Anforderungen

### Security

- keine zusätzlichen Telemetry Pfade
- keine Kundengeheimnisse in Reports
- keine ungeprüften Remote Calls in Paste/Plugin Mode
- Dependency Denylist für `default`
- Secret Scan für alle Pack-Profile

### Performance

- Default Pipeline muss große Boards kontrolliert verarbeiten
- Job Queue und Backpressure Verhalten bleiben erhalten
- Token Compiler und Layout Solver müssen linear oder nahezu linear über Node Count skalieren
- sehr große Boards erzeugen Quality Warnings statt unkontrollierter Laufzeitexplosion

### Maintainability

- klare Modulgrenzen
- kleine Generator-Submodule
- Snapshot-fähige Reports
- Pipeline Authoring Guide
- geringe öffentliche API-Komplexität

### Accessibility

- UI-Dropdown barrierearm
- generierte Komponenten mit Basis-A11y
- a11y Warnings im Report
- Tests mit axe oder vergleichbarer bestehender Teststrategie

### Compliance

- Evidence pro Pipeline und Profil
- SBOM pro Profil
- License Check pro Profil
- Zero-Telemetry unverändert
- Reproducible Build pro Profil

---

## 31. Quellen

- WorkspaceDev Repository: <https://github.com/oscharko-dev/workspace-dev>
- WorkspaceDev README: <https://github.com/oscharko-dev/workspace-dev/blob/dev/README.md>
- WorkspaceDev PIPELINE.md: <https://github.com/oscharko-dev/workspace-dev/blob/dev/PIPELINE.md>
- WorkspaceDev package.json: <https://github.com/oscharko-dev/workspace-dev/blob/dev/package.json>
- Existing MUI Template package.json: <https://github.com/oscharko-dev/workspace-dev/blob/dev/template/react-mui-app/package.json>
- Public Contracts: <https://github.com/oscharko-dev/workspace-dev/blob/dev/src/contracts/index.ts>
- Pipeline Services: <https://github.com/oscharko-dev/workspace-dev/blob/dev/src/job-engine/services/pipeline-services.ts>
- Template Prepare Service: <https://github.com/oscharko-dev/workspace-dev/blob/dev/src/job-engine/services/template-prepare-service.ts>
- Figma Import / Inspector Scope Guide: <https://github.com/oscharko-dev/workspace-dev/blob/dev/docs/figma-import.md>
- Zero Telemetry Policy: <https://github.com/oscharko-dev/workspace-dev/blob/dev/ZERO_TELEMETRY.md>
- Compliance Manifest: <https://github.com/oscharko-dev/workspace-dev/blob/dev/COMPLIANCE.md>
- React TypeScript Documentation: <https://react.dev/learn/typescript>
- Tailwind CSS with Vite Documentation: <https://tailwindcss.com/docs/installation/using-vite>
- Vite Guide: <https://vite.dev/guide/>

---

## 32. Prüfhinweis

Die Online-Prüfung erfolgte über öffentlich zugängliche GitHub- und Framework-Dokumentationsseiten. Die NPM-Package-Seite war während der Prüfung über das verwendete Web-Tool nicht direkt abrufbar, wurde aber im WorkspaceDev README als autoritativer Distributionskanal benannt. Für finale Release-Akzeptanz sollte zusätzlich ein echter `npm view workspace-dev` / `npm pack` Check in CI oder lokal ausgeführt werden.
