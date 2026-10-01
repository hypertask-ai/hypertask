# Gates: task detail monolith split

OWNS: GATES.md, src/app/detail/[...slug]/**, src/components/RTE/**

Scope: Pure refactor of TaskDetailComp and TipTapTaskDetail on the current branch. No pushes, dependency changes, or other worktree changes.

- [ ] G0: ledger has valid measurable checks
  CHECK: node ~/.agents/skills/unlazy/scripts/gate-lint.mjs GATES.md
  EXPECT: LINT OK
  EVIDENCE: pending

- [ ] G1: every changed or created file has fewer than 1500 lines
  CHECK: node /tmp/hax-taskdetail-6506-dQRgLV/limits.cjs lines
  EXPECT: LINE LIMITS PASS
  EVIDENCE: pending

- [ ] G2: every touched source function is at most 400 lines
  CHECK: node /tmp/hax-taskdetail-6506-dQRgLV/limits.cjs functions
  EXPECT: FUNCTION LIMITS PASS
  EVIDENCE: pending

- [ ] G3: typecheck adds zero errors against origin/production
  CHECK: bash /tmp/hax-taskdetail-6506-dQRgLV/typecheck.sh
  EXPECT: TYPECHECK PASS
  EVIDENCE: pending

- [ ] G4: every touched source passes ESLint
  CHECK: node /tmp/hax-taskdetail-6506-dQRgLV/lint.cjs
  EXPECT: LINT PASS
  EVIDENCE: pending

- [ ] G5: related tests pass and full suite adds zero failures against origin/production
  CHECK: node /tmp/hax-taskdetail-6506-dQRgLV/tests.cjs
  EXPECT: TESTS PASS
  EVIDENCE: pending

- [ ] G6: final commits leave an empty git status
  CHECK: test -z "$(git status --short)" && printf 'CLEAN TREE PASS\n'
  EXPECT: CLEAN TREE PASS
  EVIDENCE: pending

- [ ] G7: exports, command precedence, rendered markup, and moved handler logic remain equivalent
  CHECK: node /tmp/hax-taskdetail-6506-dQRgLV/equivalence.cjs
  EXPECT: EQUIVALENCE PASS
  EVIDENCE: pending

- [ ] G8: dependency files and public exports are unchanged and test edits only update source imports
  CHECK: node /tmp/hax-taskdetail-6506-dQRgLV/scope.cjs
  EXPECT: SCOPE PASS
  EVIDENCE: pending

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
2. jsonwebtoken-v9.test.cjs: shared install still has the previous jsonwebtoken version.
3. mobile-sheet-drag-close.test.cjs: shared react-modal-sheet is incompatible with the committed sheet API.
4. typescript-toolchain.test.cjs: tsc reports 6.0.3 rather than native TypeScript 7.
5. typescript-toolchain.test.cjs: @typescript/native/package.json is absent.

Full logs: /tmp/hax-taskdetail-6506-dQRgLV/full-tests.log and baseline-tests.log. Related tests: 134 passing, zero failing. The G5 oracle verifies the source fingerprint and asserts every failing test name occurs in the baseline output.

### Line-limit output

```text
   135 GATES.md
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
   160 src/app/detail/[...slug]/useTaskDetailReadiness.tsx
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
  8314 total
```
