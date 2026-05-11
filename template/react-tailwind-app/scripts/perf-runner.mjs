import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, devices } from "@playwright/test";

const mode = process.argv[2] ?? "assert";

const DEFAULT_BUDGETS = {
  inp_p75_ms: 200,
  lcp_p75_ms: 2500,
  cls_p75: 0.1,
  initial_js_kb: 180,
  route_transition_ms: 300,
};

const DEFAULT_ROUTES = ["/"];
const DEFAULT_PROFILES = ["mobile", "desktop"];

const parseBooleanLike = (value, fallback) => {
  if (!value) {
    return fallback;
  }
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }
  return fallback;
};

const toSlug = (value) => {
  return (
    value
      .replace(/[^a-zA-Z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "")
      .toLowerCase() || "root"
  );
};

const toRoutePath = (value) => {
  if (!value || typeof value !== "string") {
    return "/";
  }
  if (value === "/") {
    return "/";
  }
  return value.startsWith("/") ? value : `/${value}`;
};

const p75 = (values) => {
  if (!Array.isArray(values) || values.length === 0) {
    return undefined;
  }
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.max(0, Math.ceil(sorted.length * 0.75) - 1);
  return sorted[index];
};

const roundMetric = (value, precision = 2) => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined;
  }
  const factor = 10 ** precision;
  return Math.round(value * factor) / factor;
};

const parseStringArray = ({ envValue, fallback }) => {
  if (envValue && envValue.trim().length > 0) {
    try {
      const parsed = JSON.parse(envValue);
      if (Array.isArray(parsed)) {
        const normalized = parsed
          .filter((entry) => typeof entry === "string")
          .map((entry) => entry.trim())
          .filter((entry) => entry.length > 0);
        if (normalized.length > 0) {
          return normalized;
        }
      }
    } catch {
      // Keep fallback when env parsing fails.
    }
  }
  return fallback;
};

const readJsonIfExists = async (filePath) => {
  try {
    const content = await readFile(filePath, "utf-8");
    return JSON.parse(content);
  } catch {
    return undefined;
  }
};

const writeJson = async (filePath, payload) => {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf-8");
};

const waitForHttpOk = async ({ url, timeoutMs }) => {
  const deadline = Date.now() + timeoutMs;
  let lastError = "unknown";
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok || response.status === 404) {
        return;
      }
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => {
      setTimeout(resolve, 200);
    });
  }
  throw new Error(`Preview server did not become ready in time: ${lastError}`);
};

const stopProcess = async (child) => {
  if (!child || child.killed) {
    return;
  }
  await new Promise((resolve) => {
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
    }, 4_000);
    child.once("close", () => {
      clearTimeout(timer);
      resolve();
    });
    child.kill("SIGTERM");
  });
};

const resolveFreePort = async () => {
  return await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close(() => reject(new Error("Failed to resolve dynamic port")));
        return;
      }
      const port = address.port;
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(port);
      });
    });
    server.on("error", reject);
  });
};

const resolveScriptConfig = async () => {
  if (mode !== "baseline" && mode !== "assert") {
    throw new Error(`Unknown mode '${mode}'. Use 'baseline' or 'assert'.`);
  }

  const budgetPath =
    process.env.FIGMAPIPE_PERF_BUDGET_PATH?.trim() ||
    path.join(process.cwd(), "perf-budget.json");
  const budgetConfig = (await readJsonIfExists(budgetPath)) ?? {};
  const budgets = {
    ...DEFAULT_BUDGETS,
    ...(budgetConfig.budgets ?? {}),
  };
  const routes = parseStringArray({
    envValue: process.env.FIGMAPIPE_PERF_ROUTES_JSON,
    fallback: Array.isArray(budgetConfig.routes)
      ? budgetConfig.routes
      : DEFAULT_ROUTES,
  }).map((entry) => toRoutePath(entry));
  const profiles = parseStringArray({
    envValue: process.env.FIGMAPIPE_PERF_PROFILES_JSON,
    fallback: Array.isArray(budgetConfig.profiles)
      ? budgetConfig.profiles
      : DEFAULT_PROFILES,
  }).filter((entry) => entry === "mobile" || entry === "desktop");
  const artifactDir =
    process.env.FIGMAPIPE_PERF_ARTIFACT_DIR?.trim() ||
    path.join(process.cwd(), "artifacts", "performance");
  const baselinePath =
    process.env.FIGMAPIPE_PERF_BASELINE_PATH?.trim() ||
    path.join(process.cwd(), "perf-baseline.json");
  const reportPath =
    process.env.FIGMAPIPE_PERF_REPORT_PATH?.trim() ||
    path.join(artifactDir, `perf-${mode}-report.json`);
  const regressionTolerancePct =
    Number(
      process.env.FIGMAPIPE_PERF_REGRESSION_TOLERANCE_PCT ??
        budgetConfig.regressionTolerancePct ??
        10,
    ) || 10;
  const strict = parseBooleanLike(
    process.env.FIGMAPIPE_PERF_STRICT,
    mode === "assert",
  );
  const allowBaselineBootstrap = parseBooleanLike(
    process.env.FIGMAPIPE_PERF_ALLOW_BASELINE_BOOTSTRAP,
    mode === "baseline",
  );
  const previewHost =
    process.env.FIGMAPIPE_PERF_PREVIEW_HOST?.trim() || "127.0.0.1";
  const configuredPort = Number(process.env.FIGMAPIPE_PERF_PREVIEW_PORT);
  const previewPort =
    Number.isFinite(configuredPort) &&
    configuredPort > 0 &&
    configuredPort < 65536
      ? Math.trunc(configuredPort)
      : await resolveFreePort();

  return {
    budgetPath,
    budgets,
    routes: routes.length > 0 ? routes : ["/"],
    profiles: profiles.length > 0 ? profiles : DEFAULT_PROFILES,
    artifactDir,
    baselinePath,
    reportPath,
    regressionTolerancePct,
    strict,
    allowBaselineBootstrap,
    previewHost,
    previewPort,
  };
};

const ensureBuildExists = async () => {
  try {
    await readFile(path.join(process.cwd(), "dist", "index.html"), "utf-8");
  } catch {
    throw new Error(
      "Missing dist/index.html. Run 'pnpm run build' before perf scripts.",
    );
  }
};

const contextOptionsForProfile = (profile) => {
  if (profile === "mobile") {
    return devices["Pixel 7"];
  }
  return {
    ...devices["Desktop Chrome"],
    viewport: { width: 1365, height: 768 },
  };
};

const installMetricObservers = async (page) => {
  await page.addInitScript(() => {
    window.__workspaceDevPerf = {
      cls: 0,
      lcp: 0,
    };
    try {
      new PerformanceObserver((entryList) => {
        const entries = entryList.getEntries();
        const lastEntry = entries.at(-1);
        if (lastEntry && typeof lastEntry.startTime === "number") {
          window.__workspaceDevPerf.lcp = lastEntry.startTime;
        }
      }).observe({ type: "largest-contentful-paint", buffered: true });
    } catch {
      // Browser does not expose LCP in this context.
    }
    try {
      new PerformanceObserver((entryList) => {
        for (const entry of entryList.getEntries()) {
          if (!entry.hadRecentInput && typeof entry.value === "number") {
            window.__workspaceDevPerf.cls += entry.value;
          }
        }
      }).observe({ type: "layout-shift", buffered: true });
    } catch {
      // Browser does not expose layout-shift in this context.
    }
  });
};

const collectBrowserTimingForRoute = async ({
  browser,
  profile,
  route,
  url,
  artifactDir,
}) => {
  const context = await browser.newContext(contextOptionsForProfile(profile));
  const page = await context.newPage();
  const startedAt = Date.now();
  await installMetricObservers(page);

  try {
    await page.goto(url, { waitUntil: "networkidle" });
    await page.waitForTimeout(500);
    const durationMs = Date.now() - startedAt;
    const metrics = await page.evaluate(() => {
      const navigation = performance.getEntriesByType("navigation")[0];
      const resources = performance.getEntriesByType("resource");
      const scripts = resources.filter(
        (entry) => entry.initiatorType === "script",
      );
      const scriptBytes = scripts.reduce((total, entry) => {
        const size = entry.transferSize || entry.encodedBodySize || 0;
        return total + size;
      }, 0);
      const paintEntries = performance.getEntriesByType("paint");
      const firstContentfulPaint =
        paintEntries.find((entry) => entry.name === "first-contentful-paint")
          ?.startTime ?? 0;
      return {
        domContentLoaded:
          navigation?.domContentLoadedEventEnd ?? firstContentfulPaint,
        lcp: window.__workspaceDevPerf?.lcp || firstContentfulPaint,
        cls: window.__workspaceDevPerf?.cls ?? 0,
        initialJsKb: scriptBytes / 1024,
      };
    });

    const sample = {
      profile,
      route,
      url,
      metrics: {
        inp_ms: 0,
        lcp_ms: roundMetric(
          metrics.lcp || metrics.domContentLoaded || durationMs,
        ),
        cls: roundMetric(metrics.cls, 4),
        initial_js_kb: roundMetric(metrics.initialJsKb),
        route_transition_ms: 0,
      },
      metricSources: {
        inp: "no-interaction-template",
        lcp: metrics.lcp ? "largest-contentful-paint" : "dom-content-loaded",
        cls: "layout-shift",
        initial_js_kb: "performance-resource-timing",
        route_transition_ms: "single-route-template",
      },
      audits: {
        performance_score: undefined,
        fetch_time: new Date().toISOString(),
        browser_timing_duration_ms: durationMs,
      },
      artifacts: {
        browserTimingReport: path.join(
          artifactDir,
          `browser-timing-${profile}-${toSlug(route)}.json`,
        ),
      },
    };

    await writeJson(sample.artifacts.browserTimingReport, sample);
    return sample;
  } finally {
    await context.close();
  }
};

const aggregateMetrics = (samples) => {
  const metricValues = (metric) =>
    samples
      .map((sample) => sample.metrics[metric])
      .filter((value) => typeof value === "number");

  return {
    inp_p75_ms: p75(metricValues("inp_ms")),
    lcp_p75_ms: p75(metricValues("lcp_ms")),
    cls_p75: p75(metricValues("cls")),
    initial_js_kb: p75(metricValues("initial_js_kb")),
    route_transition_ms: p75(metricValues("route_transition_ms")),
  };
};

const summarizeMetricSources = (samples) => {
  const sourceCounts = {};
  for (const sample of samples) {
    for (const [metric, source] of Object.entries(sample.metricSources ?? {})) {
      sourceCounts[metric] ??= {};
      sourceCounts[metric][source] = (sourceCounts[metric][source] ?? 0) + 1;
    }
  }
  return sourceCounts;
};

const compareAgainstBudgets = ({ aggregate, budgets }) => {
  const budgetChecks = [
    {
      metric: "inp_p75_ms",
      actual: aggregate.inp_p75_ms,
      budget: budgets.inp_p75_ms,
    },
    {
      metric: "lcp_p75_ms",
      actual: aggregate.lcp_p75_ms,
      budget: budgets.lcp_p75_ms,
    },
    { metric: "cls_p75", actual: aggregate.cls_p75, budget: budgets.cls_p75 },
    {
      metric: "initial_js_kb",
      actual: aggregate.initial_js_kb,
      budget: budgets.initial_js_kb,
    },
    {
      metric: "route_transition_ms",
      actual: aggregate.route_transition_ms,
      budget: budgets.route_transition_ms,
    },
  ];

  return budgetChecks.map((check) => {
    if (typeof check.actual !== "number") {
      return {
        ...check,
        pass: false,
        reason: "missing-metric",
      };
    }
    return {
      ...check,
      pass: check.actual <= check.budget,
      delta: check.actual - check.budget,
    };
  });
};

const REGRESSION_DENOMINATOR_FLOORS = {
  inp_p75_ms: 25,
  lcp_p75_ms: 50,
  cls_p75: 0.005,
  initial_js_kb: 1,
  route_transition_ms: 25,
};

export const compareAgainstBaseline = ({
  aggregate,
  baselineAggregate,
  tolerancePct,
}) => {
  return Object.keys(REGRESSION_DENOMINATOR_FLOORS).map((metric) => {
    const actual = aggregate[metric];
    const baseline = baselineAggregate?.[metric];
    if (typeof actual !== "number" || typeof baseline !== "number") {
      return {
        metric,
        actual,
        baseline,
        pass: false,
        reason: "missing-baseline-or-metric",
      };
    }
    const denominator = Math.max(
      Math.abs(baseline),
      REGRESSION_DENOMINATOR_FLOORS[metric],
    );
    const regressionPct = ((actual - baseline) / denominator) * 100;
    return {
      metric,
      actual,
      baseline,
      regressionPct: roundMetric(regressionPct),
      pass: regressionPct <= tolerancePct,
    };
  });
};

const run = async () => {
  const config = await resolveScriptConfig();
  await ensureBuildExists();
  await mkdir(config.artifactDir, { recursive: true });

  const previewProcess = spawn(
    "pnpm",
    [
      "exec",
      "vite",
      "preview",
      "--host",
      config.previewHost,
      "--port",
      String(config.previewPort),
      "--strictPort",
    ],
    {
      cwd: process.cwd(),
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  let previewStdout = "";
  let previewStderr = "";
  previewProcess.stdout.setEncoding("utf-8");
  previewProcess.stderr.setEncoding("utf-8");
  previewProcess.stdout.on("data", (chunk) => {
    previewStdout += chunk;
  });
  previewProcess.stderr.on("data", (chunk) => {
    previewStderr += chunk;
  });

  const origin = `http://${config.previewHost}:${config.previewPort}`;
  const startedAt = Date.now();
  let browser;

  try {
    await waitForHttpOk({ url: origin, timeoutMs: 30_000 });
    browser = await chromium.launch();

    const samples = [];
    for (const profile of config.profiles) {
      for (const route of config.routes) {
        const hashPath = route === "/" ? "#/" : `#${route}`;
        samples.push(
          await collectBrowserTimingForRoute({
            browser,
            profile,
            route,
            url: `${origin}/${hashPath}`,
            artifactDir: config.artifactDir,
          }),
        );
      }
    }

    const aggregate = aggregateMetrics(samples);
    const budgetChecks = compareAgainstBudgets({
      aggregate,
      budgets: config.budgets,
    });

    const baselinePayload = await readJsonIfExists(config.baselinePath);
    const baselineAggregate = baselinePayload?.aggregate;

    let baselineStatus = "not-required";
    let regressionChecks = [];
    if (mode === "baseline") {
      baselineStatus = "written";
      await writeJson(config.baselinePath, {
        generatedAt: new Date().toISOString(),
        aggregate,
        budgets: config.budgets,
        routes: config.routes,
        profiles: config.profiles,
        measurement: "playwright-browser-timing",
      });
    } else if (!baselineAggregate && config.allowBaselineBootstrap) {
      baselineStatus = "bootstrapped";
      await writeJson(config.baselinePath, {
        generatedAt: new Date().toISOString(),
        aggregate,
        budgets: config.budgets,
        routes: config.routes,
        profiles: config.profiles,
        measurement: "playwright-browser-timing",
      });
    } else if (baselineAggregate) {
      baselineStatus = "compared";
      regressionChecks = compareAgainstBaseline({
        aggregate,
        baselineAggregate,
        tolerancePct: config.regressionTolerancePct,
      });
    } else {
      baselineStatus = "missing";
      regressionChecks = [
        {
          metric: "all",
          pass: false,
          reason: "baseline-missing",
        },
      ];
    }

    const failedBudgetChecks = budgetChecks.filter((check) => !check.pass);
    const failedRegressionChecks = regressionChecks.filter(
      (check) => !check.pass,
    );
    const strictFailure =
      mode === "assert" &&
      config.strict &&
      (failedBudgetChecks.length > 0 || failedRegressionChecks.length > 0);

    const report = {
      mode,
      generatedAt: new Date().toISOString(),
      durationMs: Date.now() - startedAt,
      measurement: "playwright-browser-timing",
      config: {
        budgetPath: config.budgetPath,
        budgets: config.budgets,
        routes: config.routes,
        profiles: config.profiles,
        baselinePath: config.baselinePath,
        regressionTolerancePct: config.regressionTolerancePct,
        strict: config.strict,
        previewOrigin: origin,
      },
      aggregate,
      metricSources: summarizeMetricSources(samples),
      baselineStatus,
      checks: {
        budgets: budgetChecks,
        regression: regressionChecks,
      },
      counts: {
        samples: samples.length,
        failedBudgets: failedBudgetChecks.length,
        failedRegression: failedRegressionChecks.length,
      },
      artifacts: {
        reportPath: config.reportPath,
        baselinePath: config.baselinePath,
        browserTimingReportsDir: config.artifactDir,
      },
      samples,
      preview: {
        stdout: previewStdout.slice(-4000),
        stderr: previewStderr.slice(-4000),
      },
    };

    await writeJson(config.reportPath, report);

    console.log(
      `[perf-runner] mode=${mode} samples=${samples.length} failedBudgets=${failedBudgetChecks.length} failedRegression=${failedRegressionChecks.length} strict=${config.strict}`,
    );
    console.log(`[perf-runner] report=${config.reportPath}`);
    console.log(`[perf-runner] baselineStatus=${baselineStatus}`);

    process.exitCode = strictFailure ? 1 : 0;
  } finally {
    if (browser) {
      await browser.close();
    }
    await stopProcess(previewProcess);
  }
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await run().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[perf-runner] ${message}`);
    process.exitCode = 1;
  });
}
