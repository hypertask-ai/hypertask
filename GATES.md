# Gates: task-route consolidation, first reviewable slice

OWNS: GATES.md, src/app/api/tasks/**, src/pages/api/tasks/getAll.ts, src/lib/auth/currentUser.ts, src/lib/api/response.ts, src/lib/parsePositiveInt.ts, src/lib/mcp/readJsonBody.ts, src/utils/controllers/tasks/assertTaskAccess.ts, src/utils/controllers/tasks/getAll.ts, tests/task-route-*.cjs, tests/task-cycle-route.test.cjs, tests/task-description-version-history-ui.test.cjs, docs/htpr-6509-first-slice.md

Scope: [REFACTOR] the existing task APIs without changing URLs, status codes, JSON shapes, user behavior, or CLI behavior. Work only in this worktree; no board writes, push, PR, secrets, MCP route/server edits, unrelated routes, or feature flag. Commit this slice with the requested message and attribution.

- [x] G0: The ledger has valid, decisive checks.
  CHECK: node /home/valentin/.agents/skills/unlazy/scripts/gate-lint.mjs GATES.md
  EXPECT: LINT OK
  EVIDENCE: automatic-evidence=v1; definition-sha256=69f81179f3934636347ff01de4824d2a1f500f2d29238b9fd688f82f77d1c57b; exit=0; EXPECT=matched; output-sha256=b2615d84cb888cfab30603922689407564a0eec8b8aa9cc9782c6eb9af862464; output-bytes=268; shell=/bin/sh; cwd=/home/valentin/projects/ht-wt-6509; path=fd5351737ae0/31 entries

- [x] G1: Every touched route retains its baseline response contract, including errors, auth, and supported methods.
  CHECK: node --test tests/task-route-consolidation.test.cjs
  EXPECT: /# fail 0\b/
  EVIDENCE: automatic-evidence=v1; definition-sha256=ce3f254fd2c77d0c856e71a2263c9d4a47719a5b2d5a5ae893afc10597b5281c; exit=0; EXPECT=matched; output-sha256=394ba0e50124ad40de733c9022a52df920606cb77cb29bf9ef2ccc7e6d084ca8; output-bytes=7236; shell=/bin/sh; cwd=/home/valentin/projects/ht-wt-6509; path=fd5351737ae0/31 entries

- [x] G2: The bounded task slice uses one current-user loader and shared parsing/response helpers; query counts and any duplicate migrations preserve access and URLs.
  CHECK: node --test tests/task-route-consolidation-scope.test.cjs
  EXPECT: /# fail 0\b/
  EVIDENCE: automatic-evidence=v1; definition-sha256=056e8edd3547b6af16ef913051765da826fdba3bfe4fbb159820a599758d7dbe; exit=0; EXPECT=matched; output-sha256=22bcfb041c0498f0266f2ba6e2c14ac5690dd4d171d75bc68ec12d011ad31e1e; output-bytes=1605; shell=/bin/sh; cwd=/home/valentin/projects/ht-wt-6509; path=fd5351737ae0/31 entries

- [x] G3: Full TypeScript checking emits no new diagnostics beyond the recorded unrelated baseline and no changed-file diagnostics.
  CHECK: node tests/task-route-typecheck.cjs
  EXPECT: TypeScript slice verified:
  EVIDENCE: automatic-evidence=v1; definition-sha256=2c4a82ab0b5e05a16c500b225a0ec1e4c555a006911a271d2ff0f171493d39be; exit=0; EXPECT=matched; output-sha256=e44079a8889dc13010103a926633302400a5be8a41df3f19b9f6e5b3a4c719b3; output-bytes=74; shell=/bin/sh; cwd=/home/valentin/projects/ht-wt-6509; path=fd5351737ae0/31 entries

- [x] G4: Lint accepts every changed TypeScript/CJS file and whitespace checks pass.
  CHECK: npm run lint -- --max-warnings 0 --ignore-pattern '**/*' --ignore-pattern '!**/' --ignore-pattern '!src/app/api/tasks/**' --ignore-pattern '!src/lib/auth/currentUser.ts' --ignore-pattern '!src/lib/api/response.ts' --ignore-pattern '!src/lib/parsePositiveInt.ts' --ignore-pattern '!src/lib/mcp/readJsonBody.ts' --ignore-pattern '!src/pages/api/tasks/getAll.ts' --ignore-pattern '!src/utils/controllers/tasks/assertTaskAccess.ts' --ignore-pattern '!src/utils/controllers/tasks/getAll.ts' --ignore-pattern '!tests/task-route-*.cjs' --ignore-pattern '!tests/task-cycle-route.test.cjs' --ignore-pattern '!tests/task-description-version-history-ui.test.cjs' && git diff --check && printf 'Task slice lint and whitespace verified\n'
  EXPECT: Task slice lint and whitespace verified
  EVIDENCE: automatic-evidence=v1; definition-sha256=7348d65b9b5ff67e466cde3d1ed6114738644a0e04b91f9486fee4660c3a77c5; exit=0; EXPECT=matched; output-sha256=6337b92f319e2138393ab28f19591af7d0cff0210b29fdb81510a796e95a13c5; output-bytes=791; shell=/bin/sh; cwd=/home/valentin/projects/ht-wt-6509; path=fd5351737ae0/31 entries

- [x] G5: Expert review finds no behavior drift; the follow-up document precisely identifies completed ticket sections, deferred work, route inventory, and measured query counts.
  EVIDENCE: Reviewed all production diffs and new helpers after the full 91-test run (91 pass, 0 fail). Shared auth always resolves the signed session; description profile/actor requirements remain, matching the proxy's existing identity invariant. Existing team/content and archived/status predicates, numeric ranges, error keys/messages/statuses, optimistic restore lock and broadcasts are pinned. The real Prisma planner fixture measures 8 versus 1 SQL calls with identical JSON and pinned original selection/filter/order arguments. Inventory independently measured 3 App and 33 Pages task files, zero twins. docs/htpr-6509-first-slice.md explicitly records partial sections 2/3/6, the completed twin audit, every section's follow-up, the full-row compatibility constraint and synthetic-only limitations. No improvement remains in this authorized slice after the final review pass.

- [ ] G6: The requested local commit contains only this worktree's reviewable slice, no forbidden paths or new em dashes, with exact attribution; nothing is pushed and no PR is opened.
  EVIDENCE: pending

- [x] G7: Existing task mutation, history, cookie identity, session resolution, and MCP JSON contracts remain compatible.
  CHECK: node --test tests/task-cycle-route.test.cjs tests/task-description-version-history-ui.test.cjs tests/mcp-malformed-json-body.test.cjs tests/get-session-user-fast-path.test.cjs tests/cookie-identity.test.cjs tests/task-detail-property-realtime.test.cjs tests/task-write-access-choke-points.test.cjs tests/task-single-auth.test.cjs
  EXPECT: /# fail 0\b/
  EVIDENCE: automatic-evidence=v1; definition-sha256=95a73ce69760cd3817d6c807b9e4caa59c61acf8017963d49e35bab3769127ed; exit=0; EXPECT=matched; output-sha256=af0de9d43febb69947699ce23e5c700ee9764b443745ba6e04f3876d34670508; output-bytes=13770; shell=/bin/sh; cwd=/home/valentin/projects/ht-wt-6509; path=fd5351737ae0/31 entries
