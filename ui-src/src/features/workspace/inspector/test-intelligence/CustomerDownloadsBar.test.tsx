import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import { expectNoBlockingAccessibilityViolations } from "../../../../test/accessibility";
import { CustomerDownloadsBar } from "./CustomerDownloadsBar";

afterEach(() => {
  cleanup();
});

describe("CustomerDownloadsBar", () => {
  it("renders both Markdown and ZIP buttons side-by-side", () => {
    render(<CustomerDownloadsBar jobId="job-123" />);
    const md = screen.getByTestId("ti-customer-downloads-bar-markdown");
    const zip = screen.getByTestId("ti-customer-downloads-bar-zip");
    expect(md).toBeInstanceOf(HTMLAnchorElement);
    expect(zip).toBeInstanceOf(HTMLAnchorElement);
  });

  it("Markdown button targets the customer-markdown route", () => {
    render(<CustomerDownloadsBar jobId="job-123" />);
    const md = screen.getByTestId(
      "ti-customer-downloads-bar-markdown",
    ) as HTMLAnchorElement;
    expect(md.getAttribute("href")).toBe(
      "/workspace/test-intelligence/jobs/job-123/customer-markdown",
    );
    expect(md.getAttribute("download")).toBe("job-123-testfaelle.md");
  });

  it("ZIP button targets the customer-markdown.zip route", () => {
    render(<CustomerDownloadsBar jobId="job-123" />);
    const zip = screen.getByTestId(
      "ti-customer-downloads-bar-zip",
    ) as HTMLAnchorElement;
    expect(zip.getAttribute("href")).toBe(
      "/workspace/test-intelligence/jobs/job-123/customer-markdown.zip",
    );
    expect(zip.getAttribute("download")).toBe("job-123-customer-bundle.zip");
  });

  it("URL-encodes a job id with reserved characters", () => {
    render(<CustomerDownloadsBar jobId="job/abc?x" />);
    const zip = screen.getByTestId(
      "ti-customer-downloads-bar-zip",
    ) as HTMLAnchorElement;
    expect(zip.getAttribute("href")).toBe(
      "/workspace/test-intelligence/jobs/job%2Fabc%3Fx/customer-markdown.zip",
    );
    expect(zip.getAttribute("download")).toBe("job-abc-x-customer-bundle.zip");
  });

  it("both buttons have explicit aria-labels mentioning the job id", () => {
    render(<CustomerDownloadsBar jobId="job-123" />);
    const md = screen.getByTestId("ti-customer-downloads-bar-markdown");
    const zip = screen.getByTestId("ti-customer-downloads-bar-zip");
    expect(md.getAttribute("aria-label")).toContain("job-123");
    expect(md.getAttribute("aria-label")).toContain("Markdown");
    expect(zip.getAttribute("aria-label")).toContain("job-123");
    expect(zip.getAttribute("aria-label")).toContain("ZIP");
  });

  it("provides screen-reader descriptions for both buttons", () => {
    render(<CustomerDownloadsBar jobId="job-1" />);
    const md = screen.getByTestId("ti-customer-downloads-bar-markdown");
    const zip = screen.getByTestId("ti-customer-downloads-bar-zip");
    const mdDescId = md.getAttribute("aria-describedby");
    const zipDescId = zip.getAttribute("aria-describedby");
    expect(mdDescId).not.toBeNull();
    expect(zipDescId).not.toBeNull();
    if (mdDescId !== null) {
      expect(document.getElementById(mdDescId)?.textContent).toContain(
        "Single file",
      );
    }
    if (zipDescId !== null) {
      expect(document.getElementById(zipDescId)?.textContent).toContain(
        "ZIP bundle",
      );
    }
  });

  it("passes axe accessibility audit", async () => {
    const { container } = render(<CustomerDownloadsBar jobId="job-1" />);
    await expectNoBlockingAccessibilityViolations(container);
  });
});
