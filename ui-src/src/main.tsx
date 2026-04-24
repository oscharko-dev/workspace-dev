import React, { Suspense, lazy } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createBrowserRouter, RouterProvider } from "react-router-dom";
import { WorkspacePage } from "./features/workspace/workspace-page";
import "./app.css";

const LazyInspectorPage = lazy(async () => {
  const module = await import("./features/workspace/inspector-page");
  return { default: module.InspectorPage };
});

const LazyInspectorIntentMetricsPage = lazy(async () => {
  const module =
    await import("./features/workspace/inspector-intent-metrics-page");
  return { default: module.InspectorIntentMetricsPage };
});

const LazyVisualQualityPage = lazy(async () => {
  const module = await import("./features/visual-quality/visual-quality-page");
  return { default: module.VisualQualityPage };
});

const LazyTestSpacePage = lazy(async () => {
  const module = await import("./features/test-space/test-space-page");
  return { default: module.TestSpacePage };
});

const routeFallback = (
  <div aria-hidden="true" className="min-h-screen bg-[#101010]" />
);

const appRouter = createBrowserRouter([
  {
    path: "/workspace/ui/test-space",
    element: (
      <Suspense fallback={routeFallback}>
        <LazyTestSpacePage />
      </Suspense>
    ),
  },
  {
    path: "/ui/test-space",
    element: (
      <Suspense fallback={routeFallback}>
        <LazyTestSpacePage />
      </Suspense>
    ),
  },
  {
    path: "/workspace/ui/inspector/intent-metrics",
    element: (
      <Suspense fallback={routeFallback}>
        <LazyInspectorIntentMetricsPage />
      </Suspense>
    ),
  },
  {
    path: "/workspace/ui/inspector",
    element: (
      <Suspense fallback={routeFallback}>
        <LazyInspectorPage />
      </Suspense>
    ),
  },
  {
    path: "/workspace/ui/visual-quality",
    element: (
      <Suspense fallback={routeFallback}>
        <LazyVisualQualityPage />
      </Suspense>
    ),
  },
  {
    path: "/workspace/ui",
    element: <WorkspacePage />,
  },
  {
    path: "/workspace/ui/*",
    element: <WorkspacePage />,
  },
  {
    path: "/workspace/:figmaFileKey",
    element: <WorkspacePage />,
  },
  {
    path: "*",
    element: <WorkspacePage />,
  },
]);

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("Missing #root mount element.");
}

createRoot(rootElement).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={appRouter} />
    </QueryClientProvider>
  </React.StrictMode>,
);
