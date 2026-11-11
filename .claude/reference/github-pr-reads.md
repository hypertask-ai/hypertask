# Runner-app open-PR reads (HYCI-247)

## Measurement boundary

Baseline: 2026-11-10 03:30:16 UTC through 2026-11-11 03:30:16 UTC.
After: 2026-11-11 08:05:32 UTC (installed revision) through the read at
2026-11-11 13:58:00 UTC, 5.891 hours. Partial window: the 24-hour verdict is due
2026-11-12 08:05:32 UTC.
Source: `~/.local/state/gh-call-log/calls.tsv`, filtered to the `app` bucket,
`hypertask-ai/hypertask`, `pr list`, and `--state open`.
Rates below are logged command invocations divided by the hours in each window.
They are not
GraphQL points or HTTP requests: `gh pr list` can paginate internally, and the
log does not record success, response size, or GraphQL cost. Identical command
signatures cannot distinguish the picker from the legacy drain tool.

## Before and after

| Reader/signature family | Before invocations/hour | After invocations/hour | Change |
| --- | ---: | ---: | --- |
| `fleet/pick` and `pr-drain-pick`, identical 1,000-PR rollup signature | 23.042 (553 calls) | 20.030 (118 calls) | −13%; drain reuses the picker's complete snapshot while 0–120 seconds old, the picker still produces it |
| `ship-claim`, all-base 300-PR metadata | 23.625 (567 calls) | 19.860 (117 calls) | −16%; REST backup for both open PRs and merged-ticket searches |
| `fleet/slo-watch.py`, default-limit rollup | 15.208 (365 calls) | 15.956 (94 calls) | Flat within noise; aggregate red state, not merge authorization |
| Agent runtime collector, 60-PR rollup | 10.542 (253 calls) | 10.694 (63 calls) | Flat within noise; names and timestamps exceed the picker snapshot |
| Agent feed shared open-pulls metadata, 1,000 PRs | 7.792 (187 calls) | 7.639 (45 calls) | Flat within noise; already omits rollups |
| Agent cards collector, 100-PR rollup | 4.792 (115 calls) | 4.753 (28 calls) | Flat within noise; needs named required checks |
| CI Boss `ship-watch`, 100-PR rollup | 3.917 (94 calls) | 4.074 (24 calls) | Flat within noise; needs check names and start times |
| Poteto `flow_metrics.py`, 200-PR author metadata | 3.750 (90 calls) | 3.734 (22 calls) | Flat within noise; already omits rollups |

The first row combines 553 calls; the claim row combines 567 calls across
logged caller classes. These are signature totals, not unique executable counts.
A shared-snapshot drain invocation makes zero PR-list calls, versus one command
before. A missing, stale, future-dated, duplicate or malformed snapshot retains
the original complete live read. The picker remains the snapshot producer; this
change does not extend its TTL.

## What the partial window shows

Every family left unchanged by this ticket still reports its baseline rate, so
the fleet total only fell from 101.7 to 96.9 invocations per hour (−4.7%) in the
first 5.9 hours. The two families the ticket touched fell 13% and 16%; the six it
left alone account for 46 of the 97 remaining calls per hour. `fleet/slo-watch.py`
(16.0 per hour) is now the largest single open-PR list reader, and three agent
feed collectors plus CI Boss `ship-watch` repeat the same production reads.
Cutting the rate further means giving those readers a shared copy, not shrinking
the picker TTL.

No rate-limit claim hold appears in the picker park events or the runner logs
between the install and this read.

## Finish the 24-hour verdict

Run this after 2026-11-12 08:05:32 UTC, then fill the after column for the full
window and move HYCI-247 to Done only when no rate-limit hold appears in the
same 24 hours:

```sh
python3 - <<'PY'
import re, time, collections
B0, B1, A0 = 1794281416, 1794367816, 1794384332
A1 = int(time.time())
sig = re.compile(r"[0-9]+")
before, after = collections.Counter(), collections.Counter()
for line in open("/home/valentin/.local/state/gh-call-log/calls.tsv", errors="replace"):
    p = line.rstrip("\n").split("\t")
    if len(p) != 6 or not p[0].isdigit():
        continue
    ts, c = int(p[0]), p[3]
    if p[4] != "app" or p[2] != "pr" or not c.startswith("pr list"):
        continue
    if "hypertask-ai/hypertask" not in c or "--state open" not in c:
        continue
    if B0 <= ts < B1:
        before[sig.sub("N", c)] += 1
    elif ts >= A0:
        after[sig.sub("N", c)] += 1
bh, ah = (B1 - B0) / 3600, (A1 - A0) / 3600
print("total before/h", round(sum(before.values()) / bh, 2), "after/h", round(sum(after.values()) / ah, 2))
for s, n in before.most_common():
    print(f"{n/bh:7.2f} -> {after.get(s, 0)/ah:7.2f}  {s[:100]}")
PY
```

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
The after column covers the first 5.891 hours; the 24-hour verdict is still open.
