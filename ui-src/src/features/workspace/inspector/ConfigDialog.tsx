import { useEffect, useId, useRef, type JSX, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";

interface ConfigDialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children?: ReactNode;
}

export function ConfigDialog({ open, onClose, title, children }: ConfigDialogProps): JSX.Element | null {
  const backdropRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const titleId = useId();

  useEffect(() => {
    if (!open || typeof document === "undefined") {
      return undefined;
    }

    restoreFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const frame = window.requestAnimationFrame(() => {
      closeButtonRef.current?.focus();
    });

    return () => {
      window.cancelAnimationFrame(frame);
      const elementToRestore = restoreFocusRef.current;
      restoreFocusRef.current = null;
      if (elementToRestore && elementToRestore.isConnected) {
        elementToRestore.focus();
      }
    };
  }, [open]);

  if (!open) {
    return null;
  }

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onClose();
      return;
    }

    if (event.key !== "Tab" || !backdropRef.current) {
      return;
    }

    const focusable = backdropRef.current.querySelectorAll<HTMLElement>(
      "button, [href], input, select, textarea, [tabindex]:not([tabindex=\"-1\"])"
    );
    if (focusable.length === 0) {
      event.preventDefault();
      return;
    }

    const first = focusable[0]!;
    const last = focusable[focusable.length - 1]!;

    if (event.shiftKey) {
      if (document.activeElement === first) {
        event.preventDefault();
        last.focus();
      }
      return;
    }

    if (document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <div
      ref={backdropRef}
      data-testid="config-dialog-overlay"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={(event) => {
        if (event.target === backdropRef.current) {
          onClose();
        }
      }}
      onKeyDown={handleKeyDown}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
    >
      <div
        data-testid="config-dialog-panel"
        className="relative flex max-h-[80vh] w-full max-w-2xl flex-col rounded-xl border border-slate-200 bg-white shadow-2xl"
      >
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between border-b border-slate-200 px-5 py-3">
          <h3 id={titleId} className="m-0 text-sm font-semibold text-slate-900">{title}</h3>
          <button
            ref={closeButtonRef}
            type="button"
            data-testid="config-dialog-close"
            onClick={onClose}
            className="flex size-7 cursor-pointer items-center justify-center rounded-md border-0 bg-transparent text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
            aria-label="Close dialog"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="size-4">
              <path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {children}
        </div>
      </div>
    </div>
  );
}
