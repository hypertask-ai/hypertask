# Gates: HTPR-6506 chat stream refactor

OWNS: GATES.md, src/app/api/ai/chat/stream/route.ts, src/lib/ai/tools/**, src/lib/ai/chatStream/**

Scope: Extract the chat stream route without changing behavior, preserve route exports and tool order, and commit only this work on the current branch. No installs, dependency changes, pushes, other worktrees, or new em dash characters.

Checks run from the worktree root using the existing shared dependencies. Verification scripts and baseline copies live only in /tmp.

- [ ] G0: This ledger has valid, falsifiable gates.
  CHECK: node /home/valentin/.agents/skills/unlazy/scripts/gate-lint.mjs GATES.md
  EXPECT: LINT OK
  EVIDENCE: pending

- [ ] G1: Every created or changed file is shorter than 1500 lines, with wc output retained below.
  CHECK: node /tmp/htpr-6506-a-route-lines.cjs
  EXPECT: LINE LIMITS VERIFIED
  EVIDENCE: pending

- [ ] G2: No function, arrow function, method, hook, or component spans more than 400 lines.
  CHECK: node /tmp/htpr-6506-a-route-functions.cjs && node /tmp/htpr-6506-a-route-function-control.cjs
  EXPECT: FUNCTION LIMITS VERIFIED
  EVIDENCE: pending

- [ ] G3: Prisma generation, Next route type generation, and TypeScript succeed, or any baseline errors are proven identical with zero new errors.
  CHECK: node /tmp/htpr-6506-a-route-typecheck.cjs
  EXPECT: TYPECHECK VERIFIED
  EVIDENCE: pending

- [ ] G4: ESLint succeeds for every touched or created source file.
  CHECK: node /tmp/htpr-6506-a-route-lint.cjs
  EXPECT: LINT VERIFIED
  EVIDENCE: pending

- [ ] G5: Related tests pass and the final full suite has zero new failures against origin/production.
  CHECK: node /tmp/htpr-6506-a-route-tests.cjs
  EXPECT: TESTS VERIFIED
  EVIDENCE: pending

- [ ] G6: The committed worktree has an empty git status --short.
  CHECK: node /tmp/htpr-6506-a-route-clean.cjs
  EXPECT: CLEAN TREE VERIFIED
  EVIDENCE: pending

- [ ] G7: Extracted tools, helpers, prompts, schemas, descriptions, error strings, and route exports preserve the original code and ordering.
  CHECK: node /tmp/htpr-6506-a-route-preservation.cjs
  EXPECT: PRESERVATION VERIFIED
  EVIDENCE: pending

- [ ] G8: Changes respect the allowed scope, dependency restrictions, and commit-message contract.
  CHECK: node /tmp/htpr-6506-a-route-scope.cjs
  EXPECT: SCOPE VERIFIED
  EVIDENCE: pending

## Evidence notes

Pending implementation and measured outputs. The clean-tree check is repeated after the final evidence commit so recording gate evidence does not leave a dirty ledger.
