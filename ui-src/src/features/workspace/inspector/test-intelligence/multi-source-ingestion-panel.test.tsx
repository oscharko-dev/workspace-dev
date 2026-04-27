import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import { expectNoBlockingAccessibilityViolations } from "../../../../test/accessibility";
import { MultiSourceIngestionPanel } from "./multi-source-ingestion-panel";
import type { InspectorSourceRecord } from "./types";

const sources: InspectorSourceRecord[] = [
  {
    sourceId: "custom-context-1",
    kind: "custom_text",
    capturedAt: "2026-04-27T10:00:00.000Z",
    contentHash: "a".repeat(64),
    role: "supporting",
    label: "Custom context",
    inputFormat: "markdown",
  },
];

const primarySources: InspectorSourceRecord[] = [
  {
    sourceId: "jira-primary",
    kind: "jira_paste",
    capturedAt: "2026-04-27T10:00:00.000Z",
    contentHash: "c".repeat(64),
    role: "primary",
    label: "Jira paste PAY-1437",
  },
];

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  vi.unstubAllGlobals();
});

describe("MultiSourceIngestionPanel", () => {
  it("shows source-mix summary and the custom-only disabled diagnostic", () => {
    render(
      <MultiSourceIngestionPanel
        jobId="job-1"
        bearerToken=""
        sources={sources}
        sourceEnvelope={{
          aggregateContentHash: "hash-1",
          conflictResolutionPolicy: "reviewer_decides",
        }}
        onIngested={vi.fn().mockResolvedValue(undefined)}
      />,
    );
    expect(screen.getByTestId("ti-multisource-source-mix")).toHaveTextContent(
      "Source mix",
    );
    expect(screen.getByLabelText("Source mix mode")).toBeInTheDocument();
    expect(screen.getByLabelText("Filter source list by kind")).toBeInTheDocument();
    expect(screen.getByTestId("ti-multisource-selected-mix")).toHaveTextContent(
      "Jira paste only",
    );
    expect(screen.getByTestId("ti-multisource-custom-only-disabled")).toHaveTextContent(
      /Custom-only mixes are disabled/i,
    );
    expect(screen.getByText(/Jira REST gateway: not configured/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Attach custom context" })).toBeDisabled();
  });

  it("shows source-mix mode diagnostics for Jira API and primary plus custom", () => {
    render(
      <MultiSourceIngestionPanel
        jobId="job-1"
        bearerToken="token"
        sources={sources}
        sourceEnvelope={undefined}
        jiraGatewayConfigured={true}
        onIngested={vi.fn().mockResolvedValue(undefined)}
      />,
    );
    fireEvent.change(screen.getByLabelText("Source mix mode"), {
      target: { value: "jira_api_only" },
    });
    expect(screen.getByTestId("ti-multisource-selected-mix")).toHaveTextContent(
      /Jira REST is configured/i,
    );
    fireEvent.change(screen.getByLabelText("Source mix mode"), {
      target: { value: "primary_custom" },
    });
    expect(screen.getByTestId("ti-multisource-selected-mix")).toHaveTextContent(
      /custom-only is rejected/i,
    );
  });

  it("restores and autosaves the custom markdown draft locally", async () => {
    window.localStorage.setItem(
      "workspace-dev:ti-multisource-custom-markdown:v1:job-1",
      "# Stored draft",
    );
    render(
      <MultiSourceIngestionPanel
        jobId="job-1"
        bearerToken="token"
        sources={[]}
        sourceEnvelope={undefined}
        onIngested={vi.fn().mockResolvedValue(undefined)}
      />,
    );
    const textarea = screen.getByTestId(
      "ti-multisource-custom-markdown",
    ) as HTMLTextAreaElement;
    expect(textarea.value).toBe("# Stored draft");
    fireEvent.change(textarea, { target: { value: "### Changed draft" } });
    await waitFor(() => {
      expect(
        window.localStorage.getItem(
          "workspace-dev:ti-multisource-custom-markdown:v1:job-1",
        ),
      ).toBe("### Changed draft");
    });
  });

  it("submits Jira REST issue keys through the configured gateway route", async () => {
    const onIngested = vi.fn().mockResolvedValue(undefined);
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    render(
      <MultiSourceIngestionPanel
        jobId="job-1"
        bearerToken="token"
        sources={[]}
        sourceEnvelope={undefined}
        jiraGatewayConfigured={true}
        onIngested={onIngested}
      />,
    );
    fireEvent.change(screen.getByTestId("ti-multisource-jira-rest"), {
      target: { value: "PAY-1437, PAY-1438" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Fetch Jira REST" }));
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/workspace/test-intelligence/jobs/job-1/sources/jira-fetch",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ issueKeys: ["PAY-1437", "PAY-1438"] }),
        }),
      );
    });
    await waitFor(() => {
      expect(onIngested).toHaveBeenCalled();
    });
  });

  it("submits Jira REST JQL through the configured gateway route", async () => {
    const onIngested = vi.fn().mockResolvedValue(undefined);
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    render(
      <MultiSourceIngestionPanel
        jobId="job-1"
        bearerToken="token"
        sources={[]}
        sourceEnvelope={undefined}
        jiraGatewayConfigured={true}
        onIngested={onIngested}
      />,
    );
    fireEvent.change(screen.getByLabelText("Source mix mode"), {
      target: { value: "jira_api_only" },
    });
    fireEvent.change(screen.getByLabelText("Jira REST query mode"), {
      target: { value: "jql" },
    });
    fireEvent.change(screen.getByLabelText("Jira REST JQL"), {
      target: { value: "project = PAY ORDER BY updated DESC" },
    });
    fireEvent.change(screen.getByLabelText("Jira REST max results"), {
      target: { value: "7" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Run selected source mix" }),
    );
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/workspace/test-intelligence/jobs/job-1/sources/jira-fetch",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({
            jql: "project = PAY ORDER BY updated DESC",
            maxResults: 7,
          }),
        }),
      );
    });
    await waitFor(() => {
      expect(onIngested).toHaveBeenCalled();
    });
  });

  it("uploads Figma JSON and triggers the workspace submit path", async () => {
    const onIngested = vi.fn().mockResolvedValue(undefined);
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ jobId: "job-generated" }), {
        status: 202,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    render(
      <MultiSourceIngestionPanel
        jobId="job-1"
        bearerToken="token"
        sources={primarySources}
        sourceEnvelope={undefined}
        jiraGatewayConfigured={true}
        onIngested={onIngested}
      />,
    );

    const figmaFile = new File(
      ['{"document":{"id":"0:0","name":"Document"}}'],
      "figma-export.json",
      { type: "application/json" },
    );
    fireEvent.change(screen.getByLabelText("Upload Figma JSON file"), {
      target: { files: [figmaFile] },
    });

    await waitFor(() => {
      expect(screen.getByTestId("ti-multisource-figma-json")).toHaveValue(
        '{"document":{"id":"0:0","name":"Document"}}',
      );
    });

    fireEvent.click(
      screen.getByRole("button", { name: "Generate multi-source job" }),
    );

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/workspace/submit",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({
            figmaSourceMode: "figma_paste",
            figmaJsonPayload:
              '{"document":{"id":"0:0","name":"Document"}}',
            jobType: "figma_to_qc_test_cases",
            testIntelligenceMode: "dry_run",
            enableGitPr: false,
            llmCodegenMode: "deterministic",
          }),
        }),
      );
    });
    await waitFor(() => {
      expect(onIngested).toHaveBeenCalled();
    });
    expect(screen.getByTestId("ti-multisource-ingestion-status")).toHaveTextContent(
      /job-generated/,
    );
  });

  it("submits structured custom context attributes", async () => {
    const onIngested = vi.fn().mockResolvedValue(undefined);
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    render(
      <MultiSourceIngestionPanel
        jobId="job-1"
        bearerToken="token"
        sources={primarySources}
        sourceEnvelope={undefined}
        onIngested={onIngested}
      />,
    );
    fireEvent.change(screen.getByTestId("ti-multisource-structured-key"), {
      target: { value: "data_class" },
    });
    fireEvent.change(screen.getByTestId("ti-multisource-structured-value"), {
      target: { value: "PCI-DSS-3" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Attach structured context" }),
    );
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/workspace/test-intelligence/sources/job-1/custom-context",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({
            attributes: [{ key: "data_class", value: "PCI-DSS-3" }],
          }),
        }),
      );
    });
    await waitFor(() => {
      expect(onIngested).toHaveBeenCalled();
    });
  });

  it("shows server canonical markdown and redaction feedback after custom ingest", async () => {
    const onIngested = vi.fn().mockResolvedValue(undefined);
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
    render(
      <MultiSourceIngestionPanel
        jobId="job-1"
        bearerToken="token"
        sources={primarySources}
        sourceEnvelope={undefined}
        onIngested={onIngested}
      />,
    );
    fireEvent.change(screen.getByTestId("ti-multisource-custom-markdown"), {
      target: { value: "Contact jane.doe@example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Attach custom context" }));
    await waitFor(() => {
      expect(screen.getByTestId("ti-multisource-ingestion-status")).toHaveTextContent(
        /1 server redaction/i,
      );
    });
    expect(
      screen.getByTestId("ti-multisource-server-canonical-markdown"),
    ).toHaveTextContent("[REDACTED:EMAIL]");
  });

  it("uploads Jira ADF JSON and forces the adf_json format override", async () => {
    const onIngested = vi.fn().mockResolvedValue(undefined);
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    render(
      <MultiSourceIngestionPanel
        jobId="job-1"
        bearerToken="token"
        sources={primarySources}
        sourceEnvelope={undefined}
        onIngested={onIngested}
      />,
    );

    const adfFile = new File(
      ['{"type":"doc","version":1,"content":[{"type":"paragraph"}]}'],
      "jira-adf.json",
      { type: "application/json" },
    );
    fireEvent.change(screen.getByLabelText("Upload Jira ADF JSON file"), {
      target: { files: [adfFile] },
    });

    await waitFor(() => {
      expect(screen.getByLabelText("Jira paste format")).toHaveValue("adf_json");
      expect(screen.getByTestId("ti-multisource-jira-paste")).toHaveValue(
        '{"type":"doc","version":1,"content":[{"type":"paragraph"}]}',
      );
    });

    fireEvent.click(screen.getByRole("button", { name: "Attach Jira paste" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/workspace/test-intelligence/sources/job-1/jira-paste",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({
            format: "adf_json",
            body: '{"type":"doc","version":1,"content":[{"type":"paragraph"}]}',
          }),
        }),
      );
    });
    await waitFor(() => {
      expect(onIngested).toHaveBeenCalled();
    });
  });

  it("keeps custom context disabled until a primary source is attached", () => {
    render(
      <MultiSourceIngestionPanel
        jobId="job-1"
        bearerToken="token"
        sources={[]}
        sourceEnvelope={undefined}
        onIngested={vi.fn().mockResolvedValue(undefined)}
      />,
    );
    fireEvent.change(screen.getByTestId("ti-multisource-custom-markdown"), {
      target: { value: "# Supporting note" },
    });
    const button = screen.getByRole("button", {
      name: "Attach custom context",
    });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute(
      "title",
      "Attach a primary Figma or Jira source before custom context.",
    );
  });

  it("keeps custom context disabled when markdown fails sanitizer parity", () => {
    render(
      <MultiSourceIngestionPanel
        jobId="job-1"
        bearerToken="token"
        sources={primarySources}
        sourceEnvelope={undefined}
        onIngested={vi.fn().mockResolvedValue(undefined)}
      />,
    );
    fireEvent.change(screen.getByTestId("ti-multisource-custom-markdown"), {
      target: { value: "Internal URL http://169.254.169.254/latest" },
    });
    const button = screen.getByRole("button", {
      name: "Attach custom context",
    });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute(
      "title",
      "Markdown links and URLs must not target local or private hosts.",
    );
  });

  it("does not persist rejected raw markdown locally", async () => {
    render(
      <MultiSourceIngestionPanel
        jobId="job-1"
        bearerToken="token"
        sources={sources}
        sourceEnvelope={undefined}
        onIngested={vi.fn().mockResolvedValue(undefined)}
      />,
    );
    fireEvent.change(screen.getByTestId("ti-multisource-custom-markdown"), {
      target: { value: "<script>alert(1)</script>" },
    });
    await waitFor(() => {
      expect(
        window.localStorage.getItem(
          "workspace-dev:ti-multisource-custom-markdown:v1:job-1",
        ),
      ).toBeNull();
    });
  });

  it("has no blocking a11y violations", async () => {
    const { container } = render(
      <MultiSourceIngestionPanel
        jobId="job-1"
        bearerToken="token"
        sources={sources}
        sourceEnvelope={{
          aggregateContentHash: "hash-1",
          conflictResolutionPolicy: "reviewer_decides",
        }}
        onIngested={vi.fn().mockResolvedValue(undefined)}
      />,
    );
    await expectNoBlockingAccessibilityViolations(container);
  });
});
