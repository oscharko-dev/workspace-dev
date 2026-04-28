import type { GeneratedFile, ScreenElementIR, ScreenIR } from "./types.js";
import { isTextElement } from "./types.js";
import type {
  DefaultLayoutNode,
  DefaultLayoutWarning,
} from "./default-layout-solver.js";
import { solveDefaultScreenLayout } from "./default-layout-solver.js";

export const DEFAULT_LAYOUT_REPORT_PATH = "src/generated/layout-report.json";
export const DEFAULT_SEMANTIC_COMPONENT_REPORT_PATH =
  "src/generated/semantic-component-report.json";

const SEMANTIC_COMPONENT_REPORT_SCHEMA_VERSION = "1.0.0";

export type DefaultSemanticComponentDiagnosticCode =
  | "W_SEMANTIC_COMPONENT_STRUCTURAL_FALLBACK"
  | "W_SEMANTIC_COMPONENT_NOT_REUSABLE";

export interface DefaultSemanticComponentDiagnostic {
  code: DefaultSemanticComponentDiagnosticCode;
  nodeId: string;
  nodeName: string;
  message: string;
}

export interface DefaultSemanticComponentSummary {
  componentName: string;
  filePath: string;
  kind: string;
  instanceNodeIds: string[];
  propNames: string[];
}

export interface DefaultTailwindScreenFile {
  file: GeneratedFile;
  componentFiles: GeneratedFile[];
  layout: DefaultLayoutNode;
  warnings: DefaultLayoutWarning[];
  semanticComponents: DefaultSemanticComponentSummary[];
  semanticDiagnostics: DefaultSemanticComponentDiagnostic[];
}

const sanitizeComponentName = (name: string): string => {
  const words = name
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, " ")
    .split(/[\s_-]+/)
    .filter(Boolean);
  const componentName = words
    .map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1)}`)
    .join("");
  return /^[A-Z]/.test(componentName) ? componentName : `Screen${componentName || "Generated"}`;
};

const sanitizePropName = (name: string, fallback: string): string => {
  const words = name
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, " ")
    .split(/[\s_-]+/)
    .filter(Boolean);
  const [first, ...rest] = words;
  const propName = first
    ? `${first.charAt(0).toLowerCase()}${first.slice(1)}${rest
        .map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1)}`)
        .join("")}`
    : fallback;
  const normalized = propName.replace(/^[^a-zA-Z_$]+/g, "");
  const candidate = normalized || fallback;
  return /^(className|default|function|return|type|interface|props)$/.test(candidate)
    ? `${candidate}Text`
    : candidate;
};

const sanitizeFileName = (name: string): string => {
  const normalized = name
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, " ")
    .trim()
    .replace(/[\s_-]+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
  return normalized || "generated-screen";
};

const escapeText = (value: string): string => JSON.stringify(value);

const escapeAttribute = (value: string): string =>
  value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

const normalizeSemanticText = (value: string | undefined): string =>
  (value ?? "")
    .normalize("NFKD")
    .replace(/[_./:-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

const humanizeLabel = (element: ScreenElementIR | undefined, fallback: string): string => {
  const raw = element ? firstText(element) ?? element.semanticName ?? element.name : undefined;
  const label = raw
    ?.replace(/[_./:-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return label ? `${label.charAt(0).toUpperCase()}${label.slice(1)}` : fallback;
};

const firstText = (element: ScreenElementIR): string | undefined => {
  if (isTextElement(element) && element.text.trim()) {
    return element.text.trim();
  }
  for (const child of element.children ?? []) {
    const text = firstText(child);
    if (text) {
      return text;
    }
  }
  return undefined;
};

const collectElementsById = (screen: ScreenIR): Map<string, ScreenElementIR> => {
  const byId = new Map<string, ScreenElementIR>();
  const visit = (element: ScreenElementIR): void => {
    byId.set(element.id, element);
    for (const child of element.children ?? []) {
      visit(child);
    }
  };
  for (const child of screen.children) {
    visit(child);
  }
  return byId;
};

const indent = (depth: number): string => "  ".repeat(depth);

const semanticKindFor = (element: ScreenElementIR | undefined): string => {
  if (!element) {
    return "section";
  }
  const semantic = normalizeSemanticText(
    [element.semanticType, element.semanticName, element.name].filter(Boolean).join(" "),
  );
  if (/\b(button|cta|call to action)\b/.test(semantic)) {
    return "button";
  }
  if (/\b(card|tile|panel)\b/.test(semantic)) {
    return "card";
  }
  if (/\b(input|textfield|text field|field|date picker|select|dropdown)\b/.test(semantic)) {
    return element.type === "select" || /\b(select|dropdown)\b/.test(semantic) ? "select" : "input";
  }
  if (element.type === "navigation" || /\b(nav|navigation|menu)\b/.test(semantic)) {
    return "navigation";
  }
  if (/\b(header|banner|hero|app bar|top bar)\b/.test(semantic) || element.type === "appbar") {
    return "header";
  }
  if (/\b(footer|contentinfo)\b/.test(semantic)) {
    return "footer";
  }
  if (/\b(form)\b/.test(semantic)) {
    return "form";
  }
  if (/\b(main|content)\b/.test(semantic)) {
    return "main";
  }
  if (/\b(list|feed)\b/.test(semantic)) {
    return "list";
  }
  if (/\b(table|data grid)\b/.test(semantic)) {
    return "table";
  }
  if (/\b(dialog|modal|popover)\b/.test(semantic)) {
    return "dialog";
  }
  if (/\b(badge|chip|pill|tag)\b/.test(semantic)) {
    return /\bchip|pill|tag\b/.test(semantic) ? "chip" : "badge";
  }
  if (/\b(accordion|alert|avatar|breadcrumbs|checkbox|drawer|progress|radio|rating|slider|snackbar|stepper|switch|tab|tooltip)\b/.test(semantic)) {
    return semantic.match(/\b(accordion|alert|avatar|breadcrumbs|checkbox|drawer|progress|radio|rating|slider|snackbar|stepper|switch|tab|tooltip)\b/)?.[1] ?? element.type;
  }
  return element.type;
};

const htmlTagFor = ({
  element,
  layout,
  root,
  parentTag,
}: {
  element: ScreenElementIR | undefined;
  layout: DefaultLayoutNode;
  root: boolean;
  parentTag?: string;
}): string => {
  if (root) {
    return "main";
  }
  if (!element) {
    return "section";
  }
  if (parentTag === "ul" || parentTag === "ol") {
    return "li";
  }
  if (isTextElement(element)) {
    if (parentTag === "button") {
      return "span";
    }
    if ((element.fontSize ?? 0) >= 28 || /\b(title|heading|headline|h1)\b/i.test(element.name)) {
      return "h1";
    }
    return "p";
  }
  switch (semanticKindFor(element)) {
    case "navigation":
      return "nav";
    case "header":
      return "header";
    case "footer":
      return "footer";
    case "main":
      return "main";
    case "form":
      return "form";
    case "button":
      return "button";
    case "input":
      return "input";
    case "select":
      return "select";
    case "image":
      return "img";
    case "card":
    case "paper":
      return "article";
    case "chip":
    case "badge":
      return "span";
    case "list":
      return "ul";
    case "table":
      return "table";
    case "dialog":
      return "section";
    case "divider":
      return "hr";
    default:
      break;
  }
  if (layout.kind === "grid" || layout.kind === "flex") {
    return "section";
  }
  return "div";
};

const attributesFor = ({
  element,
  tag,
  layout,
  root,
  dataIrIdExpression,
  dataIrNameExpression,
}: {
  element: ScreenElementIR | undefined;
  tag: string;
  layout: DefaultLayoutNode;
  root: boolean;
  dataIrIdExpression?: string;
  dataIrNameExpression?: string;
}): string => {
  const attributes: string[] = [];
  if (!root) {
    attributes.push(
      dataIrIdExpression
        ? `data-ir-id={${dataIrIdExpression}}`
        : `data-ir-id="${escapeAttribute(layout.id)}"`,
    );
    attributes.push(
      dataIrNameExpression
        ? `data-ir-name={${dataIrNameExpression}}`
        : `data-ir-name="${escapeAttribute(layout.name)}"`,
    );
  }
  if (layout.className) {
    attributes.push(`className="${escapeAttribute(layout.className)}"`);
  }
  if (!element) {
    return attributes.length > 0 ? ` ${attributes.join(" ")}` : "";
  }
  if (tag === "button") {
    attributes.push('type="button"');
    if (!firstText(element)) {
      attributes.push(`aria-label="${escapeAttribute(humanizeLabel(element, "Button"))}"`);
    }
  } else if (tag === "input") {
    attributes.push('type="text"');
    attributes.push(`name="${escapeAttribute(sanitizePropName(element.name, "field"))}"`);
    attributes.push(`aria-label="${escapeAttribute(humanizeLabel(element, "Input"))}"`);
    if (element.required) {
      attributes.push("required");
    }
  } else if (tag === "select") {
    attributes.push(`aria-label="${escapeAttribute(humanizeLabel(element, "Select"))}"`);
  } else if (tag === "img") {
    attributes.push(`alt="${escapeAttribute(element.asset?.alt ?? humanizeLabel(element, ""))}"`);
    attributes.push(`src="${escapeAttribute(element.asset?.source ?? "")}"`);
  } else if (tag === "nav") {
    attributes.push(`aria-label="${escapeAttribute(humanizeLabel(element, "Navigation"))}"`);
  } else if (semanticKindFor(element) === "dialog") {
    attributes.push('role="dialog"');
    attributes.push('aria-modal="true"');
    attributes.push(`aria-label="${escapeAttribute(humanizeLabel(element, "Dialog"))}"`);
  }
  return attributes.length > 0 ? ` ${attributes.join(" ")}` : "";
};

const VOID_HTML_TAGS = new Set(["hr", "img", "input"]);

interface TextBinding {
  path: string;
  propName: string;
}

interface DataBinding {
  path: string;
  idPropName: string;
  namePropName: string;
}

interface SemanticComponentPlan {
  componentName: string;
  filePath: string;
  kind: string;
  signature: string;
  instanceIds: string[];
  propBindings: TextBinding[];
  dataBindings: DataBinding[];
}

interface SemanticSynthesisPlan {
  components: SemanticComponentPlan[];
  componentByNodeId: Map<string, SemanticComponentPlan>;
  diagnostics: DefaultSemanticComponentDiagnostic[];
}

const EXTRACTABLE_SEMANTIC_KINDS = new Set([
  "button",
  "card",
  "input",
  "form",
  "navigation",
  "list",
  "table",
  "dialog",
  "badge",
  "chip",
]);

const STRUCTURAL_FALLBACK_KINDS = new Set([
  "accordion",
  "alert",
  "avatar",
  "breadcrumbs",
  "checkbox",
  "drawer",
  "progress",
  "radio",
  "rating",
  "slider",
  "snackbar",
  "stepper",
  "switch",
  "tab",
  "tooltip",
]);

const isExtractableElement = (element: ScreenElementIR | undefined): boolean =>
  Boolean(element && !isTextElement(element) && EXTRACTABLE_SEMANTIC_KINDS.has(semanticKindFor(element)));

const stripTrailingOrdinal = (value: string): string =>
  value
    .replace(/\b(?:copy|instance|variant)\b/gi, " ")
    .replace(/\b\d+\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const ensureComponentSuffix = (name: string, kind: string): string => {
  const suffix =
    kind === "navigation"
      ? "Nav"
      : kind === "chip"
        ? "Badge"
        : `${kind.charAt(0).toUpperCase()}${kind.slice(1)}`;
  return name.toLowerCase().endsWith(suffix.toLowerCase()) ? name : `${name}${suffix}`;
};

const childSignature = (
  layout: DefaultLayoutNode,
  elementsById: ReadonlyMap<string, ScreenElementIR>,
): string => {
  const element = elementsById.get(layout.id);
  const kind = element && isTextElement(element) ? "text" : semanticKindFor(element);
  const attributeSignature = element && !isTextElement(element)
    ? [
        element.required === true ? "required" : "",
        element.asset?.source ? `asset:${element.asset.source}` : "",
        element.asset?.alt ? `alt:${element.asset.alt}` : "",
        element.validationType ? `validation:${element.validationType}` : "",
      ]
        .filter(Boolean)
        .join("|")
    : "";
  return [
    kind,
    layout.kind,
    layout.className,
    attributeSignature,
    `(${layout.children.map((child) => childSignature(child, elementsById)).join(",")})`,
  ].join(":");
};

const collectCandidateLayouts = ({
  layout,
  elementsById,
  depth = 0,
}: {
  layout: DefaultLayoutNode;
  elementsById: ReadonlyMap<string, ScreenElementIR>;
  depth?: number;
}): Array<{ layout: DefaultLayoutNode; depth: number; signature: string; kind: string }> => {
  const element = elementsById.get(layout.id);
  const current =
    depth > 0 && isExtractableElement(element)
      ? [
          {
            layout,
            depth,
            signature: childSignature(layout, elementsById),
            kind: semanticKindFor(element),
          },
        ]
      : [];
  return [
    ...current,
    ...layout.children.flatMap((child) =>
      collectCandidateLayouts({
        layout: child,
        elementsById,
        depth: depth + 1,
      }),
    ),
  ];
};

const collectStructuralFallbackDiagnostics = ({
  layout,
  elementsById,
}: {
  layout: DefaultLayoutNode;
  elementsById: ReadonlyMap<string, ScreenElementIR>;
}): DefaultSemanticComponentDiagnostic[] => {
  const diagnostics: DefaultSemanticComponentDiagnostic[] = [];
  const visit = (node: DefaultLayoutNode): void => {
    const element = elementsById.get(node.id);
    const kind = semanticKindFor(element);
    if (element && STRUCTURAL_FALLBACK_KINDS.has(kind)) {
      diagnostics.push({
        code: "W_SEMANTIC_COMPONENT_STRUCTURAL_FALLBACK",
        nodeId: element.id,
        nodeName: element.name,
        message: `Default semantic synthesis rendered '${element.name}' with structural HTML because '${kind}' does not have a dedicated default Tailwind primitive yet.`,
      });
    }
    for (const child of node.children) {
      visit(child);
    }
  };
  visit(layout);
  return diagnostics;
};

const collectTextBindings = ({
  layout,
  elementsById,
  prefix = "",
}: {
  layout: DefaultLayoutNode;
  elementsById: ReadonlyMap<string, ScreenElementIR>;
  prefix?: string;
}): Array<{ path: string; element: ScreenElementIR }> => {
  const element = elementsById.get(layout.id);
  if (element && isTextElement(element)) {
    return [{ path: prefix, element }];
  }
  return layout.children.flatMap((child, index) =>
    collectTextBindings({
      layout: child,
      elementsById,
      prefix: `${prefix}/${index}`,
    }),
  );
};

const collectDataBindings = ({
  layout,
  prefix = "",
}: {
  layout: DefaultLayoutNode;
  prefix?: string;
}): Array<{ path: string; layout: DefaultLayoutNode }> => [
  { path: prefix, layout },
  ...layout.children.flatMap((child, index) =>
    collectDataBindings({
      layout: child,
      prefix: `${prefix}/${index}`,
    }),
  ),
];

const hasDescendant = (layout: DefaultLayoutNode, descendantId: string): boolean =>
  layout.children.some((child) => child.id === descendantId || hasDescendant(child, descendantId));

const buildSemanticSynthesisPlan = ({
  layout,
  elementsById,
}: {
  layout: DefaultLayoutNode;
  elementsById: ReadonlyMap<string, ScreenElementIR>;
}): SemanticSynthesisPlan => {
  const diagnostics = collectStructuralFallbackDiagnostics({ layout, elementsById });
  const groups = new Map<string, Array<{ layout: DefaultLayoutNode; depth: number; signature: string; kind: string }>>();
  for (const candidate of collectCandidateLayouts({ layout, elementsById })) {
    const grouped = groups.get(candidate.signature) ?? [];
    grouped.push(candidate);
    groups.set(candidate.signature, grouped);
  }

  const componentByNodeId = new Map<string, SemanticComponentPlan>();
  const components: SemanticComponentPlan[] = [];
  const usedComponentNames = new Set<string>();
  const reusableGroups = [...groups.values()]
    .filter((group) => group.length > 1)
    .sort(
      (left, right) =>
        left[0]!.depth - right[0]!.depth ||
        left[0]!.signature.localeCompare(right[0]!.signature),
    );

  for (const group of reusableGroups) {
    const available = group.filter(
      (candidate) => {
        for (const selectedId of componentByNodeId.keys()) {
          const selectedLayout = findLayoutById(layout, selectedId);
          if (
            hasDescendant(candidate.layout, selectedId) ||
            (selectedLayout && hasDescendant(selectedLayout, candidate.layout.id))
          ) {
            return false;
          }
        }
        return true;
      },
    );
    if (available.length < 2) {
      continue;
    }
    const first = [...available].sort((left, right) => left.layout.id.localeCompare(right.layout.id))[0]!;
    const firstElement = elementsById.get(first.layout.id);
    const baseName = ensureComponentSuffix(
      sanitizeComponentName(stripTrailingOrdinal(firstElement?.semanticName ?? firstElement?.name ?? first.kind)),
      first.kind,
    );
    let componentName = baseName;
    let suffix = 2;
    while (usedComponentNames.has(componentName)) {
      componentName = `${baseName}${suffix}`;
      suffix += 1;
    }
    usedComponentNames.add(componentName);

    const textBindings = collectTextBindings({ layout: first.layout, elementsById });
    const usedDataBindingNames = new Set<string>();
    const dataBindings = collectDataBindings({ layout: first.layout }).map((binding, index) => {
      if (binding.path === "") {
        usedDataBindingNames.add("ir");
        return {
          path: binding.path,
          idPropName: "irId",
          namePropName: "irName",
        };
      }
      const baseName = sanitizePropName(binding.layout.name, `node${index}`);
      let propName = baseName;
      let propSuffix = 2;
      while (usedDataBindingNames.has(propName)) {
        propName = `${baseName}${propSuffix}`;
        propSuffix += 1;
      }
      usedDataBindingNames.add(propName);
      return {
        path: binding.path,
        idPropName: `${propName}IrId`,
        namePropName: `${propName}IrName`,
      };
    });
    const usedPropNames = new Set(
      dataBindings.flatMap((binding) => [binding.idPropName, binding.namePropName]),
    );
    const propBindings = textBindings.map((binding, index) => {
      const basePropName = sanitizePropName(binding.element.name, `text${index + 1}`);
      let propName = basePropName;
      let propSuffix = 2;
      while (usedPropNames.has(propName)) {
        propName = `${basePropName}${propSuffix}`;
        propSuffix += 1;
      }
      usedPropNames.add(propName);
      return { path: binding.path, propName };
    });
    const plan: SemanticComponentPlan = {
      componentName,
      filePath: `src/components/${componentName}.tsx`,
      kind: first.kind,
      signature: first.signature,
      instanceIds: available.map((candidate) => candidate.layout.id).sort((left, right) => left.localeCompare(right)),
      propBindings,
      dataBindings,
    };
    components.push(plan);
    for (const candidate of available) {
      componentByNodeId.set(candidate.layout.id, plan);
    }
  }

  for (const candidate of collectCandidateLayouts({ layout, elementsById })) {
    if (!componentByNodeId.has(candidate.layout.id)) {
      diagnostics.push({
        code: "W_SEMANTIC_COMPONENT_NOT_REUSABLE",
        nodeId: candidate.layout.id,
        nodeName: candidate.layout.name,
        message: `Default semantic synthesis kept '${candidate.layout.name}' inline because no matching reusable semantic structure was found.`,
      });
    }
  }

  return { components, componentByNodeId, diagnostics };
};

const propsForInstance = ({
  instanceLayout,
  component,
  elementsById,
}: {
  instanceLayout: DefaultLayoutNode;
  component: SemanticComponentPlan;
  elementsById: ReadonlyMap<string, ScreenElementIR>;
}): string => {
  const textByPath = new Map(
    collectTextBindings({ layout: instanceLayout, elementsById }).map((binding) => [
      binding.path,
      isTextElement(binding.element) ? binding.element.text : "",
    ] as const),
  );
  const dataByPath = new Map(
    collectDataBindings({ layout: instanceLayout }).map((binding) => [
      binding.path,
      {
        id: binding.layout.id,
        name: binding.layout.name,
      },
    ] as const),
  );
  const textProps = component.propBindings.map((binding) => {
      const text = textByPath.get(binding.path) ?? "";
      return `${binding.propName}={${escapeText(text)}}`;
    });
  const dataProps = component.dataBindings.flatMap((binding) => {
    const data = dataByPath.get(binding.path);
    return [
      `${binding.idPropName}={${escapeText(data?.id ?? "")}}`,
      `${binding.namePropName}={${escapeText(data?.name ?? "")}}`,
    ];
  });
  return [...textProps, ...dataProps].join(" ");
};

const renderNode = ({
  layout,
  elementsById,
  depth,
  root = false,
  componentByNodeId = new Map(),
  parentTag,
  propBindingsByPath = new Map(),
  dataBindingsByPath = new Map(),
  path = "",
}: {
  layout: DefaultLayoutNode;
  elementsById: ReadonlyMap<string, ScreenElementIR>;
  depth: number;
  root?: boolean;
  componentByNodeId?: ReadonlyMap<string, SemanticComponentPlan>;
  parentTag?: string;
  propBindingsByPath?: ReadonlyMap<string, string>;
  dataBindingsByPath?: ReadonlyMap<string, { idPropName: string; namePropName: string }>;
  path?: string;
}): string => {
  const element = elementsById.get(layout.id);
  const currentIndent = indent(depth);
  const component = componentByNodeId.get(layout.id);
  if (!root && component) {
    const props = propsForInstance({ instanceLayout: layout, component, elementsById });
    const invocation = `<${component.componentName}${props ? ` ${props}` : ""} />`;
    if (parentTag === "ul" || parentTag === "ol") {
      return `${currentIndent}<li>
${indent(depth + 1)}${invocation}
${currentIndent}</li>`;
    }
    return `${currentIndent}${invocation}`;
  }

  const tag = htmlTagFor({
    element,
    layout,
    root,
    ...(parentTag !== undefined ? { parentTag } : {}),
  });
  const dataBinding = dataBindingsByPath.get(path);
  const attributes = attributesFor({
    element,
    tag,
    layout,
    root,
    ...(dataBinding
      ? {
          dataIrIdExpression: `props.${dataBinding.idPropName}`,
          dataIrNameExpression: `props.${dataBinding.namePropName}`,
        }
      : {}),
  });
  const propName = propBindingsByPath.get(path);

  if (element && isTextElement(element)) {
    const value = propName ? `props.${propName}` : escapeText(element.text);
    return `${currentIndent}<${tag}${attributes}>{${value}}</${tag}>`;
  }

  if (VOID_HTML_TAGS.has(tag)) {
    return `${currentIndent}<${tag}${attributes} />`;
  }

  const children = layout.children
    .map((child, index) =>
      renderNode({
        layout: child,
        elementsById,
        depth: depth + 1,
        componentByNodeId,
        parentTag: tag,
        propBindingsByPath,
        dataBindingsByPath,
        path: `${path}/${index}`,
      }),
    )
    .join("\n");
  if (!children) {
    return `${currentIndent}<${tag}${attributes} />`;
  }
  return `${currentIndent}<${tag}${attributes}>
${children}
${currentIndent}</${tag}>`;
};

const createSemanticComponentFile = ({
  component,
  layout,
  elementsById,
}: {
  component: SemanticComponentPlan;
  layout: DefaultLayoutNode;
  elementsById: ReadonlyMap<string, ScreenElementIR>;
}): GeneratedFile => {
  const instanceLayout = component.instanceIds
    .map((id) => findLayoutById(layout, id))
    .find((candidate): candidate is DefaultLayoutNode => candidate !== undefined);
  if (!instanceLayout) {
    return {
      path: component.filePath,
      content: `export default function ${component.componentName}() {
  return null;
}
`,
    };
  }
  const propsInterfaceName = `${component.componentName}Props`;
  const dataPropLines = component.dataBindings.flatMap((binding) => [
    `  ${binding.idPropName}: string;`,
    `  ${binding.namePropName}: string;`,
  ]);
  const propLines = [
    ...dataPropLines,
    ...component.propBindings.map((binding) => `  ${binding.propName}: string;`),
  ].join("\n");
  const propBindingsByPath = new Map(component.propBindings.map((binding) => [binding.path, binding.propName] as const));
  const dataBindingsByPath = new Map(
    component.dataBindings.map((binding) => [
      binding.path,
      { idPropName: binding.idPropName, namePropName: binding.namePropName },
    ] as const),
  );
  const rendered = renderNode({
    layout: instanceLayout,
    elementsById,
    depth: 2,
    propBindingsByPath,
    dataBindingsByPath,
  });
  const propsDeclaration = `interface ${propsInterfaceName} {
${propLines}
}

`;
  return {
    path: component.filePath,
    content: `${propsDeclaration}export default function ${component.componentName}(props: Readonly<${propsInterfaceName}>) {
  return (
${rendered}
  );
}
`,
  };
};

const findLayoutById = (layout: DefaultLayoutNode, id: string): DefaultLayoutNode | undefined => {
  if (layout.id === id) {
    return layout;
  }
  for (const child of layout.children) {
    const found = findLayoutById(child, id);
    if (found) {
      return found;
    }
  }
  return undefined;
};

export const createDefaultTailwindScreenFile = (screen: ScreenIR): DefaultTailwindScreenFile => {
  const layout = solveDefaultScreenLayout(screen);
  const elementsById = collectElementsById(screen);
  const componentName = sanitizeComponentName(screen.name);
  const semanticPlan = buildSemanticSynthesisPlan({ layout, elementsById });
  const componentFiles = semanticPlan.components.map((component) =>
    createSemanticComponentFile({
      component,
      layout,
      elementsById,
    }),
  );
  const imports = semanticPlan.components
    .map((component) => `import ${component.componentName} from "../components/${component.componentName}";`)
    .join("\n");
  const rendered = renderNode({
    layout,
    elementsById,
    depth: 2,
    root: true,
    componentByNodeId: semanticPlan.componentByNodeId,
  });
  return {
    layout,
    warnings: layout.warnings,
    componentFiles,
    semanticComponents: semanticPlan.components.map((component) => ({
      componentName: component.componentName,
      filePath: component.filePath,
      kind: component.kind,
      instanceNodeIds: component.instanceIds,
      propNames: component.propBindings.map((binding) => binding.propName),
    })),
    semanticDiagnostics: semanticPlan.diagnostics,
    file: {
      path: `src/pages/${sanitizeFileName(screen.name)}.tsx`,
      content: `${imports ? `${imports}\n\n` : ""}export default function ${componentName}() {
  return (
${rendered}
  );
}
`,
    },
  };
};

export const createDefaultSemanticComponentReportFile = (screens: readonly ScreenIR[]): GeneratedFile => {
  const screenReports = screens.map((screen) => {
    const result = createDefaultTailwindScreenFile(screen);
    return {
      screenId: screen.id,
      screenName: screen.name,
      components: result.semanticComponents,
      diagnostics: result.semanticDiagnostics,
    };
  });
  return {
    path: DEFAULT_SEMANTIC_COMPONENT_REPORT_PATH,
    content: `${JSON.stringify(
      {
        schemaVersion: SEMANTIC_COMPONENT_REPORT_SCHEMA_VERSION,
        pipelineId: "default",
        screens: screenReports,
        components: screenReports.flatMap((screen) =>
          screen.components.map((component) => ({
            screenId: screen.screenId,
            screenName: screen.screenName,
            ...component,
          })),
        ),
        diagnostics: screenReports.flatMap((screen) =>
          screen.diagnostics.map((diagnostic) => ({
            screenId: screen.screenId,
            screenName: screen.screenName,
            ...diagnostic,
          })),
        ),
      },
      null,
      2,
    )}\n`,
  };
};

export const createDefaultLayoutReportFile = (screens: readonly ScreenIR[]): GeneratedFile => {
  const screenReports = screens.map((screen) => {
    const layout = solveDefaultScreenLayout(screen);
    const semanticResult = createDefaultTailwindScreenFile(screen);
    return {
      screenId: screen.id,
      screenName: screen.name,
      rootLayoutKind: layout.kind,
      warnings: layout.warnings,
      semanticComponents: semanticResult.semanticComponents,
      semanticDiagnostics: semanticResult.semanticDiagnostics,
    };
  });
  return {
    path: DEFAULT_LAYOUT_REPORT_PATH,
    content: `${JSON.stringify(
      {
        schemaVersion: "1.0.0",
        pipelineId: "default",
        warnings: screenReports.flatMap((screen) => screen.warnings),
        semanticComponents: screenReports.flatMap((screen) =>
          screen.semanticComponents.map((component) => ({
            screenId: screen.screenId,
            screenName: screen.screenName,
            ...component,
          })),
        ),
        semanticDiagnostics: screenReports.flatMap((screen) =>
          screen.semanticDiagnostics.map((diagnostic) => ({
            screenId: screen.screenId,
            screenName: screen.screenName,
            ...diagnostic,
          })),
        ),
        screens: screenReports,
      },
      null,
      2,
    )}\n`,
  };
};
