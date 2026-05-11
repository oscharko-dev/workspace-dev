import assert from "node:assert/strict";
import test from "node:test";
import { collectNormalizedIconKeys, collectStorybookAssetMetadata, normalizeIconKey } from "./icon-library-resolution.js";

test("normalizeIconKey normalizes ic_ names, semantic aliases, and brand-prefixed names", () => {
  assert.equal(normalizeIconKey({ value: "ic_chevron_left" }), "chevron_left");
  assert.equal(normalizeIconKey({ value: "Icon/Email" }), "mail");
  assert.equal(normalizeIconKey({ value: "Sparkasse/Icon/MailOutlined" }), "sparkasse.mail");
});

test("collectNormalizedIconKeys prefers discriminating variant properties over generic icon family names", () => {
  assert.deepEqual(
    collectNormalizedIconKeys({
      candidates: ["Icon"],
      variantProperties: [
        {
          property: "Name",
          values: ["SearchOutlined"]
        }
      ]
    }),
    ["search"]
  );
});

test("collectStorybookAssetMetadata detects icon and illustration entries and exposes normalized asset keys", () => {
  assert.deepEqual(
    collectStorybookAssetMetadata({
      title: "Assets/Icons/Icon",
      name: "Mail",
      args: {
        name: "MailOutlined"
      }
    }),
    {
      assetKind: "icon",
      assetKeys: ["mail"]
    }
  );
  assert.deepEqual(
    collectStorybookAssetMetadata({
      title: "Assets/Illustrations/Payment",
      name: "Default"
    }),
    {
      assetKind: "illustration",
      assetKeys: []
    }
  );
});
