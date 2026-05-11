import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { useState, type JSX } from "react";

import { expectNoBlockingAccessibilityViolations } from "../../../../test/accessibility";
import {
  CustomContextMarkdownEditor,
} from "./custom-context-markdown-editor";
import { MAX_CUSTOM_CONTEXT_MARKDOWN_BYTES } from "./custom-context-markdown-editor-state";

function EditorHarness({ initial }: { initial: string }): JSX.Element {
  const [value, setValue] = useState(initial);
  return <CustomContextMarkdownEditor value={value} onChange={setValue} />;
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("CustomContextMarkdownEditor", () => {
  it("renders split edit and preview panes with redacted safe links", () => {
    render(
      <EditorHarness
        initial={`# Heading\n\nVisit [Docs](https://example.test)\n\nSee https://example.test/path.\n\nContact jane.doe@example.com`}
      />,
    );
    expect(screen.getByLabelText("Custom context markdown editor")).toBeInTheDocument();
    expect(screen.getByLabelText("Markdown preview")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Docs" })).toHaveAttribute(
      "href",
      "about:blank#redacted-link",
    );
    expect(screen.getByText(/See about:blank#redacted-link/)).toBeInTheDocument();
    const preview = screen.getByLabelText("Markdown preview");
    expect(within(preview).getByText("[REDACTED:EMAIL]")).toBeInTheDocument();
    expect(within(preview).queryByText(/jane\.doe@example\.com/)).not.toBeInTheDocument();
  });

  it("refuses backend-rejected markdown in validation and preview", () => {
    render(
      <EditorHarness
        initial={`---\ntitle: Unsafe\n---\n\n![cat](https://example.test/cat.png)\n\n<script>alert(1)</script>\n\n[local](http://169.254.169.254/latest)\n\n\`\`\`mermaid\ngraph TD\n\`\`\``}
      />,
    );
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(screen.getByTestId("ti-multisource-custom-markdown-error")).toHaveTextContent(
      /frontmatter/i,
    );
    expect(
      screen.getByTestId("ti-multisource-custom-markdown-preview-refusal"),
    ).toHaveTextContent(/frontmatter/i);
    expect(screen.queryByText("<script>alert(1)</script>")).not.toBeInTheDocument();
    expect(screen.queryByText("https://example.test/cat.png")).not.toBeInTheDocument();
    expect(screen.queryByText("http://169.254.169.254/latest")).not.toBeInTheDocument();
  });

  it("applies common markdown shortcuts to the selected text", async () => {
    render(<EditorHarness initial="alpha" />);
    const textarea = screen.getByTestId(
      "ti-multisource-custom-markdown",
    ) as HTMLTextAreaElement;
    textarea.setSelectionRange(0, textarea.value.length);
    fireEvent.keyDown(textarea, { key: "b", ctrlKey: true });
    await waitFor(() => {
      expect(textarea.value).toBe("**alpha**");
    });
  });

  it("surfaces a byte-budget validation error when the draft is too large", () => {
    render(<EditorHarness initial={"g".repeat(MAX_CUSTOM_CONTEXT_MARKDOWN_BYTES + 1)} />);
    expect(screen.getByTestId("ti-multisource-custom-markdown-error")).toHaveTextContent(
      /exceeds the/i,
    );
    expect(screen.getByTestId("ti-multisource-custom-markdown")).toHaveAttribute(
      "aria-invalid",
      "true",
    );
  });

  it("accepts backend-valid raw drafts over 16 KiB when canonical output fits", () => {
    render(<EditorHarness initial={`${"\n".repeat(17 * 1024)}Scope`} />);
    expect(
      screen.queryByTestId("ti-multisource-custom-markdown-error"),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("ti-multisource-custom-markdown")).toHaveAttribute(
      "aria-invalid",
      "false",
    );
    expect(screen.getByLabelText("Markdown preview")).toHaveTextContent("Scope");
  });

  it("does not add a client-only line-count refusal", () => {
    render(<EditorHarness initial={Array.from({ length: 2051 }, () => "- x").join("\n")} />);
    expect(
      screen.queryByTestId("ti-multisource-custom-markdown-error"),
    ).not.toBeInTheDocument();
    expect(screen.getByLabelText("Markdown preview")).toHaveTextContent("x");
  });

  it("has no blocking a11y violations", async () => {
    const { container } = render(<EditorHarness initial="# Heading" />);
    await expectNoBlockingAccessibilityViolations(container);
  });
});
