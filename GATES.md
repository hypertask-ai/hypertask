# Gates: calendar hook refactor

OWNS: src/hooks/Calendar/useCalendar*.ts, src/hooks/Calendar/calendarTaskFilters.ts, GATES.md

Scope: Split the calendar hook without changing statements, hook order, dependencies, exports, or return shape. No dependency edits, pushes, or changes to other worktrees.

- [ ] G0: Ledger has valid, meaningful checks
  CHECK: node ~/.agents/skills/unlazy/scripts/gate-lint.mjs GATES.md
  EXPECT: LINT OK
  EVIDENCE: pending

- [ ] G1: Every created or changed file is below 1500 lines
  CHECK: node /tmp/htpr-6506-calendar-gates.cjs lines
  EXPECT: LINE LIMITS PASS
  EVIDENCE: pending

- [ ] G2: Every touched source function is at most 400 lines
  CHECK: node /tmp/htpr-6506-calendar-functions.cjs && node /tmp/htpr-6506-calendar-gates.cjs functions
  EXPECT: FUNCTION LIMITS PASS
  EVIDENCE: pending

- [ ] G3: Typecheck passes or exactly matches proven production errors with no added errors
  CHECK: node /tmp/htpr-6506-calendar-gates.cjs typecheck
  EXPECT: TYPECHECK PASS
  EVIDENCE: pending

- [ ] G4: ESLint passes for every created or changed source file
  CHECK: node /tmp/htpr-6506-calendar-gates.cjs lint
  EXPECT: LINT PASS
  EVIDENCE: pending

- [ ] G5: Related tests pass and full suite has no failures absent on production
  CHECK: node /tmp/htpr-6506-calendar-gates.cjs tests
  EXPECT: TESTS PASS
  EVIDENCE: pending

- [ ] G6: All work is committed and the worktree is clean
  CHECK: test -z "$(git status --short)" && printf 'CLEAN TREE PASS\n'
  EXPECT: CLEAN TREE PASS
  EVIDENCE: pending

- [ ] G7: Extracted statements, hook order, dependencies, and public return shape match the original
  CHECK: node /tmp/htpr-6506-calendar-gates.cjs equivalence
  EXPECT: EQUIVALENCE PASS
  EVIDENCE: pending

## Evidence

Pending implementation and checks. G6 evidence will be recorded outside the tracked ledger to avoid making a clean tree dirty after its final commit.
