import { afterEach, describe, expect, it, vi } from "vitest";

import {
  deleteInspectorSource,
  postCustomContextSource,
  postJiraFetchSource,
} from "./api";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("test-intelligence API client", () => {
  it("sends JSON write headers for source removal", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await deleteInspectorSource({
      jobId: "job-1",
      sourceId: "jira-rest-source",
      bearerToken: "review-token",
    });

    expect(result.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      "/workspace/test-intelligence/jobs/job-1/sources/jira-rest-source",
      expect.objectContaining({
        method: "DELETE",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer review-token",
        },
        body: "{}",
      }),
    );
  });

  it("posts Jira REST JQL requests without issue keys", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await postJiraFetchSource({
      jobId: "job-1",
      bearerToken: "review-token",
      query: { kind: "jql", jql: "project = PAY", maxResults: 5 },
    });

    expect(result.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      "/workspace/test-intelligence/jobs/job-1/sources/jira-fetch",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ jql: "project = PAY", maxResults: 5 }),
      }),
    );
  });

  it("preserves server canonical markdown feedback from custom context ingest", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: true,
          customContext: [
            {
              noteEntries: [
                {
                  bodyMarkdown: "[REDACTED:EMAIL]\n",
                  redactions: [{ id: "redaction-1" }],
                },
              ],
            },
          ],
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await postCustomContextSource({
      jobId: "job-1",
      bearerToken: "review-token",
      markdown: "Contact jane.doe@example.com",
    });

    expect(result.ok).toBe(true);
    expect(result.ok && result.value.canonicalMarkdown).toBe(
      "[REDACTED:EMAIL]\n",
    );
    expect(result.ok && result.value.redactionCount).toBe(1);
  });
});
