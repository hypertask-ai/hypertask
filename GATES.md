# Gates: AI infrastructure

OWNS: GATES.md, scripts/ai-*.cjs, tests/ai-*.test.cjs, tests/hyper-mentioned-cross-board-context.test.cjs, tests/task-summaries.test.cjs, tests/task-writer-board-research.test.ts, tests/fixtures/ai/**, .github/workflows/ai-evals.yml, src/lib/ai/**, src/lib/slack/*.ts, src/lib/telemetry/aiChatObservability.ts, src/app/api/ai/**, src/app/api/client-error/route.ts, src/app/api/mcp/ai/task-writer/route.ts, src/app/api/reports/status-update/route.ts, src/prisma/schema.prisma, src/prisma/migrations/**

Scope: Implement offline CI evals, byte-preserving versioned prompts, mandatory metadata-only model tracing and existing error tracking, without changing models or user behavior. Work only in this worktree, with no board writes, pushes or PRs.

- [x] G1: Offline golden evals cover chat and MCP with validated tool calls, retries, tokens and a failing wrong-tool threshold control; CI is path scoped and needs no secrets.
  CHECK: node --test tests/ai-eval.test.cjs && node scripts/ai-eval.cjs
  EXPECT: AI evals passed
  EVIDENCE: automatic-evidence=v1; definition-sha256=3acff67ec4b372feaf8347921bfab99e204d6cf66fa741f7ba993852219f1f83; exit=0; EXPECT=matched; output-sha256=8784bfde5c00c2e06105d1f80dcdc80a61fd7a5c6c537e7ccab80468c5de53bf; output-bytes=3774; shell=/bin/sh; cwd=/home/valentin/projects/ht-wt-6505; path=fd5351737ae0/31 entries

- [x] G2: Prompt registry preserves original rendered bytes and exposes ids and versions; routes contain no long inline prompts.
  CHECK: node --test tests/ai-prompt-registry.test.cjs
  EXPECT: /# fail 0\b/
  EVIDENCE: automatic-evidence=v1; definition-sha256=a6838f861708226ffb6e50a1bb781665a870e2dd2af23ed04f3b2ad797d0e354; exit=0; EXPECT=matched; output-sha256=85753aae1875be96abcb8f7da4f74065d763d44be1a89aceb3e209d2d3ff66fb; output-bytes=827; shell=/bin/sh; cwd=/home/valentin/projects/ht-wt-6505; path=fd5351737ae0/31 entries

- [x] G3: Model wrapper records success, failure and streaming metadata, costs and latency without bodies or double counting; schema changes are additive.
  CHECK: node --test tests/ai-model-tracing.test.cjs
  EXPECT: /# fail 0\b/
  EVIDENCE: automatic-evidence=v1; definition-sha256=ced14283a4aebc8bd4dafcd479768c1d9adfeff81deaeae25d39aceed926aa1e; exit=0; EXPECT=matched; output-sha256=61d11fc0bad4fd39cea13e3478d653a4f390fe3bebdd3d3149dbf0bbb57abb5b; output-bytes=2119; shell=/bin/sh; cwd=/home/valentin/projects/ht-wt-6505; path=fd5351737ae0/31 entries

- [x] G4: Client and AI errors use existing reportError safely and telemetry failures do not alter model results.
  CHECK: node --test tests/ai-error-tracking.test.cjs
  EXPECT: /# fail 0\b/
  EVIDENCE: automatic-evidence=v1; definition-sha256=b94ac30735f1770822f98c896ab9fbe0e73cd9887a00b70ff11348f2c452ef3c; exit=0; EXPECT=matched; output-sha256=a6985b214f468b380f5f8f59736f4b101eac68d54708d22f578b7fd9c10f7b7f; output-bytes=1055; shell=/bin/sh; cwd=/home/valentin/projects/ht-wt-6505; path=fd5351737ae0/31 entries

- [x] G5: Relevant existing AI regression tests pass alongside new tests.
  CHECK: node scripts/ai-verify.cjs tests
  EXPECT: AI regression verification passed
  EVIDENCE: automatic-evidence=v1; definition-sha256=41d6a45ec28acc78b87908d762349ceb3be6452f4c4f3ca31245c56a4e045a1c; exit=0; EXPECT=matched; output-sha256=522413aa2ae6caf764f6f2367ecfdfe8a4f7e03b0a76f820cdea24e343b0b095; output-bytes=59727; shell=/bin/sh; cwd=/home/valentin/projects/ht-wt-6505; path=fd5351737ae0/31 entries

- [x] G6: Regenerated Prisma types have no new or changed-file TypeScript diagnostics, and changed-file lint passes; known baseline dependency diagnostics are explicitly reported, not hidden.
  CHECK: node scripts/ai-verify.cjs static
  EXPECT: AI static verification passed
  EVIDENCE: automatic-evidence=v1; definition-sha256=4b54977566b130988a65b2ec8b6a79249c92919b67855fd308b8fd4019897663; exit=0; EXPECT=matched; output-sha256=5d956aaf3ee4c6082fab71a37d261040b189745a9db26690fbad985a7cba3d0c; output-bytes=4800; shell=/bin/sh; cwd=/home/valentin/projects/ht-wt-6505; path=fd5351737ae0/31 entries

- [x] G7: Final diff keeps current model ids and prompt text, contains no new em dashes or secrets, and scope is infrastructure only.
  CHECK: node scripts/ai-verify.cjs diff
  EXPECT: AI scope verification passed
  EVIDENCE: automatic-evidence=v1; definition-sha256=764654b84064ba754d32b0c61cc3864f7a9e1be58726b17e3f1a070ecda31b4e; exit=0; EXPECT=matched; output-sha256=3640884a32c78ce0f99e031efcaa35c83b0b852cf2bfea84a1bc60b5fe0302ca; output-bytes=29; shell=/bin/sh; cwd=/home/valentin/projects/ht-wt-6505; path=fd5351737ae0/31 entries

- [ ] G8: Commit exists on the supplied branch with the requested title and coauthor; worktree is clean except verification evidence.
  CHECK: node scripts/ai-verify.cjs commit
  EXPECT: AI commit verification passed
  EVIDENCE: pending
