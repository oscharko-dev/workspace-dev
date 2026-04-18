import assert from "node:assert/strict";
import test from "node:test";
import { resolveRuntimeSettings } from "./runtime.js";

test("resolveRuntimeSettings applies defaults for staged fetch and IR budget", () => {
  const runtime = resolveRuntimeSettings({});

  assert.equal(runtime.figmaTimeoutMs, 30_000);
  assert.equal(runtime.figmaMaxRetries, 3);
  assert.equal(runtime.figmaCircuitBreakerFailureThreshold, 3);
  assert.equal(runtime.figmaCircuitBreakerResetTimeoutMs, 30_000);
  assert.equal(runtime.figmaRestCircuitBreaker.getSnapshot().state, "closed");
  assert.equal(runtime.figmaBootstrapDepth, 5);
  assert.equal(runtime.figmaNodeBatchSize, 6);
  assert.equal(runtime.figmaNodeFetchConcurrency, 3);
  assert.equal(runtime.figmaAdaptiveBatchingEnabled, true);
  assert.equal(runtime.figmaMaxScreenCandidates, 40);
  assert.equal(runtime.figmaScreenNamePattern, undefined);
  assert.equal(runtime.figmaCacheEnabled, true);
  assert.equal(runtime.figmaCacheTtlMs, 15 * 60_000);
  assert.equal(runtime.irCacheEnabled, true);
  assert.equal(runtime.irCacheTtlMs, 60 * 60_000);
  assert.equal(runtime.iconMapFilePath, undefined);
  assert.equal(runtime.designSystemFilePath, undefined);
  assert.equal(runtime.exportImages, true);
  assert.equal(runtime.figmaScreenElementBudget, 1_200);
  assert.equal(runtime.figmaScreenElementMaxDepth, 14);
  assert.equal(runtime.brandTheme, "derived");
  assert.equal(runtime.sparkasseTokensFilePath, undefined);
  assert.equal(runtime.generationLocale, "de-DE");
  assert.equal(runtime.routerMode, "browser");
  assert.equal(runtime.commandTimeoutMs, 15 * 60_000);
  assert.equal(runtime.commandStdoutMaxBytes, 1_048_576);
  assert.equal(runtime.commandStderrMaxBytes, 1_048_576);
  assert.equal(runtime.pipelineDiagnosticLimits.maxDiagnostics, 25);
  assert.equal(runtime.pipelineDiagnosticLimits.textMaxLength, 320);
  assert.equal(runtime.pipelineDiagnosticLimits.detailsMaxKeys, 30);
  assert.equal(runtime.pipelineDiagnosticLimits.detailsMaxItems, 20);
  assert.equal(runtime.pipelineDiagnosticLimits.detailsMaxDepth, 4);
  assert.equal(runtime.enableLintAutofix, true);
  assert.equal(runtime.enablePerfValidation, false);
  assert.equal(runtime.enableUiValidation, false);
  assert.equal(runtime.enableVisualQualityValidation, false);
  assert.equal(runtime.visualQualityReferenceMode, "figma_api");
  assert.equal(runtime.visualQualityViewportWidth, 1280);
  assert.equal(runtime.visualQualityViewportHeight, 800);
  assert.equal(runtime.visualQualityDeviceScaleFactor, 1);
  assert.deepEqual(runtime.compositeQualityWeights, {
    visual: 0.6,
    performance: 0.4
  });
  assert.equal(runtime.enableUnitTestValidation, false);
  assert.equal(runtime.installPreferOffline, true);
  assert.equal(runtime.skipInstall, false);
  assert.equal(runtime.maxConcurrentJobs, 1);
  assert.equal(runtime.maxQueuedJobs, 20);
  assert.equal(runtime.previewEnabled, true);
});

test("resolveRuntimeSettings clamps staged fetch and budget parameters", () => {
  const runtime = resolveRuntimeSettings({
    figmaBootstrapDepth: 999,
    figmaCircuitBreakerFailureThreshold: 999,
    figmaCircuitBreakerResetTimeoutMs: 10,
    figmaNodeBatchSize: 0,
    figmaNodeFetchConcurrency: 99,
    figmaAdaptiveBatchingEnabled: false,
    figmaMaxScreenCandidates: -5,
    figmaScreenNamePattern: "  ^auth/(login|register)$  ",
    figmaCacheEnabled: false,
    figmaCacheTtlMs: 999_999_999,
    iconMapFilePath: "  /tmp/icon-map.json  ",
    designSystemFilePath: "  /tmp/design-system.json  ",
    exportImages: false,
    figmaScreenElementBudget: 999_999,
    figmaScreenElementMaxDepth: -9,
    brandTheme: "SPARKASSE",
    sparkasseTokensFilePath: "  /tmp/sparkasse-tokens.json  ",
    generationLocale: "EN-us",
    routerMode: "HASH",
    commandTimeoutMs: 10,
    commandStdoutMaxBytes: 50_000_000,
    commandStderrMaxBytes: 1,
    pipelineDiagnosticMaxCount: 999,
    pipelineDiagnosticTextMaxLength: 5,
    pipelineDiagnosticDetailsMaxKeys: 0,
    pipelineDiagnosticDetailsMaxItems: 999,
    pipelineDiagnosticDetailsMaxDepth: -1,
    enableUiValidation: false,
    enableVisualQualityValidation: true,
    visualQualityReferenceMode: "FROZEN_FIXTURE",
    visualQualityViewportWidth: 99_999,
    visualQualityViewportHeight: 99_999,
    visualQualityDeviceScaleFactor: 99,
    enableUnitTestValidation: true,
    installPreferOffline: false,
    skipInstall: true,
    maxConcurrentJobs: 999,
    maxQueuedJobs: -7
  });

  assert.equal(runtime.figmaBootstrapDepth, 10);
  assert.equal(runtime.figmaCircuitBreakerFailureThreshold, 20);
  assert.equal(runtime.figmaCircuitBreakerResetTimeoutMs, 1_000);
  assert.equal(runtime.figmaNodeBatchSize, 1);
  assert.equal(runtime.figmaNodeFetchConcurrency, 10);
  assert.equal(runtime.figmaAdaptiveBatchingEnabled, false);
  assert.equal(runtime.figmaMaxScreenCandidates, 1);
  assert.equal(runtime.figmaScreenNamePattern, "^auth/(login|register)$");
  assert.equal(runtime.figmaCacheEnabled, false);
  assert.equal(runtime.figmaCacheTtlMs, 24 * 60 * 60_000);
  assert.equal(runtime.iconMapFilePath, "/tmp/icon-map.json");
  assert.equal(runtime.designSystemFilePath, "/tmp/design-system.json");
  assert.equal(runtime.exportImages, false);
  assert.equal(runtime.figmaScreenElementBudget, 10_000);
  assert.equal(runtime.figmaScreenElementMaxDepth, 1);
  assert.equal(runtime.brandTheme, "sparkasse");
  assert.equal(runtime.sparkasseTokensFilePath, "/tmp/sparkasse-tokens.json");
  assert.equal(runtime.generationLocale, "en-US");
  assert.equal(runtime.routerMode, "hash");
  assert.equal(runtime.commandTimeoutMs, 5_000);
  assert.equal(runtime.commandStdoutMaxBytes, 16_777_216);
  assert.equal(runtime.commandStderrMaxBytes, 4_096);
  assert.equal(runtime.pipelineDiagnosticLimits.maxDiagnostics, 500);
  assert.equal(runtime.pipelineDiagnosticLimits.textMaxLength, 16);
  assert.equal(runtime.pipelineDiagnosticLimits.detailsMaxKeys, 1);
  assert.equal(runtime.pipelineDiagnosticLimits.detailsMaxItems, 200);
  assert.equal(runtime.pipelineDiagnosticLimits.detailsMaxDepth, 1);
  assert.equal(runtime.enableLintAutofix, true);
  assert.equal(runtime.enablePerfValidation, false);
  assert.equal(runtime.enableUiValidation, false);
  assert.equal(runtime.enableVisualQualityValidation, true);
  assert.equal(runtime.visualQualityReferenceMode, "frozen_fixture");
  assert.equal(runtime.visualQualityViewportWidth, 4_096);
  assert.equal(runtime.visualQualityViewportHeight, 4_096);
  assert.equal(runtime.visualQualityDeviceScaleFactor, 4);
  assert.deepEqual(runtime.compositeQualityWeights, {
    visual: 0.6,
    performance: 0.4
  });
  assert.equal(runtime.enableUnitTestValidation, true);
  assert.equal(runtime.installPreferOffline, false);
  assert.equal(runtime.skipInstall, true);
  assert.equal(runtime.maxConcurrentJobs, 16);
  assert.equal(runtime.maxQueuedJobs, 0);
});

test("resolveRuntimeSettings normalizes empty figma screen name pattern to undefined", () => {
  const runtime = resolveRuntimeSettings({
    figmaScreenNamePattern: "   "
  });

  assert.equal(runtime.figmaScreenNamePattern, undefined);
});

test("resolveRuntimeSettings normalizes empty icon map path to undefined", () => {
  const runtime = resolveRuntimeSettings({
    iconMapFilePath: "   "
  });

  assert.equal(runtime.iconMapFilePath, undefined);
});

test("resolveRuntimeSettings normalizes empty design system path to undefined", () => {
  const runtime = resolveRuntimeSettings({
    designSystemFilePath: "   "
  });

  assert.equal(runtime.designSystemFilePath, undefined);
});

test("resolveRuntimeSettings falls back to default visual quality settings for invalid values", () => {
  const runtime = resolveRuntimeSettings({
    visualQualityReferenceMode: "invalid_mode",
    visualQualityViewportWidth: -10,
    visualQualityViewportHeight: -10,
    visualQualityDeviceScaleFactor: -0.25
  });

  assert.equal(runtime.visualQualityReferenceMode, "figma_api");
  assert.equal(runtime.visualQualityViewportWidth, 1280);
  assert.equal(runtime.visualQualityViewportHeight, 800);
  assert.equal(runtime.visualQualityDeviceScaleFactor, 1);
});

test("resolveRuntimeSettings resolves composite quality weights from explicit input and environment fallbacks", () => {
  const previousVisual = process.env.FIGMAPIPE_WORKSPACE_COMPOSITE_QUALITY_VISUAL_WEIGHT;
  const previousPerformance = process.env.FIGMAPIPE_WORKSPACE_COMPOSITE_QUALITY_PERFORMANCE_WEIGHT;

  process.env.FIGMAPIPE_WORKSPACE_COMPOSITE_QUALITY_VISUAL_WEIGHT = "0.2";
  process.env.FIGMAPIPE_WORKSPACE_COMPOSITE_QUALITY_PERFORMANCE_WEIGHT = "0.8";
  try {
    const fromEnv = resolveRuntimeSettings({});
    assert.deepEqual(fromEnv.compositeQualityWeights, {
      visual: 0.2,
      performance: 0.8
    });

    const fromInput = resolveRuntimeSettings({
      compositeQualityWeights: {
        visual: 0.75
      }
    });
    assert.deepEqual(fromInput.compositeQualityWeights, {
      visual: 0.75,
      performance: 0.25
    });
  } finally {
    if (previousVisual === undefined) {
      delete process.env.FIGMAPIPE_WORKSPACE_COMPOSITE_QUALITY_VISUAL_WEIGHT;
    } else {
      process.env.FIGMAPIPE_WORKSPACE_COMPOSITE_QUALITY_VISUAL_WEIGHT = previousVisual;
    }
    if (previousPerformance === undefined) {
      delete process.env.FIGMAPIPE_WORKSPACE_COMPOSITE_QUALITY_PERFORMANCE_WEIGHT;
    } else {
      process.env.FIGMAPIPE_WORKSPACE_COMPOSITE_QUALITY_PERFORMANCE_WEIGHT = previousPerformance;
    }
  }
});

test("resolveRuntimeSettings resolves validation policy from environment and explicit overrides", () => {
  const previousLintAutofix = process.env.FIGMAPIPE_WORKSPACE_ENABLE_LINT_AUTOFIX;
  const previousWorkspacePerf = process.env.FIGMAPIPE_WORKSPACE_ENABLE_PERF_VALIDATION;
  const previousLegacyPerf = process.env.FIGMAPIPE_ENABLE_PERF_VALIDATION;

  process.env.FIGMAPIPE_WORKSPACE_ENABLE_LINT_AUTOFIX = "false";
  process.env.FIGMAPIPE_WORKSPACE_ENABLE_PERF_VALIDATION = "true";
  process.env.FIGMAPIPE_ENABLE_PERF_VALIDATION = "false";

  try {
    const fromEnv = resolveRuntimeSettings({});
    assert.equal(fromEnv.enableLintAutofix, false);
    assert.equal(fromEnv.enablePerfValidation, true);

    const fromInput = resolveRuntimeSettings({
      enableLintAutofix: true,
      enablePerfValidation: false
    });
    assert.equal(fromInput.enableLintAutofix, true);
    assert.equal(fromInput.enablePerfValidation, false);
  } finally {
    if (previousLintAutofix === undefined) {
      delete process.env.FIGMAPIPE_WORKSPACE_ENABLE_LINT_AUTOFIX;
    } else {
      process.env.FIGMAPIPE_WORKSPACE_ENABLE_LINT_AUTOFIX = previousLintAutofix;
    }
    if (previousWorkspacePerf === undefined) {
      delete process.env.FIGMAPIPE_WORKSPACE_ENABLE_PERF_VALIDATION;
    } else {
      process.env.FIGMAPIPE_WORKSPACE_ENABLE_PERF_VALIDATION = previousWorkspacePerf;
    }
    if (previousLegacyPerf === undefined) {
      delete process.env.FIGMAPIPE_ENABLE_PERF_VALIDATION;
    } else {
      process.env.FIGMAPIPE_ENABLE_PERF_VALIDATION = previousLegacyPerf;
    }
  }
});

test("resolveRuntimeSettings accepts in-range visual quality viewport height and device scale factor", () => {
  const runtime = resolveRuntimeSettings({
    visualQualityViewportHeight: 1024,
    visualQualityDeviceScaleFactor: 2
  });

  assert.equal(runtime.visualQualityViewportHeight, 1024);
  assert.equal(runtime.visualQualityDeviceScaleFactor, 2);
});

test("resolveRuntimeSettings rejects out-of-range viewport height values below minimum", () => {
  const runtime = resolveRuntimeSettings({
    visualQualityViewportHeight: 50
  });

  assert.equal(runtime.visualQualityViewportHeight, 800);
});

test("resolveRuntimeSettings clamps viewport height values above the maximum", () => {
  const runtime = resolveRuntimeSettings({
    visualQualityViewportHeight: 10_000
  });

  assert.equal(runtime.visualQualityViewportHeight, 4_096);
});

test("resolveRuntimeSettings rejects non-finite viewport height values", () => {
  const runtime = resolveRuntimeSettings({
    visualQualityViewportHeight: Number.NaN
  });

  assert.equal(runtime.visualQualityViewportHeight, 800);
});

test("resolveRuntimeSettings preserves fractional device scale factors in range", () => {
  const runtime = resolveRuntimeSettings({
    visualQualityDeviceScaleFactor: 1.5
  });

  assert.equal(runtime.visualQualityDeviceScaleFactor, 1.5);
});

test("resolveRuntimeSettings rejects device scale factors below minimum", () => {
  const runtime = resolveRuntimeSettings({
    visualQualityDeviceScaleFactor: 0.25
  });

  assert.equal(runtime.visualQualityDeviceScaleFactor, 1);
});

test("resolveRuntimeSettings clamps device scale factors above the maximum", () => {
  const runtime = resolveRuntimeSettings({
    visualQualityDeviceScaleFactor: 16
  });

  assert.equal(runtime.visualQualityDeviceScaleFactor, 4);
});

test("resolveRuntimeSettings rejects non-finite device scale factors", () => {
  const runtime = resolveRuntimeSettings({
    visualQualityDeviceScaleFactor: Number.POSITIVE_INFINITY
  });

  assert.equal(runtime.visualQualityDeviceScaleFactor, 1);
});

test("resolveRuntimeSettings falls back to derived brand theme for unknown values", () => {
  const runtime = resolveRuntimeSettings({
    brandTheme: "unknown",
    generationLocale: "invalid_locale",
    routerMode: "invalid_router_mode"
  });

  assert.equal(runtime.brandTheme, "derived");
  assert.equal(runtime.generationLocale, "de-DE");
  assert.equal(runtime.routerMode, "browser");
});

test("resolveRuntimeSettings preserves an optional hybrid MCP enrichment loader", () => {
  const loader = async () => undefined;
  const runtime = resolveRuntimeSettings({
    figmaMcpEnrichmentLoader: loader
  });

  assert.equal(runtime.figmaMcpEnrichmentLoader, loader);
});

test("resolveRuntimeSettings logs shared circuit breaker transitions with figma.source stage", () => {
  const logs: Array<{ level: string; message: string; stage?: string; jobId?: string }> = [];
  let nowMs = 1_000;
  const runtime = resolveRuntimeSettings({
    figmaCircuitBreakerFailureThreshold: 1,
    figmaCircuitBreakerResetTimeoutMs: 5_000,
    figmaCircuitBreakerClock: {
      now: () => nowMs
    },
    logger: {
      log: (input) => {
        logs.push(input);
      }
    }
  });

  runtime.figmaRestCircuitBreaker.beforeRequest();
  runtime.figmaRestCircuitBreaker.recordTransientFailure();

  nowMs += 5_000;
  runtime.figmaRestCircuitBreaker.beforeRequest();
  runtime.figmaRestCircuitBreaker.recordSuccess();

  assert.deepEqual(logs, [
    {
      level: "info",
      stage: "figma.source",
      message:
        "Figma REST circuit breaker transitioned closed -> open " +
        "(trigger=failure-threshold-reached, consecutiveFailures=1, probeInFlight=false, nextProbeAt=6000)."
    },
    {
      level: "info",
      stage: "figma.source",
      message:
        "Figma REST circuit breaker transitioned open -> half-open " +
        "(trigger=reset-timeout-elapsed, consecutiveFailures=1, probeInFlight=false, nextProbeAt=6000)."
    },
    {
      level: "info",
      stage: "figma.source",
      message:
        "Figma REST circuit breaker transitioned half-open -> closed " +
        "(trigger=probe-succeeded, consecutiveFailures=0, probeInFlight=false)."
    }
  ]);
});
