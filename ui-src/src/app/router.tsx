import { createBrowserRouter } from "react-router-dom";
import { WorkspacePage } from "../features/workspace/workspace-page";

export const appRouter = createBrowserRouter([
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
