# Weekly Strix source review

The Sunday 03:00 host cron runs an installed copy of `scripts/strix-weekly.sh` at `~/.local/lib/strix-runner/`. It uses the existing ChatGPT subscription through the loopback proxy on port 48100. This is a source review of changes since the last successful scan. It does not test the live browser, login flow, or production API.

The runner fetches the public repository's `production` branch into its own bare repository and checks out the exact revision in a private run directory. The first run reviews the preceding seven days. Later runs resume from the last successful revision. The snapshot is mounted read-only in the sandbox. This avoids Strix copying thousands of files one at a time. Developer checkouts, untracked files and local credentials are not copied.

Each run has its own Docker network, output directory and log. The sandbox has a 6 GB memory limit, 3 CPUs and 512 processes. A run stops after 45 minutes or a $30 model cost estimate. That estimate bounds subscription usage; it is not a separate API purchase. The runner removes only containers on its own network.

A successful exit from Strix is insufficient. The runner requires one report in its own output directory, completed run metadata, and an explicit statement that the requested scope was reviewed. Reports that admit incomplete coverage fail. This checks the report's consistency; it cannot independently prove that the model reviewed every line.

Findings need two confirmation checks before filing on board 15. Filing uses `htbot`, the approved Product Bot wrapper. It never loads a personal token or assigns Valentin. Confirmation or filing errors fail the job and retain the previous baseline. Successfully filed titles are saved immediately so a later retry does not duplicate them.

Install the three scripts together:

```bash
install -d -m 700 "$HOME/.local/lib/strix-runner" "$HOME/.local/state/strix/weekly"
install -m 700 scripts/strix-weekly.sh scripts/strix-check-run.py scripts/strix-file-tickets.py "$HOME/.local/lib/strix-runner/"
```

The proxy is maintained in the private `agent-fleet` repository under `tools/strix-chatgpt-proxy`. Install its tested source outside a developer checkout and point the user service at that installed file. The proxy's six stream regressions cover duplicate calls, missing argument deltas, completed-only events, repeated completion events, ID aliases and contiguous indexes.

Host cron entry:

```cron
0 3 * * 0 /bin/bash /home/valentin/.local/lib/strix-runner/strix-weekly.sh >> /home/valentin/.local/state/strix/weekly/cron.log 2>&1
```

Verify cron's environment manually:

```bash
env -i HOME="$HOME" USER="$USER" PATH=/usr/bin:/bin /bin/bash "$HOME/.local/lib/strix-runner/strix-weekly.sh"
```

Read `~/.local/state/strix/weekly/latest.json` for the final status, revision, exit code and report directory. Each run retains `runner.log`, `changed-files.txt`, the source revision and Strix reports. A failed run never advances `last-success`. There is no automatic claim that zero findings means the application is secure.

Overrides for controlled diagnostics are `STRIX_STATE`, `STRIX_REPO`, `STRIX_REF`, `STRIX_DIFF_BASE`, `STRIX_BUDGET`, `STRIX_TIMEOUT`, `STRIX_SCAN_MODE` and `STRIX_IMAGE`. Normal cron needs none. Run `python3 scripts/test-strix-runner.py` to exercise success, failures, incomplete reports, cleanup, source isolation and agent-only filing without network access or real board writes.
