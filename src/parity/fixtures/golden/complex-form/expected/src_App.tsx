import { Suspense } from "react";

import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import ErrorBoundary from "./components/ErrorBoundary";
import ScreenSkeleton from "./components/ScreenSkeleton";
import RegistrationScreen from "./screens/Registration";


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
          <Route path="/registration" element={<ErrorBoundary><RegistrationScreen /></ErrorBoundary>} />
          <Route path="/" element={<Navigate to="/registration" replace />} />
          <Route path="*" element={<Navigate to="/registration" replace />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
}
