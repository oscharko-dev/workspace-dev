/**
 * Tests for pure helper functions extracted from plugin/ui.html (lines ~261–293).
 *
 * Functions are defined inline here so there is no import dependency on the
 * HTML file. If the originals change, these definitions must stay in sync.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

// ---------------------------------------------------------------------------
// Inline copies of the helpers under test (from plugin/ui.html ~261-287)
// ---------------------------------------------------------------------------

function normalizeWorkspaceDevUrl(rawUrl: unknown): string {
  const trimmed = String(rawUrl ?? "").trim();
  if (!trimmed) {
    return "";
  }
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return "";
    }
    parsed.search = "";
    parsed.hash = "";
    parsed.pathname = parsed.pathname.replace(/\/+$/, "");
    return parsed.toString().replace(/\/$/, "");
  } catch {
    return "";
  }
}

function buildTrackingUrl(endpointUrl: unknown, jobId: unknown): string {
  const normalizedEndpoint = normalizeWorkspaceDevUrl(endpointUrl);
  const safeJobId = String(jobId ?? "").trim();
  if (!normalizedEndpoint || !safeJobId) {
    return "";
  }
  return `${normalizedEndpoint}/workspace/jobs/${encodeURIComponent(safeJobId)}`;
}

// ---------------------------------------------------------------------------
// normalizeWorkspaceDevUrl
// ---------------------------------------------------------------------------

describe("normalizeWorkspaceDevUrl", () => {
  it("returns empty string for empty input", () => {
    assert.equal(normalizeWorkspaceDevUrl(""), "");
  });

  it("returns empty string for null", () => {
    assert.equal(normalizeWorkspaceDevUrl(null), "");
  });

  it("returns empty string for undefined", () => {
    assert.equal(normalizeWorkspaceDevUrl(undefined), "");
  });

  it("returns empty string for a non-URL string", () => {
    assert.equal(normalizeWorkspaceDevUrl("not-a-url"), "");
  });

  it("returns empty string for ftp:// protocol", () => {
    assert.equal(normalizeWorkspaceDevUrl("ftp://example.com"), "");
  });

  it("returns the URL unchanged for a clean http localhost URL", () => {
    assert.equal(
      normalizeWorkspaceDevUrl("http://127.0.0.1:1983"),
      "http://127.0.0.1:1983",
    );
  });

  it("strips a trailing slash", () => {
    assert.equal(
      normalizeWorkspaceDevUrl("http://127.0.0.1:1983/"),
      "http://127.0.0.1:1983",
    );
  });

  it("strips query string and hash but keeps path, with no trailing slash", () => {
    assert.equal(
      normalizeWorkspaceDevUrl("http://127.0.0.1:1983/extra?q=1#hash"),
      "http://127.0.0.1:1983/extra",
    );
  });

  it("accepts https:// URLs", () => {
    assert.equal(
      normalizeWorkspaceDevUrl("https://myserver.example.com"),
      "https://myserver.example.com",
    );
  });

  it("trims surrounding whitespace before parsing", () => {
    assert.equal(
      normalizeWorkspaceDevUrl("  http://127.0.0.1:1983  "),
      "http://127.0.0.1:1983",
    );
  });
});

// ---------------------------------------------------------------------------
// buildTrackingUrl
// ---------------------------------------------------------------------------

describe("buildTrackingUrl", () => {
  it("builds the expected URL for a simple job ID", () => {
    assert.equal(
      buildTrackingUrl("http://127.0.0.1:1983", "job-123"),
      "http://127.0.0.1:1983/workspace/jobs/job-123",
    );
  });

  it("percent-encodes job IDs that contain slashes", () => {
    const result = buildTrackingUrl(
      "http://127.0.0.1:1983",
      "job/with/slashes",
    );
    assert.equal(
      result,
      `http://127.0.0.1:1983/workspace/jobs/${encodeURIComponent("job/with/slashes")}`,
    );
    assert.ok(result.includes("%2F"), "slashes must be percent-encoded");
  });

  it("returns empty string when endpointUrl is empty", () => {
    assert.equal(buildTrackingUrl("", "job-123"), "");
  });

  it("returns empty string when jobId is empty", () => {
    assert.equal(buildTrackingUrl("http://127.0.0.1:1983", ""), "");
  });

  it("returns empty string when jobId is null", () => {
    assert.equal(buildTrackingUrl("http://127.0.0.1:1983", null), "");
  });

  it("normalizes the endpoint URL before building the tracking URL", () => {
    assert.equal(
      buildTrackingUrl("http://127.0.0.1:1983/", "job-abc"),
      "http://127.0.0.1:1983/workspace/jobs/job-abc",
    );
  });

  it("returns empty string when endpoint is an invalid URL", () => {
    assert.equal(buildTrackingUrl("not-a-url", "job-123"), "");
  });
});
