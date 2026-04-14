import {
  useCallback,
  useId,
  useRef,
  useState,
  type ChangeEvent as ReactChangeEvent,
  type ClipboardEvent as ReactClipboardEvent,
  type DragEvent as ReactDragEvent,
  type FormEvent as ReactFormEvent,
  type MouseEvent as ReactMouseEvent,
  type JSX,
} from "react";
import { FIGMA_PASTE_MAX_BYTES } from "../submit-schema";
import { isFigmaClipboard } from "./figma-clipboard-parser";

export interface PasteDropZoneProps {
  disabled: boolean;
  /** Called when Figma clipboard HTML is pasted (Cmd+V) */
  onPaste: (text: string, clipboardHtml?: string) => void;
  /** Called when a JSON file is dropped or uploaded */
  onDropFile?: (text: string, source: "drop" | "upload") => void;
  onError?: (code: "TOO_LARGE" | "UNSUPPORTED_FILE") => void;
  /** Called when a valid Figma URL is submitted */
  onFigmaUrl: (fileKey: string, nodeId: string | null) => void;
  errorMessage?: string;
}

export interface FigmaUrlParseResult {
  fileKey: string;
  nodeId: string | null;
}

/**
 * Parse a Figma design URL into a `{ fileKey, nodeId }` pair.
 *
 * Accepts both `figma.com/design/:fileKey/:fileName` and the legacy
 * `figma.com/file/:fileKey/:fileName` shape. `node-id` may be encoded as
 * `1-2`, `1:2`, or `1%3A2`; it is normalized to the `1-2` form for internal use.
 * Returns `null` for any malformed or non-Figma URL.
 */
function parseFigmaUrl(url: string): FigmaUrlParseResult | null {
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    return null;
  }

  const host = parsed.hostname.replace(/^www\./, "");
  if (host !== "figma.com") {
    return null;
  }

  const segments = parsed.pathname.split("/").filter(Boolean);
  if (segments.length < 2) {
    return null;
  }

  const kind = segments[0];
  if (kind !== "design" && kind !== "file") {
    return null;
  }

  const fileKey = segments[1];
  if (fileKey === undefined || fileKey.length === 0) {
    return null;
  }

  const rawNodeId = parsed.searchParams.get("node-id");
  const nodeId = rawNodeId === null ? null : rawNodeId.replace(":", "-");

  return { fileKey, nodeId };
}

function isJsonFile(file: File): boolean {
  return file.name.endsWith(".json") || file.type === "application/json";
}

export function PasteDropZone({
  disabled,
  onPaste,
  onDropFile,
  onError,
  onFigmaUrl,
  errorMessage,
}: PasteDropZoneProps): JSX.Element {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const reactId = useId();
  const labelId = `${reactId}-label`;
  const promptId = `${reactId}-prompt`;
  const errorId = `${reactId}-error`;
  const urlInputId = `${reactId}-url`;
  const urlErrorId = `${reactId}-url-error`;

  const [urlValue, setUrlValue] = useState("");
  const [urlError, setUrlError] = useState<string | null>(null);
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const [isReadingFile, setIsReadingFile] = useState(false);
  const interactionDisabled = disabled || isReadingFile;

  const describedByIds = [promptId];
  if (errorMessage !== undefined) {
    describedByIds.push(errorId);
  }

  const handleRegionClick = useCallback((): void => {
    if (interactionDisabled) {
      return;
    }
    textareaRef.current?.focus();
  }, [interactionDisabled]);

  const handlePaste = useCallback(
    (event: ReactClipboardEvent<HTMLTextAreaElement>): void => {
      if (interactionDisabled) {
        event.preventDefault();
        return;
      }
      const text = event.clipboardData.getData("text");
      const html = event.clipboardData.getData("text/html");
      if (text.length === 0 && html.length === 0) {
        return;
      }
      event.preventDefault();
      if (html.length > 0 && isFigmaClipboard(html)) {
        onPaste(text, html);
        return;
      }
      onPaste(text);
    },
    [interactionDisabled, onPaste],
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

  const handleUploadButtonClick = useCallback(
    (event: ReactMouseEvent<HTMLButtonElement>): void => {
      event.preventDefault();
      event.stopPropagation();
      if (interactionDisabled) {
        return;
      }
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
        fileInputRef.current.click();
      }
    },
    [interactionDisabled],
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
      event.currentTarget.value = "";
      if (interactionDisabled || file === null) {
        return;
      }
      handleJsonFile(file, "upload");
    },
    [handleJsonFile, interactionDisabled],
  );

  const handleUrlChange = useCallback(
    (event: ReactChangeEvent<HTMLInputElement>): void => {
      setUrlValue(event.currentTarget.value);
      if (urlError !== null) {
        setUrlError(null);
      }
    },
    [urlError],
  );

  const handleUrlSubmit = useCallback(
    (event: ReactFormEvent<HTMLFormElement>): void => {
      event.preventDefault();
      if (interactionDisabled) {
        return;
      }
      const trimmed = urlValue.trim();
      if (trimmed.length === 0) {
        setUrlError("Enter a Figma design URL");
        return;
      }
      const result = parseFigmaUrl(trimmed);
      if (result === null) {
        setUrlError("That does not look like a Figma URL");
        return;
      }
      setUrlError(null);
      onFigmaUrl(result.fileKey, result.nodeId);
    },
    [interactionDisabled, onFigmaUrl, urlValue],
  );

  return (
    <section
      role="region"
      aria-label="Paste area"
      onClick={handleRegionClick}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={`group relative flex h-full w-full cursor-text flex-col items-center justify-center gap-6 rounded-lg border border-dashed px-6 py-8 transition focus-within:border-[#4eba87]/40 focus-within:ring-2 focus-within:ring-[#4eba87]/40 ${
        isDraggingOver ? "ring-2 ring-[#4eba87]/60" : ""
      } ${
        interactionDisabled
          ? "pointer-events-none cursor-not-allowed border-white/10 bg-[#0b0b0b] opacity-60"
          : "border-white/15 bg-[#101010] hover:border-white/30"
      }`}
    >
      <label id={labelId} htmlFor={`${reactId}-textarea`} className="sr-only">
        Figma clipboard paste target
      </label>

      <div className="flex flex-col items-center gap-2 text-center">
        <p className="text-sm font-medium text-white/85">Paste from Figma</p>
        <p id={promptId} className="text-xs text-white/50">
          Copy a component or frame in Figma, then press
          <span className="mx-1 rounded border border-white/15 bg-[#181818] px-1.5 py-0.5 font-mono text-[10px] text-white/70">
            ⌘V
          </span>
          (Mac) or
          <span className="mx-1 rounded border border-white/15 bg-[#181818] px-1.5 py-0.5 font-mono text-[10px] text-white/70">
            Ctrl+V
          </span>
          (Windows).
        </p>
        <button
          type="button"
          onClick={handleUploadButtonClick}
          disabled={interactionDisabled}
          className="rounded border border-white/20 bg-[#181818] px-3 py-1.5 text-xs font-medium text-white/80 transition hover:border-white/35 hover:bg-[#1f1f1f] disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-[#111111] disabled:text-white/35"
        >
          Upload JSON file
        </button>
      </div>

      <div
        aria-hidden="true"
        className="flex w-full max-w-xs items-center gap-3 text-[10px] uppercase tracking-wider text-white/30"
      >
        <span className="h-px flex-1 bg-white/10" />
        <span>or</span>
        <span className="h-px flex-1 bg-white/10" />
      </div>

      <form
        onSubmit={handleUrlSubmit}
        onClick={(event) => {
          event.stopPropagation();
        }}
        className="flex w-full max-w-md flex-col items-stretch gap-2"
      >
        <label
          htmlFor={urlInputId}
          className="text-xs font-medium text-white/70"
        >
          Enter Figma URL
        </label>
        <input
          id={urlInputId}
          type="url"
          inputMode="url"
          autoComplete="off"
          spellCheck={false}
          placeholder="https://figma.com/design/…"
          value={urlValue}
          onChange={handleUrlChange}
          disabled={interactionDisabled}
          aria-label="Figma design URL"
          aria-invalid={urlError !== null ? true : undefined}
          aria-describedby={urlError !== null ? urlErrorId : undefined}
          className="w-full rounded border border-white/15 bg-[#0b0b0b] px-3 py-2 text-xs text-white/85 placeholder:text-white/30 focus:border-[#4eba87]/60 focus:outline-none focus:ring-1 focus:ring-[#4eba87]/40 disabled:cursor-not-allowed disabled:opacity-60"
        />
        {urlError !== null ? (
          <p id={urlErrorId} role="alert" className="text-xs text-rose-300">
            {urlError}
          </p>
        ) : null}
        <div className="flex justify-end">
          <button
            type="submit"
            disabled={interactionDisabled}
            className="cursor-pointer rounded border border-[#4eba87] bg-[#4eba87]/12 px-3 py-1.5 text-xs font-medium text-[#4eba87] transition hover:bg-[#4eba87]/18 disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-transparent disabled:text-white/35"
          >
            Open design
          </button>
        </div>
      </form>

      <textarea
        ref={textareaRef}
        id={`${reactId}-textarea`}
        className="sr-only"
        aria-describedby={describedByIds.join(" ")}
        aria-invalid={errorMessage !== undefined ? true : undefined}
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

      {errorMessage !== undefined ? (
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
