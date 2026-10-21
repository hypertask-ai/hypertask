# Skills for Valentin's Claude Code sessions

**Runner browser policy.** A runner (any session not named HT Product Lead) never opens pages in Valentin's browser: no `zsb` navigate/open/activate. Links to tickets, pages, reports and wireframes go in ticket comments only. Browser QA and checks use headless Playwright with QA account 985, following `verify-qa`, never his browser. Only the session he talks to (HT Product Lead) opens a page for him, and only when it mentions that page to him in chat. (Valentin, 2026-10-12): "i never look a the runner sessoins they don't need to do that i reply to ticket in the inbox and via you thats it" and "but should the even try to open pages?"

Together these skills, their scripts, the hooks and the rule files (CLAUDE.md, AGENTS.md) are the **Agent Kit**: how every Hypertask session works (Valentin, 2026-10-02). It lives in this repo, next to the code it works on. Changes to it are tickets on the Agents & Infra board (project 4060) and PRs, like any other change. (Not to be confused with Product Bot, the retired farm agent.)

These skills are for an interactive session started with `/ship`. One session takes one ticket from the fix through the production check. Board writes go through `vcc` (identity "Valentins Claude Code CLI"). Reads go through the plain `hypertask` CLI.

Read the "when to load" column, open that SKILL.md, and follow it, including its scripts. Paths are repo-relative from the repo root.

## Skills

| Skill | When to load (/ship step) | Path |
|---|---|---|
| ship | Start of every session (`/ship <ticket>`): the map of steps, the proof checklist, the merge and Done block | .claude/skills/ship/SKILL.md |
| scriptify | Weekly routine discovery, deterministic scripts and runner handoff | .claude/skills/scriptify/SKILL.md |
| setup-runner | `/setup-runner [number]` in a fresh session: set up its runner login and identity, then follow /ship without a ticket | .claude/skills/setup-runner/SKILL.md |
| clean-up | After Done (from /ship), or by hand with `/clean-up`: removes this session's own finished worktrees and branches | .claude/skills/clean-up/SKILL.md |
| drain-board | `/drain-board <board>`: works every open ticket on a board until each is Done or waiting on Valentin, one ledger gate per ticket | .claude/skills/drain-board/SKILL.md |
| vcc | Claim, board writes, merge, deploy watch, report | .claude/skills/vcc/SKILL.md |
| wireframe | New or changed visible UI, except a `[BUGFIX]` restoring intended behaviour, before code: full-app base kit on hypertask.app, clickable link and PNGs, one Question, UX Sign-off, Valentin's yes (Valentin, 2026-10-10) | .claude/skills/wireframe/SKILL.md |
| reuse-existing-ui | Before UI code | .claude/skills/reuse-existing-ui/SKILL.md |
| fix-bug | The fix, when it restores behaviour that used to work | .claude/skills/fix-bug/SKILL.md |
| fix-slow-page | The fix, for a speed ticket: reproduce, trace, smallest fix, before/after proof | .claude/skills/fix-slow-page/SKILL.md |
| speed-analyst | SPEED RUNNER only: takes speed work only, reads daily measurements, investigates one bottleneck, updates its playbook and researches performance weekly | .claude/skills/speed-analyst/SKILL.md |
| ship-feature-behind-flag | The fix, when it adds behaviour the user has not seen | .claude/skills/ship-feature-behind-flag/SKILL.md |
| interrogate | Before coding, only for `valentin-review`: money, login and access, security, data that cannot be undone; never for ordinary `ai-review` | .claude/skills/interrogate/SKILL.md |
| blast-radius | Before the PR for anything outside the usual lane | .claude/skills/blast-radius/SKILL.md |
| simplify-before-pr | Before the PR | .claude/skills/simplify-before-pr/SKILL.md |
| design-compliance | Before the PR (UI) | .claude/skills/design-compliance/SKILL.md |
| update-docs | Before the PR (user-visible change) | .claude/skills/update-docs/SKILL.md |
| verify-on-phone | Before the PR (UI) | .claude/skills/verify-on-phone/SKILL.md |
| verify-qa | After deploy | .claude/skills/verify-qa/SKILL.md |

`prototype` is the `/prototype` slash command, not a `/ship` step. When a change touches auth, billing, or user data, `fix-bug` also reads `.claude/skills/fix-bug/reference/security-findings.md`.

`wireframe` is required before new or changed visible UI code, except a `[BUGFIX]` restoring intended behaviour: build options from the live app (Ctrl+K for menus, no invented UI), publish a clickable link, then move to **UX Sign-off** (board 15 column 22502). The last comment has the wireframe link, `New elements: <ComponentName>, ...` (or `New elements: none`), and one yes/no `Question:` @mentioning Valentin. Wait for his yes before code; every new component file still needs his yes naming it, including in a `[BUGFIX]`. The `ux-signoff` check enforces this (Valentin, 2026-10-10).

## The flag rule

A real bug fix restores behaviour that used to work or was clearly intended.
Bug fixes ship behind a ticket-named flag with `kind: "bugfix"`, on for Everyone by default (Valentin, 2026-10-06). Fixes to saved data, security and crashes keep shipping with no flag. Bugfix flags get the same cleanup after 14 days on Everyone. New feature and improvement flags set `defaultMode: "EVERYONE"` in their definition file unless `releaseRisk.highRisk` is set (`money`, `access`, `data-deletion`, `customer-email`) or kind is `internal`; existing flags keep their current mode (Valentin, 2026-10-20, HTPR-7389). A `[BUGFIX]` title is only a hint to the mechanical gate: the
reviewer decides from the diff whether this is truly a fix. New visible
behaviour dressed as a fix still needs a flag. (Matches `fix-bug/SKILL.md`.)
