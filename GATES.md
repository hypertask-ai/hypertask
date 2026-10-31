# Gates: HYCI-32 run 2 — adopt PR 2623, clear its red checks

OWNS: .github/workflows/ci-tests.yml, tests/browser-smoke-workflow.test.cjs, tests/nextjs-build-cache.test.cjs, scripts/detect-flaky-tests.mjs, docs/ci/**, docs/ci.md, docs/ci-policy.yml

Scope: PR 2623 is open on branch ci-runner-2/hyci-32 and its checks are red. Run 1 landed the split; this run adopts the same PR, removes every red cause this repository's own rules name (the `local/no-comments` lint on three touched files and the fixture-search race that reddened the phone half), pushes, and records the recheck time. The split's shape, coverage and gating gates from run 1 stay in force and are re-proven here.

## Handoff (not a gate)

The ticket's "Done when" needs ten green production runs of both halves. A runner never waits for checks: this run ends once the branch is pushed, checks are running, and the recheck time is on the ticket's agent lane. The next run reads the real after-numbers and closes.

- [x] R1: HYCI-32 sat in its In Progress column while this run worked, and moved back to its review column once the branch was pushed
  EVIDENCE: met manually, 2026-10-31. `hypertask task get 32 --project 11514` reported section AI Review (32926) at run start, In Progress (32924) after `vcc task move HYCI-32 --section 32924`, and AI Review (32926) again after the push to c84847ba66. AI Review is board 11514's review column.

- [x] R2: No `local/no-comments` violation remains in the three files this run touched, proven by running the repository's own eslint over exactly those files
  CHECK: npx eslint scripts/detect-flaky-tests.mjs tests/browser-smoke-workflow.test.cjs tests/nextjs-build-cache.test.cjs && echo eslint clean
  EXPECT: eslint clean
  EVIDENCE: automatic-evidence=v1; definition-sha256=142ac6bcee2a8d83d3b7d5eb1676aaaeeb8cd5a5e705acfc539164647bf741f8; exit=0; EXPECT=matched; output-sha256=db8b7a89d130715964d121187ce27b606980a13a4f0b5ca0c0bc2b62fc1ed352; output-bytes=13; shell=/bin/sh; cwd=/home/valentin/projects/.worktrees/ci-runner-2-hyci-32; path=eb75ee63cfb0/37 entries

- [x] R3: Both browser halves wait for the fixture search server to answer /health, name its death with its log, and never fail on a bare one-shot curl
  CHECK: node .unlazy/hyci-32/run2.mjs search-wait
  EXPECT: search wait ok
  EVIDENCE: automatic-evidence=v1; definition-sha256=702c37dff44f20401d197991c796facd75f19dac4b2ce263ad5ebb8bb4f4450c; exit=0; EXPECT=matched; output-sha256=4004aac3a5a3e491c693932b97a8481f07974efc31e64eb3663ce21eee27fc1d; output-bytes=15; shell=/bin/sh; cwd=/home/valentin/projects/.worktrees/ci-runner-2-hyci-32; path=eb75ee63cfb0/37 entries

- [x] R4: Every browser spec/project pair the old single job ran is still run by exactly one half after this run's edits
  CHECK: node .unlazy/hyci-32/verify.mjs coverage
  EXPECT: browser coverage preserved
  EVIDENCE: automatic-evidence=v1; definition-sha256=cde5f1c3e99932e6e7aa24e5c0d349d58ab707b6f3d68fc1a884dfbbeb26ee37; exit=0; EXPECT=matched; output-sha256=aff34d0f31b35e25730acb9aed54d9b63005d6f98b08374793377c7420b48093; output-bytes=27; shell=/bin/sh; cwd=/home/valentin/projects/.worktrees/ci-runner-2-hyci-32; path=eb75ee63cfb0/37 entries

- [x] R5: One aggregate job named browser-smoke still gates on both halves, so a red half still blocks a merge
  CHECK: node .unlazy/hyci-32/verify.mjs workflow-shape
  EXPECT: workflow shape ok
  EVIDENCE: automatic-evidence=v1; definition-sha256=6c40b1a614ff0d10135257a5cbb17cc9f12a263daa678b184f80bf59732cd1a9; exit=0; EXPECT=matched; output-sha256=6968c6f4622e0e497ec17c86839c43342733230ad8c0cd6b4374a697a1a6f44c; output-bytes=18; shell=/bin/sh; cwd=/home/valentin/projects/.worktrees/ci-runner-2-hyci-32; path=eb75ee63cfb0/37 entries

- [x] R6: PR 2623 is still bound to HYCI-32, targets production, leaves auto-merge off, and carries only workflow, guard-test and CI-doc changes
  CHECK: node .unlazy/hyci-32/verify.mjs pr-shape
  EXPECT: pr shape ok
  EVIDENCE: automatic-evidence=v1; definition-sha256=a8ddc7cd3184157605d85f5f4c0a92f99b067bec92e7adeab9a3702e56ea13c8; exit=0; EXPECT=matched; output-sha256=69a37b50928f359f0704fcbccec174fdaf9ce3c3a409c3caf7344f06594271ed; output-bytes=12; shell=/bin/sh; cwd=/home/valentin/projects/.worktrees/ci-runner-2-hyci-32; path=eb75ee63cfb0/37 entries

- [x] R7: The three edited files keep the behaviour run 1 proved — the guard tests' assertions about both halves, the flaky-lane job names, and the build-cache contract are still present
  CHECK: node .unlazy/hyci-32/run2.mjs edit-integrity
  EXPECT: edit integrity ok
  EVIDENCE: automatic-evidence=v1; definition-sha256=2b76a6c364a9a8208806993c3f7cd4fdb10a936d957eea46a32bd8cae43657ec; exit=0; EXPECT=matched; output-sha256=102ede3f9cd172469adc46dcc3746b2ea594c597246a66b19862748af3a25e52; output-bytes=18; shell=/bin/sh; cwd=/home/valentin/projects/.worktrees/ci-runner-2-hyci-32; path=eb75ee63cfb0/37 entries

- [x] R8: The pushed head is on the PR, checks are running on it, and the ticket's agent lane names the recheck time
  EVIDENCE: met manually, 2026-10-31 21:50 UTC. `git push origin HEAD:ci-runner-2/hyci-32` moved 26f099b2ed..c84847ba66; `gh pr checks 2623` then listed browser-smoke-desktop, browser-smoke-mobile and ci-prepare pending on run 41244897378. Agent activity 99546d98-9bc9-4af3-a6ac-ca1433918ed8 carries the recheck time 22:10 UTC, and the ticket's qa comment 339789 carries the before/after numbers.
