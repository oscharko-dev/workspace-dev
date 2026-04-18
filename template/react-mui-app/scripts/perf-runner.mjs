import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import net from "node:net";
import path from "node:path";

const mode = process.argv[2] ?? "assert";

const DEFAULT_BUDGETS = {
  inp_p75_ms: 200,
  lcp_p75_ms: 2500,
  cls_p75: 0.1,
  initial_js_kb: 180,
  route_transition_ms: 300
};

const DEFAULT_ROUTES = ["/", "/overview", "/checkout"];
const DEFAULT_PROFILES = ["mobile", "desktop"];
const CHROME_FLAGS = "--headless --no-sandbox --disable-dev-shm-usage";
const LIGHTHOUSE_TIMEOUT_MS =
  Number(process.env.FIGMAPIPE_PERF_LIGHTHOUSE_TIMEOUT_MS ?? 180_000) || 180_000;
const LIGHTHOUSE_MAX_ATTEMPTS = Math.max(
  1,
  Number(process.env.FIGMAPIPE_PERF_LIGHTHOUSE_MAX_ATTEMPTS ?? 2) || 2
);

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
  return value
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .toLowerCase() || "root";
};

const toRoutePath = (value) => {
  if (!value || typeof value !== "string") {
    return "/";
  }
  if (value === "/") {
    return "/";
  }
  if (value.startsWith("/")) {
    return value;
  }
  return `/${value}`;
};

const p75 = (values) => {
  if (!Array.isArray(values) || values.length === 0) {
    return undefined;
  }
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.max(0, Math.ceil(sorted.length * 0.75) - 1);
  return sorted[index];
};

const normalizeNumber = (value) => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined;
  }
  return value;
};

const resolveLighthouseRoot = (report) => {
  if (report && typeof report === "object" && report.lhr && typeof report.lhr === "object") {
    return report.lhr;
  }
  return report;
};

const pickMetric = (candidates) => {
  for (const candidate of candidates) {
    if (typeof candidate.value === "number" && Number.isFinite(candidate.value)) {
      return candidate;
    }
  }
  return { value: undefined, source: "missing" };
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

const killProcessTree = (child, signal) => {
  if (!child || child.killed) {
    return;
  }
  try {
    if (process.platform === "win32") {
      child.kill(signal);
      return;
    }
    if (typeof child.pid === "number" && child.pid > 0) {
      process.kill(-child.pid, signal);
      return;
    }
    child.kill(signal);
  } catch (error) {
    const errorCode =
      error && typeof error === "object" && "code" in error ? error.code : undefined;
    if (errorCode !== "ESRCH") {
      child.kill(signal);
    }
  }
};

const runCommand = async ({ command, args, cwd, env, timeoutMs }) => {
  return await new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd,
      env,
      stdio: ["ignore", "pipe", "pipe"],
      detached: process.platform !== "win32"
    });
    let settled = false;
    let timedOut = false;
    let stdout = "";
    let stderr = "";
    let forceKillTimer;
    child.stdout.setEncoding("utf-8");
    child.stderr.setEncoding("utf-8");
    const timeoutTimer =
      typeof timeoutMs === "number" && Number.isFinite(timeoutMs) && timeoutMs > 0
        ? setTimeout(() => {
            timedOut = true;
            killProcessTree(child, "SIGTERM");
            forceKillTimer = setTimeout(() => {
              killProcessTree(child, "SIGKILL");
              child.stdout.destroy();
              child.stderr.destroy();
              complete({
                code: 124,
                errorText: `[timeout] Command exceeded ${timeoutMs}ms and was terminated.`
              });
            }, 2_000);
          }, timeoutMs)
        : undefined;
    const complete = ({ code, errorText }) => {
      if (settled) {
        return;
      }
      settled = true;
      if (timeoutTimer) {
        clearTimeout(timeoutTimer);
      }
      if (forceKillTimer) {
        clearTimeout(forceKillTimer);
      }
      resolve({
        success: !timedOut && code === 0,
        code,
        timedOut,
        stdout,
        stderr,
        combined: `${stdout}\n${stderr}${errorText ? `\n${errorText}` : ""}`
      });
    };
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      complete({
        code: timedOut ? 124 : 1,
        errorText: error instanceof Error ? error.message : String(error)
      });
    });
    child.on("close", (code) => {
      complete({
        code: timedOut ? 124 : code ?? 1,
        errorText:
          timedOut && typeof timeoutMs === "number"
            ? `[timeout] Command exceeded ${timeoutMs}ms and was terminated.`
            : undefined
      });
    });
  });
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

  const budgetPath = process.env.FIGMAPIPE_PERF_BUDGET_PATH?.trim() || path.join(process.cwd(), "perf-budget.json");
  const budgetConfig = (await readJsonIfExists(budgetPath)) ?? {};
  const budgets = {
    ...DEFAULT_BUDGETS,
    ...(budgetConfig.budgets ?? {})
  };
  const routes = parseStringArray({
    envValue: process.env.FIGMAPIPE_PERF_ROUTES_JSON,
    fallback: Array.isArray(budgetConfig.routes) ? budgetConfig.routes : DEFAULT_ROUTES
  }).map((entry) => toRoutePath(entry));
  const profiles = parseStringArray({
    envValue: process.env.FIGMAPIPE_PERF_PROFILES_JSON,
    fallback: Array.isArray(budgetConfig.profiles) ? budgetConfig.profiles : DEFAULT_PROFILES
  }).filter((entry) => entry === "mobile" || entry === "desktop");
  const artifactDir = process.env.FIGMAPIPE_PERF_ARTIFACT_DIR?.trim() || path.join(process.cwd(), "artifacts", "performance");
  const baselinePath =
    process.env.FIGMAPIPE_PERF_BASELINE_PATH?.trim() || path.join(artifactDir, "perf-baseline.json");
  const reportPath = process.env.FIGMAPIPE_PERF_REPORT_PATH?.trim() || path.join(artifactDir, `perf-${mode}-report.json`);
  const regressionTolerancePct =
    Number(process.env.FIGMAPIPE_PERF_REGRESSION_TOLERANCE_PCT ?? budgetConfig.regressionTolerancePct ?? 10) || 10;
  const strict = parseBooleanLike(process.env.FIGMAPIPE_PERF_STRICT, mode === "assert");
  const allowBaselineBootstrap = parseBooleanLike(process.env.FIGMAPIPE_PERF_ALLOW_BASELINE_BOOTSTRAP, mode === "baseline");
  const previewHost = process.env.FIGMAPIPE_PERF_PREVIEW_HOST?.trim() || "127.0.0.1";
  const configuredPort = Number(process.env.FIGMAPIPE_PERF_PREVIEW_PORT);
  const previewPort =
    Number.isFinite(configuredPort) && configuredPort > 0 && configuredPort < 65536
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
    previewPort
  };
};

const collectAuditForRoute = async ({
  profile,
  route,
  url,
  artifactDir
}) => {
  const outputPath = path.join(artifactDir, `lighthouse-${profile}-${toSlug(route)}.json`);
  const args = [
    "exec",
    "lighthouse",
    url,
    "--only-categories=performance",
    "--output=json",
    `--output-path=${outputPath}`,
    "--quiet",
    `--chrome-flags=${CHROME_FLAGS}`
  ];
  if (profile === "desktop") {
    args.push("--preset=desktop");
  }

  let runResult;
  for (let attempt = 1; attempt <= LIGHTHOUSE_MAX_ATTEMPTS; attempt += 1) {
    console.log(
      `[perf-runner] lighthouse profile=${profile} route=${route} attempt ${attempt}/${LIGHTHOUSE_MAX_ATTEMPTS}`
    );
    runResult = await runCommand({
      command: "pnpm",
      args,
      cwd: process.cwd(),
      env: process.env,
      timeoutMs: LIGHTHOUSE_TIMEOUT_MS
    });
    if (runResult.success) {
      break;
    }
    const reason = runResult.timedOut
      ? `timed out after ${LIGHTHOUSE_TIMEOUT_MS}ms`
      : `exited with code ${runResult.code}`;
    console.warn(
      `[perf-runner] lighthouse ${profile} ${route} attempt ${attempt}/${LIGHTHOUSE_MAX_ATTEMPTS} ${reason}`
    );
    if (attempt < LIGHTHOUSE_MAX_ATTEMPTS) {
      await new Promise((resolve) => {
        setTimeout(resolve, attempt * 1_000);
      });
    }
  }

  if (!runResult?.success) {
    throw new Error(`Lighthouse failed for ${profile} ${route}: ${runResult.combined.slice(0, 2000)}`);
  }

  const report = JSON.parse(await readFile(outputPath, "utf-8"));
  const lhr = resolveLighthouseRoot(report);
  const audits = lhr?.audits ?? {};
  const resourceSummaryItems = audits["resource-summary"]?.details?.items;
  const jsBytes =
    Array.isArray(resourceSummaryItems) && resourceSummaryItems.length > 0
      ? resourceSummaryItems
          .filter((item) => item.resourceType === "script")
          .reduce((total, item) => total + (Number(item.transferSize) || 0), 0)
      : normalizeNumber(audits["total-byte-weight"]?.numericValue) ?? 0;

  const inpMetric = pickMetric([
    {
      value: normalizeNumber(audits["interaction-to-next-paint"]?.numericValue),
      source: "interaction-to-next-paint"
    },
    {
      value: normalizeNumber(audits["experimental-interaction-to-next-paint"]?.numericValue),
      source: "experimental-interaction-to-next-paint"
    },
    {
      value: normalizeNumber(audits["total-blocking-time"]?.numericValue),
      source: "total-blocking-time-proxy"
    },
    {
      value: normalizeNumber(audits.interactive?.numericValue),
      source: "interactive-proxy"
    }
  ]);
  const lcpMetricValue = normalizeNumber(audits["largest-contentful-paint"]?.numericValue);
  const interactiveMetricValue = normalizeNumber(audits.interactive?.numericValue);
  const routeTransitionMetric = pickMetric([
    {
      value:
        typeof interactiveMetricValue === "number" && typeof lcpMetricValue === "number"
          ? Math.max(0, interactiveMetricValue - lcpMetricValue)
          : undefined,
      source: "interactive-minus-lcp"
    },
    {
      value: normalizeNumber(audits["total-blocking-time"]?.numericValue),
      source: "total-blocking-time-proxy"
    },
    {
      value: interactiveMetricValue,
      source: "interactive"
    }
  ]);

  return {
    profile,
    route,
    url,
    metrics: {
      inp_ms: inpMetric.value,
      lcp_ms: lcpMetricValue,
      cls: normalizeNumber(audits["cumulative-layout-shift"]?.numericValue),
      initial_js_kb: Math.round((jsBytes / 1024) * 100) / 100,
      route_transition_ms: routeTransitionMetric.value
    },
    metricSources: {
      inp: inpMetric.source,
      route_transition_ms: routeTransitionMetric.source
    },
    audits: {
      performance_score: normalizeNumber(lhr?.categories?.performance?.score),
      fetch_time: lhr?.fetchTime
    },
    artifacts: {
      lighthouseReport: outputPath
    }
  };
};

const aggregateMetrics = (samples) => {
  const inpValues = samples.map((sample) => sample.metrics.inp_ms).filter((value) => typeof value === "number");
  const lcpValues = samples.map((sample) => sample.metrics.lcp_ms).filter((value) => typeof value === "number");
  const clsValues = samples.map((sample) => sample.metrics.cls).filter((value) => typeof value === "number");
  const jsValues = samples.map((sample) => sample.metrics.initial_js_kb).filter((value) => typeof value === "number");
  const routeTransitionValues = samples
    .map((sample) => sample.metrics.route_transition_ms)
    .filter((value) => typeof value === "number");

  return {
    inp_p75_ms: p75(inpValues),
    lcp_p75_ms: p75(lcpValues),
    cls_p75: p75(clsValues),
    initial_js_kb: p75(jsValues),
    route_transition_ms: p75(routeTransitionValues)
  };
};

const summarizeMetricSources = (samples) => {
  const sourceCounts = {
    inp: {},
    route_transition_ms: {}
  };

  for (const sample of samples) {
    const inpSource = sample.metricSources?.inp ?? "missing";
    const routeSource = sample.metricSources?.route_transition_ms ?? "missing";
    sourceCounts.inp[inpSource] = (sourceCounts.inp[inpSource] ?? 0) + 1;
    sourceCounts.route_transition_ms[routeSource] = (sourceCounts.route_transition_ms[routeSource] ?? 0) + 1;
  }

  return sourceCounts;
};

const compareAgainstBudgets = ({ aggregate, budgets }) => {
  const budgetChecks = [
    { metric: "inp_p75_ms", actual: aggregate.inp_p75_ms, budget: budgets.inp_p75_ms },
    { metric: "lcp_p75_ms", actual: aggregate.lcp_p75_ms, budget: budgets.lcp_p75_ms },
    { metric: "cls_p75", actual: aggregate.cls_p75, budget: budgets.cls_p75 },
    { metric: "initial_js_kb", actual: aggregate.initial_js_kb, budget: budgets.initial_js_kb },
    { metric: "route_transition_ms", actual: aggregate.route_transition_ms, budget: budgets.route_transition_ms }
  ];

  return budgetChecks.map((check) => {
    if (typeof check.actual !== "number") {
      return {
        ...check,
        pass: false,
        reason: "missing-metric"
      };
    }
    return {
      ...check,
      pass: check.actual <= check.budget,
      delta: check.actual - check.budget
    };
  });
};

const compareAgainstBaseline = ({ aggregate, baselineAggregate, tolerancePct }) => {
  const floors = {
    inp_p75_ms: 1,
    lcp_p75_ms: 1,
    cls_p75: 0.001,
    initial_js_kb: 0.1,
    route_transition_ms: 1
  };

  const checks = Object.keys(floors).map((metric) => {
    const actual = aggregate[metric];
    const baseline = baselineAggregate?.[metric];
    if (typeof actual !== "number" || typeof baseline !== "number") {
      return {
        metric,
        actual,
        baseline,
        pass: false,
        reason: "missing-baseline-or-metric"
      };
    }
    const denominator = Math.max(Math.abs(baseline), floors[metric]);
    const regressionPct = ((actual - baseline) / denominator) * 100;
    return {
      metric,
      actual,
      baseline,
      regressionPct: Math.round(regressionPct * 100) / 100,
      pass: regressionPct <= tolerancePct
    };
  });

  return checks;
};

const ensureBuildExists = async () => {
  const distPath = path.join(process.cwd(), "dist");
  try {
    await readFile(path.join(distPath, "index.html"), "utf-8");
  } catch {
    throw new Error("Missing dist/index.html. Run 'pnpm run build' before perf scripts.");
  }
};

const run = async () => {
  const config = await resolveScriptConfig();
  await ensureBuildExists();
  await mkdir(config.artifactDir, { recursive: true });

  const previewArgs = [
    "exec",
    "vite",
    "preview",
    "--host",
    config.previewHost,
    "--port",
    String(config.previewPort),
    "--strictPort"
  ];

  const previewProcess = spawn("pnpm", previewArgs, {
    cwd: process.cwd(),
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"]
  });

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

  try {
    await waitForHttpOk({ url: origin, timeoutMs: 30_000 });

    const samples = [];
    for (const profile of config.profiles) {
      for (const route of config.routes) {
        const hashPath = route === "/" ? "#/" : `#${route}`;
        const routeUrl = `${origin}/${hashPath}`;
        const sample = await collectAuditForRoute({
          profile,
          route,
          url: routeUrl,
          artifactDir: config.artifactDir
        });
        samples.push(sample);
      }
    }

    const aggregate = aggregateMetrics(samples);
    const budgetChecks = compareAgainstBudgets({ aggregate, budgets: config.budgets });

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
        profiles: config.profiles
      });
    } else if (!baselineAggregate && config.allowBaselineBootstrap) {
      baselineStatus = "bootstrapped";
      await writeJson(config.baselinePath, {
        generatedAt: new Date().toISOString(),
        aggregate,
        budgets: config.budgets,
        routes: config.routes,
        profiles: config.profiles
      });
    } else if (baselineAggregate) {
      baselineStatus = "compared";
      regressionChecks = compareAgainstBaseline({
        aggregate,
        baselineAggregate,
        tolerancePct: config.regressionTolerancePct
      });
    } else {
      baselineStatus = "missing";
      regressionChecks = [
        {
          metric: "all",
          pass: false,
          reason: "baseline-missing"
        }
      ];
    }

    const failedBudgetChecks = budgetChecks.filter((check) => !check.pass);
    const failedRegressionChecks = regressionChecks.filter((check) => !check.pass);

    const strictFailure = mode === "assert" && config.strict && (failedBudgetChecks.length > 0 || failedRegressionChecks.length > 0);

    const report = {
      mode,
      generatedAt: new Date().toISOString(),
      durationMs: Date.now() - startedAt,
      config: {
        budgetPath: config.budgetPath,
        budgets: config.budgets,
        routes: config.routes,
        profiles: config.profiles,
        baselinePath: config.baselinePath,
        regressionTolerancePct: config.regressionTolerancePct,
        strict: config.strict,
        previewOrigin: origin
      },
      aggregate,
      metricSources: summarizeMetricSources(samples),
      baselineStatus,
      checks: {
        budgets: budgetChecks,
        regression: regressionChecks
      },
      counts: {
        samples: samples.length,
        failedBudgets: failedBudgetChecks.length,
        failedRegression: failedRegressionChecks.length
      },
      artifacts: {
        reportPath: config.reportPath,
        baselinePath: config.baselinePath,
        lighthouseReportsDir: config.artifactDir
      },
      samples,
      preview: {
        stdout: previewStdout.slice(-4000),
        stderr: previewStderr.slice(-4000)
      }
    };

    await writeJson(config.reportPath, report);

    console.log(
      `[perf-runner] mode=${mode} samples=${samples.length} failedBudgets=${failedBudgetChecks.length} failedRegression=${failedRegressionChecks.length} strict=${config.strict}`
    );
    console.log(`[perf-runner] report=${config.reportPath}`);
    console.log(`[perf-runner] baselineStatus=${baselineStatus}`);

    if (strictFailure) {
      process.exitCode = 1;
      return;
    }
    process.exitCode = 0;
  } finally {
    await stopProcess(previewProcess);
  }
};

await run().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[perf-runner] ${message}`);
  process.exitCode = 1;
});
