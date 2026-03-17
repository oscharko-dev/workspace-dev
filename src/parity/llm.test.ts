import assert from "node:assert/strict";
import test from "node:test";
import { LlmClient, LlmClientError, isLlmClientError } from "./llm.js";
import { buildTypographyScaleFromAliases } from "./typography-tokens.js";

const palette = {
  primary: "#111111",
  secondary: "#222222",
  background: "#333333",
  text: "#444444",
  success: "#555555",
  warning: "#666666",
  error: "#777777",
  info: "#888888",
  divider: "#999999",
  action: {
    active: "#aaaaaa",
    hover: "#bbbbbb",
    selected: "#cccccc",
    disabled: "#dddddd",
    disabledBackground: "#eeeeee",
    focus: "#ffffff"
  }
};

test("LlmClientError exposes code/endpoint/status and type guard", () => {
  const error = new LlmClientError({
    code: "E_LLM_PROVIDER_HTTP",
    message: "provider failed",
    endpoint: "/v1/chat/completions",
    status: 500,
    cause: new Error("boom")
  });

  assert.equal(error.name, "LlmClientError");
  assert.equal(error.code, "E_LLM_PROVIDER_HTTP");
  assert.equal(error.endpoint, "/v1/chat/completions");
  assert.equal(error.status, 500);
  assert.equal(isLlmClientError(error), true);
  assert.equal(isLlmClientError(new Error("x")), false);
});

test("LlmClient deterministic runtime methods reject with transport error", async () => {
  const client = new LlmClient();
  const typography = buildTypographyScaleFromAliases({
    fontFamily: "Roboto",
    headingSize: 24,
    bodySize: 14
  });

  await assert.rejects(
    () =>
      client.generateTheme({
        sourceName: "demo",
        screens: [],
        tokens: {
          palette,
          borderRadius: 8,
          spacingBase: 8,
          fontFamily: "Roboto",
          headingSize: 24,
          bodySize: 14,
          typography
        }
      }),
    (error: unknown) => (error as { code?: string }).code === "E_LLM_TRANSPORT"
  );

  await assert.rejects(
    () =>
      client.generateScreen(
        {
          id: "s1",
          name: "Screen",
          layoutMode: "NONE",
          gap: 0,
          padding: { top: 0, right: 0, bottom: 0, left: 0 },
          children: []
        },
        {
          palette,
          borderRadius: 8,
          spacingBase: 8,
          fontFamily: "Roboto",
          headingSize: 24,
          bodySize: 14,
          typography
        },
        "src/screens/Screen.tsx"
      ),
    (error: unknown) => (error as { code?: string }).code === "E_LLM_TRANSPORT"
  );

  await assert.rejects(
    () =>
      client.generateScreenFromBaseline({
        screen: {
          id: "s1",
          name: "Screen",
          layoutMode: "NONE",
          gap: 0,
          padding: { top: 0, right: 0, bottom: 0, left: 0 },
          children: []
        },
        tokens: {
          palette,
          borderRadius: 8,
          spacingBase: 8,
          fontFamily: "Roboto",
          headingSize: 24,
          bodySize: 14,
          typography
        },
        baselineSource: "baseline"
      }),
    (error: unknown) => (error as { code?: string }).code === "E_LLM_TRANSPORT"
  );
});
