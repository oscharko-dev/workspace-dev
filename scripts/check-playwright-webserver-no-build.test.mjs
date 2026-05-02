import assert from "node:assert/strict";
import test from "node:test";
import { analyzeSourceText } from "./check-playwright-webserver-no-build.mjs";

test("analyzeSourceText accepts a build-free webServer.command", () => {
  const findings = analyzeSourceText({
    filePath: "playwright.config.ts",
    text: `
      export default defineConfig({
        webServer: {
          command: \`pnpm exec vite preview --host 127.0.0.1 --port 4174 --strictPort\`,
          url: "http://127.0.0.1:4174",
          timeout: 120_000,
        },
      });
    `,
  });
  assert.deepEqual(findings, []);
});

test("analyzeSourceText flags the #1665 regression (pnpm run build &&)", () => {
  const findings = analyzeSourceText({
    filePath: "playwright.config.ts",
    text:
      `export default defineConfig({\n` +
      `  webServer: {\n` +
      `    command: \`pnpm run build && pnpm exec vite preview --port 4174\`,\n` +
      `    url: "http://127.0.0.1:4174",\n` +
      `  },\n` +
      `});\n`,
  });
  assert.equal(findings.length, 1);
  assert.equal(findings[0].fragment, "pnpm run build");
});

test("analyzeSourceText flags vite build embedded in webServer.command", () => {
  const findings = analyzeSourceText({
    filePath: "playwright.config.ts",
    text:
      "export default defineConfig({" +
      " webServer: { command: 'vite build && vite preview', url: 'x' }" +
      "});",
  });
  assert.equal(findings.length, 1);
  assert.equal(findings[0].fragment, "vite build");
});

test("analyzeSourceText flags tsc --build chained into webServer.command", () => {
  const findings = analyzeSourceText({
    filePath: "playwright.config.ts",
    text:
      "export default defineConfig({" +
      ' webServer: { command: "tsc --build && vite preview", url: "x" }' +
      "});",
  });
  assert.equal(findings.length, 1);
});

test("analyzeSourceText ignores build fragments outside webServer.command", () => {
  const findings = analyzeSourceText({
    filePath: "some-script.ts",
    text: `
      // The orchestrator runs \`pnpm run build\` upstream.
      // This comment must not trigger the lint.
      export const fooBar = "vite build runs in another step";
    `,
  });
  assert.deepEqual(findings, []);
});

test("analyzeSourceText flags every distinct fragment in a single command", () => {
  const findings = analyzeSourceText({
    filePath: "playwright.config.ts",
    text:
      "export default defineConfig({" +
      " webServer: { command: 'pnpm run build && tsc --build && vite preview', url: 'x' }" +
      "});",
  });
  // Both `pnpm run build` and `tsc --build` are forbidden; both should flag.
  assert.ok(findings.length >= 2);
  const fragments = new Set(findings.map((f) => f.fragment));
  assert.ok(fragments.has("pnpm run build"));
  assert.ok(fragments.has("tsc --build"));
});
