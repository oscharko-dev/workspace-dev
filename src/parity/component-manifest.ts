import { lstat, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import type { ScreenIR } from "./types-ir.js";
import { buildScreenArtifactIdentities } from "./generator-artifacts.js";
import type { ScreenArtifactIdentity } from "./generator-artifacts.js";

export interface ComponentManifestEntry {
  irNodeId: string;
  irNodeName: string;
  irNodeType: string;
  file: string;
  startLine: number;
  endLine: number;
  extractedComponent?: true;
}

export interface ScreenManifestEntry {
  screenId: string;
  screenName: string;
  file: string;
  components: ComponentManifestEntry[];
}

export interface ComponentManifest {
  screens: ScreenManifestEntry[];
}

const IR_START_PATTERN = /\{\/\* @ir:start (\S+) (.+?) (\S+?)(?: extracted)? \*\/\}/;
const IR_END_PATTERN = /\{\/\* @ir:end (\S+) \*\/\}/;
const GENERATED_ARTIFACT_ROOTS = ["src/screens/", "src/components/", "src/context/"] as const;

export function parseIrMarkersFromSource(
  content: string,
  filePath: string
): ComponentManifestEntry[] {
  const lines = content.split("\n");
  const entries: ComponentManifestEntry[] = [];
  const openStack: Array<{
    irNodeId: string;
    irNodeName: string;
    irNodeType: string;
    startLine: number;
    extracted: boolean;
  }> = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const startMatch = IR_START_PATTERN.exec(line);
    if (startMatch) {
      openStack.push({
        irNodeId: startMatch[1]!,
        irNodeName: startMatch[2]!,
        irNodeType: startMatch[3]!,
        startLine: i + 1,
        extracted: line.includes(" extracted ")
      });
      continue;
    }

    const endMatch = IR_END_PATTERN.exec(line);
    if (endMatch) {
      const nodeId = endMatch[1]!;
      // Find the matching start from the stack (search from top)
      for (let j = openStack.length - 1; j >= 0; j--) {
        if (openStack[j]!.irNodeId === nodeId) {
          const start = openStack[j]!;
          openStack.splice(j, 1);
          const entry: ComponentManifestEntry = {
            irNodeId: start.irNodeId,
            irNodeName: start.irNodeName,
            irNodeType: start.irNodeType,
            file: filePath,
            startLine: start.startLine,
            endLine: i + 1
          };
          if (start.extracted) {
            entry.extractedComponent = true;
          }
          entries.push(entry);
          break;
        }
      }
    }
  }

  return entries;
}

export async function buildComponentManifest({
  projectDir,
  screens,
  identitiesByScreenId
}: {
  projectDir: string;
  screens: ScreenIR[];
  identitiesByScreenId?: Map<string, ScreenArtifactIdentity>;
}): Promise<ComponentManifest> {
  const identities = identitiesByScreenId ?? buildScreenArtifactIdentities(screens);
  const result: ScreenManifestEntry[] = [];

  // Collect all .tsx files to parse
  const tsxFiles = await collectTsxFiles(projectDir);
  const entriesByFile = new Map<string, ComponentManifestEntry[]>();

  for (const absolutePath of tsxFiles) {
    const relativePath = normalizeManifestFilePath(path.relative(projectDir, absolutePath));
    let content: string;
    try {
      content = await readFile(absolutePath, "utf8");
    } catch {
      continue;
    }
    const entries = parseIrMarkersFromSource(content, relativePath);
    if (entries.length > 0) {
      entriesByFile.set(relativePath, entries);
    }
  }

  for (const screen of screens) {
    const identity = identities.get(screen.id);
    if (!identity) {
      continue;
    }

    const screenFile = identity.filePath;
    const components: ComponentManifestEntry[] = [];

    // Gather entries from the screen file itself
    const screenEntries = entriesByFile.get(screenFile);
    if (screenEntries) {
      components.push(...screenEntries);
    }

    // Gather entries from associated component files (extracted patterns)
    for (const [file, entries] of entriesByFile) {
      if (isAssociatedArtifactFile({ file, screenFile })) {
        // Check if any entries reference children of this screen
        for (const entry of entries) {
          if (hasNodeInScreen(screen, entry.irNodeId)) {
            components.push(entry);
          }
        }
      }
    }

    result.push({
      screenId: screen.id,
      screenName: screen.name,
      file: screenFile,
      components
    });
  }

  return { screens: result };
}

function normalizeManifestFilePath(filePath: string): string {
  return filePath.replace(/\\/g, "/");
}

function isAssociatedArtifactFile({
  file,
  screenFile
}: {
  file: string;
  screenFile: string;
}): boolean {
  if (file === screenFile) {
    return false;
  }

  return GENERATED_ARTIFACT_ROOTS.some((root) => file.startsWith(root));
}

function hasNodeInScreen(screen: ScreenIR, nodeId: string): boolean {
  const stack = [...screen.children];
  while (stack.length > 0) {
    const node = stack.pop()!;
    if (node.id === nodeId) {
      return true;
    }
    if ("children" in node && Array.isArray(node.children)) {
      stack.push(...node.children);
    }
  }
  return false;
}

async function collectTsxFiles(dir: string): Promise<string[]> {
  const results: string[] = [];
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return results;
  }

  for (const name of names) {
    if (name === "node_modules" || name === "dist" || name.startsWith(".")) {
      continue;
    }
    const fullPath = path.join(dir, name);
    const stats = await lstat(fullPath);
    if (stats.isDirectory()) {
      results.push(...(await collectTsxFiles(fullPath)));
    } else if (stats.isFile() && name.endsWith(".tsx")) {
      results.push(fullPath);
    }
  }

  return results;
}
