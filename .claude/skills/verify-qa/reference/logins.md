# QA logins

Pass the state file with `--state`. Never print the file. Pick the account for the permission, plan or flag path being checked; the flag QA account is not an admin.

| Type | User id | State file | Use for | Refresh expired login |
|---|---|---|---|---|
| Owner + QA flags | 985 | `~/.config/hypertask-videos/storageState-qa.json` | Flagged path and doctor shot, not admin pages | `/qa/login` with configured QA credentials, then save state to this path. Never use ordinary email login for this shared address. |
| Plain customer | 2343 | `~/.config/hypertask-videos/storageState-qa-normal.json` | Flag-off path | Email-code login below: `valentin+qa-normal@hypertask.ai` |
| Free | 3411 | `~/.config/ht-qa/state-free.json` | Free limits and upgrade prompts; keep on Free | Runner `scripts/login.mjs --tier free` |
| BYOK | 3412 | `~/.config/ht-qa/state-byok.json` | BYOK settings and AI with a saved, enabled `gateway` key | Runner `scripts/login.mjs --tier byok` |
| Pro | 3413 | `~/.config/ht-qa/state-pro.json` | Pro AI and paid-plan access | Runner `scripts/login.mjs --tier pro` |
| Team owner | 4036 | `~/.config/ht-qa/state-owner.json` | Owns **QA Team Board**, board 7283 | Email-code login below: `valentin+qa-owner@hypertask.ai` |
| Team member | 4037 | `~/.config/ht-qa/state-member.json` | Invited member of **QA Team Board**, board 7283; not its owner | Email-code login below: `valentin+qa-member@hypertask.ai` |
| Guest | None | None, use a fresh context | Logged-out demo and signup paths | No login |
| Admin | 6 | None permitted | **Not testable by agents: Valentin checks admin pages himself** | Never use or create an admin login |

Never test revoke-all on QA account 2343: it runs the MCP watcher. Use 985 instead.

Before a plan check run `.claude/skills/verify-qa/scripts/qa-teams` (read-only health line per test team; see `reference/feature-map/billing-and-plans.md`, "Test teams for every plan").

BYOK team `977c0c91-c14f-47b0-b8bc-933cc751f19d` and Pro team `2ce0d9f8-4179-489d-bbce-2b0e197f8067` are comped on their respective plans until 2027-10-03. Select that team when checking its plan. The shared owner/member fixture is in team `da1f255e-7686-4585-afa3-e1da3e6507a8`, at `https://app.hypertask.ai/projects/project-7283`.

**Refresh:** use `~/projects/hypertask-qa-runner/scripts/login.mjs`. For a tier, run `node scripts/login.mjs --tier <tier>` there to request a code, then repeat with `--code <code>`. For plain/owner/member, set `HT_QA_ACCOUNT_EMAIL` to the table's address and `HT_QA_ACCOUNT_STATE_PATH` to its expanded state path for both calls, omitting `--tier`. Read only that QA address's new login email via the runner's `lib/gmail-code.mjs` (`gws` over `ssh hetzner`, documented in its README); pass the code privately, never print it or read other mail. Save all states with mode `0600`. The daily runner refresh covers only free/byok/pro, not the other accounts.

After refresh, require HTTP 200 from authenticated `POST /api/app-shell/bootstrap` and verify `slices.user.data.id` matches the table before using the state. Check plans with `.claude/skills/verify-qa/scripts/qa-teams` (it uses `POST /api/teams/getAllMinimal`, which returns less than `getAllSidebar`); check BYOK's saved key with `GET /api/teams/byokKeys?teamId=977c0c91-c14f-47b0-b8bc-933cc751f19d` (`gateway`, `enabled: true`, `hasSecret: true`). For member tests, require the shared board in that user's sidebar, not their personal board.

Never use Valentin's account, password, or cookies. If the shot is a login page, first run `.claude/skills/verify-qa/scripts/qa-identity <state> --expect <id from the table>` (YPER4-607, https://app.hypertask.ai/detail/project-4060/607). `identity ok` means the tool did not load the state: fix the tool call with `phone-shot.sh` or Playwright `storageState`; do not refresh or tell other runners the login expired. Only `identity expired` means refresh that one identity through the documented flow. For `identity mismatch` or `identity unreadable`, record a failed doctor and stop to resolve the identity or read failure, not refresh. If its credentials are unavailable, record it as unreachable. Do not invent a login.

