// ---------------------------------------------------------------------------
// Safe storage helpers for the Test Intelligence Inspector (Issue #1367 follow-up)
//
// `localStorage` and `sessionStorage` are the only persistence the page
// touches. Both helpers swallow Storage errors so the UI keeps working
// when storage is unavailable (private browsing, ITP, disabled cookies).
//
// Lives in its own module so the React-refresh lint can keep page files
// component-only, and so unit tests can spy on the helpers without
// re-rendering the entire Inspector tree.
// ---------------------------------------------------------------------------

export type StorageScope = "local" | "session";

const resolveStore = (scope: StorageScope): Storage =>
  scope === "session" ? window.sessionStorage : window.localStorage;

/**
 * Read a string from the requested storage scope. Returns the empty string
 * when the key is missing or storage access throws.
 */
export const safeReadStorage = (
  key: string,
  scope: StorageScope = "local",
): string => {
  try {
    return resolveStore(scope).getItem(key) ?? "";
  } catch {
    return "";
  }
};

/**
 * Write a string to the requested storage scope. Empty values clear the key.
 * Errors are swallowed because air-gapped contexts and locked-down browsers
 * disable storage and the UI must remain functional with in-memory state.
 */
export const safeWriteStorage = (
  key: string,
  value: string,
  scope: StorageScope = "local",
): void => {
  try {
    const store = resolveStore(scope);
    if (value.length === 0) {
      store.removeItem(key);
      return;
    }
    store.setItem(key, value);
  } catch {
    // Storage may be unavailable; non-fatal.
  }
};
