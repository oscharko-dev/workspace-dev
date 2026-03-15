import { defineConfig } from "vite";
import react, { reactCompilerPreset } from "@vitejs/plugin-react";
import babel from "@rolldown/plugin-babel";

const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env ?? {};

const toOptionalNumber = (rawValue: string | undefined): number | undefined => {
  if (!rawValue || rawValue.trim().length === 0) {
    return undefined;
  }
  const parsed = Number(rawValue);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return undefined;
  }
  return parsed;
};

const toAllowedHosts = (rawValue: string | undefined): string[] | true => {
  const trimmed = rawValue?.trim();
  if (!trimmed || trimmed === "*" || trimmed.toLowerCase() === "true") {
    return true;
  }
  const hosts = trimmed
    .split(",")
    .map((host) => host.trim())
    .filter((host) => host.length > 0);
  return hosts.length > 0 ? hosts : true;
};

const liveEditBasePath = env.LIVE_EDIT_BASE_PATH;
const liveEditHmrPath = env.LIVE_EDIT_HMR_PATH;
const liveEditAllowedHosts = toAllowedHosts(env.LIVE_EDIT_ALLOWED_HOSTS);
const enableReactCompiler = env.VITE_ENABLE_REACT_COMPILER?.trim().toLowerCase() === "true";
const reactCompilerTarget = env.VITE_REACT_COMPILER_TARGET?.trim();
const normalizedReactCompilerTarget =
  reactCompilerTarget === "17" || reactCompilerTarget === "18" ? reactCompilerTarget : undefined;
const normalizedBasePath = liveEditBasePath
  ? liveEditBasePath.endsWith("/")
    ? liveEditBasePath
    : `${liveEditBasePath}/`
  : "./";

const reactCompilerPlugins = enableReactCompiler
  ? [
      babel({
        presets: [
          reactCompilerPreset(
            normalizedReactCompilerTarget ? { target: normalizedReactCompilerTarget } : undefined
          )
        ]
      } as unknown as Parameters<typeof babel>[0])
    ]
  : [];

export default defineConfig({
  plugins: [react(), ...reactCompilerPlugins],
  base: normalizedBasePath,
  server: {
    host: "0.0.0.0",
    allowedHosts: liveEditAllowedHosts,
    port: toOptionalNumber(env.LIVE_EDIT_PORT) ?? toOptionalNumber(env.PORT) ?? 5173,
    strictPort: true,
    hmr: liveEditHmrPath
      ? {
          path: liveEditHmrPath,
          host: env.LIVE_EDIT_HMR_HOST,
          port: toOptionalNumber(env.LIVE_EDIT_HMR_PORT)
        }
      : undefined
  }
});
