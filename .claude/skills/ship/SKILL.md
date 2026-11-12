---
name: ship
description: Take one Hypertask ticket from claim through fix, PR, deploy, live proof, Done, and cleanup.
---

# Ship one ticket

Own one ticket through live proof. Read the [skill map](../INDEX.md) once; load other skills only at their step. [AGENTS.md](../../../AGENTS.md) owns repository policy; house rules win. [Scripts](scripts/) own command validation. Never weaken checks to finish.

## Before anything else

1. Run `ship-identity`. Read boards with `hypertask`; write with `vcc` as yourself. Never copy credentials.
2. Check `~/.config/agent-kit/pilot/<identity-slug>` at the ticket boundary, never mid-ticket. Accept only a resolved `skills/ship` inside `~/.config/agent-kit` or `~/projects/company-skills*/kit/`. Otherwise use this skill and record an invalid pointer on the ticket.
3. With no assigned ticket, run `board-check` and follow current dispatch. Leave stale work (no life for six hours), active claims, blocked work, human-review work and Abdul's assignments untouched. Stale-ticket decisions belong on the board.
4. Read the ticket, comments, replies and reactions. Keep its title and URL. Preserve human assignees and manual moves; reuse unanswered questions and link their original comment at handoff.
5. Run `ship-claim <TICKET> "<resume command>"` before investigation or coding. Exit 0 permits work; exit 3 means step back; a hold means finish existing work. Claims become activity after assignment succeeds; legacy comments still count. Retired-bot notes alone are not ownership.

Keep your session name; name an unnamed session after its ticket. Runners use headless QA accounts, never Valentin's browser or login. Only HT Product Lead opens links for him. Model and delegation policy stays in house rules; helpers never write boards.

## Write the proof gates

Run `ship-gates`, then use `unlazy`. Inspect and separately approve extra checks in `gates/extra.md`. Keep one observable outcome per gate; rerun after each step and before reporting. Never edit generated checks to bypass settings or approvals.

Before building, post one `Deeper:` activity naming **field**, **raw source**, **method**, **outside proof**, **breaks if**, and **proof gate**. Add runnable gate `<TICKET>.deeper-<name>`. Use the real entry point, shipped mode, realistic data and affected shared systems. Capture a regression baseline; the proof must detect that regression. Improve the method, not the scope.

Claim multiple tickets only when explicitly requested, with one PR each. Keep impossible outcomes as `ABANDON` gates with a handoff reason; never report them complete.

## Follow the workflow

Read back board writes. Keep work In Progress while active; AI Review means stopped for another reviewer. Current house rules govern parking and resume behavior.

| Step | Load or run | Proof |
|---|---|---|
| Claim | `ship-claim`, [vcc](../vcc/SKILL.md) | Winning claim, own assignment |
| Sharpen | Deeper activity and runnable gate | `ship-check deeper` |
| Plan substantial work | `poteto-mode` matching playbook | `Plan:` activity; outcomes gated |
| Plan visible work | [reuse-existing-ui](../reuse-existing-ui/SKILL.md), current design policy | Existing components; required approval |
| High-risk review | [interrogate](../interrogate/SKILL.md), valentin-review lane only | Decisions resolved; never ordinary ai-review |
| Implement | [fix-bug](../fix-bug/SKILL.md), [fix-slow-page](../fix-slow-page/SKILL.md), or [ship-feature-behind-flag](../ship-feature-behind-flag/SKILL.md) | Smallest change; targeted CI proof |
| Simplify | [simplify-before-pr](../simplify-before-pr/SKILL.md); [blast-radius](../blast-radius/SKILL.md) outside usual lane | Own diff and shared behavior reviewed |
| UI checks | [design-compliance](../design-compliance/SKILL.md), [verify-on-phone](../verify-on-phone/SKILL.md) | Before/after; unrelated layout preserved |
| Docs | [update-docs](../update-docs/SKILL.md) | Changed behavior documented or justified no-change |
| PR | `ship-check bind`, then `ship-check pr` | One ticket/PR; correct base; auto-merge off; current-head evidence |
| Merge | [vcc](../vcc/SKILL.md), `ship-check guard` | Current required checks; production health |
| Deploy | vcc deployment routine; `ship-check deployed` | Successful merge-SHA deployment |
| Live QA | [verify-qa](../verify-qa/SKILL.md), matching feature map; `ship-check proof` | Real behavior, side effects and app screenshots |
| Close | Outcome and QA report; `ship-check docs`, `ship-check done` | Verified completed board state |
| Clean | [clean-up](../clean-up/SKILL.md); `ship-check cleaned` | Only this session's finished branches/worktrees |
| Reflect | [reflect](../reflect/SKILL.md), once after last ticket | Findings handled or skip reason in activity |

New component files need design approval naming them; reused UI needs no new wireframe. Design-pass, Figma and visible UI work use [verify-design](../verify-design/SKILL.md) and independent QA. Follow current house rules for release mode and flag switching, not historical comments.

## Release completion

Tests and builds run in GitHub-hosted CI, never on the VPS. SIGKILL or exit 137 is not an independent blocker. Record each branch with `ship-check branch` immediately, or `none` only when none was created; preserve the session id through cleanup.

Use runner App GitHub credentials, never human login. Resolve conflicts before diagnosing checks; reread ticket replies before merging. Hookless sessions run guards explicitly. CI and release policy live in [docs/ci.md](../../../docs/ci.md) and [vcc](../vcc/SKILL.md). Follow current house rules for checks and recheck timing; never poll GitHub faster than five minutes.

On board 15, Flag: Everyone, Flag: Only Me + QA and No Flag are completed states; Flag: Off is not. Close verified restricted releases without widening flags. Other boards use their `isDone` metadata. A merge alone is not a release.

## Record state on the ticket

Use `vcc activity add` at claim, fix, PR, green checks, merge, deploy and QA; at least every two hours while active. Include the parse or dispatch layer tested. Before pausing, record separate **Next**, **Helpers**, **Branch/PR**, and **Outputs** lines plus the resume command. Plans, retries, logs, handoffs and reflection stay in activity.

Human comments are only decisions, QA and completion, following shared `tickets` rules. Save all QA runs outside the worktree: checklist first, PASS/FAIL/UNREACHABLE with evidence, failure steps and actual result, account id and role without credentials. Follow verify-qa's screenshot/video/proof contract; publish a self-contained ticket-page HTML report, not hypertask.app. Post one verdict with report and attachments, never bare claims.

Before Done, explain the user-visible problem and result; link PR and report. List decisions and reasons, or `Decisions: none`. Preserve description text and use the dedicated flag link consistently. Current house rules govern flag-link placement and release announcements.

## Switching flags from a session (YPER4-215)

Use `ht-flag` as yourself, following current house rules and the [flag operation reference](../../reference/ship-operations.md#flag-operations). Never switch Off autonomously or use Valentin's login. Read comments and reactions before repeating a request; do not park on Valentin for a flag switch.

## Ticket-only runner handoffs

Agent-to-agent session messaging is closed by default. Only Valentin's explicit request for that case permits it. Use ticket activity, not another session's chat. Protected changes require Chief Of Staff review and merge; do not self-merge protected changes. See [protected parts](../../reference/ship-operations.md#protected-parts).

For a broken tool/server after two failed attempts, record the exact error and next step. Board 15 uses `vcc task move T --section "Agent Blocked (Infra)"`; board 11514 uses `vcc task move T --section "Agent Blocked"`. Keep the owner assigned unless current parking policy says otherwise. Never put user 6 in the blocker field as an agent substitute.

## Handle exceptions without inventing completion

Load [exceptions](../../reference/ship-operations.md#exceptions) for blocked, archived, already-fixed, no-change, dropped or human-decision cases. For non-app work, load [other repositories](../../reference/ship-operations.md#other-repositories); for installation tasks, load [runner installation](../../reference/ship-operations.md#runner-installation). Keep unfinished evidence and work; never delete another session's files. A partial fix is not completion.
