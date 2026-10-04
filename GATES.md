# Gates: HTPR-6937 New Task window

OWNS: src/**, tests/**, GATES.md

Scope: Implement all seven requested changes behind the appropriate flags, preserve Compose when the new flag is off, verify locally and commit without pushing.

- [x] G1: Flag matrix, labels, shortcut ownership, existing empty task targeting and authorization, tooltips, Tab, dictation, attachments and layout have regression coverage
  CHECK: node --test --test-reporter=tap tests/compose-task-palette.test.cjs tests/compose-task-writer.test.cjs tests/agent-log-command.test.cjs tests/ui-patterns.test.cjs > /tmp/6937-target-final.log 2>&1 && cat /tmp/6937-target-final.log
  EXPECT: /# fail 0/
  EVIDENCE: automatic-evidence=v1; definition-sha256=624ba32cc2d18a1d5ae062d59adfbbe2cfd161a10924a8562f5ad5f12b910866; exit=0; EXPECT=matched; output-sha256=b6b73128b3fab1db48c6371dc139f7474bb265f69f317ad34ee71a72ffdc7f4e; output-bytes=19404; shell=/bin/sh; cwd=/home/valentin/projects/hypertask-6937; path=bea1390f0071/32 entries

- [x] G2: TypeScript accepts the complete change
  CHECK: npx tsc --noEmit -p . && printf 'TYPECHECK_OK\n'
  EXPECT: TYPECHECK_OK
  EVIDENCE: automatic-evidence=v1; definition-sha256=c56bc029cbd9eca53b013995938b7c0e5e9b8ae18985502e207e3e0b344fac54; exit=0; EXPECT=matched; output-sha256=0d31cf08e125020004c508c562e62037cd1809c414d62a869bc1452c072c96f0; output-bytes=13; shell=/bin/sh; cwd=/home/valentin/projects/hypertask-6937; path=bea1390f0071/32 entries

- [x] G3: Changed files pass the repository lint
  CHECK: npm run lint -- $(git diff --name-only -- '*.tsx' '*.ts') && printf 'LINT_OK\n'
  EXPECT: LINT_OK
  EVIDENCE: automatic-evidence=v1; definition-sha256=cd244090fe2d6f2148144d708314ac0ace5862569696d992ee5506c8383fe588; exit=0; EXPECT=matched; output-sha256=4cb805f64d0c2fa7dfe4fb387fd5ee8aa3c587d9f662b4057cd6a8d882423438; output-bytes=8229; shell=/bin/sh; cwd=/home/valentin/projects/hypertask-6937; path=bea1390f0071/32 entries

- [x] G4: The full CI unit suite passes
  CHECK: npm test > /tmp/6937-unit-final.log 2>&1 && cat /tmp/6937-unit-final.log && printf 'UNIT_OK\n'
  EXPECT: UNIT_OK
  EVIDENCE: automatic-evidence=v1; definition-sha256=a97806d72f14c0fd1ece3c546db84f6a9cb2badfb5d085401bd4ccb32c59edc5; exit=0; EXPECT=matched; output-sha256=fba5501fe3abc00d644aba8a9944b2ac72f70fb1db14fc7a21851c0fb5d5c7af; output-bytes=766662; shell=/bin/sh; cwd=/home/valentin/projects/hypertask-6937; path=bea1390f0071/32 entries

- [x] G5: Safe disposable local browser verification captures desktop, empty task shortcut, attachments, dictation and phone layout, or documents why no safe route exists
  EVIDENCE: Disposable local build at http://127.0.0.1:40575, account 985, both flags OWNER_AND_QA. Browser checks passed for a 1120px window, shortcut tooltips, Tab switching, real shared recorder with fake microphone and local transcript response, image/document thumbnails and removal through button, Ctrl+U, paste and drop, unclipped 390x844 layout, and saving into the same empty task through the actual local API. The disposable app and its containers were removed with scripts/premerge-local.sh down. Screenshots and browser-check.json are in /home/valentin/.local/state/vcc-evidence/HTPR-6937/local/. AI writer and transcription responses were intercepted locally; no production or live provider was used.

- [ ] G6: Final diff is reviewed for simplification, both flag off paths, reuse, attachment delivery and request constraints; local commit exists with no push or PR
  EVIDENCE: pending

## Review notes

- Attachment root cause: the shared gallery dynamically imports its thumbnail. Without a local Suspense boundary that import suspends the Reactstrap modal portal, remounting Compose and losing both its files and note. A browser reproduction lost the note; the same reproduction with the local boundary retained the note and painted the image. The fix applies under 6929 alone. Drop handling and empty-MIME image acceptance are also repaired.
- Both flags are required for New Task labels, layout, mic, shortcut tooltips, Tab switching, inline-writer suppression and existing-task targeting. Both server entry points enforce the target gates and normal task-write permissions. A shared empty-target predicate keeps client and server decisions aligned. The regular update controller saves the existing task and guards against a newer description.
- Reused SettingsScopeTabs, Tooltip, shortcut-display helpers, AudioButton, ImageGallery and the existing upload/binding lifecycle. Files remain links; image media is preserved after AI writing. No new choice or selection UI was added.
- Simplification pass found no further safe reduction without obscuring flag isolation or the existing-task workflow. No standalone simplification commit was needed.
- Old regression harnesses now provide the newly imported dependencies; the legacy inline-writer assertion explicitly checks the off branch. Additional affected regressions: 43 passed in /tmp/6937-legacy-final.log. Production-source flag-off desktop and phone DOM comparison passed in /tmp/6937-baseline.log.
- No push, PR, stash, production database access, production build or production dev server. Local browser AI/transcription responses were mocked; task persistence used only the disposable app API and database.

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
