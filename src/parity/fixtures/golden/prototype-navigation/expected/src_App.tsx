import { Suspense, lazy } from "react";

import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import ErrorBoundary from "./components/ErrorBoundary";
import ScreenSkeleton from "./components/ScreenSkeleton";
import HomeScreen from "./screens/Home";

const LazyDetailsScreen = lazy(async () => await import("./screens/Details"));

const routeLoadingFallback = <ScreenSkeleton />;

const resolveBrowserBasename = (): string | undefined => {
  if (typeof window === "undefined") {
    return undefined;
  }

  const reproMatch = window.location.pathname.match(/^\/workspace\/repros\/[^/]+/);
  return reproMatch?.[0];
};

const browserBasename = resolveBrowserBasename();



export default function App() {
  return (
    <BrowserRouter basename={browserBasename}>

      <Suspense fallback={routeLoadingFallback}>
        <Routes>
          <Route path="/home" element={<ErrorBoundary><HomeScreen /></ErrorBoundary>} />
          <Route path="/details" element={<ErrorBoundary><LazyDetailsScreen /></ErrorBoundary>} />
          <Route path="/" element={<Navigate to="/home" replace />} />
          <Route path="*" element={<Navigate to="/home" replace />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
}
