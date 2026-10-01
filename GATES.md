# Gates: task detail monolith split

OWNS: GATES.md, src/app/detail/[...slug]/**, src/components/RTE/**

Scope: Pure refactor of TaskDetailComp and TipTapTaskDetail on the current branch. No pushes, dependency changes, or other worktree changes.

- [x] G0: ledger has valid measurable checks
  CHECK: node ~/.agents/skills/unlazy/scripts/gate-lint.mjs GATES.md
  EXPECT: LINT OK
  EVIDENCE: automatic-evidence=v1; definition-sha256=2770f040a7cc8da49fa1524d3a3fe5b65db289d5d3f753f22af30412dee16138; exit=0; EXPECT=matched; output-sha256=48630b7361dd44ee870917b12c3d19b9d7bdea738aaca16bb04d4cab83b772d2; output-bytes=8; shell=/bin/sh; cwd=/home/valentin/projects/hypertask-wt/htpr-6506-c-taskdetail; path=fd5351737ae0/31 entries

- [x] G1: every changed or created file has fewer than 1500 lines
  CHECK: node /tmp/hax-taskdetail-6506-dQRgLV/limits.cjs lines
  EXPECT: LINE LIMITS PASS
  EVIDENCE: automatic-evidence=v1; definition-sha256=a6028065575723c6b5455c9684690878cb5bc21ab8e3b3464d3c87171fe04854; exit=0; EXPECT=matched; output-sha256=a253104f3e951b45cb833035f66b6b74a0e9567ca452686170c134c2840731e2; output-bytes=2545; shell=/bin/sh; cwd=/home/valentin/projects/hypertask-wt/htpr-6506-c-taskdetail; path=fd5351737ae0/31 entries

- [x] G2: every touched source function is at most 400 lines
  CHECK: node /tmp/hax-taskdetail-6506-dQRgLV/limits.cjs functions
  EXPECT: FUNCTION LIMITS PASS
  EVIDENCE: automatic-evidence=v1; definition-sha256=ad6a3f95a01b5a1b16f6851d9a4419b9df9f360055db285d9da46bf4cf78180e; exit=0; EXPECT=matched; output-sha256=7d529caa629b6d6080d55ba79a5dca22ef195c341fcd3b12053b18986186f4f6; output-bytes=119; shell=/bin/sh; cwd=/home/valentin/projects/hypertask-wt/htpr-6506-c-taskdetail; path=fd5351737ae0/31 entries

- [x] G3: typecheck adds zero errors against origin/production
  CHECK: bash /tmp/hax-taskdetail-6506-dQRgLV/typecheck.sh
  EXPECT: TYPECHECK PASS
  EVIDENCE: automatic-evidence=v1; definition-sha256=a6f6e2534d4e8f11ebbda1984226bb3b1180e65408b928af61d4948a99e4d115; exit=0; EXPECT=matched; output-sha256=5e8b4afa30a2865785cc67a5f8943ab66933629662d97dfe5d46593e20eeff83; output-bytes=1614; shell=/bin/sh; cwd=/home/valentin/projects/hypertask-wt/htpr-6506-c-taskdetail; path=fd5351737ae0/31 entries

- [x] G4: every touched source passes ESLint
  CHECK: node /tmp/hax-taskdetail-6506-dQRgLV/lint.cjs
  EXPECT: LINT PASS
  EVIDENCE: automatic-evidence=v1; definition-sha256=90ce1190eff33c5a84e1ae117a3c3ffd550743341f858eb475d4f3f289bff1d1; exit=0; EXPECT=matched; output-sha256=70d31a806f9d7cd754f7d018d9d84e1746b316b179b99a60511eb080379ee90f; output-bytes=194; shell=/bin/sh; cwd=/home/valentin/projects/hypertask-wt/htpr-6506-c-taskdetail; path=fd5351737ae0/31 entries

- [x] G5: related tests pass and full suite adds zero failures against origin/production
  CHECK: node /tmp/hax-taskdetail-6506-dQRgLV/tests.cjs
  EXPECT: TESTS PASS
  EVIDENCE: automatic-evidence=v1; definition-sha256=7e7f325a4c66c5de3812bf703689391bef67c1aeef264f16aa34a22a19440181; exit=0; EXPECT=matched; output-sha256=1e732f49a797fafcf096036031dc58613a9c1d84be61cc29d28b06084e7bb193; output-bytes=515; shell=/bin/sh; cwd=/home/valentin/projects/hypertask-wt/htpr-6506-c-taskdetail; path=fd5351737ae0/31 entries

- [x] G6: final commits leave an empty git status
  CHECK: test -z "$(git status --short)" && printf 'CLEAN TREE PASS\n'
  EXPECT: CLEAN TREE PASS
  EVIDENCE: automatic-evidence=v1; definition-sha256=f0df3e16af7760c807cf5f93eed8e48737ebff82d279056e129629a1e1b69730; exit=0; EXPECT=matched; output-sha256=0a3ff0c32dbed62e3c0cddfad1a5418c0e27acf17103a4e3451b44484e05c710; output-bytes=16; shell=/bin/sh; cwd=/home/valentin/projects/hypertask-wt/htpr-6506-c-taskdetail; path=fd5351737ae0/31 entries

- [x] G7: exports, command precedence, rendered markup, and moved handler logic remain equivalent
  CHECK: node /tmp/hax-taskdetail-6506-dQRgLV/equivalence.cjs
  EXPECT: EQUIVALENCE PASS
  EVIDENCE: automatic-evidence=v1; definition-sha256=c8404a345bb174bad67bf2cfe6e56013543d9dfeee0f26618dc2648896407ae6; exit=0; EXPECT=matched; output-sha256=daf5496ebd9c79aba584bb6269055bbd1a6fcd1c7b397536d107f619a6a1257e; output-bytes=214; shell=/bin/sh; cwd=/home/valentin/projects/hypertask-wt/htpr-6506-c-taskdetail; path=fd5351737ae0/31 entries

- [x] G8: dependency files and public exports are unchanged and test edits only update source imports
  CHECK: node /tmp/hax-taskdetail-6506-dQRgLV/scope.cjs
  EXPECT: SCOPE PASS
  EVIDENCE: automatic-evidence=v1; definition-sha256=b07b6e575e8919ae10ec3a0d3d753e83f20fec18ef1a3431791a5cbbd19cd427; exit=0; EXPECT=matched; output-sha256=4e723e739527a188f23f03708fda64d18b23e637b20e5bea401b1105a13e68b2; output-bytes=128; shell=/bin/sh; cwd=/home/valentin/projects/hypertask-wt/htpr-6506-c-taskdetail; path=fd5351737ae0/31 entries

## Work tree

1. Inspect both components, entry points, and related tests.
2. Extract ordered keyboard commands and panel rendering from TaskDetailComp.
3. Extract editor setup, extensions, handlers, and rendering from TipTapTaskDetail.
4. Review moved code against original, measure constraints, run checks, and commit small units.
5. Reverify all gates and commit the evidence ledger, then prove clean status.

## Evidence notes

- Original branch base: 283b3c0d89c1021ec7e6495625a758ea8c6a2075.
- Clean origin/production archive: 4ea9542122d886bb2f57d1e35dcfacf9c6519322, isolated under /tmp/hax-taskdetail-6506-dQRgLV/baseline. No other worktree was used.
- Prisma generation skipped: the shared install already has node_modules/.prisma/client/index.d.ts. Generating again would violate the shared-install restriction.
- Typecheck: exact output matches the clean baseline, three AppSheet.tsx errors and one redis.ts error. Zero new errors.
- ESLint exits 0 for every touched file. GATES.md has an expected unsupported-file warning.
- Refactor review: 285 original function bodies, 44 ordered keyboard predicates and command bodies, initial guards, and six maximal JSX expressions match the originals. React hook order also matches: 91 task-detail hooks and 59 editor hooks.
- The render-local context getter retains forward references between handlers and preserves the original memoized callback closures. It is not a global or persistent mutable store.
- Test source loaders read the real extracted modules. Existing test assertions are unchanged.
- No package changes, installations, pushes, stashes, or other worktree writes. Existing message text was copied unchanged.

### Full-suite baseline exceptions

The worktree runner reports 4,820 passing and five failing tests. All five failures also appear in the clean origin/production runner, which reports 4,816 passing and eight failing tests. The baseline additionally fails three repository-ancestry checks because the isolated archive has no Git working tree. The CJS failures stop the runner before its TypeScript phase; the related TypeScript tests were run separately and passed.

1. firebase-admin-v14-modular.test.cjs: shared install has firebase-admin 12.7.0 instead of 14.x.
2. jsonwebtoken-v9-token-shapes.test.cjs: shared install still has the jsonwebtoken 8.5.1 instead of 9.x.
3. mobile-sheet-drag-close.test.cjs: shared react-modal-sheet is incompatible with the committed sheet API.
4. typescript-toolchain.test.cjs: tsc reports 6.0.3 rather than native TypeScript 7.
5. typescript-toolchain.test.cjs: @typescript/native/package.json is absent.

Full logs: /tmp/hax-taskdetail-6506-dQRgLV/full-tests.log and baseline-tests.log. Related tests: 134 passing, zero failing. The G5 oracle verifies the captured source fingerprint, compares the current source through the TypeScript printer after whitespace-only cleanup, and asserts every failing test name occurs in the baseline output.

The gate checker runs against an identical temporary ledger with the worktree root as its explicit CWD. This records the clean-tree gate without the checker itself dirtying GATES.md. Its generated evidence is copied back and committed, followed by a final empty git status check.

Largest remaining function: taskDetailEditingKeymap, 342 lines.

### Line-limit output

```text
   139 GATES.md
    29 src/app/detail/[...slug]/TaskDetailComp.tsx
    62 src/app/detail/[...slug]/TaskDetailContext.ts
    11 src/app/detail/[...slug]/TaskDetailKeyboardContext.ts
   414 src/app/detail/[...slug]/TaskDetailPanels.tsx
     3 src/app/detail/[...slug]/TaskDetailState.ts
   348 src/app/detail/[...slug]/taskDetailEditingKeymap.ts
   168 src/app/detail/[...slug]/taskDetailKeyboard.ts
   349 src/app/detail/[...slug]/taskDetailNavigationKeymap.ts
    46 src/app/detail/[...slug]/taskDetailTestSources.cjs
   275 src/app/detail/[...slug]/useTaskDetailCommandActions.tsx
   273 src/app/detail/[...slug]/useTaskDetailCommentActions.tsx
   298 src/app/detail/[...slug]/useTaskDetailInitialScroll.tsx
   146 src/app/detail/[...slug]/useTaskDetailModalActions.tsx
   133 src/app/detail/[...slug]/useTaskDetailModals.tsx
   232 src/app/detail/[...slug]/useTaskDetailNavigationActions.tsx
   159 src/app/detail/[...slug]/useTaskDetailReadiness.tsx
   229 src/app/detail/[...slug]/useTaskDetailState.tsx
    35 src/components/RTE/TaskDetailEditorContext.ts
   168 src/components/RTE/TaskDetailEditorPanels.tsx
     9 src/components/RTE/TaskDetailEditorState.ts
    26 src/components/RTE/TipTapTaskDetail.tsx
   100 src/components/RTE/taskDetailEditorPresentation.tsx
   187 src/components/RTE/useTaskDetailEditorDrafts.tsx
   217 src/components/RTE/useTaskDetailEditorEvents.tsx
   205 src/components/RTE/useTaskDetailEditorFocus.tsx
   215 src/components/RTE/useTaskDetailEditorKeyboard.tsx
   232 src/components/RTE/useTaskDetailEditorSave.tsx
   208 src/components/RTE/useTaskDetailEditorState.tsx
   146 src/components/RTE/useTaskDetailEditorWriter.tsx
   143 tests/ai-chat-display-modes.test.cjs
    96 tests/app-shell-rail-mount-shift.test.cjs
    58 tests/archive-shortcut-surfaces.test.cjs
   229 tests/auto-description-suggestion.test.ts
   330 tests/figma-comment-preview.test.cjs
   305 tests/guest-description-edit.test.cjs
    77 tests/mobile-comment-composer-hierarchy.test.cjs
   238 tests/mobile-existing-content-editor.test.cjs
   174 tests/task-detail-archive-stays-visible.test.cjs
   122 tests/task-detail-defer-non-essential.test.cjs
   328 tests/task-detail-description-shortcut-focus.test.cjs
   380 tests/task-detail-inbox-flow.test.cjs
   226 tests/task-detail-initial-scroll.test.cjs
   198 tests/task-detail-single-fetch.test.cjs
    45 tests/task-detail-usable-mark-fallback-poll.test.cjs
   131 tests/tiptap-attachment-state.test.cjs
   175 tests/tiptap-debounce-lifecycle.test.cjs
  8317 total
```
