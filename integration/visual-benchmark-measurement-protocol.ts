import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import {
  computeVisualBenchmarkDeltas,
  loadVisualBenchmarkBaseline,
  loadVisualBenchmarkLastRun,
  type VisualBenchmarkScoreEntry,
} from "./visual-benchmark-runner.js"
import { loadVisualBenchmarkViewCatalog } from "./visual-benchmark-view-catalog.js"

interface MeasurementRow {
  fixtureId: string
  label: string
  fileKey: string
  nodeId: string
  currentScore: number | null
  baselineScore: number | null
  delta: number | null
}

interface MeasurementProtocol {
  generatedAt: string
  fixtureCount: number
  overallCurrent: number | null
  overallBaseline: number | null
  overallDelta: number | null
  rows: MeasurementRow[]
}

const OUTPUT_ROOT = path.resolve(process.cwd(), "artifacts", "visual-benchmark")
const OUTPUT_JSON_PATH = path.join(OUTPUT_ROOT, "measurement-protocol.json")
const OUTPUT_MD_PATH = path.join(OUTPUT_ROOT, "measurement-protocol.md")

const averageScore = (
  scores: readonly VisualBenchmarkScoreEntry[],
): number | null => {
  if (scores.length === 0) {
    return null
  }
  const total = scores.reduce((sum, entry) => sum + entry.score, 0)
  return Math.round((total / scores.length) * 100) / 100
}

const formatScore = (value: number | null): string =>
  value === null ? "n/a" : value.toFixed(2)

const formatDelta = (value: number | null): string => {
  if (value === null) {
    return "n/a"
  }
  const prefix = value > 0 ? "+" : ""
  return `${prefix}${value.toFixed(2)}`
}

const buildMarkdown = (protocol: MeasurementProtocol): string => {
  const lines: string[] = []
  lines.push("# Visual Benchmark Measurement Protocol")
  lines.push("")
  lines.push(`Generated at: ${protocol.generatedAt}`)
  lines.push(`Fixture count: ${String(protocol.fixtureCount)}`)
  lines.push(`Overall current: ${formatScore(protocol.overallCurrent)}`)
  lines.push(`Overall baseline: ${formatScore(protocol.overallBaseline)}`)
  lines.push(`Overall delta: ${formatDelta(protocol.overallDelta)}`)
  lines.push("")
  lines.push("| Fixture | Benchmark View | File Key | Node ID | Current | Baseline | Delta |")
  lines.push("| --- | --- | --- | --- | ---: | ---: | ---: |")
  for (const row of protocol.rows) {
    lines.push(
      `| ${row.fixtureId} | ${row.label} | ${row.fileKey} | ${row.nodeId} | ${formatScore(row.currentScore)} | ${formatScore(row.baselineScore)} | ${formatDelta(row.delta)} |`,
    )
  }
  lines.push("")
  return `${lines.join("\n")}\n`
}

export const generateVisualBenchmarkMeasurementProtocol =
  async (): Promise<MeasurementProtocol> => {
    const [catalog, lastRun, baseline] = await Promise.all([
      loadVisualBenchmarkViewCatalog(),
      loadVisualBenchmarkLastRun(),
      loadVisualBenchmarkBaseline(),
    ])
    if (lastRun === null) {
      throw new Error(
        "No visual benchmark last-run.json found. Run 'pnpm benchmark:visual' first.",
      )
    }

    const deltas = computeVisualBenchmarkDeltas(lastRun.scores, baseline)
    const rows: MeasurementRow[] = catalog.views.map((view) => {
      const currentEntries = lastRun.scores.filter(
        (entry) => entry.fixtureId === view.fixtureId,
      )
      const baselineEntries =
        baseline?.scores.filter((entry) => entry.fixtureId === view.fixtureId) ??
        []
      const currentScore = averageScore(currentEntries)
      const baselineScore = averageScore(baselineEntries)
      return {
        fixtureId: view.fixtureId,
        label: view.label,
        fileKey: view.fileKey,
        nodeId: view.nodeId,
        currentScore,
        baselineScore,
        delta:
          currentScore !== null && baselineScore !== null
            ? Math.round((currentScore - baselineScore) * 100) / 100
            : null,
      }
    })

    return {
      generatedAt: new Date().toISOString(),
      fixtureCount: catalog.views.length,
      overallCurrent: deltas.overallCurrent,
      overallBaseline: deltas.overallBaseline,
      overallDelta: deltas.overallDelta,
      rows,
    }
  }

const main = async (): Promise<void> => {
  const protocol = await generateVisualBenchmarkMeasurementProtocol()
  await mkdir(OUTPUT_ROOT, { recursive: true })
  await writeFile(OUTPUT_JSON_PATH, JSON.stringify(protocol, null, 2), "utf8")
  await writeFile(OUTPUT_MD_PATH, buildMarkdown(protocol), "utf8")
  process.stdout.write(
    `Wrote measurement protocol:\n- ${OUTPUT_JSON_PATH}\n- ${OUTPUT_MD_PATH}\n`,
  )
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main()
}
