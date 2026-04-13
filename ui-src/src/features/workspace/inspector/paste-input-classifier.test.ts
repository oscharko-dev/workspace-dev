import { describe, expect, it } from "vitest";
import {
  classifyPasteInput,
  isSecureContextAvailable,
} from "./paste-input-classifier";

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
