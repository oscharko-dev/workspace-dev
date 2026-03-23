import { createBrowserRouter } from "react-router-dom";
import { WorkspacePage } from "../features/workspace/workspace-page";
import { InspectorPage } from "../features/workspace/inspector-page";

export const appRouter = createBrowserRouter([
  {
    path: "/workspace/ui/inspector",
    element: <InspectorPage />
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
