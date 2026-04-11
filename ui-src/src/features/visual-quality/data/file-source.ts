import { parseHistory, parseLastRun, parseScreenReport } from "./report-schema";
import { mergeReport, screenKey, type ScreenArtifacts } from "./report-loader";
import { type MergedReport } from "./types";

interface PickedFile {
  readonly name: string;
  readonly path: string;
  readonly file: File;
}

/**
 * Normalizes the best-available path for a File. `webkitRelativePath` is set
 * when the user picks a directory; otherwise we fall back to the file name.
 */
function filePath(file: File): string {
  const relative = (file as File & { webkitRelativePath?: string })
    .webkitRelativePath;
  if (typeof relative === "string" && relative.length > 0) {
    return relative;
  }
  return file.name;
}

async function readText(file: File): Promise<string> {
  return await file.text();
}

function pickByName(
  pool: PickedFile[],
  needle: string,
): PickedFile | undefined {
  return pool.find((f) => f.name === needle);
}

/**
 * Extracts `{fixtureId, screenIdToken, viewport}` from a file path that follows
 * the on-disk convention used by the visual benchmark artifacts:
 *   `…/{fixtureId}/screens/{screenIdToken}/{viewport}/{diff|actual|report}.*`
 * Returns null if the path does not match.
 */
export function parseScreenPath(
  path: string,
): { fixtureId: string; screenIdToken: string; viewport: string } | null {
  const segments = path.split("/");
  const screensIndex = segments.indexOf("screens");
  if (screensIndex <= 0) {
    return null;
  }
  const fixtureId = segments[screensIndex - 1];
  const screenIdToken = segments[screensIndex + 1];
  const viewport = segments[screensIndex + 2];
  if (
    fixtureId === undefined ||
    screenIdToken === undefined ||
    viewport === undefined ||
    fixtureId.length === 0 ||
    screenIdToken.length === 0 ||
    viewport.length === 0
  ) {
    return null;
  }
  return { fixtureId, screenIdToken, viewport };
}

/**
 * Consumes a set of dropped files (which may include a directory tree) and
 * produces a `MergedReport`. The user must provide at least a `last-run.json`.
 * `report.json` files and diff/actual/reference PNGs are matched by path.
 *
 * Throws if `last-run.json` is missing or invalid.
 */
export async function loadReportFromFiles(
  files: File[],
): Promise<MergedReport> {
  const picked: PickedFile[] = files.map((file) => ({
    name: file.name,
    path: filePath(file),
    file,
  }));

  const lastRunFile = pickByName(picked, "last-run.json");
  if (!lastRunFile) {
    throw new Error("last-run.json was not found in the selected files.");
  }
  const aggregate = parseLastRun(
    JSON.parse(await readText(lastRunFile.file)) as unknown,
  );

  let history = null;
  const historyFile = pickByName(picked, "history.json");
  if (historyFile) {
    try {
      history = parseHistory(
        JSON.parse(await readText(historyFile.file)) as unknown,
      );
    } catch {
      history = null;
    }
  }

  const artifactsByKey: Record<string, ScreenArtifacts> = {};

  function ensureEntry(key: string): ScreenArtifacts {
    let entry = artifactsByKey[key];
    if (!entry) {
      entry = {};
      artifactsByKey[key] = entry;
    }
    return entry;
  }

  for (const item of picked) {
    if (item.name === "last-run.json" || item.name === "history.json") {
      continue;
    }
    const loc = parseScreenPath(item.path);
    if (!loc) {
      continue;
    }
    // Skip per-browser assets — we key on the main viewport directory only.
    const afterScreens = item.path.split("/screens/")[1];
    if (afterScreens && afterScreens.split("/").length > 3) {
      continue;
    }
    const key = `${loc.fixtureId}/${loc.screenIdToken}/${loc.viewport}`;
    const entry = ensureEntry(key);
    if (item.name === "report.json") {
      try {
        entry.report = parseScreenReport(
          JSON.parse(await readText(item.file)) as unknown,
        );
      } catch {
        // Skip malformed per-screen reports; the aggregate score is still usable.
      }
    } else if (item.name === "diff.png") {
      entry.diffUrl = URL.createObjectURL(item.file);
    } else if (item.name === "actual.png") {
      entry.actualUrl = URL.createObjectURL(item.file);
    } else if (item.name === "reference.png") {
      entry.referenceUrl = URL.createObjectURL(item.file);
    }
  }

  return mergeReport(aggregate, artifactsByKey, history);
}

/**
 * Extracts a `File[]` from a `DataTransfer` (drag-and-drop event). Supports
 * both the flat `files` list and the tree-walking `items.webkitGetAsEntry()`
 * API so users can drop an entire `artifacts/visual-benchmark/` directory.
 */
export async function filesFromDataTransfer(dt: DataTransfer): Promise<File[]> {
  const collected: File[] = [];
  const items = dt.items;

  type FileSystemEntryShim = {
    isFile: boolean;
    isDirectory: boolean;
    fullPath: string;
    file?: (cb: (file: File) => void, err: (error: Error) => void) => void;
    createReader?: () => {
      readEntries: (
        cb: (entries: FileSystemEntryShim[]) => void,
        err: (error: Error) => void,
      ) => void;
    };
  };

  async function readEntry(entry: FileSystemEntryShim): Promise<void> {
    if (entry.isFile && typeof entry.file === "function") {
      const fileFn = entry.file.bind(entry);
      await new Promise<void>((resolve, reject) => {
        fileFn(
          (file) => {
            try {
              Object.defineProperty(file, "webkitRelativePath", {
                value: entry.fullPath.replace(/^\//, ""),
                configurable: true,
              });
            } catch {
              // Some implementations do not allow override; tolerate silently.
            }
            collected.push(file);
            resolve();
          },
          (error) => {
            reject(error);
          },
        );
      });
      return;
    }
    if (entry.isDirectory && typeof entry.createReader === "function") {
      const reader = entry.createReader();
      const batch = await new Promise<FileSystemEntryShim[]>(
        (resolve, reject) => {
          reader.readEntries(
            (entries) => {
              resolve(entries);
            },
            (error) => {
              reject(error);
            },
          );
        },
      );
      for (const child of batch) {
        await readEntry(child);
      }
    }
  }

  const entries: FileSystemEntryShim[] = [];
  for (let i = 0; i < items.length; i += 1) {
    const item = items[i];
    if (!item) {
      continue;
    }
    const maybeGet = (
      item as DataTransferItem & {
        webkitGetAsEntry?: () => FileSystemEntryShim | null;
      }
    ).webkitGetAsEntry;
    if (typeof maybeGet === "function") {
      const entry = maybeGet.call(item);
      if (entry) {
        entries.push(entry);
      }
    }
  }

  if (entries.length > 0) {
    for (const entry of entries) {
      await readEntry(entry);
    }
    if (collected.length > 0) {
      return collected;
    }
  }

  const flat = dt.files;
  for (let i = 0; i < flat.length; i += 1) {
    const file = flat.item(i);
    if (file) {
      collected.push(file);
    }
  }
  return collected;
}

/**
 * Fetches a remote `last-run.json` from an arbitrary URL and hydrates the
 * merged report. Images are not inlined — the UI will render metrics and
 * surface a notice that no image assets are attached.
 */
export async function loadReportFromUrl(
  reportUrl: string,
): Promise<MergedReport> {
  const response = await fetch(reportUrl);
  if (!response.ok) {
    throw new Error(
      `Failed to fetch report from ${reportUrl}: HTTP ${String(response.status)}`,
    );
  }
  const raw: unknown = await response.json();
  const aggregate = parseLastRun(raw);
  return mergeReport(aggregate, {}, null);
}

export { screenKey };
