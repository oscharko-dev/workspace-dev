import type { ComponentManifest } from "../parity/component-manifest.js";
import type { DesignIR } from "../parity/types-ir.js";

function toPatternRegex(pattern: string): RegExp | null {
  try {
    return new RegExp(pattern, "i");
  } catch {
    return null;
  }
}

function collectNodeNames(designIr: DesignIR | undefined): string[] {
  if (!designIr) {
    return [];
  }
  const names: string[] = [];
  const stack: Array<{ name?: string; children?: unknown[] }> = [
    ...(designIr.screens as Array<{ name?: string; children?: unknown[] }>),
  ];
  while (stack.length > 0) {
    const next = stack.pop();
    if (!next) {
      continue;
    }
    if (typeof next.name === "string" && next.name.trim().length > 0) {
      names.push(next.name);
    }
    if (Array.isArray(next.children)) {
      for (const child of next.children) {
        if (typeof child === "object" && child !== null) {
          stack.push(child as { name?: string; children?: unknown[] });
        }
      }
    }
  }
  return names;
}

function collectManifestValues(manifest: ComponentManifest | undefined): string[] {
  if (!manifest) {
    return [];
  }
  const values: string[] = [];
  for (const screen of manifest.screens) {
    if (typeof screen.screenName === "string" && screen.screenName.trim().length > 0) {
      values.push(screen.screenName);
    }
    if (typeof screen.file === "string" && screen.file.trim().length > 0) {
      values.push(screen.file);
    }
    for (const component of screen.components) {
      if (
        typeof component.irNodeName === "string" &&
        component.irNodeName.trim().length > 0
      ) {
        values.push(component.irNodeName);
      }
      if (
        typeof component.irNodeType === "string" &&
        component.irNodeType.trim().length > 0
      ) {
        values.push(component.irNodeType);
      }
      if (typeof component.file === "string" && component.file.trim().length > 0) {
        values.push(component.file);
      }
    }
  }
  return values;
}

export function isSecuritySensitiveImport(args: {
  patterns: readonly string[];
  designIr?: DesignIR;
  componentManifest?: ComponentManifest;
  generatedPaths?: readonly string[];
}): boolean {
  const regexes = args.patterns
    .map((pattern) => pattern.trim())
    .filter((pattern) => pattern.length > 0)
    .map(toPatternRegex)
    .filter((regex): regex is RegExp => regex !== null);
  if (regexes.length === 0) {
    return false;
  }

  const candidates = [
    ...collectNodeNames(args.designIr),
    ...collectManifestValues(args.componentManifest),
    ...(args.generatedPaths ?? []).filter((entry) => entry.trim().length > 0),
  ];
  if (candidates.length === 0) {
    return false;
  }

  return candidates.some((candidate) =>
    regexes.some((regex) => regex.test(candidate)),
  );
}
