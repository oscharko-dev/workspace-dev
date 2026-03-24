import { Suspense, lazy } from "react";
import DarkModeRoundedIcon from "@mui/icons-material/DarkModeRounded";
import LightModeRoundedIcon from "@mui/icons-material/LightModeRounded";
import { Box, IconButton, Tooltip } from "@mui/material";
import { useColorScheme } from "@mui/material/styles";
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
      <a href="#main-content" style={{ position: "absolute", left: "-9999px", top: "auto", width: "1px", height: "1px", overflow: "hidden", zIndex: 9999 }} onFocus={(e) => { e.currentTarget.style.position = "static"; e.currentTarget.style.width = "auto"; e.currentTarget.style.height = "auto"; e.currentTarget.style.overflow = "visible"; }} onBlur={(e) => { e.currentTarget.style.position = "absolute"; e.currentTarget.style.left = "-9999px"; e.currentTarget.style.width = "1px"; e.currentTarget.style.height = "1px"; e.currentTarget.style.overflow = "hidden"; }}>Skip to main content</a>
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
