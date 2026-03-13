import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  ComponentMappingRule,
  DesignIR,
  GeneratedFile,
  LlmCodegenMode,
  ScreenElementIR,
  ScreenIR
} from "./types.js";
import type { LlmClient } from "./llm.js";
import { ensureTsxName, sanitizeFileName } from "./path-utils.js";
import { WorkflowError } from "./workflow-error.js";

interface GenerateArtifactsInput {
  projectDir: string;
  ir: DesignIR;
  componentMappings?: ComponentMappingRule[];
  llmClient?: LlmClient;
  llmModelName: string;
  llmCodegenMode: LlmCodegenMode;
  onLog: (message: string) => void;
}

interface RejectedScreenEnhancement {
  screenName: string;
  reason: string;
}

interface GenerateArtifactsResult {
  generatedPaths: string[];
  themeApplied: boolean;
  screenApplied: number;
  screenTotal: number;
  screenRejected: RejectedScreenEnhancement[];
  llmWarnings: Array<{
    code: "W_LLM_RESPONSES_INCOMPLETE";
    message: string;
  }>;
  mappingCoverage?: {
    usedMappings: number;
    fallbackNodes: number;
    totalCandidateNodes: number;
  };
  mappingDiagnostics: {
    missingMappingCount: number;
    contractMismatchCount: number;
    disabledMappingCount: number;
  };
  mappingWarnings: Array<{
    code: "W_COMPONENT_MAPPING_MISSING" | "W_COMPONENT_MAPPING_CONTRACT_MISMATCH" | "W_COMPONENT_MAPPING_DISABLED";
    message: string;
  }>;
}

const literal = (value: string): string => JSON.stringify(value);

const toComponentName = (rawName: string): string => {
  const safeName = sanitizeFileName(rawName);
  const withLeadingLetter = /^[A-Za-z_]/.test(safeName) ? safeName : `Screen_${safeName}`;
  return withLeadingLetter
    .split("_")
    .filter((part) => part.length > 0)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join("") || "GeneratedScreen";
};

const flattenElements = (elements: ScreenElementIR[]): ScreenElementIR[] => {
  const all: ScreenElementIR[] = [];
  const stack = [...elements];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) {
      continue;
    }
    all.push(current);
    for (const child of current.children ?? []) {
      stack.push(child);
    }
  }
  return all;
};

const normalizeText = (value: string | undefined): string | undefined => {
  if (!value) {
    return undefined;
  }
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > 0 ? normalized : undefined;
};

const toStateKey = (element: ScreenElementIR): string => {
  const safe = sanitizeFileName(element.name || element.id || "field").toLowerCase();
  return safe.length > 0 ? safe : `field_${sanitizeFileName(element.id).toLowerCase()}`;
};

const collectScreenText = (screen: ScreenIR): string[] => {
  const unique = new Set<string>();
  for (const node of flattenElements(screen.children)) {
    if (node.type !== "text") {
      continue;
    }
    const text = normalizeText(node.text);
    if (!text) {
      continue;
    }
    unique.add(text);
    if (unique.size >= 10) {
      break;
    }
  }
  return Array.from(unique);
};

const collectInputNodes = (screen: ScreenIR): Array<{ key: string; label: string }> => {
  const inputs: Array<{ key: string; label: string }> = [];
  for (const node of flattenElements(screen.children)) {
    const normalizedName = node.name.toLowerCase();
    if (node.type !== "input" && !normalizedName.includes("input") && !normalizedName.includes("textfield")) {
      continue;
    }
    const label = normalizeText(node.text) ?? node.name;
    inputs.push({ key: toStateKey(node), label });
    if (inputs.length >= 8) {
      break;
    }
  }
  return inputs;
};

const collectButtonLabels = (screen: ScreenIR): string[] => {
  const labels: string[] = [];
  for (const node of flattenElements(screen.children)) {
    const normalizedName = node.name.toLowerCase();
    if (node.type !== "button" && !normalizedName.includes("button") && !normalizedName.includes("cta")) {
      continue;
    }
    const label = normalizeText(node.text) ?? normalizeText(node.name) ?? "Weiter";
    labels.push(label);
    if (labels.length >= 4) {
      break;
    }
  }
  return labels;
};

const renderScreenImports = ({ hasInputs, hasButtons }: { hasInputs: boolean; hasButtons: boolean }): string => {
  const imports = ["Box", "Stack", "Typography"];
  if (hasInputs) {
    imports.push("TextField");
  }
  if (hasButtons) {
    imports.push("Button");
  }
  return imports.join(", ");
};

const fallbackThemeFile = (ir: DesignIR): GeneratedFile => {
  const { tokens } = ir;
  return {
    path: "src/theme/theme.ts",
    content: `import { createTheme } from "@mui/material/styles";

export const appTheme = createTheme({
  palette: {
    primary: { main: ${literal(tokens.palette.primary)} },
    secondary: { main: ${literal(tokens.palette.secondary)} },
    background: { default: ${literal(tokens.palette.background)} },
    text: { primary: ${literal(tokens.palette.text)} }
  },
  spacing: ${Math.max(1, Math.round(tokens.spacingBase / 2))},
  shape: {
    borderRadius: ${Math.max(0, Math.round(tokens.borderRadius))}
  },
  typography: {
    fontFamily: ${literal(tokens.fontFamily)},
    h1: { fontSize: "${Math.round(tokens.headingSize)}px", fontWeight: 700 },
    body1: { fontSize: "${Math.round(tokens.bodySize)}px", lineHeight: 1.5 }
  }
});
`
  };
};

const fallbackScreenFile = (screen: ScreenIR): GeneratedFile => {
  const componentName = toComponentName(screen.name);
  const textBlocks = collectScreenText(screen);
  const inputNodes = collectInputNodes(screen);
  const buttonLabels = collectButtonLabels(screen);

  const hasInputs = inputNodes.length > 0;
  const hasButtons = buttonLabels.length > 0;

  const heading = normalizeText(screen.name) ?? "Generated screen";
  const titleText = textBlocks.at(0) ?? heading;

  const textLines = textBlocks.slice(1).map((text) => `        <Typography variant="body1">${literal(text)}</Typography>`);
  const inputLines = inputNodes.map(
    (entry) =>
      `        <TextField fullWidth label={${literal(entry.label)}} value={formState.${entry.key}} onChange={(event) => handleFieldChange(${literal(entry.key)}, event.target.value)} />`
  );
  const buttonLines = buttonLabels.map(
    (label) => `        <Button variant="contained" color="primary">${literal(label)}</Button>`
  );

  const formStateInit = hasInputs
    ? `  const [formState, setFormState] = useState<Record<string, string>>(${JSON.stringify(
        Object.fromEntries(inputNodes.map((entry) => [entry.key, ""]))
      )});
  const handleFieldChange = (key: string, value: string): void => {
    setFormState((prev) => ({ ...prev, [key]: value }));
  };
`
    : "";

  const useStateImport = hasInputs ? "import { useState } from \"react\";\n" : "";

  const contentBlocks = [...textLines, ...inputLines, ...buttonLines];
  if (contentBlocks.length === 0) {
    contentBlocks.push("        <Typography variant=\"body1\">Generated content placeholder.</Typography>");
  }

  return {
    path: toDeterministicScreenPath(screen.name),
    content: `${useStateImport}import { ${renderScreenImports({ hasInputs, hasButtons })} } from "@mui/material";

export default function ${componentName}Screen(): JSX.Element {
${formStateInit}  return (
    <Box sx={{ p: 4 }}>
      <Stack spacing={2}>
        <Typography variant="h4">${literal(titleText)}</Typography>
${contentBlocks.join("\n")}
      </Stack>
    </Box>
  );
}
`
  };
};

export const toDeterministicScreenPath = (screenName: string): string => {
  return `src/screens/${ensureTsxName(screenName)}`;
};

export const createDeterministicThemeFile = (ir: DesignIR): GeneratedFile => {
  return fallbackThemeFile(ir);
};

export const createDeterministicScreenFile = (screen: ScreenIR): GeneratedFile => {
  return fallbackScreenFile(screen);
};

const makeAppFile = (screens: ScreenIR[]): string => {
  const eagerImports = screens
    .slice(0, 1)
    .map((screen) => {
      const componentName = toComponentName(screen.name);
      const fileName = ensureTsxName(screen.name).replace(/\.tsx$/i, "");
      return `import ${componentName}Screen from "./screens/${fileName}";`;
    })
    .join("\n");

  const lazyImports = screens
    .slice(1)
    .map((screen) => {
      const componentName = toComponentName(screen.name);
      const fileName = ensureTsxName(screen.name).replace(/\.tsx$/i, "");
      return `const Lazy${componentName}Screen = lazy(async () => await import("./screens/${fileName}"));`;
    })
    .join("\n");

  const routes = screens
    .map((screen, index) => {
      const componentName = toComponentName(screen.name);
      const routePath = `/${sanitizeFileName(screen.name).toLowerCase()}`;
      const routeComponent = index === 0 ? `${componentName}Screen` : `Lazy${componentName}Screen`;
      return `          <Route path="${routePath}" element={<${routeComponent} />} />`;
    })
    .join("\n");

  const firstScreen = screens.at(0);
  const firstRoute = firstScreen ? `/${sanitizeFileName(firstScreen.name).toLowerCase()}` : "/";

  return `import { Suspense, lazy } from "react";
import { Box, CircularProgress } from "@mui/material";
import { HashRouter, Navigate, Route, Routes } from "react-router-dom";
${eagerImports}
${lazyImports.length > 0 ? `\n${lazyImports}` : ""}

const routeLoadingFallback = (
  <Box sx={{ display: "grid", minHeight: "50vh", placeItems: "center" }}>
    <CircularProgress size={32} />
  </Box>
);

export default function App(): JSX.Element {
  return (
    <HashRouter>
      <Suspense fallback={routeLoadingFallback}>
        <Routes>
${routes}
          <Route path="/" element={<Navigate to="${firstRoute}" replace />} />
          <Route path="*" element={<Navigate to="${firstRoute}" replace />} />
        </Routes>
      </Suspense>
    </HashRouter>
  );
}
`;
};

export const createDeterministicAppFile = (screens: ScreenIR[]): GeneratedFile => {
  return {
    path: "src/App.tsx",
    content: makeAppFile(screens)
  };
};

const writeGeneratedFile = async (rootDir: string, file: GeneratedFile): Promise<void> => {
  const absolutePath = path.resolve(rootDir, file.path);
  if (!absolutePath.startsWith(path.resolve(rootDir) + path.sep)) {
    throw new Error(`LLM attempted path traversal: ${file.path}`);
  }
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, file.content, "utf-8");
};

const dedupeMappingWarnings = (
  warnings: Array<{
    code: "W_COMPONENT_MAPPING_MISSING" | "W_COMPONENT_MAPPING_CONTRACT_MISMATCH" | "W_COMPONENT_MAPPING_DISABLED";
    nodeId: string;
    message: string;
  }>
): Array<{
  code: "W_COMPONENT_MAPPING_MISSING" | "W_COMPONENT_MAPPING_CONTRACT_MISMATCH" | "W_COMPONENT_MAPPING_DISABLED";
  message: string;
}> => {
  const unique = new Map<string, { code: "W_COMPONENT_MAPPING_MISSING" | "W_COMPONENT_MAPPING_CONTRACT_MISMATCH" | "W_COMPONENT_MAPPING_DISABLED"; message: string }>();
  for (const warning of warnings) {
    const key = `${warning.code}:${warning.nodeId}:${warning.message}`;
    if (!unique.has(key)) {
      unique.set(key, {
        code: warning.code,
        message: warning.message
      });
    }
  }
  return Array.from(unique.values());
};

const analyzeComponentMappings = ({
  componentMappings,
  allIrNodeIds
}: {
  componentMappings: ComponentMappingRule[];
  allIrNodeIds: Set<string>;
}): {
  warnings: Array<{
    code: "W_COMPONENT_MAPPING_MISSING" | "W_COMPONENT_MAPPING_CONTRACT_MISMATCH" | "W_COMPONENT_MAPPING_DISABLED";
    message: string;
  }>;
  diagnostics: {
    missingMappingCount: number;
    contractMismatchCount: number;
    disabledMappingCount: number;
  };
  coverage: {
    usedMappings: number;
    fallbackNodes: number;
    totalCandidateNodes: number;
  };
} => {
  const prioritizedMappings = [...componentMappings]
    .filter((mapping) => mapping.nodeId.trim().length > 0)
    .sort((left, right) => {
      if (left.priority !== right.priority) {
        return left.priority - right.priority;
      }
      if (left.source !== right.source) {
        return left.source === "local_override" ? -1 : 1;
      }
      return left.nodeId.localeCompare(right.nodeId);
    });

  const mappingByNodeId = new Map<string, ComponentMappingRule>();
  for (const mapping of prioritizedMappings) {
    if (!mappingByNodeId.has(mapping.nodeId)) {
      mappingByNodeId.set(mapping.nodeId, mapping);
    }
  }

  const warnings: Array<{
    code: "W_COMPONENT_MAPPING_MISSING" | "W_COMPONENT_MAPPING_CONTRACT_MISMATCH" | "W_COMPONENT_MAPPING_DISABLED";
    nodeId: string;
    message: string;
  }> = [];

  for (const mapping of mappingByNodeId.values()) {
    if (!mapping.enabled) {
      warnings.push({
        code: "W_COMPONENT_MAPPING_DISABLED",
        nodeId: mapping.nodeId,
        message: `Component mapping for node '${mapping.nodeId}' is disabled and was skipped.`
      });
      continue;
    }

    if (!allIrNodeIds.has(mapping.nodeId)) {
      warnings.push({
        code: "W_COMPONENT_MAPPING_CONTRACT_MISMATCH",
        nodeId: mapping.nodeId,
        message: `Component mapping for node '${mapping.nodeId}' does not match the current IR.`
      });
      continue;
    }

    warnings.push({
      code: "W_COMPONENT_MAPPING_MISSING",
      nodeId: mapping.nodeId,
      message: `Component mapping for node '${mapping.nodeId}' is not applied in deterministic generator mode.`
    });
  }

  const dedupedWarnings = dedupeMappingWarnings(warnings);

  return {
    warnings: dedupedWarnings,
    diagnostics: {
      missingMappingCount: dedupedWarnings.filter((warning) => warning.code === "W_COMPONENT_MAPPING_MISSING").length,
      contractMismatchCount: dedupedWarnings.filter((warning) => warning.code === "W_COMPONENT_MAPPING_CONTRACT_MISMATCH")
        .length,
      disabledMappingCount: dedupedWarnings.filter((warning) => warning.code === "W_COMPONENT_MAPPING_DISABLED").length
    },
    coverage: {
      usedMappings: 0,
      fallbackNodes: mappingByNodeId.size,
      totalCandidateNodes: mappingByNodeId.size
    }
  };
};

export const generateArtifacts = async ({
  projectDir,
  ir,
  componentMappings,
  llmClient,
  llmModelName,
  llmCodegenMode,
  onLog
}: GenerateArtifactsInput): Promise<GenerateArtifactsResult> => {
  void llmClient;
  void llmModelName;

  if (llmCodegenMode !== "deterministic") {
    throw new WorkflowError({
      code: "E_LLM_RUNTIME_UNAVAILABLE",
      stage: "codegen.generate",
      retryable: false,
      message: "Only deterministic code generation is supported in workspace-dev."
    });
  }

  const generatedPaths = new Set<string>();
  const allIrNodeIds = new Set<string>(
    ir.screens.flatMap((screen) => flattenElements(screen.children).map((node) => node.id))
  );

  const mapping = analyzeComponentMappings({
    componentMappings: componentMappings ?? [],
    allIrNodeIds
  });

  const deterministicTheme = fallbackThemeFile(ir);
  await writeGeneratedFile(projectDir, deterministicTheme);
  generatedPaths.add(deterministicTheme.path);

  for (const screen of ir.screens) {
    const deterministicScreen = fallbackScreenFile(screen);
    await writeGeneratedFile(projectDir, deterministicScreen);
    generatedPaths.add(deterministicScreen.path);
  }

  const appFile = createDeterministicAppFile(ir.screens);
  await writeGeneratedFile(projectDir, appFile);
  generatedPaths.add(appFile.path);

  onLog("Generated deterministic baseline artifacts");
  onLog("LLM enhancement disabled in deterministic mode; deterministic output retained");

  return {
    generatedPaths: Array.from(generatedPaths),
    themeApplied: false,
    screenApplied: 0,
    screenTotal: ir.screens.length,
    screenRejected: [],
    llmWarnings: [],
    mappingCoverage: mapping.coverage,
    mappingDiagnostics: mapping.diagnostics,
    mappingWarnings: mapping.warnings
  };
};
