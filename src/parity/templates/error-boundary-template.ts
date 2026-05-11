// ---------------------------------------------------------------------------
// error-boundary-template.ts — ErrorBoundary and ScreenSkeleton components
// Extracted from generator-templates.ts (issue #298)
// ---------------------------------------------------------------------------
import type { GeneratedFile } from "../types.js";

export const makeErrorBoundaryFile = (): GeneratedFile => {
  return {
    path: "src/components/ErrorBoundary.tsx",
    content: `import { Component, type ErrorInfo, type ReactNode } from "react";
import { Alert, Box, Button, Stack, Typography } from "@mui/material";

export interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode;
}

export interface ErrorBoundaryState {
  hasError: boolean;
}

class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    if (import.meta.env.DEV) {
      console.error("ErrorBoundary caught:", error, info);
    }
  }

  private handleRetry = (): void => {
    this.setState({ hasError: false });
  };

  render(): ReactNode {
    if (this.state.hasError) {
      if (this.props.fallback !== undefined) {
        return this.props.fallback;
      }

      return (
        <Box role="alert" sx={{ display: "grid", minHeight: "50vh", placeItems: "center", px: 3 }}>
          <Stack spacing={2} sx={{ width: "100%", maxWidth: 420 }}>
            <Alert severity="error">Something went wrong while rendering this screen.</Alert>
            <Typography variant="body2" color="text.secondary">
              Try again or reload the page if the problem persists.
            </Typography>
            <Button onClick={this.handleRetry} variant="contained">
              Try again
            </Button>
          </Stack>
        </Box>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
`
  };
};

export const makeScreenSkeletonFile = (): GeneratedFile => {
  return {
    path: "src/components/ScreenSkeleton.tsx",
    content: `import { Box, Container, LinearProgress, Skeleton, Stack } from "@mui/material";

export default function ScreenSkeleton() {
  return (
    <Box
      component="section"
      role="status"
      aria-live="polite"
      aria-label="Loading screen content"
      aria-busy="true"
      sx={{
        minHeight: "100vh",
        bgcolor: "background.default",
        pt: 7,
        pb: 6
      }}
    >
      <LinearProgress
        aria-hidden
        sx={{
          position: "fixed",
          top: 0,
          left: 0,
          right: 0,
          zIndex: 1302
        }}
      />
      <Container maxWidth="lg">
        <Stack spacing={3}>
          <Skeleton variant="text" width="42%" height={52} />
          <Stack spacing={1.5}>
            <Skeleton variant="text" width="90%" />
            <Skeleton variant="text" width="74%" />
            <Skeleton variant="text" width="68%" />
          </Stack>
          <Skeleton variant="rounded" height={220} />
          <Stack spacing={2} direction={{ xs: "column", md: "row" }}>
            <Skeleton variant="rounded" height={170} sx={{ flex: 1 }} />
            <Skeleton variant="rounded" height={170} sx={{ flex: 1 }} />
          </Stack>
          <Skeleton variant="rounded" height={120} />
        </Stack>
      </Container>
    </Box>
  );
}
`
  };
};
