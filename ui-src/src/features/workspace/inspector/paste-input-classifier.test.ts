import { describe, expect, it, vi } from "vitest";
import {
  classifyPasteInput,
  classifyPasteIntent,
  isSecureContextAvailable,
} from "./paste-input-classifier";

vi.mock("./figma-clipboard-parser", () => ({
  isFigmaClipboard: (html: string) => html.includes("FIGMA_MARKER"),
}));

describe("classifyPasteInput — empty / whitespace", () => {
  it("empty string → unknown / empty", () => {
    const result = classifyPasteInput("");
    expect(result.kind).toBe("unknown");
    expect(result.rawText).toBe("");
    expect(result.reason).toBe("empty");
    expect(result.parsedJson).toBeUndefined();
  });

  it("whitespace-only → unknown / empty", () => {
    const result = classifyPasteInput("   \n\t  ");
    expect(result.kind).toBe("unknown");
    expect(result.rawText).toBe("");
    expect(result.reason).toBe("empty");
  });
});

describe("classifyPasteInput — non-JSON text", () => {
  it("plain text 'hello' → unknown / not_json", () => {
    const result = classifyPasteInput("hello");
    expect(result.kind).toBe("unknown");
    expect(result.reason).toBe("not_json");
    expect(result.rawText).toBe("hello");
  });
});

describe("classifyPasteInput — malformed JSON", () => {
  it("'{foo' → unknown / malformed_json", () => {
    const result = classifyPasteInput("{foo");
    expect(result.kind).toBe("unknown");
    expect(result.reason).toBe("malformed_json");
    expect(result.rawText).toBe("{foo");
    expect(result.parsedJson).toBeUndefined();
  });
});

describe("classifyPasteInput — valid JSON without document field", () => {
  it("fallback lenient → direct_json", () => {
    const result = classifyPasteInput('{"schemaVersion":"v1"}');
    expect(result.kind).toBe("direct_json");
    expect(result.parsedJson).toEqual({ schemaVersion: "v1" });
    expect(result.reason).toBeUndefined();
  });
});

describe("classifyPasteInput — direct_json detection", () => {
  it("object with document field → direct_json", () => {
    const payload = JSON.stringify({ document: { id: "0:0", children: [] } });
    const result = classifyPasteInput(payload);
    expect(result.kind).toBe("direct_json");
    expect(result.parsedJson).toEqual({
      document: { id: "0:0", children: [] },
    });
  });
});

describe("classifyPasteInput — plugin_payload_json detection", () => {
  it("figmaSourceMode field → plugin_payload_json", () => {
    const result = classifyPasteInput(
      '{"figmaSourceMode":"figma_paste","data":{}}',
    );
    expect(result.kind).toBe("plugin_payload_json");
  });

  it("type === PLUGIN_EXPORT → plugin_payload_json", () => {
    const result = classifyPasteInput('{"type":"PLUGIN_EXPORT","nodes":[]}');
    expect(result.kind).toBe("plugin_payload_json");
  });

  it("plugin field → plugin_payload_json", () => {
    const result = classifyPasteInput('{"plugin":"my-plugin","version":1}');
    expect(result.kind).toBe("plugin_payload_json");
  });
});

describe("classifyPasteInput — plugin_envelope detection", () => {
  it("valid envelope kind → plugin_envelope", () => {
    const payload = JSON.stringify({
      kind: "workspace-dev/figma-selection@1",
      pluginVersion: "0.1.0",
      copiedAt: "2026-04-12T18:00:00.000Z",
      selections: [
        {
          document: { id: "1:2", type: "FRAME", name: "Card" },
          components: {},
          componentSets: {},
          styles: {},
        },
      ],
    });
    const result = classifyPasteInput(payload);
    expect(result.kind).toBe("plugin_envelope");
    expect(result.parsedJson).toBeDefined();
  });

  it("unknown envelope kind → plugin_envelope", () => {
    const payload = JSON.stringify({
      kind: "workspace-dev/figma-selection@99",
      selections: [],
    });
    const result = classifyPasteInput(payload);
    expect(result.kind).toBe("plugin_envelope");
  });

  it("envelope takes priority over document field detection", () => {
    const payload = JSON.stringify({
      kind: "workspace-dev/figma-selection@1",
      document: { id: "0:0" },
      selections: [],
    });
    const result = classifyPasteInput(payload);
    expect(result.kind).toBe("plugin_envelope");
  });
});

describe("classifyPasteInput — array at top level", () => {
  it("array → direct_json (lenient fallback)", () => {
    const result = classifyPasteInput('[{"id":1},{"id":2}]');
    expect(result.kind).toBe("direct_json");
    expect(Array.isArray(result.parsedJson)).toBe(true);
  });
});

describe("isSecureContextAvailable", () => {
  it("returns a boolean", () => {
    const result = isSecureContextAvailable();
    expect(typeof result).toBe("boolean");
  });
});

describe("classifyPasteIntent — empty / whitespace", () => {
  it("empty string → UNKNOWN confidence 1.0", () => {
    const result = classifyPasteIntent("");
    expect(result.intent).toBe("UNKNOWN");
    expect(result.confidence).toBe(1.0);
    expect(result.suggestedJobSource).toBe("manual_text");
    expect(result.rawText).toBe("");
    expect(result.parsedJson).toBeUndefined();
  });

  it("whitespace-only → UNKNOWN confidence 1.0", () => {
    const result = classifyPasteIntent("   \n\t  ");
    expect(result.intent).toBe("UNKNOWN");
    expect(result.confidence).toBe(1.0);
    expect(result.rawText).toBe("");
  });
});

describe("classifyPasteIntent — Figma clipboard HTML", () => {
  it("clipboardHtml with figma marker → FIGMA_JSON_NODE_BATCH confidence 0.95 figma_paste", () => {
    const result = classifyPasteIntent("{}", "FIGMA_MARKER");
    expect(result.intent).toBe("FIGMA_JSON_NODE_BATCH");
    expect(result.confidence).toBe(0.95);
    expect(result.suggestedJobSource).toBe("figma_paste");
  });

  it("non-figma clipboardHtml → falls through to JSON classification", () => {
    const payload = JSON.stringify({ document: { id: "0:0" } });
    const result = classifyPasteIntent(payload, "not-figma-html");
    expect(result.intent).toBe("FIGMA_JSON_DOC");
  });
});

describe("classifyPasteIntent — non-JSON text", () => {
  it("plain text → RAW_CODE_OR_TEXT confidence 1.0 manual_text", () => {
    const result = classifyPasteIntent("hello world");
    expect(result.intent).toBe("RAW_CODE_OR_TEXT");
    expect(result.confidence).toBe(1.0);
    expect(result.suggestedJobSource).toBe("manual_text");
    expect(result.rawText).toBe("hello world");
  });
});

describe("classifyPasteIntent — malformed JSON", () => {
  it("'{foo' → RAW_CODE_OR_TEXT confidence 0.6 reason malformed_json", () => {
    const result = classifyPasteIntent("{foo");
    expect(result.intent).toBe("RAW_CODE_OR_TEXT");
    expect(result.confidence).toBe(0.6);
    expect(result.suggestedJobSource).toBe("manual_text");
    expect(result.reason).toBe("malformed_json");
    expect(result.parsedJson).toBeUndefined();
  });
});

describe("classifyPasteIntent — FIGMA_JSON_DOC", () => {
  it("object with document key → FIGMA_JSON_DOC confidence 0.9 figma_paste", () => {
    const payload = JSON.stringify({ document: { id: "0:0", children: [] } });
    const result = classifyPasteIntent(payload);
    expect(result.intent).toBe("FIGMA_JSON_DOC");
    expect(result.confidence).toBe(0.9);
    expect(result.suggestedJobSource).toBe("figma_paste");
    expect(result.parsedJson).toEqual({
      document: { id: "0:0", children: [] },
    });
  });
});

describe("classifyPasteIntent — FIGMA_JSON_NODE_BATCH plugin signals", () => {
  it("type === PLUGIN_EXPORT → FIGMA_JSON_NODE_BATCH confidence 0.85 figma_paste", () => {
    const result = classifyPasteIntent('{"type":"PLUGIN_EXPORT","nodes":[]}');
    expect(result.intent).toBe("FIGMA_JSON_NODE_BATCH");
    expect(result.confidence).toBe(0.85);
    expect(result.suggestedJobSource).toBe("figma_paste");
  });

  it("figmaSourceMode field → FIGMA_JSON_NODE_BATCH confidence 0.85 figma_paste", () => {
    const result = classifyPasteIntent(
      '{"figmaSourceMode":"figma_paste","data":{}}',
    );
    expect(result.intent).toBe("FIGMA_JSON_NODE_BATCH");
    expect(result.confidence).toBe(0.85);
    expect(result.suggestedJobSource).toBe("figma_paste");
  });

  it("plugin field → FIGMA_JSON_NODE_BATCH confidence 0.85 figma_paste", () => {
    const result = classifyPasteIntent('{"plugin":"my-plugin","version":1}');
    expect(result.intent).toBe("FIGMA_JSON_NODE_BATCH");
    expect(result.confidence).toBe(0.85);
    expect(result.suggestedJobSource).toBe("figma_paste");
  });
});

describe("classifyPasteIntent — FIGMA_JSON_NODE_BATCH node object", () => {
  it("object with type and children → FIGMA_JSON_NODE_BATCH confidence 0.8 figma_paste", () => {
    const payload = JSON.stringify({
      type: "FRAME",
      children: [{ type: "TEXT", name: "Label" }],
    });
    const result = classifyPasteIntent(payload);
    expect(result.intent).toBe("FIGMA_JSON_NODE_BATCH");
    expect(result.confidence).toBe(0.8);
    expect(result.suggestedJobSource).toBe("figma_paste");
  });
});

describe("classifyPasteIntent — FIGMA_JSON_NODE_BATCH array of nodes", () => {
  it("array of objects with type and name → FIGMA_JSON_NODE_BATCH confidence 0.8 figma_paste", () => {
    const payload = JSON.stringify([
      { type: "FRAME", name: "Card" },
      { type: "TEXT", name: "Label" },
    ]);
    const result = classifyPasteIntent(payload);
    expect(result.intent).toBe("FIGMA_JSON_NODE_BATCH");
    expect(result.confidence).toBe(0.8);
    expect(result.suggestedJobSource).toBe("figma_paste");
  });

  it("array of objects without type/name → RAW_CODE_OR_TEXT confidence 0.7", () => {
    const result = classifyPasteIntent('[{"id":1},{"id":2}]');
    expect(result.intent).toBe("RAW_CODE_OR_TEXT");
    expect(result.confidence).toBe(0.7);
    expect(result.suggestedJobSource).toBe("manual_text");
  });
});

describe("classifyPasteIntent — FIGMA_PLUGIN_ENVELOPE", () => {
  it("valid envelope kind → FIGMA_PLUGIN_ENVELOPE confidence 0.95 figma_plugin", () => {
    const payload = JSON.stringify({
      kind: "workspace-dev/figma-selection@1",
      pluginVersion: "0.1.0",
      copiedAt: "2026-04-12T18:00:00.000Z",
      selections: [
        {
          document: { id: "1:2", type: "FRAME", name: "Card" },
          components: {},
          componentSets: {},
          styles: {},
        },
      ],
    });
    const result = classifyPasteIntent(payload);
    expect(result.intent).toBe("FIGMA_PLUGIN_ENVELOPE");
    expect(result.confidence).toBe(0.95);
    expect(result.suggestedJobSource).toBe("figma_plugin");
  });

  it("envelope detection takes priority over document detection", () => {
    const payload = JSON.stringify({
      kind: "workspace-dev/figma-selection@1",
      document: { id: "0:0", children: [] },
      selections: [],
    });
    const result = classifyPasteIntent(payload);
    expect(result.intent).toBe("FIGMA_PLUGIN_ENVELOPE");
  });

  it("unknown envelope kind still routes to FIGMA_PLUGIN_ENVELOPE", () => {
    const payload = JSON.stringify({
      kind: "workspace-dev/figma-selection@99",
      document: { id: "0:0", children: [] },
    });
    const result = classifyPasteIntent(payload);
    expect(result.intent).toBe("FIGMA_PLUGIN_ENVELOPE");
    expect(result.confidence).toBe(0.85);
  });
});

describe("classifyPasteIntent — RAW_CODE_OR_TEXT valid non-Figma JSON", () => {
  it("valid JSON object with no Figma fields → RAW_CODE_OR_TEXT confidence 0.7 manual_text", () => {
    const result = classifyPasteIntent('{"schemaVersion":"v1"}');
    expect(result.intent).toBe("RAW_CODE_OR_TEXT");
    expect(result.confidence).toBe(0.7);
    expect(result.suggestedJobSource).toBe("manual_text");
    expect(result.parsedJson).toEqual({ schemaVersion: "v1" });
  });
});
