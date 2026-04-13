import { useState, type JSX } from "react";
import type { ImportIntent } from "./paste-input-classifier";

export interface SmartBannerProps {
  intent: ImportIntent;
  confidence: number;
  onConfirm: (intent: ImportIntent) => void;
  onDismiss: () => void;
}

const INTENT_LABELS: Record<ImportIntent, string> = {
  FIGMA_JSON_NODE_BATCH: "Figma-Node JSON",
  FIGMA_JSON_DOC: "Figma-Dokument JSON",
  RAW_CODE_OR_TEXT: "Code / Text",
  UNKNOWN: "Unbekannt",
};

const ALL_INTENTS: readonly ImportIntent[] = [
  "FIGMA_JSON_NODE_BATCH",
  "FIGMA_JSON_DOC",
  "RAW_CODE_OR_TEXT",
  "UNKNOWN",
];

export function SmartBanner({
  intent,
  confidence,
  onConfirm,
  onDismiss,
}: SmartBannerProps): JSX.Element {
  const [selected, setSelected] = useState<ImportIntent>(intent);

  const confidencePct = Math.round(confidence * 100);

  return (
    <div
      data-testid="smart-banner"
      className="flex w-full items-center gap-3 border-b border-[#000000] bg-[#171717] px-4 py-2"
    >
      <div className="size-2 shrink-0 rounded-full bg-[#4eba87]" />

      <div className="flex min-w-0 flex-1 items-center gap-2">
        <span className="shrink-0 text-xs font-medium text-white/85">
          Erkannter Typ:
        </span>
        <span className="shrink-0 text-xs font-semibold text-white">
          {INTENT_LABELS[selected]}
        </span>
        <span className="rounded border border-[#000000] bg-[#222222] px-1.5 py-0.5 text-[10px] font-mono text-white/45">
          {confidencePct}%
        </span>
      </div>

      <select
        value={selected}
        onChange={(e) => {
          setSelected(e.target.value as ImportIntent);
        }}
        className="shrink-0 cursor-pointer rounded border border-[#000000] bg-[#222222] px-2 py-1 text-[11px] text-white/85 focus:outline-none focus:ring-1 focus:ring-[#4eba87]/60"
        aria-label="Erkannten Typ korrigieren"
      >
        {ALL_INTENTS.map((intentOption) => (
          <option key={intentOption} value={intentOption}>
            {INTENT_LABELS[intentOption]}
          </option>
        ))}
      </select>

      <button
        type="button"
        onClick={() => {
          onConfirm(selected);
        }}
        className="shrink-0 cursor-pointer rounded border border-[#4eba87] bg-[#4eba87]/12 px-4 py-1.5 text-xs font-medium text-[#4eba87] transition hover:bg-[#4eba87]/18"
      >
        Import starten
      </button>

      <button
        type="button"
        onClick={onDismiss}
        aria-label="Banner schliessen"
        className="shrink-0 cursor-pointer rounded border border-transparent px-2 py-1 text-xs font-medium text-white/45 transition hover:border-[#000000] hover:bg-[#222222] hover:text-white/85"
      >
        &times;
      </button>
    </div>
  );
}
