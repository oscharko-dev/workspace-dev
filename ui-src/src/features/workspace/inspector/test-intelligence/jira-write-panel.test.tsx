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
  it("renders write mode toggle and parent issue key input", () => {
    render(<JiraWritePanel jobId="job-1" bearerToken="token" />);
    expect(screen.getByTestId("ti-jira-write-enabled")).toBeInTheDocument();
    expect(screen.getByTestId("ti-jira-write-parent-key")).toBeInTheDocument();
  });

  it("disables run when parentIssueKey is empty", () => {
    render(<JiraWritePanel jobId="job-1" bearerToken="token" />);
    fireEvent.click(screen.getByTestId("ti-jira-write-enabled"));
    expect(screen.getByTestId("ti-jira-write-run")).toBeDisabled();
    expect(
      screen.getByTestId("ti-jira-write-parent-key-error"),
    ).toHaveTextContent(/Parent issue key is required/i);
  });

  it("disables run when parentIssueKey format is invalid and shows validation message", () => {
    render(<JiraWritePanel jobId="job-1" bearerToken="token" />);
    fireEvent.click(screen.getByTestId("ti-jira-write-enabled"));
    fireEvent.change(screen.getByTestId("ti-jira-write-parent-key"), {
      target: { value: "not-a-key" },
    });
    expect(screen.getByTestId("ti-jira-write-run")).toBeDisabled();
    expect(
      screen.getByTestId("ti-jira-write-parent-key-error"),
    ).toHaveTextContent(/canonical Jira key shape/i);
  });

  it("enables run when writeEnabled and parentIssueKey valid", () => {
    render(<JiraWritePanel jobId="job-1" bearerToken="token" />);
    fireEvent.click(screen.getByTestId("ti-jira-write-enabled"));
    fireEvent.change(screen.getByTestId("ti-jira-write-parent-key"), {
      target: { value: "PROJ-123" },
    });
    expect(screen.getByTestId("ti-jira-write-run")).not.toBeDisabled();
  });

  it("misconfigured path shows validation error and prevents run", () => {
    render(<JiraWritePanel jobId="job-1" bearerToken="token" />);
    fireEvent.click(screen.getByTestId("ti-jira-write-enabled"));
    fireEvent.change(screen.getByTestId("ti-jira-write-parent-key"), {
      target: { value: "PROJ-123" },
    });
    // turn off use-default → custom path is now required
    fireEvent.click(screen.getByTestId("ti-jira-write-use-default-path"));
    expect(
      screen.getByTestId("ti-jira-write-output-path-error"),
    ).toHaveTextContent(/Provide a markdown output directory/i);
    expect(screen.getByTestId("ti-jira-write-run")).toBeDisabled();
  });

  it("dry-run defaults to true (safe default)", () => {
    render(<JiraWritePanel jobId="job-1" bearerToken="token" />);
    const dryRun = screen.getByTestId(
      "ti-jira-write-dry-run",
    ) as HTMLInputElement;
    expect(dryRun.checked).toBe(true);
  });

  it("successful dry-run shows result summary and dry-run count", async () => {
    vi.spyOn(api, "startJiraWrite").mockResolvedValue({
      ok: true,
      value: { ...successResult },
    });
    render(<JiraWritePanel jobId="job-1" bearerToken="token" />);
    fireEvent.click(screen.getByTestId("ti-jira-write-enabled"));
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
  });

  it("write-mode config persists to localStorage", async () => {
    render(<JiraWritePanel jobId="job-1" bearerToken="token" />);
    fireEvent.click(screen.getByTestId("ti-jira-write-enabled"));
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
    expect(parsed["writeEnabled"]).toBe(true);
    expect(parsed["parentIssueKey"]).toBe("PROJ-123");
  });

  it("restores persisted config across remount", async () => {
    render(<JiraWritePanel jobId="job-1" bearerToken="token" />);
    fireEvent.click(screen.getByTestId("ti-jira-write-enabled"));
    fireEvent.click(screen.getByTestId("ti-jira-write-use-default-path"));
    fireEvent.change(screen.getByTestId("ti-jira-write-output-path"), {
      target: { value: "/tmp/jira-write-out" },
    });

    await waitFor(() => {
      const stored = JSON.parse(
        window.localStorage.getItem(JIRA_WRITE_CONFIG_STORAGE_KEY) ?? "{}",
      ) as Record<string, unknown>;
      expect(stored["writeEnabled"]).toBe(true);
      expect(stored["useDefaultOutputPath"]).toBe(false);
      expect(stored["outputPathMarkdown"]).toBe("/tmp/jira-write-out");
    });

    cleanup();

    render(<JiraWritePanel jobId="job-1" bearerToken="token" />);
    await waitFor(() => {
      expect(screen.getByTestId("ti-jira-write-enabled")).toBeChecked();
      expect(
        screen.getByTestId("ti-jira-write-use-default-path"),
      ).not.toBeChecked();
      expect(screen.getByTestId("ti-jira-write-output-path")).toHaveValue(
        "/tmp/jira-write-out",
      );
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
    fireEvent.click(screen.getByTestId("ti-jira-write-enabled"));
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
});
