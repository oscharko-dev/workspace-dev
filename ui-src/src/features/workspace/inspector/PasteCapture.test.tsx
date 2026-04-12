import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PasteCapture } from "./PasteCapture";

afterEach(() => {
  cleanup();
});

function buildClipboardEvent(text: string): { clipboardData: DataTransfer } {
  const clipboardData = {
    getData: (type: string) =>
      type === "text" || type === "text/plain" ? text : "",
  } as unknown as DataTransfer;
  return { clipboardData };
}

describe("PasteCapture", () => {
  it("renders the paste prompt and example snippet", () => {
    render(<PasteCapture disabled={false} onPaste={vi.fn()} />);

    expect(
      screen.getByText(/paste your figma export here/i),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("region", { name: /paste area/i }),
    ).toBeInTheDocument();
  });

  it("fires onPaste with the pasted text", () => {
    const onPaste = vi.fn();
    render(<PasteCapture disabled={false} onPaste={onPaste} />);

    const textarea = screen.getByLabelText(/figma json paste target/i);
    fireEvent.paste(textarea, buildClipboardEvent('{"document":{}}'));

    expect(onPaste).toHaveBeenCalledTimes(1);
    expect(onPaste).toHaveBeenCalledWith('{"document":{}}');
  });

  it("does not fire onPaste when disabled", () => {
    const onPaste = vi.fn();
    render(<PasteCapture disabled={true} onPaste={onPaste} />);

    const textarea = screen.getByLabelText(/figma json paste target/i);
    fireEvent.paste(textarea, buildClipboardEvent('{"document":{}}'));

    expect(onPaste).not.toHaveBeenCalled();
    expect(textarea).toBeDisabled();
  });

  it("renders an error message when provided", () => {
    render(
      <PasteCapture
        disabled={false}
        onPaste={vi.fn()}
        errorMessage="Invalid Figma JSON payload."
      />,
    );

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Invalid Figma JSON payload.",
    );
  });

  it("renders a helper hint when provided", () => {
    render(
      <PasteCapture
        disabled={false}
        onPaste={vi.fn()}
        helperHint="Pasting..."
      />,
    );

    expect(screen.getByText("Pasting...")).toBeInTheDocument();
  });

  it("focuses the textarea when the region is clicked", () => {
    render(<PasteCapture disabled={false} onPaste={vi.fn()} />);

    const region = screen.getByRole("region", { name: /paste area/i });
    fireEvent.click(region);

    const textarea = screen.getByLabelText(/figma json paste target/i);
    expect(textarea).toHaveFocus();
  });

  it("does not focus the textarea when disabled", () => {
    render(<PasteCapture disabled={true} onPaste={vi.fn()} />);

    const region = screen.getByRole("region", { name: /paste area/i });
    fireEvent.click(region);

    const textarea = screen.getByLabelText(/figma json paste target/i);
    expect(textarea).not.toHaveFocus();
  });
});
