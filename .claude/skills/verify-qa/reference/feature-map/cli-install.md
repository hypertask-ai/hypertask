# CLI install commands and login

## Sub-features

- `cli-install-commands-and-login` CLI install commands and login.
- `team-scoped-management-keys` With `htpr-6542-team-scoped-management-keys` on, Settings > Connect > Management keys can limit a new Management or Usage key to one team. Whole-account keys keep account-wide access. Full access stays whole-account only.

## How to get to it (user POV)

- Settings, Connect, CLI: `https://app.hypertask.ai/settings/cli` (`CliSection.tsx`); the nav entry lives under the Connect group (`settingsNavigation.ts`).
- Command menu "Install CLI" opens `CliInstallModal` (`#cliInstallModal`).
- Onboarding "connect your agent" step email and the guest demo board's CLI task (`completeOnboardingStep.ts`, `guestSeedTasks.ts`) print the same install command, but the onboarding text still tells the reader bare `hypertask login` does not sign in and prescribes `hypertask login --token <agent token>`. The Settings page and the modal both say `hypertask login` opens the browser to authorize; that is the shipped path today.
- `https://app.hypertask.ai/llms.txt` for AI agents: `curl -fsSL https://hypertask.ai/install | sh`, then `hypertask login`, plus the PowerShell line.
- After install the CLI signs in with `hypertask login` (browser authorize) or `hypertask login --token <agent token>` for agents; guided start uses `htpr-7519-login-guided-start` ([MCP hello checks](mcp-task-lookup.md)).
- Settings, Connect, Management keys: `https://app.hypertask.ai/settings/management-keys` (`src/components/Modals/Settings/ManagementKeysSection.tsx`). Create and list use `GET /api/mcp/admin/keys` and `POST /api/mcp/admin/keys`; revoke uses `DELETE /api/mcp/admin/keys`.

The Windows note is printed by `llms.txt` and by Settings while
`htpr-7033-cli-install-command` is on. The Ctrl+K modal does not print it.

Install surfaces read `src/lib/onboarding/installCommands.ts`; the Windows note sits behind `htpr-7033-cli-install-command`.

## Driving it with agent-browser

1. Shoot `/settings/cli` with `phone-shot.sh` (390x844) and at 1440x900 with the QA state. Read the visible text, not the source: the page shows `curl -fsSL https://hypertask.ai/install | sh`, `hypertask login`, `Windows (PowerShell): irm https://hypertask.ai/install.ps1 | iex` while `htpr-7033-cli-install-command` is on, and `Read the CLI docs`.
2. `curl -fsS https://app.hypertask.ai/llms.txt | sed -n '11,12p'` shows the same two commands plus the Windows line.
3. Open Ctrl+K, type `install cli`, open the `Install CLI` row. `#cliInstallModal` shows `Hypertask CLI`, `1. Install`, `2. Sign in`, and `Opens your browser to authorize the CLI for your account.` The two commands sit in read-only inputs (`.value`), so read the inputs, not `innerText`. The modal has no Windows line.
4. Run the shown command for real into a scratch folder: `HYPERTASK_INSTALL_DIR=<scratch> sh -c 'curl -fsSL https://hypertask.ai/install | sh'`, then `<scratch>/hypertask --version`. Verified 2026-11-20: `hypertask 0.2.68 (zig)`.
5. `ht-verify flags show htpr-7033-cli-install-command` and `ht-verify flags show htpr-6542-team-scoped-management-keys` confirm the modes before judging the screens.
6. With `htpr-6542-team-scoped-management-keys` on, open `/settings/management-keys`: the `CREATE KEY` form has Scope (Management, Usage, Full access) and Team (`Whole account` plus each team). Choosing a team disables Full access. Do not create a key on a shared account.
7. With a QA agent of account 985 and a temporary `HOME`, run `hypertask login --token <agent token>` in default JSON and `--human` modes. Never print tokens. Require `signedInAs` / "Signed in as" to name the agent and "agent of <owner>", the newest visible board with its URL, and 3 next steps for a write agent or 2 (list and playbook, no create) for a read-only agent; no board prints "No board yet. Create one in your Hypertask web app." and each login finishes within 5 s.
8. Repeat with a trailing slash in `--api-url`, and test failure injection only against a local endpoint: a hello failure or no response within about 1.5 s must print the saved output, exit 0 and keep the token saved. Never point failure injection at production, and never run the create step there.
9. The hosted guided-start checker is `node ~/.local/state/vcc-evidence/HTPR-7519/live-check.mjs` with `HT_QA_AGENT_TOKEN`, `CLI_BIN`, `API_URL` (including `/api`) and optional `MCP_URL`. It uses temporary homes, calls MCP `tools/list`, requires the advertised `hypertask_tasks` list/create actions and `hypertask_projects` playbook, and runs only list/playbook reads.

## Gotchas

- hypertask.ai serving the homepage HTML instead of the script (the installers live in the `hypertask-ai/astro` repo, `public/install.sh`, `public/install.ps1`, `_redirects`, `_headers`).
- A command without `https://`: curl and irm then start over plain HTTP (HTPR-7276 review).
- Hello errors or timeouts turn a successful token save into a failed or hanging login.
- Test fixtures in `tests/fixtures/cli-install/legacy.json` holding the old command.
- A team-limited key (`httk_`), or an agent token that carries a team id, is refused while `htpr-6542-team-scoped-management-keys` is off.
- The Settings page, the Ctrl+K modal and `llms.txt` all print bare `hypertask login`, while the onboarding agent step (HTPR-7549 flag) says bare login does not sign in and prescribes `--token`. Treat the Settings/modal text as shipped and the onboarding sentence as a product copy gap.

### What proof to collect

Settings CLI screenshots (desktop and phone, four themes when the layout changed), the llms.txt lines, and the install transcript with the version or checksum line. For login, collect redacted JSON/human output, exit status, elapsed fallback time and confirmation the token stayed saved, never its value.

### Cleanup

Delete the scratch install folders and temporary login homes. Nothing is written to the board.
