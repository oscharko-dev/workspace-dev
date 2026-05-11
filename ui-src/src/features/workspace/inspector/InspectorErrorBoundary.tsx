import { Component, type ErrorInfo, type ReactNode } from "react";

interface InspectorErrorBoundaryProps {
  children: ReactNode;
  onRetry?: () => void;
}

interface InspectorErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export class InspectorErrorBoundary extends Component<
  InspectorErrorBoundaryProps,
  InspectorErrorBoundaryState
> {
  constructor(props: InspectorErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): InspectorErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("[InspectorErrorBoundary] Caught error:", error, info.componentStack);
  }

  private readonly handleRetry = (): void => {
    this.setState({ hasError: false, error: null });
    this.props.onRetry?.();
  };

  render(): ReactNode {
    if (!this.state.hasError) {
      return this.props.children;
    }

    return (
      <div
        role="alert"
        className="flex h-full flex-col items-center justify-center gap-4 bg-[#111111] p-8 text-center"
      >
        <div className="rounded-lg border border-rose-500/30 bg-rose-950/20 px-6 py-5">
          <h2 className="m-0 text-base font-semibold text-rose-200">
            Inspector encountered an error
          </h2>
          <p className="mt-2 text-sm text-white/55">
            An unexpected error occurred while rendering the Inspector.
          </p>
          {this.state.error ? (
            <pre className="mt-3 max-h-24 overflow-auto rounded bg-[#000000]/50 p-2 text-left text-[11px] text-rose-300/80">
              {this.state.error.message}
            </pre>
          ) : null}
          <button
            type="button"
            onClick={this.handleRetry}
            className="mt-4 cursor-pointer rounded border border-[#4eba87] bg-[#4eba87]/12 px-4 py-2 text-sm font-medium text-[#4eba87] transition hover:bg-[#4eba87]/18"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }
}
