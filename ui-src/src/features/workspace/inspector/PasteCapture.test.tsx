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

function createDeferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error?: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (error?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("PasteCapture", () => {
  it("renders the paste prompt and example snippet", () => {
    render(<PasteCapture disabled={false} onPaste={vi.fn()} />);

    expect(
      screen.getByText(/paste, drop, or upload your figma export here/i),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /upload json file/i }),
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
    expect(onDropFile).toHaveBeenCalledWith(fileContent, "drop");
    expect(onPaste).not.toHaveBeenCalled();
  });

  it("ignores a second drop while the first dropped file is still being read", async () => {
    const onDropFile = vi.fn();
    render(
      <PasteCapture
        disabled={false}
        onPaste={vi.fn()}
        onDropFile={onDropFile}
      />,
    );

    const region = screen.getByRole("region", { name: /paste area/i });
    const fileContent = '{"document":{}}';
    const deferred = createDeferred<string>();
    const file = new File([fileContent], "export.json", {
      type: "application/json",
    });
    const readSpy = vi.fn(() => deferred.promise);
    Object.defineProperty(file, "text", {
      value: readSpy,
    });

    fireEvent.drop(region, buildDropEvent({ files: [file] }));
    fireEvent.drop(region, buildDropEvent({ files: [file] }));

    expect(readSpy).toHaveBeenCalledTimes(1);
    expect(onDropFile).not.toHaveBeenCalled();

    await act(async () => {
      deferred.resolve(fileContent);
      await deferred.promise;
    });

    expect(onDropFile).toHaveBeenCalledTimes(1);
    expect(onDropFile).toHaveBeenCalledWith(fileContent, "drop");
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

  it("drop of .txt file fires onError('UNSUPPORTED_FILE')", async () => {
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
    const textFile = new File(['{"document":{}}'], "notes.txt", {
      type: "text/plain",
    });

    fireEvent.drop(region, buildDropEvent({ files: [textFile] }));

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

describe("PasteCapture — file upload", () => {
  it("clicking upload button triggers hidden file input", () => {
    const clickSpy = vi.spyOn(HTMLInputElement.prototype, "click");
    render(<PasteCapture disabled={false} onPaste={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: /upload json file/i }));

    expect(clickSpy).toHaveBeenCalledTimes(1);
    clickSpy.mockRestore();
  });

  it("uploading a valid .json file fires onDropFile with source='upload'", async () => {
    const onDropFile = vi.fn();
    render(
      <PasteCapture
        disabled={false}
        onPaste={vi.fn()}
        onDropFile={onDropFile}
      />,
    );

    const fileContent = '{"document":{}}';
    const file = new File([fileContent], "upload.json", {
      type: "application/json",
    });
    Object.defineProperty(file, "text", {
      value: () => Promise.resolve(fileContent),
    });

    const input = screen.getByLabelText(/upload figma json file/i);
    fireEvent.change(input, { target: { files: [file] } });

    await act(async () => {
      await Promise.resolve();
    });

    expect(onDropFile).toHaveBeenCalledTimes(1);
    expect(onDropFile).toHaveBeenCalledWith(fileContent, "upload");
  });

  it("uploading .txt file fires onError('UNSUPPORTED_FILE')", async () => {
    const onError = vi.fn();
    render(
      <PasteCapture
        disabled={false}
        onPaste={vi.fn()}
        onDropFile={vi.fn()}
        onError={onError}
      />,
    );

    const textFile = new File(['{"document":{}}'], "notes.txt", {
      type: "text/plain",
    });
    const input = screen.getByLabelText(/upload figma json file/i);
    fireEvent.change(input, { target: { files: [textFile] } });

    await act(async () => {
      await Promise.resolve();
    });

    expect(onError).toHaveBeenCalledWith("UNSUPPORTED_FILE");
  });

  it("uploading oversized file fires onError('TOO_LARGE')", async () => {
    const onError = vi.fn();
    render(
      <PasteCapture
        disabled={false}
        onPaste={vi.fn()}
        onDropFile={vi.fn()}
        onError={onError}
      />,
    );

    const largeFile = new File(["x"], "large.json", {
      type: "application/json",
    });
    Object.defineProperty(largeFile, "size", {
      value: FIGMA_PASTE_MAX_BYTES + 1,
    });

    const input = screen.getByLabelText(/upload figma json file/i);
    fireEvent.change(input, { target: { files: [largeFile] } });

    await act(async () => {
      await Promise.resolve();
    });

    expect(onError).toHaveBeenCalledWith("TOO_LARGE");
  });

  it("disables upload interaction when component is disabled", () => {
    render(<PasteCapture disabled={true} onPaste={vi.fn()} />);

    expect(
      screen.getByRole("button", { name: /upload json file/i }),
    ).toBeDisabled();
    expect(screen.getByLabelText(/upload figma json file/i)).toBeDisabled();
  });
});
