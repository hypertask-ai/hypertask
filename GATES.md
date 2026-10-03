# Gates: PR review fixes

Follow-up: The 2026-10-03T23:46:30Z review found that an authenticated confirmation could retain the previous account's disconnect marker when the new account's flag was off. The final CI reconciliation failure reported trusted production checkout drift after production changed, while the PR's own feature-flag gate, tests and browser smoke passed.

OWNS: GATES.md, src/lib/slack/**, tests/slack-app-*

Scope: Fix every finding in the latest reviews of the existing PR, add a regression per finding, preserve behavior outside the existing ticket flag, and update only origin htpr-6817.

Toolchain: Ubuntu bash, Node 24, npm, TypeScript, git, authenticated gh, and local Redis for the atomic-script integration test. No board writes, secrets, other worktree edits, new PR, merge, or flag rollout. All code work stays in /home/valentin/projects/ht-wt-6817. The user explicitly authorizes the final fetch, rebase if needed, and push.

Initial evidence: Review comment dated 2026-10-03T22:07:13Z on PR https://github.com/hypertask-ai/hypertask/pull/1021 lists one major and three minor findings. Both failed review statuses refer to reviewer run 37157237999. Its failed log confirms CONCERNS, not a separate CI execution defect. Before fixes, the four regression files had 23 tests: 15 passed, 8 failed, none skipped. Both the in-memory and real Redis tests lost turn 0. The pre-existing relevant suite had 100 passing tests.

- [x] G0: This ledger has valid, decisive oracles.
  CHECK: node /home/valentin/.agents/skills/unlazy/scripts/gate-lint.mjs GATES.md
  EXPECT: LINT OK
  EVIDENCE: automatic-evidence=v1; definition-sha256=69f81179f3934636347ff01de4824d2a1f500f2d29238b9fd688f82f77d1c57b; exit=0; EXPECT=matched; output-sha256=a7f778cc0cc0a4dc3ff086a72a5077fa963cbf2dc206f581ea4e849dffb15118; output-bytes=269; shell=/bin/sh; cwd=/home/valentin/projects/ht-wt-6817; path=af190f486cbf/32 entries

- [x] G1: Disconnect suppression retains the disconnected user's rollout identity while flag-off behavior remains unchanged.
  CHECK: node --test --test-reporter=tap tests/slack-app-identity.test.cjs
  EXPECT: /# fail 0\b/
  EVIDENCE: automatic-evidence=v1; definition-sha256=46ad92d58739b8c074f8e4042d67aff41368ee37c2c0b532210797949222e6d6; exit=0; EXPECT=matched; output-sha256=8a228b63d1b43e97983e4aa274c09e8a1b10440a3bc9f5341c30a709975e1e46; output-bytes=2847; shell=/bin/sh; cwd=/home/valentin/projects/ht-wt-6817; path=af190f486cbf/32 entries

- [x] G2: First-contact Owner and QA users take the flagged route regardless of the installer's flag.
  CHECK: node --test --test-reporter=tap tests/slack-app-events.test.cjs
  EXPECT: /# fail 0\b/
  EVIDENCE: automatic-evidence=v1; definition-sha256=db0a7355d3b60a35844ff8286a8a5711ee5324e87cdca98b170a927f8a26efe4; exit=0; EXPECT=matched; output-sha256=d172802ccc7246e846fb9fbf7c6922e3d30ccb2f4e8e3ea5d5da7f7fbabff737; output-bytes=1610; shell=/bin/sh; cwd=/home/valentin/projects/ht-wt-6817; path=af190f486cbf/32 entries

- [x] G3: Concurrent conversation turns retain all completed turns in bounded history, including against real Redis.
  CHECK: node --test --test-reporter=tap tests/slack-app-assistant.test.cjs
  EXPECT: /# skipped 0\b/
  EVIDENCE: automatic-evidence=v1; definition-sha256=d9d9e3977ebaa791852442c0f61c682a1e2a3cdad7420a688567a0b75fabc3b0; exit=0; EXPECT=matched; output-sha256=2b100611dbb0dbacc604c62cb1a78080b11e46aab62c5924bf0f4af80ea3fc12; output-bytes=585; shell=/bin/sh; cwd=/home/valentin/projects/ht-wt-6817; path=af190f486cbf/32 entries

- [x] G4: Repository scope validation accepts the PR's feature-flag test and rejects unrelated files.
  CHECK: node --test --test-reporter=tap tests/slack-app-repository.test.cjs
  EXPECT: /# fail 0\b/
  EVIDENCE: automatic-evidence=v1; definition-sha256=9736588d8c5fffa40903e53282c9daacca630adfe2528db7f2f05efefb5f6bb7; exit=0; EXPECT=matched; output-sha256=08e338438d72ef73254d5898872793f10b5f75d734743e19242360e6df9635fb; output-bytes=527; shell=/bin/sh; cwd=/home/valentin/projects/ht-wt-6817; path=af190f486cbf/32 entries

- [x] G5: Relevant Slack and feature-flag regression suites all pass.
  CHECK: node --test --test-reporter=tap tests/slack-app-*.test.cjs tests/feature-flags.test.cjs
  EXPECT: /# fail 0\b/
  EVIDENCE: automatic-evidence=v1; definition-sha256=86343e6973fb71571b7d0ba806d8a7c9cbe74475216f07d61f57bb46fa91a779; exit=0; EXPECT=matched; output-sha256=bafe59935e4a9e2d6a7f521cb924aab06fa85fbc89b9e72272314b3f4e86a2d9; output-bytes=23294; shell=/bin/sh; cwd=/home/valentin/projects/ht-wt-6817; path=af190f486cbf/32 entries

- [x] G6: Scoped TypeScript and changed-file lint pass without introduced diagnostics or lint warnings.
  CHECK: node tests/slack-app-checks.cjs
  EXPECT: SLACK APP CHECKS PASSED
  EVIDENCE: automatic-evidence=v1; definition-sha256=a835533420a821e463f416503655d5528794484c57d546d255bd30ba40670b29; exit=0; EXPECT=matched; output-sha256=093841aedc4dbcb671da872727c3ce87ff55518a15017eec00b6829c48e92487; output-bytes=1515; shell=/bin/sh; cwd=/home/valentin/projects/ht-wt-6817; path=af190f486cbf/32 entries

- [x] G7: Every latest review finding and original failed CI status has a verified fix, with no unrelated behavior or flag rollout change.
  EVIDENCE: Re-read the latest review comment and failed reviewer log, then reviewed the complete delta. G1 proves retained Owner and QA disconnect identities, explicit reconnect, and flag-off mapping. G2 proves actual event routing for first-contact Owner, QA, and ordinary users. G3 proves concurrent append against both the stub and a real local Redis, with UTF-8, TTL, and user isolation. G4 proves feature-flag-test acceptance and unrelated-path rejection. All new regression groups failed before their fixes. Both original failed statuses were aliases of these findings; all original executable CI checks were passing. Existing flag key, default Owner + QA mode, manifest, routes, and board content were not changed.

- [x] G8: All existing runnable test suites stay green.
  CHECK: npm test > .slack-gates-all-tests.log 2>&1 && tail -20 .slack-gates-all-tests.log && printf 'ALL EXISTING TESTS PASSED\n'
  EXPECT: ALL EXISTING TESTS PASSED
  EVIDENCE: automatic-evidence=v1; definition-sha256=f9cc1c4a9c019a98a3c68b04b8a5813dacdb8c2c0353a6e80f75cc73809267d8; exit=0; EXPECT=matched; output-sha256=b38275e00d5d12bef6060b136f3e1ec855ec3ad04a4237b8ea772a1ba8c85a3e; output-bytes=462; shell=/bin/sh; cwd=/home/valentin/projects/ht-wt-6817; path=af190f486cbf/32 entries

- [x] G9: Only intended files are committed with the requested commit message and co-author trailer, without new em dashes.
  CHECK: node tests/slack-app-repository.cjs
  EXPECT: SLACK APP REPOSITORY PASSED
  EVIDENCE: automatic-evidence=v1; definition-sha256=10ac06dcb364661a3b239768bb4726d58c70bae66954938e94c313f12133b1bf; exit=0; EXPECT=matched; output-sha256=a825ad4cbb137fb03a61d43c60cd096e43b0ab8db0d680897572dc855ee17d0c; output-bytes=28; shell=/bin/sh; cwd=/home/valentin/projects/ht-wt-6817; path=af190f486cbf/32 entries

- [x] G10: The pushed branch includes fetched production and matches the existing PR head.
  CHECK: git merge-base --is-ancestor origin/production HEAD && test "$(git rev-parse HEAD)" = "$(git ls-remote origin refs/heads/htpr-6817 | cut -f1)" && test "$(git rev-parse HEAD)" = "$(gh pr view 1021 -R hypertask-ai/hypertask --json headRefOid --jq .headRefOid)" && printf 'EXISTING PR SYNCHRONIZED\n'
  EXPECT: EXISTING PR SYNCHRONIZED
  EVIDENCE: automatic-evidence=v1; definition-sha256=530edf6785b326019c1a0813a2c266344dfa5cfee65a7d1d8752d5d78257126f; exit=0; EXPECT=matched; output-sha256=b3bfd407330201943b6865e7f9253372eefe5ccbcfe2afd1c1e3a905134e2bbc; output-bytes=25; shell=/bin/sh; cwd=/home/valentin/projects/ht-wt-6817; path=af190f486cbf/32 entries

- [x] G11: Required regression, typecheck and lint gates pass again after fetching and synchronizing production.
  EVIDENCE: Fetched origin production and htpr-6817, then rebased all five ticket commits onto production 6539e3ccc7ca642b7da5125a1bb2a9ed2cb25a00 without conflicts. Re-ran every runnable gate with --reverify after the rebase: G0 through G6, G8, and G9 passed. npm test executed 848 Node files and 89 TypeScript files; 6,634 cases passed, zero failed, and one pre-existing opt-in Redis redemption case skipped. The relevant Slack and flag suite passed all 109 cases with no skips, including the real local Redis test. Refreshed the worktree-local Prisma client and directly repeated the typecheck/lint wrapper: npx tsc --noEmit -p . passed with zero diagnostics and npm run lint passed across all 24 PR code/test files with zero warnings. No source changes followed these checks.

- [ ] G12: Every successful authenticated connection confirmation clears the old disconnect marker, including when the newly connected account has its flag off.
  CHECK: node --test --test-reporter=tap tests/slack-app-identity.test.cjs
  EXPECT: /# fail 0\b/
  EVIDENCE: pending

- [ ] G13: The PR passes feature-flag evaluation and final CI has no failures caused by this change.
  EVIDENCE: pending
