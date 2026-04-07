import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SCRIPT_PATH = fileURLToPath(new URL("./validate-ui-report.mjs", import.meta.url));

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

  execFileSync(process.execPath, [SCRIPT_PATH], {
    cwd,
    env: {
      ...process.env,
      FIGMAPIPE_UI_GATE_CHANGED_SURFACES_JSON: JSON.stringify(["src"]),
      FIGMAPIPE_UI_GATE_BASELINE_PATH: baselinePath,
      FIGMAPIPE_UI_GATE_REPORT_PATH: reportPath
    },
    encoding: "utf8"
  });

  return { baselinePath, reportPath };
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
          return <IconButton />;
        };
      `
    });

    try {
      const { reportPath } = runValidateUiReport(workspace);
      const report = await readJson(reportPath);
      const findings = await readJson(path.join(workspace, "ui-gate-a11y-findings.json"));

      expect(report.a11yViolationCount).toBe(1);
      expect(report.interactionViolationCount).toBe(0);
      expect(report.checks).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            name: "a11y-static",
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
      const { reportPath } = runValidateUiReport(workspace);
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
