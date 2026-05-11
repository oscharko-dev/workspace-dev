import assert from "node:assert/strict";
import test from "node:test";
import {
  SchemaValidationError,
  isDesignIRShape,
  isFigmaFileResponseShape,
  validatedJsonParse
} from "./pipeline-schemas.js";

test("isDesignIRShape accepts a valid minimal DesignIR", () => {
  assert.equal(
    isDesignIRShape({ sourceName: "test", screens: [], tokens: {} }),
    true
  );
});

test("isDesignIRShape rejects null", () => {
  assert.equal(isDesignIRShape(null), false);
});

test("isDesignIRShape rejects arrays", () => {
  assert.equal(isDesignIRShape([]), false);
});

test("isDesignIRShape rejects missing sourceName", () => {
  assert.equal(isDesignIRShape({ screens: [], tokens: {} }), false);
});

test("isDesignIRShape rejects non-string sourceName", () => {
  assert.equal(isDesignIRShape({ sourceName: 42, screens: [], tokens: {} }), false);
});

test("isDesignIRShape rejects missing screens", () => {
  assert.equal(isDesignIRShape({ sourceName: "test", tokens: {} }), false);
});

test("isDesignIRShape rejects non-array screens", () => {
  assert.equal(isDesignIRShape({ sourceName: "test", screens: "nope", tokens: {} }), false);
});

test("isDesignIRShape rejects missing tokens", () => {
  assert.equal(isDesignIRShape({ sourceName: "test", screens: [] }), false);
});

test("isDesignIRShape rejects non-object tokens", () => {
  assert.equal(isDesignIRShape({ sourceName: "test", screens: [], tokens: null }), false);
});

test("isDesignIRShape ignores extra fields (forward-compatible)", () => {
  assert.equal(
    isDesignIRShape({ sourceName: "test", screens: [], tokens: {}, extra: true }),
    true
  );
});

test("isFigmaFileResponseShape accepts valid object with all fields", () => {
  assert.equal(
    isFigmaFileResponseShape({
      name: "file",
      lastModified: "2024-01-01",
      document: {},
      styles: {},
      components: {},
      componentSets: {}
    }),
    true
  );
});

test("isFigmaFileResponseShape accepts empty object (all fields optional)", () => {
  assert.equal(isFigmaFileResponseShape({}), true);
});

test("isFigmaFileResponseShape rejects non-string name", () => {
  assert.equal(isFigmaFileResponseShape({ name: 42 }), false);
});

test("isFigmaFileResponseShape rejects non-string lastModified", () => {
  assert.equal(isFigmaFileResponseShape({ lastModified: 42 }), false);
});

test("isFigmaFileResponseShape rejects array styles", () => {
  assert.equal(isFigmaFileResponseShape({ styles: [] }), false);
});

test("isFigmaFileResponseShape rejects array components", () => {
  assert.equal(isFigmaFileResponseShape({ components: [] }), false);
});

test("isFigmaFileResponseShape rejects array componentSets", () => {
  assert.equal(isFigmaFileResponseShape({ componentSets: [] }), false);
});

test("isFigmaFileResponseShape rejects null", () => {
  assert.equal(isFigmaFileResponseShape(null), false);
});

test("isFigmaFileResponseShape rejects arrays", () => {
  assert.equal(isFigmaFileResponseShape([]), false);
});

test("validatedJsonParse returns parsed value for valid JSON and matching guard", () => {
  const guard = (v: unknown): v is { ok: boolean } =>
    typeof v === "object" && v !== null && "ok" in v && typeof (v as Record<string, unknown>).ok === "boolean";
  const result = validatedJsonParse({
    raw: '{"ok": true}',
    guard,
    schema: "TestSchema"
  });
  assert.deepEqual(result, { ok: true });
});

test("validatedJsonParse throws SchemaValidationError for invalid JSON", () => {
  const guard = (v: unknown): v is unknown => true;
  assert.throws(
    () =>
      validatedJsonParse({
        raw: "not-json",
        guard,
        schema: "TestSchema"
      }),
    (error: unknown) => {
      assert.ok(error instanceof SchemaValidationError);
      assert.ok(error.message.includes("not valid JSON"));
      return true;
    }
  );
});

test("validatedJsonParse throws SchemaValidationError when guard fails", () => {
  const guard = (_v: unknown): _v is never => false;
  assert.throws(
    () =>
      validatedJsonParse({
        raw: "{}",
        guard,
        schema: "TestSchema"
      }),
    (error: unknown) => {
      assert.ok(error instanceof SchemaValidationError);
      assert.ok(error.message.includes("does not match"));
      return true;
    }
  );
});

test("validatedJsonParse error message includes filePath when provided", () => {
  const guard = (_v: unknown): _v is never => false;
  assert.throws(
    () =>
      validatedJsonParse({
        raw: "{}",
        guard,
        schema: "TestSchema",
        filePath: "/some/path.json"
      }),
    (error: unknown) => {
      assert.ok(error instanceof SchemaValidationError);
      assert.ok(error.message.includes("/some/path.json"));
      return true;
    }
  );
});

test("validatedJsonParse error message works without filePath", () => {
  const guard = (_v: unknown): _v is never => false;
  assert.throws(
    () =>
      validatedJsonParse({
        raw: "{}",
        guard,
        schema: "TestSchema"
      }),
    (error: unknown) => {
      assert.ok(error instanceof SchemaValidationError);
      assert.ok(!error.message.includes("from '"));
      return true;
    }
  );
});

test("SchemaValidationError has correct name, schema, and filePath properties", () => {
  const error = new SchemaValidationError({
    schema: "SomeSchema",
    filePath: "/a/b.json",
    message: "test error"
  });
  assert.equal(error.name, "SchemaValidationError");
  assert.equal(error.schema, "SomeSchema");
  assert.equal(error.filePath, "/a/b.json");
  assert.equal(error.message, "test error");
});

test("SchemaValidationError filePath is undefined when not provided", () => {
  const error = new SchemaValidationError({
    schema: "SomeSchema",
    message: "test error"
  });
  assert.equal(error.filePath, undefined);
});
