import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";

import { expectNoBlockingAccessibilityViolations } from "../../../../test/accessibility";
import { FigmaUrlTab } from "./figma-url-tab";

interface FetchInit {
  method?: string;
  body?: BodyInit | null;
  headers?: HeadersInit;
}

const mockFetch = vi.fn();

beforeEach(() => {
  mockFetch.mockReset();
  vi.stubGlobal("fetch", mockFetch);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const respondJson = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

describe("FigmaUrlTab", () => {
  it("parses a valid URL and renders the file key + node id", () => {
    render(<FigmaUrlTab onSubmitted={vi.fn()} />);
    const input = screen.getByTestId("ti-figma-url-input");
    fireEvent.change(input, {
      target: {
        value:
          "https://www.figma.com/design/M7FGS79qLfr3O4OXEYbxy0/Test?node-id=0-1",
      },
    });
    const info = screen.getByTestId("ti-figma-url-parsed-info");
    expect(info.textContent).toContain("M7FGS79qLfr3O4OXEYbxy0");
    expect(info.textContent).toContain("0:1");
    const inlineError = screen.getByTestId("ti-figma-url-inline-error");
    expect(inlineError.textContent).toBe("");
  });

  it("shows an aria-live inline error for an invalid URL", () => {
    render(<FigmaUrlTab onSubmitted={vi.fn()} />);
    const input = screen.getByTestId("ti-figma-url-input");
    fireEvent.change(input, {
      target: { value: "https://evil.example.com/design/abc/X" },
    });
    const error = screen.getByTestId("ti-figma-url-inline-error");
    expect(error.textContent).toContain("figma.com");
    expect(error.getAttribute("aria-live")).toBe("polite");
    expect(input.getAttribute("aria-invalid")).toBe("true");
  });

  it("disables the submit button until the URL parses", () => {
    render(<FigmaUrlTab onSubmitted={vi.fn()} />);
    const submit = screen.getByTestId(
      "ti-figma-url-submit",
    ) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    fireEvent.change(screen.getByTestId("ti-figma-url-input"), {
      target: { value: "https://www.figma.com/design/abc/X" },
    });
    expect(submit.disabled).toBe(false);
  });

  it("posts to /workspace/submit with figmaSourceMode=figma_url + parsed payload", async () => {
    mockFetch.mockResolvedValueOnce(respondJson(202, { jobId: "job-123" }));
    const onSubmitted = vi.fn().mockResolvedValue(undefined);
    render(<FigmaUrlTab onSubmitted={onSubmitted} />);
    fireEvent.change(screen.getByTestId("ti-figma-url-input"), {
      target: {
        value:
          "https://www.figma.com/design/M7FGS79qLfr3O4OXEYbxy0/Test?node-id=0-1",
      },
    });
    fireEvent.click(screen.getByTestId("ti-figma-url-submit"));
    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
    const [url, init] = mockFetch.mock.calls[0] as [string, FetchInit];
    expect(url).toBe("/workspace/submit");
    expect(init.method).toBe("POST");
    const body = JSON.parse(String(init.body));
    expect(body.figmaSourceMode).toBe("figma_url");
    expect(body.jobType).toBe("figma_to_qc_test_cases");
    const innerPayload = JSON.parse(String(body.figmaJsonPayload));
    expect(innerPayload).toEqual({
      figmaFileKey: "M7FGS79qLfr3O4OXEYbxy0",
      nodeId: "0:1",
    });
    await waitFor(() => {
      expect(onSubmitted).toHaveBeenCalledWith("job-123");
    });
    expect(
      screen.getByTestId("ti-figma-url-submit-status").textContent,
    ).toContain("job-123");
  });

  it("surfaces a server-side rejection through the assertive status region", async () => {
    mockFetch.mockResolvedValueOnce(
      respondJson(400, {
        error: "MISSING_FIGMA_ACCESS_TOKEN",
        message: "FIGMA_ACCESS_TOKEN is not configured.",
      }),
    );
    render(<FigmaUrlTab onSubmitted={vi.fn()} />);
    fireEvent.change(screen.getByTestId("ti-figma-url-input"), {
      target: { value: "https://www.figma.com/design/abc/X" },
    });
    fireEvent.click(screen.getByTestId("ti-figma-url-submit"));
    await waitFor(() => {
      const status = screen.getByTestId("ti-figma-url-submit-status");
      expect(status.textContent).toContain("FIGMA_ACCESS_TOKEN");
      expect(status.getAttribute("aria-live")).toBe("assertive");
      expect(status.getAttribute("role")).toBe("alert");
    });
  });

  it("omits nodeId from the payload when the URL has no node-id", async () => {
    mockFetch.mockResolvedValueOnce(respondJson(202, { jobId: "job-456" }));
    render(<FigmaUrlTab onSubmitted={vi.fn().mockResolvedValue(undefined)} />);
    fireEvent.change(screen.getByTestId("ti-figma-url-input"), {
      target: { value: "https://www.figma.com/design/abc/Title" },
    });
    fireEvent.click(screen.getByTestId("ti-figma-url-submit"));
    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
    const [, init] = mockFetch.mock.calls[0] as [string, FetchInit];
    const body = JSON.parse(String(init.body));
    const innerPayload = JSON.parse(String(body.figmaJsonPayload));
    expect(innerPayload).toEqual({ figmaFileKey: "abc" });
  });

  it("passes axe accessibility audit for the populated tab", async () => {
    const { container } = render(<FigmaUrlTab onSubmitted={vi.fn()} />);
    fireEvent.change(screen.getByTestId("ti-figma-url-input"), {
      target: { value: "https://www.figma.com/design/abc/X?node-id=0-1" },
    });
    await expectNoBlockingAccessibilityViolations(container);
  });
});
