import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const MODULE_DIR =
  typeof import.meta.dirname === "string"
    ? import.meta.dirname
    : path.dirname(fileURLToPath(import.meta.url));
const SCRIPT_PATH = path.join(MODULE_DIR, "validate-ui-report.mjs");

const createWorkspace = async (files) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "validate-ui-report-"));
  await Promise.all(
    Object.entries(files).map(async ([relativePath, content]) => {
      const absolutePath = path.join(root, relativePath);
      await mkdir(path.dirname(absolutePath), { recursive: true });
      await writeFile(absolutePath, content, "utf8");
    })
  );
  return root;
};

const runValidateUiReport = (cwd) => {
  const reportPath = path.join(cwd, "ui-gate-report.json");
  const baselinePath = path.join(cwd, ".figmapipe", "ui-gate-visual-baseline.json");

  const result = spawnSync(process.execPath, [SCRIPT_PATH], {
    cwd,
    env: {
      ...process.env,
      FIGMAPIPE_UI_GATE_CHANGED_SURFACES_JSON: JSON.stringify(["src"]),
      FIGMAPIPE_UI_GATE_BASELINE_PATH: baselinePath,
      FIGMAPIPE_UI_GATE_REPORT_PATH: reportPath
    },
    encoding: "utf8"
  });

  return { baselinePath, reportPath, result };
};

const readJson = async (filePath) => {
  return JSON.parse(await readFile(filePath, "utf8"));
};

describe("validate-ui-report", () => {
  it("flags a real IconButton missing aria-label", async () => {
    const workspace = await createWorkspace({
      "src/missing-label.tsx": `
        import { IconButton } from "@mui/material";

        export const MissingLabel = () => {
          return (
            <div>
              <IconButton />
              <button>Submit</button>
            </div>
          );
        };
      `
    });

    try {
      const { reportPath, result } = runValidateUiReport(workspace);
      expect(result.status).toBe(1);
      const report = await readJson(reportPath);
      const findings = await readJson(path.join(workspace, "ui-gate-a11y-findings.json"));
      const interactions = await readJson(path.join(workspace, "ui-gate-interaction-findings.json"));

      expect(report.a11yViolationCount).toBe(1);
      expect(report.interactionViolationCount).toBe(1);
      expect(report.checks).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            name: "a11y-static",
            status: "failed",
            count: 1
          }),
          expect.objectContaining({
            name: "interaction-static",
            status: "failed",
            count: 1
          })
        ])
      );
      expect(findings).toEqual([
        expect.objectContaining({
          file: "src/missing-label.tsx",
          rule: "IconButton requires aria-label",
          occurrences: 1
        })
      ]);
      expect(interactions).toEqual([
        expect.objectContaining({
          file: "src/missing-label.tsx",
          rule: "button requires explicit type",
          occurrences: 1
        })
      ]);
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });

  it("does not flag template metric cards rendered with article elements", async () => {
    const workspace = await createWorkspace({
      "src/App.tsx": `
        const metrics = [
          { label: "Components", value: "12" },
          { label: "Views", value: "3" },
          { label: "Checks", value: "100%" },
        ] as const;

        function App() {
          return (
            <main className="min-h-screen bg-slate-50 text-slate-950 dark:bg-slate-950 dark:text-slate-50">
              <section className="mx-auto flex min-h-screen w-full max-w-6xl flex-col justify-center gap-10 px-6 py-10 sm:px-8 lg:px-10">
                <div className="max-w-3xl">
                  <p className="text-sm font-semibold tracking-wide text-teal-700 uppercase dark:text-teal-300">
                    WorkspaceDev default template
                  </p>
                  <h1 className="mt-4 text-4xl font-semibold text-balance sm:text-5xl">
                    React, TypeScript, Vite, and Tailwind ready for generated apps.
                  </h1>
                </div>

                <div className="grid gap-4 sm:grid-cols-3">
                  {metrics.map((metric) => (
                    <article
                      className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900"
                      key={metric.label}
                    >
                      <p className="text-sm text-slate-600 dark:text-slate-400">
                        {metric.label}
                      </p>
                      <p className="mt-2 text-3xl font-semibold">{metric.value}</p>
                    </article>
                  ))}
                </div>
              </section>
            </main>
          );
        }

        export default App;
      `
    });

    try {
      const { reportPath, result } = runValidateUiReport(workspace);
      expect(result.status).toBe(0);
      const report = await readJson(reportPath);
      const findings = await readJson(path.join(workspace, "ui-gate-a11y-findings.json"));
      const interactions = await readJson(path.join(workspace, "ui-gate-interaction-findings.json"));

      expect(report.a11yViolationCount).toBe(0);
      expect(report.interactionViolationCount).toBe(0);
      expect(report.checks).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            name: "a11y-static",
            status: "passed",
            count: 0
          }),
          expect.objectContaining({
            name: "interaction-static",
            status: "passed",
            count: 0
          })
        ])
      );
      expect(findings).toEqual([]);
      expect(interactions).toEqual([]);
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });

  it("fails the exit code when the baseline diff changes", async () => {
    const workspace = await createWorkspace({
      "src/valid-icon-button.tsx": `
        import { IconButton } from "@mui/material";

        export const ValidIconButton = () => {
          return <IconButton aria-label="Close" />;
        };
      `
    });

    try {
      const baselinePath = path.join(
        workspace,
        ".figmapipe",
        "ui-gate-visual-baseline.json"
      );
      await mkdir(path.dirname(baselinePath), { recursive: true });
      await writeFile(
        baselinePath,
        `${JSON.stringify(
          {
            generatedAt: "2024-01-01T00:00:00.000Z",
            signatures: {
              "src/valid-icon-button.tsx": "baseline-diff"
            }
          },
          null,
          2
        )}\n`,
        "utf8"
      );

      const { reportPath, result } = runValidateUiReport(workspace);
      expect(result.status).toBe(1);

      const report = await readJson(reportPath);
      const visualDiffs = await readJson(path.join(workspace, "ui-gate-visual-diffs.json"));

      expect(report.visualDiffCount).toBe(1);
      expect(report.a11yViolationCount).toBe(0);
      expect(report.interactionViolationCount).toBe(0);
      expect(report.checks).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            name: "visual-baseline",
            status: "failed",
            count: 1
          })
        ])
      );
      expect(visualDiffs).toEqual([
        expect.objectContaining({
          path: "src/valid-icon-button.tsx"
        })
      ]);
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });

  it("ignores comment text and quoted attribute text while keeping valid IconButton labels", async () => {
    const workspace = await createWorkspace({
      "src/valid-icon-button.tsx": `
        import { IconButton } from "@mui/material";

        export const ValidIconButton = () => {
          return <IconButton aria-label="Close" />;
        };
      `,
      "src/comment-text.tsx": `
        // <IconButton />
        /* <IconButton aria-label="Comment" /> */

        export const CommentText = () => <div />;
      `,
      "src/quoted-text.tsx": `
        export const QuotedText = () => {
          return <div data-ir-name="<IconButton>" title="<IconButton />" />;
        };
      `
    });

    try {
      const { reportPath, result } = runValidateUiReport(workspace);
      expect(result.status).toBe(0);
      const report = await readJson(reportPath);
      const findings = await readJson(path.join(workspace, "ui-gate-a11y-findings.json"));
      const interactions = await readJson(path.join(workspace, "ui-gate-interaction-findings.json"));

      expect(report.a11yViolationCount).toBe(0);
      expect(report.interactionViolationCount).toBe(0);
      expect(report.checks).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            name: "a11y-static",
            status: "passed",
            count: 0
          }),
          expect.objectContaining({
            name: "interaction-static",
            status: "passed",
            count: 0
          })
        ])
      );
      expect(findings).toEqual([]);
      expect(interactions).toEqual([]);
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });
});
