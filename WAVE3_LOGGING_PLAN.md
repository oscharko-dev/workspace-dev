# Wave 3: Error Logging Integration Plan

## Overview

Most error logging already routes through `createPipelineError()` or `getErrorMessage()`. Wave 3 focuses on:

1. Ensuring PipelineError's toJSON() prevents cause exposure
2. Verifying onLog() receives sanitized messages
3. Updating any direct error.stack access
4. Ensuring JSON serialization is safe

## Key Integration Points

### 1. PipelineError (src/job-engine/errors.ts)

**Current flow:**

- Constructor: sanitizes message via `redactHighRiskSecrets()`
- Constructor: passes raw cause to super()
- onLog calls: use `getErrorMessage(error)` to extract .message

**Changes needed:**

- Add toJSON() method to return sanitized JSON
- Ensure cause chain is not included in JSON serialization
- Diagnostic details should have secrets redacted

### 2. getErrorMessage() utility (src/job-engine/errors.ts, lines 462-467)

**Current:** Returns `error.message` or stringifies value
**Changes:** No changes needed - it extracts message only (not stack)

### 3. onLog() callbacks (26 call sites)

**Current:** Pass `getErrorMessage(error)` which extracts message
**Impact:** Already receive sanitized messages via createPipelineError()
**Verification:** Ensure no direct error.stack or cause access

### 4. Direct error.stack access (src/storybook/generate-artifact.ts, line 62)

**Current:** `error.stack ?? error.message` written to stderr
**Change needed:** Sanitize stack trace before writing

### 5. Error cause chains in createPipelineError() calls (40+ call sites)

**Current:** Cause is stored raw in PipelineError
**Status:** Already handled by Wave 2 PipelineError changes
**Verification:** Ensure toJSON() works correctly

## Files Requiring Wave 3 Changes

### Primary (need changes):

- `src/storybook/generate-artifact.ts` - sanitize error.stack for stderr output

### Secondary (verify no exposure):

- `src/logging.ts` - ensure error handling is safe
- `src/job-engine/errors.ts` - ensure toJSON() is implemented (Wave 2)
- Any file with direct `error.cause` access (trace and fix if not via createPipelineError)

## Verification Checklist

- [ ] PipelineError.toJSON() doesn't include cause
- [ ] Error.stack writes are sanitized (generate-artifact.ts)
- [ ] No direct `error.cause` access outside of createPipelineError
- [ ] onLog() calls receive properly sanitized errors
- [ ] JSON.stringify(pipelineErr) doesn't expose cause
- [ ] All 40+ createPipelineError() calls are verified safe
- [ ] No `util.inspect(error)` calls expose sensitive data

## Risk Assessment

**Low Risk Changes:**

- generate-artifact.ts line 62: sanitize stack

**Medium Risk Verification:**

- PipelineError.toJSON() effectiveness
- Diagnostic details redaction

**High Risk if Missed:**

- Any unhandled error.cause access
- Stack trace exposure in logs
- JSON serialization leaks

## Success Criteria

- All error objects logged through createPipelineError are sanitized
- No raw error chains in logs or serialized JSON
- All test cases pass (integration tests from Wave 4)
