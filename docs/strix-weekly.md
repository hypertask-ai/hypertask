# Strix security checks

The installed runner performs two kinds of checks. Strix reviews source in a Docker sandbox on an internal network without public network access. A separate host process tests the live website, email-link login, OAuth approval, regular API, MCP and native CLI with the dedicated QA account. Credentials never enter the Strix sandbox or its model context.

## Run an assessment

```bash
bash ~/.local/lib/strix-runner/strix-assess.sh
```

The assessment uses fresh snapshots of the app production branch and the native CLI main branch. The five source profiles in `scripts/strix-assessment.json` cover browser sessions and login, OAuth, MCP, regular API authorization, and CLI credentials and HTTP handling. This is a defined security baseline. It does not cover every endpoint or replace a full penetration test.

Use `--live-only` for the browser and protocol checks, `--source-only` for Strix, or `--profile oauth --source-only` to repeat one source profile. Supported profiles are `browser-login`, `oauth`, `mcp`, `regular-api`, and `native-cli`.

Each live run checks valid credentials as well as rejection cases. A missing route or server error does not count as successful authentication enforcement. HTTP probes are sequential, spaced by 1.1 seconds and limited to 45 requests. Browser pages make their normal asset and application requests. Tests use the existing QA account and OAuth fixture. They do not send login emails, register users, approve a connector, change boards or test billing. Full Google sign-in, two-account object-access testing and destructive exploit checks remain outside this baseline.

The host uses the verification application's `app-auth.mjs` helper to obtain a short-lived QA session through the real email-link verification route. It keeps the signing material and tokens in memory. The CLI runs with a temporary empty home and the QA token, so it cannot fall back to personal credentials. Browser screenshots and results contain no session-token values.

## Scheduled checks and progress

Sunday at 03:00 Berlin time, `strix-scheduled.sh` runs the changed-source review and then the live checks, even if source review failed. The source job fetches the public app repository into its own bare repository. It never scans a developer's dirty checkout.

Reviews are divided into batches of at most 6 files or approximately 60 KB. A single larger file remains a whole batch. The entire clean repository stays available as read-only caller and test context. Each batch requests one reviewer beneath the required Strix coordinator and a $6 model cost estimate limit. The scheduled job reserves at most $30 across batches and stops after 45 minutes. These are subscription usage estimates, not a separate API purchase; Strix may finish an in-flight model request beyond the estimate. Assessment profiles each reserve up to $6, at most $30 for all five, with a one-hour overall timeout.

Completed batches keep their validated reports and do not run again on a retry. If the budget runs out, the job reports `pending` and retains the same source revision and remaining scope. New production changes wait until that scope completes. A failed batch never advances the last-success revision. Retries use new output directories, so earlier evidence remains intact. Batches that fail repeatedly need investigation; a pending or failed run is never a clean security result.

Strix exit code 2 means findings, not necessarily completion. Every batch must have completed metadata, a report and an explicit `COVERAGE_COMPLETE` statement. Reports admitting incomplete coverage fail validation. This checks report consistency, not whether the model truly examined every line.

Medium and higher source findings require two confirmation calls with source, callers and test context before filing through Product Bot on board 15. These are separate model judgments, not independent exploit reproductions. Confirmation and filing failures keep the batch incomplete. If Strix omits the structured findings file, the reporter extracts candidates from its written report before confirmation. It retains extracted claims and both judgments alongside the report. Small referenced source files are supplied in full so omitted code cannot decide an absence claim. Live-check failures remain in the report for investigation; they are not automatically filed as new vulnerabilities.

## Results

- `~/.local/state/strix/assessment/latest.json` points to the latest assessment and its profile statuses.
- `~/.local/state/strix/live/latest.json` records scheduled or standalone live checks.
- Each assessment keeps `assessment.json`, `live/live-results.json`, browser screenshots and source profile reports.
- `~/.local/state/strix/weekly/latest.json` records source-job status, revision, exit code and output directory.
- Each source job keeps `coverage.json`, exact file lists, per-batch logs and Strix reports.

Assessment exit 0 means the requested checks completed without failed live assertions; exit 2 means live checks completed with failures; exit 1 means incomplete or blocked execution. Source-job exit 3 means more batches remain. Always read the reports for source findings, even after exit 0. Zero confirmed findings is not proof that the application is secure.

## Install and verify

The host needs the installed Strix CLI, Docker, Node, Python, Git, `hypertask`, `htbot`, an installed copy of the verification application's authentication helper and Playwright dependencies and the existing `strix-chatgpt-proxy.service`. The proxy runs on loopback port 48100 using the existing ChatGPT subscription. Its maintained source is in the private agent-fleet repository. The sandbox image is pinned to `ghcr.io/usestrix/strix-sandbox:1.1.0` with 6 GB memory, 3 CPUs and 512 processes. Cleanup removes only containers on the current run's unique network.

```bash
python3 scripts/test-strix-runner.py
node --test tests/strix-weekly.test.cjs tests/strix-file-tickets.test.cjs
bash scripts/install-strix-runner.sh
```

Keep the existing unapproved test connector's nonsecret `clientId` and `redirectUri` in `~/.config/strix/oauth-fixture.json`. A missing fixture is reported as blocked; the runner never silently creates one. The installer copies the helper and Playwright dependencies outside the development checkout. It does not change credentials or cron. Set `STRIX_VERIFY_SOURCE` if the verification checkout is elsewhere.

```cron
0 3 * * 0 /bin/bash /home/valentin/.local/lib/strix-runner/strix-scheduled.sh >> /home/valentin/.local/state/strix/weekly/cron.log 2>&1
```

```bash
env -i HOME="$HOME" USER="$USER" PATH=/usr/bin:/bin /bin/bash "$HOME/.local/lib/strix-runner/strix-assess.sh" --live-only
```

Controlled overrides include `STRIX_STATE`, `STRIX_REPO`, `STRIX_REF`, `STRIX_DIFF_BASE`, `STRIX_BUDGET`, `STRIX_BATCH_BUDGET`, `STRIX_BATCH_FILES`, `STRIX_BATCH_TIMEOUT`, `STRIX_TIMEOUT` and `STRIX_SCAN_MODE` for source jobs. Assessment also accepts `STRIX_ASSESSMENT_STATE`, `STRIX_PROFILE_BUDGET` and `STRIX_ASSESSMENT_TIMEOUT`. Host integration paths can be set with `STRIX_AUTH_HELPER`, `STRIX_PLAYWRIGHT_MODULE`, `STRIX_BROWSER`, `STRIX_CLI` and `STRIX_OAUTH_FIXTURE`.

The [Strix CLI documentation](https://docs.strix.ai/) describes the underlying scanner. The repository scripts define Hypertask's narrower scope and reporting rules.
