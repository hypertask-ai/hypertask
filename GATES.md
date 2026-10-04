# Gates: PR review fixes

Follow-ups: Later reviews found stale disconnect markers after reconnect, first-contact identity work before rate limiting, bot/deleted-profile hardening using the installer's flag, and concurrent-link membership validation using the candidate's flag. The concurrent-link regression failed all six new controls before the fix; the relevant suite passed 181 tests afterward. The CI reconciliation failure reported trusted production checkout drift after production changed and passed when rerun with current policy.

OWNS: GATES.md, src/lib/slack/**, src/app/api/slack/events/route.ts, tests/slack-app-*, tests/feature-flags.test.cjs

Scope: Fix every finding in the latest reviews of the existing PR, add a regression per finding, preserve behavior outside the existing ticket flag, and update only origin htpr-6817.

Toolchain: Ubuntu bash, Node 24, npm, TypeScript, git, authenticated gh, and local Redis for the atomic-script integration test. No board writes, secrets, other worktree edits, new PR, merge, or flag rollout. All code work stays in /home/valentin/projects/ht-wt-6817. The user explicitly authorizes the final fetch, rebase if needed, and push. G10 pins this session's fetched production snapshot because other sessions can advance the shared origin/production reference while verification runs; it does not require continuously rebasing against unrelated later merges.

Initial evidence: Review comment dated 2026-10-03T22:07:13Z on PR https://github.com/hypertask-ai/hypertask/pull/1021 lists one major and three minor findings. Both failed review statuses refer to reviewer run 37157237999. Its failed log confirms CONCERNS, not a separate CI execution defect. Before fixes, the four regression files had 23 tests: 15 passed, 8 failed, none skipped. Both the in-memory and real Redis tests lost turn 0. The pre-existing relevant suite had 100 passing tests.

- [x] G0: This ledger has valid, decisive oracles.
  CHECK: node /home/valentin/.agents/skills/unlazy/scripts/gate-lint.mjs GATES.md
  EXPECT: LINT OK
  EVIDENCE: automatic-evidence=v1; definition-sha256=69f81179f3934636347ff01de4824d2a1f500f2d29238b9fd688f82f77d1c57b; exit=0; EXPECT=matched; output-sha256=a7f778cc0cc0a4dc3ff086a72a5077fa963cbf2dc206f581ea4e849dffb15118; output-bytes=269; shell=/bin/sh; cwd=/home/valentin/projects/ht-wt-6817; path=af190f486cbf/32 entries

- [x] G1: Disconnect suppression retains the disconnected user's rollout identity while flag-off behavior remains unchanged.
  CHECK: node --test --test-reporter=tap tests/slack-app-identity.test.cjs
  EXPECT: /# fail 0\b/
  EVIDENCE: automatic-evidence=v1; definition-sha256=46ad92d58739b8c074f8e4042d67aff41368ee37c2c0b532210797949222e6d6; exit=0; EXPECT=matched; output-sha256=d5ce50cf550a5eb619adaf86e6a9d0b33f8ccca7603a6e05eb2de6d510a4466e; output-bytes=6368; shell=/bin/sh; cwd=/home/valentin/projects/ht-wt-6817; path=af190f486cbf/32 entries

- [x] G2: First-contact Owner and QA users take the flagged route regardless of the installer's flag.
  CHECK: node --test --test-reporter=tap tests/slack-app-events.test.cjs
  EXPECT: /# fail 0\b/
  EVIDENCE: automatic-evidence=v1; definition-sha256=db0a7355d3b60a35844ff8286a8a5711ee5324e87cdca98b170a927f8a26efe4; exit=0; EXPECT=matched; output-sha256=2c6b9efdacf1b35199a567ed1dbf912b8e13b4e15ad29bde1877b466a490fb66; output-bytes=4011; shell=/bin/sh; cwd=/home/valentin/projects/ht-wt-6817; path=af190f486cbf/32 entries

- [x] G3: Concurrent conversation turns retain all completed turns in bounded history, including against real Redis.
  CHECK: node --test --test-reporter=tap tests/slack-app-assistant.test.cjs
  EXPECT: /# skipped 0\b/
  EVIDENCE: automatic-evidence=v1; definition-sha256=d9d9e3977ebaa791852442c0f61c682a1e2a3cdad7420a688567a0b75fabc3b0; exit=0; EXPECT=matched; output-sha256=48a93750509b448fb60cc240a272a5d53cf9e7e155e3070e233024a649b4351e; output-bytes=585; shell=/bin/sh; cwd=/home/valentin/projects/ht-wt-6817; path=af190f486cbf/32 entries

- [x] G4: Repository scope validation accepts the PR's feature-flag test and rejects unrelated files.
  CHECK: node --test --test-reporter=tap tests/slack-app-repository.test.cjs
  EXPECT: /# fail 0\b/
  EVIDENCE: automatic-evidence=v1; definition-sha256=9736588d8c5fffa40903e53282c9daacca630adfe2528db7f2f05efefb5f6bb7; exit=0; EXPECT=matched; output-sha256=f58a0bbf85ba43c672dc04381ed331dc69e5860fc5e576a022afb9d74dda7206; output-bytes=525; shell=/bin/sh; cwd=/home/valentin/projects/ht-wt-6817; path=af190f486cbf/32 entries

- [x] G5: Relevant Slack and feature-flag regression suites all pass.
  CHECK: node --test --test-reporter=tap tests/slack*.test.cjs tests/feature-flags.test.cjs
  EXPECT: /# fail 0\b/
  EVIDENCE: automatic-evidence=v1; definition-sha256=7720bfa2f652ae7556e7d0993cb3fc4c001615347749f8477794d4f6869c5f49; exit=0; EXPECT=matched; output-sha256=4522e4965909d368a1c817df37ccd4be269d6680fee363b1b9b606e76de54f98; output-bytes=37036; shell=/bin/sh; cwd=/home/valentin/projects/ht-wt-6817; path=af190f486cbf/32 entries

- [x] G6: Scoped TypeScript and changed-file lint pass without introduced diagnostics or lint warnings.
  CHECK: node tests/slack-app-checks.cjs
  EXPECT: SLACK APP CHECKS PASSED
  EVIDENCE: automatic-evidence=v1; definition-sha256=a835533420a821e463f416503655d5528794484c57d546d255bd30ba40670b29; exit=0; EXPECT=matched; output-sha256=34087ca5f483dbf5a0f94c9b73bafea8a7725949a36edd8ea858472dac185661; output-bytes=1561; shell=/bin/sh; cwd=/home/valentin/projects/ht-wt-6817; path=af190f486cbf/32 entries

- [x] G7: Every latest review finding and original failed CI status has a verified fix, with no unrelated behavior or flag rollout change.
  EVIDENCE: Reviewed all eight findings and the complete fix delta. G1 retains disconnected Owner/QA rollout identity; G2 resolves first-contact routing independently of the installer; G3 atomically appends bounded history, verified with real Redis, UTF-8, TTL and isolation; G4 accepts only the intended feature-flag test; G12 clears markers on successful quick and authenticated reconnects, including OFF-to-ON cycles; G15 throttles before identity work without double charging; G17 applies bot/deleted-profile hardening using the matched user's flag; G18 revalidates concurrent links using the returned user's flag, with six failing-before controls covering Owner, QA, ordinary users and membership. Every finding has failing-before and passing-after coverage. Both review statuses alias one review provider. The failed reconciliation was reproduced as trusted-production drift and passed after rerun 37162612600; no workflow change was needed. The existing server flag and Owner + QA default are unchanged. No board writes, additional PR, merge or unrelated behavior changes.

- [x] G8: All existing runnable test suites stay green.
  CHECK: npm test > .slack-gates-all-tests.log 2>&1 && tail -20 .slack-gates-all-tests.log && printf 'ALL EXISTING TESTS PASSED\n'
  EXPECT: ALL EXISTING TESTS PASSED
  EVIDENCE: automatic-evidence=v1; definition-sha256=f9cc1c4a9c019a98a3c68b04b8a5813dacdb8c2c0353a6e80f75cc73809267d8; exit=0; EXPECT=matched; output-sha256=35eaa849e9107dc2162b7d06c547ff0b139b3378c257daa8a9b1f58111bb456e; output-bytes=462; shell=/bin/sh; cwd=/home/valentin/projects/ht-wt-6817; path=af190f486cbf/32 entries

- [x] G9: Only intended files are committed with the requested commit message and co-author trailer, without new em dashes.
  CHECK: node tests/slack-app-repository.cjs
  EXPECT: SLACK APP REPOSITORY PASSED
  EVIDENCE: automatic-evidence=v1; definition-sha256=10ac06dcb364661a3b239768bb4726d58c70bae66954938e94c313f12133b1bf; exit=0; EXPECT=matched; output-sha256=a825ad4cbb137fb03a61d43c60cd096e43b0ab8db0d680897572dc855ee17d0c; output-bytes=28; shell=/bin/sh; cwd=/home/valentin/projects/ht-wt-6817; path=af190f486cbf/32 entries

- [x] G10: The pushed branch includes the production snapshot fetched for final verification and matches the existing PR head.
  CHECK: git merge-base --is-ancestor bc26c407d9159fbb6035fbc0d2bef9bbc613a5b8 HEAD && test "$(git rev-parse HEAD)" = "$(git ls-remote origin refs/heads/htpr-6817 | cut -f1)" && test "$(git rev-parse HEAD)" = "$(gh pr view 1021 -R hypertask-ai/hypertask --json headRefOid --jq .headRefOid)" && printf 'EXISTING PR SYNCHRONIZED\n'
  EXPECT: EXISTING PR SYNCHRONIZED
  EVIDENCE: automatic-evidence=v1; definition-sha256=af9451789d9fc193cf1db8bc45688c76aa17d9c6403ee90670a8342da63f9304; exit=0; EXPECT=matched; output-sha256=b3bfd407330201943b6865e7f9253372eefe5ccbcfe2afd1c1e3a905134e2bbc; output-bytes=25; shell=/bin/sh; cwd=/home/valentin/projects/ht-wt-6817; path=af190f486cbf/32 entries

- [ ] G11: Required regression, typecheck and lint gates pass again after fetching and synchronizing production.
  EVIDENCE: Fetched origin production and htpr-6817, then rebased all five ticket commits onto production 6539e3ccc7ca642b7da5125a1bb2a9ed2cb25a00 without conflicts. Re-ran every runnable gate with --reverify after the rebase: G0 through G6, G8, and G9 passed. npm test executed 848 Node files and 89 TypeScript files; 6,634 cases passed, zero failed, and one pre-existing opt-in Redis redemption case skipped. The relevant Slack and flag suite passed all 109 cases with no skips, including the real local Redis test. Refreshed the worktree-local Prisma client and directly repeated the typecheck/lint wrapper: npx tsc --noEmit -p . passed with zero diagnostics and npm run lint passed across all 24 PR code/test files with zero warnings. No source changes followed these checks.

- [x] G12: Successful explicit connections and authenticated confirmations clear the old disconnect marker regardless of the account's flag.
  CHECK: node --test --test-reporter=tap tests/slack-app-identity.test.cjs
  EXPECT: /# fail 0\b/
  EVIDENCE: automatic-evidence=v1; definition-sha256=46ad92d58739b8c074f8e4042d67aff41368ee37c2c0b532210797949222e6d6; exit=0; EXPECT=matched; output-sha256=1f551294aa0dabfc6ea4aab698a425567bc05c9f9dd2dc7e593f4ae237525302; output-bytes=6367; shell=/bin/sh; cwd=/home/valentin/projects/ht-wt-6817; path=af190f486cbf/32 entries

- [x] G13: The current PR passes local feature-flag evaluation against fetched production.
  CHECK: node .github/scripts/feature-flag-gate.mjs "$(gh pr view 1021 -R hypertask-ai/hypertask --json title --jq .title)" "$(git rev-parse origin/production)" "$(git rev-parse HEAD)"
  EXPECT: No changed file matches the UI-change path filter.
  EVIDENCE: automatic-evidence=v1; definition-sha256=6f6c2eb4b2bde9bae783c3b046334ab631978309f264afa549dd13821fb9a6e8; exit=0; EXPECT=matched; output-sha256=829d9b1d7d72378adab577cfa6ec9210d1c300c0dfa5898fd2cd88c9222c16c9; output-bytes=51; shell=/bin/sh; cwd=/home/valentin/projects/ht-wt-6817; path=af190f486cbf/32 entries

- [x] G15: Throttled mentions and DMs do no identity lookup or linking, and admitted events consume capacity only once while direct handlers stay rate-limited.
  CHECK: node --test --test-reporter=tap tests/slack-app-events.test.cjs tests/slack-app-integration.test.cjs
  EXPECT: /# fail 0\b/
  EVIDENCE: automatic-evidence=v1; definition-sha256=2ccaed9c549568f43d349293f8ebcba80eecee7d7d798902c3958063470d24e7; exit=0; EXPECT=matched; output-sha256=a2570c41748c246cd37f57fd17d390e38c1f02cc8018b710827bcfc6e1f4c014; output-bytes=10250; shell=/bin/sh; cwd=/home/valentin/projects/ht-wt-6817; path=af190f486cbf/32 entries

- [x] G17: First-contact bot and deleted-profile rejection uses the matched user's rollout state before any account link is written.
  CHECK: node --test --test-reporter=tap tests/slack-app-identity.test.cjs
  EXPECT: /# fail 0\b/
  EVIDENCE: automatic-evidence=v1; definition-sha256=46ad92d58739b8c074f8e4042d67aff41368ee37c2c0b532210797949222e6d6; exit=0; EXPECT=matched; output-sha256=412367db6c69f1294a1fab3e425d9c21aa6323c5ec18c2a5963bb055e466ae38; output-bytes=6364; shell=/bin/sh; cwd=/home/valentin/projects/ht-wt-6817; path=af190f486cbf/32 entries

- [ ] G18: Concurrent-link membership validation uses the returned user's flag, rejecting out-of-team Owner and QA users while preserving flag-off behavior.
  CHECK: node --test --test-reporter=tap tests/slack-app-identity.test.cjs
  EXPECT: /# fail 0\b/
  EVIDENCE: pending; review of 52bcbd512bdc69145c6aefa2340e4db73013040d found that a flag-off candidate's rollout state survived a concurrent Owner or QA link.

- [ ] G16: The latest review of the current commit has no major or minor findings.
  CHECK: gh pr view 1021 -R hypertask-ai/hypertask --json comments | node -e 'const assert=require("node:assert/strict"); const fs=require("node:fs"); const cp=require("node:child_process"); const head=cp.execFileSync("git",["rev-parse","HEAD"],{encoding:"utf8"}).trim(); const review=JSON.parse(fs.readFileSync(0,"utf8")).comments.filter(c=>c.author.login.includes("review") && c.body.includes("<!-- reviewed-commit: "+head+" -->")).at(-1); const finding=/^\s*-\s+\*\*(?:MAJOR|MINOR)\b/m; assert(finding.test("- **MINOR regression control**")); assert(review,"Current commit has no review yet"); assert.match(review.body,/^APPROVE/); assert(!finding.test(review.body),"Current review still has findings"); console.log("CURRENT REVIEW HAS NO FINDINGS");'
  EXPECT: CURRENT REVIEW HAS NO FINDINGS
  EVIDENCE: pending

- [x] G14: Final PR CI and both review statuses have no failures after every review fix.
  CHECK: gh pr checks 1021 -R hypertask-ai/hypertask && printf 'ALL PR CHECKS PASSED\n'
  EXPECT: ALL PR CHECKS PASSED
  EVIDENCE: automatic-evidence=v1; definition-sha256=3bd04c0938027bb88009499a3a2a7915b62869c74888e9a8ca882b6f184af401; exit=0; EXPECT=matched; output-sha256=fb2be5521cc2890ee25ef7e041f402d87fe44ef19d86e098b5cac1d01d45b076; output-bytes=2642; shell=/bin/sh; cwd=/home/valentin/projects/ht-wt-6817; path=af190f486cbf/32 entries
