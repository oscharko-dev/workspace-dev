import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import { expectNoBlockingAccessibilityViolations } from "../../../../test/accessibility";
import { CustomerMarkdownDownload } from "./customer-markdown-download";

afterEach(() => {
  cleanup();
});

describe("CustomerMarkdownDownload", () => {
  it("renders an anchor pointing at the export route for the job", () => {
    render(<CustomerMarkdownDownload jobId="job-123" />);
    const link = screen.getByTestId(
      "ti-customer-markdown-download",
    ) as HTMLAnchorElement;
    expect(link.getAttribute("href")).toBe(
      "/workspace/test-intelligence/jobs/job-123/customer-markdown",
    );
  });

  it("URL-encodes a job id with reserved characters", () => {
    render(<CustomerMarkdownDownload jobId="job a/b" />);
    const link = screen.getByTestId(
      "ti-customer-markdown-download",
    ) as HTMLAnchorElement;
    expect(link.getAttribute("href")).toBe(
      "/workspace/test-intelligence/jobs/job%20a%2Fb/customer-markdown",
    );
  });

  it("derives a sanitised download filename from the job id", () => {
    render(<CustomerMarkdownDownload jobId="job/with*bad:chars" />);
    const link = screen.getByTestId(
      "ti-customer-markdown-download",
    ) as HTMLAnchorElement;
    expect(link.getAttribute("download")).toBe(
      "job-with-bad-chars-testfaelle.md",
    );
  });

  it("exposes an aria-label that names the job", () => {
    render(<CustomerMarkdownDownload jobId="job-456" />);
    const link = screen.getByTestId("ti-customer-markdown-download");
    expect(link.getAttribute("aria-label")).toContain("job-456");
  });

  it("passes axe accessibility audit", async () => {
    const { container } = render(<CustomerMarkdownDownload jobId="job-789" />);
    await expectNoBlockingAccessibilityViolations(container);
  });
});
