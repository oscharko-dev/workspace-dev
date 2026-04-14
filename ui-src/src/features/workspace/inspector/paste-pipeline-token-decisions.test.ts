/**
 * Tests for the client helper that POSTs token-mapping decisions.
 *
 * @see https://github.com/oscharko-dev/workspace-dev/issues/993
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { postTokenDecisions } from "./paste-pipeline";

type FetchMock = ReturnType<typeof vi.fn>;

describe("postTokenDecisions", () => {
  let originalFetch: typeof fetch;
  let fetchMock: FetchMock;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("posts accepted + rejected token lists and normalizes the response", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          jobId: "job-7",
          updatedAt: "2026-04-14T18:00:00Z",
          acceptedTokenNames: ["color/primary"],
          rejectedTokenNames: ["spacing/xl"],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );

    const result = await postTokenDecisions({
      jobId: "job-7",
      acceptedTokenNames: ["color/primary"],
      rejectedTokenNames: ["spacing/xl"],
    });

    expect(result.updatedAt).toBe("2026-04-14T18:00:00Z");
    expect(result.acceptedTokenNames).toEqual(["color/primary"]);
    expect(result.rejectedTokenNames).toEqual(["spacing/xl"]);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/workspace/jobs/job-7/token-decisions");
    expect(init.method).toBe("POST");
    const body = JSON.parse(init.body as string) as {
      acceptedTokenNames: string[];
      rejectedTokenNames: string[];
    };
    expect(body).toEqual({
      acceptedTokenNames: ["color/primary"],
      rejectedTokenNames: ["spacing/xl"],
    });
  });

  it("throws when the server responds with a non-2xx status", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ error: "VALIDATION_ERROR", message: "bad input" }),
        { status: 400, headers: { "content-type": "application/json" } },
      ),
    );

    await expect(
      postTokenDecisions({
        jobId: "job-8",
        acceptedTokenNames: [],
        rejectedTokenNames: [],
      }),
    ).rejects.toThrow(/Failed to persist token decisions/);
  });

  it("coerces missing updatedAt / list fields to safe defaults", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ jobId: "job-9" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    const result = await postTokenDecisions({
      jobId: "job-9",
      acceptedTokenNames: [],
      rejectedTokenNames: [],
    });

    expect(result.updatedAt).toBeNull();
    expect(result.acceptedTokenNames).toEqual([]);
    expect(result.rejectedTokenNames).toEqual([]);
  });
});
