import { onCLS, onFCP, onINP, onLCP, onTTFB, type Metric } from "web-vitals";

interface WebVitalsPayload {
  metric: string;
  value: number;
  rating: string;
  id: string;
  delta: number;
  navigationType: string;
  route: string;
  href: string;
  timestamp: string;
}

const toSampleRate = (rawValue: string | undefined): number => {
  if (!rawValue || rawValue.trim().length === 0) {
    return 1;
  }
  const parsed = Number(rawValue);
  if (!Number.isFinite(parsed)) {
    return 1;
  }
  return Math.max(0, Math.min(1, parsed));
};

const shouldSample = (sampleRate: number): boolean => {
  if (sampleRate <= 0) {
    return false;
  }
  if (sampleRate >= 1) {
    return true;
  }
  return Math.random() <= sampleRate;
};

let reportingStarted = false;
let samplingDecision: boolean | undefined;

const resolveRoute = (): string => {
  const hashRoute = window.location.hash.startsWith("#") ? window.location.hash.slice(1) : "";
  if (hashRoute && hashRoute.startsWith("/")) {
    return hashRoute;
  }
  return window.location.pathname || "/";
};

const shouldSamplePageLoad = (sampleRate: number): boolean => {
  if (samplingDecision === undefined) {
    samplingDecision = shouldSample(sampleRate);
  }
  return samplingDecision;
};

const sendToEndpoint = async ({
  endpoint,
  payload
}: {
  endpoint: string;
  payload: WebVitalsPayload;
}): Promise<void> => {
  const body = JSON.stringify(payload);
  const sent = navigator.sendBeacon(endpoint, new Blob([body], { type: "application/json" }));
  if (sent) {
    return;
  }
  await fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body,
    keepalive: true
  }).catch(() => {
    // Ignore reporting errors; telemetry must never block rendering.
  });
};

const createPayload = (metric: Metric): WebVitalsPayload => {
  return {
    metric: metric.name,
    value: metric.value,
    rating: metric.rating,
    id: metric.id,
    delta: metric.delta,
    navigationType: metric.navigationType,
    route: resolveRoute(),
    href: window.location.href,
    timestamp: new Date().toISOString()
  };
};

export const resetWebVitalsReportingForTests = (): void => {
  reportingStarted = false;
  samplingDecision = undefined;
};

export const startWebVitalsReporting = (): void => {
  if (reportingStarted) {
    return;
  }

  const sampleRate = toSampleRate(import.meta.env.VITE_PERF_SAMPLE_RATE);
  if (!shouldSamplePageLoad(sampleRate)) {
    return;
  }
  reportingStarted = true;

  const endpoint = import.meta.env.VITE_PERF_ENDPOINT?.trim() ?? "";
  const report = (metric: Metric): void => {
    const payload = createPayload(metric);
    if (endpoint) {
      void sendToEndpoint({ endpoint, payload });
      return;
    }
    console.info("[web-vitals]", payload);
  };

  onCLS(report);
  onFCP(report);
  onINP(report, { reportAllChanges: true });
  onLCP(report);
  onTTFB(report);
};
