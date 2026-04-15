import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PasteDropZone } from "./PasteDropZone";

afterEach(() => {
  cleanup();
});

const VALID_DESIGN_URL_WITH_NODE =
  "https://figma.com/design/abc123XYZ/My-File?node-id=10-20";
const VALID_DESIGN_URL_FILE_LEVEL =
  "https://figma.com/design/abc123XYZ/My-File";
const FIGJAM_URL = "https://figma.com/board/ABC/Foo?node-id=1-2";

function getUrlInput(): HTMLInputElement {
  return screen.getByLabelText(/figma design url/i) as HTMLInputElement;
}

function getSubmitButton(): HTMLButtonElement {
  return screen.getByRole("button", {
    name: /open design/i,
  }) as HTMLButtonElement;
}

describe("PasteDropZone — URL validation", () => {
  it("renders with the URL input empty and shows no validation indicators", () => {
    render(
      <PasteDropZone disabled={false} onPaste={vi.fn()} onFigmaUrl={vi.fn()} />,
    );

    expect(getUrlInput().value).toBe("");
    expect(
      screen.queryByTestId("paste-drop-zone-url-valid-icon"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("paste-drop-zone-url-invalid-icon"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("paste-drop-zone-url-hint"),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("typing a non-URL string shows the red-X icon and an error message", () => {
    render(
      <PasteDropZone disabled={false} onPaste={vi.fn()} onFigmaUrl={vi.fn()} />,
    );

    fireEvent.change(getUrlInput(), { target: { value: "not a url" } });

    expect(
      screen.getByTestId("paste-drop-zone-url-invalid-icon"),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("paste-drop-zone-url-valid-icon"),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(
      /that does not look like a url/i,
    );
  });

  it("typing a FigJam URL shows the red X with the unsupported-variant message", () => {
    render(
      <PasteDropZone disabled={false} onPaste={vi.fn()} onFigmaUrl={vi.fn()} />,
    );

    fireEvent.change(getUrlInput(), { target: { value: FIGJAM_URL } });

    expect(
      screen.getByTestId("paste-drop-zone-url-invalid-icon"),
    ).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(
      /figjam, figma make, and community files are not supported/i,
    );
  });

  it("typing a valid design URL with node-id shows the green check and no hint", () => {
    render(
      <PasteDropZone disabled={false} onPaste={vi.fn()} onFigmaUrl={vi.fn()} />,
    );

    fireEvent.change(getUrlInput(), {
      target: { value: VALID_DESIGN_URL_WITH_NODE },
    });

    expect(
      screen.getByTestId("paste-drop-zone-url-valid-icon"),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("paste-drop-zone-url-invalid-icon"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("paste-drop-zone-url-hint"),
    ).not.toBeInTheDocument();
  });

  it("typing a valid design URL without node-id shows the green check and the file-level hint", () => {
    render(
      <PasteDropZone disabled={false} onPaste={vi.fn()} onFigmaUrl={vi.fn()} />,
    );

    fireEvent.change(getUrlInput(), {
      target: { value: VALID_DESIGN_URL_FILE_LEVEL },
    });

    expect(
      screen.getByTestId("paste-drop-zone-url-valid-icon"),
    ).toBeInTheDocument();
    const hint = screen.getByTestId("paste-drop-zone-url-hint");
    expect(hint).toBeInTheDocument();
    expect(hint).toHaveTextContent(/no frame selected/i);
  });
});

describe("PasteDropZone — submit gating", () => {
  it("disables the submit button when the URL is non-empty and invalid", () => {
    render(
      <PasteDropZone disabled={false} onPaste={vi.fn()} onFigmaUrl={vi.fn()} />,
    );

    fireEvent.change(getUrlInput(), { target: { value: "garbage" } });

    expect(getSubmitButton()).toBeDisabled();
  });

  it("enables the submit button for a valid URL", () => {
    render(
      <PasteDropZone disabled={false} onPaste={vi.fn()} onFigmaUrl={vi.fn()} />,
    );

    fireEvent.change(getUrlInput(), {
      target: { value: VALID_DESIGN_URL_WITH_NODE },
    });

    expect(getSubmitButton()).not.toBeDisabled();
  });

  it("submitting a valid URL with node-id invokes onFigmaUrl(fileKey, nodeId)", () => {
    const onFigmaUrl = vi.fn();
    render(
      <PasteDropZone
        disabled={false}
        onPaste={vi.fn()}
        onFigmaUrl={onFigmaUrl}
      />,
    );

    fireEvent.change(getUrlInput(), {
      target: { value: VALID_DESIGN_URL_WITH_NODE },
    });
    fireEvent.click(getSubmitButton());

    expect(onFigmaUrl).toHaveBeenCalledTimes(1);
    expect(onFigmaUrl).toHaveBeenCalledWith("abc123XYZ", "10-20");
  });

  it("submitting a valid file-level design URL invokes onFigmaUrl(fileKey, null)", () => {
    const onFigmaUrl = vi.fn();
    render(
      <PasteDropZone
        disabled={false}
        onPaste={vi.fn()}
        onFigmaUrl={onFigmaUrl}
      />,
    );

    fireEvent.change(getUrlInput(), {
      target: { value: VALID_DESIGN_URL_FILE_LEVEL },
    });
    fireEvent.click(getSubmitButton());

    expect(onFigmaUrl).toHaveBeenCalledTimes(1);
    expect(onFigmaUrl).toHaveBeenCalledWith("abc123XYZ", null);
  });

  it("does not call onFigmaUrl when the URL is invalid even if the form is submitted", () => {
    const onFigmaUrl = vi.fn();
    render(
      <PasteDropZone
        disabled={false}
        onPaste={vi.fn()}
        onFigmaUrl={onFigmaUrl}
      />,
    );

    fireEvent.change(getUrlInput(), { target: { value: FIGJAM_URL } });
    // Submit button is disabled, but exercise the form submit path directly.
    const form = getUrlInput().closest("form");
    expect(form).not.toBeNull();
    fireEvent.submit(form as HTMLFormElement);

    expect(onFigmaUrl).not.toHaveBeenCalled();
  });
});
