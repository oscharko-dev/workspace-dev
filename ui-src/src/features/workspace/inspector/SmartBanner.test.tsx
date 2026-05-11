import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SmartBanner } from "./SmartBanner";
import type { ImportIntent } from "./paste-input-classifier";

afterEach(() => {
  cleanup();
});

function renderBanner({
  intent = "FIGMA_JSON_NODE_BATCH" as ImportIntent,
  confidence = 0.9,
  onConfirm = vi.fn(),
  onDismiss = vi.fn(),
}: {
  intent?: ImportIntent;
  confidence?: number;
  onConfirm?: (intent: ImportIntent) => void;
  onDismiss?: () => void;
} = {}) {
  render(
    <SmartBanner
      intent={intent}
      confidence={confidence}
      onConfirm={onConfirm}
      onDismiss={onDismiss}
    />,
  );
}

/**
 * Returns the display label span — the `<span class="...font-semibold...">` that
 * shows the currently selected intent label. This is distinct from the `<option>`
 * elements inside the `<select>`, which share the same text.
 */
function getDisplayLabelSpan(): HTMLElement {
  const span = screen
    .getByTestId("smart-banner")
    .querySelector<HTMLElement>("span.font-semibold");
  if (!span) throw new Error("Display label <span> not found in smart-banner");
  return span;
}

describe("SmartBanner — intent labels", () => {
  it("displays 'Figma-Node JSON' for FIGMA_JSON_NODE_BATCH", () => {
    renderBanner({ intent: "FIGMA_JSON_NODE_BATCH" });
    expect(getDisplayLabelSpan()).toHaveTextContent("Figma-Node JSON");
  });

  it("displays 'Figma-Dokument JSON' for FIGMA_JSON_DOC", () => {
    renderBanner({ intent: "FIGMA_JSON_DOC" });
    expect(getDisplayLabelSpan()).toHaveTextContent("Figma-Dokument JSON");
  });

  it("displays 'Code / Text' for RAW_CODE_OR_TEXT", () => {
    renderBanner({ intent: "RAW_CODE_OR_TEXT" });
    expect(getDisplayLabelSpan()).toHaveTextContent("Code / Text");
  });

  it("displays 'Unbekannt' for UNKNOWN", () => {
    renderBanner({ intent: "UNKNOWN" });
    expect(getDisplayLabelSpan()).toHaveTextContent("Unbekannt");
  });
});

describe("SmartBanner — confidence display", () => {
  it("shows '85%' when confidence is 0.85", () => {
    renderBanner({ confidence: 0.85 });
    expect(screen.getByText("85%")).toBeInTheDocument();
  });

  it("shows '100%' when confidence is 1.0", () => {
    renderBanner({ confidence: 1.0 });
    expect(screen.getByText("100%")).toBeInTheDocument();
  });

  it("shows '0%' when confidence is 0", () => {
    renderBanner({ confidence: 0 });
    expect(screen.getByText("0%")).toBeInTheDocument();
  });

  it("rounds to nearest integer — 0.999 shows '100%'", () => {
    renderBanner({ confidence: 0.999 });
    expect(screen.getByText("100%")).toBeInTheDocument();
  });

  it("rounds to nearest integer — 0.456 shows '46%'", () => {
    renderBanner({ confidence: 0.456 });
    expect(screen.getByText("46%")).toBeInTheDocument();
  });
});

describe("SmartBanner — confirm button", () => {
  it("calls onConfirm with the initial intent when 'Import starten' is clicked without changing the dropdown", () => {
    const onConfirm = vi.fn();
    renderBanner({ intent: "FIGMA_JSON_DOC", onConfirm });

    fireEvent.click(screen.getByRole("button", { name: /import starten/i }));

    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onConfirm).toHaveBeenCalledWith("FIGMA_JSON_DOC");
  });

  it("calls onConfirm with the corrected intent after changing the dropdown", () => {
    const onConfirm = vi.fn();
    renderBanner({ intent: "FIGMA_JSON_NODE_BATCH", onConfirm });

    const select = screen.getByRole("combobox", {
      name: /erkannten typ korrigieren/i,
    });
    fireEvent.change(select, { target: { value: "RAW_CODE_OR_TEXT" } });

    fireEvent.click(screen.getByRole("button", { name: /import starten/i }));

    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onConfirm).toHaveBeenCalledWith("RAW_CODE_OR_TEXT");
  });

  it("does not call onConfirm when only the dropdown changes (no button click)", () => {
    const onConfirm = vi.fn();
    renderBanner({ intent: "FIGMA_JSON_NODE_BATCH", onConfirm });

    const select = screen.getByRole("combobox", {
      name: /erkannten typ korrigieren/i,
    });
    fireEvent.change(select, { target: { value: "FIGMA_JSON_DOC" } });

    expect(onConfirm).not.toHaveBeenCalled();
  });
});

describe("SmartBanner — dismiss button", () => {
  it("calls onDismiss when the close button is clicked", () => {
    const onDismiss = vi.fn();
    renderBanner({ onDismiss });

    fireEvent.click(screen.getByRole("button", { name: /banner schliessen/i }));

    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("does not call onConfirm when the close button is clicked", () => {
    const onConfirm = vi.fn();
    renderBanner({ onConfirm });

    fireEvent.click(screen.getByRole("button", { name: /banner schliessen/i }));

    expect(onConfirm).not.toHaveBeenCalled();
  });
});

describe("SmartBanner — dropdown options", () => {
  it("has all 4 intent options in the dropdown", () => {
    renderBanner();

    const select = screen.getByRole("combobox", {
      name: /erkannten typ korrigieren/i,
    });
    const options = Array.from((select as HTMLSelectElement).options).map(
      (o) => o.value,
    );

    expect(options).toContain("FIGMA_JSON_NODE_BATCH");
    expect(options).toContain("FIGMA_JSON_DOC");
    expect(options).toContain("FIGMA_PLUGIN_ENVELOPE");
    expect(options).toContain("RAW_CODE_OR_TEXT");
    expect(options).toContain("UNKNOWN");
    expect(options).toHaveLength(5);
  });

  it("option labels match expected German translations", () => {
    renderBanner();

    const select = screen.getByRole("combobox", {
      name: /erkannten typ korrigieren/i,
    });
    const labels = Array.from((select as HTMLSelectElement).options).map(
      (o) => o.text,
    );

    expect(labels).toContain("Figma-Node JSON");
    expect(labels).toContain("Figma-Dokument JSON");
    expect(labels).toContain("Plugin Export");
    expect(labels).toContain("Code / Text");
    expect(labels).toContain("Unbekannt");
  });
});

describe("SmartBanner — label updates with dropdown", () => {
  it("updates the displayed label when a different intent is selected", () => {
    renderBanner({ intent: "FIGMA_JSON_NODE_BATCH" });

    expect(getDisplayLabelSpan()).toHaveTextContent("Figma-Node JSON");

    const select = screen.getByRole("combobox", {
      name: /erkannten typ korrigieren/i,
    });
    fireEvent.change(select, { target: { value: "FIGMA_JSON_DOC" } });

    expect(getDisplayLabelSpan()).toHaveTextContent("Figma-Dokument JSON");
  });

  it("label reverts visually if dropdown is changed back", () => {
    renderBanner({ intent: "FIGMA_JSON_NODE_BATCH" });

    const select = screen.getByRole("combobox", {
      name: /erkannten typ korrigieren/i,
    });
    fireEvent.change(select, { target: { value: "UNKNOWN" } });
    expect(getDisplayLabelSpan()).toHaveTextContent("Unbekannt");

    fireEvent.change(select, { target: { value: "FIGMA_JSON_NODE_BATCH" } });
    expect(getDisplayLabelSpan()).toHaveTextContent("Figma-Node JSON");
  });

  it("resyncs the displayed label when a new detected intent is pushed from the parent", () => {
    const { rerender } = render(
      <SmartBanner
        key="first"
        intent="RAW_CODE_OR_TEXT"
        confidence={1}
        onConfirm={vi.fn()}
        onDismiss={vi.fn()}
      />,
    );

    const select = screen.getByRole("combobox", {
      name: /erkannten typ korrigieren/i,
    });
    fireEvent.change(select, { target: { value: "UNKNOWN" } });
    expect(getDisplayLabelSpan()).toHaveTextContent("Unbekannt");

    rerender(
      <SmartBanner
        key="second"
        intent="FIGMA_JSON_DOC"
        confidence={0.9}
        onConfirm={vi.fn()}
        onDismiss={vi.fn()}
      />,
    );

    const refreshedSelect = screen.getByRole("combobox", {
      name: /erkannten typ korrigieren/i,
    });
    expect(getDisplayLabelSpan()).toHaveTextContent("Figma-Dokument JSON");
    expect(refreshedSelect).toHaveValue("FIGMA_JSON_DOC");
  });

  it("resets the dropdown when a new detection arrives with the same intent", () => {
    const { rerender } = render(
      <SmartBanner
        key="first-node-batch"
        intent="FIGMA_JSON_NODE_BATCH"
        confidence={0.8}
        onConfirm={vi.fn()}
        onDismiss={vi.fn()}
      />,
    );

    const select = screen.getByRole("combobox", {
      name: /erkannten typ korrigieren/i,
    });
    fireEvent.change(select, { target: { value: "UNKNOWN" } });
    expect(getDisplayLabelSpan()).toHaveTextContent("Unbekannt");

    rerender(
      <SmartBanner
        key="second-node-batch"
        intent="FIGMA_JSON_NODE_BATCH"
        confidence={0.95}
        onConfirm={vi.fn()}
        onDismiss={vi.fn()}
      />,
    );

    const refreshedSelect = screen.getByRole("combobox", {
      name: /erkannten typ korrigieren/i,
    });
    expect(getDisplayLabelSpan()).toHaveTextContent("Figma-Node JSON");
    expect(refreshedSelect).toHaveValue("FIGMA_JSON_NODE_BATCH");
  });
});

describe("SmartBanner — root element", () => {
  it("renders the smart-banner test id", () => {
    renderBanner();
    expect(screen.getByTestId("smart-banner")).toBeInTheDocument();
  });
});
