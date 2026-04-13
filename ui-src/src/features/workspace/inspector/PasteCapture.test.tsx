import {
  cleanup,
  fireEvent,
  render,
  screen,
  act,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FIGMA_PASTE_MAX_BYTES } from "../submit-schema";
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

function buildDropEvent(overrides: {
  files?: File[];
  plainText?: string;
}): Partial<DragEvent> {
  const files = overrides.files ?? [];
  const plainText = overrides.plainText ?? "";

  return {
    dataTransfer: {
      files: Object.assign(files, {
        length: files.length,
        item: (i: number) => files[i] ?? null,
      }),
      getData: (type: string) => (type === "text/plain" ? plainText : ""),
      types: files.length > 0 ? ["Files"] : ["text/plain"],
    } as unknown as DataTransfer,
  };
}

function buildDragOverEvent(types: string[] = ["Files"]): Partial<DragEvent> {
  return {
    dataTransfer: {
      types,
      dropEffect: "none",
    } as unknown as DataTransfer,
  };
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

describe("PasteCapture — drag-and-drop", () => {
  it("drop of a .json File fires onDropFile", async () => {
    const onDropFile = vi.fn();
    const onPaste = vi.fn();
    render(
      <PasteCapture
        disabled={false}
        onPaste={onPaste}
        onDropFile={onDropFile}
      />,
    );

    const region = screen.getByRole("region", { name: /paste area/i });

    const fileContent = '{"document":{}}';
    const file = new File([fileContent], "export.json", {
      type: "application/json",
    });
    Object.defineProperty(file, "text", {
      value: () => Promise.resolve(fileContent),
    });

    const dropEvent = buildDropEvent({ files: [file] });
    fireEvent.drop(region, dropEvent);

    await act(async () => {
      await Promise.resolve();
    });

    expect(onDropFile).toHaveBeenCalledTimes(1);
    expect(onDropFile).toHaveBeenCalledWith(fileContent);
    expect(onPaste).not.toHaveBeenCalled();
  });

  it("drop of oversized file fires onError('TOO_LARGE') and does NOT fire onDropFile", async () => {
    const onDropFile = vi.fn();
    const onError = vi.fn();
    render(
      <PasteCapture
        disabled={false}
        onPaste={vi.fn()}
        onDropFile={onDropFile}
        onError={onError}
      />,
    );

    const region = screen.getByRole("region", { name: /paste area/i });

    const largeFile = new File(["x"], "export.json", {
      type: "application/json",
    });
    Object.defineProperty(largeFile, "size", {
      value: FIGMA_PASTE_MAX_BYTES + 1,
    });

    const dropEvent = buildDropEvent({ files: [largeFile] });
    fireEvent.drop(region, dropEvent);

    await act(async () => {
      await Promise.resolve();
    });

    expect(onError).toHaveBeenCalledWith("TOO_LARGE");
    expect(onDropFile).not.toHaveBeenCalled();
  });

  it("drop of .png file fires onError('UNSUPPORTED_FILE')", async () => {
    const onDropFile = vi.fn();
    const onError = vi.fn();
    render(
      <PasteCapture
        disabled={false}
        onPaste={vi.fn()}
        onDropFile={onDropFile}
        onError={onError}
      />,
    );

    const region = screen.getByRole("region", { name: /paste area/i });

    const pngFile = new File(["png-data"], "image.png", { type: "image/png" });
    const dropEvent = buildDropEvent({ files: [pngFile] });
    fireEvent.drop(region, dropEvent);

    await act(async () => {
      await Promise.resolve();
    });

    expect(onError).toHaveBeenCalledWith("UNSUPPORTED_FILE");
    expect(onDropFile).not.toHaveBeenCalled();
  });

  it("DragOver with Files type adds ring class (isDraggingOver visual state)", () => {
    render(<PasteCapture disabled={false} onPaste={vi.fn()} />);

    const region = screen.getByRole("region", { name: /paste area/i });

    fireEvent.dragOver(region, buildDragOverEvent(["Files"]));

    expect(region.className).toContain("ring-2");
    expect(region.className).toContain("ring-[#4eba87]/60");
  });

  it("disabled state ignores drops", async () => {
    const onDropFile = vi.fn();
    const onPaste = vi.fn();
    render(
      <PasteCapture
        disabled={true}
        onPaste={onPaste}
        onDropFile={onDropFile}
      />,
    );

    const region = screen.getByRole("region", { name: /paste area/i });

    const fileContent = '{"document":{}}';
    const file = new File([fileContent], "export.json", {
      type: "application/json",
    });
    Object.defineProperty(file, "text", {
      value: () => Promise.resolve(fileContent),
    });

    const dropEvent = buildDropEvent({ files: [file] });
    fireEvent.drop(region, dropEvent);

    await act(async () => {
      await Promise.resolve();
    });

    expect(onDropFile).not.toHaveBeenCalled();
    expect(onPaste).not.toHaveBeenCalled();
  });
});
