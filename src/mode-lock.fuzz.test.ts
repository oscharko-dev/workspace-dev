import assert from "node:assert/strict";
import test from "node:test";
import fc from "fast-check";
import { getAllowedFigmaSourceModes, getAllowedLlmCodegenModes, validateModeLock } from "./mode-lock.js";

const normalize = (value: string | undefined): string | undefined => {
  if (value === undefined) {
    return undefined;
  }
  const normalized = value.trim().toLowerCase();
  return normalized.length > 0 ? normalized : undefined;
};

const isAllowedFigmaSourceMode = (value: string | undefined): boolean => {
  const normalized = normalize(value);
  return normalized === undefined || getAllowedFigmaSourceModes().includes(normalized);
};

const isAllowedLlmCodegenMode = (value: string | undefined): boolean => {
  const normalized = normalize(value);
  return normalized === undefined || getAllowedLlmCodegenModes().includes(normalized);
};

test("fuzz: validateModeLock validity matches mode constraints", () => {
  fc.assert(
    fc.property(
      fc.option(fc.string({ maxLength: 24 }), { nil: undefined }),
      fc.option(fc.string({ maxLength: 24 }), { nil: undefined }),
      (figmaSourceMode, llmCodegenMode) => {
        const result = validateModeLock({ figmaSourceMode, llmCodegenMode });
        const expectedValid =
          isAllowedFigmaSourceMode(figmaSourceMode) &&
          isAllowedLlmCodegenMode(llmCodegenMode);

        assert.equal(
          result.valid,
          expectedValid,
          `Expected valid=${expectedValid} for figmaSourceMode=${String(figmaSourceMode)} llmCodegenMode=${String(llmCodegenMode)}`
        );

        if (expectedValid) {
          assert.equal(result.errors.length, 0);
        } else {
          assert.ok(result.errors.length >= 1);
        }
      }
    ),
    { numRuns: 200 }
  );
});
