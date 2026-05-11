import assert from "node:assert/strict";
import test from "node:test";
import {
  parseProfileGateArgs,
  profilesFromIds,
  sbomDocumentsForProfile,
} from "./profile-gate-utils.mjs";

test("parseProfileGateArgs defaults to all release profiles in contract order", () => {
  assert.deepEqual(parseProfileGateArgs([]).profileIds, [
    "default",
    "rocket",
    "default-rocket",
  ]);
});

test("parseProfileGateArgs normalizes profile aliases", () => {
  assert.deepEqual(
    parseProfileGateArgs(["--profile", "default,rocket"]).profileIds,
    ["default-rocket"],
  );
});

test("sbomDocumentsForProfile includes only selected profile templates", () => {
  const [defaultProfile, rocketProfile] = profilesFromIds(["default", "rocket"]);

  assert.deepEqual(
    sbomDocumentsForProfile(defaultProfile).map((document) => document.label),
    ["workspace-dev", "figma-generated-app-react-tailwind"],
  );
  assert.deepEqual(
    sbomDocumentsForProfile(rocketProfile).map((document) => document.label),
    ["workspace-dev", "figma-generated-app-react-mui"],
  );
});
