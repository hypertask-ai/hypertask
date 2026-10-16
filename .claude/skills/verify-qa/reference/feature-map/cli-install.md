# CLI install commands

## How a customer reaches it

- Settings, CLI tab: `https://app.hypertask.ai/settings/cli` (`CliSection.tsx`).
- Command menu "Install CLI" opens `CliInstallModal`.
- Onboarding "connect your agent" step email and the guest demo board's CLI task (`completeOnboardingStep.ts`, `guestSeedTasks.ts`).
- `https://app.hypertask.ai/llms.txt` for AI agents.

Every surface reads `src/lib/onboarding/installCommands.ts`; the Windows note sits behind `htpr-7033-cli-install-command`.

## How to drive it

1. Shoot `/settings/cli` with `phone-shot.sh` (390x844) and at 1440x900 with the QA state; read the command text from the page, not the source.
2. `curl -fsS https://app.hypertask.ai/llms.txt` and check both commands.
3. Run the shown commands for real into a scratch folder: `HYPERTASK_INSTALL_DIR=<scratch> sh -c 'curl -fsSL https://hypertask.ai/install | sh'`, then `<scratch>/hypertask --version`. For Windows, run `irm https://hypertask.ai/install.ps1 | iex` in PowerShell (pwsh on Linux works with `HYPERTASK_INSTALL_DIR` set) and compare the exe's SHA-256 with the release `checksums.txt`.

## What usually breaks

- hypertask.ai serving the homepage HTML instead of the script (the installers live in the `hypertask-ai/astro` repo, `public/install.sh`, `public/install.ps1`, `_redirects`, `_headers`).
- A command without `https://`: curl and irm then start over plain HTTP (HTPR-7276 review).
- Test fixtures in `tests/fixtures/cli-install/legacy.json` holding the old command.

## What proof to collect

Settings CLI screenshots (desktop and phone, four themes when the layout changed), the llms.txt lines, and the install transcript with the version or checksum line.

## Cleanup

Delete the scratch install folders. Nothing is written to the board.
