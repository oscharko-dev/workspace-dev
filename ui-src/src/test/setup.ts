import "@testing-library/jest-dom/vitest";

// Node 25 ships an experimental built-in `localStorage` that returns a plain
// empty object when `--localstorage-file` is not provided. That shim replaces
// the jsdom-provided `window.localStorage`, breaking every test that relies on
// real Storage semantics. Detect the broken shim and install a functional
// implementation backed by jsdom's native `Storage` constructor so tests that
// call `vi.spyOn(Storage.prototype, "setItem")` continue to intercept writes.
if (typeof window !== "undefined") {
  const rawLocalStorage = window.localStorage as unknown as {
    setItem?: unknown;
  } | null;
  const isBroken =
    rawLocalStorage === null || typeof rawLocalStorage.setItem !== "function";

  if (isBroken) {
    const StorageCtor = (window as unknown as { Storage?: unknown }).Storage;
    if (typeof StorageCtor !== "function") {
      throw new Error(
        "Cannot shim localStorage: jsdom Storage constructor is unavailable.",
      );
    }
    const storageProto = (StorageCtor as { prototype: object }).prototype;
    const backingStores = new WeakMap<object, Map<string, string>>();
    const getStore = (instance: object): Map<string, string> => {
      let store = backingStores.get(instance);
      if (store === undefined) {
        store = new Map<string, string>();
        backingStores.set(instance, store);
      }
      return store;
    };

    Object.defineProperties(storageProto, {
      getItem: {
        configurable: true,
        writable: true,
        value(this: object, key: string): string | null {
          const value = getStore(this).get(key);
          return value === undefined ? null : value;
        },
      },
      setItem: {
        configurable: true,
        writable: true,
        value(this: object, key: string, value: string): void {
          getStore(this).set(key, value);
        },
      },
      removeItem: {
        configurable: true,
        writable: true,
        value(this: object, key: string): void {
          getStore(this).delete(key);
        },
      },
      clear: {
        configurable: true,
        writable: true,
        value(this: object): void {
          getStore(this).clear();
        },
      },
      key: {
        configurable: true,
        writable: true,
        value(this: object, index: number): string | null {
          return [...getStore(this).keys()][index] ?? null;
        },
      },
      length: {
        configurable: true,
        get(this: object): number {
          return getStore(this).size;
        },
      },
    });

    const localStorageInstance = Object.create(storageProto) as Storage;
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: localStorageInstance,
    });
    const sessionStorageInstance = Object.create(storageProto) as Storage;
    Object.defineProperty(window, "sessionStorage", {
      configurable: true,
      value: sessionStorageInstance,
    });
  }
}
