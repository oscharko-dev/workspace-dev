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
const VISUAL_AUDIT_PROJECT_NAMES = [
  "desktop-chromium",
  "tablet-chromium",
  "mobile-chromium",
] as const;

const normalizeProjectName = (value: string) => {
  if ((VISUAL_AUDIT_PROJECT_NAMES as readonly string[]).includes(value)) {
    return value as (typeof VISUAL_AUDIT_PROJECT_NAMES)[number];
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

const toBox = (box: { x: number; y: number; width: number; height: number } | null) => {
  if (!box) {
    return null;
  }
  return {
    x: Math.round(box.x),
    y: Math.round(box.y),
    width: Math.round(box.width),
    height: Math.round(box.height),
  };
};

test("renders generated Mobile Banking Navigation Board app in a real browser", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByTestId("generated-app")).toBeVisible();
});

test("captures visual audit evidence for the generated Mobile Banking Navigation Board app", async ({ page }, testInfo) => {
  const projectName = normalizeProjectName(testInfo.project.name);

  await page.goto("/");
  await page.waitForLoadState("networkidle");
  await page.evaluate(async () => {
    await document.fonts.ready;
  });

  const generatedApp = page.getByTestId("generated-app");
  await expect(generatedApp).toBeVisible();

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
  const generatedAppBox = toBox(await generatedApp.boundingBox());
  const viewport = page.viewportSize();

  expect(generatedAppBox).not.toBeNull();
  if (generatedAppBox === null) {
    throw new Error("Generated app box is missing.");
  }
  expect(generatedAppBox.width).toBeGreaterThan(0);
  expect(generatedAppBox.height).toBeGreaterThan(0);
  expect(byteDiffRatio).toBeLessThanOrEqual(STABLE_RECAPTURE_MAX_BYTE_DIFF_RATIO);
  if (viewport !== null) {
    expect(screenshotDimensions.width).toBeGreaterThanOrEqual(viewport.width);
    expect(screenshotDimensions.height).toBeGreaterThanOrEqual(viewport.height);
  }

  await writeFile(
    reportPath,
    `${JSON.stringify(
      {
        schemaVersion: 1,
        project: projectName,
        route: "/",
        screenshot: path.relative(process.cwd(), screenshotPath),
        viewport: {
          width: viewport?.width ?? 0,
          height: viewport?.height ?? 0,
        },
        screenshotDimensions,
        generatedApp: {
          testId: "generated-app",
          box: generatedAppBox,
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
