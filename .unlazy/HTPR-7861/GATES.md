# Gates: HTPR-7861

OWNS: src/lib/ai/prompts/definitions.ts, src/lib/ai/chatStream/**, src/lib/ai/tools/compactSchemas.ts, src/lib/flags/definitions/htpr-7861-chat-prompt-lean.ts, scripts/chat-prefix-budget.mjs, tests/fixtures/ai/prompt-baseline.json, tests/htpr-7861-chat-prefix.test.cjs, package.json, package-lock.json, .github/workflows/ai-evals.yml

Scope: Remove duplicate chat prompt sections, correct registered tool names, move voice/summary rules to their request paths, compact provider schema metadata without weakening validation, and enforce the new measured stable-prefix size in hosted CI while preserving golden tool choices and step counts.

- [ ] G1: Lean prompt removes duplicates and preserves label replacement, confirmation, scope and identifier safety.
  EVIDENCE: pending hosted CI and source review

- [ ] G2: Voice and summary instructions are isolated to their actual paths without regressing free-form or multilingual requests.
  EVIDENCE: pending; inherited implementation still appends the combined writing block globally

- [ ] HTPR-7861.deeper-prefix-budget: Complete real provider schemas are measured and the measured new cap rejects growth in hosted CI.
  EVIDENCE: pending; prior AI eval run 43105585817 failed with ReferenceError process is not defined in the isolated schema loader; preliminary cap 22462 is not the final measured cap

- [ ] G4: Golden task choices are unchanged and steps equal or fewer for the lean prompt.
  EVIDENCE: pending; existing offline recorded adapter alone does not prove changed-model behavior

- [ ] G5: Required checks pass, the ticket PR merges and production deployment succeeds.
  EVIDENCE: pending; existing PR https://github.com/hypertask-ai/hypertask/pull/3416 was closed unmerged by board-health; branch rebased onto origin/production during this run

- [ ] G6: Live QA proves the declared flag mode and the ticket closes with evidence.
  EVIDENCE: pending

- [ ] G7: Only this session's recorded finished worktree and branch are cleaned after completion.
  EVIDENCE: pending release; no new branch this run, existing cleanup ownership recorded under CODEX_SESSION_ID=runner2-htpr7861-20261111; unfinished clean worktree and open PR branch preserved

## Resume

- Identity: RUNNER 2; launcher claim tmux attach -t ht-or-runner-2 (Cursor Grok RUNNER 2).
- Existing worktree: /home/valentin/worktrees/runner2-htpr-7861.
- Existing branch: runner2/htpr-7861-lean-prefix; prior session CODEX_SESSION_ID=runner2-htpr7861-20261111.
- No tests or builds on VPS. Test and budget execution occurs only on GitHub-hosted Actions.
- Original ledger and pending scope retained; no completion claim.
