import { Suspense } from "react";

import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import ErrorBoundary from "./components/ErrorBoundary";
import ScreenSkeleton from "./components/ScreenSkeleton";
import UserListScreen from "./screens/UserList";


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
      <a href="#main-content" style={{ position: "absolute", left: "-9999px", top: "auto", width: "1px", height: "1px", overflow: "hidden", zIndex: 9999 }} onFocus={(e) => { e.currentTarget.style.position = "static"; e.currentTarget.style.width = "auto"; e.currentTarget.style.height = "auto"; e.currentTarget.style.overflow = "visible"; }} onBlur={(e) => { e.currentTarget.style.position = "absolute"; e.currentTarget.style.left = "-9999px"; e.currentTarget.style.width = "1px"; e.currentTarget.style.height = "1px"; e.currentTarget.style.overflow = "hidden"; }}>Skip to main content</a>

      <Suspense fallback={routeLoadingFallback}>
        <Routes>
          <Route path="/userlist" element={<ErrorBoundary><UserListScreen /></ErrorBoundary>} />
          <Route path="/" element={<Navigate to="/userlist" replace />} />
          <Route path="*" element={<Navigate to="/userlist" replace />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
}
