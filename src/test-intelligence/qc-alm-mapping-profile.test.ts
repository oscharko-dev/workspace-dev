/**
 * Hand-rolled validator tests for the QC mapping profile (Issue #1368).
 *
 * Covers the four matrix points required by the issue:
 *   - valid profile (no errors)
 *   - missing required fields (actionable diagnostics with paths)
 *   - invalid target folder path (regex enforcement)
 *   - provider mismatch
 *
 * Plus credential-shaped field rejection (non-goal: do not persist QC
 * credentials).
 */

import assert from "node:assert/strict";
import test from "node:test";
import {
  type QcMappingProfile,
  type QcMappingProfileIssueCode,
} from "../contracts/index.js";
import {
  cloneOpenTextAlmDefaultMappingProfile,
  validateQcMappingProfile,
} from "./qc-alm-mapping-profile.js";

const codesOf = (
  result: ReturnType<typeof validateQcMappingProfile>,
): QcMappingProfileIssueCode[] => result.issues.map((i) => i.code);

test("qc-mapping-profile: valid profile yields ok=true with no errors", () => {
  const profile = cloneOpenTextAlmDefaultMappingProfile();
  const result = validateQcMappingProfile({
    profile,
    expectedProvider: "opentext_alm",
    expectedProfileId: "opentext-alm-default",
  });
  assert.equal(result.ok, true);
  assert.equal(result.errorCount, 0);
});

test("qc-mapping-profile: missing required fields produce actionable diagnostics", () => {
  const profile = cloneOpenTextAlmDefaultMappingProfile();
  // Wipe everything that has a presence check.
  const probe: QcMappingProfile = {
    ...profile,
    baseUrlAlias: "",
    domain: "",
    project: "",
    targetFolderPath: "",
    testEntityType: "",
    requiredFields: [],
    designStepMapping: { action: "", expected: "" },
  };
  const result = validateQcMappingProfile({ profile: probe });
  const codes = new Set(codesOf(result));
  assert.equal(result.ok, false);
  assert.ok(codes.has("missing_base_url_alias"));
  assert.ok(codes.has("missing_domain"));
  assert.ok(codes.has("missing_project"));
  assert.ok(codes.has("missing_target_folder_path"));
  assert.ok(codes.has("missing_test_entity_type"));
  assert.ok(codes.has("missing_required_fields"));
  assert.ok(codes.has("missing_design_step_mapping"));
  // Each issue must carry a JSON-pointer-shaped path.
  for (const issue of result.issues) {
    assert.match(issue.path, /^\/[A-Za-z]/);
    assert.ok(issue.message.length > 0);
  }
});

test("qc-mapping-profile: invalid target folder path rejected", () => {
  const profile = cloneOpenTextAlmDefaultMappingProfile();
  profile.targetFolderPath = "Subject/missing-leading-slash";
  const result = validateQcMappingProfile({ profile });
  assert.equal(result.ok, false);
  assert.ok(codesOf(result).includes("invalid_target_folder_path"));
});

test("qc-mapping-profile: invalid path: trailing slash and empty segments", () => {
  const profile = cloneOpenTextAlmDefaultMappingProfile();
  profile.targetFolderPath = "/Subject/Imported/";
  const r1 = validateQcMappingProfile({ profile });
  assert.ok(codesOf(r1).includes("invalid_target_folder_path"));
  profile.targetFolderPath = "/Subject//Empty";
  const r2 = validateQcMappingProfile({ profile });
  assert.ok(codesOf(r2).includes("invalid_target_folder_path"));
});

test("qc-mapping-profile: provider mismatch produces a single error", () => {
  const profile = cloneOpenTextAlmDefaultMappingProfile();
  profile.provider = "xray";
  const result = validateQcMappingProfile({
    profile,
    expectedProvider: "opentext_alm",
  });
  const codes = codesOf(result);
  assert.ok(codes.includes("provider_mismatch"));
  assert.equal(result.ok, false);
});

test("qc-mapping-profile: credential-like requiredFields are rejected", () => {
  const profile = cloneOpenTextAlmDefaultMappingProfile();
  profile.requiredFields = [
    "name",
    "apiToken",
    "user-template-id",
    "owner",
    "BearerSecret",
  ];
  const result = validateQcMappingProfile({ profile });
  const credentialIssues = result.issues.filter(
    (i) => i.code === "credential_like_field_present",
  );
  assert.ok(credentialIssues.length >= 2);
  for (const issue of credentialIssues) {
    assert.equal(issue.severity, "error");
    assert.match(issue.path, /^\/requiredFields\/\d+$/);
  }
});

test("qc-mapping-profile: credential-like baseUrlAlias rejected", () => {
  const profile = cloneOpenTextAlmDefaultMappingProfile();
  profile.baseUrlAlias = "https://user:secret@host";
  const result = validateQcMappingProfile({ profile });
  const codes = codesOf(result);
  assert.ok(codes.includes("invalid_base_url_alias"));
});

test("qc-mapping-profile: duplicate requiredFields flagged", () => {
  const profile = cloneOpenTextAlmDefaultMappingProfile();
  profile.requiredFields = ["name", "owner", "name"];
  const result = validateQcMappingProfile({ profile });
  assert.ok(codesOf(result).includes("duplicate_required_field"));
});

test("qc-mapping-profile: unsupported testEntityType warns but does not block", () => {
  const profile = cloneOpenTextAlmDefaultMappingProfile();
  profile.testEntityType = "EXOTIC";
  const result = validateQcMappingProfile({ profile });
  const issue = result.issues.find(
    (i) => i.code === "unsupported_test_entity_type",
  );
  assert.ok(issue);
  assert.equal(issue?.severity, "warning");
});

test("qc-mapping-profile: missing designStepMapping action+expected blocks", () => {
  const profile = cloneOpenTextAlmDefaultMappingProfile();
  profile.designStepMapping = { action: "", expected: "" };
  const result = validateQcMappingProfile({ profile });
  const codes = codesOf(result);
  assert.equal(
    codes.filter((c) => c === "missing_design_step_mapping").length,
    2,
    "expected one error per missing required step field",
  );
});

test("qc-mapping-profile: profile id mismatch is a warning, not an error", () => {
  const profile = cloneOpenTextAlmDefaultMappingProfile();
  const result = validateQcMappingProfile({
    profile,
    expectedProfileId: "some-other-profile",
  });
  const issue = result.issues.find((i) => i.code === "profile_id_mismatch");
  assert.ok(issue);
  assert.equal(issue?.severity, "warning");
  assert.equal(result.ok, true);
});

test("qc-mapping-profile: ALL issues carry JSON-pointer paths and messages", () => {
  const profile = cloneOpenTextAlmDefaultMappingProfile();
  profile.baseUrlAlias = "";
  profile.designStepMapping = { action: "", expected: "" };
  const result = validateQcMappingProfile({ profile });
  for (const issue of result.issues) {
    assert.match(issue.path, /^\/[A-Za-z]/);
    assert.ok(issue.message.length > 0);
  }
});
