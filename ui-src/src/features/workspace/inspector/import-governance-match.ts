interface DesignIrElementNode {
  name?: string;
  children?: readonly DesignIrElementNode[];
}

interface DesignIrScreen {
  name?: string;
  generatedFile?: string;
  children: readonly DesignIrElementNode[];
}

interface ComponentManifestEntry {
  irNodeName: string;
  irNodeType: string;
  file: string;
}

interface ComponentManifestScreen {
  screenName: string;
  file: string;
  components: readonly ComponentManifestEntry[];
}

interface ComponentManifestLike {
  screens: readonly ComponentManifestScreen[];
}

function normalizeGovernanceToken(value: string): string {
  return value.trim().toLowerCase();
}

function collectNodeNames(screens: readonly DesignIrScreen[]): string[] {
  const names: string[] = [];
  const stack: Array<{ name?: string; children?: readonly DesignIrElementNode[] }> =
    [...screens];
  while (stack.length > 0) {
    const next = stack.pop();
    if (!next) {
      continue;
    }
    if (typeof next.name === "string" && next.name.trim().length > 0) {
      names.push(next.name);
    }
    for (const child of next.children ?? []) {
      stack.push(child);
    }
  }
  return names;
}

function collectManifestValues(manifest: ComponentManifestLike | null): string[] {
  if (!manifest) {
    return [];
  }
  const values: string[] = [];
  for (const screen of manifest.screens) {
    values.push(screen.screenName, screen.file);
    for (const component of screen.components) {
      values.push(component.irNodeName, component.irNodeType, component.file);
    }
  }
  return values.filter((value) => value.trim().length > 0);
}

export function isSecuritySensitiveInspectorSelection(args: {
  patterns: readonly string[];
  screens: readonly DesignIrScreen[];
  manifest: ComponentManifestLike | null;
  generatedFiles: readonly string[];
}): boolean {
  const tokens = args.patterns
    .map(normalizeGovernanceToken)
    .filter((pattern) => pattern.length > 0);
  if (tokens.length === 0) {
    return false;
  }

  const candidates = [
    ...collectNodeNames(args.screens),
    ...collectManifestValues(args.manifest),
    ...args.generatedFiles,
  ];
  return candidates.some((candidate) => {
    const normalizedCandidate = normalizeGovernanceToken(candidate);
    if (normalizedCandidate.length === 0) {
      return false;
    }
    return tokens.some((token) => normalizedCandidate.includes(token));
  });
}
