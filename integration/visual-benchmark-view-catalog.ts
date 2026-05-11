import { readFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

const MODULE_DIR =
  typeof __dirname === "string"
    ? __dirname
    : path.dirname(fileURLToPath(import.meta.url))

const DEFAULT_CATALOG_PATH = path.resolve(
  MODULE_DIR,
  "fixtures",
  "visual-benchmark",
  "benchmark-views.json",
)

export interface VisualBenchmarkViewCatalogEntry {
  fixtureId: string
  label: string
  fileKey: string
  nodeId: string
  nodeName: string
  referenceVersion: number
  export: {
    format: "png"
    scale: number
  }
  comparison: {
    viewportId: string
    maxDiffPercent: number
  }
}

export interface VisualBenchmarkViewCatalog {
  version: 2
  views: VisualBenchmarkViewCatalogEntry[]
}

// Keep the benchmark representative by requiring at least the canonical
// five-view cross-section, while still allowing safe expansion.
const MIN_CANONICAL_VIEWS = 5
const DEFAULT_MAX_DIFF_PERCENT = 0.1
const ALLOWED_VIEWPORT_ID_PATTERN = /^[A-Za-z0-9_-]+$/u

const isPlainRecord = (
  value: unknown,
): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

const readRequiredString = (
  value: unknown,
  fieldName: string,
): string => {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${fieldName} must be a non-empty string.`)
  }
  return value.trim()
}

const readPositiveNumber = (
  value: unknown,
  fieldName: string,
): number => {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${fieldName} must be a positive number.`)
  }
  return parsed
}

const readPositiveInteger = (
  value: unknown,
  fieldName: string,
): number => {
  const parsed = readPositiveNumber(value, fieldName)
  if (!Number.isInteger(parsed)) {
    throw new Error(`${fieldName} must be a positive integer.`)
  }
  return parsed
}

const readViewportId = (
  value: unknown,
  fieldName: string,
): string => {
  const viewportId = readRequiredString(value, fieldName)
  if (!ALLOWED_VIEWPORT_ID_PATTERN.test(viewportId)) {
    throw new Error(
      `${fieldName} contains invalid characters (allowed: A-Z, a-z, 0-9, '_', '-').`,
    )
  }
  return viewportId
}

const readMaxDiffPercent = (
  value: unknown,
  fieldName: string,
): number => {
  if (value === undefined) {
    return DEFAULT_MAX_DIFF_PERCENT
  }
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100) {
    throw new Error(`${fieldName} must be a number between 0 and 100.`)
  }
  return parsed
}

const parseCatalogEntry = (
  value: unknown,
  index: number,
): VisualBenchmarkViewCatalogEntry => {
  if (!isPlainRecord(value)) {
    throw new Error(
      `benchmark-views.json entry #${String(index + 1)} must be an object.`,
    )
  }
  const exportConfig = value.export
  if (!isPlainRecord(exportConfig)) {
    throw new Error(
      `benchmark-views.json views[${String(index)}].export must be an object.`,
    )
  }
  const format = readRequiredString(
    exportConfig.format,
    `benchmark-views.json views[${String(index)}].export.format`,
  )
  if (format !== "png") {
    throw new Error(
      `benchmark-views.json views[${String(index)}].export.format must be 'png'.`,
    )
  }
  const comparison = value.comparison
  if (!isPlainRecord(comparison)) {
    throw new Error(
      `benchmark-views.json views[${String(index)}].comparison must be an object.`,
    )
  }

  return {
    fixtureId: readRequiredString(
      value.fixtureId,
      `benchmark-views.json views[${String(index)}].fixtureId`,
    ),
    label: readRequiredString(
      value.label,
      `benchmark-views.json views[${String(index)}].label`,
    ),
    fileKey: readRequiredString(
      value.fileKey,
      `benchmark-views.json views[${String(index)}].fileKey`,
    ),
    nodeId: readRequiredString(
      value.nodeId,
      `benchmark-views.json views[${String(index)}].nodeId`,
    ),
    nodeName: readRequiredString(
      value.nodeName,
      `benchmark-views.json views[${String(index)}].nodeName`,
    ),
    referenceVersion: readPositiveInteger(
      value.referenceVersion,
      `benchmark-views.json views[${String(index)}].referenceVersion`,
    ),
    export: {
      format: "png",
      scale: readPositiveNumber(
        exportConfig.scale,
        `benchmark-views.json views[${String(index)}].export.scale`,
      ),
    },
    comparison: {
      viewportId: readViewportId(
        comparison.viewportId,
        `benchmark-views.json views[${String(index)}].comparison.viewportId`,
      ),
      maxDiffPercent: readMaxDiffPercent(
        comparison.maxDiffPercent,
        `benchmark-views.json views[${String(index)}].comparison.maxDiffPercent`,
      ),
    },
  }
}

const assertUniqueBy = (
  views: readonly VisualBenchmarkViewCatalogEntry[],
  accessor: (entry: VisualBenchmarkViewCatalogEntry) => string,
  fieldName: string,
): void => {
  const seen = new Set<string>()
  for (const view of views) {
    const key = accessor(view)
    if (seen.has(key)) {
      throw new Error(
        `benchmark-views.json contains duplicate ${fieldName} '${key}'.`,
      )
    }
    seen.add(key)
  }
}

export const parseVisualBenchmarkViewCatalog = (
  input: string,
): VisualBenchmarkViewCatalog => {
  const parsed = JSON.parse(input) as unknown
  if (!isPlainRecord(parsed)) {
    throw new Error("benchmark-views.json must be a JSON object.")
  }
  if (parsed.version !== 2) {
    throw new Error("benchmark-views.json version must be exactly 2.")
  }
  if (!Array.isArray(parsed.views)) {
    throw new Error("benchmark-views.json views must be an array.")
  }
  const views = parsed.views.map((entry, index) =>
    parseCatalogEntry(entry, index),
  )
  if (views.length < MIN_CANONICAL_VIEWS) {
    throw new Error(
      `benchmark-views.json must contain at least ${String(MIN_CANONICAL_VIEWS)} views (received ${String(views.length)}).`,
    )
  }
  assertUniqueBy(views, (entry) => entry.fixtureId, "fixtureId")
  assertUniqueBy(views, (entry) => entry.label, "label")
  return {
    version: 2,
    views,
  }
}

export const loadVisualBenchmarkViewCatalog = async (
  catalogPath: string = DEFAULT_CATALOG_PATH,
): Promise<VisualBenchmarkViewCatalog> => {
  const content = await readFile(catalogPath, "utf8")
  return parseVisualBenchmarkViewCatalog(content)
}

export const toCatalogViewMapByFixture = (
  catalog: VisualBenchmarkViewCatalog,
): ReadonlyMap<string, VisualBenchmarkViewCatalogEntry> => {
  return new Map(catalog.views.map((entry) => [entry.fixtureId, entry]))
}

export const getDefaultVisualBenchmarkViewCatalogPath = (): string =>
  DEFAULT_CATALOG_PATH

export interface VisualBenchmarkCanonicalReferencePaths {
  canonicalRootDir: string
  fixtureVersionDir: string
  figmaPngPath: string
  referenceMetaJsonPath: string
}

export const resolveVisualBenchmarkCanonicalReferencePaths = (
  view: Pick<VisualBenchmarkViewCatalogEntry, "fixtureId" | "referenceVersion">,
  options?: {
    fixtureRoot?: string
    catalogPath?: string
  },
): VisualBenchmarkCanonicalReferencePaths => {
  const fixtureRoot =
    options?.fixtureRoot ??
    path.dirname(options?.catalogPath ?? DEFAULT_CATALOG_PATH)
  const canonicalRootDir = path.join(fixtureRoot, "canonical")
  const fixtureVersionDir = path.join(
    canonicalRootDir,
    view.fixtureId,
    `v${String(view.referenceVersion)}`,
  )
  return {
    canonicalRootDir,
    fixtureVersionDir,
    figmaPngPath: path.join(fixtureVersionDir, "figma.png"),
    referenceMetaJsonPath: path.join(fixtureVersionDir, "reference-meta.json"),
  }
}
