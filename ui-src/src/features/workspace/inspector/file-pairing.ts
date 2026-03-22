/**
 * Smart file pairing for the Inspector split-view.
 *
 * Given a primary file and the component manifest, suggests a related file
 * that the user likely wants to see alongside it. Uses two strategies:
 *
 * 1. **Manifest-based**: Find another file that shares an `irNodeId` with
 *    the primary file's manifest entries (e.g., component + extracted sub-component).
 * 2. **Filename stem**: Match files with the same base name but different
 *    extensions (e.g., `Button.tsx` + `Button.styles.ts`).
 *
 * @see https://github.com/oscharko-dev/workspace-dev/issues/437
 */

// ---------------------------------------------------------------------------
// Types (mirrored from InspectorPanel to avoid circular imports)
// ---------------------------------------------------------------------------

interface ManifestEntry {
  irNodeId: string;
  file: string;
}

interface ManifestScreen {
  screenId: string;
  file: string;
  components: ManifestEntry[];
}

interface ManifestPayload {
  screens: ManifestScreen[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Extract the filename stem (without extension) from a file path.
 * e.g. `src/components/Button.tsx` → `Button`
 */
function filenameStem(filePath: string): string {
  const lastSlash = filePath.lastIndexOf("/");
  const name = lastSlash >= 0 ? filePath.slice(lastSlash + 1) : filePath;
  const dotIndex = name.lastIndexOf(".");
  return dotIndex > 0 ? name.slice(0, dotIndex) : name;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Suggest a related file to display alongside the `primaryFile` in split view.
 *
 * @param primaryFile  Currently selected file path.
 * @param manifest     Component manifest (may be null if unavailable).
 * @param allFiles     All generated file paths.
 * @returns A suggested file path, or `null` if no good match is found.
 */
export function suggestPairedFile(
  primaryFile: string,
  manifest: ManifestPayload | null,
  allFiles: string[]
): string | null {
  // Strategy 1: Manifest — find files that share an irNodeId
  if (manifest) {
    const primaryNodeIds = new Set<string>();

    for (const screen of manifest.screens) {
      // Check screen-level file
      if (screen.file === primaryFile) {
        primaryNodeIds.add(screen.screenId);
      }
      // Check component entries
      for (const entry of screen.components) {
        if (entry.file === primaryFile) {
          primaryNodeIds.add(entry.irNodeId);
        }
      }
    }

    if (primaryNodeIds.size > 0) {
      // Find a different file that also maps to one of these node IDs
      for (const screen of manifest.screens) {
        if (screen.file !== primaryFile && primaryNodeIds.has(screen.screenId)) {
          return screen.file;
        }
        for (const entry of screen.components) {
          if (entry.file !== primaryFile && primaryNodeIds.has(entry.irNodeId)) {
            return entry.file;
          }
        }
      }
    }
  }

  // Strategy 2: Filename stem matching
  const stem = filenameStem(primaryFile);
  if (stem.length > 0) {
    for (const candidate of allFiles) {
      if (candidate === primaryFile) continue;
      if (filenameStem(candidate) === stem) {
        return candidate;
      }
    }
  }

  // Strategy 3: Pick the first file that isn't the primary
  for (const candidate of allFiles) {
    if (candidate !== primaryFile) {
      return candidate;
    }
  }

  return null;
}
