import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { getUiAsset, getUiAssets } from "./ui-assets.js";

const createUiAssetMap = () => {
  return new Map([
    [
      "index.html",
      {
        contentType: "text/html; charset=utf-8",
        content: Buffer.from("<!doctype html><html></html>", "utf8")
      }
    ],
    [
      "assets/main.js",
      {
        contentType: "application/javascript; charset=utf-8",
        content: Buffer.from("console.log('ok');", "utf8")
      }
    ]
  ]);
};

test("getUiAsset resolves normalized UI asset paths", () => {
  const assets = createUiAssetMap();
  const indexAsset = getUiAsset({
    assets,
    assetPath: "index.html"
  });
  assert.ok(indexAsset);
  assert.equal(indexAsset.contentType, "text/html; charset=utf-8");

  const jsAsset = getUiAsset({
    assets,
    assetPath: "assets/main.js"
  });
  assert.ok(jsAsset);
  assert.equal(jsAsset.contentType, "application/javascript; charset=utf-8");
});

test("getUiAsset rejects traversal and invalid encoded paths", () => {
  const assets = createUiAssetMap();
  assert.equal(
    getUiAsset({
      assets,
      assetPath: "../index.html"
    }),
    undefined
  );
  assert.equal(
    getUiAsset({
      assets,
      assetPath: "%2e%2e/index.html"
    }),
    undefined
  );
  assert.equal(
    getUiAsset({
      assets,
      assetPath: "%E0%A4%A"
    }),
    undefined
  );
  assert.equal(
    getUiAsset({
      assets,
      assetPath: "bad%00path.js"
    }),
    undefined
  );
  assert.equal(
    getUiAsset({
      assets,
      assetPath: "/assets/main.js"
    }),
    undefined
  );
  assert.equal(
    getUiAsset({
      assets,
      assetPath: "./index.html"
    }),
    undefined
  );
});

test("getUiAsset resolves empty and slash-prefixed index paths", () => {
  const assets = createUiAssetMap();

  assert.equal(
    getUiAsset({
      assets,
      assetPath: ""
    })?.contentType,
    "text/html; charset=utf-8"
  );
  assert.equal(
    getUiAsset({
      assets,
      assetPath: "/"
    })?.contentType,
    "text/html; charset=utf-8"
  );
  assert.equal(
    getUiAsset({
      assets,
      assetPath: "assets\\main.js"
    })?.contentType,
    "application/javascript; charset=utf-8"
  );
});

test("getUiAssets resolves nested assets from ui-src/dist and reuses the cached map", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-ui-assets-"));
  const moduleDir = path.join(tempRoot, "server");
  const uiDistDir = path.join(tempRoot, "ui-src", "dist");
  const linkedAssetSource = path.join(tempRoot, "linked.js");

  await mkdir(path.join(uiDistDir, "assets"), { recursive: true });
  await writeFile(path.join(uiDistDir, "index.html"), "<!doctype html><html></html>\n", "utf8");
  await writeFile(path.join(uiDistDir, "assets", "main.css"), "body { color: black; }\n", "utf8");
  await writeFile(path.join(uiDistDir, "assets", "blob.bin"), "raw", "utf8");
  await writeFile(path.join(uiDistDir, "%2E%2E"), "skip decoded traversal\n", "utf8");
  await writeFile(linkedAssetSource, "console.log('linked');\n", "utf8");
  await symlink(linkedAssetSource, path.join(uiDistDir, "assets", "linked.js"));

  try {
    const first = await getUiAssets(moduleDir);
    const second = await getUiAssets(moduleDir);

    assert.equal(first, second);
    assert.equal(first.get("index.html")?.contentType, "text/html; charset=utf-8");
    assert.equal(first.get("assets/main.css")?.contentType, "text/css; charset=utf-8");
    assert.equal(first.get("assets/blob.bin")?.contentType, "application/octet-stream");
    assert.equal(first.has("../"), false);
    assert.equal(first.has("assets/linked.js"), false);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("getUiAssets ignores non-file entries and rejects resolved UI sources that still lack a real index asset", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-ui-assets-invalid-index-"));
  const moduleDir = path.join(tempRoot, "server");
  const embeddedUiDir = path.join(moduleDir, "ui");
  const linkedAssetSource = path.join(tempRoot, "linked.js");

  await mkdir(path.join(embeddedUiDir, "index.html"), { recursive: true });
  await mkdir(path.join(embeddedUiDir, "assets"), { recursive: true });
  await writeFile(linkedAssetSource, "console.log('linked');\n", "utf8");
  await symlink(linkedAssetSource, path.join(embeddedUiDir, "assets", "linked.js"));

  try {
    await assert.rejects(() => getUiAssets(moduleDir), /Missing index\.html in the resolved UI source directory/);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("getUiAssets clears failed cache entries after an unresolved UI bundle and succeeds once assets exist", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-ui-assets-retry-"));
  const moduleDir = path.join(tempRoot, "server");
  const embeddedUiDir = path.join(moduleDir, "ui");

  await mkdir(path.join(embeddedUiDir, "assets"), { recursive: true });
  await writeFile(path.join(embeddedUiDir, "assets", "main.js"), "console.log('missing index');\n", "utf8");

  try {
    await assert.rejects(() => getUiAssets(moduleDir), /Expected dist\/ui or ui-src\/dist/);

    await writeFile(path.join(embeddedUiDir, "index.html"), "<!doctype html><html></html>\n", "utf8");

    const assets = await getUiAssets(moduleDir);
    assert.equal(assets.get("index.html")?.contentType, "text/html; charset=utf-8");
    assert.equal(assets.get("assets/main.js")?.contentType, "application/javascript; charset=utf-8");
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});
