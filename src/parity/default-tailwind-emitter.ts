import type { GeneratedFile, ScreenElementIR, ScreenIR } from "./types.js";
import { isTextElement } from "./types.js";
import type {
  DefaultLayoutNode,
  DefaultLayoutWarning,
} from "./default-layout-solver.js";
import { solveDefaultScreenLayout } from "./default-layout-solver.js";

export const DEFAULT_LAYOUT_REPORT_PATH = "src/generated/layout-report.json";

export interface DefaultTailwindScreenFile {
  file: GeneratedFile;
  layout: DefaultLayoutNode;
  warnings: DefaultLayoutWarning[];
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

const htmlTagFor = (element: ScreenElementIR | undefined, layout: DefaultLayoutNode, root: boolean): string => {
  if (root) {
    return "main";
  }
  if (!element) {
    return "section";
  }
  if (isTextElement(element)) {
    if ((element.fontSize ?? 0) >= 28 || /\b(title|heading|headline|h1)\b/i.test(element.name)) {
      return "h1";
    }
    return "p";
  }
  if (/\b(nav|navigation|menu)\b/i.test(element.name)) {
    return "nav";
  }
  if (/\b(header|hero)\b/i.test(element.name)) {
    return "header";
  }
  if (/\b(footer)\b/i.test(element.name)) {
    return "footer";
  }
  if (layout.kind === "grid" || layout.kind === "flex") {
    return "section";
  }
  return "div";
};

const renderNode = ({
  layout,
  elementsById,
  depth,
  root = false,
}: {
  layout: DefaultLayoutNode;
  elementsById: ReadonlyMap<string, ScreenElementIR>;
  depth: number;
  root?: boolean;
}): string => {
  const element = elementsById.get(layout.id);
  const tag = htmlTagFor(element, layout, root);
  const dataAttributes = root
    ? ""
    : ` data-ir-id="${escapeAttribute(layout.id)}" data-ir-name="${escapeAttribute(layout.name)}"`;
  const className = layout.className ? ` className="${escapeAttribute(layout.className)}"` : "";
  const currentIndent = indent(depth);

  if (element && isTextElement(element)) {
    return `${currentIndent}<${tag}${dataAttributes}${className}>{${escapeText(element.text)}}</${tag}>`;
  }

  const children = layout.children
    .map((child) =>
      renderNode({
        layout: child,
        elementsById,
        depth: depth + 1,
      }),
    )
    .join("\n");
  if (!children) {
    return `${currentIndent}<${tag}${dataAttributes}${className} />`;
  }
  return `${currentIndent}<${tag}${dataAttributes}${className}>
${children}
${currentIndent}</${tag}>`;
};

export const createDefaultTailwindScreenFile = (screen: ScreenIR): DefaultTailwindScreenFile => {
  const layout = solveDefaultScreenLayout(screen);
  const elementsById = collectElementsById(screen);
  const componentName = sanitizeComponentName(screen.name);
  const rendered = renderNode({
    layout,
    elementsById,
    depth: 2,
    root: true,
  });
  return {
    layout,
    warnings: layout.warnings,
    file: {
      path: `src/pages/${sanitizeFileName(screen.name)}.tsx`,
      content: `export default function ${componentName}() {
  return (
${rendered}
  );
}
`,
    },
  };
};

export const createDefaultLayoutReportFile = (screens: readonly ScreenIR[]): GeneratedFile => {
  const screenReports = screens.map((screen) => {
    const layout = solveDefaultScreenLayout(screen);
    return {
      screenId: screen.id,
      screenName: screen.name,
      rootLayoutKind: layout.kind,
      warnings: layout.warnings,
    };
  });
  return {
    path: DEFAULT_LAYOUT_REPORT_PATH,
    content: `${JSON.stringify(
      {
        schemaVersion: "1.0.0",
        pipelineId: "default",
        warnings: screenReports.flatMap((screen) => screen.warnings),
        screens: screenReports,
      },
      null,
      2,
    )}\n`,
  };
};
