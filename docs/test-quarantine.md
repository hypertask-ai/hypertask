# Test quarantine

`config/quarantined-tests.json` lists tests that still run and still print their failures, but do not fail `ci-tests`. `scripts/run-tests.mjs` reads that list. A failure stays red unless every failing leaf is named there.

Every entry needs an owner, an https ticket URL, at least two GitHub actions-run or commit evidence links, a reason, and `addedAt`. `tests/quarantined-tests-lint.test.cjs` fails the suite when one of those is missing.

Quarantine is only for a test the detector proved flaky: the ci-tests job failed and a later attempt of that same commit passed, on at least two commits. Same-code failures on different commits are reported and are not quarantined by that bar. The `test` field is the node test name the runner prints, without the `file ›` prefix.

```bash
node scripts/detect-flaky-tests.mjs --since 2026-10-10 --until 2026-10-24 --out docs/flaky-tests-report.md
```

The report separates three counts:

- Same-SHA ci-tests jobs that failed and later passed. Cancelled runs and browser-smoke-only failures are not in this count.
- Test names taken from a TAP `not ok` line or a spec `✖ name (duration)` line. A rate-limit or cancel line stays in the non-test table with that log line.
- Same-code flakes: the job failed on one SHA and passed on another, and the diff touches neither `src/`, `e2e/`, nor the failing test file.
