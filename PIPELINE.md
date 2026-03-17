flowchart TB
subgraph INPUT["📥 Input"]
FigmaBoard["Figma File Key\n+ Access Token"]
end

    subgraph S1["Stage 1: figma.source"]
        REST["Figma REST API\nGET /v1/files/{key}"]
        Bootstrap["Bootstrap Fetch\ndepth=5..1"]
        Staged["Staged Node Fetch\nbatch=6, max=40 screens"]
        Merge["Merge Nodes\ninto Tree"]
        REST -->|too large| Bootstrap
        Bootstrap --> Staged
        Staged --> Merge
    end

    subgraph S2["Stage 2: ir.derive"]
        Extract["extractScreens\nFRAME/COMPONENT candidates"]
        MapEl["mapElement\ndepth limit=14"]
        DetType["determineElementType\n5 types: text|container|button|input|image"]
        Tokens["deriveTokens\ncolor heuristics"]
        Sparkasse["applySparkasseThemeDefaults\noverrides ALL tokens"]
        Truncate["truncateElementsToBudget\nbudget=1200"]
        Extract --> MapEl --> DetType
        Extract --> Truncate
        Tokens --> Sparkasse
    end

    subgraph S3["Stage 3: template.prepare"]
        Copy["Copy template/react-mui-app\nReact 19 + MUI v7 + Vite 8"]
    end

    subgraph S4["Stage 4: codegen.generate"]
        Theme["fallbackThemeFile\ncreateTheme with tokens"]
        Screen["fallbackScreenFile\nper screen"]
        Simplify["simplifyElements\nchild promotion"]
        Render["renderElement\ntext|button|container"]
        AppFile["makeAppFile\nHashRouter + lazy routes"]
        Screen --> Simplify --> Render
    end

    subgraph S5["Stage 5: validate.project"]
        Install["pnpm install"]
        Lint["pnpm lint"]
        TC["pnpm typecheck"]
        Build["pnpm build"]
        Install --> Lint --> TC --> Build
    end

    subgraph S6["Stage 6: repro.export"]
        CopyDist["Copy dist → repros/"]
    end

    subgraph OUTPUT["📤 Output"]
        GenApp["generated-app/\nsrc/App.tsx\nsrc/screens/*.tsx\nsrc/theme/theme.ts"]
    end

    INPUT --> S1 --> S2 --> S3 --> S4 --> S5 --> S6 --> OUTPUT

    style INPUT fill:#e8f5e9,color:#1b5e20
    style S1 fill:#e3f2fd,color:#0d47a1
    style S2 fill:#fff3e0,color:#e65100
    style S3 fill:#f3e5f5,color:#4a148c
    style S4 fill:#fce4ec,color:#880e4f
    style S5 fill:#e0f7fa,color:#006064
    style S6 fill:#f1f8e9,color:#33691e
    style OUTPUT fill:#e8f5e9,color:#1b5e20
