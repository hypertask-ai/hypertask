# Gates: task API consolidation slice 2

OWNS: GATES.md, docs/htpr-6509-first-slice.md, docs/htpr-6509-slices.md, src/utils/controllers/favorites/getAll.ts, src/utils/controllers/users/getById.ts, src/utils/controllers/pages/pageService.ts, src/utils/controllers/projects/detail.ts, src/app/api/ai-chat/all-sessions/route.ts, tests/htpr-6509-*.cjs, tests/htpr-6509-query-contracts.json

Scope: [REFACTOR] relation-read batching for the section-5 session/favorites/user/page hot paths and section-6 legacy board detail. Adopt the existing current-user/unauthorized helpers on the touched session GET route. Keep all selections, URLs, status codes and JSON. No flag, MCP changes, task-open or app-shell changes, board writes, push, PR, stash, secrets or other-worktree work. Existing comment batching/archived counting is regression-tested, not rewritten. The slice notes are renamed and distinguish prior work from new work and remaining sections.

Baseline: dd6ed1827, branch htpr-6509-s2 in /home/valentin/projects/ht-wt-6509b. Source/test/doc commit comes first; this ledger's completion evidence is committed afterward so it can prove the implementation commit without claiming a future result.

- [x] G0: The ledger parses and states measurable outcomes.
  CHECK: node /home/valentin/.agents/skills/unlazy/scripts/gate-lint.mjs GATES.md
  EXPECT: LINT OK
  EVIDENCE: automatic-evidence=v1; definition-sha256=69f81179f3934636347ff01de4824d2a1f500f2d29238b9fd688f82f77d1c57b; exit=0; EXPECT=matched; output-sha256=f254776d58446cb02919a7d814a51f0c95885fcff2b01f4641e6f76babfac879; output-bytes=268; shell=/bin/sh; cwd=/home/valentin/projects/ht-wt-6509b; path=fd5351737ae0/31 entries

- [x] G1: Baseline response-shape tests passed before production changes.
  EVIDENCE: Before the first production edit, HTPR_6509_BASELINE=1 node --test tests/htpr-6509-query-batching.test.cjs exited 0: 12 passed, 0 failed; SQL adapter counts 4/6/2/3/7. Query selections and JSON were pinned. A child-page adapter SQL-matching defect was later corrected, after which old query/new join outputs were compared again. Baseline recording switches were removed from final tests. This historical ordering is a manual gate, not an assertion that current sources are unchanged.

- [x] G2: Pinned response contracts and independently counted SQL round trips pass for all five changed reads, including empty roots and session failure/authentication paths.
  CHECK: node --test tests/htpr-6509-query-batching.test.cjs
  EXPECT: /# fail 0\b/
  EVIDENCE: automatic-evidence=v1; definition-sha256=fc0e21bfd91412fff961d3bf817759a3e58cf7a7f5293bd49591311fc6654e48; exit=0; EXPECT=matched; output-sha256=50d21433e2dc31aef5673d2a188d3726f69345766c82151bccc6e27d268edaa2; output-bytes=4116; shell=/bin/sh; cwd=/home/valentin/projects/ht-wt-6509b; path=fd5351737ae0/31 entries

- [x] G3: Existing task-route, session, favorite, profile, page, time-report, comment fan-out, mute and archive regressions pass.
  CHECK: node --test tests/favorites-response.test.cjs tests/user-profile-startup-cache.test.cjs tests/comment-notification-fanout.test.cjs tests/project-notification-mute.test.cjs tests/archived-inbox-meta-count.test.cjs tests/task-route-consolidation.test.cjs tests/task-route-consolidation-scope.test.cjs tests/get-session-user-fast-path.test.cjs tests/ai-chat-page-history.test.cjs tests/page-task-identifiers.test.cjs tests/time-report-followups.test.cjs
  EXPECT: /# fail 0\b/
  EVIDENCE: automatic-evidence=v1; definition-sha256=eb09cc04c9dcfb3651a6fd61a7870239eb3a80eb390c70002bc1cbcac40fab1e; exit=0; EXPECT=matched; output-sha256=6e4a9aadcb0799de732ba16a7174662c68d5f6d358f5f7d0052fd67220bd3138; output-bytes=23054; shell=/bin/sh; cwd=/home/valentin/projects/ht-wt-6509b; path=fd5351737ae0/31 entries

- [x] G4: Full TypeScript diagnostics match the recorded baseline, with no new errors.
  CHECK: node tests/task-route-typecheck.cjs
  EXPECT: TypeScript slice verified: 15 pre-existing diagnostics, 0 new
  EVIDENCE: automatic-evidence=v1; definition-sha256=9a222ec9b6e08bfda06430cef47b111cee785f35e7aa296640b221b42a07e7a7; exit=0; EXPECT=matched; output-sha256=e44079a8889dc13010103a926633302400a5be8a41df3f19b9f6e5b3a4c719b3; output-bytes=74; shell=/bin/sh; cwd=/home/valentin/projects/ht-wt-6509b; path=fd5351737ae0/31 entries

- [x] G5: Every changed TS/CJS file passes the project linter.
  CHECK: npm run lint -- --ignore-pattern '**/*' --ignore-pattern '!**/' --ignore-pattern '!src/app/api/ai-chat/all-sessions/route.ts' --ignore-pattern '!src/utils/controllers/favorites/getAll.ts' --ignore-pattern '!src/utils/controllers/users/getById.ts' --ignore-pattern '!src/utils/controllers/pages/pageService.ts' --ignore-pattern '!src/utils/controllers/projects/detail.ts' --ignore-pattern '!tests/htpr-6509-*.cjs' && printf 'Scoped lint verified\n'
  EXPECT: Scoped lint verified
  EVIDENCE: automatic-evidence=v1; definition-sha256=07eb6ccfb9f7a1d14c2dc1a4e6da815d110366e113e488d877c51cbe65012edc; exit=0; EXPECT=matched; output-sha256=2a0b4491f481d433a83a1c5879ad172be3fce6ed2eebff4f5f6c645f080ec3b7; output-bytes=543; shell=/bin/sh; cwd=/home/valentin/projects/ht-wt-6509b; path=fd5351737ae0/31 entries

- [x] G6: Scope, unchanged controller semantics, renamed notes, measured query table, remaining sections and whitespace are verified, including negative controls for prohibited paths, oversized scope and new em dashes.
  CHECK: node --test tests/htpr-6509-scope-check.cjs
  EXPECT: Slice documentation verified
  EVIDENCE: automatic-evidence=v1; definition-sha256=466b3cacb05c0b4e1a2dc29afa282aa627296e4fbe6d825c6488c9645fa92b10; exit=0; EXPECT=matched; output-sha256=0d11ab573b187507c98b7db97100b6192bf557d94d7b78d7ce710503ad6f733b; output-bytes=1202; shell=/bin/sh; cwd=/home/valentin/projects/ht-wt-6509b; path=fd5351737ae0/31 entries

- [x] G7: Domain review finds no authorization, lock, notification, side-effect or response-contract change.
  EVIDENCE: Four controllers differ only by one explicit join option each. Session selection/include/order, empty-list creation and 500 response are unchanged; loadCurrentUser(headers, true) retains profile preconditions and repeats src/proxy.ts:143-163 signed-cookie identity invariant. Session 401 body uses the existing unauthorized helper. No mutation/lock/fan-out code changed; 88 existing regressions passed. Unbounded payloads remain intentionally intact. Synthetic adapter counts are not live latency or query-plan measurements; no build runs because npm run build includes production migrations.

- [x] G8: Local implementation commit has the exact requested prefix/trailer and leaves no unfinished source changes; only this ledger can await its proof commit.
  CHECK: HTPR_6509_CHECK_COMMIT=1 node --test tests/htpr-6509-scope-check.cjs
  EXPECT: Local implementation commit verified
  EVIDENCE: automatic-evidence=v1; definition-sha256=1c10e10f9878b94c97d35220ea0fe09ca13c787a5c84e70c6db6815f039117df; exit=0; EXPECT=matched; output-sha256=631da03b51121e09c34e2079956462aed456d2d90d94b989b72b911d6c37954f; output-bytes=1236; shell=/bin/sh; cwd=/home/valentin/projects/ht-wt-6509b; path=fd5351737ae0/31 entries
