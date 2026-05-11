import assert from "node:assert/strict";
import test from "node:test";

import {
  isBrandedId,
  toJobId,
  toRoleStepId,
  validateBrandedIdLabel,
} from "./branded-ids.js";
import { generateJobId, generateRoleStepId } from "../test-intelligence/branded-id-generation.js";

test("branded ids accept the wd-* shape and reject unrelated strings", () => {
  assert.equal(isBrandedId("wd-0123456789abcdef"), true);
  assert.equal(isBrandedId("wd-test-generation-0123456789abcdef"), true);
  assert.equal(isBrandedId("job-123"), false);
  assert.equal(toJobId("wd-0123456789abcdef"), "wd-0123456789abcdef");
  assert.equal(toRoleStepId("job-123"), null);
});

test("branded id generation uses the wd-* format with optional normalized labels", () => {
  const jobId = generateJobId("Test-Generation");
  const roleStepId = generateRoleStepId();
  assert.match(jobId, /^wd-test-generation-[0-9a-f]{16}$/u);
  assert.match(roleStepId, /^wd-[0-9a-f]{16}$/u);
  assert.equal(validateBrandedIdLabel("Test-Generation"), "test-generation");
  assert.equal(validateBrandedIdLabel("bad label!"), null);
});
