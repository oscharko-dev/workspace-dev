import assert from "node:assert/strict";
import test from "node:test";
import { LlmClient, LlmClientError, isLlmClientError } from "./llm.js";

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

  await assert.rejects(
    () => client.generateTheme({ sourceName: "demo", screens: [], tokens: { palette: { primary: "#1", secondary: "#2", background: "#3", text: "#4" }, borderRadius: 8, spacingBase: 8, fontFamily: "Roboto", headingSize: 24, bodySize: 14 } }),
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
          palette: { primary: "#1", secondary: "#2", background: "#3", text: "#4" },
          borderRadius: 8,
          spacingBase: 8,
          fontFamily: "Roboto",
          headingSize: 24,
          bodySize: 14
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
          palette: { primary: "#1", secondary: "#2", background: "#3", text: "#4" },
          borderRadius: 8,
          spacingBase: 8,
          fontFamily: "Roboto",
          headingSize: 24,
          bodySize: 14
        },
        baselineSource: "baseline"
      }),
    (error: unknown) => (error as { code?: string }).code === "E_LLM_TRANSPORT"
  );
});
