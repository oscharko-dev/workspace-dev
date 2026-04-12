import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  filesFromDataTransfer,
  loadReportFromFiles,
  loadReportFromUrl,
} from "./file-source";
import { screenKey } from "./report-loader";

const repoRoot = process.cwd();
const artifactRoot = path.join(repoRoot, "artifacts", "visual-benchmark");
const fixtureRoot = path.join(
  repoRoot,
  "integration",
  "fixtures",
  "visual-benchmark",
);

function withRelativePath(file: File, relativePath: string): File {
  Object.defineProperty(file, "webkitRelativePath", {
    value: relativePath.replace(/\\/g, "/"),
    configurable: true,
  });
  return file;
}

function makeJsonFile(relativePath: string, value: unknown): File {
  return withRelativePath(
    new File([JSON.stringify(value, null, 2)], path.basename(relativePath), {
      type: "application/json",
    }),
    relativePath,
  );
}

function makeDiskFile(relativePath: string, diskPath: string, type: string): File {
  return withRelativePath(
    new File([readFileSync(diskPath)], path.basename(relativePath), { type }),
    relativePath,
  );
}

describe("loadReportFromFiles", () => {
  let createObjectUrlSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    let sequence = 0;
    createObjectUrlSpy = vi
      .spyOn(URL, "createObjectURL")
      .mockImplementation((value: Blob | MediaSource) => {
        sequence += 1;
        const name =
          value instanceof File ? value.name : `blob-${String(sequence)}`;
        return `blob:test-${String(sequence)}-${name}`;
      });
  });

  afterEach(() => {
    createObjectUrlSpy.mockRestore();
    vi.restoreAllMocks();
  });

  it("attaches real benchmark reference images from fixture screen assets", async () => {
    const report = await loadReportFromFiles([
      makeJsonFile("artifacts/visual-benchmark/last-run.json", {
        version: 2,
        ranAt: "2026-04-11T00:00:00.000Z",
        overallScore: 92,
        scores: [
          {
            fixtureId: "simple-form",
            score: 92,
            screenId: "1:65671",
            screenName: "Bedarfsermittlung; Netto + Betriebsmittel; alle Cluster eingeklappt  ID-003.1_v1",
            viewportId: "desktop",
            viewportLabel: "Desktop",
          },
        ],
      }),
      makeDiskFile(
        "artifacts/visual-benchmark/last-run/simple-form/screens/1_65671/desktop/report.json",
        path.join(
          artifactRoot,
          "last-run/simple-form/screens/1_65671/desktop/report.json",
        ),
        "application/json",
      ),
      makeDiskFile(
        "artifacts/visual-benchmark/last-run/simple-form/screens/1_65671/desktop/actual.png",
        path.join(
          artifactRoot,
          "last-run/simple-form/screens/1_65671/desktop/actual.png",
        ),
        "image/png",
      ),
      makeDiskFile(
        "artifacts/visual-benchmark/last-run/simple-form/screens/1_65671/desktop/diff.png",
        path.join(
          artifactRoot,
          "last-run/simple-form/screens/1_65671/desktop/diff.png",
        ),
        "image/png",
      ),
      makeDiskFile(
        "integration/fixtures/visual-benchmark/simple-form/screens/1_65671/desktop.png",
        path.join(fixtureRoot, "simple-form/screens/1_65671/desktop.png"),
        "image/png",
      ),
    ]);

    const screen = report.screensByKey[screenKey("simple-form", "1:65671", "desktop")];
    expect(report.sourceKind).toBe("benchmark");
    expect(screen?.report).not.toBeNull();
    expect(screen?.actualUrl).toContain("actual.png");
    expect(screen?.diffUrl).toContain("diff.png");
    expect(screen?.referenceUrl).toContain("desktop.png");
  });

  it("matches benchmark artifacts using the escaped screen token encoding", async () => {
    const report = await loadReportFromFiles([
      makeJsonFile("bench/last-run.json", {
        version: 2,
        ranAt: "2026-04-11T00:00:00.000Z",
        overallScore: 97.3,
        scores: [
          {
            fixtureId: "alpha",
            score: 97.3,
            screenId: "home_view:1",
            screenName: "Home",
            viewportId: "desktop",
            viewportLabel: "Desktop",
          },
        ],
      }),
      makeJsonFile(
        "bench/last-run/alpha/screens/home~uview_1/desktop/report.json",
        {
          status: "completed",
          overallScore: 97.3,
          dimensions: [],
          hotspots: [],
        },
      ),
      makeDiskFile(
        "bench/last-run/alpha/screens/home~uview_1/desktop/actual.png",
        path.join(
          artifactRoot,
          "last-run/simple-form/screens/1_65671/desktop/actual.png",
        ),
        "image/png",
      ),
      makeDiskFile(
        "bench/last-run/alpha/screens/home~uview_1/desktop/diff.png",
        path.join(
          artifactRoot,
          "last-run/simple-form/screens/1_65671/desktop/diff.png",
        ),
        "image/png",
      ),
      makeDiskFile(
        "fixtures/alpha/screens/home~uview_1/desktop.png",
        path.join(fixtureRoot, "simple-form/screens/1_65671/desktop.png"),
        "image/png",
      ),
    ]);

    const screen = report.screensByKey[
      screenKey("alpha", "home_view:1", "desktop")
    ];
    expect(screen?.report?.overallScore).toBe(97.3);
    expect(screen?.referenceUrl).toContain("desktop.png");
  });

  it("loads a standalone visual-quality/report.json with sibling assets", async () => {
    const report = await loadReportFromFiles([
      makeJsonFile("jobs/job-1/visual-quality/report.json", {
        status: "completed",
        referenceSource: "frozen_fixture",
        capturedAt: "2026-04-11T12:00:00.000Z",
        overallScore: 98.8,
        interpretation: "Excellent parity",
        dimensions: [],
        hotspots: [],
        metadata: {
          imageWidth: 1280,
          imageHeight: 800,
          viewport: { width: 1280, height: 800, deviceScaleFactor: 1 },
        },
      }),
      makeDiskFile(
        "jobs/job-1/visual-quality/reference.png",
        path.join(fixtureRoot, "simple-form/reference.png"),
        "image/png",
      ),
      makeDiskFile(
        "jobs/job-1/visual-quality/actual.png",
        path.join(
          artifactRoot,
          "last-run/simple-form/screens/1_65671/desktop/actual.png",
        ),
        "image/png",
      ),
      makeDiskFile(
        "jobs/job-1/visual-quality/diff.png",
        path.join(
          artifactRoot,
          "last-run/simple-form/screens/1_65671/desktop/diff.png",
        ),
        "image/png",
      ),
    ]);

    const screen = report.screensByKey[
      screenKey("visual-quality", "visual-quality", "default")
    ];
    expect(report.sourceKind).toBe("visual-quality");
    expect(report.fixtures).toHaveLength(1);
    expect(screen?.report?.referenceSource).toBe("frozen_fixture");
    expect(screen?.referenceUrl).toContain("reference.png");
    expect(screen?.actualUrl).toContain("actual.png");
    expect(screen?.diffUrl).toContain("diff.png");
  });

  it("loads a visual-parity-report.json as summary-only state", async () => {
    const report = await loadReportFromFiles([
      makeJsonFile("reports/visual-parity-report.json", {
        status: "warn",
        mode: "strict",
        baselinePath: "/tmp/baseline.png",
        runtimePreviewUrl: "http://127.0.0.1:19835/workspace/repros/job-1/",
        maxDiffPixelRatio: 0.2,
        details: "Visual difference exceeded threshold.",
      }),
    ]);

    expect(report.sourceKind).toBe("visual-parity");
    expect(report.paritySummary?.status).toBe("warn");
    expect(report.paritySummary?.mode).toBe("strict");
    expect(report.fixtures).toEqual([]);
    expect(report.notices).toContain(
      "Per-screen overlays are unavailable for visual-parity-report.json because it does not include image artifacts.",
    );
  });
});

describe("filesFromDataTransfer", () => {
  it("drains all WebKit readEntries batches when traversing directories", async () => {
    const fileA = new File(["a"], "a.txt", { type: "text/plain" });
    const fileB = new File(["b"], "b.txt", { type: "text/plain" });
    const fileC = new File(["c"], "c.txt", { type: "text/plain" });

    type Entry = {
      isFile: boolean;
      isDirectory: boolean;
      fullPath: string;
      file?: (cb: (file: File) => void, err: (error: Error) => void) => void;
      createReader?: () => {
        readEntries: (
          cb: (entries: Entry[]) => void,
          err: (error: Error) => void,
        ) => void;
      };
    };

    const fileEntry = (file: File, fullPath: string): Entry => ({
      isFile: true,
      isDirectory: false,
      fullPath,
      file: (cb) => cb(file),
    });

    const directoryEntry = (fullPath: string, batches: Entry[][]): Entry => ({
      isFile: false,
      isDirectory: true,
      fullPath,
      createReader: () => {
        let index = 0;
        return {
          readEntries: (cb) => {
            const batch = batches[index] ?? [];
            index += 1;
            cb(batch);
          },
        };
      },
    });

    const nested = directoryEntry("/root/nested", [
      [fileEntry(fileC, "/root/nested/c.txt")],
      [],
    ]);
    const root = directoryEntry("/root", [
      [fileEntry(fileA, "/root/a.txt"), nested],
      [fileEntry(fileB, "/root/b.txt")],
      [],
    ]);

    const files = await filesFromDataTransfer({
      items: [
        {
          webkitGetAsEntry: () => root,
        },
      ],
      files: {
        length: 0,
        item: () => null,
      },
    } as unknown as DataTransfer);

    expect(files).toHaveLength(3);
    expect(files.map((file) => file.name).sort()).toEqual(["a.txt", "b.txt", "c.txt"]);
    expect(
      (files.find((file) => file.name === "b.txt") as File & {
        webkitRelativePath?: string;
      }).webkitRelativePath,
    ).toBe("root/b.txt");
    expect(
      (files.find((file) => file.name === "c.txt") as File & {
        webkitRelativePath?: string;
      }).webkitRelativePath,
    ).toBe("root/nested/c.txt");
  });
});

describe("loadReportFromUrl", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("loads a remote visual-quality/report.json and derives sibling asset URLs", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          status: "completed",
          referenceSource: "frozen_fixture",
          capturedAt: "2026-04-11T12:00:00.000Z",
          overallScore: 99.1,
          interpretation: "Excellent parity",
          dimensions: [],
          hotspots: [],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    const report = await loadReportFromUrl(
      "https://example.test/workspace/jobs/job-1/files/visual-quality/report.json",
    );

    const screen = report.screensByKey[
      screenKey("visual-quality", "visual-quality", "default")
    ];
    expect(report.sourceKind).toBe("visual-quality");
    expect(screen?.referenceUrl).toBe(
      "https://example.test/workspace/jobs/job-1/files/visual-quality/reference.png",
    );
    expect(screen?.actualUrl).toBe(
      "https://example.test/workspace/jobs/job-1/files/visual-quality/actual.png",
    );
    expect(screen?.diffUrl).toBe(
      "https://example.test/workspace/jobs/job-1/files/visual-quality/diff.png",
    );
  });

  it("loads a remote visual-parity-report.json as summary-only state", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          status: "passed",
          mode: "warn",
          baselinePath: "/tmp/baseline.png",
          runtimePreviewUrl: "https://example.test/workspace/repros/job-1/",
          maxDiffPixelRatio: 0.2,
          details: "Generated preview matches baseline within threshold.",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    const report = await loadReportFromUrl(
      "https://example.test/reports/visual-parity-report.json",
    );

    expect(report.sourceKind).toBe("visual-parity");
    expect(report.paritySummary?.status).toBe("passed");
    expect(report.notices).toContain(
      "Per-screen overlays are unavailable for visual-parity-report.json because it does not include image artifacts.",
    );
  });

  it("surfaces HTTP fetch failures with the report URL in the message", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("not found", { status: 404 }),
    );

    await expect(
      loadReportFromUrl("https://example.test/reports/missing-report.json"),
    ).rejects.toThrow(
      /Failed to fetch report from https:\/\/example\.test\/reports\/missing-report\.json: HTTP 404/,
    );
  });
});
