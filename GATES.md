# Gates: PR review fixes

OWNS: GATES.md, src/lib/slack/**, tests/slack-app-*

Scope: Fix all four findings in the latest review of the existing PR, add a regression per finding, preserve behavior outside the existing ticket flag, and update only origin htpr-6817.

Toolchain: Ubuntu bash, Node 24, npm, TypeScript, git, authenticated gh, and local Redis for the atomic-script integration test. No board writes, secrets, other worktree edits, new PR, merge, or flag rollout. All code work stays in /home/valentin/projects/ht-wt-6817. The user explicitly authorizes the final fetch, rebase if needed, and push.

Initial evidence: Review comment dated 2026-10-03T22:07:13Z on PR https://github.com/hypertask-ai/hypertask/pull/1021 lists one major and three minor findings. Both failed review statuses refer to reviewer run 37157237999. Its failed log confirms CONCERNS, not a separate CI execution defect. Before fixes, the four regression files had 23 tests: 15 passed, 8 failed, none skipped. Both the in-memory and real Redis tests lost turn 0. The pre-existing relevant suite had 100 passing tests.

- [x] G0: This ledger has valid, decisive oracles.
  CHECK: node /home/valentin/.agents/skills/unlazy/scripts/gate-lint.mjs GATES.md
  EXPECT: LINT OK
  EVIDENCE: automatic-evidence=v1; definition-sha256=69f81179f3934636347ff01de4824d2a1f500f2d29238b9fd688f82f77d1c57b; exit=0; EXPECT=matched; output-sha256=a7f778cc0cc0a4dc3ff086a72a5077fa963cbf2dc206f581ea4e849dffb15118; output-bytes=269; shell=/bin/sh; cwd=/home/valentin/projects/ht-wt-6817; path=af190f486cbf/32 entries

- [x] G1: Disconnect suppression retains the disconnected user's rollout identity while flag-off behavior remains unchanged.
  CHECK: node --test --test-reporter=tap tests/slack-app-identity.test.cjs
  EXPECT: /# fail 0\b/
  EVIDENCE: automatic-evidence=v1; definition-sha256=46ad92d58739b8c074f8e4042d67aff41368ee37c2c0b532210797949222e6d6; exit=0; EXPECT=matched; output-sha256=ca3a945929e2d511dd3d2b7cb3ab25b9559b4a6e620c1cb16abb390224c65a67; output-bytes=2845; shell=/bin/sh; cwd=/home/valentin/projects/ht-wt-6817; path=af190f486cbf/32 entries

- [x] G2: First-contact Owner and QA users take the flagged route regardless of the installer's flag.
  CHECK: node --test --test-reporter=tap tests/slack-app-events.test.cjs
  EXPECT: /# fail 0\b/
  EVIDENCE: automatic-evidence=v1; definition-sha256=db0a7355d3b60a35844ff8286a8a5711ee5324e87cdca98b170a927f8a26efe4; exit=0; EXPECT=matched; output-sha256=035a5bf5219b35b23c841a476ee4da568131a9783891be56eb1c64c6ca15a04a; output-bytes=1603; shell=/bin/sh; cwd=/home/valentin/projects/ht-wt-6817; path=af190f486cbf/32 entries

- [x] G3: Concurrent conversation turns retain all completed turns in bounded history, including against real Redis.
  CHECK: node --test --test-reporter=tap tests/slack-app-assistant.test.cjs
  EXPECT: /# skipped 0\b/
  EVIDENCE: automatic-evidence=v1; definition-sha256=d9d9e3977ebaa791852442c0f61c682a1e2a3cdad7420a688567a0b75fabc3b0; exit=0; EXPECT=matched; output-sha256=4d7c98cf2f87fd5af5ddfe65e611c25c57ed692aab2f582d45fb83ade54e065a; output-bytes=585; shell=/bin/sh; cwd=/home/valentin/projects/ht-wt-6817; path=af190f486cbf/32 entries

- [x] G4: Repository scope validation accepts the PR's feature-flag test and rejects unrelated files.
  CHECK: node --test --test-reporter=tap tests/slack-app-repository.test.cjs
  EXPECT: /# fail 0\b/
  EVIDENCE: automatic-evidence=v1; definition-sha256=9736588d8c5fffa40903e53282c9daacca630adfe2528db7f2f05efefb5f6bb7; exit=0; EXPECT=matched; output-sha256=daa7b97930bc75249b0fb8f782705baa4f285299a5d37dd74740e8979b529e5a; output-bytes=527; shell=/bin/sh; cwd=/home/valentin/projects/ht-wt-6817; path=af190f486cbf/32 entries

- [x] G5: Relevant Slack and feature-flag regression suites all pass.
  CHECK: node --test --test-reporter=tap tests/slack-app-*.test.cjs tests/feature-flags.test.cjs
  EXPECT: /# fail 0\b/
  EVIDENCE: automatic-evidence=v1; definition-sha256=86343e6973fb71571b7d0ba806d8a7c9cbe74475216f07d61f57bb46fa91a779; exit=0; EXPECT=matched; output-sha256=f1556dd6ce6354eecb514208a740fdc9a113ee1f3bc77ca524c0391d7688e9ad; output-bytes=23285; shell=/bin/sh; cwd=/home/valentin/projects/ht-wt-6817; path=af190f486cbf/32 entries

- [x] G6: Scoped TypeScript and changed-file lint pass without introduced diagnostics or lint warnings.
  CHECK: node tests/slack-app-checks.cjs
  EXPECT: SLACK APP CHECKS PASSED
  EVIDENCE: automatic-evidence=v1; definition-sha256=a835533420a821e463f416503655d5528794484c57d546d255bd30ba40670b29; exit=0; EXPECT=matched; output-sha256=3731e99046b195d96710fb5060b59040951271bbd7eebe8adc5f284fa4eae57b; output-bytes=1515; shell=/bin/sh; cwd=/home/valentin/projects/ht-wt-6817; path=af190f486cbf/32 entries

- [x] G7: Every latest review finding and original failed CI status has a verified fix, with no unrelated behavior or flag rollout change.
  EVIDENCE: Re-read the latest review comment and failed reviewer log, then reviewed the complete delta. G1 proves retained Owner and QA disconnect identities, explicit reconnect, and flag-off mapping. G2 proves actual event routing for first-contact Owner, QA, and ordinary users. G3 proves concurrent append against both the stub and a real local Redis, with UTF-8, TTL, and user isolation. G4 proves feature-flag-test acceptance and unrelated-path rejection. All new regression groups failed before their fixes. Both original failed statuses were aliases of these findings; all original executable CI checks were passing. Existing flag key, default Owner + QA mode, manifest, routes, and board content were not changed.

- [x] G8: All existing runnable test suites stay green.
  CHECK: npm test > .slack-gates-all-tests.log 2>&1 && tail -20 .slack-gates-all-tests.log && printf 'ALL EXISTING TESTS PASSED\n'
  EXPECT: ALL EXISTING TESTS PASSED
  EVIDENCE: automatic-evidence=v1; definition-sha256=f9cc1c4a9c019a98a3c68b04b8a5813dacdb8c2c0353a6e80f75cc73809267d8; exit=0; EXPECT=matched; output-sha256=bb0346c37bb6fca66f0fdcc9c9909eaa2fd6d6e97cf8aacd85d9661f6b1da8b6; output-bytes=464; shell=/bin/sh; cwd=/home/valentin/projects/ht-wt-6817; path=af190f486cbf/32 entries

- [ ] G9: Only intended files are committed with the requested commit message and co-author trailer, without new em dashes.
  CHECK: node tests/slack-app-repository.cjs
  EXPECT: SLACK APP REPOSITORY PASSED
  EVIDENCE: pending

- [ ] G10: The pushed branch includes fetched production and matches the existing PR head.
  CHECK: git merge-base --is-ancestor origin/production HEAD && test "$(git rev-parse HEAD)" = "$(git ls-remote origin refs/heads/htpr-6817 | cut -f1)" && test "$(git rev-parse HEAD)" = "$(gh pr view 1021 -R hypertask-ai/hypertask --json headRefOid --jq .headRefOid)" && printf 'EXISTING PR SYNCHRONIZED\n'
  EXPECT: EXISTING PR SYNCHRONIZED
  EVIDENCE: pending

- [ ] G11: Required regression, typecheck and lint gates pass again after fetching and synchronizing production.
  EVIDENCE: pending
