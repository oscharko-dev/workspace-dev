import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";

import {
  JiraWritePanel,
  JIRA_WRITE_CONFIG_STORAGE_KEY,
} from "./jira-write-panel";
import { validateOutputPathFormat } from "./output-path-validation";
import * as api from "./api";

const successResult = {
  ok: true,
  refused: false,
  totalCases: 3,
  createdCount: 0,
  skippedDuplicateCount: 0,
  failedCount: 0,
  dryRun: true,
  dryRunCount: 3,
  markdownOutputPath: "/tmp/jira-write-out",
} as const;

beforeEach(() => {
  window.localStorage.clear();
  vi.spyOn(api, "getJiraWriteConfig").mockResolvedValue({
    ok: true,
    value: {},
  });
  vi.spyOn(api, "saveJiraWriteConfig").mockResolvedValue({
    ok: true,
    value: { ok: true },
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("JiraWritePanel", () => {
  it("renders mode selector and parent issue key input", () => {
    render(<JiraWritePanel jobId="job-1" bearerToken="token" />);
    expect(screen.getByTestId("ti-jira-write-mode-read")).toBeChecked();
    expect(
      screen.getByTestId("ti-jira-write-mode-dry-run"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("ti-jira-write-mode-write")).toBeInTheDocument();
    expect(screen.getByTestId("ti-jira-write-parent-key")).toBeInTheDocument();
  });

  it("disables run when parentIssueKey is empty", () => {
    render(<JiraWritePanel jobId="job-1" bearerToken="token" />);
    fireEvent.click(screen.getByTestId("ti-jira-write-mode-dry-run"));
    expect(screen.getByTestId("ti-jira-write-run")).toBeDisabled();
    expect(
      screen.getByTestId("ti-jira-write-parent-key-error"),
    ).toHaveTextContent(/Parent issue key is required/i);
  });

  it("disables run when parentIssueKey format is invalid and shows validation message", () => {
    render(<JiraWritePanel jobId="job-1" bearerToken="token" />);
    fireEvent.click(screen.getByTestId("ti-jira-write-mode-dry-run"));
    fireEvent.change(screen.getByTestId("ti-jira-write-parent-key"), {
      target: { value: "not-a-key" },
    });
    expect(screen.getByTestId("ti-jira-write-run")).toBeDisabled();
    expect(
      screen.getByTestId("ti-jira-write-parent-key-error"),
    ).toHaveTextContent(/canonical Jira key shape/i);
  });

  it("enables run when dry-run mode and parentIssueKey are valid", () => {
    render(<JiraWritePanel jobId="job-1" bearerToken="token" />);
    fireEvent.click(screen.getByTestId("ti-jira-write-mode-dry-run"));
    fireEvent.change(screen.getByTestId("ti-jira-write-parent-key"), {
      target: { value: "PROJ-123" },
    });
    expect(screen.getByTestId("ti-jira-write-run")).not.toBeDisabled();
  });

  it("misconfigured path shows validation error and prevents run", () => {
    render(<JiraWritePanel jobId="job-1" bearerToken="token" />);
    fireEvent.click(screen.getByTestId("ti-jira-write-mode-dry-run"));
    fireEvent.change(screen.getByTestId("ti-jira-write-parent-key"), {
      target: { value: "PROJ-123" },
    });
    fireEvent.click(screen.getByTestId("ti-jira-write-use-default-path"));
    expect(
      screen.getByTestId("ti-jira-write-output-path-error"),
    ).toHaveTextContent(/Provide a markdown output directory/i);
    expect(screen.getByTestId("ti-jira-write-run")).toBeDisabled();
  });

  it("defaults to read-only mode", () => {
    render(<JiraWritePanel jobId="job-1" bearerToken="token" />);
    expect(screen.getByTestId("ti-jira-write-mode-read")).toBeChecked();
    fireEvent.change(screen.getByTestId("ti-jira-write-parent-key"), {
      target: { value: "PROJ-123" },
    });
    expect(screen.getByTestId("ti-jira-write-run")).toBeDisabled();
  });

  it("successful dry-run shows result summary and dry-run count", async () => {
    vi.spyOn(api, "startJiraWrite").mockResolvedValue({
      ok: true,
      value: { ...successResult },
    });
    render(<JiraWritePanel jobId="job-1" bearerToken="token" />);
    fireEvent.click(screen.getByTestId("ti-jira-write-mode-dry-run"));
    fireEvent.change(screen.getByTestId("ti-jira-write-parent-key"), {
      target: { value: "PROJ-123" },
    });
    fireEvent.click(screen.getByTestId("ti-jira-write-run"));
    await waitFor(() => {
      expect(screen.getByTestId("ti-jira-write-status")).toHaveTextContent(
        /Dry-run completed for 3 case/i,
      );
    });
    expect(
      screen.getByTestId("ti-jira-write-result-summary"),
    ).toHaveTextContent(/Total cases/i);
    expect(
      screen.getByTestId("ti-jira-write-output-path-result"),
    ).toHaveTextContent("/tmp/jira-write-out");
  });

  it("write-mode config persists to localStorage", async () => {
    render(<JiraWritePanel jobId="job-1" bearerToken="token" />);
    fireEvent.click(screen.getByTestId("ti-jira-write-mode-dry-run"));
    fireEvent.change(screen.getByTestId("ti-jira-write-parent-key"), {
      target: { value: "PROJ-123" },
    });
    fireEvent.click(screen.getByTestId("ti-jira-write-save-config"));
    await waitFor(() => {
      expect(api.saveJiraWriteConfig).toHaveBeenCalled();
    });
    const stored = window.localStorage.getItem(JIRA_WRITE_CONFIG_STORAGE_KEY);
    expect(stored).not.toBeNull();
    const parsed = JSON.parse(stored ?? "{}") as Record<string, unknown>;
    expect(parsed["writeMode"]).toBe("dry-run");
    expect(parsed["parentIssueKey"]).toBe("PROJ-123");
  });

  it("sends trimmed custom output path on config save and run", async () => {
    vi.spyOn(api, "startJiraWrite").mockResolvedValue({
      ok: true,
      value: { ...successResult },
    });
    render(<JiraWritePanel jobId="job-1" bearerToken="token" />);
    fireEvent.click(screen.getByTestId("ti-jira-write-mode-dry-run"));
    fireEvent.change(screen.getByTestId("ti-jira-write-parent-key"), {
      target: { value: "PROJ-123" },
    });
    fireEvent.click(screen.getByTestId("ti-jira-write-use-default-path"));
    fireEvent.change(screen.getByTestId("ti-jira-write-output-path"), {
      target: { value: "  /tmp/jira-write-out  " },
    });

    fireEvent.click(screen.getByTestId("ti-jira-write-save-config"));
    await waitFor(() => {
      expect(api.saveJiraWriteConfig).toHaveBeenCalledWith(
        {
          outputPathMarkdown: "/tmp/jira-write-out",
          useDefaultOutputPath: false,
        },
        "token",
      );
    });

    fireEvent.click(screen.getByTestId("ti-jira-write-run"));
    await waitFor(() => {
      expect(api.startJiraWrite).toHaveBeenCalledWith(
        {
          jobId: "job-1",
          parentIssueKey: "PROJ-123",
          dryRun: true,
          outputPathMarkdown: "/tmp/jira-write-out",
          useDefaultOutputPath: false,
        },
        "token",
      );
    });
  });

  it("sends dryRun false only from explicit write mode", async () => {
    vi.spyOn(api, "startJiraWrite").mockResolvedValue({
      ok: true,
      value: { ...successResult, dryRun: false, dryRunCount: 0 },
    });
    render(<JiraWritePanel jobId="job-1" bearerToken="token" />);
    fireEvent.click(screen.getByTestId("ti-jira-write-mode-write"));
    fireEvent.change(screen.getByTestId("ti-jira-write-parent-key"), {
      target: { value: "PROJ-123" },
    });

    fireEvent.click(screen.getByTestId("ti-jira-write-run"));
    await waitFor(() => {
      expect(api.startJiraWrite).toHaveBeenCalledWith(
        expect.objectContaining({
          jobId: "job-1",
          parentIssueKey: "PROJ-123",
          dryRun: false,
          useDefaultOutputPath: true,
        }),
        "token",
      );
    });
  });

  it("restores persisted config across remount", async () => {
    render(<JiraWritePanel jobId="job-1" bearerToken="token" />);
    fireEvent.click(screen.getByTestId("ti-jira-write-mode-dry-run"));
    fireEvent.click(screen.getByTestId("ti-jira-write-use-default-path"));
    fireEvent.change(screen.getByTestId("ti-jira-write-output-path"), {
      target: { value: "/tmp/jira-write-out" },
    });

    await waitFor(() => {
      const stored = JSON.parse(
        window.localStorage.getItem(JIRA_WRITE_CONFIG_STORAGE_KEY) ?? "{}",
      ) as Record<string, unknown>;
      expect(stored["writeMode"]).toBe("dry-run");
      expect(stored["useDefaultOutputPath"]).toBe(false);
      expect(stored["outputPathMarkdown"]).toBe("/tmp/jira-write-out");
    });

    cleanup();

    render(<JiraWritePanel jobId="job-1" bearerToken="token" />);
    await waitFor(() => {
      expect(screen.getByTestId("ti-jira-write-mode-dry-run")).toBeChecked();
      expect(
        screen.getByTestId("ti-jira-write-use-default-path"),
      ).not.toBeChecked();
      expect(screen.getByTestId("ti-jira-write-output-path")).toHaveValue(
        "/tmp/jira-write-out",
      );
    });
  });

  it("migrates legacy writeEnabled plus dryRun storage to explicit mode", async () => {
    window.localStorage.setItem(
      JIRA_WRITE_CONFIG_STORAGE_KEY,
      JSON.stringify({
        writeEnabled: true,
        parentIssueKey: "PROJ-123",
        dryRun: false,
        outputPathMarkdown: "/tmp/jira-write-out",
        useDefaultOutputPath: false,
      }),
    );

    render(<JiraWritePanel jobId="job-1" bearerToken="token" />);
    await waitFor(() => {
      expect(screen.getByTestId("ti-jira-write-mode-write")).toBeChecked();
      expect(screen.getByTestId("ti-jira-write-parent-key")).toHaveValue(
        "PROJ-123",
      );
      expect(
        screen.getByTestId("ti-jira-write-use-default-path"),
      ).not.toBeChecked();
    });
  });

  it("refused response surfaces refusal codes", async () => {
    vi.spyOn(api, "startJiraWrite").mockResolvedValue({
      ok: true,
      value: {
        ok: false,
        refused: true,
        refusalCodes: ["no_approved_test_cases"],
        totalCases: 0,
        createdCount: 0,
        skippedDuplicateCount: 0,
        failedCount: 0,
        dryRun: true,
        dryRunCount: 0,
      },
    });
    render(<JiraWritePanel jobId="job-1" bearerToken="token" />);
    fireEvent.click(screen.getByTestId("ti-jira-write-mode-dry-run"));
    fireEvent.change(screen.getByTestId("ti-jira-write-parent-key"), {
      target: { value: "PROJ-123" },
    });
    fireEvent.click(screen.getByTestId("ti-jira-write-run"));
    await waitFor(() => {
      expect(
        screen.getByTestId("ti-jira-write-refusal-code-no_approved_test_cases"),
      ).toBeInTheDocument();
    });
    expect(screen.getByTestId("ti-jira-write-status")).toHaveTextContent(
      /no_approved_test_cases/,
    );
  });

  it("path with traversal segment shows error and blocks run", () => {
    render(<JiraWritePanel jobId="job-1" bearerToken="token" />);
    fireEvent.click(screen.getByTestId("ti-jira-write-mode-dry-run"));
    fireEvent.change(screen.getByTestId("ti-jira-write-parent-key"), {
      target: { value: "PROJ-123" },
    });
    fireEvent.click(screen.getByTestId("ti-jira-write-use-default-path"));
    fireEvent.change(screen.getByTestId("ti-jira-write-output-path"), {
      target: { value: "/safe/../etc/passwd" },
    });
    expect(
      screen.getByTestId("ti-jira-write-output-path-error"),
    ).toHaveTextContent(/path segments/i);
    expect(screen.getByTestId("ti-jira-write-run")).toBeDisabled();
  });

  it("path with null byte shows error and blocks run", () => {
    render(<JiraWritePanel jobId="job-1" bearerToken="token" />);
    fireEvent.click(screen.getByTestId("ti-jira-write-mode-dry-run"));
    fireEvent.change(screen.getByTestId("ti-jira-write-parent-key"), {
      target: { value: "PROJ-456" },
    });
    fireEvent.click(screen.getByTestId("ti-jira-write-use-default-path"));
    fireEvent.change(screen.getByTestId("ti-jira-write-output-path"), {
      target: { value: "/tmp/jira\0write" },
    });
    expect(
      screen.getByTestId("ti-jira-write-output-path-error"),
    ).toHaveTextContent(/null bytes/i);
    expect(screen.getByTestId("ti-jira-write-run")).toBeDisabled();
  });
});

describe("validateOutputPathFormat", () => {
  it("accepts a clean absolute path", () => {
    expect(validateOutputPathFormat("/tmp/jira-write-out")).toEqual({
      ok: true,
    });
  });

  it("rejects path with double-dot traversal", () => {
    const result = validateOutputPathFormat("/tmp/../etc/passwd");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toMatch(/path segments/i);
    }
  });

  it("rejects relative paths", () => {
    const result = validateOutputPathFormat("jira-write-out");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toMatch(/absolute/i);
    }
  });

  it("rejects path with embedded null byte", () => {
    const result = validateOutputPathFormat("/tmp/jira\0out");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toMatch(/null bytes/i);
    }
  });

  it("accepts a path whose directory segment contains 'dots' but no traversal", () => {
    expect(validateOutputPathFormat("/tmp/jira..write.out")).toEqual({
      ok: true,
    });
  });
});
