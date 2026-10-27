# Error collector core

Node 24 ESM; no npm packages. Default sources: `vercel`, `vercel-5xx`, `realtime`, `github-actions`, `vps-journal`, `cloudflare-workers`, `posthog`, `neon`. The fixture source is opt-in.

## Run and test

From the repository root:

```sh
bash .claude/skills/ship/scripts/error-collector.test.sh
# If node on PATH is not Node 24:
NODE=/path/to/node24 bash .claude/skills/ship/scripts/error-collector.test.sh
ERROR_COLLECTOR_FIXTURE=/path/to/events.json node .claude/skills/ship/scripts/error-collector/collector.mjs --once --sources fixture --dry-run --summary
```

Tests have a private HOME and fake `vcc`, `ht`, `systemctl`, and `runner-deliver`; they cannot reach the real commands. Optional test suites: `sources`, `tickets`, `reporting`, `install`.

`--once` runs one collection pass (also the default). `--sources` selects comma-separated module names; without it the eight production sources above run. `--dry-run` permits only `ht GET` reads, prints planned writes/descriptions, and does not create or change state, locks or temporary files. `--summary` forces the daily summary before 06:00 UTC, without duplicating an already sent daily service line.

## Read production logs by hand (YPER4-400)

`vercel logs` (and `vercel-ht logs`) fails from the VPS with 403: the CLI reads from `vercel.com/api/logs/request-logs`, and Vercel's bot protection answers every vercel.com request from this IP with `x-vercel-mitigated: challenge`. `api.vercel.com` is not challenged, so read logs through the same observability API and `stack-key` credentials as the collector:

```sh
node .claude/skills/ship/scripts/error-collector/vercel-logs.mjs --since 10m -n 5
node .claude/skills/ship/scripts/error-collector/vercel-logs.mjs --since 2h --level error --path /api/ai/chat/stream --search Allowance
```

It prints one JSON line per log entry (newest first: timestamp, level, method, path, deployment, message), production only. `--since` takes `30s`, `10m`, `2h`, `1d` or an ISO time; `-n` 1 to 500 (default 50); `--level` is `error`, `warn` (Vercel's name; `warning` is accepted) or `info`; `--search` matches message text locally. Messages can contain user data: quote only what a ticket needs.

## Install (operator action, not done by tests)

```sh
node .claude/skills/ship/scripts/error-collector/collector.mjs --install
```

Copies collector, sources, noise and unit templates to `~/.local/lib/hypertask/error-collector/`, installs user units under `~/.config/systemd/user/`, and runs `systemctl --user daemon-reload` and `enable --now error-collector.timer`. It is safe to rerun the installed collector's installer. Requires Node 24 on the service PATH, `flock`, `ht`, and an authorized `vcc` identity. The timer is persistent and runs every fifteen minutes; the CLI also serializes real manual runs with flock.

Optional `~/.config/hypertask-agents/error-collector.env` supplies `ERROR_COLLECTOR_STATE_DIR` (isolates state without changing authentication HOME), `ERROR_COLLECTOR_FIXTURE`, `ERROR_COLLECTOR_HOURLY_CAP` (default 5; zero pauses creation), `ERROR_COLLECTOR_STALE_HOURS` (default 2; positive finite hours, zero/invalid values fall back to 2), or a PATH containing Node 24 and the CLI tools. Keep it private; acquire API credentials through `stack-key` and never print credentials. Source credentials are obtained in memory through `stack-key`, except Neon's private read-only login file; provider response bodies and CLI errors are never logged.

Production writes only go through `vcc`. The collector asks for native CLI JSON (`vcc --json task create`); it requires `success: true` and a valid `task.ticketNumber`. Board 15 uses `Bugs`. Board 4060 reads `ht GET /mcp/projects/4060/sections` before creation and selects active `Backlog`, otherwise `To Do`/`Todo`; on 2026-10-14 the live intake was **Backlog, section 10414**. If none exists, the group stays pending rather than guessing another column.

## Source contract

Add `sources/<name>.mjs`, exporting `name` and `async fetch({ since, until, env })`. Stateless sources return an array of `{ service, board: 15 | 4060, message, route, stack, ts, count, ticket? }`. `ts` is an ISO timestamp, `count` defaults to 1; route/stack may be omitted. `ticket: false` counts in service summaries but never enters grouping, fingerprint searches or ticket creation. The fixture reads the JSON array at `env.ERROR_COLLECTOR_FIXTURE`.

Stateful sources receive an optional `cursor` payload and return `{ events: [...], cursor: <JSON payload> }`. The payload is capped at 4096 serialized bytes, is copied before fetching, and is saved in `sourceCursors` alongside the timestamp only after fetch/event validation succeeds. Existing array sources and timestamp cursors remain compatible. Dry runs read the payload but never persist its replacement. Never put credentials or raw provider responses in a cursor.

Windows are `(since, until]`, per source, capped at the last 24 hours. Fetch/validation failures leave that source's cursor unchanged and do not stop other sources. A fingerprint's service/route must always route to the same board (the required fingerprint excludes board); conflicting routing fails that source. All-failed exits 1; at least one successful source exits 0, even if reporting fails and remains pending.

The whole run has a twelve-minute deadline, below the unit's fourteen-minute limit. Source reads and reporting commands share the remaining budget. Each successful source checkpoints its counters, pending groups and cursor before the next source starts. An interrupted or unreached source keeps its cursor and retries next run.

## State and retries

Private `~/.local/state/error-collector/state.json` is atomically replaced and fsynced. It has `sources` timestamp cursors, optional `sourceCursors` payloads, `fingerprints` ticket records, durable `pending` groups, redacted trailing-hour `noiseWindows`, rolling-hour `created` reservations, per-ticket `activities`, and UTC `days`/`summaries` retained for fourteen days. Pending counts and routes accumulate without recounting successful windows. After marker reconciliation, groups that would create a ticket but were last seen more than `ERROR_COLLECTOR_STALE_HOURS` ago (default two hours; invalid/nonpositive values use the default) move to a separate `stale` map, retained for fourteen UTC days. A nondeleted ticket on the same board sharing a nonempty route receives a separately counted stale sighting through the existing six-hour activity throttle; ticket totals/last-seen remain based only on fingerprint records. Otherwise the disposition day's summary counts the group as "stale, not filed" without a ticket reference. Older/equal sightings are ignored; a strictly newer event removes the stale record and carries its aliases through normal grouping, thresholds and cap. Unfiled warnings must meet their normal hourly threshold again.

All three task statuses (Normal, Archive, Deleted) are searched with a project filter and pagination before creation. Only exact description markers are adopted. Deleted matches never receive activity. Failed/incomplete searches fail closed. Creation attempts reserve a cap slot **before** the external write: an ambiguous failure conservatively consumes a slot for one hour, and the pending group reconciles its marker next run. This prevents a failed receipt or interrupted process from causing a ticket flood. As with the watcher, there is no cross-system exactly-once transaction; a complete successful search is required before retrying an unresolved create.

Known-group counts and routes accumulate until at most one activity per ticket per six hours is due; activity lists up to three new routes, trimmed to 120 characters each. Failed activities and summaries retry. Summaries post once per UTC day per service (after 06:00, or forced), including successful quiet sources with zero errors. Retained unsent completed days retry oldest first, at most three days per run. Errors exclude separately counted noise. Spikes require complete collected coverage for both UTC days. Continuous source coverage is stored in `coverage`, and each service/day counter records `complete`. Initial partial days, legacy counters without coverage proof, and skipped intervals after gaps over 24 hours cannot be spike baselines. Spike threshold: today > 3 × yesterday and today >= 50. `runner-deliver ht-product-lead` accepts the line on stdin with a daily/service id; when absent or failing, a private `spikes.log` records it.

Sample text, stacks, routes and titles are redacted before reporting or persistence; HTML is escaped and stacks are capped at forty lines. Command output and source exceptions are never logged. `noise.json` rules operate on the raw message and route and can be scoped by service; scanner paths, client aborts and explicit expected 401/403/404 responses are preseeded.


Warning rules explicitly opted in with `alert: true` stay out of error totals and ordinary error grouping, but more than 50 matches of one rule for one service within a rolling hour file one source-fix ticket. `ERROR_COLLECTOR_NOISE_HOURLY_LIMIT` overrides that threshold. The trailing hour persists across collection passes; repeats reuse the service/rule fingerprint and existing activity, cap and retry paths. Scanner traffic, expected HTTP responses, client aborts, agent refusals and forced tests never alert.

## One error, one fingerprint (YPER4-399)

Fingerprints drop a leading ISO timestamp, turn any other ISO timestamp into `<time>`, and turn a URL after `Invalid <thing>: ` (Better Auth's rejected origin or callback) into `<url>`. Before this, each Vercel line kept its own timestamp fraction and preview URL path, so one Better Auth "Invalid origin" error filed four tickets (HTPR-7240 to HTPR-7243).

Pending groups carry the fingerprint rules version (`rules`). A group parked under older rules is re-keyed from its saved sample before reporting and joins the current fingerprint's ticket or pending group. Without this, four groups held by the hourly cap before the fix still filed HTPR-7244 to HTPR-7247.

## Forced test errors (YPER4-384)

A test that throws an error on purpose in production puts `[ht-forced-test]` in the error message, for example `throw new Error("[ht-forced-test] YPER4-384 forced browser test 1")`. The collector counts it as noise for every source and prints `skipped forced test error`; the native PostHog issue writer (`.github/scripts/posthog-error-issues.mjs`) returns `skip` and files nothing. An error without the marker still becomes a ticket. CLI error reports only allow a plain error name, so a live check of `/api/mcp/cli-error` sends the error name `HtForcedTest` instead (YPER4-396): the collector skips `[cli-error] <command>: HtForcedTest` the same way, and any other CLI error name still files. The nightly `PostHog pipeline canary` keeps its own rule: it must file and then close its ticket to prove the pipeline works.

## Live read paths and bounds

- CLI: POST `/api/mcp/cli-error` (YPER4-356) writes `[cli-error] <command>: <error> (HTTP <status>) v<version> <os>` to Vercel runtime error logs; HTTP status is optional. The Vercel source reads these as service `cli`, board 15, with version and OS in stack rather than the grouping message. Authenticated reports contain only command, Zig error name, optional HTTP status, version and OS; 30 reports per user per hour. Opt-out is client-side, with no server feature flag.

- Vercel: Messages starting with `[email-event]` (Resend bounces and failed sends, YPER4-359) use service `email` and board 4060. Read-only POST `/v1/observability/events`, production runtime errors and proxy 5xx, board 15 except runtime timeouts, the /sse runtime route and dead outgoing webhooks (`[board-webhook]`/`[agent-webhook] delivery failed ...`, one log line per delivery that used up its retries, YPER4-358) on board 4060. Limit 500, cursor paging, exact record dedupe; 30 pages/window and 120 requests/source. HTTP 413 bisects the window; retention HTTP 400 advances the start ten minutes with an explicit coverage warning (counts are lower bounds). HTTP 429 stops the source. Truncated/excluded-interval responses fail closed. Structured message/error details survive; timestamp/correlation envelopes and Prisma input dumps do not become the cause.
- Realtime: hosted Pusher trigger failures already logged by the app as `[realtime] broadcast failed`. Reuses the bounded Vercel runtime reader with `(level:warn OR level:error) AND environment:production`, then selects that exact prefix locally because Vercel does not allow querying the message dimension. Board 4060, service `realtime`; the normal `vercel` source excludes these records to avoid duplicate tickets/counts. Same paging, dedupe, retention and failure semantics as Vercel. Server-to-Pusher auth/not-found responses and aborted publishes are real failures, so the generic expected-client HTTP/abort noise rules exclude `realtime`; forced-test noise still applies. No new credentials, logging toggle, drain or app deployment required.
- GitHub: `gh run list --json` on production plus scheduled runs, failure and timed_out; finished timestamps select the collection window. A 35-day creation lookback covers GitHub's maximum workflow lifetime, bounded at 10,000 runs/list and 20 `gh run view --json jobs` lookups. Newest runs get job lookups; the remainder use workflow names so the whole window advances. Board 4060.
- VPS: priority err user and readable system journals, grouped per UTC day, unit and normalized message; journal cursors dedupe overlapping user/system records. Own `error-collector.service` records excluded. Unreadable system journal is an explicit partial-coverage warning. Board 4060. Failed units without priority-err log entries are not measured.
- Cloudflare: uniquely named Hypertask account from GET `/accounts`, then read-only GraphQL `workersInvocationsAdaptive`, bounded at 10,000 rows. Execution-error counts per UTC day and worker, board 4060; queries split at midnight using (since, until] boundaries. Analytics may be sampled/estimated. No edge HTTP 4xx, DNS-site traffic or zone HTTP traffic is fetched or ticketed.
- Neon: two read-only HTTPS SQL POSTs to the database host's `/sql`, calling only `ops_stats.slow_queries(min_mean_ms, 50)` and `ops_stats.db_counters()` as `stats_reader`. The login URL lives in `~/.local/state/error-collector/neon-stats.url` (mode 600), overridden by `NEON_STATS_URL_FILE`; it is never logged or persisted in collector state. Slow queries use `NEON_SLOW_QUERY_MS` (default 1000 ms mean), at most 50 rows with normalized query text capped at 500 characters. Stable messages contain the query only; cumulative calls/mean/max/total go in the stack, with one observation per query per run at `until` (not window-only execution counts). Counter snapshots retain exact bigint strings: any deadlock/conflict increase alerts, rollbacks alert only above `NEON_ROLLBACK_ALERT` (default 500 per reading window). First readings, changed `stats_reset` or any decreasing counter establish a baseline without counter events. The snapshot and timestamp advance together only on success; dry runs write neither. Board 4060, service `neon`. SQL error TEXT is not available from Neon on this plan; app-side SQL errors already arrive through the Vercel source as Prisma errors.
- PostHog: EU HogQL production-only aggregate `$exception` query (explicit ht_environment production, or absent ht_environment and production app URL), distinct browser/server projects, bounded at 10,000 rows/project; summary-only, because the native PostHog issue alert (`.github/workflows/posthog-error-alert.yml`, not only `src/lib/telemetry/posthogErrorAlert.ts`) already files one Bugs ticket per new browser or server issue (YPER4-377). Aggregate events use last-seen timestamps; an issue spanning midnight is counted on its last-seen day.

`fixtures/recorded.json` contains sanitized actual research/live read responses; `fixtures/sources.json` contains synthetic edge cases; `fixtures/h1-groups.json` preserves all 166 research classifications and counts. Noise rules are intentionally narrow and service-scoped. The Forbidden create refusal follows h1's NOISE classification even though its documented HTTP 500 mapping is a separate response-classification defect. No h1 group was reclassified.

`fixtures/stale-replay.json` preserves first/last seen, total counts and routes from the copied 2026-10-20 records for HTPR-7481..7490 and pending groups `59e95a363a3ade04`, `4521ba2d3b01feb3`, `b34dd96eb28f313c`. Messages are short sanitized labels, not raw logs; counts are distributed across endpoint timestamps and routes.

Dry runs print source windows/counts and daily per-service counters in addition to proposed writes. They still perform read-only marker searches, obey the hourly cap, and do not persist state. Use a fresh `ERROR_COLLECTOR_STATE_DIR` for an isolated 24-hour run. Never run the installer or omit `--dry-run` against live services without separate authorization.

## Production realtime discovery (YPER4-360, 2026-10-14)

Production is **hosted Pusher Channels, cluster `mt1`**, using `ws-mt1.pusher.com` (browser WebSocket) and `api-mt1.pusher.com` (server trigger HTTP API). It is not one of the local Soketi test containers or a Cloudflare Worker.

Evidence from read-only inspection:

- `src/lib/realtime/server.ts` uses the Pusher SDK, choosing a custom host only with `PUSHER_HOST`. Its `broadcast()` catch already writes failures via `console.warn`, which the previous error-only collector query missed. `src/lib/realtime/client.ts` likewise chooses a custom host only with `NEXT_PUBLIC_PUSHER_HOST`.
- GET Vercel project/environment metadata identifies project **hypertasks-prod**, owned by team **Hypertaskai (`hypertaskai`)**. Production has `PUSHER_APP_ID`, `PUSHER_KEY`, `PUSHER_SECRET`, `PUSHER_CLUSTER`, `PUSHER_USE_TLS`, `NEXT_PUBLIC_PUSHER_KEY`, `NEXT_PUBLIC_PUSHER_CLUSTER`, and `NEXT_PUBLIC_PUSHER_USE_TLS`. Neither custom-host variable is present. Only environment names were inspected, never their values.
- The live production asset `https://app.hypertask.ai/_next/static/chunks/9580-4454d583f7876d98.js` constructs Pusher with `cluster:"mt1"`, `forceTLS:true`, and `/api/pusher/auth`. This independently verifies the public cluster without reading credentials. DNS resolves both Pusher hosts; the API host aliases an AWS `us-east-1` load balancer. HTTPS HEAD returned 200 for the API root and 405 for the WebSocket host.
- The Cloudflare **Hypertask** account's Workers inventory has no realtime/Pusher server. The repository has no realtime Worker/Fly/Railway deploy configuration. User/system unit inspection found no realtime server; `docker ps` showed only test/premerge Soketi containers bound to localhost. `docker-compose.yml` is database-only.
- **Ownership limitation:** Hypertaskai is the verified production app/log owner, not proof of the Pusher dashboard login or Pusher organization name. `stack-key --list` has no Pusher service/credentials, and Vercel integration metadata lists only Prisma and Neon. The Pusher account owner cannot be verified through the available authorized read paths. A Pusher account owner must confirm that vendor account separately; no account identity is guessed here.

### Read verification and coverage

Read-only POST `https://api.vercel.com/v1/observability/events?teamId=<team>` works with the existing `stack-key vercel VERCEL_TOKEN`, `VERCEL_TEAM_ID`, and `VERCEL_PROJECT_ID` credentials. A 15-minute warning-only read returned HTTP 200 with an empty events array. A warning/error read returned HTTP 200 with 42 runtime records, zero realtime failures. A subsequent 24-hour adapter read paged through runtime records and also returned zero realtime failures. No synthetic failure was injected into production. `fixtures/realtime.json` records the empty response shape plus explicitly synthetic warning/error rows for positive coverage.

This reads **app-side failed Pusher trigger calls**, not Pusher's internal server logs, dashboard debug console, or browser-only disconnects. Failures before the broadcast catch and a Pusher internal failure after accepting a trigger are outside this source. There is no authorized Pusher internal-log read path available with the stored keys. Existing application-side failure logging meets the available hosted-service read path without enabling provider logging or deploying application changes.

### VPS activation is a separate operator action

The inspected VPS timer `error-collector.timer` was active and runs every fifteen minutes. `error-collector.service` runs `~/.local/lib/hypertask/error-collector/collector.mjs --once` with the optional private environment file. The last inspected run succeeded. Installed modules/state contained the seven old sources, so changing this worktree alone does **not** change that running collector.

After review and authorization, an operator must install this revision using the existing `--install` command above. That copies the new default source and refreshes the existing timer. **This task did not install, restart, deploy, change host configuration, or write any board content.** No Vercel/Pusher/Cloudflare configuration change is needed for the app-side read path. Until the collector installation is updated, scheduled production collection still has the old coverage.

Source-only read, without board writes or state changes (use an unused state path):

```sh
ERROR_COLLECTOR_STATE_DIR=/tmp/realtime-collector-dry-run node .claude/skills/ship/scripts/error-collector/collector.mjs --once --sources realtime --dry-run
```


## Related production incidents

Prisma errors share a root by route, model, and unknown field. Project-list
wrappers join only one root within ten minutes. Other fields, models, routes,
and ambiguous wrappers stay separate. One nearby open MCP HTTP 500 report can
own the incident. Counted activities group identical hits within one collection
window; durable markers recover interrupted writes. Ordinary errors retain their
six-hour activity policy. Tagged product alerts get the same related-incident
check before `ship-claim` writes. The sanitized historical replay lives in
`fixtures/project-validation.json`; hosted tests prove writes with fake CLIs.

## Weekly infrastructure failures (YPER4-861)

`vps-journal` and `github-actions` failures update one low-priority Fleet Infra digest
per UTC Monday-start week. Each unit has one line: first redacted error, count and
last seen. Description replacement is idempotent; failed writes stay dirty, and an
uncertain create reconciles its exact marker before retrying. Product errors and
escalations use the hourly creation allowance before the digest does.

Three consecutive failed runs of the same unit escalate to a separate issue.
Journal `JOB_RESULT` records identify runs; successful completions reset the
streak. GitHub reads completed runs, including recoveries; cancelled/skipped runs
break a failure streak. Repeated log lines without run outcomes do not count as
separate failed runs. Existing pending infrastructure groups migrate into the
digest, not individual tickets. Other sources keep their original routing.

Customer-facing units escalate immediately: nginx, caddy, hypertask/hypertasks,
ht-slack, soketi and pusher services, plus production-health GitHub workflows.
`ERROR_COLLECTOR_USER_FACING_UNITS` can list additional exact unit names, separated
by commas. Unknown infrastructure remains visible in the digest. The system
journal's errors and successful completions are read together; unreadable system
coverage is reported explicitly. Completed digest state retains five weeks;
run streaks expire after ninety days without an observed outcome.

The installer disables existing timers and stops services for the explicitly
retired brand-bot-youtube-weekly, growth-experiments-monday, hypertask-video-x,
hypertask-video-daily, support-bot-scorecard and multiprompt-revert-board families.
Absent units need no action. It leaves every other unit untouched.

Before updating a running collector, stop `error-collector.service`, install the
merged revision, then start the service and check its real result. Do not run a
candidate collector against production with writes enabled. A synthetic replay
proves routing; it does not prove seven days of live operation or repair wanted
services that were folded into this ticket. Record those separately on the ticket.
