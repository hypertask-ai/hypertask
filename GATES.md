# Gates: HTPR-6937 New Task window

OWNS: src/**, tests/**, GATES.md

Scope: Implement all seven requested changes behind the appropriate flags, preserve Compose when the new flag is off, verify locally and commit without pushing.

- [x] G1: Flag matrix, labels, shortcut ownership, existing empty task targeting and authorization, tooltips, Tab, dictation, attachments and layout have regression coverage
  CHECK: node --test --test-reporter=tap tests/compose-task-palette.test.cjs tests/compose-task-writer.test.cjs tests/agent-log-command.test.cjs tests/ui-patterns.test.cjs > /tmp/6937-target-final.log 2>&1 && cat /tmp/6937-target-final.log
  EXPECT: /# fail 0/
  EVIDENCE: automatic-evidence=v1; definition-sha256=624ba32cc2d18a1d5ae062d59adfbbe2cfd161a10924a8562f5ad5f12b910866; exit=0; EXPECT=matched; output-sha256=19eb03c7f73a64062d8050c639401192c9a3fe6005ab3463ffc4ea1029479640; output-bytes=19706; shell=/bin/sh; cwd=/home/valentin/projects/hypertask-6937; path=bea1390f0071/32 entries

- [x] G2: TypeScript accepts the complete change
  CHECK: npx tsc --noEmit -p . && printf 'TYPECHECK_OK\n'
  EXPECT: TYPECHECK_OK
  EVIDENCE: automatic-evidence=v1; definition-sha256=c56bc029cbd9eca53b013995938b7c0e5e9b8ae18985502e207e3e0b344fac54; exit=0; EXPECT=matched; output-sha256=0d31cf08e125020004c508c562e62037cd1809c414d62a869bc1452c072c96f0; output-bytes=13; shell=/bin/sh; cwd=/home/valentin/projects/hypertask-6937; path=bea1390f0071/32 entries

- [x] G3: Changed files pass the repository lint
  CHECK: npm run lint -- $(git diff --name-only -- '*.tsx' '*.ts') && printf 'LINT_OK\n'
  EXPECT: LINT_OK
  EVIDENCE: automatic-evidence=v1; definition-sha256=cd244090fe2d6f2148144d708314ac0ace5862569696d992ee5506c8383fe588; exit=0; EXPECT=matched; output-sha256=eab93fcbf9f7f5a2a93df9f51bff9da81dd5d79206c36bdb91549c9ee25bce80; output-bytes=7343; shell=/bin/sh; cwd=/home/valentin/projects/hypertask-6937; path=bea1390f0071/32 entries

- [x] G4: The full CI unit suite passes
  CHECK: npm test > /tmp/6937-unit-final.log 2>&1 && cat /tmp/6937-unit-final.log && printf 'UNIT_OK\n'
  EXPECT: UNIT_OK
  EVIDENCE: automatic-evidence=v1; definition-sha256=a97806d72f14c0fd1ece3c546db84f6a9cb2badfb5d085401bd4ccb32c59edc5; exit=0; EXPECT=matched; output-sha256=629fc4bcd883f9cdf5b52de86a9daf10cec3b675a08dc62d773204f31f0a5bdb; output-bytes=766973; shell=/bin/sh; cwd=/home/valentin/projects/hypertask-6937; path=bea1390f0071/32 entries

- [x] G5: Safe disposable local browser verification captures desktop, empty task shortcut, attachments, dictation and phone layout, or documents why no safe route exists
  EVIDENCE: Disposable local build at http://127.0.0.1:40575, account 985, both flags OWNER_AND_QA. Browser checks passed for a 1120px window, shortcut tooltips, Tab switching, real shared recorder with fake microphone and local transcript response, image/document thumbnails and removal through button, Ctrl+U, paste and drop, unclipped 390x844 layout, and saving into the same empty task through the actual local API. The disposable app and its containers were removed with scripts/premerge-local.sh down. Screenshots and browser-check.json are in /home/valentin/.local/state/vcc-evidence/HTPR-6937/local/. AI writer and transcription responses were intercepted locally; no production or live provider was used.

- [x] G6: Final diff is reviewed for simplification, both flag off paths, reuse, attachment delivery and request constraints; local commit exists with no push or PR
  EVIDENCE: Reviewed the full ticket diff and the late flag-tracing correction. Local implementation commits 4359aac74 and 26a431b26 exist. The feature-flag check passes against base 6541380f7654059199b617a1b01483997a8920d8. No push or PR. Final verification totals and ledger are committed separately.

## Review notes

- Attachment root cause: the shared gallery dynamically imports its thumbnail. Without a local Suspense boundary that import suspends the Reactstrap modal portal, remounting Compose and losing both its files and note. A browser reproduction lost the note; the same reproduction with the local boundary retained the note and painted the image. The fix applies under 6929 alone. Drop handling and empty-MIME image acceptance are also repaired.
- Both flags are required for New Task labels, layout, mic, shortcut tooltips, Tab switching, inline-writer suppression and existing-task targeting. Both server entry points enforce the target gates and normal task-write permissions. A shared empty-target predicate keeps client and server decisions aligned. The regular update controller saves the existing task and guards against a newer description.
- Reused SettingsScopeTabs, Tooltip, shortcut-display helpers, AudioButton, ImageGallery and the existing upload/binding lifecycle. Files remain links; image media is preserved after AI writing. No new choice or selection UI was added.
- Simplification pass found no further safe reduction without obscuring flag isolation or the existing-task workflow. Explicit branch assignments follow the existing shortcut-flag style so the CI flag scanner can trace every changed UI entry. The flagged removal attributes also preserve the original shared markup when either flag is off. This is recorded separately in commit 26a431b26. The both-on browser path is unchanged by that correction; regression tests additionally exercise the shared removal markup with each flag off.
- Old regression harnesses now provide the newly imported dependencies; the legacy inline-writer assertion explicitly checks the off branch. Additional affected regressions: 43 passed in /tmp/6937-legacy-final.log. Production-source flag-off desktop and phone DOM comparison passed in /tmp/6937-baseline.log.
- No push, PR, stash, production database access, production build or production dev server. Local browser AI/transcription responses were mocked; task persistence used only the disposable app API and database.

## Verification totals

- Node 24 with NODE_OPTIONS=--no-experimental-strip-types was used for the final checks.
- G1: 66 tests passed, zero failures. Log: /tmp/6937-target-final.log.
- G2: npx tsc --noEmit -p . passed.
- G3: npm run lint passed; its eslint . script checks the entire repository, including every changed file.
- G4: npm test passed across 875 Node test files and 88 TypeScript test files. The reporters counted 7051 tests: 7049 passed, zero failed, two optional Redis/PostgreSQL integration cases skipped. Fourteen TypeScript files use standalone assertion scripts rather than a test reporter. Log: /tmp/6937-unit-final.log.
- The local feature-flag check passed for the FEATURE title against base 6541380f7654059199b617a1b01483997a8920d8. Log: /tmp/6937-flag-gate.log.
- Final automatic gate run: /tmp/6937-gates-complete.log, all six gates met.
- Screenshots: board-new-task-tooltip.png, search-shortcut-tooltip.png, empty-task-ctrl-j.png, attachment-thumbnails.png, mic-button.png, dictation-recording.png, dictation-transcript.png, phone-390x844.png, phone-scroll-footer.png and filled-task-chat.png under /home/valentin/.local/state/vcc-evidence/HTPR-6937/local/. Screenshot hashes are in screenshot-sha256.json.

## Changed files

- src/lib/flags/keys.ts
- src/lib/flags.ts
- src/lib/ai/composeTaskTarget.ts
- src/lib/ai/composeTask.ts
- src/app/api/ai/_lib/taskWriterRun.ts
- src/pages/api/tasks/createGlobally.ts
- src/utils/api/global/apiHelpers/createTaskGloballycontroller.ts
- src/components/Modals/commands/HTC/ComposeTaskWriter.tsx
- src/components/Modals/commands/HTC/commands.tsx
- src/components/Modals/Settings/SettingsScopeTabs.tsx
- src/components/Modals/Settings/ShortcutsSection.tsx
- src/components/sidebars/keyboardShortcuts.tsx
- src/lib/constants/shortcuts.ts
- src/components/commands.tsx
- src/components/commandDispatcher.ts
- src/components/RTE/useTaskDetailEditorState.tsx
- src/components/RTE/useTaskDetailEditorEvents.tsx
- src/components/RTE/useTaskDetailEditorSave.tsx
- src/components/RTE/TaskDetailEditorPanels.tsx
- src/components/RTE/Tiptap.ts
- src/components/RTE/TiptapCreateTaskModal.tsx
- src/components/Common/AttachmentsUpload/SingleFileInputPreview.tsx
- tests/compose-task-palette.test.cjs
- tests/compose-task-writer.test.cjs
- tests/agent-log-command.test.cjs
- tests/feature-flags.test.cjs
- tests/cmdk-version.test.cjs
- tests/page-loading-layout-stability.test.cjs
- tests/task-create-empty-enrichment.test.cjs
- tests/task-detail-description-shortcut-focus.test.cjs
- GATES.md
