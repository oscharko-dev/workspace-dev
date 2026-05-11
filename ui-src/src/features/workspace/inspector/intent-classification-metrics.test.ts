import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  INTENT_CLASSIFICATION_METRICS_STORAGE_VERSION,
  __resetIntentClassificationMetricsForTests,
  bucketFromConfidence,
  getIntentClassificationMetricsSnapshot,
  recordClassification,
  recordCorrection,
  type ConfidenceBucket,
} from "./intent-classification-metrics";

const STORAGE_KEY = "workspace-dev:intent-classification-metrics";

const ALL_INTENTS = [
  "FIGMA_JSON_NODE_BATCH",
  "FIGMA_JSON_DOC",
  "FIGMA_PLUGIN_ENVELOPE",
  "RAW_CODE_OR_TEXT",
  "UNKNOWN",
] as const;

const ALL_BUCKETS: readonly ConfidenceBucket[] = [
  "very_high",
  "high",
  "medium",
  "low",
];

beforeEach(() => {
  __resetIntentClassificationMetricsForTests();
});

afterEach(() => {
  __resetIntentClassificationMetricsForTests();
  vi.restoreAllMocks();
});

describe("bucketFromConfidence", () => {
  it("maps >= 0.9 to very_high (exact 0.9 boundary)", () => {
    expect(bucketFromConfidence(0.9)).toBe("very_high");
    expect(bucketFromConfidence(0.95)).toBe("very_high");
    expect(bucketFromConfidence(1.0)).toBe("very_high");
  });

  it("maps [0.8, 0.9) to high (exact 0.8 boundary)", () => {
    expect(bucketFromConfidence(0.8)).toBe("high");
    expect(bucketFromConfidence(0.85)).toBe("high");
    expect(bucketFromConfidence(0.8999)).toBe("high");
  });

  it("maps [0.7, 0.8) to medium (exact 0.7 boundary)", () => {
    expect(bucketFromConfidence(0.7)).toBe("medium");
    expect(bucketFromConfidence(0.75)).toBe("medium");
    expect(bucketFromConfidence(0.7999)).toBe("medium");
  });

  it("maps < 0.7 to low", () => {
    expect(bucketFromConfidence(0.6999)).toBe("low");
    expect(bucketFromConfidence(0.6)).toBe("low");
    expect(bucketFromConfidence(0)).toBe("low");
  });
});

describe("recordClassification", () => {
  it("increments the counter for matching intent + bucket", () => {
    recordClassification({ intent: "FIGMA_JSON_NODE_BATCH", confidence: 0.85 });
    recordClassification({ intent: "FIGMA_JSON_NODE_BATCH", confidence: 0.85 });

    const snapshot = getIntentClassificationMetricsSnapshot();

    expect(snapshot.classifications.FIGMA_JSON_NODE_BATCH.high).toBe(2);
    expect(snapshot.totalClassifications).toBe(2);
  });

  it("keeps distinct intents + buckets separate", () => {
    recordClassification({ intent: "FIGMA_JSON_NODE_BATCH", confidence: 0.95 });
    recordClassification({ intent: "FIGMA_JSON_DOC", confidence: 0.9 });
    recordClassification({ intent: "FIGMA_PLUGIN_ENVELOPE", confidence: 0.85 });
    recordClassification({ intent: "RAW_CODE_OR_TEXT", confidence: 0.6 });

    const snapshot = getIntentClassificationMetricsSnapshot();

    expect(snapshot.classifications.FIGMA_JSON_NODE_BATCH.very_high).toBe(1);
    expect(snapshot.classifications.FIGMA_JSON_NODE_BATCH.high).toBe(0);
    expect(snapshot.classifications.FIGMA_JSON_DOC.very_high).toBe(1);
    expect(snapshot.classifications.FIGMA_PLUGIN_ENVELOPE.high).toBe(1);
    expect(snapshot.classifications.RAW_CODE_OR_TEXT.low).toBe(1);
    expect(snapshot.totalClassifications).toBe(4);
  });

  it("appends a classification event to recentEvents", () => {
    recordClassification({ intent: "FIGMA_JSON_DOC", confidence: 0.9 });

    const snapshot = getIntentClassificationMetricsSnapshot();
    const last = snapshot.recentEvents[snapshot.recentEvents.length - 1];

    expect(last).toMatchObject({
      type: "classification",
      intent: "FIGMA_JSON_DOC",
      confidenceBucket: "very_high",
    });
    expect(typeof last?.timestamp).toBe("number");
  });
});

describe("recordCorrection", () => {
  it("increments the from/to correction counter", () => {
    recordCorrection({
      from: "FIGMA_JSON_NODE_BATCH",
      to: "FIGMA_PLUGIN_ENVELOPE",
    });
    recordCorrection({
      from: "FIGMA_JSON_NODE_BATCH",
      to: "FIGMA_PLUGIN_ENVELOPE",
    });
    recordCorrection({
      from: "FIGMA_JSON_NODE_BATCH",
      to: "RAW_CODE_OR_TEXT",
    });

    const snapshot = getIntentClassificationMetricsSnapshot();

    expect(
      snapshot.corrections.FIGMA_JSON_NODE_BATCH.FIGMA_PLUGIN_ENVELOPE,
    ).toBe(2);
    expect(snapshot.corrections.FIGMA_JSON_NODE_BATCH.RAW_CODE_OR_TEXT).toBe(1);
    expect(snapshot.totalCorrections).toBe(3);
  });

  it("does not filter same-intent corrections (caller owns that gate)", () => {
    recordCorrection({
      from: "FIGMA_JSON_NODE_BATCH",
      to: "FIGMA_JSON_NODE_BATCH",
    });

    const snapshot = getIntentClassificationMetricsSnapshot();
    expect(
      snapshot.corrections.FIGMA_JSON_NODE_BATCH.FIGMA_JSON_NODE_BATCH,
    ).toBe(1);
    expect(snapshot.totalCorrections).toBe(1);
  });
});

describe("snapshot shape", () => {
  it("exposes every intent x bucket combination with zero by default", () => {
    const snapshot = getIntentClassificationMetricsSnapshot();

    for (const intent of ALL_INTENTS) {
      for (const bucket of ALL_BUCKETS) {
        expect(snapshot.classifications[intent][bucket]).toBe(0);
      }
    }

    for (const from of ALL_INTENTS) {
      for (const to of ALL_INTENTS) {
        expect(snapshot.corrections[from][to]).toBe(0);
      }
    }

    expect(snapshot.totalClassifications).toBe(0);
    expect(snapshot.totalCorrections).toBe(0);
    expect(snapshot.misclassificationRate).toBe(0);
    expect(snapshot.recentEvents).toHaveLength(0);
    expect(snapshot.storageVersion).toBe(
      INTENT_CLASSIFICATION_METRICS_STORAGE_VERSION,
    );
  });

  it("computes misclassificationRate as totalCorrections / totalClassifications", () => {
    recordClassification({ intent: "FIGMA_JSON_NODE_BATCH", confidence: 0.85 });
    recordClassification({ intent: "FIGMA_JSON_NODE_BATCH", confidence: 0.85 });
    recordClassification({ intent: "FIGMA_JSON_NODE_BATCH", confidence: 0.85 });
    recordClassification({ intent: "FIGMA_JSON_NODE_BATCH", confidence: 0.85 });
    recordCorrection({
      from: "FIGMA_JSON_NODE_BATCH",
      to: "FIGMA_PLUGIN_ENVELOPE",
    });

    const snapshot = getIntentClassificationMetricsSnapshot();
    expect(snapshot.totalClassifications).toBe(4);
    expect(snapshot.totalCorrections).toBe(1);
    expect(snapshot.misclassificationRate).toBeCloseTo(0.25);
  });

  it("returns rate 0 (not NaN) when there are no classifications", () => {
    const snapshot = getIntentClassificationMetricsSnapshot();
    expect(Number.isNaN(snapshot.misclassificationRate)).toBe(false);
    expect(snapshot.misclassificationRate).toBe(0);
  });

  it("returns a deep-frozen snapshot that cannot be mutated", () => {
    recordClassification({ intent: "FIGMA_JSON_DOC", confidence: 0.9 });
    const snapshot = getIntentClassificationMetricsSnapshot();

    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.classifications)).toBe(true);
    expect(Object.isFrozen(snapshot.classifications.FIGMA_JSON_DOC)).toBe(true);
    expect(Object.isFrozen(snapshot.corrections)).toBe(true);

    expect(() => {
      (
        snapshot.classifications.FIGMA_JSON_DOC as Record<string, number>
      ).very_high = 999;
    }).toThrow();

    const fresh = getIntentClassificationMetricsSnapshot();
    expect(fresh.classifications.FIGMA_JSON_DOC.very_high).toBe(1);
  });
});

describe("ring buffer", () => {
  it("caps recentEvents at 200 with FIFO eviction", () => {
    for (let index = 0; index < 205; index += 1) {
      recordClassification({
        intent: "FIGMA_JSON_NODE_BATCH",
        confidence: 0.85,
      });
    }

    const snapshot = getIntentClassificationMetricsSnapshot();
    expect(snapshot.recentEvents).toHaveLength(200);
    expect(snapshot.totalClassifications).toBe(205);
  });

  it("retains the most recent events when at capacity", () => {
    for (let index = 0; index < 200; index += 1) {
      recordClassification({
        intent: "FIGMA_JSON_NODE_BATCH",
        confidence: 0.85,
      });
    }
    recordCorrection({
      from: "FIGMA_JSON_NODE_BATCH",
      to: "FIGMA_PLUGIN_ENVELOPE",
    });

    const snapshot = getIntentClassificationMetricsSnapshot();
    expect(snapshot.recentEvents).toHaveLength(200);
    const last = snapshot.recentEvents[snapshot.recentEvents.length - 1];
    expect(last?.type).toBe("correction");
  });
});

describe("localStorage persistence", () => {
  it("restores counters from localStorage on next access", () => {
    recordClassification({ intent: "FIGMA_JSON_DOC", confidence: 0.9 });
    recordCorrection({
      from: "FIGMA_JSON_DOC",
      to: "FIGMA_PLUGIN_ENVELOPE",
    });

    const stored = window.localStorage.getItem(STORAGE_KEY);
    expect(stored).not.toBeNull();

    __resetIntentClassificationMetricsForTests();
    window.localStorage.setItem(STORAGE_KEY, stored ?? "");

    const restored = getIntentClassificationMetricsSnapshot();
    expect(restored.totalClassifications).toBe(1);
    expect(restored.totalCorrections).toBe(1);
    expect(restored.classifications.FIGMA_JSON_DOC.very_high).toBe(1);
    expect(restored.corrections.FIGMA_JSON_DOC.FIGMA_PLUGIN_ENVELOPE).toBe(1);
  });

  it("discards stored payloads with an unsupported storageVersion", () => {
    __resetIntentClassificationMetricsForTests();
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        version: INTENT_CLASSIFICATION_METRICS_STORAGE_VERSION + 999,
        classifications: {},
        corrections: {},
        recentEvents: [],
        totalClassifications: 42,
        totalCorrections: 7,
      }),
    );

    const snapshot = getIntentClassificationMetricsSnapshot();
    expect(snapshot.totalClassifications).toBe(0);
    expect(snapshot.totalCorrections).toBe(0);
  });

  it("discards malformed JSON in localStorage", () => {
    __resetIntentClassificationMetricsForTests();
    window.localStorage.setItem(STORAGE_KEY, "{not valid json");

    const snapshot = getIntentClassificationMetricsSnapshot();
    expect(snapshot.totalClassifications).toBe(0);
  });

  it("discards payloads with invalid total counters", () => {
    __resetIntentClassificationMetricsForTests();
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        version: INTENT_CLASSIFICATION_METRICS_STORAGE_VERSION,
        classifications: {},
        corrections: {},
        recentEvents: [],
        totalClassifications: Number.NaN,
        totalCorrections: Infinity,
      }),
    );

    const snapshot = getIntentClassificationMetricsSnapshot();
    expect(snapshot.totalClassifications).toBe(0);
    expect(snapshot.totalCorrections).toBe(0);
    expect(snapshot.misclassificationRate).toBe(0);
  });

  it("recomputes totals from restored counters instead of trusting stored totals", () => {
    __resetIntentClassificationMetricsForTests();
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        version: INTENT_CLASSIFICATION_METRICS_STORAGE_VERSION,
        classifications: {
          FIGMA_JSON_DOC: { very_high: 2 },
          RAW_CODE_OR_TEXT: { low: 1 },
        },
        corrections: {
          FIGMA_JSON_DOC: { FIGMA_PLUGIN_ENVELOPE: 3 },
        },
        recentEvents: [],
        totalClassifications: 999,
        totalCorrections: 999,
      }),
    );

    const snapshot = getIntentClassificationMetricsSnapshot();
    expect(snapshot.totalClassifications).toBe(3);
    expect(snapshot.totalCorrections).toBe(3);
    expect(snapshot.misclassificationRate).toBe(1);
  });

  it("does not throw when localStorage.setItem throws", () => {
    const setItemSpy = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new Error("QuotaExceededError");
      });

    expect(() => {
      recordClassification({ intent: "FIGMA_JSON_DOC", confidence: 0.9 });
    }).not.toThrow();
    expect(() => {
      recordCorrection({
        from: "FIGMA_JSON_DOC",
        to: "FIGMA_PLUGIN_ENVELOPE",
      });
    }).not.toThrow();

    expect(setItemSpy).toHaveBeenCalled();
  });

  it("does not throw when localStorage.getItem throws on restore", () => {
    __resetIntentClassificationMetricsForTests();
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });

    expect(() => getIntentClassificationMetricsSnapshot()).not.toThrow();
  });
});

describe("__resetIntentClassificationMetricsForTests", () => {
  it("clears counters, buffer, and localStorage entry", () => {
    recordClassification({ intent: "FIGMA_JSON_DOC", confidence: 0.9 });
    recordCorrection({
      from: "FIGMA_JSON_DOC",
      to: "FIGMA_PLUGIN_ENVELOPE",
    });

    expect(window.localStorage.getItem(STORAGE_KEY)).not.toBeNull();

    __resetIntentClassificationMetricsForTests();

    const snapshot = getIntentClassificationMetricsSnapshot();
    expect(snapshot.totalClassifications).toBe(0);
    expect(snapshot.totalCorrections).toBe(0);
    expect(snapshot.recentEvents).toHaveLength(0);
    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
  });
});
