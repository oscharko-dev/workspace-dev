// ---------------------------------------------------------------------------
// React hook wrapping the paste-import-history module (Issue #1010).
//
// Seeds state from localStorage on mount, forwards mutations to the pure
// helpers, and persists the resulting history as a side-effect. Storage
// errors surface as `warning` so the UI can render a banner while the
// in-memory history continues to work.
// ---------------------------------------------------------------------------
import { useCallback, useEffect, useState } from "react";
import {
  addImportSession,
  createEmptyImportHistory,
  findPreviousImport,
  persistImportHistory,
  removeImportSession,
  restoreImportHistory,
  type FindPreviousImportQuery,
  type PasteImportHistory,
  type PasteImportSession,
} from "./paste-import-history";

export interface UseImportHistoryResult {
  history: PasteImportHistory;
  warning: string | null;
  addSession: (session: PasteImportSession) => void;
  removeSession: (sessionId: string) => void;
  findPrevious: (query: FindPreviousImportQuery) => PasteImportSession | null;
}

export function useImportHistory(): UseImportHistoryResult {
  const [history, setHistory] = useState<PasteImportHistory>(
    createEmptyImportHistory,
  );
  const [warning, setWarning] = useState<string | null>(null);

  useEffect(() => {
    // Restoring on mount (rather than via a lazy `useState` initializer) keeps
    // `restoreImportHistory()` out of the render path — required because the
    // function touches `window.localStorage` and must not run during SSR or
    // the initial client render.
    const restored = restoreImportHistory();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- seeding external (localStorage) state on mount
    setHistory(restored.history);
    setWarning(restored.warning);
  }, []);

  const addSession = useCallback((session: PasteImportSession): void => {
    setHistory((current) => {
      const next = addImportSession(current, session);
      const result = persistImportHistory(next);
      setWarning(result.ok ? null : result.error);
      return next;
    });
  }, []);

  const removeSession = useCallback((sessionId: string): void => {
    setHistory((current) => {
      const next = removeImportSession(current, sessionId);
      if (next === current) {
        return current;
      }
      const result = persistImportHistory(next);
      setWarning(result.ok ? null : result.error);
      return next;
    });
  }, []);

  const findPrevious = useCallback(
    (query: FindPreviousImportQuery): PasteImportSession | null =>
      findPreviousImport(history, query),
    [history],
  );

  return { history, warning, addSession, removeSession, findPrevious };
}
