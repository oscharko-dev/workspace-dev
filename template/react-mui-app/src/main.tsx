import React from "react";
import { createRoot } from "react-dom/client";
import CssBaseline from "@mui/material/CssBaseline";
import { ThemeProvider } from "@mui/material/styles";
import App from "./App";
import { applyRuntimeResourceHints } from "./performance/resource-hints";
import { startWebVitalsReporting } from "./performance/report-web-vitals";
import { createRootErrorHandlers } from "./performance/runtime-errors";
import { appTheme } from "./theme/theme";

applyRuntimeResourceHints();
startWebVitalsReporting();

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("Missing #root mount element.");
}

createRoot(rootElement, createRootErrorHandlers()).render(
  <React.StrictMode>
    <ThemeProvider theme={appTheme} defaultMode="system" noSsr>
      <CssBaseline />
      <App />
    </ThemeProvider>
  </React.StrictMode>
);
