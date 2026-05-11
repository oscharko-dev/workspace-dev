/**
 * Tests for the right-pane SuggestionsPanel (Issue #993).
 *
 * @see https://github.com/oscharko-dev/workspace-dev/issues/993
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SuggestionsPanel } from "./SuggestionsPanel";
import { deriveQualityScore } from "./import-quality-score";
import { deriveTokenSuggestionModel } from "./token-suggestion-model";
import { deriveA11yNudges } from "./a11y-nudge";

function buildModels(): {
  qualityScore: ReturnType<typeof deriveQualityScore>;
  tokenModel: ReturnType<typeof deriveTokenSuggestionModel>;
  a11yResult: ReturnType<typeof deriveA11yNudges>;
} {
  const qualityScore = deriveQualityScore({
    screens: [
      {
        id: "s1",
        name: "Home",
        children: [
          {
            id: "n1",
            name: "CTA",
            type: "Rectangle",
            onClick: () => undefined,
          },
        ],
      },
    ],
  });
  const tokenModel = deriveTokenSuggestionModel({
    intelligence: {
      conflicts: [
        {
          name: "color/primary",
          figmaValue: "#3B82F6",
          existingValue: "#2563EB",
          resolution: "figma",
        },
      ],
      unmappedVariables: ["spacing/huge"],
    },
  });
  const a11yResult = deriveA11yNudges({
    files: [{ path: "src/screens/Home.tsx", contents: `<img src="x" />` }],
  });
  return { qualityScore, tokenModel, a11yResult };
}

describe("SuggestionsPanel", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders the quality score band, breakdown, and risk list", () => {
    const models = buildModels();
    render(
      <SuggestionsPanel
        qualityScore={models.qualityScore}
        tokenModel={models.tokenModel}
        a11yResult={models.a11yResult}
      />,
    );

    expect(screen.getByTestId("suggestions-quality-score")).toBeInTheDocument();
    expect(screen.getByTestId("suggestions-quality-band")).toHaveTextContent(
      /\d+/,
    );
    expect(screen.getByTestId("suggestions-quality-summary")).toHaveTextContent(
      /nodes/,
    );
    expect(screen.getByTestId("suggestions-risk-list")).toBeInTheDocument();
  });

  it("invokes onApplyTokenDecisions with accepted + rejected token names", () => {
    const models = buildModels();
    const onApply = vi.fn();
    render(
      <SuggestionsPanel
        qualityScore={models.qualityScore}
        tokenModel={models.tokenModel}
        a11yResult={models.a11yResult}
        onApplyTokenDecisions={onApply}
      />,
    );

    fireEvent.click(screen.getByTestId("suggestions-token-accept-all"));
    fireEvent.click(screen.getByTestId("suggestions-token-apply"));

    expect(onApply).toHaveBeenCalledTimes(1);
    const payload = onApply.mock.calls[0]?.[0] as {
      acceptedTokenNames: string[];
      rejectedTokenNames: string[];
    };
    expect(payload.acceptedTokenNames).toEqual(
      expect.arrayContaining(["color/primary", "spacing/huge"]),
    );
    expect(payload.rejectedTokenNames).toEqual([]);
  });

  it("rejects all when the reject-all button is clicked", () => {
    const models = buildModels();
    const onApply = vi.fn();
    render(
      <SuggestionsPanel
        qualityScore={models.qualityScore}
        tokenModel={models.tokenModel}
        a11yResult={models.a11yResult}
        onApplyTokenDecisions={onApply}
      />,
    );

    fireEvent.click(screen.getByTestId("suggestions-token-reject-all"));
    fireEvent.click(screen.getByTestId("suggestions-token-apply"));

    const payload = onApply.mock.calls[0]?.[0] as {
      acceptedTokenNames: string[];
      rejectedTokenNames: string[];
    };
    expect(payload.acceptedTokenNames).toEqual([]);
    expect(payload.rejectedTokenNames).toEqual(
      expect.arrayContaining(["color/primary", "spacing/huge"]),
    );
  });

  it("surfaces post-generation nudges with a file-focus callback", () => {
    const models = buildModels();
    const onFocusFile = vi.fn();
    render(
      <SuggestionsPanel
        qualityScore={models.qualityScore}
        tokenModel={models.tokenModel}
        a11yResult={models.a11yResult}
        onFocusFile={onFocusFile}
      />,
    );

    expect(screen.getByTestId("suggestions-a11y-section")).toBeInTheDocument();
    const focusButton = screen.getByTestId(
      "suggestions-a11y-focus-img-missing-alt",
    );
    fireEvent.click(focusButton);
    expect(onFocusFile).toHaveBeenCalledWith(
      "src/screens/Home.tsx",
      expect.any(Number),
    );
  });

  it("renders nothing when there is no data to surface", () => {
    const empty = deriveQualityScore({ screens: [] });
    const emptyTokens = deriveTokenSuggestionModel({});
    const emptyA11y = deriveA11yNudges({ files: [] });

    // Empty IR still produces an empty-ir risk, which the panel surfaces.
    // When there is nothing to show (no nodes + no risks), the panel hides.
    const quietQuality = {
      ...empty,
      risks: [],
      summary: { ...empty.summary, totalNodes: 0 },
    };

    const { container } = render(
      <SuggestionsPanel
        qualityScore={quietQuality}
        tokenModel={emptyTokens}
        a11yResult={emptyA11y}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
