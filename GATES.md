# Gates: calendar hook refactor

OWNS: src/hooks/Calendar/useCalendar*.ts, src/hooks/Calendar/calendarTaskFilters.ts, GATES.md

Scope: Split the calendar hook without changing statements, hook order, dependencies, exports, or return shape. No dependency edits, pushes, or changes to other worktrees.

- [x] G0: Ledger has valid, meaningful checks
  CHECK: node ~/.agents/skills/unlazy/scripts/gate-lint.mjs GATES.md
  EXPECT: LINT OK
  EVIDENCE: automatic-evidence=v1; definition-sha256=2770f040a7cc8da49fa1524d3a3fe5b65db289d5d3f753f22af30412dee16138; exit=0; EXPECT=matched; output-sha256=48630b7361dd44ee870917b12c3d19b9d7bdea738aaca16bb04d4cab83b772d2; output-bytes=8; shell=/bin/sh; cwd=/home/valentin/projects/hypertask-wt/htpr-6506-d-calendar; path=fd5351737ae0/31 entries

- [x] G1: Every created or changed file is below 1500 lines
  CHECK: node /tmp/htpr-6506-calendar-gates.cjs lines
  EXPECT: LINE LIMITS PASS
  EVIDENCE: automatic-evidence=v1; definition-sha256=ea3fce948c0476c789f267fe127afc796f4ee0627466bee938babe745b639ee0; exit=0; EXPECT=matched; output-sha256=b27b42417f43f45467c1e05b9d6f7ed90a4f3162a5836035026f432e220b1b33; output-bytes=373; shell=/bin/sh; cwd=/home/valentin/projects/hypertask-wt/htpr-6506-d-calendar; path=fd5351737ae0/31 entries

- [x] G2: Every touched source function is at most 400 lines
  CHECK: node /tmp/htpr-6506-calendar-functions.cjs && node /tmp/htpr-6506-calendar-gates.cjs functions
  EXPECT: FUNCTION LIMITS PASS
  EVIDENCE: automatic-evidence=v1; definition-sha256=79fe90df5abbff99dfa22b78515efad54306da8dbbe641f2da55cf6deb20597d; exit=0; EXPECT=matched; output-sha256=7d40d1d7e14ab9db67cc607c78eea2497ac09f46cba7173e6234ef81a0407fd0; output-bytes=163; shell=/bin/sh; cwd=/home/valentin/projects/hypertask-wt/htpr-6506-d-calendar; path=fd5351737ae0/31 entries

- [x] G3: Typecheck passes or exactly matches proven production errors with no added errors
  CHECK: node /tmp/htpr-6506-calendar-gates.cjs typecheck
  EXPECT: TYPECHECK PASS
  EVIDENCE: automatic-evidence=v1; definition-sha256=546ff4f1105e389bb7f1702d8f2ea7fd040d15abfc0bb72d1bc70dafecd91296; exit=0; EXPECT=matched; output-sha256=0efc86c4e2eeb69fa9c932ea2deec77e74577bd1c195573bfba80215fa0ff117; output-bytes=1717; shell=/bin/sh; cwd=/home/valentin/projects/hypertask-wt/htpr-6506-d-calendar; path=fd5351737ae0/31 entries

- [x] G4: ESLint passes for every created or changed source file
  CHECK: node /tmp/htpr-6506-calendar-gates.cjs lint
  EXPECT: LINT PASS
  EVIDENCE: automatic-evidence=v1; definition-sha256=572a5962bcd1c10e08631bd67f560e6614ce6489aed7102fe63173e5ca4334ab; exit=0; EXPECT=matched; output-sha256=a80510d9bd4c23446fdcadeb77325ba2d5c32fe77d28e90dd6c699242b556d60; output-bytes=192; shell=/bin/sh; cwd=/home/valentin/projects/hypertask-wt/htpr-6506-d-calendar; path=fd5351737ae0/31 entries

- [x] G5: Related tests pass and full suite has no failures absent on production
  CHECK: node /tmp/htpr-6506-calendar-gates.cjs tests
  EXPECT: TESTS PASS
  EVIDENCE: automatic-evidence=v1; definition-sha256=9b9db67ed87433dd6b1efc173f346eee6eab00c6e4a797abcfdf6140330be517; exit=0; EXPECT=matched; output-sha256=2cfbafc77120132be227dec7ba34120faab1a75c5114365952621a4906fe8314; output-bytes=788; shell=/bin/sh; cwd=/home/valentin/projects/hypertask-wt/htpr-6506-d-calendar; path=fd5351737ae0/31 entries

- [x] G6: All work is committed and the worktree is clean
  CHECK: test -z "$(git status --short)" && printf 'CLEAN TREE PASS\n'
  EXPECT: CLEAN TREE PASS
  EVIDENCE: automatic-evidence=v1; definition-sha256=f0df3e16af7760c807cf5f93eed8e48737ebff82d279056e129629a1e1b69730; exit=0; EXPECT=matched; output-sha256=0a3ff0c32dbed62e3c0cddfad1a5418c0e27acf17103a4e3451b44484e05c710; output-bytes=16; shell=/bin/sh; cwd=/home/valentin/projects/hypertask-wt/htpr-6506-d-calendar; path=fd5351737ae0/31 entries

- [x] G7: Extracted statements, hook order, dependencies, and public return shape match the original
  CHECK: node /tmp/htpr-6506-calendar-gates.cjs equivalence
  EXPECT: EQUIVALENCE PASS
  EVIDENCE: automatic-evidence=v1; definition-sha256=589784e4490026fb7c954b2a2fb69cb3803d1b82b428c85d9e9914677e1357e7; exit=0; EXPECT=matched; output-sha256=cb656b8c1dd3838fe1c8212ed207e4120722d3b7f55d4d453c44cf3c6a823cbd; output-bytes=161; shell=/bin/sh; cwd=/home/valentin/projects/hypertask-wt/htpr-6506-d-calendar; path=fd5351737ae0/31 entries

## Evidence

All eight gates passed with automatic evidence. Final verification will repeat the line, function, equivalence, lint, ledger-status, and clean-tree checks after the evidence commit.

### Line-limit output

```text
   93 GATES.md
 1282 src/hooks/Calendar/useCalendarView.ts
  258 src/hooks/Calendar/useCalendarTasks.ts
  659 src/hooks/Calendar/useCalendarFocus.ts
  281 src/hooks/Calendar/useCalendarTaskActions.ts
  141 src/hooks/Calendar/useCalendarDragDrop.ts
  294 src/hooks/Calendar/useCalendarKeyboard.ts
   26 src/hooks/Calendar/calendarTaskFilters.ts
 3034 total
LINE LIMITS PASS
```

### Function and behavior proof

- Largest function: `useCalendarNavigation`, 316 lines, `src/hooks/Calendar/useCalendarFocus.ts:196`.
- `/tmp/htpr-6506-calendar-functions.cjs` uses the installed TypeScript parser and prints nothing for spans over 400 in the touched source files. It rejects a positive control containing a 402-line function.
- Equivalence check: 109 extracted statements match the original byte-for-byte. Executable statement order, hook order, dependency arrays, helper definitions, and all three public return-shape statements match.
- `onTaskUpdate` remains a fresh function each render. Its declaration was hoisted in the original hook; its new wrapper introduces no primitive hooks or effects.
- The original module still exports `useCalendarView` and `CALENDAR_VIEWS_QUERY_KEY`. No runtime circular imports were introduced; sibling imports of hook state types are type-only.

### Typecheck and lint

- Prisma generation was skipped because the shared client was already generated before this session. No node_modules, package.json, or package-lock.json changes were made.
- `npx next typegen` exits 0. `npx tsc --noEmit` exits 2 with four errors also present on the clean production snapshot: `AppSheet.tsx:2`, `AppSheet.tsx:147`, `AppSheet.tsx:170`, and `src/lib/redis.ts:45`.
- Production snapshot: `283b3c0d89c1021ec7e6495625a758ea8c6a2075`, the session-start origin/production revision. An isolated git archive was used, with the same shared dependency install; every tracked blob was verified against that revision. The remote ref advanced during this session, so the baseline is pinned.
- `diff -u /tmp/htpr-6506-calendar-production-typecheck.log /tmp/htpr-6506-calendar-typecheck.log` exits 0. Zero added errors, including zero calendar-hook errors.
- `npx eslint` on all eight touched files exits 0. Markdown has no matching ESLint configuration and produces one warning, not an error.

### Test proof

- Related tests were located with `rg` under tests and src, searching for useCalendarView and calendar. Twelve related calendar, shortcut, and task-navigation test files pass: 63 passed, 0 failed.
- Full command: `node scripts/run-tests.mjs`, exit 1. Aggregate result across isolated and shared Node suites: 4,820 passed, 5 failed. Shared suite alone: 4,718 passed, 5 failed. The runner stops on Node failures, before its 82 TypeScript test files.
- The same full command on the clean production archive exits 1: 4,817 passed, 8 failed. All five worktree failures also fail there; the archive additionally fails three deployment-health cases. No failure introduced by this refactor.
- Shared-install failures reproduced on production: firebase-admin is 12.7.0 rather than 14.x; jsonwebtoken is 8.5.1 rather than 9.x; mobile-sheet-drag-close cannot load the installed sheet dependency; the default compiler is not the expected native TypeScript 7 binary; the SDK native-compiler install assertion also fails.
- Logs: `/tmp/htpr-6506-calendar-related.log`, `/tmp/htpr-6506-calendar-full.log`, `/tmp/htpr-6506-calendar-production-full.log`, and `/tmp/htpr-6506-calendar-ledger-complete.log`.
- An initial 30-minute full-suite gate timed out. The completed verification uses a 7,200-second limit and persistent output. Its comparison enforces that every current failure also occurs on production, rather than requiring identical failure sets.

### Scope and reviewer focus

Only the calendar hook, its new siblings, and this requested ledger changed. No push, PR, merge, deploy, other-worktree edits, or dependency changes. Review the composition order and type-only boundaries; no live/browser QA was performed for this local pure refactor.
