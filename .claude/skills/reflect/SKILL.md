---
name: reflect
description: "Last /ship step: three parallel reviewers read this session's transcript, a synthesizer turns their findings into proposed edits of existing repo skills, and approved rows ship as a PR. Use after the last ticket of a /ship run is cleaned up, or when asked to reflect."
---

# Reflect

Source: pstack 0.15.9 by Lauren Tan, https://github.com/cursor/plugins/tree/main/pstack, `skills/reflect/SKILL.md` and `references/`. MIT License, Copyright (c) 2026 Lauren Tan. Changed for Claude Code and Hypertask runners (YPER4-599): transcript paths, helpers through the token ladder, repo-only edits through a PR, approval by HT Product Lead, backlog on board 4060.

Mine the current session for durable learnings, then route them into skill edits.

## When to run

Once per /ship run, after the `Clean up` step of its last ticket, or when asked to reflect. Skip when the session was trivial or followed an existing skill with no friction; one-offs are not learnings. Say in the agent activity that reflect was skipped and why.

## Process

### 1. Locate this session's transcript

Claude Code: `~/.claude/projects/<slug>/$CLAUDE_CODE_SESSION_ID.jsonl`, where `<slug>` is the session's start directory with every character other than a letter or digit replaced by `-` (for `~/projects/hypertask`: `-home-valentin-projects-hypertask`). Subagent transcripts sit in `<slug>/$CLAUDE_CODE_SESSION_ID/subagents/`. Codex: the newest `~/.codex/sessions/**/rollout-*.jsonl` whose first line names this thread id.

Never glob other projects or other sessions; they hold unrelated private work. If the file is missing, write a tight digest of the session (tickets, mistakes, corrections, friction) and pass that instead.

### 2. Run three reviewers in parallel

Follow the token ladder exactly like /ship step 4. CODEX mode: one background `hax --provider=codex --model=gpt-6.1-sol --effort=high --no-session -p "$(cat <prompt file>)"` per reviewer. CLAUDE mode: three Agent tool calls in one message with an explicit `model`. Every prompt starts with the "Token ladder:" line and the unlazy line, then the template from `references/` with the transcript path or digest filled in.

| Lens | Prompt template |
|---|---|
| Judgment | `references/judgment-reviewer.md` |
| Tooling | `references/tooling-reviewer.md` |
| Divergent | `references/divergent-reviewer.md` |

Reviewers are report only: no edits, no commits, no board writes, no tests. They may read repo files with `git show origin/production:<path>` and read tickets with the plain `hypertask` CLI.

### 3. Synthesize

One more helper the same way, with `references/synthesizer.md` and each reviewer's full output inlined where marked. It returns the Accepted / Rejected / Backlog list.

### 4. Structural check

For any Accepted row a lint rule, script, hook, test or `ship-check` would enforce more reliably, move it to Backlog with that mechanism named. Prose is for what mechanisms cannot enforce.

### 5. Approval, then apply

- Send the full Accepted / Rejected / Backlog list to HT Product Lead with SendMessage and wait for its answer. It picks rows and may change routings. Never auto-apply: a skill edit changes every future runner.
- Edit only skills in this repo under `.claude/skills/` (and `.claude/agents/`). Never global files (`~/.claude`, `~/.agents`, another repo); name those as Backlog instead.
- Approved rows ship like any other change: one YPER4 ticket on board 4060 via `vcc`, then /ship from Claim to Clean up, one PR. Do not reflect again on that ticket.
- A new skill or a skill description change follows the same PR, with its row in `.claude/skills/INDEX.md`.
- Backlog: one YPER4 ticket per item via `vcc`, after a title search shows no open ticket for it. Do not start work on it.

### 6. Report

One agent activity line on the last ticket of the run, and a short reply in chat:

- Edits proposed or shipped: skill path, one line each, plus the PR link.
- Backlog tickets filed: full ticket URL, one line each.
- Dropped: one line per rejected finding with the synthesizer's reason.
