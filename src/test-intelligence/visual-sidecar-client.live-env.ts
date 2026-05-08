export const LIVE_SMOKE_FLAG = "WORKSPACE_TEST_SPACE_LIVE_SMOKE";

export const LIVE_SMOKE_SKIP_MESSAGE: string =
  `${LIVE_SMOKE_FLAG}=1 enables the operator-controlled live smoke test.`;

export const LIVE_LLM_API_KEY_ENV = "WORKSPACE_TEST_SPACE_LLM_API_KEY";
export const LIVE_API_KEY_ALIASES = [LIVE_LLM_API_KEY_ENV] as const;

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

type LiveApiKeyResolution =
  | {
      ok: true;
      source: (typeof LIVE_API_KEY_ALIASES)[number];
      value: string;
    }
  | {
      ok: false;
      apiKeyAliases: typeof LIVE_API_KEY_ALIASES;
      apiKeyConflict: boolean;
      apiKeySet: boolean;
      message: string;
    };

const readNonEmptyEnv = (
  env: NodeJS.ProcessEnv,
  name: string,
): string | undefined => {
  const value = env[name];
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

export function resolveLiveSmokeApiKey(
  env: NodeJS.ProcessEnv = process.env,
): LiveApiKeyResolution {
  const apiKey = readNonEmptyEnv(env, LIVE_LLM_API_KEY_ENV);
  if (apiKey !== undefined) {
    return { ok: true, source: LIVE_LLM_API_KEY_ENV, value: apiKey };
  }
  return {
    ok: false,
    apiKeyAliases: LIVE_API_KEY_ALIASES,
    apiKeyConflict: false,
    apiKeySet: false,
    message: `live smoke requires ${LIVE_LLM_API_KEY_ENV}.`,
  };
}

export function requireLiveSmokeApiKey(
  context: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const resolved = resolveLiveSmokeApiKey(env);
  if (resolved.ok) return resolved.value;
  throw new Error(`${context}: ${resolved.message}`);
}
