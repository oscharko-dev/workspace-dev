interface RuntimeErrorPayload {
  componentStack?: string;
  href: string;
  message: string;
  name: string;
  source: "caught" | "uncaught";
  timestamp: string;
}

const reportedErrors = new Set<Error>();
const reportedUnknowns = new Set<string>();

const toPayload = ({
  source,
  error,
  componentStack
}: {
  source: "caught" | "uncaught";
  error: unknown;
  componentStack?: string;
}): RuntimeErrorPayload => {
  if (error instanceof Error) {
    return {
      componentStack,
      href: window.location.href,
      message: error.message,
      name: error.name,
      source,
      timestamp: new Date().toISOString()
    };
  }

  return {
    componentStack,
    href: window.location.href,
    message: String(error),
    name: "UnknownRuntimeError",
    source,
    timestamp: new Date().toISOString()
  };
};

const hasBeenReported = ({
  error,
  source,
  componentStack
}: {
  error: unknown;
  source: "caught" | "uncaught";
  componentStack?: string;
}): boolean => {
  if (error instanceof Error) {
    if (reportedErrors.has(error)) {
      return true;
    }
    reportedErrors.add(error);
    return false;
  }

  const fingerprint = `${source}:${String(error)}:${componentStack ?? ""}`;
  if (reportedUnknowns.has(fingerprint)) {
    return true;
  }
  reportedUnknowns.add(fingerprint);
  return false;
};

export const resetRuntimeErrorReportingForTests = (): void => {
  reportedErrors.clear();
  reportedUnknowns.clear();
};

export const reportRuntimeError = ({
  source,
  error,
  componentStack
}: {
  source: "caught" | "uncaught";
  error: unknown;
  componentStack?: string;
}): void => {
  if (hasBeenReported({ error, source, componentStack })) {
    return;
  }

  const payload = toPayload({ source, error, componentStack });
  if (error instanceof Error) {
    console.error("[runtime-error]", payload, error);
    return;
  }
  console.error("[runtime-error]", payload);
};

interface RootErrorHandlers {
  onCaughtError: (error: unknown, errorInfo: { componentStack?: string }) => void;
  onUncaughtError: (error: unknown, errorInfo: { componentStack?: string }) => void;
}

export const createRootErrorHandlers = (): RootErrorHandlers => {
  return {
    onCaughtError: (error: unknown, errorInfo: { componentStack?: string }) => {
      reportRuntimeError({
        source: "caught",
        error,
        componentStack: errorInfo.componentStack
      });
    },
    onUncaughtError: (error: unknown, errorInfo: { componentStack?: string }) => {
      reportRuntimeError({
        source: "uncaught",
        error,
        componentStack: errorInfo.componentStack
      });
    }
  };
};
