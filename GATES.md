# Gates: HTPR-6506 chat stream refactor

OWNS: GATES.md, src/app/api/ai/chat/stream/route.ts, src/lib/ai/tools/**, src/lib/ai/chatStream/**, tests/helpers/chat-stream-source.cjs, tests/*.test.cjs, scripts/parity-contract.mjs

Scope: Extract the chat stream route without changing behavior, preserve route exports and tool order, and commit only this work on the current branch. No installs, dependency changes, pushes, other worktrees, or new em dash characters.

Checks run from the worktree root using the existing shared dependencies. Verification scripts and baseline copies live only in /tmp.

- [x] G6: The committed worktree has an empty git status --short.
  CHECK: node /tmp/htpr-6506-a-route-clean.cjs
  EXPECT: CLEAN TREE VERIFIED
  EVIDENCE: automatic-evidence=v1; definition-sha256=41a72cbeb6da3b24f0a5c3b5e1fd48ceb2f35fe190ab76cbfaabd8f235c01347; exit=0; EXPECT=matched; output-sha256=a1fdfac9881ca1b8a75274b0acc16c2fca6a40aaeeb9f7f47d08e4e1f993d058; output-bytes=46; shell=/bin/sh; cwd=/home/valentin/projects/hypertask-wt/htpr-6506-a-route; path=fd5351737ae0/31 entries

- [x] G0: This ledger has valid, falsifiable gates.
  CHECK: node /home/valentin/.agents/skills/unlazy/scripts/gate-lint.mjs GATES.md
  EXPECT: LINT OK
  EVIDENCE: automatic-evidence=v1; definition-sha256=69f81179f3934636347ff01de4824d2a1f500f2d29238b9fd688f82f77d1c57b; exit=0; EXPECT=matched; output-sha256=48630b7361dd44ee870917b12c3d19b9d7bdea738aaca16bb04d4cab83b772d2; output-bytes=8; shell=/bin/sh; cwd=/home/valentin/projects/hypertask-wt/htpr-6506-a-route; path=fd5351737ae0/31 entries

- [x] G1: Every created or changed file is shorter than 1500 lines, with wc output retained below.
  CHECK: node /tmp/htpr-6506-a-route-lines.cjs
  EXPECT: LINE LIMITS VERIFIED
  EVIDENCE: automatic-evidence=v1; definition-sha256=7d03701ac1678a0f03cddfc7f12dbb0a76dc9ece388a6c095d8154f3d77c6311; exit=0; EXPECT=matched; output-sha256=3ae5d5572c10ad311553deb90d87d55bf642bf9741186b3f629ffe4c9591b2b0; output-bytes=5724; shell=/bin/sh; cwd=/home/valentin/projects/hypertask-wt/htpr-6506-a-route; path=fd5351737ae0/31 entries

- [x] G2: No function, arrow function, method, hook, or component spans more than 400 lines.
  CHECK: node /tmp/htpr-6506-a-route-functions.cjs && node /tmp/htpr-6506-a-route-function-control.cjs
  EXPECT: FUNCTION LIMITS VERIFIED
  EVIDENCE: automatic-evidence=v1; definition-sha256=5f6fa80bdef8b0f34a9f5d6f88e1682032b189e10a0511dba4c18e6a68c9b3c7; exit=0; EXPECT=matched; output-sha256=61a66e84fd196c3d31d014a7c3b1cd3d41a45d378296411c2c4d97bdf086c388; output-bytes=98; shell=/bin/sh; cwd=/home/valentin/projects/hypertask-wt/htpr-6506-a-route; path=fd5351737ae0/31 entries

- [x] G3: Prisma generation, Next route type generation, and TypeScript succeed, or any baseline errors are proven identical with zero new errors.
  CHECK: node /tmp/htpr-6506-a-route-typecheck.cjs
  EXPECT: TYPECHECK VERIFIED
  EVIDENCE: automatic-evidence=v1; definition-sha256=cf53848811294fbbb60d74848bc110339a712a9175328955e911bfdbc72be74a; exit=0; EXPECT=matched; output-sha256=2057f363cb2e9b0282b31a13c3efdb485b7f4d4f0571b33e30f6743f782f7e84; output-bytes=1839; shell=/bin/sh; cwd=/home/valentin/projects/hypertask-wt/htpr-6506-a-route; path=fd5351737ae0/31 entries

- [x] G4: ESLint succeeds for every touched or created file.
  CHECK: node /tmp/htpr-6506-a-route-lint.cjs
  EXPECT: LINT VERIFIED
  EVIDENCE: automatic-evidence=v1; definition-sha256=27730196ae4f6825a9db77033a2ef1c8ed3f3784d9845307b4853ccede974be6; exit=0; EXPECT=matched; output-sha256=f8b7c285ebda25be69d015084d677f04331f1272ba56bc3b978bdeb4bf0293e1; output-bytes=272; shell=/bin/sh; cwd=/home/valentin/projects/hypertask-wt/htpr-6506-a-route; path=fd5351737ae0/31 entries

- [x] G5: Related tests pass and the final full suite has zero new failures against origin/production.
  CHECK: node /tmp/htpr-6506-a-route-tests.cjs
  EXPECT: TESTS VERIFIED
  EVIDENCE: automatic-evidence=v1; definition-sha256=d423475bf32874b80a3b1b17614e0582a3063a87550f18fd4948a64be3a6d178; exit=0; EXPECT=matched; output-sha256=3c79731ae624734ee53cb6f71ee8f02a0a104da90b2052e3497e0e3f35b34f38; output-bytes=749; shell=/bin/sh; cwd=/home/valentin/projects/hypertask-wt/htpr-6506-a-route; path=fd5351737ae0/31 entries

- [x] G7: Extracted tools, helpers, prompts, schemas, descriptions, error strings, and route exports preserve the original code and ordering.
  CHECK: node /tmp/htpr-6506-a-route-all-preservation.cjs
  EXPECT: ALL PRESERVATION VERIFIED
  EVIDENCE: automatic-evidence=v1; definition-sha256=fcd520fc5db3c153e1ad3b679c3208f6b60564ee81bf90c9aa012074b69af0b5; exit=0; EXPECT=matched; output-sha256=81dc7c9bb3a2244c0f41c54ee83a31621ff012834c6c840ccb53903d7a865580; output-bytes=821; shell=/bin/sh; cwd=/home/valentin/projects/hypertask-wt/htpr-6506-a-route; path=fd5351737ae0/31 entries

- [x] G8: Changes respect the allowed scope, dependency restrictions, and commit-message contract.
  CHECK: node /tmp/htpr-6506-a-route-scope.cjs
  EXPECT: SCOPE VERIFIED
  EVIDENCE: automatic-evidence=v1; definition-sha256=04f7b4287214142deaf098a630f701445e08b4a59f41f602d91454eabeee1d00; exit=0; EXPECT=matched; output-sha256=6e61a791ece5fb986aa8167e69921cd2d6bf9ce47b68127ab3ffcb19f6a460ec; output-bytes=129; shell=/bin/sh; cwd=/home/valentin/projects/hypertask-wt/htpr-6506-a-route; path=fd5351737ae0/31 entries

## Evidence notes

- Original route: 11,062 lines. Final route: 273 lines, with only runtime, dynamic, maxDuration, and POST exported.
- New source files: 94 tool modules/support files, 14 chat stream modules, and one test source reader. Existing tests changed only their source-reading imports; parity inventory changed only its source path.
- Largest function: createDraftTool, src/lib/ai/tools/draft.ts:18, 287 lines. The TypeScript size scanner emits no violations and rejects a known 401-line function.
- Preservation proof: all 83 tool definitions, their order, 94 helper declarations, route config exports, and 12 extracted stream phases match original syntax tokens, including raw string/template bytes.
- Behavior proof: 28 mocked HTTP/SSE scenarios have identical status, headers, bodies, provider inputs, and side-effect traces. Includes native-agent attribution, replay, fleet success/failure, empty retry, Stop, deadline, observability, completion fences, and client disconnection.
- Type generation succeeds. Prisma was already generated and is skipped because node_modules is shared. TypeScript has exactly the same four baseline errors at AppSheet.tsx:2,147,170 and redis.ts:45, with byte-identical diagnostic output and zero new errors.
- Baseline source: a private git archive of origin/production at 828e18c7fc24ca17d8bd8ef8a9a2bd669db42393 in /tmp, not another worktree. Baseline diagnostics and test outputs are retained there.
- Related checks: 271 passing tests, zero failures, including the two related TypeScript files. The full runner: 4,820 passed, five failed, 4,825 total. All five failures also fail in a focused baseline run: firebase-admin version, jsonwebtoken version, mobile sheet dependency, native tsc binary, and SDK native compiler installation.
- Baseline full run: 4,816 passed, nine failed. Focused baseline dependency failures: 15 passed, five failed. The full runner stops before its 82 TypeScript files because its Node stage fails; the related TypeScript files are verified separately.
- The first full run also hit a transient Node IPC deserialization error in an untouched preference test. That test passed on retry and on the baseline, and the final full run did not repeat the IPC error.
- ESLint exits zero for all 140 paths. Markdown receives the normal ignored-file warning; all 139 source files are linted.
- Reviewer focus: shared stream state across cancellation, deadline, provider callbacks, and persistence fences; the source reader that keeps existing static and closure-evaluation tests working.
- Only local commits are made. No push, install, dependency edit, deployment, other-worktree change, or new em dash character.
- The clean-tree gate runs first from a committed tree. Its command is repeated after the final evidence commit so recording evidence cannot leave a dirty ledger.

## Final wc -l output

```text
   215 GATES.md
   599 scripts/parity-contract.mjs
   273 src/app/api/ai/chat/stream/route.ts
   248 src/lib/ai/chatStream/content.ts
   178 src/lib/ai/chatStream/errors.ts
   230 src/lib/ai/chatStream/fleetTurn.ts
   259 src/lib/ai/chatStream/modelReply.ts
   248 src/lib/ai/chatStream/modelTurn.ts
   204 src/lib/ai/chatStream/models.ts
   175 src/lib/ai/chatStream/prompt.ts
    82 src/lib/ai/chatStream/request.ts
   274 src/lib/ai/chatStream/runStream.ts
    18 src/lib/ai/chatStream/stream.ts
    49 src/lib/ai/chatStream/streamState.ts
    66 src/lib/ai/chatStream/title.ts
   265 src/lib/ai/chatStream/turnModel.ts
    22 src/lib/ai/chatStream/types.ts
   257 src/lib/ai/tools/addComment.ts
    65 src/lib/ai/tools/agentPresence.ts
    81 src/lib/ai/tools/agentWebhook.ts
    65 src/lib/ai/tools/askAgent.ts
    78 src/lib/ai/tools/assignUser.ts
   291 src/lib/ai/tools/attachFiles.ts
   164 src/lib/ai/tools/boardConfig.ts
    63 src/lib/ai/tools/boardManifest.ts
    52 src/lib/ai/tools/constants.ts
    83 src/lib/ai/tools/context.ts
    37 src/lib/ai/tools/createAgent.ts
   248 src/lib/ai/tools/createBoard.ts
    66 src/lib/ai/tools/createLabel.ts
    63 src/lib/ai/tools/createPage.ts
    60 src/lib/ai/tools/createReport.ts
    94 src/lib/ai/tools/createSkill.ts
   213 src/lib/ai/tools/createTask.ts
    81 src/lib/ai/tools/createView.ts
   139 src/lib/ai/tools/decisionRequest.ts
    78 src/lib/ai/tools/deleteComment.ts
    85 src/lib/ai/tools/deleteReport.ts
    57 src/lib/ai/tools/deleteSkill.ts
    25 src/lib/ai/tools/deleteView.ts
   304 src/lib/ai/tools/draft.ts
   189 src/lib/ai/tools/execution.ts
    37 src/lib/ai/tools/findRelatedTasks.ts
    41 src/lib/ai/tools/getBoardPlaybook.ts
   103 src/lib/ai/tools/getCommentsForTask.ts
    67 src/lib/ai/tools/getPage.ts
    50 src/lib/ai/tools/getReport.ts
    25 src/lib/ai/tools/getSkill.ts
    59 src/lib/ai/tools/getTaskTree.ts
   102 src/lib/ai/tools/getTasks.ts
   129 src/lib/ai/tools/getUserContext.ts
   113 src/lib/ai/tools/getView.ts
   584 src/lib/ai/tools/helpers.ts
    84 src/lib/ai/tools/importSkills.ts
    61 src/lib/ai/tools/inboxArchive.ts
   115 src/lib/ai/tools/inboxList.ts
    42 src/lib/ai/tools/inboxUnarchive.ts
   201 src/lib/ai/tools/index.ts
    96 src/lib/ai/tools/linkTasks.ts
    32 src/lib/ai/tools/listAgents.ts
    28 src/lib/ai/tools/listConnections.ts
    34 src/lib/ai/tools/listCustomFields.ts
    49 src/lib/ai/tools/listLabels.ts
    60 src/lib/ai/tools/listPages.ts
    48 src/lib/ai/tools/listProjectMembers.ts
   117 src/lib/ai/tools/listProjects.ts
    46 src/lib/ai/tools/listReports.ts
    43 src/lib/ai/tools/listSkills.ts
   252 src/lib/ai/tools/listTasks.ts
   209 src/lib/ai/tools/listViews.ts
    52 src/lib/ai/tools/logTime.ts
   132 src/lib/ai/tools/metadata.ts
    39 src/lib/ai/tools/mintToken.ts
   117 src/lib/ai/tools/moveTaskBetweenBoards.ts
   100 src/lib/ai/tools/moveTaskToInbox.ts
    48 src/lib/ai/tools/myTasks.ts
   195 src/lib/ai/tools/nextTasks.ts
   101 src/lib/ai/tools/pageHistory.ts
    57 src/lib/ai/tools/pauseTimer.ts
   210 src/lib/ai/tools/projectAdmin.ts
    35 src/lib/ai/tools/ragRetrieval.ts
    57 src/lib/ai/tools/resumeTimer.ts
    35 src/lib/ai/tools/revokeAgent.ts
    42 src/lib/ai/tools/revokeToken.ts
    33 src/lib/ai/tools/runningTimers.ts
    19 src/lib/ai/tools/schemas.ts
    24 src/lib/ai/tools/searchHelpDocs.ts
    40 src/lib/ai/tools/searchPages.ts
   143 src/lib/ai/tools/searchTasks.ts
   238 src/lib/ai/tools/section.ts
   137 src/lib/ai/tools/setCustomFieldValue.ts
    51 src/lib/ai/tools/startTimer.ts
    51 src/lib/ai/tools/stopTimer.ts
    25 src/lib/ai/tools/switchView.ts
   221 src/lib/ai/tools/taskAssigneeMutation.ts
   225 src/lib/ai/tools/taskAssignees.ts
   202 src/lib/ai/tools/taskContext.ts
   125 src/lib/ai/tools/taskDescriptionHistory.ts
   106 src/lib/ai/tools/timeReport.ts
    44 src/lib/ai/tools/timeStatus.ts
    78 src/lib/ai/tools/unassignUser.ts
   143 src/lib/ai/tools/updateComment.ts
   266 src/lib/ai/tools/updateOneTask.ts
    83 src/lib/ai/tools/updatePage.ts
    41 src/lib/ai/tools/updateProfile.ts
    60 src/lib/ai/tools/updateReport.ts
   101 src/lib/ai/tools/updateSkill.ts
   194 src/lib/ai/tools/updateTask.ts
    80 src/lib/ai/tools/updateTaskSchema.ts
    85 src/lib/ai/tools/updateView.ts
    73 src/lib/ai/tools/webSearch.ts
   103 tests/agent-assignment-parity.test.cjs
   369 tests/agent-provider-key.test.cjs
   245 tests/agent-webhook-adoption.test.cjs
   299 tests/ai-bulk-confirmation.test.cjs
   506 tests/ai-chat-background-persistence.test.cjs
   127 tests/ai-chat-board-config.test.cjs
    86 tests/ai-chat-custom-fields.test.cjs
   196 tests/ai-chat-description-realtime.test.cjs
   117 tests/ai-chat-observability.test.cjs
   103 tests/ai-chat-page-history.test.cjs
   125 tests/ai-chat-profile-time-report-parity.test.cjs
   251 tests/ai-chat-project-admin.test.cjs
    61 tests/ai-chat-task-description-history.test.cjs
   249 tests/ai-chat-user-facing-errors.test.cjs
    60 tests/ai-comment-task-links.test.cjs
   121 tests/ai-label-update-confirmation.test.cjs
   356 tests/ai-native-bearer-auth.test.cjs
    40 tests/ai-output-style-unslop.test.cjs
   108 tests/ai-usage-attribution.test.cjs
   259 tests/error-pipeline.test.cjs
    94 tests/helpers/chat-stream-source.cjs
   171 tests/htpr-6516-agent-attribution.test.cjs
   174 tests/management-surface-parity.test.cjs
    73 tests/mcp-rag-retrieval.test.cjs
   138 tests/mcp-time-pause-resume.test.cjs
   507 tests/native-agent-heartbeat-durability.test.cjs
    28 tests/project-members-include-owner.test.cjs
   486 tests/time-report-followups.test.cjs
   104 tests/tool-input-padding.test.cjs
 18834 total
```
