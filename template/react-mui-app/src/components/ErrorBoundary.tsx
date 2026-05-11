import { Component, type ErrorInfo, type ReactNode } from "react";
import { Alert, Box, Button, Paper, Stack, Typography } from "@mui/material";

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
}

export default class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    void error;
    void errorInfo;
    // Root-level createRoot error callbacks handle reporting to avoid duplicate logs.
  }

  private handleRetry = (): void => {
    this.setState({ hasError: false });
  };

  render(): ReactNode {
    if (!this.state.hasError) {
      return this.props.children;
    }

    return (
      <Box sx={{ py: { xs: 2, md: 4 } }}>
        <Paper
          elevation={0}
          role="alert"
          sx={{
            border: "1px solid",
            borderColor: "error.light",
            borderRadius: 4,
            p: { xs: 2.5, md: 3 }
          }}
        >
          <Stack spacing={2}>
            <Alert severity="error" variant="filled">
              This route failed to render.
            </Alert>
            <Typography variant="h5">Recoverable rendering failure</Typography>
            <Typography color="text.secondary" variant="body2">
              The app shell stayed responsive and captured the error at the root. Retry this route or navigate to a
              different view.
            </Typography>
            <Box>
              <Button onClick={this.handleRetry} variant="contained">
                Retry route
              </Button>
            </Box>
          </Stack>
        </Paper>
      </Box>
    );
  }
}
