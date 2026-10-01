# Gates: tutorial hook refactor

OWNS: GATES.md, src/hooks/General/useLearnTutorial.ts, src/hooks/General/useTutorial.ts, src/hooks/General/tutorial*.ts, src/hooks/General/learnTutorial*.ts, src/hooks/General/useTutorialEngine.ts, tests/learn-tutorial-inbox.test.cjs, tests/task-detail-description-shortcut-focus.test.cjs, tests/helpers/learn-tutorial-sources.cjs, tests/tutorial-engine-refactor.test.cjs

Scope: Split the two tutorial hooks into unchanged step data and a shared engine only where behavior is identical. Keep public exports, signatures, return shapes, strings, side effects, and tutorial differences intact. Do not install dependencies, modify shared node_modules or package manifests, push, or touch another worktree.

Checks run from the worktree root with the existing Node and POSIX shell. Temporary verification scripts live in /tmp and inspect all files changed from the starting commit, including committed files.

- [x] G0: The ledger has valid, decisive gate definitions.
  CHECK: node /home/valentin/.agents/skills/unlazy/scripts/gate-lint.mjs GATES.md
  EXPECT: LINT OK
  EVIDENCE: automatic-evidence=v1; definition-sha256=69f81179f3934636347ff01de4824d2a1f500f2d29238b9fd688f82f77d1c57b; exit=0; EXPECT=matched; output-sha256=48630b7361dd44ee870917b12c3d19b9d7bdea738aaca16bb04d4cab83b772d2; output-bytes=8; shell=/bin/sh; cwd=/home/valentin/projects/hypertask-wt/htpr-6506-e-tutorial; path=fd5351737ae0/31 entries

- [x] G1: Every created or changed file has fewer than 1500 lines, with wc output recorded.
  CHECK: node /tmp/htpr-6506-checks.cjs lines
  EXPECT: LINE LIMITS PASS
  EVIDENCE: automatic-evidence=v1; definition-sha256=86644ede71b61dc3da51c1761a9f585f15f11bee44dca662319881a18a57f1d0; exit=0; EXPECT=matched; output-sha256=57434b82dbea9f06625468ddb58616ee5e3f37042fe47a4f546d9304063a2582; output-bytes=997; shell=/bin/sh; cwd=/home/valentin/projects/hypertask-wt/htpr-6506-e-tutorial; path=fd5351737ae0/31 entries

- [x] G2: Every touched function, arrow function, hook, component, and method spans at most 400 lines.
  CHECK: node /tmp/htpr-6506-function-sizes.cjs && printf 'FUNCTION LIMITS PASS\n'
  EXPECT: FUNCTION LIMITS PASS
  EVIDENCE: automatic-evidence=v1; definition-sha256=e6f588c796ed546734fa14e8f3449c4ce505042e43971628e3da30635b0cdf0f; exit=0; EXPECT=matched; output-sha256=869810567f0ecb2d16d9ed9b4f626a1f4c98b9aca286e34af9cd58a5eb1cc5ed; output-bytes=21; shell=/bin/sh; cwd=/home/valentin/projects/hypertask-wt/htpr-6506-e-tutorial; path=fd5351737ae0/31 entries

- [x] G3: Type generation and typechecking pass, or identical errors are proven on clean origin/production with zero added errors.
  CHECK: node /tmp/htpr-6506-checks.cjs typecheck
  EXPECT: TYPECHECK PASS
  EVIDENCE: automatic-evidence=v1; definition-sha256=b137171e699f7b3567583357307692bc54da178ef0d49b560549f7cdf615a6f2; exit=0; EXPECT=matched; output-sha256=b534c50af7d735711e963f27ee7856ccc6934bb8d7356b2cc6b2068a6d9993b2; output-bytes=1836; shell=/bin/sh; cwd=/home/valentin/projects/hypertask-wt/htpr-6506-e-tutorial; path=fd5351737ae0/31 entries

- [x] G4: ESLint exits zero for every created or changed file.
  CHECK: node /tmp/htpr-6506-checks.cjs lint
  EXPECT: LINT PASS
  EVIDENCE: automatic-evidence=v1; definition-sha256=a826c8da922db4e4f25e1d5a974e3f598db188b8fac4bb2a15b00f2afa8954dc; exit=0; EXPECT=matched; output-sha256=add62256a3b52574242b612010f565783ddd60ea901e7723f5d4efc9f3fb7945; output-bytes=192; shell=/bin/sh; cwd=/home/valentin/projects/hypertask-wt/htpr-6506-e-tutorial; path=fd5351737ae0/31 entries

- [x] G5: Related tests and the final full suite pass, or every failure is also reproduced on clean origin/production.
  CHECK: node /tmp/htpr-6506-checks.cjs tests
  EXPECT: TESTS PASS
  EVIDENCE: automatic-evidence=v1; definition-sha256=2de805673ae94a83de185dc8f7251782708a950ac0b09d7e4e26a78e909e7aac; exit=0; EXPECT=matched; output-sha256=c6818f3a797be3f2f8ac3388a667d08dae1b22251fea93049464a9fcae0e88ca; output-bytes=596; shell=/bin/sh; cwd=/home/valentin/projects/hypertask-wt/htpr-6506-e-tutorial; path=fd5351737ae0/31 entries

- [ ] G6: The final committed working tree is clean.
  CHECK: test -z "$(git status --short)" && printf 'CLEAN TREE PASS\n'
  EXPECT: CLEAN TREE PASS
  EVIDENCE: pending

- [x] G7: Step definitions, engine statements, public contracts, and tutorial-specific differences are preserved without behavior changes.
  CHECK: node /tmp/htpr-6506-checks.cjs parity
  EXPECT: REFACTOR PARITY PASS
  EVIDENCE: automatic-evidence=v1; definition-sha256=7a8cf7f49879bca05f9370895c4d7cab38db234cd3bbe0d626fc5b64ffd9534b; exit=0; EXPECT=matched; output-sha256=948f5868346b6d45e4ec19ead10b82133b7c9ad28fa2163e6d40abc01ab98b87; output-bytes=136; shell=/bin/sh; cwd=/home/valentin/projects/hypertask-wt/htpr-6506-e-tutorial; path=fd5351737ae0/31 entries

- [x] G8: Only owned paths change, forbidden shared files stay unchanged, and all new commits use the requested title and co-author trailer.
  CHECK: node /tmp/htpr-6506-checks.cjs scope
  EXPECT: SCOPE AND COMMITS PASS
  EVIDENCE: automatic-evidence=v1; definition-sha256=4dc2d0bb34bb13d07f1bfee38a29934ef77e7807741474952d31a707601389c6; exit=0; EXPECT=matched; output-sha256=c587f03e2b65b6bd116c032c550c5cfe66d2105ca662c6be963a133aaffb8b0f; output-bytes=77; shell=/bin/sh; cwd=/home/valentin/projects/hypertask-wt/htpr-6506-e-tutorial; path=fd5351737ae0/31 entries

## Proof output

### Line limits

Measured with wc -l for every created or changed file, including committed changes:

```text
   157 GATES.md
    97 src/hooks/General/learnTutorialActions.ts
    90 src/hooks/General/learnTutorialDom.ts
   101 src/hooks/General/learnTutorialKeyboard.ts
   589 src/hooks/General/learnTutorialKeyboardHandlers.ts
   718 src/hooks/General/learnTutorialObservers.ts
   335 src/hooks/General/learnTutorialPersistence.ts
   322 src/hooks/General/learnTutorialRuntime.ts
    39 src/hooks/General/learnTutorialSteps.ts
   225 src/hooks/General/tutorialActions.ts
   265 src/hooks/General/tutorialKeyboard.ts
   215 src/hooks/General/tutorialLifecycle.ts
   184 src/hooks/General/tutorialState.ts
  1137 src/hooks/General/tutorialSteps.ts
    63 src/hooks/General/useLearnTutorial.ts
   111 src/hooks/General/useTutorial.ts
    42 src/hooks/General/useTutorialEngine.ts
    17 tests/helpers/learn-tutorial-sources.cjs
   219 tests/learn-tutorial-inbox.test.cjs
   324 tests/task-detail-description-shortcut-focus.test.cjs
   210 tests/tutorial-engine-refactor.test.cjs
  5460 total
```

### Function limits and negative controls

The TypeScript AST script /tmp/htpr-6506-function-sizes.cjs printed nothing and exited 0. Its report mode measured:

```text
{"file":"src/hooks/General/learnTutorialPersistence.ts","name":"useLearnTutorialPersistence","first":14,"span":322}
```

The same checker rejected the original useTutorial hook (1718 lines) and its keydown arrow (1028 lines), exiting 1. The line oracle also rejected a 1500-line fixture. The unchanged-token oracle rejected a deliberately changed literal.

### Type generation and typecheck

Existing node_modules/.prisma/client was present before work. Prisma generation was skipped to avoid modifying the shared install. npx next typegen exits 0. npx tsc --noEmit exits nonzero with exactly the same four diagnostics as clean origin/production at 828e18c7fc24ca17d8bd8ef8a9a2bd669db42393. No tutorial file has a diagnostic, and there are zero added errors.

Production was exported with git archive into /tmp/htpr-6506-production-TQbIST, with only its own generated types and a symlink to the existing shared install. It is not another worktree. Its typecheck output and the refactor output compare identically.

```text
src/components/Modals/Sheets/AppSheet.tsx(2,17): error TS2305: Module '"react-modal-sheet"' has no exported member 'useScrollPosition'.
src/components/Modals/Sheets/AppSheet.tsx(147,7): error TS2322: Type 'SheetDetent' is not assignable to type 'SheetDetent | undefined'.
  Type '"content"' is not assignable to type 'SheetDetent | undefined'.
src/components/Modals/Sheets/AppSheet.tsx(170,13): error TS2322: Type '{ children: ReactNode; disableScroll: boolean; disableDrag: boolean; scrollClassName: string; }' is not assignable to type 'IntrinsicAttributes & Omit<CommonProps, "drag" | "onDrag" | "onDragEnd" | "onDragStart" | "dragConstraints" | "dragElastic" | "dragMomentum"> & { ...; } & RefAttributes<...>'.
  Property 'disableScroll' does not exist on type 'IntrinsicAttributes & Omit<CommonProps, "drag" | "onDrag" | "onDragEnd" | "onDragStart" | "dragConstraints" | "dragElastic" | "dragMomentum"> & { ...; } & RefAttributes<...>'.
src/lib/redis.ts(45,26): error TS2769: No overload matches this call.
  Overload 1 of 8, '(path: string, options: RedisOptions): Redis', gave the following error.
    Object literal may only specify known properties, and 'protocol' does not exist in type 'RedisOptions'.
  Overload 2 of 8, '(port: number, options: RedisOptions): Redis', gave the following error.
    Argument of type 'string' is not assignable to parameter of type 'number'.
  Overload 3 of 8, '(port: number, host: string): Redis', gave the following error.
    Argument of type 'string' is not assignable to parameter of type 'number'.
```

### Lint

npx eslint on every touched or created file exits 0. There are no source lint errors or warnings. GATES.md receives the expected ignored-file warning because ESLint has no Markdown configuration.

### Tests

Source-reference discovery used rg under tests and src with test/spec filename filters for useLearnTutorial, useTutorial, learnTutorial, and useScenes. Existing related modules were tests/learn-tutorial-inbox.test.cjs, tests/learn-tutorial-state.test.cjs, and tests/task-detail-description-shortcut-focus.test.cjs. Added runtime regression coverage is tests/tutorial-engine-refactor.test.cjs.

```text
node scripts/run-tests.mjs tests/learn-tutorial-inbox.test.cjs tests/learn-tutorial-state.test.cjs tests/task-detail-description-shortcut-focus.test.cjs tests/tutorial-engine-refactor.test.cjs
Related: 52 passed, 0 failed, exit 0.
node scripts/run-tests.mjs
Current full run: {"tests":4836,"pass":4831,"fail":5,"cancelled":0,"skipped":0}, exit 1.
Clean production full run: {"tests":4825,"pass":4817,"fail":8,"cancelled":0,"skipped":0}, exit 1.
```

Every current failure also failed in the clean production run:

```text
current: not ok 1767 - the installed firebase-admin is 14.x, and nothing pulls 12.x back in
production: not ok 1767 - the installed firebase-admin is 14.x, and nothing pulls 12.x back in
current: not ok 2120 - the installed jsonwebtoken is 9.x, and nothing pulls 8.x back in
production: not ok 2120 - the installed jsonwebtoken is 9.x, and nothing pulls 8.x back in
current: not ok 445 - tests/mobile-sheet-drag-close.test.cjs
production: not ok 445 - tests/mobile-sheet-drag-close.test.cjs
current: not ok 4481 - the default tsc binary uses the native TypeScript 7 compiler
production: not ok 4470 - the default tsc binary uses the native TypeScript 7 compiler
current: not ok 4482 - the SDK shares the native compiler without nested workspace installs
production: not ok 4471 - the SDK shares the native compiler without nested workspace installs
```

The baseline archive additionally fails three production-deployment Git-context tests because git archive has no .git metadata. Those failures do not occur in this worktree. The runner stops on the pre-existing Node failures, so its 82 TypeScript test files were not run. The related tutorial tests all pass.

### Refactor and scope proof

253 AST leaf-token comparisons preserve original statements, scene handlers, data expressions, dependency arrays, public zero-argument signatures, and return object expressions. String token text is compared byte-for-byte. The two existing scene-copy modules, useScenes.ts and useScenesV2.ts, remain untouched because their definitions were already separate from these hooks.

The shared engine registers and removes keyboard listeners only. Onboarding keeps document listeners in bubble mode; Learn keeps guarded window capture listeners, pointer cancellation, and its original cleanup order. Learn keydown parts retain original returns and only delegate on fallthrough. All hook calls and effects retain their original order and dependencies.

Only the two approved hooks, new sibling modules, GATES.md, new tests, and source-import references in two existing tests changed. Existing test assertions are unchanged. Package manifests and the shared node_modules were not modified. No dependencies were installed, no push was made, and no other worktree was modified.

Code commits: 0b2d09ff2 and c0bb81cf3. All commits use the required title and final co-author trailer. The clean-tree gate is run from a committed checkpoint; its generated evidence is committed, then git status --short is checked again without changing the ledger.
