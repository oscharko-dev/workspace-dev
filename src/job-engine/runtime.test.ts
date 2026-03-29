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
  assert.equal(runtime.enableUiValidation, false);
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
  assert.equal(runtime.enableUiValidation, false);
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
