# Gates: HTPR-6804 consolidated MCP tools

OWNS: GATES.md, src/lib/mcp-server/**, src/lib/flags.ts, src/lib/flags/keys.ts, tests/mcp-consolidated-tools.test.cjs, tests/mcp-consolidated-typecheck.cjs, tests/mcp-list-query-contract.test.cjs, tests/feature-flags.test.cjs, tests/fixtures/mcp-6804/**, docs/mcp-tools.md, tsconfig.mcp-6804.json

Scope: Sections 1 to 3 of https://app.hypertask.ai/detail/project-15/6804 plus golden task data, in this worktree only. No board writes, REST changes, harness, transport/auth refactor, chat refactor, push or PR. Commit locally using the requested message and co-author.

- [x] G1: Server-side Owner + QA flag preserves the complete legacy list when off and advertises 15 to 25 scope-appropriate consolidated tools when on.
  CHECK: node --test --test-name-pattern='catalog|flag|scope' tests/mcp-consolidated-tools.test.cjs
  EXPECT: # fail 0
  EVIDENCE: automatic-evidence=v1; definition-sha256=fb7ac3614b7ed20f18afc4ad8806a80e638fa43a3500ae2765d2f03dc2aca9d4; exit=0; EXPECT=matched; output-sha256=33985d905e10e54a74516ae1efd5f2ae7c277277dec8467831fde04721023627; output-bytes=1026; shell=/bin/sh; cwd=/home/valentin/projects/ht-wt-6804; path=fd5351737ae0/31 entries

- [x] G2: Every legacy tool remains callable through the consolidated dispatcher, with original arguments and authorization; consolidated actions select the same implementation.
  CHECK: node --test --test-name-pattern='dispatch|legacy|action' tests/mcp-consolidated-tools.test.cjs
  EXPECT: # fail 0
  EVIDENCE: automatic-evidence=v1; definition-sha256=f170cde9f047b74f084aad8617f821cdbe5edb326b3573bc40f1520ff259a55c; exit=0; EXPECT=matched; output-sha256=5eee00636c10deb6187a0630215fb376aa5bed5ed7fa834f7a2154333419655a; output-bytes=2184; shell=/bin/sh; cwd=/home/valentin/projects/ht-wt-6804; path=fd5351737ae0/31 entries

- [x] G3: Each advertised consolidated tool has a separately reviewable four-part description, documented parameters and valid nested input examples.
  CHECK: node --test --test-name-pattern='description|example|schema' tests/mcp-consolidated-tools.test.cjs
  EXPECT: # fail 0
  EVIDENCE: automatic-evidence=v1; definition-sha256=e8df8a5611f09391a40e3c2d4dae8963ca4db58e389328d92adc78d473771cfe; exit=0; EXPECT=matched; output-sha256=8c12363822b42ef55ada5d9cc45058a4ba0002f0f484fc723eb9ca2c9f58fd86; output-bytes=836; shell=/bin/sh; cwd=/home/valentin/projects/ht-wt-6804; path=fd5351737ae0/31 entries

- [x] G4: Structured outputs match output schemas, concise reads omit low-signal fields, detailed reads retain detail, pagination/truncation is bounded, and execution errors give actionable isError responses.
  CHECK: node --test --test-name-pattern='response|concise|detailed|pagination|error|validation' tests/mcp-consolidated-tools.test.cjs
  EXPECT: # fail 0
  EVIDENCE: automatic-evidence=v1; definition-sha256=783f72658e6ad7c53e80f07094a3850425e35851b1408c32b481ef210482daa4; exit=0; EXPECT=matched; output-sha256=8f2875499a3a4955b6f417d3b49fd4aeef7f59449cbd34bac96663c2b5eeab17; output-bytes=1893; shell=/bin/sh; cwd=/home/valentin/projects/ht-wt-6804; path=fd5351737ae0/31 entries

- [x] G5: Resource merge reasoning and all existing tools are documented, with 20 to 30 realistic golden tasks as data only.
  CHECK: node --test --test-name-pattern='golden|inventory|documentation' tests/mcp-consolidated-tools.test.cjs
  EXPECT: # fail 0
  EVIDENCE: automatic-evidence=v1; definition-sha256=2aa82b7bb6448fba0456fcdee5b0444640b5ab77e9620ba5c89282eac189a7ed; exit=0; EXPECT=matched; output-sha256=fd6e6b48bca0f7a56e02df02a4a31fb3bd456bba696fe715692b2f5250bf9102; output-bytes=613; shell=/bin/sh; cwd=/home/valentin/projects/ht-wt-6804; path=fd5351737ae0/31 entries

- [x] G6: The complete consolidated suite and relevant existing MCP regression suites pass.
  CHECK: node --test tests/mcp-consolidated-tools.test.cjs tests/mcp-pagination.test.cjs tests/mcp-list-query-contract.test.cjs tests/mcp-agent-management.test.cjs tests/mcp-playbook.test.cjs tests/mcp-task-context-agent-visibility.test.cjs tests/mcp-time-pause-resume.test.cjs tests/mcp-idempotency.test.cjs && node --test tests/feature-flags.test.cjs && node node_modules/tsx/dist/cli.mjs tests/mcp-stateless-http.test.ts && node node_modules/tsx/dist/cli.mjs tests/mcp-deferred-tools.test.ts && node node_modules/tsx/dist/cli.mjs tests/mcp-transports.test.ts
  EXPECT: # fail 0
  EVIDENCE: automatic-evidence=v1; definition-sha256=804dd39213c430caffab92d7f0ada2f061b31fc4e77684bb9472e4ecd0c1ddea; exit=0; EXPECT=matched; output-sha256=8a9b003450d1de574db23984713cd07205cf60d941a097d7aed9e27868f767a7; output-bytes=19865; shell=/bin/sh; cwd=/home/valentin/projects/ht-wt-6804; path=fd5351737ae0/31 entries

- [x] G7: Changed MCP sources have zero TypeScript diagnostics, with unchanged baseline dependency errors explicitly reported, and changed files pass the project's ESLint configuration.
  CHECK: node tests/mcp-consolidated-typecheck.cjs && npm run lint -- --no-warn-ignored --ignore-pattern '**/*' --ignore-pattern '!**/' --ignore-pattern '!src/lib/mcp-server/handler.ts' --ignore-pattern '!src/lib/mcp-server/consolidated-tools.ts' --ignore-pattern '!src/lib/mcp-server/tool-response.ts' --ignore-pattern '!src/lib/mcp-server/config/consolidated-descriptions.ts' --ignore-pattern '!src/lib/mcp-server/stateless-http.ts' --ignore-pattern '!src/lib/mcp-server/mcp-http.ts' --ignore-pattern '!src/lib/mcp-server/deferred-tools.ts' --ignore-pattern '!src/lib/mcp-server/legacy-sse.ts' --ignore-pattern '!src/lib/flags.ts' --ignore-pattern '!src/lib/flags/keys.ts' --ignore-pattern '!tests/mcp-consolidated-tools.test.cjs' --ignore-pattern '!tests/mcp-consolidated-typecheck.cjs' --ignore-pattern '!tests/mcp-list-query-contract.test.cjs' --ignore-pattern '!tests/feature-flags.test.cjs'
  EXPECT: Scoped changed-source typecheck passed
  EVIDENCE: automatic-evidence=v1; definition-sha256=59af611fef75cdcc9b83b8cf03761a5247dde8f699902aa5eaea11ae9d8fc858; exit=0; EXPECT=matched; output-sha256=dbaa2e81e85622075a4aba57772a29dcfe2405451a7c1727b8826da81930be04; output-bytes=1064; shell=/bin/sh; cwd=/home/valentin/projects/ht-wt-6804; path=fd5351737ae0/31 entries

- [x] G8: Final scope review finds no REST, section 4, harness or chat changes; no added em dashes or secrets; only session changes are committed locally with the required message and co-author, without push or PR.
  EVIDENCE: Local code commit 67dbbf9bf on htpr-6804 contains 39 reviewed files from this initially clean worktree. git diff --cached --check passed; staged-path inspection excluded REST, OAuth/annotations, eval harness and chat changes. Added-line em-dash and credential scans passed with known-positive controls. git show verified the HTPR-6804 subject and final Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com> trailer. No board writes, stash, other-worktree edits, push or PR were performed. This ledger is recorded in a separate local evidence commit with the same required subject/trailer format.

## Exact verification results

- Consolidated suite: 17 tests passed, 0 failed; MCP CJS regression group including it: 53 passed, 0 failed.
- Feature flags: 22 passed, 0 failed. TypeScript stateless/deferred/transport suites: 8, 9 and 1 passed respectively, 0 failed.
- Changed-file ESLint: 14 files, 0 errors, 0 warnings; selection independently checked with ESLint.isPathIgnored and lintFiles.
- npx tsc --noEmit -p .: exit 2, 15 pre-existing diagnostics outside the changed sources. Scoped raw compiler: exit 2, 5 unchanged dependency diagnostics (AppSheet 3, Redis 1, state 1). The scoped changed-source check passes with 10 files and 0 diagnostics, verifies baseline source equality against HEAD, and does not claim a clean full build.
- Tool inventory: 74 original resource names plus 2 discovery names; flag-off snapshot has 76 entries, full-human flag-on list has 20 tools. Golden fixture: 25 tasks, data only.
- No live connector calls or agent eval harness run; verification uses local fixtures, spies and the existing transport test server.
