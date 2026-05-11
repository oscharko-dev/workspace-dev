import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";

import { expectNoBlockingAccessibilityViolations } from "../../../../test/accessibility";
import { ProgressTimeline } from "./ProgressTimeline";
import { TIMELINE_PHASES } from "./progress-timeline-model";

interface FakeListener {
  (event: MessageEvent<string>): void;
}

class FakeEventSource {
  url: string;
  closed = false;
  private messageListeners = new Set<FakeListener>();
  private errorListeners = new Set<() => void>();
  constructor(url: string) {
    this.url = url;
  }
  addEventListener(name: string, listener: unknown): void {
    if (name === "message") {
      this.messageListeners.add(listener as FakeListener);
    } else if (name === "error") {
      this.errorListeners.add(listener as () => void);
    }
  }
  removeEventListener(name: string, listener: unknown): void {
    if (name === "message") {
      this.messageListeners.delete(listener as FakeListener);
    } else if (name === "error") {
      this.errorListeners.delete(listener as () => void);
    }
  }
  close(): void {
    this.closed = true;
  }
  emit(payload: unknown): void {
    const data = JSON.stringify(payload);
    const event = new MessageEvent("message", { data });
    for (const l of this.messageListeners) l(event);
  }
  emitError(): void {
    for (const l of this.errorListeners) l();
  }
}

afterEach(() => {
  cleanup();
});

describe("ProgressTimeline", () => {
  it("renders one row per logical phase, all initially pending", () => {
    let _opened: FakeEventSource | null = null;
    render(
      <ProgressTimeline
        jobId="job-A"
        eventSourceFactory={(url) => {
          const src = new FakeEventSource(url);
          _opened = src;
          return src as unknown as EventSource;
        }}
      />,
    );
    expect(_opened !== null).toBe(true);
    for (const phase of TIMELINE_PHASES) {
      const row = screen.getByTestId(`ti-progress-timeline-row-${phase}`);
      expect(row.getAttribute("data-status")).toBe("pending");
    }
  });

  it("transitions a row to running, then complete, on incoming events", () => {
    let opened: FakeEventSource | null = null;
    render(
      <ProgressTimeline
        jobId="job-B"
        eventSourceFactory={(url) => {
          const src = new FakeEventSource(url);
          opened = src;
          return src as unknown as EventSource;
        }}
      />,
    );
    const source = opened as FakeEventSource | null;
    expect(source !== null).toBe(true);
    act(() => {
      source!.emit({ phase: "intent_derivation_started", timestamp: 1000 });
    });
    expect(
      screen
        .getByTestId("ti-progress-timeline-row-intent")
        .getAttribute("data-status"),
    ).toBe("running");
    act(() => {
      source!.emit({ phase: "intent_derivation_complete", timestamp: 2500 });
    });
    expect(
      screen
        .getByTestId("ti-progress-timeline-row-intent")
        .getAttribute("data-status"),
    ).toBe("complete");
  });

  it("ignores malformed messages instead of throwing", () => {
    let opened: FakeEventSource | null = null;
    render(
      <ProgressTimeline
        jobId="job-C"
        eventSourceFactory={(url) => {
          const src = new FakeEventSource(url);
          opened = src;
          return src as unknown as EventSource;
        }}
      />,
    );
    const source = opened as FakeEventSource | null;
    expect(source !== null).toBe(true);
    expect(() => {
      act(() => {
        source!.emit({ totally: "wrong shape" });
      });
    }).not.toThrow();
  });

  it("exposes a polite live region announcing the current state", () => {
    let opened: FakeEventSource | null = null;
    render(
      <ProgressTimeline
        jobId="job-D"
        eventSourceFactory={(url) => {
          const src = new FakeEventSource(url);
          opened = src;
          return src as unknown as EventSource;
        }}
      />,
    );
    const source = opened as FakeEventSource | null;
    act(() => {
      source!.emit({ phase: "validation_started", timestamp: 100 });
    });
    const live = screen.getByTestId("ti-progress-timeline-live");
    expect(live.getAttribute("aria-live")).toBe("polite");
    expect(live.textContent).toContain("Validate test cases");
  });

  it("shows an inline error when the stream fires an error event", () => {
    let opened: FakeEventSource | null = null;
    render(
      <ProgressTimeline
        jobId="job-E"
        eventSourceFactory={(url) => {
          const src = new FakeEventSource(url);
          opened = src;
          return src as unknown as EventSource;
        }}
      />,
    );
    const source = opened as FakeEventSource | null;
    act(() => {
      source!.emitError();
    });
    expect(
      screen.getByTestId("ti-progress-timeline-error").textContent,
    ).toContain("interrupted");
  });

  it("closes the stream on unmount", () => {
    let opened: FakeEventSource | null = null;
    const { unmount } = render(
      <ProgressTimeline
        jobId="job-F"
        eventSourceFactory={(url) => {
          const src = new FakeEventSource(url);
          opened = src;
          return src as unknown as EventSource;
        }}
      />,
    );
    unmount();
    const source = opened as FakeEventSource | null;
    expect(source !== null && source.closed).toBe(true);
  });

  it("passes axe accessibility audit", async () => {
    const { container } = render(
      <ProgressTimeline
        jobId="job-G"
        eventSourceFactory={(url) =>
          new FakeEventSource(url) as unknown as EventSource
        }
      />,
    );
    await expectNoBlockingAccessibilityViolations(container);
  });
});
