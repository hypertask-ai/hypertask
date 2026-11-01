---
name: ship
description: Take one Hypertask ticket from claim through fix, PR, deploy, live proof, Done, and cleanup.
---

# Ship one ticket

This session owns the ticket end to end. Load the [skill map](../INDEX.md) once, then only the skill for the current step. Repo policy lives in [AGENTS.md](../../../AGENTS.md); house rules remain authoritative. Scripts in [scripts/](scripts/) own command syntax and validation. Never weaken them to finish a ticket.

## Before anything else

1. Read `ship-identity`. Board writes use that identity through `vcc`, never Valentin's credentials. Helpers never write to boards.
2. Check `~/.config/agent-kit/pilot/<identity-slug>` at the ticket boundary, never mid-ticket. Follow its ship skill only when the resolved folder is `skills/ship` inside `~/.config/agent-kit` or `~/projects/company-skills*/kit/`. Otherwise use this skill and record an invalid pointer on the ticket.
3. With no ticket, run `board-check` first. Stale means no sign of life for six hours. Leave listed tickets untouched until Valentin decides. Record stale-ticket decisions on the board, not in another session's chat. Pick the top free ticket matching your runner type and the current dispatch order. Exclude parked, human-review, and blocked work. Never take Abdul's tickets.
4. Read the chosen ticket and comments, including replies and reactions to existing questions. Keep its full title and URL in the ticket record. Do not repeat an unanswered question. Link its original comment when handing over. Preserve human assignees and manual moves.
5. Run `ship-claim` with your resume command before investigation, gates, or helpers. Exit 0 means proceed; exit 3 means step back; a hold means finish existing work first. Claims go to agent activity after assignment succeeds; collision checks read activity and legacy comments. A recent competing claim is taken. Old retired-bot notes are history, not ownership. Never take a stale claim merely because its runner is quiet.

Runners use headless QA browsers, never Valentin's browser or login. Only HT Product Lead opens links for him. Keep your existing session name; name an unnamed session after its ticket.

## Write the proof gates

Run `ship-gates` after claiming. It creates the ticket's ledger under `~/.unlazy/ledgers/<TICKET>/`, one folder per ticket outside the project, and keeps no session state in the worktree. Use `unlazy`; inspect and separately approve extra checks in that folder's `gates/extra.md`. Keep one observable outcome per gate. Re-run the ledger after each step and before reporting, with `--root` on the ticket folder so its locks stay out of the project. A ledger written from another worktree is refused until you re-run with `SHIP_LEDGER_MOVE=1`, which moves its generated gates to this checkout. Never edit generated checks to bypass repository settings or approvals.

Before building, record one `Deeper:` activity with **field**, **raw source**, **method**, **outside proof**, **breaks if**, and **proof gate**. Name the extra runnable gate `<TICKET>.deeper-<name>`. Use real source, the real entry point, shipped flag mode, realistic data, and affected shared systems. Capture a before baseline for the most likely regression. A proof that still passes that regression is not enough. Improve the method, not the scope.

When several tickets were explicitly requested, claim all first and add all to one ledger. Ship each with its own PR. Otherwise work one ticket. If a required outcome becomes impossible, retain its gate, record `ABANDON` with the handoff reason, and report incomplete work honestly.

## Follow the workflow

Keep the ticket **In Progress** while you work, including CI, review fixes, merge, deploy, and QA. **AI Review** means stopped and waiting for another reviewer, not an open PR. Read back board writes.

| Step | Load or use | Required proof |
|---|---|---|
| Claim | `ship-claim`, then [vcc](../vcc/SKILL.md) | Own claim activity won, own agent assigned, In Progress |
| Sharpen the approach | Deeper activity and extra gate | `ship-check deeper` passes |
| Plan big work | Read `~/.agents/skills/poteto-mode/SKILL.md` and follow its matching playbook; skip for one-file fixes | One `Plan:` activity; every planned outcome has a gate in the ledger |
| Plan visible work | [reuse-existing-ui](../reuse-existing-ui/SKILL.md); current design policy | Existing components identified; new component approval recorded |
| Review high-risk design | [interrogate](../interrogate/SKILL.md), only for the valentin-review lane | Review blockers resolved; required human decision recorded |
| Implement | [fix-bug](../fix-bug/SKILL.md), [fix-slow-page](../fix-slow-page/SKILL.md), or [ship-feature-behind-flag](../ship-feature-behind-flag/SKILL.md) | Smallest complete change; targeted behavior checks pass in CI |
| Simplify | [simplify-before-pr](../simplify-before-pr/SKILL.md); [blast-radius](../blast-radius/SKILL.md) outside the usual lane | Own diff reviewed; shared behavior preserved |
| Check UI | [design-compliance](../design-compliance/SKILL.md), [verify-on-phone](../verify-on-phone/SKILL.md) | Before/after evidence; unrelated layout unchanged |
| Document behavior | [update-docs](../update-docs/SKILL.md) | Changed behavior documented or justified no-change record |
| Open PR | One existing-ticket PR targeting the proper base; bind with `ship-check bind` | `ship-check pr` passes; no auto-merge |
| Merge | vcc merge routine and `ship-check guard` | Current-head required checks and production health green |
| Deploy | vcc deployment routine | `ship-check deployed` passes for the merge SHA |
| Verify live | [verify-qa](../verify-qa/SKILL.md), matching feature-map page | Real entry-point behavior and side effects; `ship-check proof` for app tickets |
| Close | Plain-language outcome, QA report, then Done | `ship-check docs` and `ship-check done` pass |
| Clean | [clean-up](../clean-up/SKILL.md) | `ship-check cleaned` passes |
| Reflect | [reflect](../reflect/SKILL.md), once after the last ticket | Accepted proposals handled, or skip reason in activity |

Reused UI needs no new wireframe. New component files require Valentin's design approval naming them. Follow house rules for Figma frames and images. Do not implement before required approval. Ordinary ai-review work must not use interrogate. Money, access, security, and irreversible-data decisions use the valentin-review lane.

## Stay active until Done

Nobody prompts a runner again after its turn ends. Ending the turn while CI, review bots, merge, deploy, or QA are pending stops the ticket. Keep working from claim to Done. To wait, run one bounded watcher, such as `gh pr checks <pr> --watch --interval 300`, then act on what it reports. Stop early only for a blocker or a Valentin Question from the exceptions below.

The done comment lists every decision you made on Valentin's behalf, one line each with its reason. Write "Decisions: none" when there were none.

## Helpers

The runner itself runs Codex gpt-6.1-sol at medium effort and delegates by default, with helpers in the background. Code edits: `hax --provider=codex --model=gpt-6.1-terra --effort=medium --no-session -p "<task>"`. Lookups, logs and summaries: `hax --provider=codex --model=gpt-6-luna --effort=low --no-session -p "<task>"`. Sol high (`--model=gpt-6.1-sol --effort=high`) only for hard bugs, security and money.

## Release completion

CI is the test gate. Push the branch; never run tests or builds on the VPS. Tests run in CI on the PR. A killed local check, SIGKILL, or exit 137 is not a blocker: push and let CI prove it. Never mark a ticket blocked on HT Product Lead for a killed local test. An independent release error needs its own `Blocker:` line before moving the ticket.

On board 15, **Flag: Everyone**, **Flag: Only Me + QA**, and **No Flag** are completed states. Close a verified restricted release in its declared mode without widening the flag. **Flag: Off** is not done. Other columns follow the board's `isDone` metadata.

Record branch ownership with `ship-check branch` immediately after creating each branch, or record none when creating none. Preserve the session id through cleanup. Never delete another session's worktree or block a released ticket on it.

## Keep checks authoritative

| Rule | Enforced by |
|---|---|
| Real ticket and accepted PR title | `ship-check title/pr`; title format is ticket, bracketed type, description |
| Own PR bound to ticket; latest head passes tests | `ship-check bind`, `ci-tests`, and merge guard |
| Current-head premerge evidence | `ship-check pr` and guard publish it; trusted poster refreshes it |
| Successful production deployment before completion | `ship-check deployed` and Done guard |
| Live proof matches merge and evidence contract | `ship-check proof`; app tickets require screenshots |
| Correct board completion and session cleanup | `ship-check done/cleaned` |

Codex has no hook: run the same guard and completion checks explicitly. Read the PR merge state before diagnosing checks; resolve conflicts first. Read fresh ticket comments again before merging. Green checks never override a later correction. Follow [CI policy](../../../docs/ci.md); use runner App credentials, never human GitHub login. Wait with `~/.local/lib/hypertask/runner-pickup/ci-wait <PR> --repo hypertask-ai/hypertask --timeout 1800` using the runner App token. GitHub notifications trigger fresh reads; the fallback is ten minutes. Never use `gh pr checks --watch` or `gh run watch`.

For non-app repositories, configure `SHIP_REPO`, `SHIP_BASE`, and `SHIP_CHECKOUT` before generating gates and repeat them for checks and the Done move. The gate generator persists them. Native CLI uses `hypertask-ai/cli`, base `main`; verify uses `hypertask-ai/verify`, base `app-suite`. Verify releases require a merge-SHA release and an updated nightly checkout. Release-less repos may use `SHIP_DEPLOY=none`; a real release takes precedence. Cloudflare workers additionally use `SHIP_WORKER`; deployment proof requires the merge version active at 100%. See script validation before choosing settings.

## Record state on the ticket

Write agent activity at claim, fix, PR, checks green, merge, deploy, and QA; at least every two hours while active. Include the parse or dispatch layer you tested. Plans, test output, retries, and helper reports stay in the agent lane.

Human comments are for decisions, QA, and completion. Claims, releases, handoffs, status, session names, and resume commands belong in agent activity only. Use the shared `tickets` rules and the appropriate `--kind`. Before waiting on CI, a helper, deployment, or a person, post the required agent activity record through `vcc activity add` with separate **Next**, **Helpers**, **Branch/PR**, and **Outputs** lines. Include the resume command. Do not message another session.

Save every QA run, including failures, under the ticket's evidence folder outside the worktree. Write the checklist first. Mark each case PASS, FAIL, or UNREACHABLE with evidence; failures include steps and actual behavior. Record account ID and role, never credentials. Use verify-qa's screenshot, video, and proof contract. Publish a self-contained HTML report as a ticket page, never on hypertask.app. Post one QA verdict with the report link and key attachments. No bare "tests pass" claims.

After successful live proof, explain the user-visible problem and changed result before Done. Link the PR and report. Put the flag's dedicated link last in its ticket description, preserving other text; use the same link whenever naming it. Make the required release announcement with Valentin's mention. Follow [flag policy](../../../AGENTS.md#feature-flags-for-new-user-facing-behavior), not historical defaults in old comments.

## Switching flags from a session (YPER4-215)

Use `ht-flag` through your session identity. Existing switches require the supported approval path: a clear unedited yes within seven days, matched to the named flag and mode. A thumbs-up, Valentin's own comment, or an HT Product Lead record of his exact chat words may qualify. Re-read comments and reactions before repeating a wait. Ambiguous yes is not approval. Batch approvals must name every switch together.

The reason must link to the exact approval comment. A later human no withdraws approval; edited, conditional, or ambiguous answers do not approve. Everyone review switches require policy approval, another flag-owner agent's independent review, and live evidence; the writer cannot review itself. Reviews are single-use within 24 hours. High-risk flags retain the human-approval path. Run the core inbox cycle as QA 985 before requesting Everyone and immediately afterward. A failure means Owner + QA first, never Off. Never park a ticket in Valentin Review merely to request a flag switch.

For any flagged failure, a flag-owner write/admin agent holds the flag at Owner + QA with `ht-flag set KEY owner-qa --failure "<reason>"`, then repairs. Never switch a flag Off: Off is Valentin's own safety switch. A hold narrows who sees a broken feature, so it needs no approval and applies to every flag, including high-risk and bugfix. The action is audited and refuses no-ops. Other modes retain approval requirements. A held flag stays held until Valentin decides its next mode; never turn a failed flag back on automatically. Only Valentin may open the admin page with his login; runners use approved APIs.

## Handle exceptions without inventing completion

- **Blocked after two attempts:** a killed local test is not an attempt; push and let CI decide. Otherwise record what failed and why on the ticket; mark it blocked on HT Product Lead. Keep evidence and a resumable state. Follow the current dispatch limit before choosing more work.
- **Human decision:** use Valentin Review only for a real decision about money, access, security, or irreversible actions. Write the Question exactly in the house-rules tickets skill format (`~/.local/share/house-rules/skills/tickets/SKILL.md`): max 3 plain bullets of context, then Question, My recommendation and Why right under it, then Yes and No, a blank line between each. No outside links or product precedents. Preserve any existing question instead of reposting it.
- **Already fixed:** use `ship-check duplicate` to bind the fixing ticket's merged PR. Record this session's branch, or none. Prove the result live before closing. A partial fix is not a duplicate.
- **No change needed:** use `ship-check nochange` only after a `Resolved without a change:` comment with evidence. No open/bound PR or unmerged ticket branch may remain.
- **Decided against:** quote Valentin's dated decision in the required `Decided against: Valentin, YYYY-MM-DD:` comment, close the PR unmerged, and use `ship-check dropped`. Never claim it deployed.
- **Archived:** read the archive state first. Done means verify the existing live result. Otherwise restore through the product surface before working. Search Normal, Archive, and Deleted before declaring a ticket missing; board moves can change its number.

When the Agent Kit blocks work, search board 4060 before filing a fix. Never duplicate another active repair. Fix only the blocker through the normal ticket/PR path. Protected parts require HT Product Lead review and merge: `ship-gates`, the guard part of `ship-check`, `ship-identity`, the `vcc` wrapper, `.claude/skills/unlazy/`, `.claude/hooks/`, `.claude/settings.json`, `CLAUDE.md`, and `AGENTS.md`. Hand the PR over on its ticket; do not self-merge.

Runner timers, webhooks, pickup, and self-update have their own scripts. Read them only for an installation or dispatch task, not every ticket. New user timers require `user-unit-check` before enablement and one successful first real run afterward.

After Done, clean only this session's finished worktree and branch. Keep evidence and unfinished work. Record cleanup proof and suggest the next freshly checked free ticket, without claiming it. Nothing is live until the merge's Production deployment succeeds and its real behavior is proven.
