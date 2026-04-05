import { Suspense, lazy } from "react";
import DarkModeRoundedIcon from "@mui/icons-material/DarkModeRounded";
import LightModeRoundedIcon from "@mui/icons-material/LightModeRounded";
import { Box, IconButton, Tooltip } from "@mui/material";
import { styled, useColorScheme } from "@mui/material/styles";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import ErrorBoundary from "./components/ErrorBoundary";
import ScreenSkeleton from "./components/ScreenSkeleton";
import DashboardLightScreen from "./screens/Dashboard_Light";

const LazyDashboardDarkScreen = lazy(async () => await import("./screens/Dashboard_Dark"));

const routeLoadingFallback = <ScreenSkeleton />;

const resolveBrowserBasename = (): string | undefined => {
  if (typeof window === "undefined") {
    return undefined;
  }

  const reproMatch = window.location.pathname.match(/^\/workspace\/repros\/[^/]+/);
  return reproMatch?.[0];
};

const browserBasename = resolveBrowserBasename();

const SkipLink = styled("a")(({ theme }) => ({
  position: "absolute",
  left: "-9999px",
  top: "auto",
  width: "1px",
  height: "1px",
  overflow: "hidden",
  whiteSpace: "nowrap",
  zIndex: theme.zIndex.modal + 1,
  "&:focus-visible": {
    position: "fixed",
    left: theme.spacing(2),
    top: theme.spacing(2),
    width: "auto",
    height: "auto",
    overflow: "visible",
    whiteSpace: "normal",
    padding: theme.spacing(1, 2),
    borderRadius: theme.shape.borderRadius,
    backgroundColor: theme.palette.background.paper,
    color: theme.palette.text.primary,
    outline: "2px solid " + theme.palette.primary.main,
    outlineOffset: 2,
    textDecoration: "none"
  }
}));


function ThemeModeToggle() {
  const { mode, setMode, systemMode } = useColorScheme();
  const prefersDarkMode =
    typeof window !== "undefined" && typeof window.matchMedia === "function"
      ? window.matchMedia("(prefers-color-scheme: dark)").matches
      : false;
  const resolvedMode =
    mode === "dark" || (mode !== "light" && (systemMode === "dark" || (systemMode === undefined && prefersDarkMode)))
      ? "dark"
      : "light";
  const nextMode = resolvedMode === "dark" ? "light" : "dark";
  const label = resolvedMode === "dark" ? "Switch to light mode" : "Switch to dark mode";

  return (
    <Box sx={{ position: "fixed", top: 16, right: 16, zIndex: 1301 }}>
      <Tooltip title={label}>
        <IconButton
          aria-label={label}
          data-testid="theme-mode-toggle"
          onClick={() => setMode(nextMode)}
          sx={{
            bgcolor: "background.paper",
            color: "text.primary",
            border: "1px solid",
            borderColor: "divider",
            boxShadow: 3,
            "&:hover": {
              bgcolor: "action.hover"
            }
          }}
        >
          {resolvedMode === "dark" ? <LightModeRoundedIcon /> : <DarkModeRoundedIcon />}
        </IconButton>
      </Tooltip>
    </Box>
  );
}


export default function App() {
  return (
    <BrowserRouter basename={browserBasename}>
      <SkipLink href="#main-content">Skip to main content</SkipLink>
      <ThemeModeToggle />
      <Suspense fallback={routeLoadingFallback}>
        <Routes>
          <Route path="/dashboard_light" element={<ErrorBoundary><DashboardLightScreen /></ErrorBoundary>} />
          <Route path="/dashboard_dark" element={<ErrorBoundary><LazyDashboardDarkScreen /></ErrorBoundary>} />
          <Route path="/" element={<Navigate to="/dashboard_light" replace />} />
          <Route path="*" element={<Navigate to="/dashboard_light" replace />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
}
