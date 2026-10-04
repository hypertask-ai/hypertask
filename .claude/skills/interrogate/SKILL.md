---
name: interrogate
description: Before coding in the valentin-review lane only, get three independent Codex reviews of the design
---

# Interrogate

Use only for the `valentin-review` lane: money, login and access, security, or data that cannot be undone. Run before coding, after writing the design. Ordinary `ai-review` work keeps the existing ai-review check and must not use this skill. This review does not replace CI, ai-review or Valentin's decision.

## Steps

1. Write a short design file: ticket URL, intent, proposed changes, source paths, affected users, trust boundaries, data lifetime, rollback and open questions. Use `origin/production` for branch context. Do not include credentials.
2. Give every reviewer the same prompt and design. Ask for real failure paths, not praise or style preferences. Cover correctness, permissions, money, security, irreversible data, root causes, existing shared code, unnecessary complexity and missing proof. Each finding needs severity, `path:line`, a concrete failure path and the cheapest check. No findings is valid. Reviewers must not edit files or write to the board.
3. Launch one hax run per model, concurrently. Fill `prompt` with the shared review brief and absolute design path. Each review writes its own ledger and answer under a separate scratch path, not in the repo. Read-only review means no app mutations or code edits.

   ```bash
   hax --provider=codex --model=gpt-6.1-sol --effort=high --no-session -p "$prompt"
   hax --provider=codex --model=gpt-6-luna --effort=high --no-session -p "$prompt"
   hax --provider=codex --model=gpt-5.6-terra --effort=high --no-session -p "$prompt"
   ```

   Use the host's background task tracking, not trailing shell ampersands. Collect all three results before judging. If a model cannot run, record the gap and stop this gate. Never silently substitute another model or count one review twice.
4. Read the cited source. Merge duplicates and note agreement and disagreement. A lone security or correctness finding still deserves a check; consensus is a signal, not proof.
5. Judge each finding: **Act on** (real blocker), **Consider** (tradeoff), **Noted** (valid but low impact), or **Dismissed** (wrong or missing context, with a reason). Do not auto-apply suggestions. Revise the design for accepted blockers and re-review the changed parts before coding.
6. Save intent, model names, findings, judgment and checks in the ticket ledger. For a decision only Valentin can make, follow `/ship`'s one-Question Valentin Review handoff. Design review is not permission to make that decision yourself.

Source: adapted from pstack, https://github.com/cursor/plugins/tree/main/pstack.
