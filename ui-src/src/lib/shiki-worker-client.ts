import { highlightCode, type HighlightResult, type HighlightTheme } from "./shiki";
import type { HighlightWorkerResponseMessage } from "./shiki-worker-protocol";

interface HighlightWorkerClientRequest {
  code: string;
  filePath: string;
  theme: HighlightTheme;
  signal?: AbortSignal;
}

interface PendingRequest {
  resolve: (result: HighlightResult | null) => void;
  reject: (error: unknown) => void;
  removeAbortListener: () => void;
}

let workerInstance: Worker | null = null;
let workerDisabled = false;
let nextRequestId = 1;
const pendingRequests = new Map<number, PendingRequest>();

function createAbortError(): DOMException {
  return new DOMException("Highlight request aborted.", "AbortError");
}

export function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

function settlePendingRequest({
  requestId,
  settle
}: {
  requestId: number;
  settle: (pendingRequest: PendingRequest) => void;
}): void {
  const pendingRequest = pendingRequests.get(requestId);
  if (!pendingRequest) {
    return;
  }
  pendingRequests.delete(requestId);
  pendingRequest.removeAbortListener();
  settle(pendingRequest);
}

function teardownWorkerAndRejectPending(error: Error): void {
  if (workerInstance) {
    workerInstance.onmessage = null;
    workerInstance.onerror = null;
    workerInstance.terminate();
    workerInstance = null;
  }
  workerDisabled = true;

  for (const [requestId, pendingRequest] of pendingRequests.entries()) {
    pendingRequests.delete(requestId);
    pendingRequest.removeAbortListener();
    pendingRequest.reject(error);
  }
}

function handleWorkerMessage(event: MessageEvent<HighlightWorkerResponseMessage>): void {
  const message = event.data;

  if (message.type === "result") {
    settlePendingRequest({
      requestId: message.requestId,
      settle: (pendingRequest) => {
        pendingRequest.resolve(message.result);
      }
    });
    return;
  }

  settlePendingRequest({
    requestId: message.requestId,
    settle: (pendingRequest) => {
      pendingRequest.reject(new Error(message.errorMessage || "Unknown highlight worker failure."));
    }
  });
}

function ensureWorker(): Worker | null {
  if (workerDisabled) {
    return null;
  }
  if (typeof Worker === "undefined") {
    return null;
  }
  if (workerInstance) {
    return workerInstance;
  }

  try {
    const createdWorker = new Worker(new URL("./shiki-highlight.worker.ts", import.meta.url), { type: "module" });
    createdWorker.onmessage = handleWorkerMessage;
    createdWorker.onerror = () => {
      teardownWorkerAndRejectPending(new Error("Shiki highlight worker encountered a runtime error."));
    };
    workerInstance = createdWorker;
    return createdWorker;
  } catch {
    workerDisabled = true;
    return null;
  }
}

async function requestWorkerHighlight({
  code,
  filePath,
  theme,
  signal
}: HighlightWorkerClientRequest): Promise<HighlightResult | null> {
  if (signal?.aborted) {
    throw createAbortError();
  }

  const worker = ensureWorker();
  if (!worker) {
    throw new Error("Highlight worker unavailable.");
  }

  const requestId = nextRequestId;
  nextRequestId += 1;

  return await new Promise<HighlightResult | null>((resolve, reject) => {
    const onAbort = (): void => {
      settlePendingRequest({
        requestId,
        settle: (pendingRequest) => {
          pendingRequest.reject(createAbortError());
        }
      });
      worker.postMessage({
        type: "cancel",
        requestId
      });
    };

    if (signal) {
      signal.addEventListener("abort", onAbort, { once: true });
    }

    pendingRequests.set(requestId, {
      resolve,
      reject,
      removeAbortListener: () => {
        if (signal) {
          signal.removeEventListener("abort", onAbort);
        }
      }
    });

    worker.postMessage({
      type: "highlight",
      requestId,
      code,
      filePath,
      theme
    });
  });
}

export async function highlightCodeWithWorker({
  code,
  filePath,
  theme,
  signal
}: HighlightWorkerClientRequest): Promise<HighlightResult | null> {
  try {
    return await requestWorkerHighlight({ code, filePath, theme, signal });
  } catch (error) {
    if (isAbortError(error)) {
      throw error;
    }
    return await highlightCode(code, filePath, theme);
  }
}

export function resetHighlightWorkerForTests(): void {
  if (workerInstance) {
    workerInstance.terminate();
    workerInstance = null;
  }
  workerDisabled = false;
  nextRequestId = 1;
  pendingRequests.clear();
}
