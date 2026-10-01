---
name: ship
description: The one command Valentin types at the start of a session (/ship, usually with a ticket link) to take a Hypertask ticket end to end (claim, fix, PR, merge, deploy, live QA, close). It is the map: it tells the session which skill to load at each step, writes the proof checklist, and a hook blocks merge and Done without proof. Also use when he says "ship this" or "get this live" mid-session.
---

# Ship

Valentin types only `/ship <ticket>` at the start of a session (2026-10-01: "i only type /ship at the beginning of a session and it does all of these automatically, most importantly gives itself and its sub agents a ledger"). This session does the whole ticket itself.

This file is the map. It does not hold the how-to. At each step, load the skill named there and follow it. Load a skill when you reach its step, not before (progressive disclosure: Valentin, 2026-10-01).

## Before anything else

0. **Session title.** Read the ticket (`hypertask tasks get HTPR-NNNN`) and make the first line of your first reply exactly `/rename HTPR-NNNN | <exact ticket title>`, title word for word. In Codex, print it as the suggested thread name.
1. **Identity.** Every board write (claim, comment, move, assign, attachment) goes through the `vcc` command as "Valentins Claude Code", and only that. Never another identity, never the plain `hypertask` CLI for writes (Valentin's own token; reads only). Every comment's closing `Next:` paragraph ends with this session's exact resume command (`claude --resume <full $CLAUDE_CODE_SESSION_ID>`, or `codex resume <id>`). Read the ticket back after each write. If `vcc` fails, stop and tell Valentin in one line.
2. **Checklist.** Load `unlazy`, then run `~/.agents/skills/ship/scripts/ship-gates HTPR-NNNN`. It writes the standard proof gates into this session's ledger (`~/.local/state/unlazy/sessions/<first 8 chars of the session id>/GATES.md`): ticket exists, PR named right, merged, deployed, live QA proof, Done. Add a gate for every extra outcome Valentin asks for. Nothing is reported done until `node ~/.agents/skills/unlazy/scripts/gate-check.mjs <ledger>` shows it met.
3. **Helpers are Codex sub-sessions via hax, each with its own ledger** (Valentin, 2026-10-01). Hand big reading, writing or self-contained coding to Codex: `hax --provider=codex --model=gpt-6.1-sol --effort=high --no-session -p "<prompt>"` (`--effort=xhigh` when hard), in the background, one hax run per independent piece. Never Claude subagents for delegated work, never `--provider=zai` or OpenRouter. Every helper prompt starts with: "Use the unlazy skill (~/.agents/skills/unlazy/SKILL.md): write GATES.md first and prove every gate before your final answer." Re-run its gates yourself (`gate-check.mjs --reverify`) before you trust it.
4. **Voice.** Load `pospeak` (chains `unslop` and `i-have-adhd`) for every reply to Valentin.

## The map

Repo skills live in the app repo at `.claude/skills/`; their index is `.claude/skills/INDEX.md`. Read the index once, then open only the skill for the step you are on.

| Step | Load | Done when |
|---|---|---|
| Claim and start | `vcc` (start steps) | Ticket assigned to Valentins Claude Code, "Claimed." comment, In Progress |
| Before writing UI code | repo `reuse-existing-ui` | You know which existing components you reuse |
| The fix | repo `fix-bug` (restores intended behaviour, no flag) or `ship-feature-behind-flag` (new behaviour, flag named after the ticket) | Tests pass locally |
| Before the PR | repo `simplify-before-pr`; plus `design-compliance` and `verify-on-phone` for UI; `update-docs` when users see a change | Each skill's own check passes |
| Open the PR | the PR rule below, then bind it: `~/.agents/skills/ship/scripts/ship-check bind HTPR-NNNN <pr number>` | `ship-check pr HTPR-NNNN` prints `title ok` |
| Merge and deploy | `vcc` QA routine steps 1 to 3 | `ship-check deployed HTPR-NNNN` prints `deployed ok` |
| Live QA | repo `verify-qa` and its feature map | `ship-check proof HTPR-NNNN` prints `proof ok` |
| Report and close | `vcc` QA routine step 5, plus the QA record below | `ship-check done HTPR-NNNN` prints `done ok` |

## Rules that hold the whole session

- **PR name (Valentin, 2026-10-01).** Exactly `HTPR-NNNN [TYPE] <short description>`: a ticket that exists on the board, then a type the repo title check accepts: `[BUGFIX]`, `[FEATURE]`, `[IMPROVE]`, `[INFRA]` (also `[SPEED]`, `[QA]`, `[CLI/MCP/AI]`, `[DASH]`, `[BOARD]`, `[COST]`, `[PLAN]`, `[FEEDBACK]`). Example: `HTPR-6370 [BUGFIX] Chip markers, readable summary, Escape and refocus in search picker`. Wrong name: `gh pr edit <n> --title "..."`, or create the missing ticket via `vcc` and retitle.
- **Hard block.** A Claude Code hook (`ship-check guard`) refuses `gh pr merge` on a wrongly named PR or one whose ticket does not exist, and refuses `vcc task move HTPR-NNNN --section "Done"` until the PR is merged, the Production deployment is success, and `~/.local/state/vcc-evidence/HTPR-NNNN/proof.md` follows the verify-qa contract with screenshots. When it blocks you, do the missing step; never work around it. Infra tickets (YPER4, HYFA) need the merge and the deploy before Done; app tickets also need the proof. CLI work: prefix the commands with `SHIP_REPO=hypertask-ai/cli SHIP_BASE=main`. Tests: `.claude/skills/ship/scripts/ship-check.test.sh`. Codex has no hook: run the same `ship-check` commands yourself before merge and before Done.
- **Document every QA run** (Valentin, 2026-10-01: "tells you to also document your QA run"). Each run, pass or fail:
  - Before testing, write the checklist from the acceptance criteria and the feature-map page. After testing, mark each line PASS, FAIL or UNREACHABLE with its evidence file; a FAIL line says the exact steps and what happened.
  - Save the run in `~/.local/state/vcc-evidence/HTPR-NNNN/<YYYY-MM-DD>-qa-run-<n>/`: checklist, screenshots (desktop 1440x900 and phone 390x844, light and dark when UI changed), a short video of the main path, which accounts were used (user id and role, never credentials). Keep `HTPR-NNNN/proof.md` (verify-qa contract) pointing at the latest run.
  - Build one self-contained HTML report (results plus key screenshots inline, ticket titles as full links), share it with `htmlshare <file>` (hypertask.app, never admin.yeoux.net), open it in his zsb pane.
  - One QA comment on the ticket via `vcc`: verdict in the bold first sentence, PASS and FAIL lines in plain words, key screenshots and video with `--attach`, the report link.
  - Tell him in chat: verdict first, the report link, anything not tested. Example run: https://hypertask.app/explorations/gnicuu6
- **Move the ticket as the work moves** (Valentin, 2026-10-01). Via `vcc task move HTPR-NNNN --section "In Progress"` (or the column named below), then read it back:
  - **In Progress** when you claim and whenever you go back to fixing.
  - **AI Review** as soon as the PR is open, until merged.
  - **Done** once the merge is live and QA passed with evidence on the ticket.
  - **Valentin Review** only for a flagged feature that needs his yes, with one `Question:` comment. Then the Done gate stays open and you say so.
  Follow-up work becomes its own ticket.
- **Old automated comments do not count (Valentin, 2026-10-01).** The automated agents were retired on 2026-10-01. Their claims, "Blocked" notes, decisions, plans and progress on a ticket are history, not state. Authors include Product Bot, Dev 1, Dev 2, Feature Dev 1, QA 1, Supervisor and any "worker" or "drain" bot. A ticket with only such comments is free: pick it, claim it via `vcc` and treat the bug as open. Read those comments only for facts about the bug (steps, screenshots, error text), and re-check those facts on the live site. A ticket counts as taken only when Valentins Claude Code claimed it in the last 24 hours, or its PR had a commit in the last 24 hours (`gh pr view <n> --json commits`).

Nothing is "live" until the Production deployment for the merge sha is `success` and you verified the change on app.hypertask.ai with evidence on the ticket.

Source: this folder in hypertask-ai/hypertask. `~/.agents/skills/ship` on the VPS points here, so edit it here and ship it as a PR.
