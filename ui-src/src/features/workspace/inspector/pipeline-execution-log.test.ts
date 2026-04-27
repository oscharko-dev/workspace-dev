import { describe, expect, it } from "vitest";
import {
  createPipelineExecutionLog,
  redactSensitiveData,
  type PipelineLogEntry,
} from "./pipeline-execution-log";

describe("createPipelineExecutionLog", () => {
  it("starts with empty entries", () => {
    const log = createPipelineExecutionLog();
    expect(log.entries).toHaveLength(0);
  });

  it("records entries in order", () => {
    const log = createPipelineExecutionLog();
    log.addEntry({
      timestamp: "2026-04-14T10:00:00.000Z",
      stage: "parsing",
      success: true,
    });
    log.addEntry({
      timestamp: "2026-04-14T10:00:01.000Z",
      stage: "resolving",
      success: false,
      errorCode: "MCP_UNAVAILABLE",
    });
    expect(log.entries).toHaveLength(2);
    expect(log.entries[0]?.stage).toBe("parsing");
    expect(log.entries[1]?.errorCode).toBe("MCP_UNAVAILABLE");
  });

  it("clears all entries", () => {
    const log = createPipelineExecutionLog();
    log.addEntry({
      timestamp: "2026-04-14T10:00:00.000Z",
      stage: "parsing",
      success: true,
    });
    log.clear();
    expect(log.entries).toHaveLength(0);
  });

  it("exports valid JSON", () => {
    const log = createPipelineExecutionLog();
    log.addEntry({
      timestamp: "2026-04-14T10:00:00.000Z",
      stage: "resolving",
      success: true,
      durationMs: 250,
    });
    const json = log.exportJson();
    const parsed = JSON.parse(json) as Record<string, unknown>;
    expect(typeof parsed.exportedAt).toBe("string");
    expect(parsed.entryCount).toBe(1);
    expect(Array.isArray(parsed.entries)).toBe(true);
  });

  it("redacts Figma access tokens from exported JSON", () => {
    const log = createPipelineExecutionLog();
    log.addEntry({
      timestamp: "2026-04-14T10:00:00.000Z",
      stage: "resolving",
      success: false,
      errorCode: "AUTH_REQUIRED",
      errorMessage: "Token figd_AbCdEfGhIjKlMnOpQrStUvWxYz01234 was rejected", // pragma: allowlist secret
    });
    const json = log.exportJson();
    expect(json).not.toContain("figd_AbCdEfGhIjKlMnOpQrStUvWxYz01234"); // pragma: allowlist secret
    expect(json).toContain("[REDACTED]");
  });

  it("redacts figmaAccessToken JSON fields", () => {
    const log = createPipelineExecutionLog();
    // Simulate a log entry whose message contains a raw JSON field
    log.addEntry({
      timestamp: "2026-04-14T10:00:00.000Z",
      stage: "resolving",
      success: false,
      errorMessage: '{"figmaAccessToken": "secret_token_value_here_12345678"}',
    });
    const json = log.exportJson();
    expect(json).not.toContain("secret_token_value_here_12345678");
  });

  it("entries array is read-only (cannot be mutated externally)", () => {
    const log = createPipelineExecutionLog();
    const entries = log.entries;
    expect(() => {
      (entries as PipelineLogEntry[]).push({
        timestamp: "",
        stage: "test",
        success: true,
      });
    }).toThrow();
  });
});

describe("entries cache invalidation", () => {
  it("returns the same reference when no entries have been added", () => {
    const log = createPipelineExecutionLog();
    const a = log.entries;
    const b = log.entries;
    expect(a).toBe(b);
  });

  it("returns a new reference after addEntry invalidates the cache", () => {
    const log = createPipelineExecutionLog();
    const before = log.entries;
    log.addEntry({
      timestamp: "2026-04-14T10:00:00.000Z",
      stage: "parsing",
      success: true,
    });
    const after = log.entries;
    expect(after).not.toBe(before);
    expect(after).toHaveLength(1);
  });

  it("returns a new reference after clear() invalidates the cache", () => {
    const log = createPipelineExecutionLog();
    log.addEntry({
      timestamp: "2026-04-14T10:00:00.000Z",
      stage: "parsing",
      success: true,
    });
    const before = log.entries;
    log.clear();
    const after = log.entries;
    expect(after).not.toBe(before);
    expect(after).toHaveLength(0);
  });
});

describe("redactSensitiveData — improved patterns", () => {
  it("redacts figd_ tokens with exactly 8 characters after the prefix (boundary, included)", () => {
    const input = "figd_AbCdEf12";
    const result = redactSensitiveData(input);
    expect(result).toContain("[REDACTED]");
    expect(result).not.toContain("figd_AbCdEf12");
  });

  it("does NOT redact figd_ tokens shorter than 8 characters after the prefix (boundary, excluded)", () => {
    const input = "figd_AbCdEf1"; // 7 chars after prefix
    const result = redactSensitiveData(input);
    expect(result).not.toContain("[REDACTED]");
    expect(result).toBe(input);
  });

  it("redacts Bearer authorization tokens", () => {
    const input = "Authorization: Bearer eyJhbGciOiJSUzI1NiJ9";
    const result = redactSensitiveData(input);
    expect(result).toContain("[REDACTED]");
    expect(result).not.toContain("eyJhbGciOiJSUzI1NiJ9");
  });

  it("redacts x-figma-token header values", () => {
    const input = "x-figma-token: mytoken123456";
    const result = redactSensitiveData(input);
    expect(result).toContain("[REDACTED]");
    expect(result).not.toContain("mytoken123456");
  });

  it("redacts figmaAccessToken JSON keys case-insensitively", () => {
    const input = '{"FigmaAccessToken": "secretval123"}';
    const result = redactSensitiveData(input);
    expect(result).toContain("[REDACTED]");
    expect(result).not.toContain("secretval123");
  });
});
