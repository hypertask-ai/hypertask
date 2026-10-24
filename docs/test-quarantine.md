# Test Quarantine System

## Purpose

The test quarantine system isolates flaky tests that cause CI reruns without removing them from the suite. Quarantined tests still run and report, but don't fail the required check.

## When to Quarantine

A test should be quarantined only when:

1. **It's proven flaky**: Same commit SHA failed, then passed on rerun (at least twice)
2. **It has a fix in progress**: There's an open ticket/PR tracking the fix
3. **It's temporary**: Quarantine is a holding pen while the root cause is fixed

**Do not quarantine:**
- Tests that fail consistently (those are real bugs - fix them)
- Tests you don't want to fix (delete those tests instead)
- Tests that are "sometimes slow" but never actually fail

## How to Quarantine

### 1. Prove Flakiness

Run the flaky test detector:

```bash
node scripts/detect-flaky-tests.mjs --days=14 > docs/flaky-tests-report.md
```

This finds tests where the same commit SHA both failed and passed. Only tests in this report should be quarantined.

### 2. Add to Quarantine List

Edit `config/quarantined-tests.json`:

```json
{
  "tests": [
    {
      "test": "tests/example-flaky.test.cjs",
      "owner": "hypertask-ai/engineering",
      "ticket": "https://github.com/hypertask-ai/hypertask/issues/1234",
      "evidence": [
        "https://github.com/hypertask-ai/hypertask/actions/runs/123456",
        "https://github.com/hypertask-ai/hypertask/commit/abc123"
      ],
      "reason": "Race condition in async cleanup causes intermittent timeout",
      "addedAt": "2026-10-24"
    }
  ]
}
```

**Required fields:**
- `test`: Test name or file path (from the flaky report)
- `owner`: GitHub username or team (@-mention format)
- `ticket`: URL of the issue or PR fixing this test
- `evidence`: At least 2 links (failed run + proof it passed on same SHA)
- `reason`: Why is it flaky? (10+ characters)
- `addedAt`: Date quarantined (YYYY-MM-DD)

### 3. Verify Lint Passes

The quarantine lint check (`tests/quarantined-tests-lint.test.cjs`) enforces all required fields:

```bash
npm test -- tests/quarantined-tests-lint.test.cjs
```

This check runs in CI and fails if any entry is missing required metadata.

### 4. Track and Fix

- Quarantine is temporary - fix the test within 30 days
- The lint check warns about tests quarantined longer than 30 days
- Remove from quarantine once fixed and stable

## How It Works

1. **Detection**: `scripts/detect-flaky-tests.mjs` finds same-SHA fail-then-pass patterns in CI history
2. **Configuration**: `config/quarantined-tests.json` lists quarantined tests with metadata
3. **Enforcement**: `tests/quarantined-tests-lint.test.cjs` validates the quarantine list
4. **Runtime**: Future enhancement will mark quarantined test failures as non-blocking

## Current State

As of 2026-10-24, the quarantine list is empty. The detection script found 2 SHAs with fail-then-pass patterns in the last 14 days, but they were infrastructure failures, not test failures.

This is good news - it means flaky tests are not currently a major problem.

## Detection Script Output

The latest flaky test report is at `docs/flaky-tests-report.md`.

Run it with:
```bash
node scripts/detect-flaky-tests.mjs --days=30 --limit=2000
```

## Lint Check

Add this test to the regular suite to enforce quarantine metadata:
```bash
npm test -- tests/quarantined-tests-lint.test.cjs
```

## Root Cause Analysis

For the top 3 flaky tests (when any exist), investigate:
- **Timing**: Race conditions, timeouts, or delays?
- **State**: Shared state or cleanup issues?
- **External dependencies**: Network, file system, or database flakes?
- **Environment**: CI-specific issues (resources, parallelism)?

Document findings in the ticket and fix the root cause, don't just quarantine forever.
