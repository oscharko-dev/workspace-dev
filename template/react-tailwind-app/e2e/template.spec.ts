import { expect, test } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const configuredVisualAuditArtifactDir =
  process.env.FIGMAPIPE_UI_GATE_VISUAL_AUDIT_ARTIFACT_DIR?.trim();
const VISUAL_AUDIT_ARTIFACT_DIR =
  configuredVisualAuditArtifactDir && configuredVisualAuditArtifactDir.length > 0
    ? configuredVisualAuditArtifactDir
    : path.join(process.cwd(), "artifacts", "visual-audit");
const STABLE_RECAPTURE_MAX_BYTE_DIFF_RATIO = 0.001;

const expectedColumnsByProject = {
  "desktop-chromium": 3,
  "tablet-chromium": 3,
  "mobile-chromium": 1,
} as const;

const visualAuditProjectNames = Object.keys(
  expectedColumnsByProject,
) as Array<keyof typeof expectedColumnsByProject>;

const normalizeProjectName = (value: string) => {
  if ((visualAuditProjectNames as readonly string[]).includes(value)) {
    return value as keyof typeof expectedColumnsByProject;
  }
  throw new Error(`Unexpected Playwright project '${value}'.`);
};

const estimateByteDiffRatio = (left: Buffer, right: Buffer) => {
  if (left.length === 0 || right.length === 0) {
    return 1;
  }

  const comparableLength = Math.min(left.length, right.length);
  let changedBytes = Math.abs(left.length - right.length);
  for (let index = 0; index < comparableLength; index += 1) {
    if (left[index] !== right[index]) {
      changedBytes += 1;
    }
  }

  return changedBytes / Math.max(left.length, right.length);
};

const parsePngDimensions = (buffer: Buffer) => {
  const minimumPngHeaderLength = 24;
  if (buffer.length < minimumPngHeaderLength) {
    throw new Error("Screenshot buffer is too small to be a PNG.");
  }
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
  };
};

test("renders the Tailwind template shell in a real browser", async ({
  page,
}) => {
  await page.goto("/");

  await expect(
    page.getByRole("heading", {
      name: "React, TypeScript, Vite, and Tailwind ready for generated apps.",
    }),
  ).toBeVisible();
  await expect(page.getByText("WorkspaceDev default template")).toBeVisible();
  await expect(page.getByText("Components", { exact: true })).toBeVisible();
  await expect(page.getByText("Views", { exact: true })).toBeVisible();
  await expect(page.getByText("Checks", { exact: true })).toBeVisible();
});

test("captures visual audit evidence without viewport layout collapse", async ({
  page,
}, testInfo) => {
  const projectName = normalizeProjectName(testInfo.project.name);
  const expectedColumns = expectedColumnsByProject[projectName];

  await page.goto("/");
  await page.waitForLoadState("networkidle");
  await page.evaluate(async () => {
    await document.fonts.ready;
  });

  const screenshotPath = path.join(
    VISUAL_AUDIT_ARTIFACT_DIR,
    `${projectName}.png`,
  );
  const reportPath = path.join(
    VISUAL_AUDIT_ARTIFACT_DIR,
    `${projectName}.json`,
  );
  await mkdir(VISUAL_AUDIT_ARTIFACT_DIR, { recursive: true });

  const firstScreenshot = await page.screenshot({
    fullPage: true,
    path: screenshotPath,
  });
  const secondScreenshot = await page.screenshot({ fullPage: true });
  const byteDiffRatio = estimateByteDiffRatio(
    firstScreenshot,
    secondScreenshot,
  );
  const screenshotDimensions = parsePngDimensions(firstScreenshot);

  const layout = await page.evaluate(() => {
    const toBox = (element: Element) => {
      const rect = element.getBoundingClientRect();
      return {
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      };
    };
    const metricCards = Array.from(document.querySelectorAll("article"));
    const cardBoxes = metricCards.map((element) => toBox(element));
    const visibleCardCount = cardBoxes.filter(
      (box) => box.width > 0 && box.height > 0,
    ).length;
    const distinctCardRows = new Set(cardBoxes.map((box) => box.y)).size;

    return {
      viewport: {
        width: window.innerWidth,
        height: window.innerHeight,
      },
      document: {
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      },
      heading: toBox(document.querySelector("h1") ?? document.body),
      metricCards: cardBoxes,
      visibleCardCount,
      distinctCardRows,
    };
  });

  expect(layout.document.scrollWidth).toBeLessThanOrEqual(
    layout.document.clientWidth + 1,
  );
  expect(layout.heading.width).toBeGreaterThan(240);
  expect(layout.heading.width).toBeLessThanOrEqual(layout.viewport.width);
  expect(layout.visibleCardCount).toBe(3);
  expect(layout.distinctCardRows).toBe(expectedColumns === 1 ? 3 : 1);
  expect(byteDiffRatio).toBeLessThanOrEqual(
    STABLE_RECAPTURE_MAX_BYTE_DIFF_RATIO,
  );
  expect(screenshotDimensions.width).toBeGreaterThanOrEqual(
    layout.viewport.width,
  );
  expect(screenshotDimensions.height).toBeGreaterThanOrEqual(
    layout.viewport.height,
  );

  await writeFile(
    reportPath,
    `${JSON.stringify(
      {
        schemaVersion: 1,
        project: projectName,
        route: "/",
        screenshot: path.relative(process.cwd(), screenshotPath),
        viewport: layout.viewport,
        screenshotDimensions,
        layoutCollapse: {
          status: "passed",
          expectedMetricColumns: expectedColumns,
          visibleCardCount: layout.visibleCardCount,
          distinctCardRows: layout.distinctCardRows,
          horizontalOverflowPx: Math.max(
            0,
            layout.document.scrollWidth - layout.document.clientWidth,
          ),
        },
        diffThreshold: {
          status: "passed",
          byteDiffRatio,
          maxByteDiffRatio: STABLE_RECAPTURE_MAX_BYTE_DIFF_RATIO,
        },
        fallbackVisualization: {
          status: "passed",
          mode: "captured-screenshot",
          reason:
            "The generated app keeps a reviewer-visible PNG artifact when no committed visual baseline is available.",
        },
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
});
