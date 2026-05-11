import { test } from "node:test";
import * as assert from "node:assert/strict";
import { WORKSPACE_UI_CONTENT_SECURITY_POLICY } from "./constants";

test("WORKSPACE_UI_CONTENT_SECURITY_POLICY does not contain unsafe-inline", () => {
  assert.doesNotMatch(
    WORKSPACE_UI_CONTENT_SECURITY_POLICY,
    /unsafe-inline/,
    "CSP must not contain unsafe-inline to prevent inline styles",
  );
});

test("WORKSPACE_UI_CONTENT_SECURITY_POLICY has style-src 'self' only", () => {
  const styleSourceMatch =
    WORKSPACE_UI_CONTENT_SECURITY_POLICY.match(/style-src\s+[^;]+/);
  assert.ok(styleSourceMatch, "CSP should have style-src directive");
  const styleSource = styleSourceMatch[0];
  assert.match(
    styleSource,
    /style-src\s+'self'/,
    "style-src should allow 'self'",
  );
  assert.doesNotMatch(
    styleSource,
    /unsafe-inline|nonce-|strict-dynamic/,
    "style-src should not contain unsafe-inline, nonce, or strict-dynamic",
  );
});

test("WORKSPACE_UI_CONTENT_SECURITY_POLICY maintains required directives", () => {
  const required = [
    "default-src",
    "script-src",
    "style-src",
    "img-src",
    "connect-src",
    "font-src",
    "object-src",
    "base-uri",
    "form-action",
    "frame-ancestors",
  ];
  for (const directive of required) {
    assert.match(
      WORKSPACE_UI_CONTENT_SECURITY_POLICY,
      new RegExp(`\\b${directive}\\b`),
      `CSP should contain ${directive} directive`,
    );
  }
});
