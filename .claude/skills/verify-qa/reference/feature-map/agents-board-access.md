# Agents and board access

Written from the HTPR-7574 live QA runs (PRs 1835 and 1847).

## How a customer reaches it

- Open **Agents** at `/agents`, or board command center → **Manage agents**. The command navigates to `/agents`, not the legacy modal.
- Pick an owned agent at `/agents/<id-or-slug>` and expand **Board access**.
- Board desktop: **Invite team members → Invite to Board (share)**. Phone: **Commands → Invite people** opens the same picker.
- QA is user 985, state `~/.config/hypertask-videos/storageState-qa.json`, owned QA Sandbox 7049 at `/project?id=7049`, team `08f79efd-770e-4e32-9728-65e6d29ec893`. Never navigate to or mutate boards 15/4060 or use Valentin's account. Lists may contain other boards; that is not permission to visit them.

## How to drive it

Agent lists are not always read-only for QA. `GET /api/agents/owned` can create a default Hyper AI agent and board membership on every accessible team that lacks an active owned agent; `GET /api/agents?teamId=<sandbox-team>` can seed that team too. Establish pre-existing agent and membership ids through non-seeding reads before opening these lists or the invite picker. Stop if seeding could affect a board outside the permitted QA scope. Record any automatically seeded ids separately from the two throwaway fixtures.

1. Doctor: read the merge SHA's successful Production deployment, require `POST /api/app-shell/bootstrap` HTTP 200 and `slices.user.data.id=985`, and capture signed-in `/my-tasks` with `phone-shot.sh --state` before judging the feature.
2. Confirm effective flags with `GET /api/flags`: `htpr-7574-owned-unattached-agents` and `htpr-7574-invite-picker-latest-members` must both be true for 985. Effective flags do not prove configured modes; read those with `ht-flag get`. Do not change flags or use admin credentials.
3. Create two throwaway agents through **Agents → Agent Chat → Add agent**, which creates them unattached. Keep one (`-u`) never on any board. For the other (`-w`), owner detail → **Board access** → check QA Sandbox; require add response 200 and membership after reload. Team listing must confirm write role. Do not use the ordinary board-attaching creation flow for `-u`.
4. Keep the writer's credential in memory only. `PATCH /api/mcp/agents/<writer-id>` with its own credential and `{add_project_ids:[7049]}` must return HTTP 403 exactly: `An agent cannot change its own board access. Ask the person who owns this agent to open Agents, pick this agent, and add the board under Board access.` Confirm unchanged membership. This takes precedence over the admin-role check.
5. Production MCP endpoint is `POST https://app.hypertask.ai/mcp`, not `/api/mcp`. With the writer credential call `hypertask_projects`, action `invite_member`, input `{project_id:7049,userToAdd:<writer-id>}`. Preserve the full redacted JSON-RPC envelope. Expect HTTP 200, `result.isError=true`, and the exact safe reason followed by `Access denied. Use a credential with the required scope and confirm membership in the target board.` Do not invent a top-level authorization code absent from the wire.
6. Owner may cancel removal without changing membership, then remove/add `-w` through **Board access**. Both mutations must return 200; reload and query membership after each. Leave `-w` on 7049 and `-u` untouched and unattached.
7. `GET /api/agents?teamId=<sandbox-team>` must include owned `-u` with `boards:[]`. The invite picker is **flat** and offers this row as **Add to board**. There is no grouping acceptance requirement in that picker. `/agents?group=board` uses **No board**. The label **Not on any board** exists only in unreachable legacy `src/components/Modals/Agent/manage.modal.tsx`, not the current command entry point.
8. Judge 24 independent fresh-context first opens: porcelain, graphite, amoled, dia × desktop 1440x900 and phone 390x844 with mobile UA/touch × three opens. Await completion and parsing of team agents, board agents, and all member requests, then another 1500 ms quiet. Record every judged open, including missing rows. Anything below 24/24 is FAIL, not a retry-until-green. Never click the unattached row during this check.
9. Prove non-owner exclusion only with an independently established non-owned fixture. Save ids only. If none exists in permitted scope, record UNREACHABLE with the closest real owned/team/member-id and positive-picker path; an all-owned response is not a negative control. Do not create another identity or change someone else's agent.

## What usually breaks

- Self-access returns only an admin-role error rather than actionable owner steps.
- MCP discards safe authorization reasons or leaks arbitrary unsafe text. Schema refusals do not prove unknown-message redaction.
- A superseded members effect closes over an older owned-agent list and overwrites the newer picker rows. PR 1847 ignores superseded answers behind `htpr-7574-invite-picker-latest-members`; repeat fresh-context checks after deployment.
- Source from the legacy modal is mistaken for reachable production UI or a flat picker is incorrectly failed for lacking legacy grouping.
- A screenshot is captured before requests finish, or a shrinking desktop viewport is mislabeled as a real phone context.
- Pixels alone are mistaken for persistence; an empty non-owner result is mistaken for exclusion proof.

## What proof to collect

Write GATES.md first. Record deployment SHA/id/state, bootstrap status/id, effective flags, signed-in doctor screenshot, UI fixture creation and writer add, exact self-denial, owner cancel/remove/add and reload memberships, full redacted MCP envelope, and team API projection of ids/owner/boards/role. Save a per-attempt table and PNGs across every theme and viewport, with request settlement and fresh context ids. Render JSON tables to PNG with PIL, not ImageMagick @file. Preserve missing-row attempts and distinguish pre-judgment automation/bootstrap interruptions from feature outcomes.

Record command navigation to the register and the reachable No board group without asserting legacy labels. Name unreachable paths and closest alternatives. Follow verify-qa Feature map / Doctor / Run / Cases format, with PASS/FAIL/UNREACHABLE bullets pointing inside the new run folder. Never print or persist credentials, cookies, storage-state copies, traces, HAR, token screens, or raw credential-bearing responses. Read supplied acceptance criteria without fetching forbidden board 15; no ticket/GitHub writes or repository tests/builds/tsc/next.

## Cleanup

Delete only this run's recorded names/ids through owner detail **Archive or delete → Delete agent → confirmation**. Match DELETE by method and route family, because UUID detail URLs can canonicalize to slugs. Require HTTP 200 deletion and HTTP 404 detail for each, reload Agents and verify names absent, and confirm both ids absent from owned/team lists. Compare pre-existing ids against the baseline, accounting separately for automatic seeds. Do not delete default agents as throwaway fixtures or remove them just to restore the original list count; list reads can recreate them. Never revoke all tokens, alter other agents, change tasks, or write flags.
