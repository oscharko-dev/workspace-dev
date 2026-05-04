export const LIVE_SMOKE_FLAG = "WORKSPACE_TEST_SPACE_LIVE_SMOKE";

export const LIVE_SMOKE_SKIP_MESSAGE: string =
  `${LIVE_SMOKE_FLAG}=1 enables the operator-controlled live smoke test.`;

export const REQUIRED_LIVE_ENV = [
  "WORKSPACE_TEST_SPACE_MODEL_ENDPOINT",
  "WORKSPACE_TEST_SPACE_TESTCASE_MODEL_DEPLOYMENT",
  "WORKSPACE_TEST_SPACE_VISUAL_MODEL_ENDPOINT",
  "WORKSPACE_TEST_SPACE_VISUAL_PRIMARY_DEPLOYMENT",
  "WORKSPACE_TEST_SPACE_VISUAL_FALLBACK_DEPLOYMENT",
] as const;

export function isLiveSmokeEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return env[LIVE_SMOKE_FLAG] === "1";
}

export function findMissingRequiredLiveEnv(
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  return REQUIRED_LIVE_ENV.filter((name) => {
    const value = env[name];
    return typeof value !== "string" || value.length === 0;
  });
}

export function formatMissingRequiredLiveEnvMessage(missing: readonly string[]): string {
  return `missing required live smoke env names: ${missing.join(", ")}`;
}
