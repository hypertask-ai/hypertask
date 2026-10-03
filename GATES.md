# Gates: AI infrastructure

OWNS: GATES.md, scripts/ai-*.cjs, tests/ai-*.test.cjs, tests/hyper-mentioned-cross-board-context.test.cjs, tests/task-summaries.test.cjs, tests/task-writer-board-research.test.ts, tests/fixtures/ai/**, .github/workflows/ai-evals.yml, src/lib/ai/**, src/lib/slack/*.ts, src/lib/telemetry/aiChatObservability.ts, src/app/api/ai/**, src/app/api/client-error/route.ts, src/app/api/mcp/ai/task-writer/route.ts, src/app/api/reports/status-update/route.ts, src/prisma/schema.prisma, src/prisma/migrations/**

Scope: Implement offline CI evals, byte-preserving versioned prompts, mandatory metadata-only model tracing and existing error tracking, without changing models or user behavior. Work only in this worktree, with no board writes, pushes or PRs.

- [x] G1: Offline golden evals cover chat and MCP with validated tool calls, retries, tokens and a failing wrong-tool threshold control; CI is path scoped and needs no secrets.
  CHECK: node --test tests/ai-eval.test.cjs && node scripts/ai-eval.cjs
  EXPECT: AI evals passed
  EVIDENCE: automatic-evidence=v1; definition-sha256=3acff67ec4b372feaf8347921bfab99e204d6cf66fa741f7ba993852219f1f83; exit=0; EXPECT=matched; output-sha256=8b85fe410c3450af0e6adf7bf3f6f213976b000e2b583f6c25aaf63d2de9ff6b; output-bytes=3776; shell=/bin/sh; cwd=/home/valentin/projects/ht-wt-6505; path=fd5351737ae0/31 entries

- [x] G2: Prompt registry preserves original rendered bytes and exposes ids and versions; routes contain no long inline prompts.
  CHECK: node --test tests/ai-prompt-registry.test.cjs
  EXPECT: /# fail 0\b/
  EVIDENCE: automatic-evidence=v1; definition-sha256=a6838f861708226ffb6e50a1bb781665a870e2dd2af23ed04f3b2ad797d0e354; exit=0; EXPECT=matched; output-sha256=66d559be90d27e71e374a75cc1519c43a128a8b61fdad501a0fceb79be9d927f; output-bytes=828; shell=/bin/sh; cwd=/home/valentin/projects/ht-wt-6505; path=fd5351737ae0/31 entries

- [x] G3: Model wrapper records success, failure and streaming metadata, costs and latency without bodies or double counting; schema changes are additive.
  CHECK: node --test tests/ai-model-tracing.test.cjs
  EXPECT: /# fail 0\b/
  EVIDENCE: automatic-evidence=v1; definition-sha256=ced14283a4aebc8bd4dafcd479768c1d9adfeff81deaeae25d39aceed926aa1e; exit=0; EXPECT=matched; output-sha256=889a596fac5af445517d1a8868f4d84a1307d4e2f5f5156f325eb91df61e2dc5; output-bytes=2124; shell=/bin/sh; cwd=/home/valentin/projects/ht-wt-6505; path=fd5351737ae0/31 entries

- [x] G4: Client and AI errors use existing reportError safely and telemetry failures do not alter model results.
  CHECK: node --test tests/ai-error-tracking.test.cjs
  EXPECT: /# fail 0\b/
  EVIDENCE: automatic-evidence=v1; definition-sha256=b94ac30735f1770822f98c896ab9fbe0e73cd9887a00b70ff11348f2c452ef3c; exit=0; EXPECT=matched; output-sha256=88443734fa14fbae8a0096820d14a7fc64f446cac13022691755ce243d42b992; output-bytes=1054; shell=/bin/sh; cwd=/home/valentin/projects/ht-wt-6505; path=fd5351737ae0/31 entries

- [x] G5: Relevant existing AI regression tests pass alongside new tests.
  CHECK: node scripts/ai-verify.cjs tests
  EXPECT: AI regression verification passed
  EVIDENCE: automatic-evidence=v1; definition-sha256=41d6a45ec28acc78b87908d762349ceb3be6452f4c4f3ca31245c56a4e045a1c; exit=0; EXPECT=matched; output-sha256=86690e0fe3af1c9e3b0428b1c55527905ba715cba01eeddf6e74ca5410194ce6; output-bytes=59748; shell=/bin/sh; cwd=/home/valentin/projects/ht-wt-6505; path=fd5351737ae0/31 entries

- [x] G6: Regenerated Prisma types have no new or changed-file TypeScript diagnostics, and changed-file lint passes; known baseline dependency diagnostics are explicitly reported, not hidden.
  CHECK: node scripts/ai-verify.cjs static
  EXPECT: AI static verification passed
  EVIDENCE: automatic-evidence=v1; definition-sha256=4b54977566b130988a65b2ec8b6a79249c92919b67855fd308b8fd4019897663; exit=0; EXPECT=matched; output-sha256=371d80178700dd0614e67cd1ca073784bd689c6235f8eef6bf393b9ab580b0ad; output-bytes=4800; shell=/bin/sh; cwd=/home/valentin/projects/ht-wt-6505; path=fd5351737ae0/31 entries

- [x] G7: Final diff keeps current model ids and prompt text, contains no new em dashes or secrets, and scope is infrastructure only.
  CHECK: node scripts/ai-verify.cjs diff
  EXPECT: AI scope verification passed
  EVIDENCE: automatic-evidence=v1; definition-sha256=764654b84064ba754d32b0c61cc3864f7a9e1be58726b17e3f1a070ecda31b4e; exit=0; EXPECT=matched; output-sha256=3640884a32c78ce0f99e031efcaa35c83b0b852cf2bfea84a1bc60b5fe0302ca; output-bytes=29; shell=/bin/sh; cwd=/home/valentin/projects/ht-wt-6505; path=fd5351737ae0/31 entries

- [x] G8: Commit exists on the supplied branch with the requested title and coauthor; worktree is clean except verification evidence.
  CHECK: node scripts/ai-verify.cjs commit
  EXPECT: AI commit verification passed
  EVIDENCE: automatic-evidence=v1; definition-sha256=440c4cd6f4b7022c3322e18e13efcf723b6a054b328ce6d12afbd7f2e540cfb3; exit=0; EXPECT=matched; output-sha256=39393ce509d346f0031473725713593ae87bec5e214c7ecff100c07fe56c5793; output-bytes=30; shell=/bin/sh; cwd=/home/valentin/projects/ht-wt-6505; path=fd5351737ae0/31 entries
