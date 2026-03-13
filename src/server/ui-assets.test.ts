import assert from "node:assert/strict";
import test from "node:test";
import { getUiAsset } from "./ui-assets.js";

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
});
