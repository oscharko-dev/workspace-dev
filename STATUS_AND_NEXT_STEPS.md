# Issue #1155 Status & Next Steps (As of 10:55 AM)

## Completed Work

### Wave 1: Core Redaction Helper ✓

- **Agent:** aca4a853e952a17e2 (implementor)
- **Worktree:** /Users/oscharko/Projects/workspace-dev/.claude/worktrees/agent-aca4a853
- **Changes:**
  - Added `redactErrorChain()` function to src/error-sanitization.ts
  - Updated `sanitizeErrorMessage()` to detect and handle cause chains
  - Added 16 comprehensive test cases
  - All tests focus on: circular refs, depth limits, non-error causes, redaction patterns

- **Status:** Complete with tests (npm test running as of 10:50 AM)

### Wave 2: Error Class Integration (IN PROGRESS)

- **Agent:** aca4a853e952a17e2 (same agent, sent follow-up message at 10:47 AM)
- **Task:**
  - Update PipelineError constructor to sanitize cause via redactErrorChain()
  - Add toJSON() method to PipelineError to prevent cause exposure
  - Update sanitizeDiagnosticValue() to apply redaction
  - Apply same pattern to WorkflowError
- **Expected Completion:** Estimated 1-2 hours from start (started ~10:47 AM)

## Waiting For

1. **npm test** - Wave 1 tests (started 10:50 AM)
   - Output file: `/private/tmp/claude-501/.../tasks/b3bynmi0z.output`
   - Expected: All error-sanitization tests pass
2. **Wave 2 Agent Message** - Completion notification
   - Agent ID: aca4a853e952a17e2
   - Worktree: agent-aca4a853
   - Check: `git diff` to see error class changes

## Immediate Actions When Wakeup Fires

### Priority 1: Verify Tests Pass

```bash
npm test -- src/error-sanitization.test.ts
# Look for: no failures in redactErrorChain* tests
```

### Priority 2: Check Wave 2 Status

```bash
cd /Users/oscharko/Projects/workspace-dev/.claude/worktrees/agent-aca4a853
git diff src/job-engine/errors.ts | head -100
# Look for: PipelineError constructor changes, toJSON() method
```

### Priority 3: If Both Complete

1. Copy Wave 2 changes to main worktree:
   ```bash
   cp src/job-engine/errors.ts src/parity/workflow-error.ts \
      /Users/oscharko/Projects/workspace-dev/.claude/worktrees/nice-tereshkova-4a52e9/src/
   ```
2. Run full test suite:
   ```bash
   npm test -- src/job-engine/errors.test.ts src/error-sanitization.test.ts
   ```
3. If tests pass:
   - Commit: `git add -A && git commit -m "..."`
   - Start Wave 3 (use WAVE3_LOGGING_PLAN.md)

### Priority 4: If Blocked

- Contact implementor via SendMessage
- Review blockers in output files
- Adjust scope or approach as needed

## Wave 3: Logging Integration (NEXT)

**When:** After Waves 1-2 pass tests
**Focus:**

- Ensure PipelineError.toJSON() is safe
- Update error.stack sanitization in generate-artifact.ts
- Verify no direct cause chain exposure in logs
  **Estimated Duration:** 1-2 hours

## Wave 4: Integration Tests (AFTER Wave 3)

**When:** After Wave 3 complete
**Focus:**

- Add end-to-end error chain tests
- Test JSON serialization safety
- Test real Figma API error scenarios
  **Estimated Duration:** 1-2 hours

## Security Review & PR

**When:** After all waves pass tests
**Steps:**

1. Spawn security-auditor agent
2. Review all changes
3. Commit and push
4. Create PR against origin/dev
5. Monitor CI

## Key Files to Watch

- src/error-sanitization.ts - Wave 1 ✓
- src/job-engine/errors.ts - Wave 2 (in progress)
- src/parity/workflow-error.ts - Wave 2 (in progress)
- src/storybook/generate-artifact.ts - Wave 3 (pending)
- src/**tests**/ - Wave 4 (pending)

## Commit Message Template

```
security(#1155): Add error cause chain redaction

- Implement redactErrorChain() with cycle detection and depth limit
- Integrate into PipelineError and WorkflowError constructors
- Add toJSON() methods to prevent cause exposure
- Update diagnostic details redaction
- Comprehensive test coverage for cause chain scenarios

Fixes #1155
```
