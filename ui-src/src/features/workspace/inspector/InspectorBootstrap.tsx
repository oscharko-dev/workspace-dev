import { type JSX } from "react";
import { FIGMA_PASTE_MAX_LABEL } from "../submit-schema";
import { PasteCapture } from "./PasteCapture";
import { SmartBanner } from "./SmartBanner";
import type { InspectorBootstrapState } from "./inspector-bootstrap-state";
import type { ImportIntent } from "./paste-input-classifier";

export interface InspectorBootstrapProps {
  state: InspectorBootstrapState;
  onPaste: (text: string, clipboardHtml?: string) => void;
  onDropFile?: (text: string) => void;
  onError?: (code: "TOO_LARGE" | "UNSUPPORTED_FILE") => void;
  onRetry: () => void;
  onConfirmIntent?: (intent: ImportIntent) => void;
  onDismissIntent?: () => void;
}

interface ColumnCopy {
  left: string;
  center: string;
  right: string;
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

function PasteExample(): JSX.Element {
  return (
    <pre className="mt-2 max-w-full overflow-hidden rounded border border-[#000000] bg-[#0b0b0b] px-3 py-2 text-left text-[11px] leading-relaxed text-white/45">
      {EXAMPLE_SNIPPET}
    </pre>
  );
}

function getColumnCopy(state: InspectorBootstrapState): ColumnCopy {
  switch (state.kind) {
    case "idle":
    case "focused":
      return {
        left: "Waiting for import — paste a Figma export in the middle column.",
        center:
          "Waiting for import — paste a Figma export in the middle column.",
        right:
          "Waiting for import — paste a Figma export in the middle column.",
      };
    case "detected":
      return {
        left: "Typ erkannt \u2014 bitte best\u00e4tigen oder korrigieren.",
        center: "Typ erkannt \u2014 bitte best\u00e4tigen oder korrigieren.",
        right: "Typ erkannt \u2014 bitte best\u00e4tigen oder korrigieren.",
      };
    case "pasting":
      return {
        left: "Submitting import...",
        center: "Pasting\u2026",
        right: "Submitting import...",
      };
    case "queued":
      return {
        left: "Queued — import will start shortly.",
        center: "Import queued",
        right: "Queued — import will start shortly.",
      };
    case "processing":
      return {
        left: "Mapping\u2026",
        center: "Processing — building component tree...",
        right: "Generating code",
      };
    case "ready":
      return {
        left: "Ready — loading Inspector...",
        center: "Ready — loading Inspector...",
        right: "Ready — loading Inspector...",
      };
    case "failed":
      return {
        left: "Import failed. See the middle column for details.",
        center: "Import failed. See the middle column for details.",
        right: "Import failed. See the middle column for details.",
      };
    default: {
      const _exhaustive: never = state;
      return _exhaustive;
    }
  }
}

function isPasteDisabled(state: InspectorBootstrapState): boolean {
  return (
    state.kind === "pasting" ||
    state.kind === "queued" ||
    state.kind === "processing" ||
    state.kind === "ready"
  );
}

function getHelperHint(state: InspectorBootstrapState): string | undefined {
  switch (state.kind) {
    case "detected":
      return "Typ erkannt";
    case "pasting":
      return "Pasting...";
    case "queued":
      return "Import queued";
    case "processing":
      return "Generating...";
    default:
      return undefined;
  }
}

function getErrorMessage(state: InspectorBootstrapState): string | undefined {
  if (state.kind !== "failed") {
    return undefined;
  }
  switch (state.reason) {
    case "EMPTY_INPUT":
      return "Please paste or drop a Figma JSON export.";
    case "INVALID_PAYLOAD":
      return "That does not look like a Figma JSON export. Please paste a JSON_REST_V1 payload.";
    case "TOO_LARGE":
      return `Payload is too large. The limit is ${FIGMA_PASTE_MAX_LABEL}.`;
    case "SCHEMA_MISMATCH":
      return "The payload does not match the expected Figma JSON_REST_V1 schema.";
    case "SECURE_CONTEXT_MISSING":
      return "Clipboard access requires a secure (https) context.";
    case "UNSUPPORTED_FILE":
      return "Unsupported file. Please drop a .json file with the Figma export.";
    case "UNSUPPORTED_PLUGIN_EXPORT":
      return "Plugin export JSON cannot be imported here yet. Paste a Figma JSON export or correct the detected type before starting the import.";
    case "UNSUPPORTED_TEXT_PASTE":
      return "This paste looks like code or plain text, not a Figma JSON export. Paste a JSON_REST_V1 export or correct the detected type.";
    case "UNSUPPORTED_UNKNOWN_PASTE":
      return "This paste could not be matched to a supported Figma import path. Paste a Figma JSON export or correct the detected type.";
    default:
      return "Import failed. Please try again.";
  }
}

function LogoMark(): JSX.Element {
  return (
    <div className="grid size-8 place-items-center rounded border border-[#000000] bg-[#333333]">
      <img
        src="/workspace/ui/logo-keiko.svg"
        alt=""
        className="block size-4 object-contain"
      />
    </div>
  );
}

function BootstrapHeader(): JSX.Element {
  const buttons: readonly string[] = ["Review", "Sync", "PR", "Coverage"];
  return (
    <header className="shrink-0 border-b border-[#000000] bg-[#171717]">
      <div className="flex w-full items-center justify-between gap-3 px-4 py-2">
        <div className="flex items-center gap-3">
          <button
            type="button"
            disabled
            className="flex cursor-not-allowed items-center gap-1 rounded-md border border-transparent px-2 py-1 text-xs font-medium text-white/30"
          >
            Back
          </button>

          <div className="h-4 w-px bg-[#333333]" />

          <div className="flex items-center gap-2">
            <LogoMark />
            <div className="flex items-baseline gap-2">
              <h1 className="m-0 text-sm font-semibold tracking-tight text-white">
                Inspector
              </h1>
              <span className="text-[10px] uppercase tracking-[0.22em] text-white/35">
                workspace-dev
              </span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1">
          {buttons.map((label) => (
            <button
              key={label}
              type="button"
              disabled
              className="flex cursor-not-allowed items-center gap-1.5 rounded-md border border-transparent bg-transparent px-2.5 py-1 text-[11px] font-medium text-white/25"
            >
              {label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <span className="rounded border border-[#000000] bg-[#222222] px-2 py-0.5 text-[10px] font-mono text-white/45">
            rest + deterministic
          </span>
        </div>
      </div>
    </header>
  );
}

function ColumnPlaceholder({
  testId,
  heading,
  copy,
}: {
  testId: string;
  heading: string;
  copy: string;
}): JSX.Element {
  return (
    <div
      data-testid={testId}
      className="flex h-full min-h-0 flex-1 flex-col overflow-hidden border-r border-[#000000] bg-[#101010] last:border-r-0"
    >
      <div className="shrink-0 border-b border-[#000000] bg-[#171717] px-3 py-2">
        <h2 className="m-0 text-[11px] font-semibold uppercase tracking-[0.22em] text-white/55">
          {heading}
        </h2>
      </div>
      <div className="flex min-h-0 flex-1 items-center justify-center px-4 py-6">
        <p className="max-w-xs text-center text-xs text-white/55">{copy}</p>
      </div>
    </div>
  );
}

export function InspectorBootstrap({
  state,
  onPaste,
  onDropFile,
  onError,
  onRetry,
  onConfirmIntent,
  onDismissIntent,
}: InspectorBootstrapProps): JSX.Element {
  const copy = getColumnCopy(state);
  const disabled = isPasteDisabled(state);
  const helperHint = getHelperHint(state);
  const errorMessage = getErrorMessage(state);
  const showRetry = state.kind === "failed" && state.retryable;

  return (
    <div
      data-testid="inspector-bootstrap"
      className="flex h-screen flex-col overflow-hidden bg-[#101010] text-white"
    >
      <BootstrapHeader />

      <main className="flex min-h-0 flex-1 flex-row overflow-hidden">
        <ColumnPlaceholder
          testId="inspector-bootstrap-left"
          heading="Component tree"
          copy={copy.left}
        />

        <div
          data-testid="inspector-bootstrap-center"
          className="flex h-full min-h-0 flex-1 flex-col overflow-hidden border-r border-[#000000] bg-[#101010]"
        >
          <div className="shrink-0 border-b border-[#000000] bg-[#171717] px-3 py-2">
            <h2 className="m-0 text-[11px] font-semibold uppercase tracking-[0.22em] text-white/55">
              Import
            </h2>
          </div>
          <div className="flex min-h-0 flex-1 flex-col gap-3 px-4 py-4">
            {state.kind === "detected" &&
            onConfirmIntent !== undefined &&
            onDismissIntent !== undefined ? (
              <SmartBanner
                key={state.rawText}
                intent={state.intent}
                confidence={state.confidence}
                onConfirm={onConfirmIntent}
                onDismiss={onDismissIntent}
              />
            ) : null}
            <PasteCapture
              disabled={disabled}
              onPaste={onPaste}
              {...(onDropFile !== undefined ? { onDropFile } : {})}
              {...(onError !== undefined ? { onError } : {})}
              {...(helperHint !== undefined ? { helperHint } : {})}
              {...(errorMessage !== undefined ? { errorMessage } : {})}
            />
            {state.kind === "failed" ? <PasteExample /> : null}
            {showRetry ? (
              <div className="flex justify-center">
                <button
                  type="button"
                  onClick={onRetry}
                  className="cursor-pointer rounded border border-[#4eba87] bg-[#4eba87]/12 px-4 py-2 text-xs font-medium text-[#4eba87] transition hover:bg-[#4eba87]/18"
                >
                  Try again
                </button>
              </div>
            ) : null}
          </div>
        </div>

        <ColumnPlaceholder
          testId="inspector-bootstrap-right"
          heading="Code"
          copy={copy.right}
        />
      </main>
    </div>
  );
}
