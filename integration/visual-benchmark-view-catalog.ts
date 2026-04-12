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
}

export interface VisualBenchmarkViewCatalog {
  version: 1
  views: VisualBenchmarkViewCatalogEntry[]
}

// Keep the benchmark representative by requiring at least the canonical
// five-view cross-section, while still allowing safe expansion.
const MIN_CANONICAL_VIEWS = 5

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

const parseCatalogEntry = (
  value: unknown,
  index: number,
): VisualBenchmarkViewCatalogEntry => {
  if (!isPlainRecord(value)) {
    throw new Error(
      `benchmark-views.json entry #${String(index + 1)} must be an object.`,
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
  if (parsed.version !== 1) {
    throw new Error("benchmark-views.json version must be exactly 1.")
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
  return {
    version: 1,
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
