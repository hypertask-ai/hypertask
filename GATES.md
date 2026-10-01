# Gates: server monolith extraction

OWNS: GATES.md, src/lib/mcp/tasks/updateTask.ts, src/lib/mcp/tasks/fields/**, src/lib/mcp/auth.ts, src/lib/mcp/auth/**, src/utils/controllers/comments/createCommentService.ts, src/utils/controllers/comments/**

Scope: Pure extraction of the three requested server modules on the current branch, preserving exports, literal bytes, control flow and side-effect order. No dependency changes, pushes, other worktrees, or unrelated source edits.

- [x] G0: the ledger has valid, falsifiable checks
  CHECK: node ~/.agents/skills/unlazy/scripts/gate-lint.mjs GATES.md
  EXPECT: LINT OK
  EVIDENCE: automatic-evidence=v1; definition-sha256=2770f040a7cc8da49fa1524d3a3fe5b65db289d5d3f753f22af30412dee16138; exit=0; EXPECT=matched; output-sha256=48630b7361dd44ee870917b12c3d19b9d7bdea738aaca16bb04d4cab83b772d2; output-bytes=8; shell=/bin/sh; cwd=/home/valentin/projects/hypertask-wt/htpr-6506-f-server; path=fd5351737ae0/31 entries

- [ ] G1: every created or changed file has fewer than 1500 lines
  CHECK: node /tmp/htpr-6506-f-server/checks.cjs lines
  EXPECT: LINE LIMITS PASSED
  EVIDENCE: pending

- [x] G2: every touched function, arrow and method has at most 400 lines
  CHECK: node /tmp/htpr-6506-f-server/checks.cjs functions
  EXPECT: FUNCTION LIMITS PASSED
  EVIDENCE: automatic-evidence=v1; definition-sha256=9b024516429ad15fe557772edad07adc69adf05e0f18fdb65fdeb7860d96dd32; exit=0; EXPECT=matched; output-sha256=4c5ead9430c57136b8725ce4bc33c8b9438d95b8206a478881f3bcd3e4be0482; output-bytes=138; shell=/bin/sh; cwd=/home/valentin/projects/hypertask-wt/htpr-6506-f-server; path=fd5351737ae0/31 entries

- [x] G3: type generation and typechecking add zero errors relative to origin/production
  CHECK: node /tmp/htpr-6506-f-server/checks.cjs types
  EXPECT: TYPECHECK GATE PASSED
  EVIDENCE: automatic-evidence=v1; definition-sha256=85fff06ab78af81a1a33c8771f9a94fe73f0dbd514c9c082f3cd5602bc4e3a45; exit=0; EXPECT=matched; output-sha256=a3941d730122cf2ec2c0eed93ad11c5a3ba4d7da57472461af4c1e4b5ec1c547; output-bytes=1774; shell=/bin/sh; cwd=/home/valentin/projects/hypertask-wt/htpr-6506-f-server; path=fd5351737ae0/31 entries

- [x] G4: ESLint passes for every created or touched source file
  CHECK: node /tmp/htpr-6506-f-server/checks.cjs lint
  EXPECT: LINT GATE PASSED
  EVIDENCE: automatic-evidence=v1; definition-sha256=0ddef19633d7dadb3af5222cf1a09372d939408066b71756482db2f4d9d23473; exit=0; EXPECT=matched; output-sha256=3c91ccfdf36fc9911d7a5e10032d23ab204615830fa1c74bd60c36ca3c9bc6fa; output-bytes=195; shell=/bin/sh; cwd=/home/valentin/projects/hypertask-wt/htpr-6506-f-server; path=fd5351737ae0/31 entries

- [ ] G5: related tests and the full suite add zero failures relative to origin/production
  CHECK: node /tmp/htpr-6506-f-server/checks.cjs tests
  EXPECT: TEST GATE PASSED
  EVIDENCE: pending

- [ ] G6: final commits leave the current worktree clean
  CHECK: test -z "$(git status --short)" && printf 'CLEAN TREE PASSED\n'
  EXPECT: CLEAN TREE PASSED
  EVIDENCE: pending

- [x] G7: extraction preserves public exports, literal bytes, control flow and side-effect order
  CHECK: node /tmp/htpr-6506-f-server/preservation.cjs
  EXPECT: PRESERVATION PASSED
  EVIDENCE: automatic-evidence=v1; definition-sha256=2610e70a97cf677ebea815d8010c7050177955efe2125df0c446ef02137c4763; exit=0; EXPECT=matched; output-sha256=e27f4fde760b0acce42a0ee8411b51a14a356cbe32b890eba89f6db50b601495; output-bytes=130; shell=/bin/sh; cwd=/home/valentin/projects/hypertask-wt/htpr-6506-f-server; path=fd5351737ae0/31 entries

- [x] G8: commits use the required ticket prefix and co-author, with no forbidden file changes
  CHECK: node /tmp/htpr-6506-f-server/checks.cjs scope
  EXPECT: SCOPE AND COMMITS PASSED
  EVIDENCE: automatic-evidence=v1; definition-sha256=9e34201cfa64d4a762afaefa9dc78cb3669ddec24f12df2dae87c73f909422f5; exit=0; EXPECT=matched; output-sha256=cd63795e3d3aede1edf520f98a4e311b5364d2ca04f7b4c0a228fdec909aa766; output-bytes=25; shell=/bin/sh; cwd=/home/valentin/projects/hypertask-wt/htpr-6506-f-server; path=fd5351737ae0/31 entries

## Evidence transcripts

Commands run from the worktree root. Helpers live in /tmp/htpr-6506-f-server. The clean typecheck baseline is a git archive of origin/production at 828e18c7fc24ca17d8bd8ef8a9a2bd669db42393, extracted to /tmp/htpr-6506-base with the same shared node_modules symlink. Full-suite reproduction also uses a new, isolated clone at /tmp/htpr-6506-f-server/production, detached at that exact commit. No existing worktree was touched. Prisma generation already existed and was skipped to leave the shared install untouched.

The AST preservation check compares original auth declarations and moved executable token sequences, retaining literal source bytes. Review also confirmed per-task order: lease adoption, section, status, text, due date, priority, estimate, labels, contract fields, pull request, assignees, aggregation, realtime broadcast, session-agent summary. Comment creation retains its locked transaction and outboxes before notification claims, origin receipt, summary/count/search work, recipient fan-out, webhook publishing, FCM/email, and completion/release checkpoints. Fresh entry-point dependency bindings preserve existing fixture isolation without changing assertions.

Markdown is checked by the ledger linter; ESLint is invoked on every touched file. Its only expected warning is that Markdown has no ESLint configuration. Full-suite output is bound to the unchanged source digest in /tmp/htpr-6506-f-server/full-test-input.json. Existing dependency and database-double failures must reproduce on the clean baseline, rather than being hidden or fixed outside this scope.

### Check results

Size and function gates pass, with persistComment the largest at 380 lines. Next typegen succeeds; tsc has exactly the same four AppSheet and Redis diagnostics as the clean baseline, and zero touched-file errors. ESLint exits 0. Related tests: 602 passed, zero failed; the supplemental contract-fields database double fails identically on production.

Full runner: 4,819 passed and 7 failed, including its eight isolated test groups. The runner stops at the Node group, so its 82 TypeScript files are not reached by that full invocation; all related TypeScript tests were run separately and passed. The seven full-run failures reproduce on unchanged production: installed Firebase Admin, installed jsonwebtoken, modal-sheet API, two native-compiler checks, plus PostgreSQL asynchronous teardown and Strix timeout under concurrent host load. PostgreSQL teardown reproduced in 4 of 8 host-load replays; Strix timed out in all 8. No baseline fixture source was modified.

### wc -l output

```text
   112 GATES.md
    39 src/lib/mcp/auth.ts
   242 src/lib/mcp/auth/mcpAuthErrors.ts
    82 src/lib/mcp/auth/rateLimit.ts
   356 src/lib/mcp/auth/session.ts
    39 src/lib/mcp/auth/types.ts
   635 src/lib/mcp/auth/verifyJwt.ts
   124 src/lib/mcp/tasks/fields/assignees.ts
    27 src/lib/mcp/tasks/fields/contract.ts
    34 src/lib/mcp/tasks/fields/dueDate.ts
    30 src/lib/mcp/tasks/fields/estimate.ts
    66 src/lib/mcp/tasks/fields/findTasks.ts
    41 src/lib/mcp/tasks/fields/labels.ts
   159 src/lib/mcp/tasks/fields/persist.ts
    31 src/lib/mcp/tasks/fields/priority.ts
    13 src/lib/mcp/tasks/fields/pullRequest.ts
    44 src/lib/mcp/tasks/fields/section.ts
    35 src/lib/mcp/tasks/fields/status.ts
    48 src/lib/mcp/tasks/fields/text.ts
   148 src/lib/mcp/tasks/fields/types.ts
   224 src/lib/mcp/tasks/fields/validateFields.ts
   197 src/lib/mcp/tasks/fields/validateIdentifiers.ts
   223 src/lib/mcp/tasks/updateTask.ts
    93 src/utils/controllers/comments/commentCreationTypes.ts
   302 src/utils/controllers/comments/commentFanout.ts
    23 src/utils/controllers/comments/commentFanoutTypes.ts
   288 src/utils/controllers/comments/commentNotifications.ts
   272 src/utils/controllers/comments/createCommentService.ts
   176 src/utils/controllers/comments/deliverCommentNotifications.ts
   421 src/utils/controllers/comments/persistComment.ts
   101 src/utils/controllers/comments/prepareCommentNotifications.ts
   153 tests/agent-webhook-security.test.cjs
   356 tests/ai-native-bearer-auth.test.cjs
    93 tests/direct-agent-reply-notification.test.cjs
   171 tests/htpr-6516-agent-attribution.test.cjs
   143 tests/hyper-ai-parity-tools.test.cjs
   151 tests/jsonwebtoken-v9-token-shapes.test.cjs
   174 tests/management-surface-parity.test.cjs
   149 tests/task-write-access-choke-points.test.cjs
    39 tests/task-write-access-gate.test.cjs
    36 tests/update-task-assignee-reconciliation.test.cjs
   369 tests/workspace-webhooks.test.cjs
  6459 total
```
