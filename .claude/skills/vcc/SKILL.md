---
name: vcc
description: Start a Valentins Claude Code (VCC) session, Valentin's own one-session-per-ticket work on ANY ticket (feature, bug, infra), in Claude Code or Codex. Use when he types /vcc or $vcc in a new session, usually with a ticket link.
---

# Valentins Claude Code (VCC) session

**Runner browser policy.** A runner (any session not named HT Product Lead) never opens pages in Valentin's browser: no `zsb` navigate/open/activate. Links to tickets, pages, reports and wireframes go in ticket comments only. Browser QA and checks use headless Playwright with QA account 985, following `verify-qa`, never his browser. Only the session he talks to (HT Product Lead) opens a page for him, and only when it mentions that page to him in chat. (Valentin, 2026-10-12): "i never look a the runner sessoins they don't need to do that i reply to ticket in the inbox and via you thats it" and "but should the even try to open pages?"

You are one of Valentin's own sessions (Claude Code or Codex). He runs one session per ticket and may pick ANY ticket on any board (Valentin, 2026-10-01: "make it so that i can pick ANY ticket i want and work on it myself"). Each session takes its ticket end to end: fix, PR, merge, deploy, QA on the live site, close. `/ship` is the map that points here.

## Identity

- Every board write goes through the `vcc` command, which acts as the agent identity "Valentins Claude Code CLI" (id 85b985ac-afe8-41a3-a1ac-d9549a9310c7, created 2026-10-01). `vcc` is a plain passthrough to the `hypertask` CLI with that agent's token (`~/.config/hypertask-agents/credentials/valentins-claude-code-agent-token`, 0600, never print it): `vcc comment add <TICKET> --text '<html>'`, `vcc task move <TICKET> --section "In Progress"`, `vcc task assign <TICKET> --self`.
- Never write with any other identity, and never with the plain `hypertask` CLI (Valentin's own token; nothing on the board is ever written as him). The plain `hypertask` CLI and `ht GET /mcp/...` are fine for reading.
- All VCC sessions share the one identity. Every comment's closing `Next:` paragraph ends with "Session: <session name>. Requested by Valentin in a Claude session, <YYYY-MM-DD>, <session link>", so he can tell sessions apart and resume the right one. The session name is the one he gave with /rename.
- After every board write, read the ticket back (`hypertask task get`) and confirm the column and comment landed.
- If `vcc` fails, stop board writes and save the failure locally with the resume command. Never switch identities or send a session message; resume on the owning ticket when the approved write path works.

## Start of session

1. If he gave a ticket, onboard it with the `/ticket` skill steps: put the full title and URL in a ticket comment; only HT Product Lead replies with the URL and opens it when mentioning it in chat. Then print `/rename HTPR-NNNN | Title`.
2. Read the ticket and every comment (`hypertask tasks get HTPR-NNNN`). Two exceptions where you stop and ask Valentin in one line: a ticket assigned to Abdul, and a ticket another VCC session claimed in the last 24 hours.
3. Claim it as yours: add your agent (`vcc task assign <TICKET> --self`) next to any human assignee, never removing one (agents are human companions, Valentin, 2026-10-02), post `<p><strong>Claimed.</strong> Valentins Claude Code session working it now.</p><p>Next: ... Session: <name>. Requested by Valentin in a Claude session, <date>, <session link>.</p>` and move it to In Progress, all via `vcc`. If an earlier PR or branch exists for it, read it first and build on it or close it with a one-line reason.
4. Post the resume line to the ticket's agent log once: `vcc activity add HTPR-NNNN "Resume this Claude session: claude --resume $CLAUDE_CODE_SESSION_ID"`.
5. Write your own unlazy ledger before real work: `~/.local/state/unlazy/sessions/<first 8 chars of $CLAUDE_CODE_SESSION_ID>/GATES.md` (never the shared `~/.local/state/unlazy/GATES.md`; two sessions collided there on 2026-10-01). One runnable gate per outcome he asked for. Nothing is reported done until its gate passes.

## In Codex

This skill also lives in `~/.agents/skills/vcc` so Codex sessions load it (type `$vcc` or "follow the vcc skill"). Same rules, same `vcc` command, same ledger path (use the Codex session id or a short ticket-based id). Use `codex resume <id>` instead of `claude --resume` in the resume line.

## Doing the work

- Bug fixes ship behind a ticket-named flag with `kind: "bugfix"`, on for Everyone by default (Valentin, 2026-10-06). Fixes to saved data, security and crashes keep shipping with no flag. Bugfix flags get cleanup after 7 days on Everyone; money, access and data-deletion flags stay at 14 days. The daily cron at `/api/cron/feature-flag-removals` files the removal ticket and does not switch the flag. New feature and improvement flags set `defaultMode: "EVERYONE"` in their definition file unless `releaseRisk.highRisk` is set (`money`, `access`, `data-deletion`, `customer-email`) or kind is `internal`; existing flags keep their current mode (Valentin, 2026-10-20, HTPR-7389). Bugs use title `[BUGFIX]`; new behaviour uses the feature flow below.
- Follow the repo CLAUDE.md and the board-15 contracts in hypertask-ai/company-skills `agents/Hypertask Product/` (merge rules, QA and safety, ticket communication). Branch off `origin/production` in your own worktree, one ticket one PR, title `HTPR-NNNN [FEATURE] ...` (or the honest type), PR body starts "Summary for non-engineers".
- New behaviour ships behind a ticket flag with explicit `defaultMode: "EVERYONE"`, unless `releaseRisk.highRisk` is set (`money`, `access`, `data-deletion`, `customer-email`) or kind is `internal`. Existing flags keep their current mode (HTPR-7389). Valentin judges the real thing on the live site behind the flag; never park the ticket for a mockup.
- Product questions use `Question: <strong>yes/no question?</strong>` plus `Yes:`, `No:`, `My recommendation:` and `Why:` paragraphs in product-owner language (no developer words; Why may share the recommendation paragraph), @mention Valentin, and go via `vcc comment add --kind question`, and the ticket moves to Valentin Review. Everything else you decide.
- Delegate big reading, writing or self-contained coding to helpers that follow the token ladder (Valentin, 2026-10-10): CODEX mode uses `hax --provider=codex --model=gpt-6.1-sol --effort=high --no-session -p "<prompt>"` in the background; CLAUDE mode uses the Agent tool in this session (`sonnet` builds, `haiku` lookups), never hax or new `claude` processes. Running helpers finish as started. Each prompt starts with the "Token ladder:" line and tells the helper to use the unlazy skill. A helper never writes to a Hypertask board (no claim, comment, move, assign, page, activity); it reports to its runner, and vcc refuses its writes.

## QA routine (Valentin, 2026-10-01: "you will do the whole feature end to end", "you need to verify yourself")

The session that built a change also QAs it on the live site. Valentin never QAs code and never reads diffs; he only tries the finished feature.

1. **Before the PR:** targeted tests via `npm run test:file -- <files>`, `npm run lint:changed`, `npm run typecheck`, and the webpack build pass locally. Push the branch and open the PR as soon as a first version works, so the CI reviewers (ai-review, claude-review) run in parallel with any extra review; do not hold the PR back for local review rounds.
   Watch CI with the runner app, not Valentin's saved login: mint with `token=$(gh-app-token)`, require success and `[ -n "$token" ]`, then run `GH_TOKEN="$token" gh pr checks <PR> --repo hypertask-ai/hypertask --watch --interval 120`. Stop on mint failure; never fall back. Restart with a fresh token if it expires. Do not run a second watch for the same PR.
2. **Merge:** only after every required check is green and the live health check passed (last completed production App Smoke `run app-smoke` = success). A feature needs Valentin's plain yes in chat (feature freeze), quoted on the ticket with the date. If `revert-guard` blocks moving your own recent code, ask him once in plain words and, on his yes, add the `intentional-revert` label.
3. **Watch the deploy:** poll the GitHub Production deployment for the merge sha until `success` (about 3 minutes). Never poll by reloading his browser tab.
4. **Verify live yourself, with evidence:**
   - API and CLI behaviour: `ht GET /mcp/...` against production with the exact inputs from the ticket's acceptance criteria; record counts and timings.
   - UI: drive the live app in a headless browser with the QA agent's login and skills (this repo's `.claude/skills/verify-qa` and `verify-on-phone`), signed in as the QA test account. Never use Valentin's account, password or cookies, and never mint or inject credentials for him. Capture screenshots (desktop and phone width, light and dark when UI changed) and a short video of the user path.
   - Which login: `~/.config/hypertask-videos/storageState-qa.json` is valentin@hypertask.ai (user 985), the designated flag QA identity in `src/lib/flags.ts`, so it sees every Owner + QA flag; use it for flagged features (`phone-shot.sh <url> <out.png> --state <that file>`). `storageState-qa-normal.json` (user 2343) is a plain account for the flag-off path. Both are allowed for VCC sessions (Valentin, 2026-10-01); never print either file. If the script lands on a login page, the state expired: say so, do not invent a login.
   - Doctor first: the production deployment for your merge sha is `success`, and a shot of a known page (https://app.hypertask.ai/my-tasks) is signed in. Only then judge the change.
   - Evidence lives in `~/.local/state/vcc-evidence/HTPR-NNNN/` (screenshots, video, API output) and survives cleanup.
   - Drive the real user path from the matching file in `.claude/skills/verify-qa/reference/feature-map/` (how to reach it, how to drive it, what proves it). If the ticket's area has no file, add one in the same shape in your PR (pattern from https://github.com/cursor/plugins/blob/main/pstack/skills/create-verification-skill/SKILL.md).
   - Check the flag-off path too: an account without the flag sees today's behaviour.
5. **Report on the ticket via `vcc`:** one `--kind done` comment with what you checked, the evidence attached (`--attach`), the merged PR link and deploy time, and what Valentin can try himself (URL plus 3 to 5 steps). Then move the ticket: PASS to Done, or if anything failed, fix it in a new PR and repeat from step 1. Switching a flag to Everyone stays Valentin's decision.
6. **Report on the ticket:** verdict first, the URL to try, and any honest gap you could not verify. Only HT Product Lead mentions and opens pages in chat.

## Stay in your lane

- Touch only the ticket you claimed. Do not move or comment on other tickets.
- Infra problems you hit (CI, deploy, tooling) go on the Agents & Infra board (project 4060) via `vcc`, with the exact time and what happened, and one line to Valentin.

## Talking to Valentin

Global CLAUDE.md applies: /pospeak style, terse, verdict first, plain full https URLs, runners share links in ticket comments only; HT Product Lead opens only pages it mentions to him in chat, no em dashes, you are the QA (prove it on the live site with evidence before saying done).
