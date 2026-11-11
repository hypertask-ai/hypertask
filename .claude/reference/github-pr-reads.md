# Runner-app open-PR reads (HYCI-247)

## Measurement boundary

Baseline: 2026-11-10 03:30:16 UTC through 2026-11-11 03:30:16 UTC.
Source: `~/.local/state/gh-call-log/calls.tsv`, filtered to the `app` bucket,
`hypertask-ai/hypertask`, `pr list`, and `--state open`.
Rates below are logged command invocations divided by 24 hours. They are not
GraphQL points or HTTP requests: `gh pr list` can paginate internally, and the
log does not record success, response size, or GraphQL cost. Identical command
signatures cannot distinguish the picker from the legacy drain tool.

## Before and after

| Reader/signature family | Before invocations/hour | After invocations/hour | Change |
| --- | ---: | --- | --- |
| `fleet/pick` and `pr-drain-pick`, identical 1,000-PR rollup signature | 23.042 | Pending live measurement | Drain reuses the picker's complete snapshot while 0–120 seconds old |
| `ship-claim`, all-base 300-PR metadata | 23.625 | Pending live measurement | REST backup for both open PRs and merged-ticket searches |
| `fleet/slo-watch.py`, default-limit rollup | 15.208 | Pending live measurement | Unchanged; aggregate red state, not merge authorization |
| Agent runtime collector, 60-PR rollup | 10.542 | Pending live measurement | Unchanged; names and timestamps exceed the picker snapshot |
| Agent feed shared open-pulls metadata, 1,000 PRs | 7.792 | Pending live measurement | Unchanged; already omits rollups |
| Agent cards collector, 100-PR rollup | 4.792 | Pending live measurement | Unchanged; needs named required checks |
| CI Boss `ship-watch`, 100-PR rollup | 3.917 | Pending live measurement | Unchanged; needs check names and start times |
| Poteto `flow_metrics.py`, 200-PR author metadata | 3.750 | Pending live measurement | Unchanged; already omits rollups |

The first row combines 553 calls; the claim row combines 567 calls across
logged caller classes. These are signature totals, not unique executable counts.
A shared-snapshot drain invocation makes zero PR-list calls, versus one command
before. A missing, stale, future-dated, duplicate or malformed snapshot retains
the original complete live read. There is no measured fleet-wide reduction yet.
The picker remains the snapshot producer; this change does not extend its TTL.

## Reader inventory

The following inventory covers repository scripts and installed automation found
by searching `gh pr list`, Python/Node argument arrays, `statusCheckRollup`, and
REST pull-list endpoints. Backups and duplicate installed revisions are excluded.
A zero or unknown rate is not proof that a reader never runs.

| Reader | Fields/scope | Frequency evidence and disposition |
| --- | --- | --- |
| `fleet/pick` | Production PRs and aggregate red state | Shared 120-second snapshot, 900-second stale fallback, REST fallback; combined baseline above |
| `pr-drain-pick` (both legacy installed copies) | Same production scope and red state | Reuse shared snapshot; preserve own-PR, freeze, draft and idle-red ordering |
| `ship-claim` | All open bases; targeted merged PRs | All-base scope cannot use the production-only picker snapshot safely; add REST backups, retain holds and saturation limits |
| `ship-check` | Targeted ticket/title search | Event-driven; already narrowed to one ticket; no list-wide check rollups |
| `disk-guard.py` | Open/all PR metadata by repository or branch | Cleanup-driven; no check rollups; rate not separately attributable |
| `worktree-reaper` | Repository/branch metadata | Cleanup-driven; no check rollups; rate not separately attributable |
| `fleet/slo-watch.py` | Production PR numbers and rollups | Aggregate signature above; unchanged |
| CI Boss `ship-watch` | Production draft status, check names/times | 15-minute timer; 94 observed invocations; cannot replace named checks with aggregate red |
| CI Boss `ci-ready-prs` | HYCI title search | On demand; no matching calls in this baseline signature table |
| Agent feed `collect-agent-runtime.mjs` | Title, labels, age and checks | 253 observed invocations; duplicate deployed runtime copy also exists |
| Agent feed `collect-agent-cards.mjs` | Author, age and named required checks | 115 observed invocations; aggregate red cannot replace named checks |
| Agent feed `lib/open-pulls.mjs` | Metadata without check rollups | 187 observed invocations; already shared by feed collectors |
| Agent feed `collect-agent-status.mjs` and `collect-pipeline.mjs` | REST metadata and per-head checks | Not counted by the `pr list` filter; existing caches; no exact per-tool rate attribution in call log |
| Poteto `flow_metrics.py` | PR number, URL, author and draft | 90 observed invocations; metadata only |
| Poteto `fleet-watch` | GraphQL PR state and check contexts | Per-PR reads, not bulk open-PR lists; outside this table's counting boundary |
| `ht-token-burn-feed` | Runner authors/branches and rollups | On feed refresh; no matching signature in this window |
| `ht-scorecard` and `ht-morning-report` | Production aggregate checks | On report generation; same SLO-like fields but different flag spelling; no matching signature in this window |
| `pr-check` | Production checks, labels and mergeability | On demand; no matching open-list signature in this window |
| `pr-feedback-loop` | Production labels, mergeability and named checks | Multiple list reads per run; no matching signature in this window; not a snapshot-compatible consumer |
| `ocr-advisory` | Production PR metadata/labels | On demand; no matching signature in this window |
| `refresh-production-flag-modes.sh` | One branch's open PR number | Four calls in baseline; already branch-filtered |
| CEO `ready-review-prs`, `app-cadence`, `gh-cancel-stale` | Factory repositories, draft/branch metadata | Not Hypertask runner-app bulk rollup readers; other-repo calls excluded from rates above |
| Interactive agents | Mixed searches and bulk reads | Remaining signatures are not reliably attributable to a fixed tool; not assigned invented per-tool rates |

## Safety and acceptance

The cached snapshot is advisory queue input, never merge/check authorization.
The drain tool rejects snapshots with invalid fields, duplicate PR numbers or
invalid timestamps. Live fallback preserves the existing fail-closed behavior.

Claims retain the all-base open-PR scope, 300-open and 100-merged saturation
limits, existing own-work holds, and complete board reads. REST open reads use
`--paginate --slurp`; duplicate pages are refused. REST merged search refuses
partial results, a missing page, issues instead of PRs, or 100 results.
No user-token fallback is introduced.

CI regression cases cover cached red/green/empty queues, stale/future/malformed
snapshots, REST ownership on later pages, same-ticket resumption, competing work,
and incomplete REST results before writes. Tests run only on GitHub-hosted CI.

After installation, the acceptance window is 24 hours without a rate-limit
claim hold. Record the installed revision and start time, then compare the same
log filters over the full following day. Inspect runner and picker logs for
failed reads as well: fewer logged calls caused by failed work is not success.
The post-installation rate column and 24-hour verdict remain pending until then.
