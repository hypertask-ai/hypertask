# Gates: agent chat and detail extraction

OWNS: src/app/agents/chat/AgentChatClient.tsx, src/app/agents/chat/AgentChat*.tsx, src/app/agents/chat/agentChat*.ts, src/app/agents/chat/useAgent*.ts, src/app/agents/[agentId]/AgentDetail.tsx, src/app/agents/[agentId]/Agent*.tsx, src/app/agents/[agentId]/agentDetail*.ts, src/app/agents/[agentId]/useAgent*.ts, tests/agent-activity-labels.test.cjs, tests/agent-chat-activity-routes.test.cjs, tests/agent-chat-drafts-and-details-sheet.test.cjs, tests/agent-chat-reply-timeout.test.cjs, tests/agent-chat-scroll-on-load.test.cjs, tests/agent-chat-task-reference-search.test.ts, tests/agent-provider-key.test.cjs, tests/agent-rooms-contract.test.cjs, tests/agent-token-hash.test.cjs, tests/agent-visibility.test.ts, tests/app-shell-rail-mount-shift.test.cjs, tests/mobile-agent-chat-composer-6041.test.cjs, tests/mobile-agent-chat-fullscreen-6476.test.cjs, tests/mobile-agent-chat-layout-6407.test.cjs, tests/mobile-agent-chat-viewport.test.cjs, tests/helpers/agent-chat-source.cjs, tests/helpers/agent-detail-source.cjs, tests/helpers/agent-visibility-source.ts, GATES.md

Scope: Pure extraction of the two assigned agent components on the current branch, preserving original exports, hook order, dependencies and all user-visible behavior. No dependency changes, pushes or other worktrees.

- [x] G1: Every created or changed file has fewer than 1500 lines
  CHECK: node /tmp/htpr-6506-b-checks.cjs lines
  EXPECT: LINE LIMITS PASS
  EVIDENCE: automatic-evidence=v1; definition-sha256=d3cd89b0094bc354d776c69cd229d92a4dc7f6bde8c1b15597c711c0384ee7d1; exit=0; EXPECT=matched; output-sha256=ab7099e36f7c830377c7cb4375da5f8d297897548fc8acbd5e401b4cb202d5ff; output-bytes=2599; shell=/bin/sh; cwd=/home/valentin/projects/hypertask-wt/htpr-6506-b-agents; path=fd5351737ae0/31 entries

- [x] G2: Every function, arrow function and method in touched source files spans at most 400 lines
  CHECK: node /tmp/htpr-6506-b-functions.cjs
  EXPECT: FUNCTION LIMITS PASS
  EVIDENCE: automatic-evidence=v1; definition-sha256=c6523cb8c09b92f874363e17a5b0b03022a3995a9d8ab28d6d7d506accc7f979; exit=0; EXPECT=matched; output-sha256=5a7c26018c960c8b04cc985521ed84757298c66accb72ee543ba383e836e8e2a; output-bytes=97; shell=/bin/sh; cwd=/home/valentin/projects/hypertask-wt/htpr-6506-b-agents; path=fd5351737ae0/31 entries

- [x] G3: Typecheck succeeds or matches proven origin/production errors with zero added errors
  CHECK: node /tmp/htpr-6506-b-checks.cjs types
  EXPECT: TYPECHECK PASS
  EVIDENCE: automatic-evidence=v1; definition-sha256=e6d3dc340d94a10b823ed84daa26dda8c652805c1a39605b37818f01a6cfcf80; exit=0; EXPECT=matched; output-sha256=8764a08c5ade5ab73ebf72f19fad6768b0b373cd3526fecb8692488e24b9f09d; output-bytes=1709; shell=/bin/sh; cwd=/home/valentin/projects/hypertask-wt/htpr-6506-b-agents; path=fd5351737ae0/31 entries

- [x] G4: ESLint succeeds for all touched source files and checks the ledger separately
  CHECK: node /tmp/htpr-6506-b-checks.cjs lint
  EXPECT: LINT PASS
  EVIDENCE: automatic-evidence=v1; definition-sha256=6f02464ca4e2c53846ba30ed2a6638d4f4ae88a67b105f47f92b967fad2f37b5; exit=0; EXPECT=matched; output-sha256=f798c7213b3f596c52d4cd4f2337a380c461bf909a0105a68bd3e13eb6bd15be; output-bytes=18; shell=/bin/sh; cwd=/home/valentin/projects/hypertask-wt/htpr-6506-b-agents; path=fd5351737ae0/31 entries

- [x] G5: Related tests and the full suite pass or every failure is proven on origin/production
  CHECK: node /tmp/htpr-6506-b-checks.cjs tests
  EXPECT: TESTS PASS
  EVIDENCE: automatic-evidence=v1; definition-sha256=bc5a5a8602ea878b04329e8819a277cd7e06d38fe0f03b74e580e9e55eceecb3; exit=0; EXPECT=matched; output-sha256=35a50bb744e6f00c68660a562a3616dd1899c16a1ba35934edf9fae6efea0f23; output-bytes=688; shell=/bin/sh; cwd=/home/valentin/projects/hypertask-wt/htpr-6506-b-agents; path=fd5351737ae0/31 entries

- [x] G6: Current branch has the requested commits and a clean working tree
  CHECK: node /tmp/htpr-6506-b-checks.cjs clean
  EXPECT: CLEAN TREE PASS
  EVIDENCE: automatic-evidence=v1; definition-sha256=a458847a1223711e7e0606e539284a7b981852a12aaf2bdc1f61a43a6904a013; exit=0; EXPECT=matched; output-sha256=0a3ff0c32dbed62e3c0cddfad1a5418c0e27acf17103a4e3451b44484e05c710; output-bytes=16; shell=/bin/sh; cwd=/home/valentin/projects/hypertask-wt/htpr-6506-b-agents; path=fd5351737ae0/31 entries

- [x] G7: Extracted logic, JSX, original exports, hook order and dependencies preserve behavior
  CHECK: node /tmp/htpr-6506-b-checks.cjs preservation
  EXPECT: PRESERVATION PASS
  EVIDENCE: automatic-evidence=v1; definition-sha256=add0014e34103eef4c958f78aafb85a2c11631724ce2787970c89bdee1822643; exit=0; EXPECT=matched; output-sha256=6d6a1aba0144211fd71b72fa782172b1407f58dbd3bfeee07064276b75aa7c7a; output-bytes=189; shell=/bin/sh; cwd=/home/valentin/projects/hypertask-wt/htpr-6506-b-agents; path=fd5351737ae0/31 entries

- [x] G8: Ledger format is valid
  CHECK: node /home/valentin/.agents/skills/unlazy/scripts/gate-lint.mjs GATES.md
  EXPECT: LINT OK
  EVIDENCE: automatic-evidence=v1; definition-sha256=69f81179f3934636347ff01de4824d2a1f500f2d29238b9fd688f82f77d1c57b; exit=0; EXPECT=matched; output-sha256=48630b7361dd44ee870917b12c3d19b9d7bdea738aaca16bb04d4cab83b772d2; output-bytes=8; shell=/bin/sh; cwd=/home/valentin/projects/hypertask-wt/htpr-6506-b-agents; path=fd5351737ae0/31 entries

## Evidence

Commands run from the worktree root. Verification scripts live only in /tmp. G6 requires an empty status before its automatic evidence update; that evidence is committed and the same clean check is run again after the final commit.

Baseline: an independent /tmp archive of the original origin/production commit 828e18c7fc24ca17d8bd8ef8a9a2bd669db42393. All 4139 tracked files were hashed against that commit and matched. It uses the same read-only shared node_modules install, not another worktree. The shared Prisma client was already generated before this session.

Preservation: exact moved-body checks plus TypeScript AST comparison prove all 126 chat and 51 detail hook calls, callback bodies, order and dependencies are identical. Views have no parent hooks, so extraction does not move effects into child fibers. Negative controls reject reversed hook order and a 402-line function.

Test source imports follow the extracted modules. All assertions remain unchanged; the existing 457-line visibility test imports its unchanged source-contract assertions from a new sibling helper so touched test functions also meet the limit.

Reviewer focus: queued-message forward reference, mobile focus and details-sheet effect order, and type-only context imports. No runtime logic or JSX bodies were rewritten.

Scope comparison uses this branch's original HEAD, 283b3c0d89c1021ec7e6495625a758ea8c6a2075. The newer production baseline differs only in ship-skill documentation, not app code; that documentation was not touched by this session.

## Line-count output

```text
    42 src/app/agents/chat/agentChatTypes.ts
   498 src/app/agents/chat/AgentChatFeedItems.tsx
   205 src/app/agents/chat/useAgentChatState.ts
   129 src/app/agents/chat/useAgentChatRoster.ts
   308 src/app/agents/chat/useAgentChatSession.ts
   149 src/app/agents/chat/useAgentChatFeed.ts
   235 src/app/agents/chat/useAgentChatStream.ts
   133 src/app/agents/chat/useAgentChatNavigation.ts
   285 src/app/agents/chat/useAgentChatSend.ts
   203 src/app/agents/chat/useAgentChatComposer.ts
   298 src/app/agents/chat/useAgentLifecycle.ts
    40 src/app/agents/chat/useAgentChatDetailsSheet.ts
   128 src/app/agents/chat/AgentChatRosterPane.tsx
   440 src/app/agents/chat/AgentChatPane.tsx
   138 src/app/agents/chat/AgentChatCreateModal.tsx
   394 src/app/agents/chat/AgentChatView.tsx
    67 src/app/agents/chat/AgentChatClient.tsx
    58 src/app/agents/[agentId]/agentDetailTypes.ts
   221 src/app/agents/[agentId]/AgentDetailParts.tsx
   106 src/app/agents/[agentId]/useAgentDetailState.ts
   238 src/app/agents/[agentId]/useAgentDetailRefresh.ts
   144 src/app/agents/[agentId]/useAgentDetailSubscriptions.ts
   121 src/app/agents/[agentId]/useAgentProviderKey.ts
   166 src/app/agents/[agentId]/useAgentDetailLifecycle.ts
   176 src/app/agents/[agentId]/useAgentConfig.ts
   175 src/app/agents/[agentId]/useAgentBoardAccess.ts
   128 src/app/agents/[agentId]/AgentDetailHeader.tsx
   239 src/app/agents/[agentId]/AgentRunHistory.tsx
   203 src/app/agents/[agentId]/AgentInstructions.tsx
   233 src/app/agents/[agentId]/AgentConfigForm.tsx
   230 src/app/agents/[agentId]/AgentBoardAccess.tsx
   260 src/app/agents/[agentId]/AgentDetailView.tsx
    34 src/app/agents/[agentId]/AgentDetail.tsx
   148 tests/mobile-agent-chat-fullscreen-6476.test.cjs
    95 tests/app-shell-rail-mount-shift.test.cjs
    41 tests/mobile-agent-chat-viewport.test.cjs
   172 tests/agent-chat-drafts-and-details-sheet.test.cjs
    87 tests/agent-chat-task-reference-search.test.ts
    32 tests/agent-activity-labels.test.cjs
   364 tests/agent-provider-key.test.cjs
   122 tests/mobile-agent-chat-layout-6407.test.cjs
   336 tests/agent-visibility.test.ts
   149 tests/agent-chat-scroll-on-load.test.cjs
   270 tests/agent-chat-activity-routes.test.cjs
    69 tests/mobile-agent-chat-composer-6041.test.cjs
    34 tests/agent-chat-reply-timeout.test.cjs
    63 tests/agent-rooms-contract.test.cjs
   424 tests/agent-token-hash.test.cjs
   137 tests/helpers/agent-visibility-source.ts
    28 tests/helpers/agent-chat-source.cjs
    27 tests/helpers/agent-detail-source.cjs
   145 GATES.md
  9167 total
```

## Check output

```text
LINE LIMITS PASS: every touched file below 1500 lines.
FUNCTION LIMITS PASS: largest AgentChatPane, 335 lines at src/app/agents/chat/AgentChatPane.tsx:106.
TYPECHECK PASS (baseline exception): next typegen exits 0; tsc exits 2 with the same four baseline errors and zero added errors.
LINT PASS: npx eslint on all 51 touched source and test files exits 0; ledger lint exits 0.
Related tests: 267 passing TAP tests plus all four TypeScript files passed; zero failures.
Full runner: 4825 tests, 4819 pass, 6 fail, 0 cancelled, 0 skipped; exits 1.
Clean production baseline: 4827 tests, 4816 pass, 11 fail; exits 1.
PRESERVATION PASS: 126 chat hook calls and 51 detail hook calls match exactly.
CLEAN TREE PASS is checked again after the final evidence commit.
```

The full runner stops at the failing Node group, before the 82 TypeScript files. The four related TypeScript files were run separately by the related-test command.

All six full-suite failures also fail on the clean production baseline:
- firebase-admin is 12.7.0 in the shared install, but the test requires 14.x.
- jsonwebtoken is 8.5.1 in the shared install, but the test requires 9.x.
- mobile-sheet-drag-close cannot import useScrollPosition from the installed react-modal-sheet.
- weekly Strix runner source isolation and failed-report contract.
- default tsc binary is not the required native TypeScript 7 compiler.
- SDK native compiler sharing contract.

Typecheck baseline errors: AppSheet.tsx:2 missing useScrollPosition; AppSheet.tsx:147 incompatible detent; AppSheet.tsx:170 unsupported disableScroll; redis.ts:45 unsupported protocol option. The complete current and baseline error output is byte-identical in /tmp/htpr-6506-b-types.log and /tmp/htpr-6506-b-baseline-types.log.

Raw test evidence: /tmp/htpr-6506-b-related-tests.log, /tmp/htpr-6506-b-full-tests.log and /tmp/htpr-6506-b-baseline-tests.log. Baseline file-hash proof: /tmp/htpr-6506-b-baseline-integrity.log.
