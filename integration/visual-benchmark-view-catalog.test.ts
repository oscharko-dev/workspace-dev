import assert from "node:assert/strict"
import test from "node:test"
import {
  getDefaultVisualBenchmarkViewCatalogPath,
  loadVisualBenchmarkViewCatalog,
  parseVisualBenchmarkViewCatalog,
  toCatalogViewMapByFixture,
} from "./visual-benchmark-view-catalog.js"
import { loadVisualBenchmarkFixtureMetadata } from "./visual-benchmark.helpers.js"

test("loadVisualBenchmarkViewCatalog validates the committed canonical view cross-section", async () => {
  const catalog = await loadVisualBenchmarkViewCatalog()
  assert.equal(catalog.version, 1)
  assert.ok(catalog.views.length >= 5)

  const labels = new Set(catalog.views.map((entry) => entry.label))
  for (const expectedLabel of [
    "Test-View-01",
    "Test-View-02",
    "Test-View-03",
    "Test-View-04",
    "Test-View-05",
  ]) {
    assert.equal(labels.has(expectedLabel), true)
  }
})

test("parseVisualBenchmarkViewCatalog rejects duplicate fixture ids", () => {
  assert.throws(
    () =>
      parseVisualBenchmarkViewCatalog(
        JSON.stringify({
          version: 1,
          views: [
            {
              fixtureId: "simple-form",
              label: "A",
              fileKey: "X1",
              nodeId: "1:1",
              nodeName: "Node A",
            },
            {
              fixtureId: "simple-form",
              label: "B",
              fileKey: "X2",
              nodeId: "1:2",
              nodeName: "Node B",
            },
            {
              fixtureId: "complex-dashboard",
              label: "C",
              fileKey: "X3",
              nodeId: "1:3",
              nodeName: "Node C",
            },
            {
              fixtureId: "data-table",
              label: "D",
              fileKey: "X4",
              nodeId: "1:4",
              nodeName: "Node D",
            },
            {
              fixtureId: "navigation-sidebar",
              label: "E",
              fileKey: "X5",
              nodeId: "1:5",
              nodeName: "Node E",
            },
          ],
        }),
      ),
    /duplicate fixtureId/,
  )
})

test("parseVisualBenchmarkViewCatalog allows extending beyond the canonical five views", () => {
  const catalog = parseVisualBenchmarkViewCatalog(
    JSON.stringify({
      version: 1,
      views: [
        { fixtureId: "simple-form", label: "A", fileKey: "X1", nodeId: "1:1", nodeName: "Node A" },
        { fixtureId: "complex-dashboard", label: "B", fileKey: "X1", nodeId: "1:2", nodeName: "Node B" },
        { fixtureId: "data-table", label: "C", fileKey: "X2", nodeId: "1:3", nodeName: "Node C" },
        { fixtureId: "navigation-sidebar", label: "D", fileKey: "X3", nodeId: "1:4", nodeName: "Node D" },
        { fixtureId: "design-system-showcase", label: "E", fileKey: "X4", nodeId: "1:5", nodeName: "Node E" },
        { fixtureId: "advanced-kpi", label: "F", fileKey: "X4", nodeId: "1:6", nodeName: "Node F" },
      ],
    }),
  )

  assert.equal(catalog.version, 1)
  assert.equal(catalog.views.length, 6)
})

test("parseVisualBenchmarkViewCatalog rejects catalogs with fewer than five views", () => {
  assert.throws(
    () =>
      parseVisualBenchmarkViewCatalog(
        JSON.stringify({
          version: 1,
          views: [
            { fixtureId: "simple-form", label: "A", fileKey: "X1", nodeId: "1:1", nodeName: "Node A" },
            { fixtureId: "complex-dashboard", label: "B", fileKey: "X2", nodeId: "1:2", nodeName: "Node B" },
            { fixtureId: "data-table", label: "C", fileKey: "X3", nodeId: "1:3", nodeName: "Node C" },
            { fixtureId: "navigation-sidebar", label: "D", fileKey: "X4", nodeId: "1:4", nodeName: "Node D" },
          ],
        }),
      ),
    /at least 5 views/,
  )
})

test("committed fixture metadata source fields stay aligned with benchmark-views catalog", async () => {
  const catalog = await loadVisualBenchmarkViewCatalog()
  const byFixture = toCatalogViewMapByFixture(catalog)

  for (const [fixtureId, view] of byFixture.entries()) {
    const metadata = await loadVisualBenchmarkFixtureMetadata(fixtureId)
    assert.equal(metadata.source.fileKey, view.fileKey)
    assert.equal(metadata.source.nodeId, view.nodeId)
    assert.equal(metadata.source.nodeName, view.nodeName)
  }
})

test("benchmark view catalog path resolves to committed fixtures tree", () => {
  const catalogPath = getDefaultVisualBenchmarkViewCatalogPath()
  assert.match(catalogPath, /integration[\/\\]fixtures[\/\\]visual-benchmark[\/\\]benchmark-views\.json$/)
})
