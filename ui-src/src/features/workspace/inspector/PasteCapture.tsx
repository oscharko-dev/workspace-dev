import {
  useCallback,
  useId,
  useRef,
  useState,
  type ChangeEvent as ReactChangeEvent,
  type ClipboardEvent as ReactClipboardEvent,
  type DragEvent as ReactDragEvent,
  type MouseEvent as ReactMouseEvent,
  type JSX,
} from "react";
import { FIGMA_PASTE_MAX_BYTES } from "../submit-schema";

export interface PasteCaptureProps {
  disabled: boolean;
  onPaste: (text: string, clipboardHtml?: string) => void;
  onDropFile?: (text: string, source: "drop" | "upload") => void;
  onError?: (code: "TOO_LARGE" | "UNSUPPORTED_FILE") => void;
  errorMessage?: string;
  helperHint?: string;
}

const EXAMPLE_SNIPPET = `{
  "document": {
    "id": "0:0",
    "name": "Document",
    "type": "DOCUMENT",
    "children": [ ... ]
  },
  "schemaVersion": "JSON_REST_V1"
}`;

function isJsonFile(file: File): boolean {
  return file.name.endsWith(".json") || file.type === "application/json";
}

export function PasteCapture({
  disabled,
  onPaste,
  onDropFile,
  onError,
  errorMessage,
  helperHint,
}: PasteCaptureProps): JSX.Element {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const reactId = useId();
  const labelId = `${reactId}-label`;
  const promptId = `${reactId}-prompt`;
  const errorId = `${reactId}-error`;
  const hintId = `${reactId}-hint`;

  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const [isReadingFile, setIsReadingFile] = useState(false);
  const interactionDisabled = disabled || isReadingFile;

  const describedByIds = [promptId];
  if (helperHint) {
    describedByIds.push(hintId);
  }
  if (errorMessage) {
    describedByIds.push(errorId);
  }

  const handleRegionClick = useCallback((): void => {
    if (interactionDisabled) {
      return;
    }
    textareaRef.current?.focus();
  }, [interactionDisabled]);

  const handleUploadButtonClick = useCallback(
    (event: ReactMouseEvent<HTMLButtonElement>): void => {
      event.preventDefault();
      event.stopPropagation();
      if (interactionDisabled) {
        return;
      }
      if (fileInputRef.current) {
        // Reset value so selecting the same file again still emits a change event.
        fileInputRef.current.value = "";
        fileInputRef.current.click();
      }
    },
    [interactionDisabled],
  );

  const handleJsonFile = useCallback(
    (file: File, source: "drop" | "upload"): void => {
      if (file.size > FIGMA_PASTE_MAX_BYTES) {
        onError?.("TOO_LARGE");
        return;
      }

      if (!isJsonFile(file)) {
        onError?.("UNSUPPORTED_FILE");
        return;
      }

      setIsReadingFile(true);
      void file
        .text()
        .then((text) => {
          if (onDropFile) {
            onDropFile(text, source);
            return;
          }
          onPaste(text);
        })
        .finally(() => {
          setIsReadingFile(false);
        });
    },
    [onDropFile, onError, onPaste],
  );

  const handlePaste = useCallback(
    (event: ReactClipboardEvent<HTMLTextAreaElement>): void => {
      if (interactionDisabled) {
        event.preventDefault();
        return;
      }
      const text = event.clipboardData.getData("text");
      if (text.length === 0) {
        return;
      }
      event.preventDefault();
      const html = event.clipboardData.getData("text/html");
      if (html.length > 0) {
        onPaste(text, html);
      } else {
        onPaste(text);
      }
    },
    [interactionDisabled, onPaste],
  );

  const handleDragOver = useCallback(
    (event: ReactDragEvent<HTMLElement>): void => {
      if (interactionDisabled) {
        return;
      }
      event.preventDefault();
      const types = Array.from(event.dataTransfer.types);
      if (types.includes("Files") || types.includes("text/plain")) {
        setIsDraggingOver(true);
        event.dataTransfer.dropEffect = "copy";
      }
    },
    [interactionDisabled],
  );

  const handleDragLeave = useCallback(
    (event: ReactDragEvent<HTMLElement>): void => {
      if (interactionDisabled) {
        return;
      }
      const currentTarget = event.currentTarget;
      const relatedTarget = event.relatedTarget as Node | null;
      if (!currentTarget.contains(relatedTarget)) {
        setIsDraggingOver(false);
      }
    },
    [interactionDisabled],
  );

  const handleDrop = useCallback(
    (event: ReactDragEvent<HTMLElement>): void => {
      if (interactionDisabled) {
        return;
      }
      event.preventDefault();
      setIsDraggingOver(false);

      const firstFile = event.dataTransfer.files.item(0);
      if (firstFile !== null) {
        handleJsonFile(firstFile, "drop");
        return;
      }

      const plainText = event.dataTransfer.getData("text/plain");
      if (plainText.length > 0) {
        onPaste(plainText);
      }
    },
    [handleJsonFile, interactionDisabled, onPaste],
  );

  const handleFileInputChange = useCallback(
    (event: ReactChangeEvent<HTMLInputElement>): void => {
      const files = event.currentTarget.files;
      const file =
        files === null
          ? null
          : typeof files.item === "function"
            ? files.item(0)
            : (files[0] ?? null);
      // Reset value so users can re-select the same file after failures.
      event.currentTarget.value = "";
      if (interactionDisabled || file === null) {
        return;
      }
      handleJsonFile(file, "upload");
    },
    [handleJsonFile, interactionDisabled],
  );

  return (
    <section
      role="region"
      aria-label="Paste area"
      onClick={handleRegionClick}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={`group relative flex h-full w-full cursor-text flex-col items-center justify-center gap-4 rounded-lg border border-dashed px-6 py-8 transition focus-within:border-[#4eba87] focus-within:ring-2 focus-within:ring-[#4eba87]/40 ${
        isDraggingOver ? "ring-2 ring-[#4eba87]/60" : ""
      } ${
        interactionDisabled
          ? "pointer-events-none cursor-not-allowed border-white/10 bg-[#0b0b0b] opacity-60"
          : "border-white/15 bg-[#101010] hover:border-white/30"
      }`}
    >
      <label id={labelId} htmlFor={`${reactId}-textarea`} className="sr-only">
        Figma JSON paste target
      </label>

      <div className="flex flex-col items-center gap-2 text-center">
        <p id={promptId} className="text-sm font-medium text-white/85">
          Paste, drop, or upload your Figma export here
        </p>
        <p className="text-xs text-white/50">
          Click anywhere in this column and paste your JSON_REST_V1 payload, or
          upload a `.json` file.
        </p>
        <button
          type="button"
          onClick={handleUploadButtonClick}
          disabled={interactionDisabled}
          className="rounded border border-white/20 bg-[#181818] px-3 py-1.5 text-xs font-medium text-white/80 transition hover:border-white/35 hover:bg-[#1f1f1f] disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-[#111111] disabled:text-white/35"
        >
          Upload JSON file
        </button>
        <pre className="mt-2 max-w-full overflow-hidden rounded border border-[#000000] bg-[#0b0b0b] px-3 py-2 text-left text-[11px] leading-relaxed text-white/45">
          {EXAMPLE_SNIPPET}
        </pre>
      </div>

      <textarea
        ref={textareaRef}
        id={`${reactId}-textarea`}
        className="sr-only"
        aria-describedby={describedByIds.join(" ")}
        aria-invalid={errorMessage ? true : undefined}
        disabled={interactionDisabled}
        onPaste={handlePaste}
        readOnly
        defaultValue=""
      />

      <input
        ref={fileInputRef}
        type="file"
        aria-label="Upload Figma JSON file"
        className="sr-only"
        accept=".json,application/json"
        disabled={interactionDisabled}
        onChange={handleFileInputChange}
      />

      {helperHint ? (
        <p
          id={hintId}
          className="text-xs font-medium text-[#4eba87]"
          aria-live="polite"
        >
          {helperHint}
        </p>
      ) : null}

      {errorMessage ? (
        <p
          id={errorId}
          role="alert"
          className="max-w-full rounded border border-rose-500/40 bg-rose-950/30 px-3 py-2 text-xs text-rose-200"
        >
          {errorMessage}
        </p>
      ) : null}
    </section>
  );
}
