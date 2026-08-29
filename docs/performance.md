# Performance Measurement

Hypertask performance tracking has three layers:

- Daily API probes: `~/projects/hypertask-speed/probe.mjs` measures production API latency for login send/verify, project list, notifications, task search, and task-read ranking.
- Daily PSI/CrUX: `~/projects/hypertask-speed/psi.mjs` records PageSpeed Insights lab performance and any available CrUX field LCP, CLS, and INP data.
- Weekly interaction bench: `~/projects/hypertask-speed/pane-bench.sh` measures board-card to task-pane open time in a real browser tab, then `record-bench.sh` records the point.
- Authenticated field vitals: PostHog records an app-only `app_project_web_vitals` series for exact host `app.hypertask.ai` and route `/project`, split into mobile and desktop.

## Authenticated app budgets

The app rewrites PostHog's built-in `$web_vitals` event to `app_project_web_vitals` only when the recorded URL has exact host `app.hypertask.ai` and exact path `/project`. The marketing site continues to emit `$web_vitals`, so shared acquisition identity does not blend marketing performance into the app series.

Run the field report with a read-only PostHog personal key:

```bash
POSTHOG_PERSONAL_API_KEY=... npm run performance:field -- --days=14
```

The report shows p75 LCP and INP with separate sample counts for mobile and desktop. A metric needs 75 samples before the report makes a target judgment. Mobile LCP remains targeted below 2.5 seconds; INP remains targeted at 200 milliseconds or less.

The pre-release 30-day app-only field baseline is also stored in the config. Desktop has enough observations for a 5% regression comparison (LCP 2,425 ms at n=280; INP 72 ms at n=325). Mobile is recorded but explicitly remains an insufficient baseline (LCP 2,965 ms and INP 128 ms, both n=17).

The cache-disabled logged-in fixture baseline lives in `config/app-project-performance-baseline.json`. It records initial script count, decoded JavaScript, API request count, and decoded API bytes. Compare a same-shape browser trace against it with:

```bash
npm run performance:budget -- /path/to/trace.json
```

The command exits nonzero when any metric regresses by more than 5%. Keep viewport, CPU throttle, cache state, route, and account fixture identical before treating a comparison as valid.

## Location

Publisher scripts live in:

```text
/home/valentin/projects/hypertask-speed
```

The dashboard data file lives in:

```text
/home/valentin/projects/hypertask-analytics/src/data/speed.json
```

Cron runs the daily publisher:

```cron
0 5 * * * /home/valentin/projects/hypertask-speed/run.sh
```

`run.sh` writes the analytics data file, commits it when changed, then deploys the existing Hypertask analytics Worker.

## Dashboard Flow

Data flow:

```text
probes/PSI on the VPS
-> ~/projects/hypertask-analytics/src/data/speed.json
-> commit + npm run deploy
-> https://analytics.hypertask.app/speed
```

The analytics app imports the JSON at build time on the SSR `/speed` page. The dashboard is served by the Hypertask Worker behind Zero Trust.

## Weekly Pane Bench

Open the production board in the browser pane, then run:

```bash
cd /home/valentin/projects/hypertask-speed
./pane-bench.sh "Vercel"
```

Record the printed median/min/max/n:

```bash
./record-bench.sh "Vercel" 309 250 420 10
```

`record-bench.sh` upserts by same `date` and `label`.

## Deploy Markers

Hand-edit `~/projects/hypertask-analytics/src/data/speed.json` and append a row to `deploys`:

```json
{ "date": "2026-07-05", "label": "Vercel cutover" }
```

The dashboard renders each deploy marker as a vertical dashed line on every trend chart.

## data.json Schema

- `generatedAt`: ISO timestamp for the last write.
- `target`: measured production URL.
- `deploys[]`: `{date,label}` deploy or infrastructure markers.
- `api[]`: `{date,sendCode,verifyCode,projectsGetAll,notifications,search,taskRead}` in milliseconds or `null`.
- `psi[]`: `{date,mobile,desktop}`, each strategy containing `{lcp,cls,inp,perf}`. LCP and INP are milliseconds, CLS is the real score, and `perf` is Lighthouse performance score 0-100.
- `interaction[]`: `{date,label,median,min,max,n}` for manual pane benchmarks.

## Day-0 Baselines

Day-0 date: `2026-07-05`.

- Deploy marker: `Vercel cutover`.
- API: `sendCode=1077ms`, `verifyCode=1510ms`, `projectsGetAll=723ms`, `notifications=123ms`, `search=108ms`, `taskRead=60ms`.
- Interaction: `AWS (pre-cutover)=257ms`, `Vercel (cutover night)=309ms`, both with `n=10`.
- PSI: no Day-0 rows.
