import assert from "node:assert/strict";
import test from "node:test";
import { extractImportPathToBundlePath, resolveIframeBundlePath } from "./iframe-import-map.js";

test("resolveIframeBundlePath reads the hashed iframe asset from iframe.html", () => {
  const iframeHtml = `
    <!doctype html>
    <html>
      <body>
        <script type="module" crossorigin src="./assets/iframe-C6LG5DgH.js"></script>
      </body>
    </html>
  `;

  assert.equal(resolveIframeBundlePath(iframeHtml), "assets/iframe-C6LG5DgH.js");
});

test("extractImportPathToBundlePath parses Storybook's hashed iframe import map", () => {
  const iframeBundle = `
    const gq0 = {
      "./docs/Guide/Guide.mdx": n(() => c0(() => import("./Guide-DI0KT0dr.js"), true ? __vite__mapDeps([1, 2]) : void 0, import.meta.url), "./docs/Guide/Guide.mdx"),
      "./src/components/Button/Button.stories.tsx": n(() => c0(() => import("./Button.stories-D9qwkbDK.js"), true ? __vite__mapDeps([3, 4]) : void 0, import.meta.url), "./src/components/Button/Button.stories.tsx")
    };
  `;

  const importMap = extractImportPathToBundlePath(iframeBundle);

  assert.equal(importMap.get("docs/Guide/Guide.mdx"), "assets/Guide-DI0KT0dr.js");
  assert.equal(
    importMap.get("src/components/Button/Button.stories.tsx"),
    "assets/Button.stories-D9qwkbDK.js"
  );
});
