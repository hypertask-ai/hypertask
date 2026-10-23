# CLI install commands and login

## How a customer reaches it

- Settings, CLI tab: `https://app.hypertask.ai/settings/cli` (`CliSection.tsx`).
- Command menu "Install CLI" opens `CliInstallModal`.
- Onboarding "connect your agent" step email and the guest demo board's CLI task (`completeOnboardingStep.ts`, `guestSeedTasks.ts`).
- `https://app.hypertask.ai/llms.txt` for AI agents.
- After install, `hypertask login --token <agent token>`; guided start uses `htpr-7519-login-guided-start` ([MCP hello checks](mcp-task-lookup.md)).

Install surfaces read `src/lib/onboarding/installCommands.ts`; the Windows note sits behind `htpr-7033-cli-install-command`.

## How to drive it

1. Shoot `/settings/cli` with `phone-shot.sh` (390x844) and at 1440x900 with the QA state; read the command text from the page, not the source.
2. `curl -fsS https://app.hypertask.ai/llms.txt` and check both commands.
3. Run the shown commands for real into a scratch folder: `HYPERTASK_INSTALL_DIR=<scratch> sh -c 'curl -fsSL https://hypertask.ai/install | sh'`, then `<scratch>/hypertask --version`. For Windows, run `irm https://hypertask.ai/install.ps1 | iex` in PowerShell (pwsh on Linux works with `HYPERTASK_INSTALL_DIR` set) and compare the exe's SHA-256 with the release `checksums.txt`.
4. With a QA agent of account 985 and a temporary `HOME`, run `hypertask login --token <agent token>` in default JSON and `--human` modes. Never print tokens. Require `signedInAs` / "Signed in as" to identify the agent name and "agent of <owner>", the newest board across all boards the token can see with its URL (not just the first 50; a missing title falls back to the short name), and the server's next steps: 3 for write agents, 2 for read-only agents (list and playbook, no create). With no board, `--human` must say "No board yet. Create one in your Hypertask web app." Require each login to finish within 5 s.
5. Repeat with a trailing slash in `--api-url`. The CLI waits at most about 1.5 s for the guide. Use a local failure/delay endpoint: any hello failure or no response within about 1.5 s must print the old saved output in both modes, exit 0 and keep the token saved. Do not point failure injection at production.
6. Reuse `node ~/.local/state/vcc-evidence/HTPR-7519/live-check.mjs` with env inputs `HT_QA_AGENT_TOKEN`, `CLI_BIN`, `API_URL` (API base including `/api`) and optionally `MCP_URL` (default `https://mcp.hypertask.ai/mcp`). It uses temporary homes, calls MCP `tools/list` with the same token, checks that each step tool and action is advertised, checks role-dependent step counts when the role is exposed (otherwise accepts 2 or 3 with list and playbook required), asserts each login finishes within 5 s, and runs only list/playbook reads. Never run the create step against production. The CLI prints the server's steps; with MCP v2 (on for Everyone), those advertise `hypertask_tasks` with `{"action":"list","input":{"project_id":ID}}` or `{"action":"create","input":{"project_id":ID,"title":"My first task"}}`, and `hypertask_projects` with `{"action":"playbook","input":{"project_id":ID}}`. Legacy catalogs retain the old tool names and top-level arguments. Check no-board, fallback and trailing-slash cases separately.

## What usually breaks

- hypertask.ai serving the homepage HTML instead of the script (the installers live in the `hypertask-ai/astro` repo, `public/install.sh`, `public/install.ps1`, `_redirects`, `_headers`).
- A command without `https://`: curl and irm then start over plain HTTP (HTPR-7276 review).
- Hello errors or timeouts turn a successful token save into a failed or hanging login.
- Test fixtures in `tests/fixtures/cli-install/legacy.json` holding the old command.

## What proof to collect

Settings CLI screenshots (desktop and phone, four themes when the layout changed), the llms.txt lines, and the install transcript with the version or checksum line. For login, collect redacted JSON/human output, exit status, elapsed fallback time and confirmation the token stayed saved, never its value.

## Cleanup

Delete the scratch install folders and temporary login homes. Nothing is written to the board.
