import { describe, expect, it } from "vitest";
import {
  createPipelineExecutionLog,
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
      errorMessage: "Token figd_AbCdEfGhIjKlMnOpQrStUvWxYz01234 was rejected",
    });
    const json = log.exportJson();
    expect(json).not.toContain("figd_AbCdEfGhIjKlMnOpQrStUvWxYz01234");
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
