import { Suspense, lazy } from "react";

import { styled } from "@mui/material/styles";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import ErrorBoundary from "./components/ErrorBoundary";
import ScreenSkeleton from "./components/ScreenSkeleton";
import SplashScreen from "./screens/Splash";

const LazyOnboardingScreen = lazy(async () => await import("./screens/Onboarding"));
const LazyLoginScreen = lazy(async () => await import("./screens/Login"));
const LazyRegisterScreen = lazy(async () => await import("./screens/Register"));
const LazyHomeScreen = lazy(async () => await import("./screens/Home"));
const LazyFeedScreen = lazy(async () => await import("./screens/Feed"));
const LazySearchScreen = lazy(async () => await import("./screens/Search"));
const LazyProfileScreen = lazy(async () => await import("./screens/Profile"));
const LazySettingsScreen = lazy(async () => await import("./screens/Settings"));
const LazyNotificationsScreen = lazy(async () => await import("./screens/Notifications"));
const LazyAboutScreen = lazy(async () => await import("./screens/About"));

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



export default function App() {
  return (
    <BrowserRouter basename={browserBasename}>
      <SkipLink href="#main-content">Skip to main content</SkipLink>

      <Suspense fallback={routeLoadingFallback}>
        <Routes>
          <Route path="/splash" element={<ErrorBoundary><SplashScreen /></ErrorBoundary>} />
          <Route path="/onboarding" element={<ErrorBoundary><LazyOnboardingScreen /></ErrorBoundary>} />
          <Route path="/login" element={<ErrorBoundary><LazyLoginScreen /></ErrorBoundary>} />
          <Route path="/register" element={<ErrorBoundary><LazyRegisterScreen /></ErrorBoundary>} />
          <Route path="/home" element={<ErrorBoundary><LazyHomeScreen /></ErrorBoundary>} />
          <Route path="/feed" element={<ErrorBoundary><LazyFeedScreen /></ErrorBoundary>} />
          <Route path="/search" element={<ErrorBoundary><LazySearchScreen /></ErrorBoundary>} />
          <Route path="/profile" element={<ErrorBoundary><LazyProfileScreen /></ErrorBoundary>} />
          <Route path="/settings" element={<ErrorBoundary><LazySettingsScreen /></ErrorBoundary>} />
          <Route path="/notifications" element={<ErrorBoundary><LazyNotificationsScreen /></ErrorBoundary>} />
          <Route path="/about" element={<ErrorBoundary><LazyAboutScreen /></ErrorBoundary>} />
          <Route path="/" element={<Navigate to="/splash" replace />} />
          <Route path="*" element={<Navigate to="/splash" replace />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
}
