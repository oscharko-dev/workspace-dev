import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type * as ts from "typescript";
import type {
  ComponentMappingRule,
  DesignIR,
  GeneratedFile,
  LlmCodegenMode,
  ScreenElementIR,
  ScreenIR
} from "./types.js";
import { isLlmClientError, type LlmClient } from "./llm.js";
import { ensureTsxName, sanitizeFileName } from "./path-utils.js";
import { WorkflowError } from "./workflow-error.js";

type TypeScriptRuntime = typeof import("typescript");

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

interface VirtualParent {
  x?: number | undefined;
  y?: number | undefined;
  name?: string | undefined;
  layoutMode?: "VERTICAL" | "HORIZONTAL" | "NONE" | undefined;
}

const literal = (value: string): string => JSON.stringify(value);

const clamp = (value: number, min: number, max: number): number => {
  return Math.min(max, Math.max(min, value));
};

const normalizeFontFamily = (rawFamily: string | undefined): string | undefined => {
  if (!rawFamily || !rawFamily.trim()) {
    return undefined;
  }
  const normalized = rawFamily.trim();
  if (/roboto|arial|sans-serif/i.test(normalized)) {
    return normalized;
  }
  return `${normalized}, Roboto, Arial, sans-serif`;
};

const EGRESS_POLICY_DENY_MARKER = "egress policy denied";

const isEgressPolicyDenyError = (error: unknown): boolean => {
  const queue: unknown[] = [error];
  const visited = new Set<unknown>();

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || visited.has(current)) {
      continue;
    }
    visited.add(current);

    if (typeof current === "string") {
      if (current.toLowerCase().includes(EGRESS_POLICY_DENY_MARKER)) {
        return true;
      }
      continue;
    }

    if (typeof current !== "object") {
      continue;
    }

    const typed = current as { code?: unknown; message?: unknown; cause?: unknown };
    if (typed.code === "E_EGRESS_POLICY_DENY") {
      return true;
    }
    if (typeof typed.message === "string" && typed.message.toLowerCase().includes(EGRESS_POLICY_DENY_MARKER)) {
      return true;
    }
    if (typed.cause !== undefined) {
      queue.push(typed.cause);
    }
  }

  return false;
};

const toComponentName = (rawName: string): string => {
  const safe = sanitizeFileName(rawName);
  const parts = safe.split(/[_-]+/).filter((part) => part.length > 0);
  const pascal = parts
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join("");
  return pascal.length > 0 ? pascal : "Screen";
};

const toPxLiteral = (value: number | undefined): string | undefined => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined;
  }
  return literal(`${Math.round(value)}px`);
};

const hasVisualStyle = (element: ScreenElementIR): boolean => {
  return Boolean(
    element.fillColor ||
      element.strokeColor ||
      (element.cornerRadius ?? 0) > 0 ||
      (element.padding &&
        (element.padding.top > 0 ||
          element.padding.right > 0 ||
          element.padding.bottom > 0 ||
          element.padding.left > 0))
  );
};

const shouldPromoteChildren = (element: ScreenElementIR): boolean => {
  const loweredName = element.name.toLowerCase();
  if (
    loweredName.includes("muisvgiconroot") ||
    loweredName.includes("buttonendicon") ||
    loweredName.includes("expandiconwrapper")
  ) {
    return false;
  }

  if (element.type !== "container") {
    return false;
  }
  if (hasVisualStyle(element) || element.text?.trim()) {
    return false;
  }

  const children = element.children ?? [];
  if (children.length === 0) {
    return false;
  }

  if (
    children.some((child) => {
      const childName = child.name.toLowerCase();
      return (
        childName.includes("muisvgiconroot") ||
        childName.includes("buttonendicon") ||
        childName.includes("expandiconwrapper")
      );
    })
  ) {
    return false;
  }

  if (children.length === 1) {
    return true;
  }

  return false;
};

const simplifyNode = (element: ScreenElementIR): ScreenElementIR | null => {
  const simplifiedChildren = simplifyElements(element.children ?? []);
  const isSvgIconRoot = element.name.toLowerCase().includes("muisvgiconroot");
  const hasVectorPayload = element.nodeType === "VECTOR" && (element.vectorPaths?.length ?? 0) > 0;

  const simplified: ScreenElementIR = {
    ...element,
    children: simplifiedChildren
  };

  if (simplified.type === "text") {
    return simplified.text?.trim() ? simplified : null;
  }

  if (hasVectorPayload) {
    return simplified;
  }

  if (isSvgIconRoot) {
    return simplified;
  }

  const hasChildren = simplifiedChildren.length > 0;
  if (!hasChildren && !hasVisualStyle(simplified) && !simplified.text?.trim()) {
    return null;
  }

  return simplified;
};

const simplifyElements = (elements: ScreenElementIR[]): ScreenElementIR[] => {
  const result: ScreenElementIR[] = [];

  for (const element of elements) {
    const simplified = simplifyNode(element);
    if (!simplified) {
      continue;
    }

    if (shouldPromoteChildren(simplified)) {
      result.push(...(simplified.children ?? []));
      continue;
    }

    result.push(simplified);
  }

  return result;
};

const sortChildren = (children: ScreenElementIR[], layoutMode: "VERTICAL" | "HORIZONTAL" | "NONE"): ScreenElementIR[] => {
  const copied = [...children];
  if (layoutMode === "HORIZONTAL") {
    copied.sort((a, b) => (a.x ?? 0) - (b.x ?? 0));
  } else {
    copied.sort((a, b) => (a.y ?? 0) - (b.y ?? 0) || (a.x ?? 0) - (b.x ?? 0));
  }
  return copied;
};

const sxString = (entries: Array<[string, string | number | undefined]>): string => {
  const filtered = entries.filter((entry): entry is [string, string | number] => entry[1] !== undefined);
  return filtered.map(([key, value]) => `${key}: ${typeof value === "number" ? value : value}`).join(", ");
};

const indentBlock = (value: string, spaces: number): string => {
  const indent = " ".repeat(spaces);
  return value
    .split("\n")
    .map((line) => (line.length > 0 ? `${indent}${line}` : line))
    .join("\n");
};

const baseLayoutEntries = (
  element: ScreenElementIR,
  parent: VirtualParent,
  options?: { includePaints?: boolean }
): Array<[string, string | number | undefined]> => {
  const includePaints = options?.includePaints ?? true;
  const parentLayout = parent.layoutMode ?? "NONE";
  const isAbsoluteChild =
    parentLayout === "NONE" &&
    typeof element.x === "number" &&
    typeof element.y === "number" &&
    typeof parent.x === "number" &&
    typeof parent.y === "number";

  const layoutMode = element.layoutMode ?? "NONE";
  const hasChildren = (element.children?.length ?? 0) > 0;
  const isFlex = layoutMode === "VERTICAL" || layoutMode === "HORIZONTAL";
  const resolvedPosition = isAbsoluteChild ? "absolute" : layoutMode === "NONE" && hasChildren ? "relative" : undefined;

  const entries: Array<[string, string | number | undefined]> = [
    ["position", resolvedPosition ? literal(resolvedPosition) : undefined],
    ["left", isAbsoluteChild ? toPxLiteral((element.x ?? 0) - (parent.x ?? 0)) : undefined],
    ["top", isAbsoluteChild ? toPxLiteral((element.y ?? 0) - (parent.y ?? 0)) : undefined],
    ["width", toPxLiteral(element.width)],
    ["height", !hasChildren ? toPxLiteral(element.height) : undefined],
    ["minHeight", hasChildren ? toPxLiteral(element.height) : undefined],
    ["display", isFlex ? literal("flex") : undefined],
    ["flexDirection", layoutMode === "VERTICAL" ? literal("column") : layoutMode === "HORIZONTAL" ? literal("row") : undefined],
    ["gap", element.gap && element.gap > 0 ? toPxLiteral(element.gap) : undefined],
    ["pt", element.padding && element.padding.top > 0 ? toPxLiteral(element.padding.top) : undefined],
    ["pr", element.padding && element.padding.right > 0 ? toPxLiteral(element.padding.right) : undefined],
    ["pb", element.padding && element.padding.bottom > 0 ? toPxLiteral(element.padding.bottom) : undefined],
    ["pl", element.padding && element.padding.left > 0 ? toPxLiteral(element.padding.left) : undefined],
    ["bgcolor", includePaints && element.fillColor ? literal(element.fillColor) : undefined],
    [
      "border",
      includePaints && element.strokeColor
        ? literal(`${Math.max(1, Math.round(element.strokeWidth ?? 1))}px solid`)
        : undefined
    ],
    ["borderColor", includePaints && element.strokeColor ? literal(element.strokeColor) : undefined],
    ["borderRadius", element.cornerRadius ? toPxLiteral(element.cornerRadius) : undefined],
    ["boxSizing", literal("border-box")],
    ["overflow", literal("visible")]
  ];

  return entries;
};

const renderText = (element: ScreenElementIR, depth: number, parent: VirtualParent): string => {
  const indent = "  ".repeat(depth);
  const text = literal(element.text?.trim() || element.name);
  const normalizedFont = normalizeFontFamily(element.fontFamily);
  const textLayoutEntries = baseLayoutEntries(element, parent, { includePaints: false }).filter(([key]) => {
    return key !== "width" && key !== "height" && key !== "minHeight";
  });

  const sx = sxString([
    ...textLayoutEntries,
    ["fontSize", element.fontSize ? toPxLiteral(element.fontSize) : undefined],
    ["fontWeight", element.fontWeight ? Math.round(element.fontWeight) : undefined],
    ["lineHeight", element.lineHeight ? toPxLiteral(element.lineHeight) : undefined],
    ["fontFamily", normalizedFont ? literal(normalizedFont) : undefined],
    ["color", element.fillColor ? literal(element.fillColor) : undefined],
    [
      "textAlign",
      element.textAlign === "LEFT"
        ? literal("left")
        : element.textAlign === "CENTER"
          ? literal("center")
          : element.textAlign === "RIGHT"
            ? literal("right")
            : undefined
    ],
    ["whiteSpace", literal("pre-wrap")]
  ]);

  return `${indent}<Typography sx={{ ${sx} }}>{${text}}</Typography>`;
};

const firstText = (element: ScreenElementIR): string | undefined => {
  if (element.type === "text" && element.text?.trim()) {
    return element.text.trim();
  }
  for (const child of element.children ?? []) {
    const match = firstText(child);
    if (match) {
      return match;
    }
  }
  return undefined;
};

const firstTextColor = (element: ScreenElementIR): string | undefined => {
  if (element.type === "text" && element.fillColor) {
    return element.fillColor;
  }
  for (const child of element.children ?? []) {
    const match = firstTextColor(child);
    if (match) {
      return match;
    }
  }
  return undefined;
};

const collectVectorPaths = (element: ScreenElementIR): string[] => {
  const localPaths = element.nodeType === "VECTOR" ? (element.vectorPaths ?? []) : [];
  const nestedPaths = (element.children ?? []).flatMap((child) => collectVectorPaths(child));
  return [...new Set([...localPaths, ...nestedPaths])];
};

const firstVectorColor = (element: ScreenElementIR): string | undefined => {
  if (element.nodeType === "VECTOR" && element.fillColor) {
    return element.fillColor;
  }
  for (const child of element.children ?? []) {
    const match = firstVectorColor(child);
    if (match) {
      return match;
    }
  }
  return undefined;
};

const collectTextNodes = (element: ScreenElementIR): ScreenElementIR[] => {
  const local = element.type === "text" && element.text?.trim() ? [element] : [];
  const nested = (element.children ?? []).flatMap((child) => collectTextNodes(child));
  return [...local, ...nested];
};

const collectIconNodes = (element: ScreenElementIR): ScreenElementIR[] => {
  const local = element.name.toLowerCase().includes("muisvgiconroot") ? [element] : [];
  const nested = (element.children ?? []).flatMap((child) => collectIconNodes(child));
  return [...local, ...nested];
};

const hasSubtreeName = (element: ScreenElementIR, pattern: string): boolean => {
  if (element.name.toLowerCase().includes(pattern.toLowerCase())) {
    return true;
  }
  return (element.children ?? []).some((child) => hasSubtreeName(child, pattern));
};

const findFirstByName = (element: ScreenElementIR, pattern: string): ScreenElementIR | undefined => {
  if (element.name.toLowerCase().includes(pattern.toLowerCase())) {
    return element;
  }
  for (const child of element.children ?? []) {
    const nested = findFirstByName(child, pattern);
    if (nested) {
      return nested;
    }
  }
  return undefined;
};

interface SemanticIconModel {
  paths: string[];
  color?: string | undefined;
  width?: number | undefined;
  height?: number | undefined;
}

interface SemanticInputModel {
  labelNode?: ScreenElementIR | undefined;
  valueNode?: ScreenElementIR | undefined;
  labelIcon?: SemanticIconModel | undefined;
  suffixText?: string | undefined;
  suffixIcon?: SemanticIconModel | undefined;
  isSelect: boolean;
}

interface InteractiveFieldModel {
  key: string;
  label: string;
  defaultValue: string;
  isSelect: boolean;
  options: string[];
  suffixText?: string | undefined;
  labelFontFamily?: string | undefined;
  labelColor?: string | undefined;
  valueFontFamily?: string | undefined;
  valueColor?: string | undefined;
}

interface InteractiveAccordionModel {
  key: string;
  defaultExpanded: boolean;
}

interface IconImportSpec {
  localName: string;
  modulePath: string;
}

interface MappedImportSpec {
  localName: string;
  modulePath: string;
}

interface RenderContext {
  fields: InteractiveFieldModel[];
  accordions: InteractiveAccordionModel[];
  iconImports: IconImportSpec[];
  mappedImports: MappedImportSpec[];
  mappingByNodeId: Map<string, ComponentMappingRule>;
  usedMappingNodeIds: Set<string>;
  mappingWarnings: Array<{
    code: "W_COMPONENT_MAPPING_MISSING" | "W_COMPONENT_MAPPING_CONTRACT_MISMATCH" | "W_COMPONENT_MAPPING_DISABLED";
    nodeId: string;
    message: string;
  }>;
  emittedWarningKeys: Set<string>;
}

const isValidJsIdentifier = (value: string): boolean => {
  return /^[A-Za-z_$][\w$]*$/.test(value);
};

const toIdentifier = (rawValue: string, fallback = "MappedComponent"): string => {
  const sanitized = rawValue.replace(/[^A-Za-z0-9_$]+/g, "_").replace(/^(\d)/, "_$1");
  if (isValidJsIdentifier(sanitized)) {
    return sanitized;
  }
  return fallback;
};

const toComponentIdentifier = (rawName: string): string => {
  const normalized = rawName
    .replace(/[^A-Za-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter((part) => part.length > 0)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join("");
  return isValidJsIdentifier(normalized) ? normalized : "MappedComponent";
};

const pushMappingWarning = ({
  context,
  code,
  nodeId,
  message
}: {
  context: RenderContext;
  code: "W_COMPONENT_MAPPING_MISSING" | "W_COMPONENT_MAPPING_CONTRACT_MISMATCH" | "W_COMPONENT_MAPPING_DISABLED";
  nodeId: string;
  message: string;
}): void => {
  const key = `${code}:${nodeId}`;
  if (context.emittedWarningKeys.has(key)) {
    return;
  }
  context.emittedWarningKeys.add(key);
  context.mappingWarnings.push({
    code,
    nodeId,
    message
  });
};

const toContractExpression = (value: unknown): string => {
  if (typeof value === "string") {
    return literal(value);
  }
  return JSON.stringify(value);
};

const dedupeMappingWarnings = (
  warnings: Array<{
    code: "W_COMPONENT_MAPPING_MISSING" | "W_COMPONENT_MAPPING_CONTRACT_MISMATCH" | "W_COMPONENT_MAPPING_DISABLED";
    message: string;
  }>
): Array<{
  code: "W_COMPONENT_MAPPING_MISSING" | "W_COMPONENT_MAPPING_CONTRACT_MISMATCH" | "W_COMPONENT_MAPPING_DISABLED";
  message: string;
}> => {
  const seen = new Set<string>();
  const deduped: typeof warnings = [];
  for (const warning of warnings) {
    const key = `${warning.code}:${warning.message}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(warning);
  }
  return deduped;
};

const resolveContractValue = (value: unknown, element: ScreenElementIR): unknown => {
  if (typeof value !== "string") {
    return value;
  }
  if (value === "{{nodeId}}") {
    return element.id;
  }
  if (value === "{{nodeName}}") {
    return element.name;
  }
  if (value === "{{text}}") {
    return firstText(element) ?? "";
  }
  return value;
};

const registerMappedImport = ({ context, mapping }: { context: RenderContext; mapping: ComponentMappingRule }): string => {
  const preferredName = toComponentIdentifier(mapping.componentName);
  const existing = context.mappedImports.find((item) => item.localName === preferredName && item.modulePath === mapping.importPath);
  if (existing) {
    return existing.localName;
  }

  const existingByModule = context.mappedImports.find((item) => item.modulePath === mapping.importPath);
  if (existingByModule) {
    return existingByModule.localName;
  }

  const knownNames = new Set<string>([
    "Box",
    "Button",
    "Divider",
    "Typography",
    "SvgIcon",
    "TextField",
    "Accordion",
    "AccordionSummary",
    "AccordionDetails",
    "MenuItem",
    "InputAdornment",
    ...context.iconImports.map((item) => item.localName),
    ...context.mappedImports.map((item) => item.localName)
  ]);

  let localName = preferredName;
  let suffix = 2;
  while (knownNames.has(localName)) {
    localName = `${preferredName}${suffix}`;
    suffix += 1;
  }

  context.mappedImports.push({
    localName: toIdentifier(localName, "MappedComponent"),
    modulePath: mapping.importPath
  });
  const newestImport = context.mappedImports.at(-1);
  return newestImport?.localName ?? "MappedComponent";
};

const isPlainRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null && !Array.isArray(value);
};

const renderMappedElement = (
  element: ScreenElementIR,
  depth: number,
  parent: VirtualParent,
  context: RenderContext
): string | undefined => {
  const mapping = context.mappingByNodeId.get(element.id);
  if (!mapping) {
    return undefined;
  }

  if (!mapping.enabled) {
    pushMappingWarning({
      context,
      code: "W_COMPONENT_MAPPING_DISABLED",
      nodeId: element.id,
      message: `Component mapping disabled for node '${element.id}', deterministic fallback used`
    });
    return undefined;
  }

  if (!mapping.importPath.trim() || !mapping.componentName.trim()) {
    pushMappingWarning({
      context,
      code: "W_COMPONENT_MAPPING_CONTRACT_MISMATCH",
      nodeId: element.id,
      message: `Component mapping for node '${element.id}' is missing componentName/importPath, deterministic fallback used`
    });
    return undefined;
  }

  if (mapping.propContract !== undefined && !isPlainRecord(mapping.propContract)) {
    pushMappingWarning({
      context,
      code: "W_COMPONENT_MAPPING_CONTRACT_MISMATCH",
      nodeId: element.id,
      message: `Component mapping contract for node '${element.id}' is not an object, deterministic fallback used`
    });
    return undefined;
  }

  const componentName = registerMappedImport({ context, mapping });
  context.usedMappingNodeIds.add(element.id);
  const indent = "  ".repeat(depth);
  const sx = sxString(baseLayoutEntries(element, parent));
  const resolvedContract = mapping.propContract ?? {};
  const childrenValue = resolveContractValue(resolvedContract.children, element);
  const propEntries = Object.entries(resolvedContract)
    .filter(([key]) => key !== "children")
    .map(([key, value]) => `${key}={${toContractExpression(resolveContractValue(value, element))}}`);

  const props = [`data-figma-node-id={${literal(element.id)}}`, `sx={{ ${sx} }}`, ...propEntries].join(" ");
  if (childrenValue !== undefined) {
    return `${indent}<${componentName} ${props}>{${toContractExpression(childrenValue)}}</${componentName}>`;
  }

  const implicitText = firstText(element);
  if (implicitText) {
    return `${indent}<${componentName} ${props}>{${literal(implicitText)}}</${componentName}>`;
  }

  return `${indent}<${componentName} ${props} />`;
};

const toStateKey = (element: ScreenElementIR): string => {
  const source = `${element.name}_${element.id}`.toLowerCase();
  const normalized = source.replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return normalized.length > 0 ? normalized : "field";
};

const parseLocalizedNumber = (value: string): number | undefined => {
  const normalized = value
    .replace(/\s+/g, "")
    .replace(/\./g, "")
    .replace(",", ".")
    .replace(/[^\d.-]/g, "");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : undefined;
};

const formatLocalizedNumber = (value: number, fractionDigits = 2): string => {
  const safe = Number.isFinite(value) ? value : 0;
  return new Intl.NumberFormat("de-DE", {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits
  }).format(safe);
};

const deriveSelectOptions = (defaultValue: string): string[] => {
  const trimmed = defaultValue.trim();
  if (!trimmed) {
    return ["Option 1", "Option 2", "Option 3"];
  }

  if (/jahr/i.test(trimmed)) {
    const match = trimmed.match(/(\d+)/);
    const base = match ? Number(match[1]) : undefined;
    if (typeof base === "number" && Number.isFinite(base)) {
      return [...new Set([Math.max(1, base - 5), base, base + 5].map((value) => `${value} Jahre`))];
    }
  }

  if (trimmed.includes("%")) {
    const parsed = parseLocalizedNumber(trimmed);
    if (typeof parsed === "number") {
      const deltas = [-0.25, 0, 0.25];
      return [...new Set(deltas.map((delta) => `${formatLocalizedNumber(Math.max(0, parsed + delta))} %`))];
    }
  }

  const parsed = parseLocalizedNumber(trimmed);
  if (typeof parsed === "number") {
    const deltas = [-0.1, 0, 0.1];
    return [
      ...new Set(
        deltas.map((delta) => {
          const value = parsed * (1 + delta);
          return formatLocalizedNumber(Math.max(0, value));
        })
      )
    ];
  }

  return [trimmed, `${trimmed} A`, `${trimmed} B`];
};

const INPUT_NAME_HINTS = [
  "muiformcontrolroot",
  "muioutlinedinputroot",
  "muiinputbaseroot",
  "muiinputbaseinput",
  "muiinputroot",
  "muiselectselect",
  "textfield"
];

const ACCORDION_NAME_HINTS = ["accordion", "accordionsummarycontent", "collapsewrapper"];
const PLACEHOLDER_TEXT_PATTERNS = [
  /\beingabe\s*\d+\b/i,
  /\boption\s*\d+\b/i,
  /\blorem\b/i,
  /\bplaceholder\b/i,
  /\bfield\s*\d+\b/i
];

const hasAnySubtreeName = (element: ScreenElementIR, patterns: string[]): boolean => {
  return patterns.some((pattern) => hasSubtreeName(element, pattern));
};

const isValueLikeText = (value: string): boolean => {
  const trimmed = value.trim();
  if (!trimmed) {
    return false;
  }
  return /\d/.test(trimmed) || trimmed.includes("%") || trimmed.includes("€") || /jahr/i.test(trimmed);
};

const splitTextRows = (texts: ScreenElementIR[]): { topRow: ScreenElementIR[]; bottomRow: ScreenElementIR[] } => {
  if (texts.length === 0) {
    return { topRow: [], bottomRow: [] };
  }
  if (texts.length === 1) {
    const single = texts[0];
    return single ? { topRow: [single], bottomRow: [] } : { topRow: [], bottomRow: [] };
  }
  const sortedByY = [...texts].sort((a, b) => (a.y ?? 0) - (b.y ?? 0) || (a.x ?? 0) - (b.x ?? 0));
  const first = sortedByY[0];
  const last = sortedByY[sortedByY.length - 1];
  if (!first || !last) {
    return { topRow: [], bottomRow: [] };
  }
  const minY = first.y ?? 0;
  const maxY = last.y ?? 0;
  const midpoint = (minY + maxY) / 2;
  const topRow = sortedByY.filter((node) => (node.y ?? 0) <= midpoint);
  const bottomRow = sortedByY.filter((node) => (node.y ?? 0) > midpoint);
  if (topRow.length > 0 && bottomRow.length > 0) {
    return { topRow, bottomRow };
  }
  return { topRow: sortedByY.slice(0, 1), bottomRow: sortedByY.slice(1) };
};

const isLikelyInputContainer = (element: ScreenElementIR): boolean => {
  if (element.type !== "container") {
    return false;
  }

  const hasDirectVisualContainer = Boolean(element.strokeColor || element.fillColor || (element.cornerRadius ?? 0) > 0);
  const width = element.width ?? 0;
  const height = element.height ?? 0;
  const sizeLooksLikeField = width >= 120 && height >= 36 && height <= 120;
  const hasInputSemantics = hasAnySubtreeName(element, INPUT_NAME_HINTS);

  const texts = collectTextNodes(element).filter((node) => (node.text?.trim() ?? "").length > 0);
  const { topRow, bottomRow } = splitTextRows(texts);
  const hasLabelValuePattern =
    topRow.some((node) => !isValueLikeText(node.text ?? "")) && bottomRow.some((node) => isValueLikeText(node.text ?? ""));

  if (hasInputSemantics && sizeLooksLikeField) {
    return true;
  }

  return hasDirectVisualContainer && sizeLooksLikeField && hasLabelValuePattern;
};

const isLikelyAccordionContainer = (element: ScreenElementIR): boolean => {
  if (element.type !== "container") {
    return false;
  }
  return hasAnySubtreeName(element, ACCORDION_NAME_HINTS) && hasSubtreeName(element, "collapsewrapper");
};

const registerIconImport = (context: RenderContext, spec: IconImportSpec): string => {
  const exists = context.iconImports.some((icon) => icon.localName === spec.localName);
  if (!exists) {
    context.iconImports.push(spec);
  }
  return spec.localName;
};

const registerInteractiveField = ({
  context,
  element,
  model
}: {
  context: RenderContext;
  element: ScreenElementIR;
  model: SemanticInputModel;
}): InteractiveFieldModel => {
  const key = toStateKey(element);
  const existing = context.fields.find((field) => field.key === key);
  if (existing) {
    return existing;
  }

  const label = model.labelNode?.text?.trim() ?? element.name;
  const defaultValue = model.valueNode?.text?.trim() ?? "";
  const isSelect = model.isSelect;
  const options = isSelect ? deriveSelectOptions(defaultValue) : [];

  const created: InteractiveFieldModel = {
    key,
    label,
    defaultValue,
    isSelect,
    options,
    suffixText: isSelect ? undefined : model.suffixText,
    labelFontFamily: normalizeFontFamily(model.labelNode?.fontFamily),
    labelColor: model.labelNode?.fillColor,
    valueFontFamily: normalizeFontFamily(model.valueNode?.fontFamily),
    valueColor: model.valueNode?.fillColor
  };
  context.fields.push(created);
  return created;
};

const registerInteractiveAccordion = ({
  context,
  element,
  defaultExpanded
}: {
  context: RenderContext;
  element: ScreenElementIR;
  defaultExpanded: boolean;
}): InteractiveAccordionModel => {
  const key = toStateKey(element);
  const existing = context.accordions.find((accordion) => accordion.key === key);
  if (existing) {
    return existing;
  }
  const created: InteractiveAccordionModel = {
    key,
    defaultExpanded
  };
  context.accordions.push(created);
  return created;
};

const buildSemanticInputModel = (element: ScreenElementIR): SemanticInputModel => {
  const texts = collectTextNodes(element).sort((a, b) => (a.y ?? 0) - (b.y ?? 0) || (a.x ?? 0) - (b.x ?? 0));
  const iconNodes = collectIconNodes(element)
    .map((node) => ({
      node,
      paths: collectVectorPaths(node)
    }));
  const iconVectors = iconNodes.filter((candidate) => candidate.paths.length > 0);

  const isSuffixText = (value: string): boolean => {
    const trimmed = value.trim();
    return trimmed === "€" || trimmed === "%" || trimmed === "$";
  };

  const { topRow, bottomRow } = splitTextRows(texts);
  const labelNode =
    topRow.find((node) => {
      const text = node.text?.trim() ?? "";
      return text.length > 0 && !isValueLikeText(text) && !isSuffixText(text);
    }) ??
    texts.find((node) => {
      const text = node.text?.trim() ?? "";
      return text.length > 0 && !isValueLikeText(text) && !isSuffixText(text);
    });

  const valueNode =
    bottomRow.find((node) => {
      const text = node.text?.trim() ?? "";
      return text.length > 0 && !isSuffixText(text);
    }) ??
    texts.find((node) => {
      const text = node.text?.trim() ?? "";
      return text.length > 0 && isValueLikeText(text) && !isSuffixText(text);
    });

  const labelIconNode =
    iconVectors.find((candidate) => {
      if (!labelNode) {
        return false;
      }
      const yDelta = Math.abs((candidate.node.y ?? 0) - (labelNode.y ?? 0));
      const isSmall = (candidate.node.width ?? 0) <= 16 && (candidate.node.height ?? 0) <= 16;
      const isOnLabelRow = yDelta <= 12;
      return isSmall && isOnLabelRow;
    }) ?? undefined;

  const rightBoundary = (element.x ?? 0) + (element.width ?? 0) * 0.62;
  const suffixTextNode = texts.find((node) => {
    const text = node.text?.trim() ?? "";
    return text.length > 0 && isSuffixText(text) && (node.x ?? 0) >= rightBoundary;
  });

  const suffixIconCandidate =
    iconNodes.find((candidate) => {
      const isRightSide = (candidate.node.x ?? 0) >= rightBoundary;
      const isNotLabelIcon = candidate.node.id !== labelIconNode?.node.id;
      return isRightSide && isNotLabelIcon;
    }) ?? undefined;

  const hasAdornment = hasSubtreeName(element, "inputadornmentroot");
  const isSelect = hasSubtreeName(element, "muiselectselect") || Boolean(suffixIconCandidate && !suffixTextNode);
  const suffixText = suffixTextNode?.text?.trim() ?? (hasAdornment && !suffixIconCandidate ? "€" : undefined);
  const suffixIconNode = suffixIconCandidate && suffixIconCandidate.paths.length > 0 ? suffixIconCandidate : undefined;

  return {
    labelNode,
    valueNode,
    labelIcon: labelIconNode
      ? {
          paths: labelIconNode.paths,
          color: firstVectorColor(labelIconNode.node),
          width: labelIconNode.node.width,
          height: labelIconNode.node.height
        }
      : undefined,
    suffixText,
    suffixIcon: suffixIconNode
      ? {
          paths: suffixIconNode.paths,
          color: firstVectorColor(suffixIconNode.node),
          width: suffixIconNode.node.width,
          height: suffixIconNode.node.height
        }
      : undefined,
    isSelect
  };
};

const renderInlineSvgIcon = (icon: SemanticIconModel, extraEntries: Array<[string, string | number | undefined]> = []): string => {
  const sx = sxString([
    ["width", toPxLiteral(icon.width)],
    ["height", toPxLiteral(icon.height)],
    ["color", icon.color ? literal(icon.color) : undefined],
    ...extraEntries
  ]);
  const width = Math.max(1, Math.round(icon.width ?? 24));
  const height = Math.max(1, Math.round(icon.height ?? 24));
  const paths = icon.paths.map((pathData) => `<path d={${literal(pathData)}} />`).join("");
  return `<SvgIcon sx={{ ${sx} }} viewBox={${literal(`0 0 ${width} ${height}`)}}>${paths}</SvgIcon>`;
};

const renderSemanticInput = (
  element: ScreenElementIR,
  depth: number,
  parent: VirtualParent,
  context: RenderContext
): string => {
  const indent = "  ".repeat(depth);
  const model = buildSemanticInputModel(element);
  const field = registerInteractiveField({ context, element, model });
  const outlineContainer = findFirstByName(element, "muioutlinedinputroot") ?? element;
  const outlinedBorderNode = findFirstByName(element, "muinotchedoutlined");
  const outlineStrokeColor = outlinedBorderNode?.strokeColor ?? outlineContainer.strokeColor;
  const fieldSx = sxString([
    ...baseLayoutEntries(outlineContainer, parent, { includePaints: false }),
    ["bgcolor", element.fillColor ? literal(element.fillColor) : undefined]
  ]);

  const inputRootStyle = sxString([
    ["borderRadius", toPxLiteral(outlinedBorderNode?.cornerRadius ?? outlineContainer.cornerRadius)],
    ["fontFamily", field.valueFontFamily ? literal(field.valueFontFamily) : undefined],
    ["color", field.valueColor ? literal(field.valueColor) : undefined]
  ]);
  const inputLabelStyle = sxString([
    ["fontFamily", field.labelFontFamily ? literal(field.labelFontFamily) : undefined],
    ["color", field.labelColor ? literal(field.labelColor) : undefined]
  ]);
  const outlineStyle = sxString([["borderColor", outlineStrokeColor ? literal(outlineStrokeColor) : undefined]]);
  const endAdornment =
    !field.isSelect && field.suffixText
      ? `endAdornment: <InputAdornment position="end">{${literal(field.suffixText)}}</InputAdornment>`
      : "";

  if (field.isSelect) {
    return `${indent}<TextField
${indent}  select
${indent}  label={${literal(field.label)}}
${indent}  value={formValues[${literal(field.key)}] ?? ""}
${indent}  onChange={(event) => updateFieldValue(${literal(field.key)}, event.target.value)}
${indent}  sx={{
${indent}    ${fieldSx},
${indent}    "& .MuiOutlinedInput-root": { ${inputRootStyle} },
${indent}    "& .MuiOutlinedInput-notchedOutline": { ${outlineStyle} },
${indent}    "& .MuiInputLabel-root": { ${inputLabelStyle} }
${indent}  }}
${indent}>
${indent}  {(selectOptions[${literal(field.key)}] ?? []).map((option) => (
${indent}    <MenuItem key={option} value={option}>{option}</MenuItem>
${indent}  ))}
${indent}</TextField>`;
  }

  return `${indent}<TextField
${indent}  label={${literal(field.label)}}
${indent}  value={formValues[${literal(field.key)}] ?? ""}
${indent}  onChange={(event) => updateFieldValue(${literal(field.key)}, event.target.value)}
${indent}  sx={{
${indent}    ${fieldSx},
${indent}    "& .MuiOutlinedInput-root": { ${inputRootStyle} },
${indent}    "& .MuiOutlinedInput-notchedOutline": { ${outlineStyle} },
${indent}    "& .MuiInputLabel-root": { ${inputLabelStyle} }
${indent}  }}
${indent}  InputProps={{ ${endAdornment} }}
${indent}/>`;
};

const renderSemanticAccordion = (
  element: ScreenElementIR,
  depth: number,
  parent: VirtualParent,
  context: RenderContext
): string => {
  const indent = "  ".repeat(depth);
  const accordionModel = registerInteractiveAccordion({
    context,
    element,
    defaultExpanded: true
  });
  const summaryRoot = findFirstByName(element, "muibuttonbaseroot") ?? element.children?.[0] ?? element;
  const summaryContent = findFirstByName(summaryRoot, "accordionsummarycontent") ?? summaryRoot;
  const detailsRoot = findFirstByName(element, "collapsewrapper") ?? element.children?.[1] ?? element;
  const detailsContainer = detailsRoot.children?.length === 1 ? (detailsRoot.children[0] ?? detailsRoot) : detailsRoot;

  const summaryChildren = sortChildren(summaryContent.children ?? [], summaryContent.layoutMode ?? "NONE");
  const renderedSummary = summaryChildren
    .map((child) =>
      renderElement(
        child,
        depth + 3,
        {
          x: summaryContent.x,
          y: summaryContent.y,
          name: summaryContent.name,
          layoutMode: summaryContent.layoutMode ?? "NONE"
        },
        context
      )
    )
    .filter((chunk): chunk is string => Boolean(chunk && chunk.trim()))
    .join("\n");

  const detailChildren = sortChildren(detailsContainer.children ?? [], detailsContainer.layoutMode ?? "NONE");
  const renderedDetails = detailChildren
    .map((child) =>
      renderElement(
        child,
        depth + 2,
        {
          x: detailsContainer.x,
          y: detailsContainer.y,
          name: detailsContainer.name,
          layoutMode: detailsContainer.layoutMode ?? "NONE"
        },
        context
      )
    )
    .filter((chunk): chunk is string => Boolean(chunk && chunk.trim()))
    .join("\n");

  const summaryFallbackLabel = firstText(summaryContent) ?? firstText(element) ?? "Accordion";
  const expandIconNode = findFirstByName(summaryRoot, "expandiconwrapper") ?? findFirstByName(element, "expandiconwrapper");
  const expandIconPaths = expandIconNode ? collectVectorPaths(expandIconNode) : [];

  let expandIconExpression: string;
  if (expandIconPaths.length > 0) {
    expandIconExpression = renderInlineSvgIcon(
      {
        paths: expandIconPaths,
        color: expandIconNode ? firstVectorColor(expandIconNode) : undefined,
        width: expandIconNode?.width,
        height: expandIconNode?.height
      },
      [["fontSize", literal("inherit")]]
    );
  } else {
    const expandMoreIcon = registerIconImport(context, {
      localName: "ExpandMoreIcon",
      modulePath: "@mui/icons-material/ExpandMore"
    });
    expandIconExpression = `<${expandMoreIcon} fontSize="small" />`;
  }

  const detailsSx = sxString([
    ["position", literal("relative")],
    ["width", toPxLiteral(detailsContainer.width)],
    ["minHeight", toPxLiteral(detailsContainer.height)],
    ["display", detailsContainer.layoutMode === "NONE" ? literal("block") : literal("flex")],
    ["flexDirection", detailsContainer.layoutMode === "HORIZONTAL" ? literal("row") : literal("column")],
    ["gap", detailsContainer.gap && detailsContainer.gap > 0 ? toPxLiteral(detailsContainer.gap) : undefined],
    ["pt", detailsContainer.padding && detailsContainer.padding.top > 0 ? toPxLiteral(detailsContainer.padding.top) : undefined],
    ["pr", detailsContainer.padding && detailsContainer.padding.right > 0 ? toPxLiteral(detailsContainer.padding.right) : undefined],
    ["pb", detailsContainer.padding && detailsContainer.padding.bottom > 0 ? toPxLiteral(detailsContainer.padding.bottom) : undefined],
    ["pl", detailsContainer.padding && detailsContainer.padding.left > 0 ? toPxLiteral(detailsContainer.padding.left) : undefined]
  ]);

  const summarySx = sxString([
    ["minHeight", toPxLiteral(summaryRoot.height)],
    ["pt", summaryRoot.padding && summaryRoot.padding.top > 0 ? toPxLiteral(summaryRoot.padding.top) : undefined],
    ["pr", summaryRoot.padding && summaryRoot.padding.right > 0 ? toPxLiteral(summaryRoot.padding.right) : undefined],
    ["pb", summaryRoot.padding && summaryRoot.padding.bottom > 0 ? toPxLiteral(summaryRoot.padding.bottom) : undefined],
    ["pl", summaryRoot.padding && summaryRoot.padding.left > 0 ? toPxLiteral(summaryRoot.padding.left) : undefined]
  ]);

  const accordionSx = sxString([
    ...baseLayoutEntries(element, parent),
    ["boxShadow", literal("none")]
  ]);

  return `${indent}<Accordion
${indent}  expanded={accordionState[${literal(accordionModel.key)}] ?? ${accordionModel.defaultExpanded ? "true" : "false"}}
${indent}  onChange={(_, expanded) => updateAccordionState(${literal(accordionModel.key)}, expanded)}
${indent}  disableGutters
${indent}  elevation={0}
${indent}  square
${indent}  sx={{ ${accordionSx}, "&::before": { display: "none" } }}
${indent}>
${indent}  <AccordionSummary expandIcon={${expandIconExpression}} sx={{ ${summarySx} }}>
${indent}    <Box sx={{ width: "100%", position: "relative", minHeight: ${literal(`${Math.max(20, Math.round(summaryContent.height ?? 24))}px`)} }}>
${renderedSummary || `${indent}      <Typography>{${literal(summaryFallbackLabel)}}</Typography>`}
${indent}    </Box>
${indent}  </AccordionSummary>
${indent}  <AccordionDetails sx={{ p: "0px" }}>
${indent}    <Box sx={{ ${detailsSx} }}>
${renderedDetails || `${indent}      <Box />`}
${indent}    </Box>
${indent}  </AccordionDetails>
${indent}</Accordion>`;
};

const renderButton = (element: ScreenElementIR, depth: number, parent: VirtualParent): string => {
  const indent = "  ".repeat(depth);
  const label = firstText(element) ?? element.name;
  const buttonTextColor = firstTextColor(element);

  const sx = sxString([
    ...baseLayoutEntries(element, parent),
    ["fontSize", element.fontSize ? toPxLiteral(element.fontSize) : undefined],
    ["fontWeight", element.fontWeight ? Math.round(element.fontWeight) : undefined],
    ["lineHeight", element.lineHeight ? toPxLiteral(element.lineHeight) : undefined],
    ["color", buttonTextColor ? literal(buttonTextColor) : undefined],
    ["textTransform", literal("none")],
    ["justifyContent", literal("center")]
  ]);

  const variant = element.fillColor ? "contained" : "text";

  return `${indent}<Button variant="${variant}" disableElevation sx={{ ${sx} }}>{${literal(label)}}</Button>`;
};

const renderContainer = (
  element: ScreenElementIR,
  depth: number,
  parent: VirtualParent,
  context: RenderContext
): string | null => {
  const indent = "  ".repeat(depth);
  if (isLikelyAccordionContainer(element)) {
    return renderSemanticAccordion(element, depth, parent, context);
  }

  if (isLikelyInputContainer(element)) {
    return renderSemanticInput(element, depth, parent, context);
  }

  const iconNode = element.name.toLowerCase().includes("muisvgiconroot");
  if (iconNode) {
    const vectorPaths = collectVectorPaths(element);
    if (vectorPaths.length > 0) {
      const vectorColor = firstVectorColor(element);
      const iconSx = sxString([
        ...baseLayoutEntries(element, parent, { includePaints: false }),
        ["color", vectorColor ? literal(vectorColor) : undefined]
      ]);
      const iconPaths = vectorPaths
        .map((pathData) => `${indent}  <path d={${literal(pathData)}} />`)
        .join("\n");
      return `${indent}<SvgIcon sx={{ ${iconSx} }} viewBox={${literal(`0 0 ${Math.max(1, Math.round(element.width ?? 24))} ${Math.max(1, Math.round(element.height ?? 24))}`)}}>\n${iconPaths}\n${indent}</SvgIcon>`;
    }

    const parentName = parent.name?.toLowerCase() ?? "";
    const iconComponent = parentName.includes("buttonendicon")
      ? registerIconImport(context, {
          localName: "ChevronRightIcon",
          modulePath: "@mui/icons-material/ChevronRight"
        })
      : parentName.includes("expandiconwrapper") ||
          parentName.includes("outlinedinputroot") ||
          parentName.includes("formcontrolroot") ||
          parentName.includes("select")
        ? registerIconImport(context, {
            localName: "ExpandMoreIcon",
            modulePath: "@mui/icons-material/ExpandMore"
          })
        : parentName.includes("accordionsummarycontent")
          ? registerIconImport(context, {
              localName: "TuneIcon",
              modulePath: "@mui/icons-material/Tune"
            })
          : registerIconImport(context, {
              localName: "InfoOutlinedIcon",
              modulePath: "@mui/icons-material/InfoOutlined"
            });

    const iconSx = sxString([
      ...baseLayoutEntries(element, parent, { includePaints: false }),
      ["display", literal("flex")],
      ["alignItems", literal("center")],
      ["justifyContent", literal("center")],
      ["fontSize", toPxLiteral(element.width ? Math.max(12, Math.round(element.width * 0.9)) : 16)],
      ["lineHeight", literal("1")],
      ["color", element.fillColor ? literal(element.fillColor) : undefined]
    ]);
    return `${indent}<${iconComponent} sx={{ ${iconSx} }} fontSize="inherit" />`;
  }

  const children = sortChildren(element.children ?? [], element.layoutMode ?? "NONE");

  const renderedChildren = children
    .map((child) => renderElement(child, depth + 1, {
      x: element.x,
      y: element.y,
      name: element.name,
      layoutMode: element.layoutMode ?? "NONE"
    }, context))
    .filter((chunk): chunk is string => Boolean(chunk && chunk.trim()))
    .join("\n");

  const isDivider = (element.height ?? 0) <= 2 && Boolean(element.fillColor) && !children.length;
  if (isDivider) {
    const sx = sxString([
      ...baseLayoutEntries(element, parent),
      ["borderColor", element.fillColor ? literal(element.fillColor) : undefined]
    ]);
    return `${indent}<Divider sx={{ ${sx} }} />`;
  }

  const sx = sxString(baseLayoutEntries(element, parent));

  if (!renderedChildren.trim()) {
    if (!hasVisualStyle(element)) {
      return null;
    }
    return `${indent}<Box sx={{ ${sx} }} />`;
  }

  return `${indent}<Box sx={{ ${sx} }}>
${renderedChildren}
${indent}</Box>`;
};

const renderElement = (
  element: ScreenElementIR,
  depth: number,
  parent: VirtualParent,
  context: RenderContext
): string | null => {
  const mappedElement = renderMappedElement(element, depth, parent, context);
  if (mappedElement) {
    return mappedElement;
  }

  if (element.nodeType === "VECTOR") {
    return null;
  }

  if (element.type === "text") {
    return renderText(element, depth, parent);
  }

  if (element.type === "button") {
    return renderButton(element, depth, parent);
  }

  return renderContainer(element, depth, parent, context);
};

const fallbackThemeFile = (ir: DesignIR): GeneratedFile => {
  const tokens = ir.tokens;
  return {
    path: "src/theme/theme.ts",
    content: `import { createTheme } from "@mui/material/styles";

export const appTheme = createTheme({
  palette: {
    mode: "light",
    primary: { main: "${tokens.palette.primary}" },
    secondary: { main: "${tokens.palette.secondary}" },
    background: { default: "${tokens.palette.background}", paper: "${tokens.palette.background}" },
    text: { primary: "${tokens.palette.text}" }
  },
  shape: {
    borderRadius: ${Math.max(0, Math.round(tokens.borderRadius))}
  },
  spacing: ${Math.max(1, Math.round(tokens.spacingBase))},
  typography: {
    fontFamily: "${tokens.fontFamily}",
    h1: { fontSize: ${Math.max(1, Math.round(tokens.headingSize))} },
    body1: { fontSize: ${Math.max(1, Math.round(tokens.bodySize))} }
  },
  components: {
    MuiButton: {
      styleOverrides: {
        root: {
          textTransform: "none"
        }
      }
    }
  }
});
`
  };
};

interface FallbackScreenFileResult {
  file: GeneratedFile;
  usedMappingNodeIds: Set<string>;
  mappingWarnings: Array<{
    code: "W_COMPONENT_MAPPING_MISSING" | "W_COMPONENT_MAPPING_CONTRACT_MISMATCH" | "W_COMPONENT_MAPPING_DISABLED";
    nodeId: string;
    message: string;
  }>;
}

const fallbackScreenFile = (screen: ScreenIR, mappingByNodeId: Map<string, ComponentMappingRule>): FallbackScreenFileResult => {
  const componentName = toComponentName(screen.name);
  const filePath = toDeterministicScreenPath(screen.name);

  const simplifiedChildren = simplifyElements(screen.children);
  const minX = simplifiedChildren.length > 0 ? Math.min(...simplifiedChildren.map((element) => element.x ?? 0)) : 0;
  const minY = simplifiedChildren.length > 0 ? Math.min(...simplifiedChildren.map((element) => element.y ?? 0)) : 0;
  const renderContext: RenderContext = {
    fields: [],
    accordions: [],
    iconImports: [],
    mappedImports: [],
    mappingByNodeId,
    usedMappingNodeIds: new Set<string>(),
    mappingWarnings: [],
    emittedWarningKeys: new Set<string>()
  };

  const rendered = simplifiedChildren
    .map((element) =>
      renderElement(element, 3, { x: minX, y: minY, name: screen.name, layoutMode: screen.layoutMode }, renderContext)
    )
    .filter((chunk): chunk is string => Boolean(chunk && chunk.trim()))
    .join("\n");
  const hasSvgIcon = rendered.includes("<SvgIcon");
  const hasInteractiveFields = renderContext.fields.length > 0;
  const hasInteractiveAccordions = renderContext.accordions.length > 0;
  const hasSelectField = renderContext.fields.some((field) => field.isSelect);
  const hasAdornmentField = renderContext.fields.some((field) => !field.isSelect && Boolean(field.suffixText));

  const contentWidth = clamp(
    Math.round(
      simplifiedChildren.reduce((maxWidth, element) => {
        if (typeof element.x === "number" && typeof element.width === "number") {
          return Math.max(maxWidth, element.x - minX + element.width);
        }
        if (typeof element.width !== "number") {
          return maxWidth;
        }
        return Math.max(maxWidth, element.width);
      }, 0)
    ),
    320,
    1680
  );

  const contentHeight = Math.max(
    320,
    Math.round(
      simplifiedChildren.reduce((maxHeight, element) => {
        if (typeof element.y !== "number" || typeof element.height !== "number") {
          return maxHeight;
        }
        return Math.max(maxHeight, element.y - minY + element.height);
      }, 0)
    )
  );

  const responsiveScaleExpression = `min(1, calc((100vw - 32px) / ${contentWidth}))`;
  const responsiveHeightExpression = `calc(${contentHeight}px * ${responsiveScaleExpression})`;
  const initialValues = Object.fromEntries(renderContext.fields.map((field) => [field.key, field.defaultValue]));
  const selectOptionsMap = Object.fromEntries(
    renderContext.fields.filter((field) => field.isSelect).map((field) => [field.key, field.options])
  );
  const initialAccordionState = Object.fromEntries(
    renderContext.accordions.map((accordion) => [accordion.key, accordion.defaultExpanded])
  );
  const selectOptionsDeclaration = hasSelectField
    ? `const selectOptions: Record<string, string[]> = ${JSON.stringify(selectOptionsMap, null, 2)};\n\n`
    : "";

  const fieldStateBlock = hasInteractiveFields
    ? `const [formValues, setFormValues] = useState<Record<string, string>>(${JSON.stringify(initialValues, null, 2)});

${selectOptionsDeclaration}const updateFieldValue = (fieldKey: string, value: string): void => {
  setFormValues((previous) => ({ ...previous, [fieldKey]: value }));
};`
    : "";
  const accordionStateBlock = hasInteractiveAccordions
    ? `const [accordionState, setAccordionState] = useState<Record<string, boolean>>(${JSON.stringify(initialAccordionState, null, 2)});

const updateAccordionState = (accordionKey: string, expanded: boolean): void => {
  setAccordionState((previous) => ({ ...previous, [accordionKey]: expanded }));
};`
    : "";
  const stateBlock = [fieldStateBlock, accordionStateBlock].filter((chunk) => chunk.length > 0).join("\n\n");
  const hasStatefulElements = hasInteractiveFields || hasInteractiveAccordions;

  const reactImport = hasStatefulElements ? 'import { useState } from "react";\n' : "";
  const usesButton = rendered.includes("<Button ");
  const usesDivider = rendered.includes("<Divider ");
  const usesTypography = rendered.includes("<Typography ") || rendered.length === 0;
  const muiImports = ["Box"];
  if (usesButton) {
    muiImports.push("Button");
  }
  if (usesDivider) {
    muiImports.push("Divider");
  }
  if (usesTypography) {
    muiImports.push("Typography");
  }
  if (hasSvgIcon) {
    muiImports.push("SvgIcon");
  }
  if (hasInteractiveFields) {
    muiImports.push("TextField");
  }
  if (hasInteractiveAccordions) {
    muiImports.push("Accordion", "AccordionSummary", "AccordionDetails");
  }
  if (hasSelectField) {
    muiImports.push("MenuItem");
  }
  if (hasAdornmentField) {
    muiImports.push("InputAdornment");
  }
  const uniqueMuiImports = [...new Set(muiImports)];
  const iconImports = renderContext.iconImports
    .map((iconImport) => `import ${iconImport.localName} from "${iconImport.modulePath}";`)
    .join("\n");
  const mappedImports = renderContext.mappedImports
    .map((mappedImport) => `import ${mappedImport.localName} from "${mappedImport.modulePath}";`)
    .join("\n");

  return {
    file: {
      path: filePath,
      content: `${reactImport}import { ${uniqueMuiImports.join(", ")} } from "@mui/material";
${iconImports ? `${iconImports}\n` : ""}${mappedImports ? `${mappedImports}\n` : ""}

export default function ${componentName}Screen(): JSX.Element {
${stateBlock ? `${indentBlock(stateBlock, 2)}\n` : ""}
  return (
    <Box sx={{ minHeight: "100vh", bgcolor: ${literal(screen.fillColor ?? "background.default")}, display: "flex", justifyContent: "center", px: "0px", py: "0px" }}>
      <Box sx={{ width: "100%", display: "flex", justifyContent: "center", px: "16px", boxSizing: "border-box", minHeight: ${literal(responsiveHeightExpression)} }}>
        <Box sx={{ position: "relative", width: ${literal(`${contentWidth}px`)}, minHeight: ${literal(`${contentHeight}px`)}, transform: ${literal(`scale(${responsiveScaleExpression})`)}, transformOrigin: "top center" }}>
${rendered || '        <Typography variant="body1">{"Screen generated from Figma IR"}</Typography>'}
        </Box>
      </Box>
    </Box>
  );
}
`
    },
    usedMappingNodeIds: renderContext.usedMappingNodeIds,
    mappingWarnings: renderContext.mappingWarnings
  };
};

export const toDeterministicScreenPath = (screenName: string): string => {
  return path.posix.join("src", "screens", ensureTsxName(screenName));
};

export const createDeterministicThemeFile = (ir: DesignIR): GeneratedFile => {
  return fallbackThemeFile(ir);
};

export const createDeterministicScreenFile = (screen: ScreenIR): GeneratedFile => {
  return fallbackScreenFile(screen, new Map<string, ComponentMappingRule>()).file;
};

export const createDeterministicAppFile = (screens: ScreenIR[]): GeneratedFile => {
  return {
    path: "src/App.tsx",
    content: makeAppFile(screens)
  };
};

const makeAppFile = (screens: ScreenIR[]): string => {
  const lazyScreens = screens.slice(1);
  const hasLazyRoutes = lazyScreens.length > 0;
  const reactImport = hasLazyRoutes ? 'import { Suspense, lazy } from "react";' : 'import { Suspense } from "react";';

  const eagerImports = screens
    .slice(0, 1)
    .map((screen) => {
      const componentName = toComponentName(screen.name);
      const fileName = ensureTsxName(screen.name).replace(/\.tsx$/i, "");
      return `import ${componentName}Screen from "./screens/${fileName}";`;
    })
    .join("\n");

  const lazyImports = lazyScreens
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

  return `${reactImport}
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

const writeGeneratedFile = async (rootDir: string, file: GeneratedFile): Promise<void> => {
  const absolutePath = path.resolve(rootDir, file.path);
  if (!absolutePath.startsWith(path.resolve(rootDir) + path.sep)) {
    throw new Error(`LLM attempted path traversal: ${file.path}`);
  }
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, file.content, "utf-8");
};

interface ScreenInteractivityExpectation {
  inputCount: number;
  selectCount: number;
  accordionCount: number;
}

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

const normalizeSemanticText = (rawValue: string): string => {
  return rawValue
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9äöüß€%]+/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
};

const isLikelySemanticLabel = (text: string): boolean => {
  const trimmed = text.trim();
  if (trimmed.length < 2 || trimmed.length > 56) {
    return false;
  }
  if (!/[A-Za-zÄÖÜäöüß]/.test(trimmed)) {
    return false;
  }
  if (/^\d+(?:[.,]\d+)*(?:\s?(?:€|%|p\.a\.))?$/i.test(trimmed)) {
    return false;
  }
  if (trimmed.split(/\s+/).length > 7) {
    return false;
  }
  return true;
};

const collectSemanticLabelCandidates = (screen: ScreenIR): string[] => {
  const orderedTextNodes = flattenElements(screen.children)
    .filter((node) => node.type === "text" && typeof node.text === "string" && isLikelySemanticLabel(node.text))
    .map((node) => ({
      label: normalizeSemanticText(node.text ?? ""),
      y: node.y ?? Number.MAX_SAFE_INTEGER,
      x: node.x ?? Number.MAX_SAFE_INTEGER
    }))
    .filter((entry) => entry.label.length > 0)
    .sort((left, right) => {
      if (left.y !== right.y) {
        return left.y - right.y;
      }
      return left.x - right.x;
    });

  const uniqueLabels: string[] = [];
  for (const entry of orderedTextNodes) {
    if (uniqueLabels.includes(entry.label)) {
      continue;
    }
    uniqueLabels.push(entry.label);
    if (uniqueLabels.length >= 24) {
      break;
    }
  }

  return uniqueLabels;
};

const collectLiteralLabelCandidates = (screen: ScreenIR): string[] => {
  const orderedTextNodes = flattenElements(screen.children)
    .filter((node) => node.type === "text" && typeof node.text === "string" && isLikelySemanticLabel(node.text))
    .map((node) => ({
      label: node.text?.trim() ?? "",
      y: node.y ?? Number.MAX_SAFE_INTEGER,
      x: node.x ?? Number.MAX_SAFE_INTEGER
    }))
    .filter((entry) => entry.label.length > 0)
    .sort((left, right) => {
      if (left.y !== right.y) {
        return left.y - right.y;
      }
      return left.x - right.x;
    });

  const uniqueLabels: string[] = [];
  for (const entry of orderedTextNodes) {
    if (uniqueLabels.includes(entry.label)) {
      continue;
    }
    uniqueLabels.push(entry.label);
    if (uniqueLabels.length >= 24) {
      break;
    }
  }

  return uniqueLabels;
};

const collectPlaceholderMatches = (content: string): string[] => {
  const uniqueMatches = new Set<string>();
  for (const pattern of PLACEHOLDER_TEXT_PATTERNS) {
    const globalPattern = new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`);
    let match: RegExpExecArray | null;
    match = globalPattern.exec(content);
    while (match) {
      const normalized = normalizeSemanticText(match[0]);
      if (normalized.length > 0) {
        uniqueMatches.add(normalized);
      }
      match = globalPattern.exec(content);
    }
  }
  return Array.from(uniqueMatches);
};

const resolveLabelCoverageThreshold = (expectedCount: number): number => {
  if (expectedCount <= 4) {
    return 0.85;
  }
  if (expectedCount <= 8) {
    return 0.75;
  }
  if (expectedCount <= 16) {
    return 0.65;
  }
  return 0.55;
};

const collectSelectOptionLiterals = (source: string): string[] => {
  const unique = new Set<string>();
  const selectOptionsMatch = source.match(/const\s+selectOptions\s*:\s*Record<string,\s*string\[]>\s*=\s*({[\s\S]*?});/);
  if (selectOptionsMatch?.[1]) {
    try {
      const parsed = JSON.parse(selectOptionsMatch[1]) as Record<string, unknown>;
      for (const value of Object.values(parsed)) {
        if (!Array.isArray(value)) {
          continue;
        }
        for (const entry of value) {
          if (typeof entry !== "string") {
            continue;
          }
          const trimmed = entry.trim();
          if (trimmed.length > 0) {
            unique.add(trimmed);
          }
        }
      }
    } catch {
      // Ignore parse failures and continue with fallback extraction.
    }
  }

  const menuItemRegex = /<MenuItem[^>]*>\s*([^<\n][^<]*?)\s*<\/MenuItem>/g;
  let menuItemMatch = menuItemRegex.exec(source);
  while (menuItemMatch) {
    const capturedValue = menuItemMatch[1];
    if (!capturedValue) {
      menuItemMatch = menuItemRegex.exec(source);
      continue;
    }
    const value = capturedValue.trim();
    if (value.length > 0 && !value.includes("{")) {
      unique.add(value);
    }
    menuItemMatch = menuItemRegex.exec(source);
  }

  return Array.from(unique).slice(0, 24);
};

const validateSemanticFidelity = ({
  screen,
  generatedContent,
  baselineContent,
  requiredLabelSet
}: {
  screen: ScreenIR;
  generatedContent: string;
  baselineContent: string;
  requiredLabelSet?: string[];
}): { isValid: boolean; reason?: string } => {
  const expectedLabels = collectSemanticLabelCandidates(screen);
  const requiredLabels = (requiredLabelSet ?? [])
    .map((value) => normalizeSemanticText(value))
    .filter((value) => value.length > 0 && !expectedLabels.includes(value));
  const requiredFirstLabels = [...requiredLabels, ...expectedLabels];
  const uniqueExpectedLabels = requiredFirstLabels.filter((value, index) => requiredFirstLabels.indexOf(value) === index);
  if (uniqueExpectedLabels.length === 0) {
    return { isValid: true };
  }

  const normalizedGeneratedContent = normalizeSemanticText(generatedContent);
  const matchedLabels = uniqueExpectedLabels.filter((label) => normalizedGeneratedContent.includes(label));
  const coverage = matchedLabels.length / uniqueExpectedLabels.length;
  const coverageThreshold = resolveLabelCoverageThreshold(uniqueExpectedLabels.length);

  if (coverage < coverageThreshold) {
    const missingLabels = uniqueExpectedLabels.filter((label) => !matchedLabels.includes(label)).slice(0, 6);
    return {
      isValid: false,
      reason: `label fidelity too low (${Math.round(coverage * 100)}% < ${Math.round(
        coverageThreshold * 100
      )}%), missing: ${missingLabels.join(", ")}`
    };
  }

  const baselinePlaceholders = new Set(collectPlaceholderMatches(baselineContent));
  const candidatePlaceholders = collectPlaceholderMatches(generatedContent);
  const introducedPlaceholders = candidatePlaceholders.filter((value) => !baselinePlaceholders.has(value));
  if (introducedPlaceholders.length > 0) {
    return {
      isValid: false,
      reason: `generic placeholders introduced (${introducedPlaceholders.slice(0, 3).join(", ")}) although semantic labels are available`
    };
  }

  return { isValid: true };
};

const validateSelectLiteralFidelity = ({
  generatedContent,
  baselineContent,
  expectation
}: {
  generatedContent: string;
  baselineContent: string;
  expectation: ScreenInteractivityExpectation;
}): { isValid: boolean; reason?: string } => {
  if (expectation.selectCount <= 0) {
    return { isValid: true };
  }

  const baselineSelectLiterals = collectSelectOptionLiterals(baselineContent);
  if (baselineSelectLiterals.length === 0) {
    return { isValid: true };
  }

  const normalizedGeneratedContent = normalizeSemanticText(generatedContent);
  const normalizedBaselineLiterals = baselineSelectLiterals.map((value) => normalizeSemanticText(value)).filter((value) => value.length > 0);
  if (normalizedBaselineLiterals.length === 0) {
    return { isValid: true };
  }

  const matchedCount = normalizedBaselineLiterals.filter((value) => normalizedGeneratedContent.includes(value)).length;
  const minMatchCount =
    normalizedBaselineLiterals.length <= 3
      ? normalizedBaselineLiterals.length
      : Math.max(2, Math.ceil(normalizedBaselineLiterals.length * 0.66));
  if (matchedCount < minMatchCount) {
    const missingPreview = baselineSelectLiterals
      .filter((value) => {
        const normalized = normalizeSemanticText(value);
        return normalized.length > 0 && !normalizedGeneratedContent.includes(normalized);
      })
      .slice(0, 4);
    return {
      isValid: false,
      reason: `missing select options from deterministic baseline: ${missingPreview.join(", ")}`
    };
  }

  return { isValid: true };
};

const inferScreenInteractivityExpectation = (screen: ScreenIR): ScreenInteractivityExpectation => {
  const nodes = flattenElements(screen.children);
  const names = nodes.map((node) => node.name.toLowerCase());

  const selectCount = names.filter((name) => name.includes("muiselectselect")).length;
  const inputCount = names.filter((name) => INPUT_NAME_HINTS.some((pattern) => name.includes(pattern))).length;
  const accordionCount = names.filter((name) => name.includes("accordionsummarycontent") || name.includes("collapsewrapper"))
    .length;

  return {
    inputCount,
    selectCount,
    accordionCount
  };
};

const validateLlmScreenByExpectation = (
  file: GeneratedFile,
  expectedPath: string,
  expectation: ScreenInteractivityExpectation,
  screen: ScreenIR,
  baselineContent: string,
  typeScriptRuntime: TypeScriptRuntime,
  requiredLabelSet?: string[]
): { isValid: boolean; reason?: string } => {
  const normalizedExpectedPath = path.posix.normalize(expectedPath.replace(/\\/g, "/"));

  if (normalizedExpectedPath.startsWith("/") || normalizedExpectedPath.includes("..")) {
    return { isValid: false, reason: `unsafe screen path '${expectedPath}'` };
  }

  const content = file.content;
  if (!content.includes("export default") || !content.includes("@mui")) {
    return { isValid: false, reason: "missing export/@mui imports" };
  }
  if (!/@mui\/material/.test(content)) {
    return { isValid: false, reason: "missing @mui/material import usage" };
  }

  const screenDiagnostics = typeScriptRuntime.transpileModule(content, {
    compilerOptions: {
      module: typeScriptRuntime.ModuleKind.ESNext,
      target: typeScriptRuntime.ScriptTarget.ES2022,
      jsx: typeScriptRuntime.JsxEmit.ReactJSX
    },
    fileName: file.path,
    reportDiagnostics: true
  }).diagnostics;
  if (screenDiagnostics && screenDiagnostics.length > 0) {
    const firstDiagnostic = screenDiagnostics[0];
    return {
      isValid: false,
      reason: firstDiagnostic
        ? typeScriptRuntime.flattenDiagnosticMessageText(firstDiagnostic.messageText, "\n")
        : "TypeScript diagnostics reported an unknown issue"
    };
  }

  const hasInputLikeControl =
    /\b(TextField|InputBase|OutlinedInput|FilledInput|Input|TextareaAutosize|Checkbox|Switch|RadioGroup|Radio|Slider|Autocomplete|Select|NativeSelect)\b/.test(
      content
    );
  const hasSelectControl =
    /\b(Select|NativeSelect)\b/.test(content) || /<TextField[\s\S]{0,220}?\bselect\b/.test(content);
  const hasAccordion = /\bAccordionSummary\b/.test(content) || /\bAccordionDetails\b/.test(content);
  const hasHandlerBinding = /\b(onChange|onInput|onClick|onBlur)\s*=\s*\{/.test(content);
  const hasDefaultBinding = /\bdefault(Value|Checked|Open)\s*=/.test(content);
  const hasControlledBinding = /\b(value|checked|open)\s*=\s*\{[^}]+\}/.test(content);
  const hasReadOnlyPattern = hasControlledBinding && !hasHandlerBinding && !hasDefaultBinding;

  if (expectation.inputCount > 0 && !hasInputLikeControl) {
    return { isValid: false, reason: "missing MUI form controls for detected input nodes" };
  }
  if (expectation.inputCount > 0 && hasReadOnlyPattern) {
    return { isValid: false, reason: "read-only value/checked/open bindings detected for form controls" };
  }
  if (expectation.selectCount > 0 && !hasSelectControl) {
    return { isValid: false, reason: "missing select-like MUI control for detected select nodes" };
  }
  if (expectation.accordionCount > 0 && !hasAccordion) {
    return { isValid: false, reason: "missing Accordion primitives for detected accordion nodes" };
  }

  const selectLiteralValidation = validateSelectLiteralFidelity({
    generatedContent: content,
    baselineContent,
    expectation
  });
  if (!selectLiteralValidation.isValid) {
    return selectLiteralValidation;
  }

  const fidelityValidation = validateSemanticFidelity({
    screen,
    generatedContent: content,
    baselineContent,
    ...(requiredLabelSet ? { requiredLabelSet } : {})
  });
  if (!fidelityValidation.isValid) {
    return fidelityValidation;
  }

  return { isValid: true };
};

const isWeakLlmForCodegen = (modelName: string): boolean => {
  const normalized = modelName.toLowerCase();
  return normalized.includes("qwen2.5-0.5b-instruct-4bit");
};

const getObjectPropertyName = ({
  propertyName,
  typeScriptRuntime
}: {
  propertyName: ts.PropertyName;
  typeScriptRuntime: TypeScriptRuntime;
}): string | undefined => {
  if (
    typeScriptRuntime.isIdentifier(propertyName) ||
    typeScriptRuntime.isStringLiteral(propertyName) ||
    typeScriptRuntime.isNumericLiteral(propertyName)
  ) {
    return propertyName.text;
  }
  return undefined;
};

const hasTopLevelBorderRadiusInCreateTheme = ({
  source,
  typeScriptRuntime
}: {
  source: ts.SourceFile;
  typeScriptRuntime: TypeScriptRuntime;
}): boolean => {
  let detected = false;

  const visit = (node: ts.Node): void => {
    if (detected) {
      return;
    }

    if (
      typeScriptRuntime.isCallExpression(node) &&
      typeScriptRuntime.isIdentifier(node.expression) &&
      node.expression.text === "createTheme"
    ) {
      const firstArgument = node.arguments[0];
      if (firstArgument && typeScriptRuntime.isObjectLiteralExpression(firstArgument)) {
        for (const property of firstArgument.properties) {
          if (!typeScriptRuntime.isPropertyAssignment(property) && !typeScriptRuntime.isShorthandPropertyAssignment(property)) {
            continue;
          }
          const propertyName = getObjectPropertyName({
            propertyName: property.name,
            typeScriptRuntime
          });
          if (propertyName === "borderRadius") {
            detected = true;
            return;
          }
        }
      }
    }

    typeScriptRuntime.forEachChild(node, visit);
  };

  visit(source);
  return detected;
};

const normalizeThemeCandidateContent = (content: string): string => {
  if (/export\s+const\s+appTheme\b/.test(content)) {
    return content;
  }

  let normalized = content;

  normalized = normalized.replace(
    /export\s+default\s+createTheme\s*\(/,
    "export const appTheme = createTheme("
  );
  if (/export\s+const\s+appTheme\b/.test(normalized)) {
    return normalized;
  }

  const themedVarMatch = normalized.match(/\bconst\s+([A-Za-z_$][\w$]*)\s*=\s*createTheme\s*\(/);
  if (themedVarMatch?.[1]) {
    const varName = themedVarMatch[1];
    const defaultVarExportPattern = new RegExp(`export\\s+default\\s+${varName}\\s*;?`);
    if (defaultVarExportPattern.test(normalized)) {
      normalized = normalized.replace(defaultVarExportPattern, `export const appTheme = ${varName};`);
    }
  }

  return normalized;
};

const validateLlmThemeCandidate = ({
  file,
  expectedPath,
  typeScriptRuntime
}: {
  file: GeneratedFile;
  expectedPath: string;
  typeScriptRuntime: TypeScriptRuntime;
}): { isValid: boolean; reason?: string } => {
  const normalizedExpectedPath = path.posix.normalize(expectedPath.replace(/\\/g, "/"));

  if (normalizedExpectedPath.startsWith("/") || normalizedExpectedPath.includes("..")) {
    return { isValid: false, reason: `unsafe theme path '${expectedPath}'` };
  }

  const content = file.content;
  const hasNamedThemeExport = /export\s+const\s+appTheme\b/.test(content);
  if (!hasNamedThemeExport) {
    return { isValid: false, reason: "missing named export 'appTheme'" };
  }
  if (!/\bcreateTheme\s*\(/.test(content)) {
    return { isValid: false, reason: "missing createTheme() call" };
  }
  if (!/from\s+["']@mui\/material\/styles["']/.test(content)) {
    return { isValid: false, reason: "missing createTheme import from @mui/material/styles" };
  }
  if (/from\s+["']\.\.?\//.test(content)) {
    return { isValid: false, reason: "relative imports are not allowed in theme.ts" };
  }

  const syntaxDiagnostics = typeScriptRuntime.transpileModule(content, {
    compilerOptions: {
      module: typeScriptRuntime.ModuleKind.ESNext,
      target: typeScriptRuntime.ScriptTarget.ES2022
    },
    fileName: file.path,
    reportDiagnostics: true
  }).diagnostics;
  if (syntaxDiagnostics && syntaxDiagnostics.length > 0) {
    const firstDiagnostic = syntaxDiagnostics[0];
    return {
      isValid: false,
      reason: firstDiagnostic
        ? typeScriptRuntime.flattenDiagnosticMessageText(firstDiagnostic.messageText, "\n")
        : "TypeScript diagnostics reported an unknown issue"
    };
  }
  const source = typeScriptRuntime.createSourceFile(
    file.path,
    content,
    typeScriptRuntime.ScriptTarget.ESNext,
    true,
    typeScriptRuntime.ScriptKind.TS
  );

  if (hasTopLevelBorderRadiusInCreateTheme({ source, typeScriptRuntime })) {
    return { isValid: false, reason: "top-level borderRadius is invalid; use shape.borderRadius" };
  }

  return { isValid: true };
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
  const requestedMode = String(llmCodegenMode);
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
  const prioritizedMappings = [...(componentMappings ?? [])]
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
  const mappingWarnings: Array<{
    code: "W_COMPONENT_MAPPING_MISSING" | "W_COMPONENT_MAPPING_CONTRACT_MISMATCH" | "W_COMPONENT_MAPPING_DISABLED";
    message: string;
  }> = [];
  for (const [nodeId] of mappingByNodeId.entries()) {
    if (!allIrNodeIds.has(nodeId)) {
      mappingWarnings.push({
        code: "W_COMPONENT_MAPPING_MISSING",
        message: `Mapping for node '${nodeId}' has no matching node in current IR`
      });
    }
  }

  await mkdir(path.join(projectDir, "src", "screens"), { recursive: true });
  await mkdir(path.join(projectDir, "src", "theme"), { recursive: true });

  const tokensPath = path.join(projectDir, "src", "theme", "tokens.json");
  await writeFile(tokensPath, JSON.stringify(ir.tokens, null, 2), "utf-8");
  generatedPaths.add("src/theme/tokens.json");

  const deterministicTheme = fallbackThemeFile(ir);
  await writeGeneratedFile(projectDir, deterministicTheme);
  generatedPaths.add(deterministicTheme.path);

  const usedMappingNodeIds = new Set<string>();
  const deterministicScreens = ir.screens.map((screen) => {
    const deterministicScreen = fallbackScreenFile(screen, mappingByNodeId);
    for (const nodeId of deterministicScreen.usedMappingNodeIds.values()) {
      usedMappingNodeIds.add(nodeId);
    }
    for (const warning of deterministicScreen.mappingWarnings) {
      mappingWarnings.push({
        code: warning.code,
        message: warning.message
      });
    }

    const file = deterministicScreen.file;
    return {
      screen,
      file,
      requiredLiteralTexts: [
        ...collectLiteralLabelCandidates(screen),
        ...collectSelectOptionLiterals(file.content)
      ].filter((value, index, values) => value.trim().length > 0 && values.indexOf(value) === index)
    };
  });
  for (const item of deterministicScreens) {
    await writeGeneratedFile(projectDir, item.file);
    generatedPaths.add(item.file.path);
  }

  for (const [nodeId, mapping] of mappingByNodeId.entries()) {
    if (!allIrNodeIds.has(nodeId)) {
      continue;
    }
    if (!mapping.enabled) {
      mappingWarnings.push({
        code: "W_COMPONENT_MAPPING_DISABLED",
        message: `Component mapping disabled for node '${nodeId}', deterministic fallback used`
      });
      continue;
    }
    if (!mapping.componentName.trim() || !mapping.importPath.trim()) {
      mappingWarnings.push({
        code: "W_COMPONENT_MAPPING_CONTRACT_MISMATCH",
        message: `Component mapping for node '${nodeId}' is missing componentName/importPath, deterministic fallback used`
      });
      continue;
    }
    if (mapping.propContract !== undefined && !isPlainRecord(mapping.propContract)) {
      mappingWarnings.push({
        code: "W_COMPONENT_MAPPING_CONTRACT_MISMATCH",
        message: `Component mapping contract for node '${nodeId}' is not an object, deterministic fallback used`
      });
      continue;
    }
    if (!usedMappingNodeIds.has(nodeId)) {
      mappingWarnings.push({
        code: "W_COMPONENT_MAPPING_MISSING",
        message: `Component mapping for node '${nodeId}' was not applied; deterministic fallback used`
      });
    }
  }

  await writeFile(path.join(projectDir, "src", "App.tsx"), makeAppFile(ir.screens), "utf-8");
  generatedPaths.add("src/App.tsx");
  onLog("Generated deterministic baseline artifacts");

  let themeApplied = false;
  let screenApplied = 0;
  const screenRejected: RejectedScreenEnhancement[] = [];
  const llmWarnings: Array<{
    code: "W_LLM_RESPONSES_INCOMPLETE";
    message: string;
  }> = [];
  const screenTotal = deterministicScreens.length;

  const pushLlmIncompleteWarning = (message: string): void => {
    if (llmWarnings.some((warning) => warning.message === message)) {
      return;
    }
    llmWarnings.push({
      code: "W_LLM_RESPONSES_INCOMPLETE",
      message
    });
  };

  const strictLlmMode = requestedMode === "llm_strict";
  const deterministicMode = requestedMode === "deterministic";
  const mappingCoverage = {
    usedMappings: usedMappingNodeIds.size,
    fallbackNodes: Math.max(0, mappingByNodeId.size - usedMappingNodeIds.size),
    totalCandidateNodes: mappingByNodeId.size
  };
  const dedupedMappingWarnings = dedupeMappingWarnings(mappingWarnings);
  const mappingDiagnostics = {
    missingMappingCount: dedupedMappingWarnings.filter((warning) => warning.code === "W_COMPONENT_MAPPING_MISSING").length,
    contractMismatchCount: dedupedMappingWarnings.filter((warning) => warning.code === "W_COMPONENT_MAPPING_CONTRACT_MISMATCH").length,
    disabledMappingCount: dedupedMappingWarnings.filter((warning) => warning.code === "W_COMPONENT_MAPPING_DISABLED").length
  };
  if (deterministicMode) {
    onLog("LLM enhancement disabled in deterministic mode; deterministic output retained");
    return {
      generatedPaths: Array.from(generatedPaths),
      themeApplied,
      screenApplied,
      screenTotal,
      screenRejected,
      llmWarnings,
      mappingCoverage,
      mappingDiagnostics,
      mappingWarnings: dedupedMappingWarnings
    };
  }

  if (!llmClient) {
    throw new Error("LLM client is required for hybrid and llm_strict modes");
  }

  const skipLlmEnhancement = requestedMode === "hybrid" && isWeakLlmForCodegen(llmModelName);
  if (skipLlmEnhancement) {
    onLog(
      `LLM enhancement skipped for model '${llmModelName}' in hybrid mode; deterministic output retained`
    );
    return {
      generatedPaths: Array.from(generatedPaths),
      themeApplied,
      screenApplied,
      screenTotal,
      screenRejected,
      llmWarnings,
      mappingCoverage,
      mappingDiagnostics,
      mappingWarnings: dedupedMappingWarnings
    };
  }

  let typeScriptRuntime: TypeScriptRuntime;
  try {
    typeScriptRuntime = await import("typescript");
  } catch (error) {
    throw new WorkflowError({
      code: "E_LLM_RUNTIME_UNAVAILABLE",
      stage: "codegen.generate",
      retryable: false,
      message: `TypeScript runtime unavailable for non-deterministic mode: ${error instanceof Error ? error.message : "unknown error"}`
    });
  }

  try {
    onLog("Running optional LLM theme enhancement");
    const llmTheme = await llmClient.generateTheme(ir);
    const normalizedThemeContent = normalizeThemeCandidateContent(llmTheme.content);
    const themeValidation = validateLlmThemeCandidate({
      file: {
        path: llmTheme.path,
        content: normalizedThemeContent
      },
      expectedPath: deterministicTheme.path,
      typeScriptRuntime
    });
    if (!themeValidation.isValid) {
      const message = strictLlmMode
        ? `LLM theme enhancement rejected by strict contract: ${
            themeValidation.reason ?? "contract validation failed"
          }; deterministic output retained`
        : `LLM theme enhancement skipped: ${
            themeValidation.reason ?? "contract validation failed"
          }; deterministic output retained`;
      onLog(message);
    } else {
      await writeGeneratedFile(projectDir, {
        path: deterministicTheme.path,
        content: normalizedThemeContent
      });
      themeApplied = true;
      onLog("LLM theme enhancement applied");
    }
  } catch (error) {
    if (isEgressPolicyDenyError(error)) {
      throw new WorkflowError({
        code: "E_EGRESS_POLICY_DENY",
        stage: "codegen.generate",
        retryable: false,
        message: error instanceof Error ? error.message : "Egress policy denied outbound request"
      });
    }
    const llmIncomplete = isLlmClientError(error) && error.code === "E_LLM_RESPONSES_INCOMPLETE";
    if (llmIncomplete) {
      const incompleteMessage = `LLM responses incomplete during theme enhancement; deterministic theme retained`;
      if (strictLlmMode) {
        throw new WorkflowError({
          code: "E_LLM_RESPONSES_INCOMPLETE",
          stage: "codegen.generate",
          retryable: false,
          message: `${incompleteMessage} (${error.message})`
        });
      }
      pushLlmIncompleteWarning(incompleteMessage);
    }
    const message = strictLlmMode
      ? `LLM theme enhancement rejected by strict execution error: ${
          error instanceof Error ? error.message : "unknown error"
        }; deterministic output retained`
      : `LLM theme enhancement skipped: ${error instanceof Error ? error.message : "unknown error"}; deterministic output retained`;
    onLog(message);
  }

  for (const { screen, file: deterministicScreen, requiredLiteralTexts } of deterministicScreens) {
    const interactivityExpectation = inferScreenInteractivityExpectation(screen);
    const totalAttempts = 3;
    let lastFailureReason = "contract validation failed";
    let screenAppliedInAttempt = false;

    onLog(`Running optional LLM screen enhancement: ${screen.name}`);

    for (let attempt = 1; attempt <= totalAttempts; attempt += 1) {
      try {
        const llmFile =
          attempt < totalAttempts
            ? await llmClient.generateScreen(screen, ir.tokens, deterministicScreen.path, {
                ...interactivityExpectation,
                ...(attempt === 1 ? {} : { repairReason: lastFailureReason }),
                requiredLabelSet: requiredLiteralTexts
              })
            : await llmClient.generateScreenFromBaseline({
                screen,
                tokens: ir.tokens,
                expectedPath: deterministicScreen.path,
                baselineSource: deterministicScreen.content,
                requiredLiteralTexts,
                forbiddenPlaceholderPolicy:
                  "Never introduce generic placeholders that do not already exist in baseline content.",
                hints: {
                  ...interactivityExpectation,
                  repairReason: lastFailureReason,
                  requiredLabelSet: requiredLiteralTexts
                }
              });

        const validation = validateLlmScreenByExpectation(
          llmFile,
          deterministicScreen.path,
          interactivityExpectation,
          screen,
          deterministicScreen.content,
          typeScriptRuntime,
          requiredLiteralTexts
        );

        if (validation.isValid) {
          await writeGeneratedFile(projectDir, { path: deterministicScreen.path, content: llmFile.content });
          screenApplied += 1;
          screenAppliedInAttempt = true;
          onLog(`LLM screen enhancement applied (${screen.name}) [attempt ${attempt}/${totalAttempts}]`);
          break;
        }

        lastFailureReason = validation.reason ?? "contract validation failed";
        if (attempt < totalAttempts) {
          onLog(
            `LLM screen enhancement retry (${screen.name}) [attempt ${attempt + 1}/${totalAttempts}]: ${lastFailureReason}`
          );
        }
      } catch (error) {
        if (isEgressPolicyDenyError(error)) {
          throw new WorkflowError({
            code: "E_EGRESS_POLICY_DENY",
            stage: "codegen.generate",
            retryable: false,
            message: error instanceof Error ? error.message : "Egress policy denied outbound request"
          });
        }
        lastFailureReason = error instanceof Error ? error.message : "unknown error";
        const llmIncomplete = isLlmClientError(error) && error.code === "E_LLM_RESPONSES_INCOMPLETE";
        if (llmIncomplete) {
          const incompleteMessage = `LLM responses incomplete during screen enhancement (${screen.name}); deterministic screen retained`;
          if (strictLlmMode) {
            throw new WorkflowError({
              code: "E_LLM_RESPONSES_INCOMPLETE",
              stage: "codegen.generate",
              retryable: false,
              message: `${incompleteMessage} (${lastFailureReason})`
            });
          }
          pushLlmIncompleteWarning(incompleteMessage);
        }
        if (attempt < totalAttempts) {
          onLog(
            `LLM screen enhancement retry (${screen.name}) [attempt ${attempt + 1}/${totalAttempts}]: ${lastFailureReason}`
          );
        }
      }
    }

    if (!screenAppliedInAttempt) {
      screenRejected.push({
        screenName: screen.name,
        reason: lastFailureReason
      });
      if (lastFailureReason.includes("E_LLM_RESPONSES_INCOMPLETE")) {
        pushLlmIncompleteWarning(
          `LLM responses incomplete during screen enhancement (${screen.name}); deterministic screen retained`
        );
      }
      const message = strictLlmMode
        ? `LLM screen enhancement rejected by strict contract (${screen.name}) [attempt ${totalAttempts}/${totalAttempts}]: ${lastFailureReason}; deterministic output retained`
        : `LLM screen enhancement skipped (${screen.name}) [attempt ${totalAttempts}/${totalAttempts}]: ${lastFailureReason}; deterministic output retained`;
      onLog(message);
    }
  }
  onLog(`LLM enhancement summary: themeApplied=${String(themeApplied)}, screensApplied=${screenApplied}/${screenTotal}`);
  return {
    generatedPaths: Array.from(generatedPaths),
    themeApplied,
    screenApplied,
    screenTotal,
    screenRejected,
    llmWarnings,
    mappingCoverage,
    mappingDiagnostics,
    mappingWarnings: dedupedMappingWarnings
  };
};
