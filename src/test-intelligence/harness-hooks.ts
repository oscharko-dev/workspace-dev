import { createHash } from "node:crypto";

export const HOOK_MATCHER_SCHEMA_VERSION = "1.0.0" as const;

export const HOOK_EVENTS = [
  "OnEvidenceSeal",
  "OnExportComplete",
  "OnFourEyesPending",
  "OnNeedsReview",
  "OnStop",
  "OnSubagentStop",
  "PostGapFinder",
  "PostJudgePanel",
  "PostRepair",
  "PostRoleCall",
  "PostVisualSidecar",
  "PreGapFinder",
  "PreJudgePanel",
  "PreRepair",
  "PreRoleCall",
  "PreVisualSidecar",
] as const;

export type HookEvent = (typeof HOOK_EVENTS)[number];

export interface HookCommandShell {
  readonly kind: "command";
  readonly cmd: string;
  readonly args: readonly string[];
  readonly cwd?: string;
  readonly timeoutMs: number;
}

export interface HookCommandPrompt {
  readonly kind: "prompt";
  readonly promptVersion: string;
  readonly modelBinding: string;
}

export interface HookCommandHttp {
  readonly kind: "http";
  readonly url: string;
  readonly method: "POST";
  readonly headers: Readonly<Record<string, string>>;
  readonly bodyTemplate: string;
  readonly allowedEnvVars?: readonly string[];
}

export interface HookCommandAgent {
  readonly kind: "agent";
  readonly roleProfileId: string;
}

export type HookCommand =
  | HookCommandShell
  | HookCommandPrompt
  | HookCommandHttp
  | HookCommandAgent;

export interface HookMatcher {
  readonly schemaVersion: typeof HOOK_MATCHER_SCHEMA_VERSION;
  readonly event: HookEvent;
  readonly if: string;
  readonly command: HookCommand;
  readonly once?: boolean;
  readonly async?: boolean;
  readonly asyncRewake?: boolean;
  readonly signedBundleId?: string;
}

type HookScalar = string | number | boolean | null;
type HookFactValue = HookScalar | readonly HookScalar[] | HookFactMap;

export interface HookFactMap {
  readonly [key: string]: HookFactValue | undefined;
}

export interface HookExecutionFacts extends HookFactMap {
  readonly event: HookEvent;
  readonly policyProfile?: string;
}

export interface HookRuntimePolicy {
  readonly policyProfile?: string;
  readonly allowedHttpHosts?: readonly string[];
  readonly maxConcurrentHooks?: number;
  readonly registeredSignedBundleIds?: ReadonlySet<string>;
}

export type HookValidationRefusalCode =
  | "hook_async_rewake_requires_async"
  | "hook_bundle_unregistered"
  | "hook_bundle_unsigned"
  | "hook_http_domain_not_allowlisted"
  | "hook_http_header_invalid"
  | "hook_http_method_unsupported"
  | "hook_if_invalid"
  | "hook_schema_invalid"
  | "hook_telemetry_url_blocked";

export interface HookValidationRefusal {
  readonly index: number;
  readonly code: HookValidationRefusalCode;
  readonly message: string;
}

export interface HookValidationResult {
  readonly ok: boolean;
  readonly refusals: readonly HookValidationRefusal[];
}

export interface HookExecutionState {
  readonly onceDigests: Set<string>;
}

export interface HookCommandExecutionContext {
  readonly index: number;
  readonly matcher: HookMatcher;
  readonly facts: HookExecutionFacts;
}

export interface ResolvedHookHttpCommand
  extends Omit<HookCommandHttp, "headers"> {
  readonly headers: Readonly<Record<string, string>>;
}

export interface HookExecutors {
  readonly command?: (
    command: HookCommandShell,
    context: HookCommandExecutionContext,
  ) => Promise<unknown>;
  readonly prompt?: (
    command: HookCommandPrompt,
    context: HookCommandExecutionContext,
  ) => Promise<unknown>;
  readonly http?: (
    command: ResolvedHookHttpCommand,
    context: HookCommandExecutionContext,
  ) => Promise<unknown>;
  readonly agent?: (
    command: HookCommandAgent,
    context: HookCommandExecutionContext,
  ) => Promise<unknown>;
}

export type HookExecutionRecordStatus =
  | "executed"
  | "filtered"
  | "refused"
  | "skipped_once";

export interface HookExecutionRecord {
  readonly index: number;
  readonly matcherDigest: string;
  readonly status: HookExecutionRecordStatus;
  readonly refusalCode?: HookValidationRefusalCode;
  readonly result?: unknown;
}

export interface RunHookMatchersInput {
  readonly hooks: readonly HookMatcher[];
  readonly event: HookEvent;
  readonly facts: HookExecutionFacts;
  readonly executors: HookExecutors;
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly state?: HookExecutionState;
  readonly policy?: HookRuntimePolicy;
}

type Token =
  | { readonly kind: "identifier"; readonly value: string }
  | { readonly kind: "string"; readonly value: string }
  | { readonly kind: "number"; readonly value: number }
  | { readonly kind: "boolean"; readonly value: boolean }
  | { readonly kind: "null" }
  | {
      readonly kind: "operator";
      readonly value: "&&" | "||" | "!" | "==" | "!=";
    }
  | { readonly kind: "paren"; readonly value: "(" | ")" };

type ExpressionNode =
  | {
      readonly kind: "binary";
      readonly op: "&&" | "||";
      readonly left: ExpressionNode;
      readonly right: ExpressionNode;
    }
  | { readonly kind: "not"; readonly child: ExpressionNode }
  | {
      readonly kind: "comparison";
      readonly op: "==" | "!=";
      readonly path: string;
      readonly value: HookScalar;
    };

const TELEMETRY_URL_RE =
  /https?:\/\/[^"'`\s]*(track|telemetry|analytics|event|metrics|collector|beacon)[^"'`\s]*/iu;
const ENV_PLACEHOLDER_RE = /\$\{([A-Z][A-Z0-9_]*)\}/gu;
const SIGNED_BUNDLE_ID_RE = /^[A-Za-z0-9._:/-]{1,128}$/u;
const HOST_PATTERN_RE = /^(?:\*\.)?[A-Za-z0-9.-]+$/u;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const isHookEvent = (value: unknown): value is HookEvent =>
  typeof value === "string" &&
  (HOOK_EVENTS as readonly string[]).includes(value);

const normalizeMaxConcurrentHooks = (value: number | undefined): number => {
  if (value === undefined) return 1;
  if (!Number.isInteger(value) || value < 1) {
    throw new RangeError(
      "maxConcurrentHooks must be a positive integer when provided",
    );
  }
  return value;
};

const isHostAllowed = (
  host: string,
  allowedHosts: readonly string[] | undefined,
): boolean => {
  if (allowedHosts === undefined || allowedHosts.length === 0) {
    return false;
  }
  const normalizedHost = host.toLowerCase();
  return allowedHosts.some((entry) => {
    const pattern = entry.trim().toLowerCase();
    if (!HOST_PATTERN_RE.test(pattern)) {
      return false;
    }
    if (pattern.startsWith("*.")) {
      const suffix = pattern.slice(1);
      return (
        normalizedHost.endsWith(suffix) &&
        normalizedHost.length > suffix.length
      );
    }
    return normalizedHost === pattern;
  });
};

export const extractRegisteredSignedBundleIdsFromContractChangelog = (
  markdown: string,
): ReadonlySet<string> => {
  const out = new Set<string>();
  for (const match of markdown.matchAll(
    /signedBundleId\s*[:=]\s*`([^`]+)`/gu,
  )) {
    const id = match[1]?.trim();
    if (id !== undefined && SIGNED_BUNDLE_ID_RE.test(id)) {
      out.add(id);
    }
  }
  return out;
};

const tokenizeExpression = (input: string): Token[] => {
  const tokens: Token[] = [];
  let cursor = 0;
  while (cursor < input.length) {
    const rest = input.slice(cursor);
    const whitespace = rest.match(/^\s+/u);
    if (whitespace) {
      cursor += whitespace[0].length;
      continue;
    }
    const operator = rest.match(/^(==|!=|&&|\|\||!)/u);
    if (operator) {
      const value = operator[1];
      if (
        value === "==" ||
        value === "!=" ||
        value === "&&" ||
        value === "||" ||
        value === "!"
      ) {
        tokens.push({
          kind: "operator",
          value,
        });
        cursor += value.length;
        continue;
      }
    }
    const paren = rest.match(/^[()]/u);
    if (paren) {
      tokens.push({ kind: "paren", value: paren[0] as "(" | ")" });
      cursor += paren[0].length;
      continue;
    }
    const stringToken = rest.match(/^"((?:\\.|[^"\\])*)"/u);
    if (stringToken) {
      tokens.push({
        kind: "string",
        value: JSON.parse(stringToken[0]) as string,
      });
      cursor += stringToken[0].length;
      continue;
    }
    const numberToken = rest.match(/^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?/u);
    if (numberToken) {
      tokens.push({
        kind: "number",
        value: Number(numberToken[0]),
      });
      cursor += numberToken[0].length;
      continue;
    }
    const literalToken = rest.match(/^(true|false|null)\b/u);
    if (literalToken) {
      const value = literalToken[1];
      if (value === "true" || value === "false") {
        tokens.push({ kind: "boolean", value: value === "true" });
      } else {
        tokens.push({ kind: "null" });
      }
      cursor += literalToken[0].length;
      continue;
    }
    const identifier = rest.match(/^[A-Za-z_][A-Za-z0-9_.-]*/u);
    if (identifier) {
      tokens.push({ kind: "identifier", value: identifier[0] });
      cursor += identifier[0].length;
      continue;
    }
    throw new SyntaxError(
      `unexpected token near "${rest.slice(0, Math.min(rest.length, 12))}"`,
    );
  }
  return tokens;
};

const parseComparisonValue = (token: Token | undefined): HookScalar => {
  if (token === undefined) {
    throw new SyntaxError("missing comparison value");
  }
  switch (token.kind) {
    case "string":
    case "number":
    case "boolean":
      return token.value;
    case "null":
      return null;
    default:
      throw new SyntaxError("comparison value must be a scalar literal");
  }
};

const parseHookMatcherExpression = (expression: string): ExpressionNode => {
  const tokens = tokenizeExpression(expression);
  let cursor = 0;

  const peek = (): Token | undefined => tokens[cursor];
  const consume = (): Token | undefined => {
    const token = tokens[cursor];
    if (token !== undefined) {
      cursor += 1;
    }
    return token;
  };

  const parsePrimary = (): ExpressionNode => {
    const token = consume();
    if (token === undefined) {
      throw new SyntaxError("unexpected end of expression");
    }
    if (token.kind === "operator" && token.value === "!") {
      return { kind: "not", child: parsePrimary() };
    }
    if (token.kind === "paren" && token.value === "(") {
      const node = parseOr();
      const closing = consume();
      if (closing?.kind !== "paren" || closing.value !== ")") {
        throw new SyntaxError('missing ")"');
      }
      return node;
    }
    if (token.kind !== "identifier") {
      throw new SyntaxError("comparison must start with an identifier");
    }
    const operator = consume();
    if (
      operator?.kind !== "operator" ||
      (operator.value !== "==" && operator.value !== "!=")
    ) {
      throw new SyntaxError('comparison operator must be "==" or "!="');
    }
    return {
      kind: "comparison",
      op: operator.value,
      path: token.value,
      value: parseComparisonValue(consume()),
    };
  };

  const parseAnd = (): ExpressionNode => {
    let node = parsePrimary();
    for (;;) {
      const next = peek();
      if (next === undefined || next.kind !== "operator" || next.value !== "&&") {
        break;
      }
      consume();
      node = {
        kind: "binary",
        op: "&&",
        left: node,
        right: parsePrimary(),
      };
    }
    return node;
  };

  const parseOr = (): ExpressionNode => {
    let node = parseAnd();
    for (;;) {
      const next = peek();
      if (next === undefined || next.kind !== "operator" || next.value !== "||") {
        break;
      }
      consume();
      node = {
        kind: "binary",
        op: "||",
        left: node,
        right: parseAnd(),
      };
    }
    return node;
  };

  const tree = parseOr();
  if (cursor !== tokens.length) {
    throw new SyntaxError("unexpected trailing tokens");
  }
  return tree;
};

const readFactPath = (
  facts: HookFactMap,
  path: string,
): HookFactValue | undefined => {
  let current: HookFactValue | undefined = facts;
  for (const segment of path.split(".")) {
    if (!isRecord(current)) {
      return undefined;
    }
    current = current[segment];
  }
  return current;
};

const valuesEqual = (
  left: HookFactValue | undefined,
  right: HookScalar,
): boolean => {
  if (Array.isArray(left)) {
    return false;
  }
  return left === right;
};

const evaluateExpressionNode = (
  node: ExpressionNode,
  facts: HookFactMap,
): boolean => {
  switch (node.kind) {
    case "binary":
      if (node.op === "&&") {
        return (
          evaluateExpressionNode(node.left, facts) &&
          evaluateExpressionNode(node.right, facts)
        );
      }
      return (
        evaluateExpressionNode(node.left, facts) ||
        evaluateExpressionNode(node.right, facts)
      );
    case "not":
      return !evaluateExpressionNode(node.child, facts);
    case "comparison": {
      const equal = valuesEqual(readFactPath(facts, node.path), node.value);
      return node.op === "==" ? equal : !equal;
    }
  }
};

export const evaluateHookMatcherExpression = (
  expression: string,
  facts: HookFactMap,
): boolean => {
  return evaluateExpressionNode(parseHookMatcherExpression(expression), facts);
};

const validateIfExpression = (
  matcher: HookMatcher,
  index: number,
): HookValidationRefusal[] => {
  try {
    parseHookMatcherExpression(matcher.if);
    return [];
  } catch (error) {
    return [
      {
        index,
        code: "hook_if_invalid",
        message:
          error instanceof Error
            ? `hook[${index}] invalid if expression: ${error.message}`
            : `hook[${index}] invalid if expression`,
      },
    ];
  }
};

const validateHttpCommand = (
  command: HookCommandHttp,
  index: number,
  policy: HookRuntimePolicy,
): HookValidationRefusal[] => {
  const refusals: HookValidationRefusal[] = [];
  if (TELEMETRY_URL_RE.test(command.url)) {
    refusals.push({
      index,
      code: "hook_telemetry_url_blocked",
      message: `hook[${index}] URL resembles telemetry and is blocked`,
    });
  }
  let parsed: URL;
  try {
    parsed = new URL(command.url);
  } catch {
    refusals.push({
      index,
      code: "hook_http_domain_not_allowlisted",
      message: `hook[${index}] URL is malformed`,
    });
    return refusals;
  }
  if (parsed.protocol !== "https:") {
    refusals.push({
      index,
      code: "hook_http_domain_not_allowlisted",
      message: `hook[${index}] URL must use https`,
    });
  } else if (!isHostAllowed(parsed.hostname, policy.allowedHttpHosts)) {
    refusals.push({
      index,
      code: "hook_http_domain_not_allowlisted",
      message: `hook[${index}] host "${parsed.hostname}" is not allowlisted`,
    });
  }
  const allowedEnvVars = new Set(command.allowedEnvVars ?? []);
  for (const [headerName, headerValue] of Object.entries(command.headers)) {
    if (headerName.trim().length === 0) {
      refusals.push({
        index,
        code: "hook_http_header_invalid",
        message: `hook[${index}] header names must be non-empty`,
      });
    }
    for (const match of headerValue.matchAll(ENV_PLACEHOLDER_RE)) {
      const variable = match[1];
      if (variable !== undefined && !allowedEnvVars.has(variable)) {
        refusals.push({
          index,
          code: "hook_http_header_invalid",
          message: `hook[${index}] header interpolation variable "${variable}" is not allowlisted`,
        });
      }
    }
  }
  return refusals;
};

export const validateHookMatchers = (
  hooks: readonly HookMatcher[],
  policy: HookRuntimePolicy = {},
): HookValidationResult => {
  const refusals: HookValidationRefusal[] = [];
  for (const [index, hook] of hooks.entries()) {
    if (!isHookEvent(hook.event)) {
      refusals.push({
        index,
        code: "hook_schema_invalid",
        message: `hook[${index}] event must be a known HookEvent`,
      });
    }
    if (hook.asyncRewake === true && hook.async !== true) {
      refusals.push({
        index,
        code: "hook_async_rewake_requires_async",
        message: `hook[${index}] asyncRewake requires async=true`,
      });
    }
    if (policy.policyProfile === "banking") {
      if (hook.signedBundleId === undefined) {
        refusals.push({
          index,
          code: "hook_bundle_unsigned",
          message: `hook[${index}] banking profile requires signedBundleId`,
        });
      } else if (!SIGNED_BUNDLE_ID_RE.test(hook.signedBundleId)) {
        refusals.push({
          index,
          code: "hook_bundle_unregistered",
          message: `hook[${index}] signedBundleId is malformed`,
        });
      } else if (
        policy.registeredSignedBundleIds !== undefined &&
        !policy.registeredSignedBundleIds.has(hook.signedBundleId)
      ) {
        refusals.push({
          index,
          code: "hook_bundle_unregistered",
          message: `hook[${index}] signedBundleId "${hook.signedBundleId}" is not registered`,
        });
      }
    }
    refusals.push(...validateIfExpression(hook, index));
    if (hook.command.kind === "http") {
      refusals.push(...validateHttpCommand(hook.command, index, policy));
    }
  }
  return {
    ok: refusals.length === 0,
    refusals,
  };
};

const matcherDigest = (matcher: HookMatcher): string =>
  createHash("sha256").update(JSON.stringify(matcher)).digest("hex");

const interpolateHeaderValue = (
  value: string,
  allowedEnvVars: ReadonlySet<string>,
  env: Readonly<Record<string, string | undefined>>,
): string => {
  return value.replace(ENV_PLACEHOLDER_RE, (_match, variable: string) => {
    if (!allowedEnvVars.has(variable)) {
      throw new RangeError(
        `header interpolation variable "${variable}" is not allowlisted`,
      );
    }
    const resolved = env[variable];
    if (resolved === undefined) {
      throw new RangeError(
        `header interpolation variable "${variable}" is not present`,
      );
    }
    return resolved;
  });
};

export const resolveHookHttpCommand = (
  command: HookCommandHttp,
  env: Readonly<Record<string, string | undefined>> = {},
): ResolvedHookHttpCommand => {
  const allowedEnvVars = new Set(command.allowedEnvVars ?? []);
  return {
    ...command,
    headers: Object.fromEntries(
      Object.entries(command.headers).map(([name, value]) => [
        name,
        interpolateHeaderValue(value, allowedEnvVars, env),
      ]),
    ),
  };
};

const executeHookCommand = async (
  matcher: HookMatcher,
  index: number,
  facts: HookExecutionFacts,
  executors: HookExecutors,
  env: Readonly<Record<string, string | undefined>>,
): Promise<unknown> => {
  const context: HookCommandExecutionContext = { index, matcher, facts };
  switch (matcher.command.kind) {
    case "command":
      if (executors.command === undefined) {
        throw new Error("missing command hook executor");
      }
      return executors.command(matcher.command, context);
    case "prompt":
      if (executors.prompt === undefined) {
        throw new Error("missing prompt hook executor");
      }
      return executors.prompt(matcher.command, context);
    case "http":
      if (executors.http === undefined) {
        throw new Error("missing http hook executor");
      }
      return executors.http(resolveHookHttpCommand(matcher.command, env), context);
    case "agent":
      if (executors.agent === undefined) {
        throw new Error("missing agent hook executor");
      }
      return executors.agent(matcher.command, context);
  }
};

const createDefaultState = (): HookExecutionState => ({
  onceDigests: new Set<string>(),
});

export const runHookMatchersForEvent = async (
  input: RunHookMatchersInput,
): Promise<readonly HookExecutionRecord[]> => {
  const policyProfile = input.policy?.policyProfile ?? input.facts.policyProfile;
  const policy: HookRuntimePolicy = {
    ...(policyProfile !== undefined ? { policyProfile } : {}),
    ...(input.policy?.allowedHttpHosts !== undefined
      ? { allowedHttpHosts: input.policy.allowedHttpHosts }
      : {}),
    ...(input.policy?.maxConcurrentHooks !== undefined
      ? { maxConcurrentHooks: input.policy.maxConcurrentHooks }
      : {}),
    ...(input.policy?.registeredSignedBundleIds !== undefined
      ? { registeredSignedBundleIds: input.policy.registeredSignedBundleIds }
      : {}),
  };
  const validation = validateHookMatchers(input.hooks, policy);
  if (!validation.ok) {
    return validation.refusals.map((refusal) => ({
      index: refusal.index,
      matcherDigest: matcherDigest(input.hooks[refusal.index]!),
      status: "refused",
      refusalCode: refusal.code,
    }));
  }

  const state = input.state ?? createDefaultState();
  const env = input.env ?? {};
  const maxConcurrentHooks = normalizeMaxConcurrentHooks(policy.maxConcurrentHooks);
  const records = new Array<HookExecutionRecord>(input.hooks.length);
  const pending = new Set<Promise<void>>();

  const waitForOnePending = async (): Promise<void> => {
    const firstPending = pending.values().next().value;
    if (firstPending !== undefined) {
      await firstPending;
    }
  };

  const flushPending = async (): Promise<void> => {
    await Promise.all([...pending]);
  };

  for (const [index, matcher] of input.hooks.entries()) {
    const digest = matcherDigest(matcher);
    if (matcher.event !== input.event) {
      records[index] = {
        index,
        matcherDigest: digest,
        status: "filtered",
      };
      continue;
    }
    if (!evaluateHookMatcherExpression(matcher.if, input.facts)) {
      records[index] = {
        index,
        matcherDigest: digest,
        status: "filtered",
      };
      continue;
    }
    if (matcher.once === true && state.onceDigests.has(digest)) {
      records[index] = {
        index,
        matcherDigest: digest,
        status: "skipped_once",
      };
      continue;
    }

    const run = async (): Promise<void> => {
      const result = await executeHookCommand(
        matcher,
        index,
        input.facts,
        input.executors,
        env,
      );
      records[index] = {
        index,
        matcherDigest: digest,
        status: "executed",
        result,
      };
      if (matcher.once === true) {
        state.onceDigests.add(digest);
      }
    };

    if (matcher.async === true) {
      const promise = run().finally(() => {
        pending.delete(promise);
      });
      pending.add(promise);
      if (pending.size >= maxConcurrentHooks) {
        await waitForOnePending();
      }
      continue;
    }

    await flushPending();
    await run();
  }

  await flushPending();
  return records;
};
