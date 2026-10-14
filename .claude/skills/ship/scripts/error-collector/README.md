# Error collector core

Node 24 ESM; no npm packages. Default sources: `vercel`, `vercel-5xx`, `github-actions`, `vps-journal`, `cloudflare-workers`, `posthog`, `neon`. The fixture source is opt-in.

## Run and test

From the repository root:

```sh
bash .claude/skills/ship/scripts/error-collector.test.sh
# If node on PATH is not Node 24:
NODE=/path/to/node24 bash .claude/skills/ship/scripts/error-collector.test.sh
ERROR_COLLECTOR_FIXTURE=/path/to/events.json node .claude/skills/ship/scripts/error-collector/collector.mjs --once --sources fixture --dry-run --summary
```

Tests have a private HOME and fake `vcc`, `ht`, `systemctl`, and `runner-deliver`; they cannot reach the real commands. Optional test suites: `sources`, `tickets`, `reporting`, `install`.

`--once` runs one collection pass (also the default). `--sources` selects comma-separated module names; without it the seven production sources above run. `--dry-run` permits only `ht GET` reads, prints planned writes/descriptions, and does not create or change state, locks or temporary files. `--summary` forces the daily summary before 06:00 UTC, without duplicating an already sent daily service line.

## Install (operator action, not done by tests)

```sh
node .claude/skills/ship/scripts/error-collector/collector.mjs --install
```

Copies collector, sources, noise and unit templates to `~/.local/lib/hypertask/error-collector/`, installs user units under `~/.config/systemd/user/`, and runs `systemctl --user daemon-reload` and `enable --now error-collector.timer`. It is safe to rerun the installed collector's installer. Requires Node 24 on the service PATH, `flock`, `ht`, and an authorized `vcc` identity. The timer is persistent and runs every fifteen minutes; the CLI also serializes real manual runs with flock.

Optional `~/.config/hypertask-agents/error-collector.env` supplies `ERROR_COLLECTOR_STATE_DIR` (isolates state without changing authentication HOME), `ERROR_COLLECTOR_FIXTURE`, `ERROR_COLLECTOR_HOURLY_CAP` (default 5; zero pauses creation), or a PATH containing Node 24 and the CLI tools. Keep it private; acquire API credentials through `stack-key` and never print credentials. Source credentials are obtained in memory through `stack-key`, except Neon's private read-only login file; provider response bodies and CLI errors are never logged.

Production writes only go through `vcc`. The collector asks for native CLI JSON (`vcc --json task create`); it requires `success: true` and a valid `task.ticketNumber`. Board 15 uses `Bugs`. Board 4060 reads `ht GET /mcp/projects/4060/sections` before creation and selects active `Backlog`, otherwise `To Do`/`Todo`; on 2026-10-14 the live intake was **Backlog, section 10414**. If none exists, the group stays pending rather than guessing another column.

## Source contract

Add `sources/<name>.mjs`, exporting `name` and `async fetch({ since, until, env })`. Stateless sources return an array of `{ service, board: 15 | 4060, message, route, stack, ts, count, ticket? }`. `ts` is an ISO timestamp, `count` defaults to 1; route/stack may be omitted. `ticket: false` counts in service summaries but never enters grouping, fingerprint searches or ticket creation. The fixture reads the JSON array at `env.ERROR_COLLECTOR_FIXTURE`.

Stateful sources receive an optional `cursor` payload and return `{ events: [...], cursor: <JSON payload> }`. The payload is capped at 4096 serialized bytes, is copied before fetching, and is saved in `sourceCursors` alongside the timestamp only after fetch/event validation succeeds. Existing array sources and timestamp cursors remain compatible. Dry runs read the payload but never persist its replacement. Never put credentials or raw provider responses in a cursor.

Windows are `(since, until]`, per source, capped at the last 24 hours. Fetch/validation failures leave that source's cursor unchanged and do not stop other sources. A fingerprint's service/route must always route to the same board (the required fingerprint excludes board); conflicting routing fails that source. All-failed exits 1; at least one successful source exits 0, even if reporting fails and remains pending.

The whole run has a twelve-minute deadline, below the unit's fourteen-minute limit. Source reads and reporting commands share the remaining budget. Each successful source checkpoints its counters, pending groups and cursor before the next source starts. An interrupted or unreached source keeps its cursor and retries next run.

## State and retries

Private `~/.local/state/error-collector/state.json` is atomically replaced and fsynced. It has `sources` timestamp cursors, optional `sourceCursors` payloads, `fingerprints` ticket records, durable `pending` groups, rolling-hour `created` reservations, per-ticket `activities`, and UTC `days`/`summaries` retained for fourteen days. Pending counts and routes accumulate without recounting successful windows. `newGroups` counts newly observed kinds, even if held by the cap.

All three task statuses (Normal, Archive, Deleted) are searched with a project filter and pagination before creation. Only exact description markers are adopted. Deleted matches never receive activity. Failed/incomplete searches fail closed. Creation attempts reserve a cap slot **before** the external write: an ambiguous failure conservatively consumes a slot for one hour, and the pending group reconciles its marker next run. This prevents a failed receipt or interrupted process from causing a ticket flood. As with the watcher, there is no cross-system exactly-once transaction; a complete successful search is required before retrying an unresolved create.

Known-group counts and routes accumulate until at most one activity per ticket per six hours is due; activity lists up to three new routes, trimmed to 120 characters each. Failed activities and summaries retry. Summaries post once per UTC day per service (after 06:00, or forced), including successful quiet sources with zero errors. Retained unsent completed days retry oldest first, at most three days per run. Errors exclude separately counted noise. Spikes require complete collected coverage for both UTC days. Continuous source coverage is stored in `coverage`, and each service/day counter records `complete`. Initial partial days, legacy counters without coverage proof, and skipped intervals after gaps over 24 hours cannot be spike baselines. Spike threshold: today > 3 × yesterday and today >= 50. `runner-deliver ht-product-lead` accepts the line on stdin with a daily/service id; when absent or failing, a private `spikes.log` records it.

Sample text, stacks, routes and titles are redacted before reporting or persistence; HTML is escaped and stacks are capped at forty lines. Command output and source exceptions are never logged. `noise.json` rules operate on the raw message and route and can be scoped by service; scanner paths, client aborts and explicit expected 401/403/404 responses are preseeded.


## Forced test errors (YPER4-384)

A test that throws an error on purpose in production puts `[ht-forced-test]` in the error message, for example `throw new Error("[ht-forced-test] YPER4-384 forced browser test 1")`. The collector counts it as noise for every source and prints `skipped forced test error`; the native PostHog issue writer (`.github/scripts/posthog-error-issues.mjs`) returns `skip` and files nothing. An error without the marker still becomes a ticket. The nightly `PostHog pipeline canary` keeps its own rule: it must file and then close its ticket to prove the pipeline works.

## Live read paths and bounds

- Vercel: Messages starting with `[email-event]` (Resend bounces and failed sends, YPER4-359) use service `email` and board 4060. Read-only POST `/v1/observability/events`, production runtime errors and proxy 5xx, board 15 except runtime timeouts, the /sse runtime route and dead outgoing webhooks (`[board-webhook]`/`[agent-webhook] delivery failed ...`, one log line per delivery that used up its retries, YPER4-358) on board 4060. Limit 500, cursor paging, exact record dedupe; 30 pages/window and 120 requests/source. HTTP 413 bisects the window; retention HTTP 400 advances the start ten minutes with an explicit coverage warning (counts are lower bounds). HTTP 429 stops the source. Truncated/excluded-interval responses fail closed. Structured message/error details survive; timestamp/correlation envelopes and Prisma input dumps do not become the cause.
- GitHub: `gh run list --json` on production plus scheduled runs, failure and timed_out; finished timestamps select the collection window. A 35-day creation lookback covers GitHub's maximum workflow lifetime, bounded at 10,000 runs/list and 20 `gh run view --json jobs` lookups. Newest runs get job lookups; the remainder use workflow names so the whole window advances. Board 4060.
- VPS: priority err user and readable system journals, grouped per UTC day, unit and normalized message; journal cursors dedupe overlapping user/system records. Own `error-collector.service` records excluded. Unreadable system journal is an explicit partial-coverage warning. Board 4060. Failed units without priority-err log entries are not measured.
- Cloudflare: uniquely named Hypertask account from GET `/accounts`, then read-only GraphQL `workersInvocationsAdaptive`, bounded at 10,000 rows. Execution-error counts per UTC day and worker, board 4060; queries split at midnight using (since, until] boundaries. Analytics may be sampled/estimated. No edge HTTP 4xx, DNS-site traffic or zone HTTP traffic is fetched or ticketed.
- Neon: two read-only HTTPS SQL POSTs to the database host's `/sql`, calling only `ops_stats.slow_queries(min_mean_ms, 50)` and `ops_stats.db_counters()` as `stats_reader`. The login URL lives in `~/.local/state/error-collector/neon-stats.url` (mode 600), overridden by `NEON_STATS_URL_FILE`; it is never logged or persisted in collector state. Slow queries use `NEON_SLOW_QUERY_MS` (default 1000 ms mean), at most 50 rows with normalized query text capped at 500 characters. Stable messages contain the query only; cumulative calls/mean/max/total go in the stack, with one observation per query per run at `until` (not window-only execution counts). Counter snapshots retain exact bigint strings: any deadlock/conflict increase alerts, rollbacks alert only above `NEON_ROLLBACK_ALERT` (default 500 per reading window). First readings, changed `stats_reset` or any decreasing counter establish a baseline without counter events. The snapshot and timestamp advance together only on success; dry runs write neither. Board 4060, service `neon`. SQL error TEXT is not available from Neon on this plan; app-side SQL errors already arrive through the Vercel source as Prisma errors.
- PostHog: EU HogQL production-only aggregate `$exception` query (explicit ht_environment production, or absent ht_environment and production app URL), distinct browser/server projects, bounded at 10,000 rows/project; summary-only, because the native PostHog issue alert (`.github/workflows/posthog-error-alert.yml`, not only `src/lib/telemetry/posthogErrorAlert.ts`) already files one Bugs ticket per new browser or server issue (YPER4-377). Aggregate events use last-seen timestamps; an issue spanning midnight is counted on its last-seen day.

`fixtures/recorded.json` contains sanitized actual research/live read responses; `fixtures/sources.json` contains synthetic edge cases; `fixtures/h1-groups.json` preserves all 166 research classifications and counts. Noise rules are intentionally narrow and service-scoped. The Forbidden create refusal follows h1's NOISE classification even though its documented HTTP 500 mapping is a separate response-classification defect. No h1 group was reclassified.

Dry runs print source windows/counts and daily per-service counters in addition to proposed writes. They still perform read-only marker searches, obey the hourly cap, and do not persist state. Use a fresh `ERROR_COLLECTOR_STATE_DIR` for an isolated 24-hour run. Never run the installer or omit `--dry-run` against live services without separate authorization.
