import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { InspectorIntentMetricsPage } from "./inspector-intent-metrics-page";
import {
  __resetIntentClassificationMetricsForTests,
  recordClassification,
  recordCorrection,
} from "./inspector/intent-classification-metrics";

describe("InspectorIntentMetricsPage", () => {
  beforeEach(() => {
    __resetIntentClassificationMetricsForTests();
  });

  afterEach(() => {
    __resetIntentClassificationMetricsForTests();
    cleanup();
  });

  it("renders the current snapshot and threshold status", () => {
    recordClassification({ intent: "FIGMA_JSON_DOC", confidence: 0.9 });
    recordClassification({ intent: "RAW_CODE_OR_TEXT", confidence: 0.7 });

    render(
      <MemoryRouter>
        <InspectorIntentMetricsPage />
      </MemoryRouter>,
    );

    expect(
      screen.getByTestId("intent-metrics-total-classifications"),
    ).toHaveTextContent("2");
    expect(
      screen.getByTestId("intent-metrics-total-corrections"),
    ).toHaveTextContent("0");
    expect(
      screen.getByTestId("intent-metrics-misclassification-rate"),
    ).toHaveTextContent("0.00%");
    expect(
      screen.getByTestId("intent-metrics-threshold-status"),
    ).toHaveTextContent("Pass");
  });

  it("shows a failing threshold when corrections exceed the 5% ceiling", () => {
    recordClassification({ intent: "FIGMA_JSON_DOC", confidence: 0.9 });
    recordCorrection({
      from: "FIGMA_JSON_DOC",
      to: "FIGMA_PLUGIN_ENVELOPE",
    });

    render(
      <MemoryRouter>
        <InspectorIntentMetricsPage />
      </MemoryRouter>,
    );

    expect(
      screen.getByTestId("intent-metrics-misclassification-rate"),
    ).toHaveTextContent("100.00%");
    expect(
      screen.getByTestId("intent-metrics-threshold-status"),
    ).toHaveTextContent("Fail");
    expect(
      screen.getByTestId(
        "intent-metrics-correction-FIGMA_JSON_DOC-FIGMA_PLUGIN_ENVELOPE",
      ),
    ).toHaveTextContent("1");
  });

  it("resets counters from the diagnostics page", async () => {
    recordClassification({ intent: "FIGMA_JSON_DOC", confidence: 0.9 });

    render(
      <MemoryRouter>
        <InspectorIntentMetricsPage />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByTestId("intent-metrics-reset"));

    await waitFor(() => {
      expect(
        screen.getByTestId("intent-metrics-total-classifications"),
      ).toHaveTextContent("0");
    });
    expect(
      screen.getByTestId("intent-metrics-threshold-status"),
    ).toHaveTextContent("No data");
    expect(screen.getByTestId("intent-metrics-empty-events")).toBeVisible();
  });
});
