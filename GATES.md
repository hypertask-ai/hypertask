# Gates: HTPR-6506 monolith refactor

Scope: Split the eight requested modules by moving code, preserve exports and behavior, and commit locally without changing dependencies or other worktrees.

- [x] G0: The ledger defines measurable outcomes
  CHECK: node /home/valentin/.agents/skills/unlazy/scripts/gate-lint.mjs GATES.md
  EXPECT: LINT OK
  EVIDENCE: automatic-evidence=v1; definition-sha256=69f81179f3934636347ff01de4824d2a1f500f2d29238b9fd688f82f77d1c57b; exit=0; EXPECT=matched; output-sha256=48630b7361dd44ee870917b12c3d19b9d7bdea738aaca16bb04d4cab83b772d2; output-bytes=8; shell=/bin/sh; cwd=/home/valentin/projects/hypertask-wt/htpr-6506-g-misc; path=fd5351737ae0/31 entries

- [x] G1: Every created or changed file has fewer than 1500 lines
  CHECK: node /tmp/htpr-6506-g-misc/check.cjs lines
  EXPECT: LINE LIMITS PASSED
  EVIDENCE: automatic-evidence=v1; definition-sha256=fa784be9e0c691e081d214cae8cf6f2ff806af71923fb27a6e5a06ed7b0ec3aa; exit=0; EXPECT=matched; output-sha256=a20fbbbb393bf0c64a61dec7ade945e24417fbb636a122bf7a639ca574bfff22; output-bytes=5856; shell=/bin/sh; cwd=/home/valentin/projects/hypertask-wt/htpr-6506-g-misc; path=fd5351737ae0/31 entries

- [x] G2: Every touched function, arrow, and method spans at most 400 lines
  CHECK: node /tmp/htpr-6506-g-misc/functions.cjs
  EXPECT: FUNCTION LIMITS PASSED
  EVIDENCE: automatic-evidence=v1; definition-sha256=ae47272ddb45e41bc7cefc5170e86a127df4a96d2dbf713eac91c48fe2cddfd2; exit=0; EXPECT=matched; output-sha256=5e0ccf2c6523e35527110b5d879eab7618b89d2e81ef19e93b812355c84b0d6c; output-bytes=23; shell=/bin/sh; cwd=/home/valentin/projects/hypertask-wt/htpr-6506-g-misc; path=fd5351737ae0/31 entries

- [x] G3: Typechecking introduces zero errors compared with origin/production
  CHECK: node /tmp/htpr-6506-g-misc/check.cjs types
  EXPECT: TYPECHECK PASSED
  EVIDENCE: automatic-evidence=v1; definition-sha256=bd100e2ef0b1ab0da774a4fdc4997e436a21c95de6483d1250a320418f8db89b; exit=0; EXPECT=matched; output-sha256=a9301c1598596787ccd913e65cfecfab33667a6038d7feadab5f79154b42d5c9; output-bytes=1753; shell=/bin/sh; cwd=/home/valentin/projects/hypertask-wt/htpr-6506-g-misc; path=fd5351737ae0/31 entries

- [x] G4: ESLint passes for every touched source file
  CHECK: node /tmp/htpr-6506-g-misc/check.cjs lint
  EXPECT: LINT PASSED
  EVIDENCE: automatic-evidence=v1; definition-sha256=7f6225072f34fe5326f5c680f234c6d54659f70112cad41d07476abc06e55c83; exit=0; EXPECT=matched; output-sha256=a24e7fc4e337fc514c9381e80ff904b52ca1ab530199bf987606f54dfcd56f37; output-bytes=190; shell=/bin/sh; cwd=/home/valentin/projects/hypertask-wt/htpr-6506-g-misc; path=fd5351737ae0/31 entries

- [x] G5: Related tests pass and the full suite has no new failures
  CHECK: node /tmp/htpr-6506-g-misc/check.cjs tests
  EXPECT: TESTS PASSED
  EVIDENCE: automatic-evidence=v1; definition-sha256=f613b52256f79032f4524ad95572ee95a2aa57d4576180add42077b8c0960b6d; exit=0; EXPECT=matched; output-sha256=c1a5a42810a2ea1dd5f02045bc9b1df75a2cfff804286b9a80ed29abb9268940; output-bytes=700; shell=/bin/sh; cwd=/home/valentin/projects/hypertask-wt/htpr-6506-g-misc; path=fd5351737ae0/31 entries

- [x] G6: The final commit leaves a clean working tree
  CHECK: test -z "$(git status --short)" && printf 'CLEAN TREE PASSED\n'
  EXPECT: CLEAN TREE PASSED
  EVIDENCE: automatic-evidence=v1; definition-sha256=33a193a1548a00e8cd71d64b5252a0d5e4e70f2d4d6c232b45a33114c0910760; exit=0; EXPECT=matched; output-sha256=bbc9bdf9e7aac9a8d2792e1377d80c1a6014240231f38416bdd1c59ce9cc7a39; output-bytes=18; shell=/bin/sh; cwd=/home/valentin/projects/hypertask-wt/htpr-6506-g-misc; path=fd5351737ae0/31 entries

- [x] G7: Runtime literals, existing exports, and moved logic are preserved
  CHECK: node /tmp/htpr-6506-g-misc/check.cjs preservation
  EXPECT: PRESERVATION PASSED
  EVIDENCE: automatic-evidence=v1; definition-sha256=3e7d6427eba1571f798de4050fac88ebccc27d667f8267203e60aacac22f6a7f; exit=0; EXPECT=matched; output-sha256=997c557289e53dde53ee2ae37060e1bfeb384cc977873169177e562e2c05368e; output-bytes=130; shell=/bin/sh; cwd=/home/valentin/projects/hypertask-wt/htpr-6506-g-misc; path=fd5351737ae0/31 entries

- [x] G8: Changes stay in scope and commits use the required format
  CHECK: node /tmp/htpr-6506-g-misc/check.cjs scope
  EXPECT: SCOPE PASSED
  EVIDENCE: automatic-evidence=v1; definition-sha256=c2d8a48574f1e3775de2fc0f928da41428a675660d7d4ef12a2b0bbeae926f3a; exit=0; EXPECT=matched; output-sha256=5129dbebafa1911b14611728ea8704af6112b9bf83344a7d39ab71d8284356bd; output-bytes=140; shell=/bin/sh; cwd=/home/valentin/projects/hypertask-wt/htpr-6506-g-misc; path=fd5351737ae0/31 entries

## Execution plan

1. Inventory declarations and oversized closures in each original file.
2. Extract static data and independent helpers, then split large hooks and components at existing logical boundaries.
3. Audit moved text and dependencies, run related tests and intermediate checks, and commit small groups.
4. Run all final gates, record measured output, commit the ledger, and verify the clean tree externally without modifying it.

The clean-tree gate runs after committing the verified ledger. Its evidence is then committed, and the same clean-tree command is run again without writing to the ledger.

## Verification details

- Ticket: https://app.hypertask.ai/detail/project-15/6506. Local work only; no push, PR, deploy, or ticket closure.
- Baseline: saved starting production commit `283b3c0d89c1021ec7e6495625a758ea8c6a2075`. The shared production ref advanced during this session; comparisons use the saved baseline, not the moving ref.
- All eight original module exports remain available. New files: 35 production modules, 2 test source loaders, and this ledger. Existing test changes: 68 source-import/source-loader updates; 2,382 assertion calls are byte-for-byte unchanged.
- File-size oracle: `wc -l` on every changed or created file, including tests and this ledger. Largest file: `src/app/[...boardURL]/LandingPage.tsx`, 1,411 lines.
- Function-size oracle: TypeScript AST `isFunctionLike` traversal covers functions, arrows, methods, hooks, and components. Largest: `createGeneralCommandActions`, `src/components/generalCommandActions.ts:19-379`, 361 lines.
- Negative control: `/tmp/htpr-6506-g-misc/oversized-control.ts` contains a 403-line `oversizedControl`; the AST checker exits 1 and reports that violation.
- Preservation: 1,921 distinct runtime literals and 845 existing function bodies unchanged; existing exports preserved. Large split closures were audited separately for statement ordering, hook ordering, captured variables, JSX structure, and command-switch termination/fallthrough.
- ESLint: all changed/new source and test files pass. The ledger produces only an ignored-file warning.
- Generation: `npx next typegen` passes. Generated Prisma client already exists; generation skipped to avoid writing shared `node_modules`.
- Typecheck: `npx tsc --noEmit` initially exited 2 and finally exited 1 on both actual and reverified baseline trees, with exactly the same four baseline diagnostics, zero added errors: `AppSheet.tsx:2` missing `useScrollPosition`, `AppSheet.tsx:147` unsupported `content` detent, `AppSheet.tsx:170` unsupported `disableScroll`, and `redis.ts:45` unsupported `protocol` option. Diagnostics normalize only quoted drag-property union ordering.
- Related runner: exit 0, 784 TAP tests pass, zero failures; related TypeScript scripts also pass.
- Full runner: `node scripts/run-tests.mjs` exits 1 after completing all Node suites: 4,825 tests, 4,820 pass, 5 fail, zero cancelled/skipped/todo. The runner stops before TypeScript when Node tests fail; all 82 TypeScript test files were therefore run separately and pass on both actual and baseline trees.
- All five full-suite failures reproduce on the pristine baseline: installed Firebase Admin version, installed jsonwebtoken version, `mobile-sheet-drag-close.test.cjs`, native TypeScript default compiler, and SDK compiler sharing. They reflect the existing shared dependency/compiler mismatch; no dependencies were installed or modified.
- Baseline full runner timed out at 1,800 seconds after 4,741 observed results and nine failures, without its shared-suite summary. Its four additional failures were one Node worker serialization failure and three git-dependent health assertions in the archive. The final actual run completed with 4,786 observed TAP result lines (4,825 tests including nested cases); no newly failing test name exists.
- Runtime: Node v22.22.2 on this host; repository expects Node 24. Intermittent Node worker transport failures were observed on baseline/early runs; the final related and full actual runs had no new transport failures. This environment limitation is not a claim that CI is green.
- Evidence and temporary oracles: `/tmp/htpr-6506-g-misc/`, including `check.cjs`, `functions.cjs`, `originals.json`, typecheck logs, related/full/baseline logs, and `typescript-test-results.json`. G5 validates recorded full-suite exit, completed TAP summary, baseline failure inclusion, and separate TypeScript exits rather than rerunning the 25-minute suite.
- Reviewer focus: extracted hook order and callback closure lifetimes, SSE cancellation/session queue handling, switch-group dispatch termination, and test loader ordering. Landing readiness hooks deliberately stay in the original module to preserve unchanged oversized source-contract tests.
- Incidental filesystem mistake: an earlier extraction script overwrote a pre-existing `/tmp/htpr-6506-split.cjs` from another session before its ownership was noticed. Its original content has not been recovered. All subsequent temporary tools are namespaced here; no other worktree files were changed.

## Changed/new file line counts

The following is the final `wc -l` inventory; the ledger row and total include this section.

```text
    200 GATES.md
   1411 src/app/[...boardURL]/LandingPage.tsx
    240 src/app/[...boardURL]/LandingPageSection.tsx
     90 src/app/[...boardURL]/LandingPageShared.ts
    162 src/app/[...boardURL]/useLandingSectionState.ts
   1119 src/app/api/ai/_lib/editorAi.ts
    428 src/app/api/ai/_lib/editorAiPrompts.ts
    695 src/components/Common/AttachmentsUpload/AttachmentControls.tsx
    265 src/components/Common/AttachmentsUpload/MobileAttachmentEdit.tsx
     52 src/components/Common/AttachmentsUpload/attachmentUploadTypes.ts
    370 src/components/Common/AttachmentsUpload/index.tsx
    267 src/components/Common/AttachmentsUpload/useAttachmentUploadState.ts
   1036 src/components/Modals/commands/HTC/AllCommands.ts
    411 src/components/Modals/commands/HTC/navigationCommands.ts
    553 src/components/Modals/commands/HTC/taskCommands.ts
    287 src/components/PageComponents/Kanban/TableView/TableTaskRow.tsx
    493 src/components/PageComponents/Kanban/TableView/TableView.tsx
    290 src/components/PageComponents/Kanban/TableView/tableViewShared.tsx
    359 src/components/PageComponents/Kanban/TableView/useTableActions.ts
    205 src/components/PageComponents/Kanban/TableView/useTableColumns.ts
    185 src/components/PageComponents/Kanban/TableView/useTableKeyboard.ts
    209 src/components/PageComponents/Kanban/TableView/useTableRows.ts
    259 src/components/PageComponents/Kanban/TableView/useTableState.ts
    324 src/components/boardCommandActions.ts
   1060 src/components/commandDispatcher.ts
    246 src/components/commandModalCallbacks.ts
     20 src/components/commandModalPanels1.tsx
    603 src/components/commandModalPanels2.tsx
    145 src/components/commandModals.ts
      8 src/components/commandTypes.ts
    212 src/components/commands.tsx
    379 src/components/generalCommandActions.ts
    370 src/components/useCommandsState.ts
    250 src/hooks/MultiPages/AIChat/aiChatKeyboard.ts
    325 src/hooks/MultiPages/AIChat/aiChatSend.ts
     45 src/hooks/MultiPages/AIChat/aiChatShared.ts
    278 src/hooks/MultiPages/AIChat/aiChatStream.ts
    180 src/hooks/MultiPages/AIChat/useAiChat.ts
    209 src/hooks/MultiPages/AIChat/useAiChatAttachments.ts
    223 src/hooks/MultiPages/AIChat/useAiChatPresentation.ts
    300 src/hooks/MultiPages/AIChat/useAiChatSessions.ts
    299 src/hooks/MultiPages/AIChat/useAiChatState.ts
   1114 src/utils/helperFunctions/helperFunctions.ts
    483 src/utils/helperFunctions/inboxHelpers.ts
    261 tests/accounts.test.cjs
    128 tests/add-column-no-saved-view.test.ts
    103 tests/add-column-visible.test.ts
    369 tests/agent-provider-key.test.cjs
    434 tests/agents-register-view.test.cjs
    159 tests/ai-chat-attachment-persist.test.cjs
    506 tests/ai-chat-background-persistence.test.cjs
    142 tests/ai-chat-display-modes.test.cjs
     41 tests/ai-chat-inbox-refresh-on-done.test.cjs
    154 tests/ai-chat-stream-not-cancelled.test.cjs
     73 tests/ai-chat-workspace-focus.test.cjs
    356 tests/ai-native-bearer-auth.test.cjs
     40 tests/ai-output-style-unslop.test.cjs
     49 tests/app-shell-ai-chat-shortcut.test.cjs
     95 tests/app-shell-rail-mount-shift.test.cjs
     57 tests/archive-shortcut-surfaces.test.cjs
    102 tests/attachment-mime-no-cors-fetch.test.cjs
    172 tests/board-background-refetch-render.test.cjs
    156 tests/board-ctrl-j-ai-task-writer.test.cjs
     41 tests/board-document-title.test.cjs
    194 tests/board-management-settings.test.ts
    116 tests/board-optional-islands.test.cjs
    627 tests/board-readiness-phases.test.cjs
    309 tests/board-startup-priority.test.cjs
    383 tests/board-switch-no-remount.test.cjs
    144 tests/chat-history-on-demand.test.cjs
     17 tests/comment-field-divider.test.cjs
    165 tests/copy-current-url-command.test.cjs
     61 tests/cycle-ui-contract.test.cjs
    391 tests/early-board-bootstrap.test.cjs
    385 tests/empty-board-columns-toggle.test.ts
     68 tests/favorites-response.test.cjs
     80 tests/hyper-mentioned-cross-board-context.test.cjs
   1268 tests/inbox-sync-read-model.test.cjs
    640 tests/inbox-zero.test.cjs
     98 tests/keyboard-shortcut-tutorial-disabled.test.cjs
    219 tests/learn-tutorial-inbox.test.cjs
    601 tests/mobile-ai-first-create-task.test.cjs
     57 tests/mobile-board-column-stability.test.cjs
     76 tests/mobile-comment-composer-hierarchy.test.cjs
    225 tests/mobile-comment-composer-primary.test.cjs
    201 tests/mobile-comment-composer-visuals.test.cjs
     33 tests/mobile-comment-send.test.cjs
     93 tests/mobile-description-first-create-task.test.cjs
    240 tests/mobile-existing-content-editor.test.cjs
    218 tests/mobile-new-task-actions.test.cjs
    104 tests/mobile-provider-startup.test.cjs
    155 tests/project-bootstrap-payload.test.cjs
    105 tests/project-prefix-generation.test.cjs
     75 tests/project-url-canonicalization.test.cjs
     34 tests/refactored-module-require.cjs
     59 tests/refactored-module-source.cjs
    123 tests/search-archived-toggle.test.cjs
    732 tests/section-auto-assign-agent.test.cjs
    229 tests/smart-splits.test.cjs
    675 tests/stripe-subscription-entitlement.test.cjs
    153 tests/style-guide-documentation.test.cjs
     76 tests/table-ctrl-e-archive.test.cjs
     56 tests/table-mobile-horizontal-scroll.test.cjs
    149 tests/task-archive-undo.test.cjs
    564 tests/task-comment-background-realtime.test.cjs
     73 tests/task-description-version-history-ui.test.cjs
    158 tests/task-template-prefill.test.cjs
    141 tests/task-writer-board-research.test.ts
    129 tests/task-writer-board-templates.test.cjs
    278 tests/task-writer-context-synthesis.test.cjs
    246 tests/theme-preferences.test.cjs
    486 tests/time-report-followups.test.cjs
    130 tests/tiptap-attachment-state.test.cjs
    171 tests/tiptap-debounce-lifecycle.test.cjs
  32107 total
```
