// ---------------------------------------------------------------------------
// Import Review Stepper (#994)
//
// Pure presentational 4-stage stepper (Import → Review → Approve → Apply).
// The parent owns review-state + governance wiring; this component only
// renders pills + stage-specific controls and forwards intent via callbacks.
// ---------------------------------------------------------------------------

import type { JSX, ReactNode } from "react";
import type {
  ApplyGate,
  ImportReviewStage,
  ImportReviewState,
} from "./import-review-state";

export interface ImportReviewStepperProps {
  readonly state: ImportReviewState;
  readonly gate: ApplyGate;
  readonly onAdvance: (target: ImportReviewStage) => void;
  readonly onReviewerNoteChange: (note: string) => void;
  readonly onApply: () => void;
  readonly disabled?: boolean;
  readonly children?: ReactNode;
}

interface StageDescriptor {
  readonly id: ImportReviewStage;
  readonly label: string;
}

const STAGES: readonly StageDescriptor[] = [
  { id: "import", label: "Import" },
  { id: "review", label: "Review" },
  { id: "approve", label: "Approve" },
  { id: "apply", label: "Apply" },
];

function stageIndex(stage: ImportReviewStage): number {
  return STAGES.findIndex((s) => s.id === stage);
}

function pillClassName(kind: "current" | "completed" | "future"): string {
  if (kind === "current") {
    return "cursor-default rounded border border-[#4eba87]/60 bg-[#4eba87]/10 px-2 py-0.5 text-[11px] font-semibold text-[#4eba87]";
  }
  if (kind === "completed") {
    return "cursor-pointer rounded border border-[#4eba87]/40 bg-[#4eba87]/20 px-2 py-0.5 text-[11px] font-semibold text-[#4eba87] transition hover:border-[#4eba87]/70 hover:bg-[#4eba87]/30";
  }
  return "cursor-default rounded border border-[#333333] bg-transparent px-2 py-0.5 text-[11px] font-medium text-white/35";
}

function pillIndicator(kind: "current" | "completed" | "future"): string {
  if (kind === "completed") return "✓";
  if (kind === "current") return "●";
  return "○";
}

export function ImportReviewStepper({
  state,
  gate,
  onAdvance,
  onReviewerNoteChange,
  onApply,
  disabled = false,
  children,
}: ImportReviewStepperProps): JSX.Element {
  const currentIndex = stageIndex(state.stage);
  const previousStage =
    currentIndex > 0 ? STAGES[currentIndex - 1]?.id : undefined;
  const canShowBack =
    !disabled && (state.stage === "review" || state.stage === "approve");

  const showGateReason =
    state.stage === "approve" &&
    gate.requiresNote &&
    state.reviewerNote.trim().length === 0 &&
    gate.reason !== null;

  return (
    <section
      data-testid="import-review-stepper"
      role="region"
      aria-label="Import review stepper"
      className="flex flex-col gap-2 border-b border-[#333333] bg-[#1d1d1d] px-3 py-2 text-white/65"
    >
      <div className="flex items-center gap-1.5">
        {STAGES.map((pill, index) => {
          const kind: "current" | "completed" | "future" =
            index === currentIndex
              ? "current"
              : index < currentIndex
                ? "completed"
                : "future";
          const clickable = kind === "completed" && !disabled;
          return (
            <button
              key={pill.id}
              type="button"
              data-testid={`import-review-stepper-pill-${pill.id}`}
              disabled={!clickable}
              aria-current={kind === "current" ? "step" : undefined}
              onClick={
                clickable
                  ? () => {
                      onAdvance(pill.id);
                    }
                  : undefined
              }
              className={pillClassName(kind)}
            >
              <span aria-hidden="true" className="mr-1">
                {pillIndicator(kind)}
              </span>
              {pill.label}
            </button>
          );
        })}
      </div>

      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          {state.stage === "import" ? (
            <span className="text-[11px] text-white/45">
              Review the import when you're ready.
            </span>
          ) : null}
          {state.stage === "review" ? (children ?? null) : null}
          {state.stage === "approve" ? (
            <label className="flex flex-col gap-1 text-[10px] font-medium uppercase tracking-wider text-white/45">
              Reviewer note (required to override gate)
              <textarea
                data-testid="import-review-stepper-note"
                value={state.reviewerNote}
                disabled={disabled}
                onChange={(event) => {
                  onReviewerNoteChange(event.target.value);
                }}
                rows={2}
                className="resize-y rounded border border-[#333333] bg-[#000000] px-2 py-1 text-[11px] font-normal normal-case tracking-normal text-white/80 outline-none transition focus:border-[#4eba87]/40 disabled:cursor-default disabled:opacity-40"
              />
              {showGateReason ? (
                <span
                  data-testid="import-review-stepper-gate-reason"
                  className="text-[10px] font-normal normal-case tracking-normal text-amber-300/70"
                >
                  {gate.reason}
                </span>
              ) : null}
            </label>
          ) : null}
          {state.stage === "apply" ? (
            <span className="flex items-center gap-1 text-[11px] font-semibold text-[#4eba87]">
              <span aria-hidden="true">✓</span>
              Applied
            </span>
          ) : null}
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          {canShowBack && previousStage !== undefined ? (
            <button
              type="button"
              data-testid="import-review-stepper-back"
              onClick={() => {
                onAdvance(previousStage);
              }}
              className="cursor-pointer rounded border border-[#333333] bg-transparent px-2 py-0.5 text-[11px] font-medium text-white/65 transition hover:border-white/20 hover:text-white/80"
            >
              Back
            </button>
          ) : null}
          {state.stage === "import" ? (
            <button
              type="button"
              data-testid="import-review-stepper-primary"
              disabled={disabled}
              onClick={() => {
                onAdvance("review");
              }}
              className="cursor-pointer rounded border border-[#4eba87]/40 bg-transparent px-2 py-0.5 text-[11px] font-semibold text-[#4eba87] transition hover:bg-[#4eba87]/10 disabled:cursor-default disabled:opacity-40"
            >
              Start review
            </button>
          ) : null}
          {state.stage === "review" ? (
            <button
              type="button"
              data-testid="import-review-stepper-primary"
              disabled={disabled}
              onClick={() => {
                onAdvance("approve");
              }}
              className="cursor-pointer rounded border border-[#4eba87]/40 bg-transparent px-2 py-0.5 text-[11px] font-semibold text-[#4eba87] transition hover:bg-[#4eba87]/10 disabled:cursor-default disabled:opacity-40"
            >
              Approve
            </button>
          ) : null}
          {state.stage === "approve" ? (
            <button
              type="button"
              data-testid="import-review-stepper-primary"
              disabled={disabled}
              title={gate.reason ?? undefined}
              onClick={() => {
                onApply();
              }}
              className="cursor-pointer rounded border border-[#4eba87]/40 bg-[#4eba87]/10 px-2 py-0.5 text-[11px] font-semibold text-[#4eba87] transition hover:bg-[#4eba87]/20 disabled:cursor-default disabled:opacity-40"
            >
              Apply
            </button>
          ) : null}
        </div>
      </div>
    </section>
  );
}
