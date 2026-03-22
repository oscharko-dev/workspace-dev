import { highlightCode } from "./shiki";
import type {
  HighlightWorkerRequestMessage,
  HighlightWorkerResponseMessage
} from "./shiki-worker-protocol";

type WorkerScope = {
  addEventListener: (
    type: "message",
    listener: (event: MessageEvent<HighlightWorkerRequestMessage>) => void
  ) => void;
  postMessage: (message: HighlightWorkerResponseMessage) => void;
};

const workerScope = self as unknown as WorkerScope;
const cancelledRequestIds = new Set<number>();

workerScope.addEventListener("message", (event) => {
  const message = event.data;
  if (!message || typeof message !== "object" || !("type" in message)) {
    return;
  }

  if (message.type === "cancel") {
    cancelledRequestIds.add(message.requestId);
    return;
  }

  void (async () => {
    const { requestId, code, filePath, theme } = message;
    if (cancelledRequestIds.delete(requestId)) {
      return;
    }

    try {
      const result = await highlightCode(code, filePath, theme);
      if (cancelledRequestIds.delete(requestId)) {
        return;
      }

      workerScope.postMessage({
        type: "result",
        requestId,
        result
      });
    } catch (error) {
      if (cancelledRequestIds.delete(requestId)) {
        return;
      }
      workerScope.postMessage({
        type: "error",
        requestId,
        errorMessage: error instanceof Error ? error.message : "Unknown highlight worker error"
      });
    }
  })();
});
