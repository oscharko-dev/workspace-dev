// ---------------------------------------------------------------------------
// app-template.ts — App.tsx and router setup
// Extracted from generator-templates.ts (issue #298)
// ---------------------------------------------------------------------------
import type { ScreenIR } from "../types.js";
import { sanitizeFileName } from "../path-utils.js";
import { buildScreenArtifactIdentities, toComponentName, toDeterministicScreenPath } from "../generator-artifacts.js";
import type { ScreenArtifactIdentity } from "../generator-artifacts.js";
import type { WorkspaceRouterMode } from "../../contracts/index.js";
import { DEFAULT_ROUTER_MODE } from "./utility-functions.js";

export const makeAppFile = ({
  screens,
  identitiesByScreenId = buildScreenArtifactIdentities(screens),
  routerMode = DEFAULT_ROUTER_MODE,
  includeThemeModeToggle = true
}: {
  screens: ScreenIR[];
  identitiesByScreenId?: Map<string, ScreenArtifactIdentity>;
  routerMode?: WorkspaceRouterMode;
  includeThemeModeToggle?: boolean;
}): string => {
  const lazyScreens = screens.slice(1);
  const hasLazyRoutes = lazyScreens.length > 0;
  const reactImport = hasLazyRoutes ? 'import { Suspense, lazy } from "react";' : 'import { Suspense } from "react";';
  const resolvedRouterMode: WorkspaceRouterMode = routerMode === "hash" ? "hash" : "browser";
  const routerComponentName = resolvedRouterMode === "hash" ? "HashRouter" : "BrowserRouter";
  const routerOpenTag = resolvedRouterMode === "hash" ? "<HashRouter>" : "<BrowserRouter basename={browserBasename}>";
  const routerCloseTag = resolvedRouterMode === "hash" ? "</HashRouter>" : "</BrowserRouter>";
  const browserBasenameBlock =
    resolvedRouterMode === "browser"
      ? `
const resolveBrowserBasename = (): string | undefined => {
  if (typeof window === "undefined") {
    return undefined;
  }

  const reproMatch = window.location.pathname.match(/^\\/workspace\\/repros\\/[^/]+/);
  return reproMatch?.[0];
};

const browserBasename = resolveBrowserBasename();
`
      : "";

  const eagerImports = screens
    .slice(0, 1)
    .map((screen) => {
      const identity = identitiesByScreenId.get(screen.id);
      const componentName = identity?.componentName ?? toComponentName(screen.name);
      const fileName = (identity?.filePath ?? toDeterministicScreenPath(screen.name))
        .replace(/^src\/screens\//, "")
        .replace(/\.tsx$/i, "");
      return `import ${componentName}Screen from "./screens/${fileName}";`;
    })
    .join("\n");

  const lazyImports = lazyScreens
    .map((screen) => {
      const identity = identitiesByScreenId.get(screen.id);
      const componentName = identity?.componentName ?? toComponentName(screen.name);
      const fileName = (identity?.filePath ?? toDeterministicScreenPath(screen.name))
        .replace(/^src\/screens\//, "")
        .replace(/\.tsx$/i, "");
      return `const Lazy${componentName}Screen = lazy(async () => await import("./screens/${fileName}"));`;
    })
    .join("\n");

  const routes = screens
    .map((screen, index) => {
      const identity = identitiesByScreenId.get(screen.id);
      const componentName = identity?.componentName ?? toComponentName(screen.name);
      const routePath = identity?.routePath ?? `/${sanitizeFileName(screen.name).toLowerCase()}`;
      const routeComponent = index === 0 ? `${componentName}Screen` : `Lazy${componentName}Screen`;
      return `          <Route path="${routePath}" element={<ErrorBoundary><${routeComponent} /></ErrorBoundary>} />`;
    })
    .join("\n");

  const firstScreen = screens.at(0);
  const firstIdentity = firstScreen ? identitiesByScreenId.get(firstScreen.id) : undefined;
  const firstRoute = firstIdentity?.routePath ?? (firstScreen ? `/${sanitizeFileName(firstScreen.name).toLowerCase()}` : "/");

  return `${reactImport}
${includeThemeModeToggle ? `import DarkModeRoundedIcon from "@mui/icons-material/DarkModeRounded";
import LightModeRoundedIcon from "@mui/icons-material/LightModeRounded";
import { Box, IconButton, Tooltip } from "@mui/material";
import { useColorScheme } from "@mui/material/styles";` : ""}
import { ${routerComponentName}, Navigate, Route, Routes } from "react-router-dom";
import ErrorBoundary from "./components/ErrorBoundary";
import ScreenSkeleton from "./components/ScreenSkeleton";
${eagerImports}
${lazyImports.length > 0 ? `\n${lazyImports}` : ""}

const routeLoadingFallback = <ScreenSkeleton />;
${browserBasenameBlock}
${includeThemeModeToggle ? `
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
` : ""}

export default function App() {
  return (
    ${routerOpenTag}
      <a href="#main-content" style={{ position: "absolute", left: "-9999px", top: "auto", width: "1px", height: "1px", overflow: "hidden", zIndex: 9999 }} onFocus={(e) => { e.currentTarget.style.position = "static"; e.currentTarget.style.width = "auto"; e.currentTarget.style.height = "auto"; e.currentTarget.style.overflow = "visible"; }} onBlur={(e) => { e.currentTarget.style.position = "absolute"; e.currentTarget.style.left = "-9999px"; e.currentTarget.style.width = "1px"; e.currentTarget.style.height = "1px"; e.currentTarget.style.overflow = "hidden"; }}>Skip to main content</a>
${includeThemeModeToggle ? "      <ThemeModeToggle />" : ""}
      <Suspense fallback={routeLoadingFallback}>
        <Routes>
${routes}
          <Route path="/" element={<Navigate to="${firstRoute}" replace />} />
          <Route path="*" element={<Navigate to="${firstRoute}" replace />} />
        </Routes>
      </Suspense>
    ${routerCloseTag}
  );
}
`;
};

