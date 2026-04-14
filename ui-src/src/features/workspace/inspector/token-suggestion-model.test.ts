/**
 * Unit tests for the token suggestion model derivation.
 *
 * @see https://github.com/oscharko-dev/workspace-dev/issues/993
 */

import { describe, expect, it } from "vitest";
import {
  deriveTokenSuggestionModel,
  resolveTokenDecisions,
} from "./token-suggestion-model";

describe("deriveTokenSuggestionModel", () => {
  it("returns an unavailable model when intelligence is missing", () => {
    const model = deriveTokenSuggestionModel({});
    expect(model.available).toBe(false);
    expect(model.disabled).toBe(false);
    expect(model.suggestions).toHaveLength(0);
  });

  it("marks the model disabled when policy disables token suggestions", () => {
    const model = deriveTokenSuggestionModel({
      intelligence: {
        conflicts: [
          {
            name: "color/primary",
            figmaValue: "#3B82F6",
            existingValue: "#2563EB",
            resolution: "figma",
          },
        ],
      },
      policy: { disabled: true },
    });
    expect(model.disabled).toBe(true);
    expect(model.suggestions).toHaveLength(0);
  });

  it("recommends accept when the conflict is tight and resolution favours figma", () => {
    const model = deriveTokenSuggestionModel({
      intelligence: {
        conflicts: [
          {
            name: "color/primary",
            figmaValue: "#2563EB",
            existingValue: "#2563EB",
            resolution: "figma",
          },
        ],
      },
      policy: { autoAcceptConfidence: 90, maxConflictDelta: 20 },
    });

    expect(model.suggestions).toHaveLength(1);
    const first = model.suggestions[0]!;
    expect(first.recommendation).toBe("accept");
    expect(first.autoAccepted).toBe(true);
    expect(first.kind).toBe("conflict");
  });

  it("flags conflicts with large deltas as needs-review", () => {
    const model = deriveTokenSuggestionModel({
      intelligence: {
        conflicts: [
          {
            name: "color/primary",
            figmaValue: "#FF0000",
            existingValue: "#00FF00",
            resolution: "figma",
          },
        ],
      },
      policy: { maxConflictDelta: 5 },
    });
    expect(model.suggestions[0]!.recommendation).toBe("review");
    expect(model.summary.needsReview).toBe(1);
  });

  it("surfaces unmapped Figma variables as review items", () => {
    const model = deriveTokenSuggestionModel({
      intelligence: {
        unmappedVariables: ["spacing/huge", "elevation/overlay"],
      },
    });
    expect(model.available).toBe(true);
    expect(model.summary.unmapped).toBe(2);
    expect(
      model.suggestions.every((entry) => entry.recommendation === "review"),
    ).toBe(true);
  });

  it("preserves CSS preview + library keys for downstream panels", () => {
    const model = deriveTokenSuggestionModel({
      intelligence: {
        cssCustomProperties: ":root { --color-primary: #3B82F6; }",
        libraryKeys: ["lib-123"],
        unmappedVariables: [],
      },
    });
    expect(model.cssPreview).toContain("--color-primary");
    expect(model.libraryKeys).toEqual(["lib-123"]);
  });
});

describe("resolveTokenDecisions", () => {
  it("partitions suggestions into accepted and rejected token names", () => {
    const model = deriveTokenSuggestionModel({
      intelligence: {
        conflicts: [
          {
            name: "color/primary",
            figmaValue: "#3B82F6",
            existingValue: "#2563EB",
            resolution: "figma",
          },
        ],
        unmappedVariables: ["spacing/xl"],
      },
    });

    const decisions = resolveTokenDecisions(
      model,
      new Set(
        model.suggestions.filter((s) => s.kind === "conflict").map((s) => s.id),
      ),
    );

    expect(decisions.acceptedTokenNames).toEqual(["color/primary"]);
    expect(decisions.rejectedTokenNames).toEqual(["spacing/xl"]);
    expect(decisions.entries).toHaveLength(2);
  });
});
