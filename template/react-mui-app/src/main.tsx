import React from "react";
import { createRoot } from "react-dom/client";
import { ThemeProvider, CssBaseline } from "@mui/material";
import App from "./App";
import { startWebVitalsReporting } from "./performance/report-web-vitals";
import { appTheme } from "./theme/theme";

startWebVitalsReporting();

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("Missing #root mount element.");
}

createRoot(rootElement).render(
  <React.StrictMode>
    <ThemeProvider theme={appTheme}>
      <CssBaseline />
      <App />
    </ThemeProvider>
  </React.StrictMode>
);
