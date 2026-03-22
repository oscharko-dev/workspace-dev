import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HighlightResult } from "./shiki";
import {
  highlightCodeWithWorker,
  isAbortError,
  resetHighlightWorkerForTests
} from "./shiki-worker-client";
import * as shikiLib from "./shiki";

vi.mock("./shiki", () => ({
  highlightCode: vi.fn()
}));

const mockHighlightCode = vi.mocked(shikiLib.highlightCode);

class MockWorker {
  public onmessage: ((event: MessageEvent<unknown>) => void) | null = null;
  public onerror: ((event: Event) => void) | null = null;
  public readonly postedMessages: unknown[] = [];
  public terminate = vi.fn();

  public postMessage = (message: unknown): void => {
    this.postedMessages.push(message);
  };

  public emitMessage(message: unknown): void {
    this.onmessage?.({ data: message } as MessageEvent<unknown>);
  }
}

const originalWorker = globalThis.Worker;
let workerCtorSpy: ReturnType<typeof vi.fn> | null = null;
let createdWorkers: MockWorker[] = [];

function installMockWorker(): void {
  createdWorkers = [];
  workerCtorSpy = vi.fn(function WorkerCtor() {
    const worker = new MockWorker();
    createdWorkers.push(worker);
    return worker as unknown as Worker;
  });

  Object.defineProperty(globalThis, "Worker", {
    configurable: true,
    writable: true,
    value: workerCtorSpy
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  resetHighlightWorkerForTests();
  mockHighlightCode.mockResolvedValue(null);
  installMockWorker();
});

afterEach(() => {
  resetHighlightWorkerForTests();
  Object.defineProperty(globalThis, "Worker", {
    configurable: true,
    writable: true,
    value: originalWorker
  });
});

describe("shiki-worker-client", () => {
  it("uses worker highlighting path when a worker is available", async () => {
    const expectedResult: HighlightResult = {
      html: "<pre><code><span class='line'>worker</span></code></pre>",
      theme: "github-light"
    };

    const promise = highlightCodeWithWorker({
      code: "const worker = true;",
      filePath: "src/worker.tsx",
      theme: "github-light"
    });

    expect(createdWorkers).toHaveLength(1);
    const worker = createdWorkers[0];
    expect(worker).toBeDefined();

    const postedHighlight = worker!.postedMessages[0] as { type?: string; requestId?: number } | undefined;
    expect(postedHighlight?.type).toBe("highlight");
    expect(typeof postedHighlight?.requestId).toBe("number");

    worker!.emitMessage({
      type: "result",
      requestId: postedHighlight?.requestId,
      result: expectedResult
    });

    await expect(promise).resolves.toEqual(expectedResult);
    expect(mockHighlightCode).not.toHaveBeenCalled();
  });

  it("posts cancel messages and rejects with AbortError when aborted", async () => {
    const abortController = new AbortController();

    const promise = highlightCodeWithWorker({
      code: "const abortable = true;",
      filePath: "src/abort.tsx",
      theme: "github-light",
      signal: abortController.signal
    });

    const worker = createdWorkers[0];
    expect(worker).toBeDefined();
    const postedHighlight = worker!.postedMessages[0] as { type?: string; requestId?: number } | undefined;
    expect(postedHighlight?.type).toBe("highlight");

    abortController.abort();

    await expect(promise).rejects.toSatisfy((error: unknown) => isAbortError(error));
    expect(worker!.postedMessages).toContainEqual({
      type: "cancel",
      requestId: postedHighlight?.requestId
    });
    expect(mockHighlightCode).not.toHaveBeenCalled();
  });

  it("falls back to direct highlight when worker is unavailable", async () => {
    Object.defineProperty(globalThis, "Worker", {
      configurable: true,
      writable: true,
      value: undefined
    });
    resetHighlightWorkerForTests();

    const fallbackResult: HighlightResult = {
      html: "<pre><code><span class='line'>fallback</span></code></pre>",
      theme: "github-dark"
    };
    mockHighlightCode.mockResolvedValueOnce(fallbackResult);

    await expect(
      highlightCodeWithWorker({
        code: "const fallback = true;",
        filePath: "src/fallback.ts",
        theme: "github-dark"
      })
    ).resolves.toEqual(fallbackResult);

    expect(mockHighlightCode).toHaveBeenCalledWith("const fallback = true;", "src/fallback.ts", "github-dark");
  });

  it("falls back to direct highlight when worker request returns an error", async () => {
    const fallbackResult: HighlightResult = {
      html: "<pre><code><span class='line'>fallback-after-worker-error</span></code></pre>",
      theme: "github-light"
    };
    mockHighlightCode.mockResolvedValueOnce(fallbackResult);

    const promise = highlightCodeWithWorker({
      code: "const unstableWorker = true;",
      filePath: "src/unstable.tsx",
      theme: "github-light"
    });

    const worker = createdWorkers[0];
    expect(worker).toBeDefined();
    const postedHighlight = worker!.postedMessages[0] as { requestId?: number } | undefined;
    worker!.emitMessage({
      type: "error",
      requestId: postedHighlight?.requestId,
      errorMessage: "worker-failure"
    });

    await expect(promise).resolves.toEqual(fallbackResult);
    expect(mockHighlightCode).toHaveBeenCalledWith("const unstableWorker = true;", "src/unstable.tsx", "github-light");
  });
});
