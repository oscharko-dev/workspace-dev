import assert from "node:assert/strict";
import test from "node:test";

import fc from "fast-check";

import { classifyUnresolvedValidationDetail } from "./unresolved-validation-rules.js";

test("property: unresolved-topic label-only sentences never classify as concrete numeric or message data", async () => {
  await fc.assert(
    fc.asyncProperty(
      fc.constantFrom(
        "Netto",
        "Brutto",
        "MwSt.",
        "VAT",
        "amount field",
        "field label",
      ),
      fc.constantFrom(
        "sichtbar",
        "angezeigt",
        "vorhanden",
        "auswählbar",
        "visible",
        "displayed",
      ),
      async (topic, visibility) => {
        const sentence = `Es ist noch zu klären, wie ${topic} ${visibility} ist.`;
        const detail = classifyUnresolvedValidationDetail(sentence);
        assert.notEqual(detail.classification, "concrete_numeric_data");
        assert.notEqual(detail.classification, "concrete_message_text");
      },
    ),
  );
});
