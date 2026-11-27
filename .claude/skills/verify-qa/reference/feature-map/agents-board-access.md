# Agents and board access

Written from the HTPR-7574 live QA runs (PRs 1835 and 1847).

## Sub-features

- `cross-team-identities` Cross-team identities.
- `existing-agent-login-recovery` Existing-agent login recovery.
- `wiki-agents` Open `/wiki/agents`. The page title is Universal agent onboarding. It renders the shared guide: read AGENTS.md and this page, claim a ticket before code, use one managed agent token for board writes, and leave merge to trusted review.
- `shared-email-layout` With `htpr-7037-shared-email-layout` on, the first agent-connection email and the first completed-task email use the shared onboarding layout. The connection subject is "Your agent is connected" and the button is Open your board. The first-task subject is "Your agent just finished its first task", with Review the work and Invite a teammate. Each kind sends once. Off keeps the older templates.
- `agent-team-bound` With `htpr-7179-agent-team-bound` on, GET /api/mcp/agents adds `team_bound` on each owned agent. True means that agent's sign-in is limited to one team. The field is only true or false. Off omits it. An agent credential is refused with "Agents cannot list managed agent identities."
- `agent-feature-discovery` With `htpr-7322-agent-feature-discovery` on, GET /api/mcp/features lists that user's enabled feature-kind flags plus Inbox, Decisions, My Tasks, Search, and Reports, with URLs where the catalog has them. Hello names the same catalog. An agent that creates a page titled like one of those destinations still gets the page, plus a warning that the destination already exists. Off returns 404 "Feature discovery is not enabled" and adds no warning.
- `agent-role-screen` With `htpr-7509-agent-role-screen` on, Team settings, Agents, at `/settings/team-agents` shows Read, Write, or Admin. The team owner can press Change role and pick one. Read sees boards and tasks. Write also edits tasks and creates boards. Admin also gives other agents access. A native agent has no Change role button. Off hides the labels and the button. A role update then returns 403 "Agent role changes are not available". An agent token cannot change roles.
- `mcp-act-as-agent` With `htpr-7529-mcp-act-as-agent` on, a person's MCP connection can pass `as_agent` so comments, tickets, decisions, and inbox writes are stored as an agent that person owns, and only on boards that agent already belongs to. Agents ensure gets or creates that named agent and tells the caller to pass the id as `as_agent`, with no extra token. Off answers "as_agent is not switched on for this account yet." Ensure answers "agents ensure is not switched on for this account yet; use agents list and create." An agent credential and a management key cannot use `as_agent`.
- `connect-overlay` With `htpr-7550-connect-overlay` on, and the first-task pointer also on, the owner's seeded starter board shows a Connect your agent overlay before the first-task pointer, while that board still has no real task and the agent is not connected. Skip posts to dismiss it. The overlay does not mint an MCP token until the person picks a client and reaches the connect step. Off leaves the earlier connect card and the earlier automatic token.
- `add-existing-agent` With `htpr-7577-add-existing-agent` on, Board settings, Agents, at `/settings/board-agents` shows Add existing agent. The picker searches agents that person owns. Groups are ON THIS TEAM, NOT ON ANY BOARD, and UNAVAILABLE. Add confirms, then toasts that the agent was added to the board. Off hides the button. The add rule itself does not change.
- `agent-access-request` With `htpr-7582-agent-access-request` on, an agent can ask its human owner for board access. The owner sees it in Inbox, Decisions split (`/inbox?split=Decisions`): the agent name, "asks to join" the board "as a member", the reason, Decline, and Approve. Approve adds a plain member, the same as ticking Board access, and does not change the role. A board in another team cannot be approved. The agent posts project_id and a reason of 1 to 1000 characters to POST /api/mcp/agents/board-access-requests. A link on the card opens `/agents/<id>` with `boardAccess` set to that board, which expands Board access and highlights the row. Off blocks new requests and decisions. Grants already made stay.
- `cross-team-agents` With `htpr-8084-cross-team-agents` on, one owned agent can be granted boards in more than one team that its owner belongs to. The add-existing picker then labels the eligible group AVAILABLE AGENTS and includes those other teams. Cross-team conversation stays private to the owner and that agent. Off keeps the label ON THIS TEAM and marks another team's agent unavailable with "Agent belongs to another team". An agent that already crossed teams keeps its original team. Turning the flag off denies the later-team grants.

## How to get to it (user POV)

- Open **Agents** at `/agents`, or board command center → **Manage agents**. The command navigates to `/agents`, not the legacy modal.
- Pick an owned agent at `/agents/<id-or-slug>` and expand **Board access**.
- Board desktop: **Invite team members → Invite to Board (share)**. Phone: **Commands → Invite people** opens the same picker.
- QA is user 985, state `~/.config/hypertask-videos/storageState-qa.json`, owned QA Sandbox 7049 at `/project?id=7049`, team `08f79efd-770e-4e32-9728-65e6d29ec893`. Never navigate to or mutate boards 15/4060 or use Valentin's account. Lists may contain other boards; that is not permission to visit them.
- `/wiki/agents` is the Universal agent onboarding page. Open it and read the heading and the Start here list.
- Shared email layout has no screen. It is the message the board owner receives the first time an agent connects, and the first time that owner's agent completes a task.
- The team-bound field is on the owner's agent list from GET /api/mcp/agents, not a separate screen.
- Feature discovery is GET /api/mcp/features for the signed-in connection, and the warning on an agent-created page whose title matches a built-in destination.
- Agent roles are Team settings, then Agents: `/settings/team-agents`.
- Act-as-agent is an MCP write from a person's connection, using `as_agent` on a comment, ticket, decision, or inbox action.
- The connect overlay is the Connect your agent dialog on the owner's seeded starter board, before the first-task pointer.
- Add existing agent is Board settings, then Agents: `/settings/board-agents`, button Add existing agent.
- An access request lands in the owner's Inbox, Decisions split, at `/inbox?split=Decisions`.
- Cross-team grants use the same Board access control and the same Add existing agent picker. The flag changes which teams that picker will offer.

## Driving it with agent-browser

Agent lists are not always read-only for QA. `GET /api/agents/owned` can create a default Hyper AI agent and board membership on every accessible team that lacks an active owned agent; `GET /api/agents?teamId=<sandbox-team>` can seed that team too. Establish pre-existing agent and membership ids through non-seeding reads before opening these lists or the invite picker. Stop if seeding could affect a board outside the permitted QA scope. Record any automatically seeded ids separately from the two throwaway fixtures.

1. Doctor: read the merge SHA's successful Production deployment, require `POST /api/app-shell/bootstrap` HTTP 200 and `slices.user.data.id=985`, and capture signed-in `/my-tasks` with `phone-shot.sh --state` before judging the feature.
2. Confirm effective flags with `GET /api/flags`: `htpr-7574-owned-unattached-agents` and `htpr-7574-invite-picker-latest-members` must both be true for 985. Effective flags do not prove configured modes; read those with `ht-flag get`. Do not change flags or use admin credentials.
3. Create two throwaway agents through **Agents → Agent Chat → Add agent**, which creates them unattached. Keep one (`-u`) never on any board. For the other (`-w`), owner detail → **Board access** → check QA Sandbox; require add response 200 and membership after reload. Team listing must confirm write role. Do not use the ordinary board-attaching creation flow for `-u`.
4. Keep the writer's credential in memory only. Account 985 is Owner+QA, so `htpr-9625-agents-join-boards` is on. `PATCH /api/mcp/agents/<writer-id>` with its own credential and `{add_project_ids:[7049]}` is a same-team board the owner can invite to: require HTTP 200 and membership on 7049, then remove that membership again through owner Board access before continuing and record both responses. A board in another team, or a board the owner cannot open, returns HTTP 403 exactly: `Ask a member of board <id> to run: hypertask project invite <id> --user <writer-id>`. With the flag off, the same 7049 PATCH returns that 403 and membership stays unchanged. The refusal still happens before the admin-role check.
5. Production MCP endpoint is `POST https://app.hypertask.ai/mcp`, not `/api/mcp`. With the writer credential call `hypertask_projects`, action `invite_member`, input `{project_id:7049,userToAdd:<writer-id>}`. Preserve the full redacted JSON-RPC envelope. Expect HTTP 200, `result.isError=true`, and the exact safe reason `Ask a member of board 7049 to run: hypertask project invite 7049 --user <writer-id>` followed by `Access denied. Use a credential with the required scope and confirm membership in the target board.` Self-invite stays refused while the flag is on. Do not invent a top-level authorization code absent from the wire. A read-only pass has no disposable agent credential, so this and the writer's own `PATCH` are `verified-unreachable: needs an agent created through Agents > Agent Chat > Add agent; tried GET /api/agents/owned and the owned agent detail page`.
6. Owner may cancel removal without changing membership, then remove/add `-w` through **Board access**. Both mutations must return 200; reload and query membership after each. Leave `-w` on 7049 and `-u` untouched and unattached.
7. `GET /api/agents?teamId=<sandbox-team>` must include owned `-u` with `boards:[]`. The invite picker is **flat** and offers this row as **Add to board**. There is no grouping acceptance requirement in that picker. `/agents?group=board` uses **No board**. The label **Not on any board** exists only in unreachable legacy `src/components/Modals/Agent/manage.modal.tsx`, not the current command entry point.
8. Judge 24 independent fresh-context first opens: porcelain, graphite, amoled, dia × desktop 1440x900 and phone 390x844 with mobile UA/touch × three opens. Await completion and parsing of team agents, board agents, and all member requests, then another 1500 ms quiet. Record every judged open, including missing rows. Anything below 24/24 is FAIL, not a retry-until-green. Never click the unattached row during this check. A single open proves only that the picker renders: `verified-unreachable: needs 24 fresh contexts and ~4 minutes; tried /settings/board-agents on sandbox 7049 with the flags account`, which reached `Add existing agent` and the group titles.
9. Prove non-owner exclusion only with an independently established non-owned fixture. Save ids only. If none exists in permitted scope, record UNREACHABLE with the closest real owned/team/member-id and positive-picker path; an all-owned response is not a negative control. Do not create another identity or change someone else's agent.

### Wiki, mail, list, catalog, roles, act-as, overlay, picker, and requests

10. Open `/wiki/agents`. Require the heading Universal agent onboarding and a Start here step that names AGENTS.md. Do not follow links onto board 15.
11. For `htpr-7037-shared-email-layout`, use one throwaway connection and one throwaway first task on sandbox 7049. Record the connection subject "Your agent is connected" and the first-task subject "Your agent just finished its first task", plus the Open your board, Review the work, and Invite a teammate labels. Repeat the same events and require no second mail. With the flag off for a normal account, record the older template instead. Do not print the recipient address.
12. For `htpr-7179-agent-team-bound`, call GET /api/mcp/agents as the owner. Require `team_bound` true or false on each agent and no team id in that field. Call the same route with an agent credential and require HTTP 403 and the sentence "Agents cannot list managed agent identities." With the flag off, require the field absent.
13. For `htpr-7322-agent-feature-discovery`, call GET /api/mcp/features as the owner. Require Inbox, My Tasks, Search, and Reports, and Decisions only when that destination is enabled for this user. Create one page whose title is Inbox and require HTTP success, the page url, and a warning that Inbox already exists. With the flag off, require HTTP 404 "Feature discovery is not enabled" and a created page with no warning.
14. For `htpr-7509-agent-role-screen`, open `/settings/team-agents` as the team owner. Require the Read, Write, and Admin line and Change role on a non-native agent. Pick Write and require the toast that the agent is now Write. Open the same screen as a non-owner and require the label with no Change role button. With the flag off, require neither the label nor the button, and a role update returns 403 "Agent role changes are not available".
15. For `htpr-7529-mcp-act-as-agent`, from the owner's MCP connection, ensure one throwaway agent and then write one sandbox comment with `as_agent` set to that id. Require the write to be attributed to that agent. Repeat with an agent credential and require "An agent credential cannot act as another agent; use as_agent from a signed-in person's connection." With the flag off, require "as_agent is not switched on for this account yet."
16. For `htpr-7550-connect-overlay`, open the owner's seeded starter board before any real task and before any agent connection, with the first-task pointer on. Require the dialog Connect your agent and no MCP token until a client is chosen. Press Skip and require the dialog gone. With the flag off, require that dialog absent.
17. For `htpr-7577-add-existing-agent`, open `/settings/board-agents` on sandbox 7049. Require Add existing agent. Search the throwaway name, choose it, press Add, and require the toast that it was added. Reload and require the agent in the board list. With the flag off, require the button absent. Do not remove a pre-existing agent.
18. For `htpr-7582-agent-access-request`, from the throwaway agent, post a same-team request for sandbox 7049 to POST /api/mcp/agents/board-access-requests with a short reason. Open `/inbox?split=Decisions` as owner 985. Require the ask, Decline, and Approve. Approve and require the text that the agent was added as a member and that no role changed. A request for a board in another team must say it cannot be approved. With the flag off, require no new decision row. Do not approve a request for a board outside the QA sandbox.
19. For `htpr-8084-cross-team-agents`, follow the cross-team identities steps below. Also open Add existing agent on the second board and require the group title AVAILABLE AGENTS. With the flag off, require ON THIS TEAM and the unavailable reason "Agent belongs to another team".

### Hands-free drive on production

```bash
node .claude/skills/verify-qa/scripts/feature-map-drive.mjs agents-board-access --dir /tmp/feature-map-drive
```

Prints `PASS` or `FAIL` per step, writes `result.json` and screenshots into `--dir`, and ends with
`agents-board-access ok`. It refuses any base except `https://app.hypertask.ai`, uses the `qa-login` identities,
creates only fixtures its own cleanup removes, and never prints a cookie, token or email address.

## Gotchas

- Self-access returns only an admin-role error rather than actionable owner steps.
- MCP discards safe authorization reasons or leaks arbitrary unsafe text. Schema refusals do not prove unknown-message redaction.
- A superseded members effect closes over an older owned-agent list and overwrites the newer picker rows. PR 1847 ignores superseded answers behind `htpr-7574-invite-picker-latest-members`; repeat fresh-context checks after deployment.
- Source from the legacy modal is mistaken for reachable production UI or a flat picker is incorrectly failed for lacking legacy grouping.
- A screenshot is captured before requests finish, or a shrinking desktop viewport is mislabeled as a real phone context.
- Pixels alone are mistaken for persistence; an empty non-owner result is mistaken for exclusion proof.
- A second connection or a second completed task is treated as proof of the shared email. Each mail is sent once.
- `team_bound` true is read as a team id. The field is only a boolean.
- A page-title warning is treated as a failed create. The page is created, and the warning is extra.
- Change role on a native agent is expected. That button is omitted.
- `as_agent` from an agent credential or a management key is treated as a flag miss. Those credentials are refused even when the flag is on.
- Skip on the connect overlay is treated as a failed connect. Skip dismisses the dialog.
- Add existing agent is confused with creating an agent. It only attaches an agent the person already owns.
- Approve on an access request is expected to change the agent role. It adds a plain member only.
- AVAILABLE AGENTS is expected while `htpr-8084-cross-team-agents` is off. Off keeps ON THIS TEAM.

### What proof to collect

Write GATES.md first. Record deployment SHA/id/state, bootstrap status/id, effective flags, signed-in doctor screenshot, UI fixture creation and writer add, exact self-denial, owner cancel/remove/add and reload memberships, full redacted MCP envelope, and team API projection of ids/owner/boards/role. Save a per-attempt table and PNGs across every theme and viewport, with request settlement and fresh context ids. Render JSON tables to PNG with PIL, not ImageMagick @file. Preserve missing-row attempts and distinguish pre-judgment automation/bootstrap interruptions from feature outcomes.

Record command navigation to the register and the reachable No board group without asserting legacy labels. Name unreachable paths and closest alternatives. Follow verify-qa Feature map / Doctor / Run / Cases format, with PASS/FAIL/UNREACHABLE bullets pointing inside the new run folder. Never print or persist credentials, cookies, storage-state copies, traces, HAR, token screens, or raw credential-bearing responses. Read supplied acceptance criteria without fetching forbidden board 15; no ticket/GitHub writes or repository tests/builds/tsc/next.

### Cleanup

Delete only this run's recorded names/ids through owner detail **Archive or delete → Delete agent → confirmation**. Match DELETE by method and route family, because UUID detail URLs can canonicalize to slugs. Require HTTP 200 deletion and HTTP 404 detail for each, reload Agents and verify names absent, and confirm both ids absent from owned/team lists. Compare pre-existing ids against the baseline, accounting separately for automatic seeds. Do not delete default agents as throwaway fixtures or remove them just to restore the original list count; list reads can recreate them. Never revoke all tokens, alter other agents, change tasks, or write flags.

### Cross-team identities

For `htpr-8084-cross-team-agents`, use one throwaway QA-owned agent and two QA-owned sandbox boards in different teams. Record the agent ID once, add it to the first board, then add the same ID to the second through Board access. Reload both boards and verify the same identity in the mention results and assignment list. Pair this with a normal-account flag-off check, a foreign-team refusal, and a team-bound credential refusal. Never change a real lead's credentials or remove an existing identity.

An agent that enters cross-team use keeps its original team durably. Turning the rollout Off denies its later-team grants without promoting another board when the original board is removed. Cross-team conversations remain private to owner and agent permanently, including older history and notifications; rollback must never restore teammate chat access. Read, send, drafts, history, polling and broadcasts all need the paired owner-allowed / teammate-refused proof.

Mention results come from `GET /api/tasks/searchByParam?param=<name>&projectId=<board>`. Assignment options come from `GET /api/members/getAllForAssignees?projectId=<board>` (`boardAgents`). The board agent list uses `GET /api/agents/all?projectId=<board>`. Each must contain the same agent ID only after an explicit Accepted board grant. Never confuse a register candidate with an assigned board member. Team agent responses must not expose another team's boards or comment timestamps.

Use QA 985 for browser evidence. A specifically requested real-board check may use authorized read-only CLI/API surfaces, not the owner's browser or cookies. Record any inaccessible picker as UNREACHABLE, with the exact permission reason; an API membership record alone is not visual picker proof.

### Existing-agent login recovery

For HTPR-8861, use one recorded throwaway EXTERNAL agent owned by QA 985 on
sandbox board 7049. Never rotate a fleet lead or an existing QA watcher.

- Capture the existing Access key panel in Light, AMOLED and Graphite 2 before
  changing it. Revoke only this run's fixture. The old panel disables Generate a key.
- With `htpr-8861-agent-login-recovery` at Owner + QA, the same panel permits
  Generate a key for that revoked fixture. Record the unchanged agent ID and
  board grants; do not capture the displayed credential.
- Keep the new token in memory only. Verify `/api/mcp/hello` accepts it, and a
  previously issued token remains refused. Reload the owner detail: no plaintext
  token may return from the read API or remain visible after reload.
- An agent session and a different owner cannot issue a login. Removed team
  bindings must fail closed rather than issuing an unbound credential.
- CLI `agents rotate-token --id <fixture-id>` uses the same identity, with either
  an owner login or an authorized management key. Native `status` verifies the
  current credential with the server and exits nonzero for revoked logins;
  unreachable servers are unverified, not authenticated. `status` must not refresh.
- Native `update` checks public GitHub releases without sending Hypertask
  credentials. Authentication errors name the recovery page and commands.
- Keep the flag restricted until another runner completes visual QA. Clean up
  only this run's recorded fixture through its owner detail surface.
