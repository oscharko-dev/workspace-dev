import { Suspense, lazy } from "react";
import { createBrowserRouter } from "react-router-dom";
import { WorkspacePage } from "../features/workspace/workspace-page";

const LazyInspectorPage = lazy(async () => {
  const module = await import("../features/workspace/inspector-page");
  return { default: module.InspectorPage };
});

const routeFallback = <div aria-hidden="true" className="min-h-screen bg-[#101010]" />;

export const appRouter = createBrowserRouter([
  {
    path: "/workspace/ui/inspector",
    element: (
      <Suspense fallback={routeFallback}>
        <LazyInspectorPage />
      </Suspense>
    )
  },
  {
    path: "/workspace/ui",
    element: <WorkspacePage />
  },
  {
    path: "/workspace/ui/*",
    element: <WorkspacePage />
  },
  {
    path: "/workspace/:figmaFileKey",
    element: <WorkspacePage />
  },
  {
    path: "*",
    element: <WorkspacePage />
  }
]);
