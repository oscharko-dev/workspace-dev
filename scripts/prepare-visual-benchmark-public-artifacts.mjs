import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const ROOT = path.resolve(process.cwd(), "artifacts", "visual-benchmark");
const LAST_RUN_PATH = path.join(ROOT, "last-run.json");
const CHECK_OUTPUT_PATH = path.join(ROOT, "check-output.json");
const PUBLIC_DIR = path.join(ROOT, "public-summary");

const sanitizeText = (value) => {
  if (typeof value !== "string") {
    return value;
  }
  return value
    .replace(/\/v1\/files\/[A-Za-z0-9]+/gu, "/v1/files/[redacted-file]")
    .replace(/\/v1\/images\/[A-Za-z0-9]+/gu, "/v1/images/[redacted-file]")
    .replace(/https?:\/\/api\.figma\.com\/v1\/files\/[^\s)]+/giu, "https://api.figma.com/v1/files/[redacted]")
    .replace(/https?:\/\/api\.figma\.com\/v1\/images\/[^\s)]+/giu, "https://api.figma.com/v1/images/[redacted]")
    .replace(/\b[A-Za-z0-9]{16,}:[0-9]{1,6}\b/gu, "[redacted-node]")
    .replace(/\bfigd_[A-Za-z0-9_-]+\b/gu, "[redacted-token]");
};

const sanitizeWarnings = (warnings) => {
  if (!Array.isArray(warnings)) {
    return undefined;
  }
  const sanitized = warnings
    .filter((entry) => typeof entry === "string" && entry.trim().length > 0)
    .map((entry) => sanitizeText(entry.trim()));
  return sanitized.length > 0 ? sanitized : undefined;
};

const sanitizeLastRun = (raw) => {
  if (typeof raw !== "object" || raw === null) {
    throw new Error("Expected last-run payload to be an object.");
  }
  const input = raw;
  const output = {
    version: input.version,
    ranAt: input.ranAt,
    scores: Array.isArray(input.scores)
      ? input.scores.map((entry) => ({
          fixtureId: entry.fixtureId,
          ...(typeof entry.screenId === "string" ? { screenId: entry.screenId } : {}),
          ...(typeof entry.viewportId === "string" ? { viewportId: entry.viewportId } : {}),
          score: entry.score,
        }))
      : [],
    ...(typeof input.overallScore === "number"
      ? { overallScore: input.overallScore }
      : {}),
    ...(typeof input.overallCurrent === "number"
      ? { overallCurrent: input.overallCurrent }
      : {}),
    ...(input.overallBaseline === null || typeof input.overallBaseline === "number"
      ? { overallBaseline: input.overallBaseline }
      : {}),
    ...(input.overallDelta === null || typeof input.overallDelta === "number"
      ? { overallDelta: input.overallDelta }
      : {}),
    ...(typeof input.screenAggregateScore === "number"
      ? { screenAggregateScore: input.screenAggregateScore }
      : {}),
    ...(typeof input.componentAggregateScore === "number"
      ? { componentAggregateScore: input.componentAggregateScore }
      : {}),
    ...(input.componentCoverage &&
    typeof input.componentCoverage === "object"
      ? { componentCoverage: input.componentCoverage }
      : {}),
    ...(input.browserBreakdown && typeof input.browserBreakdown === "object"
      ? { browserBreakdown: input.browserBreakdown }
      : {}),
    ...(input.crossBrowserConsistency &&
    typeof input.crossBrowserConsistency === "object"
      ? {
          crossBrowserConsistency: {
            browsers: Array.isArray(input.crossBrowserConsistency.browsers)
              ? input.crossBrowserConsistency.browsers
              : [],
            consistencyScore: input.crossBrowserConsistency.consistencyScore,
            pairwiseDiffs: Array.isArray(
              input.crossBrowserConsistency.pairwiseDiffs,
            )
              ? input.crossBrowserConsistency.pairwiseDiffs.map((pair) => ({
                  browserA: pair.browserA,
                  browserB: pair.browserB,
                  diffPercent: pair.diffPercent,
                }))
              : [],
            ...(sanitizeWarnings(input.crossBrowserConsistency.warnings)
              ? { warnings: sanitizeWarnings(input.crossBrowserConsistency.warnings) }
              : {}),
          },
        }
      : {}),
    ...(Array.isArray(input.components)
      ? {
          components: input.components.map((component) => ({
            componentId: component.componentId,
            componentName: component.componentName,
            status: component.status,
            ...(typeof component.score === "number" ? { score: component.score } : {}),
            ...(typeof component.skipReason === "string"
              ? { skipReason: component.skipReason }
              : {}),
            ...(typeof component.storyEntryId === "string"
              ? { storyEntryId: component.storyEntryId }
              : {}),
            ...(sanitizeWarnings(component.warnings)
              ? { warnings: sanitizeWarnings(component.warnings) }
              : {}),
          })),
        }
      : {}),
    ...(sanitizeWarnings(input.warnings)
      ? { warnings: sanitizeWarnings(input.warnings) }
      : {}),
    ...(Array.isArray(input.failedFixtures)
      ? {
          failedFixtures: input.failedFixtures.map((entry) => ({
            fixtureId: entry.fixtureId,
            error: {
              code: entry?.error?.code ?? "E_VISUAL_BENCHMARK_FIXTURE_FAILED",
              message: sanitizeText(entry?.error?.message ?? "Benchmark fixture failed."),
            },
          })),
        }
      : {}),
  };
  return output;
};

const main = async () => {
  await mkdir(PUBLIC_DIR, { recursive: true });

  const lastRunContent = JSON.parse(await readFile(LAST_RUN_PATH, "utf8"));
  const sanitizedLastRun = sanitizeLastRun(lastRunContent);
  const publicLastRunPath = path.join(PUBLIC_DIR, "last-run.public.json");
  await writeFile(publicLastRunPath, `${JSON.stringify(sanitizedLastRun, null, 2)}\n`, "utf8");

  try {
    const checkOutput = JSON.parse(await readFile(CHECK_OUTPUT_PATH, "utf8"));
    const publicCheckOutputPath = path.join(PUBLIC_DIR, "check-output.public.json");
    await writeFile(
      publicCheckOutputPath,
      `${JSON.stringify(
        {
          title: sanitizeText(checkOutput.title ?? ""),
          summary: sanitizeText(checkOutput.summary ?? ""),
          text: sanitizeText(checkOutput.text ?? ""),
          annotations: Array.isArray(checkOutput.annotations)
            ? checkOutput.annotations
                .slice(0, 20)
                .map((annotation) => ({
                  ...annotation,
                  message: sanitizeText(annotation.message),
                }))
            : [],
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
  } catch {
    // optional output
  }

  process.stdout.write(
    `Prepared public visual benchmark artifacts in ${PUBLIC_DIR}\n`,
  );
};

await main();
