# Neon compute follow-up, 27 October 2026

The 20% compute target is not demonstrated.
Thirteen mature days already exceed the full budget.
The last day's reporting window remains open.

Ticket: https://app.hypertask.ai/detail/project-4060/235
Original change: https://app.hypertask.ai/detail/project-15/7042
Original release: https://github.com/hypertask-ai/hypertask/pull/1231

## Production branch results

Units: allocated compute-unit hours, not query time.
Baseline: 25 September through 8 October, inclusive.
Comparison: 12 through 25 October, inclusive.
Deploy day and warmup excluded.

| Measure | CU-hours |
| --- | ---: |
| Baseline total, 14 days | <!-- baseline_total --> 220.3792 |
| Baseline daily mean | <!-- baseline_mean --> 15.7414 |
| Target daily mean, 20% lower | <!-- target_mean --> 12.5931 |
| Target total, 14 days | <!-- target_total --> 176.3033 |
| Observed total, 13 mature days | <!-- mature_total --> 197.5731 |
| Best possible 14-day daily mean | <!-- best_possible_mean --> 14.1124 |
| Observed 14-day daily mean, provisional | <!-- provisional_mean --> 15.2439 |

| Comparison | Reduction |
| --- | ---: |
| Best possible reduction, final day zero | <!-- best_possible_saving_percent --> 10.3486% |
| Observed reduction, provisional | <!-- provisional_saving_percent --> 3.1600% |

The bound assumes earlier mature records remain unchanged.
Even zero final-day usage misses the target.
This rules out success from final-day lag alone.
The provisional mean is not a finalized result.

## Reporting lag and attribution

Collected 27 October 2026, 01:44:38 UTC.
Each mature day ended at least 48h earlier.
There are 13 mature days, through 24 October.
25 October matures on 2026-10-28 00:00 UTC.
No final 14-day savings figure is claimed.

The reduction is not attributable to this change.
No matched traffic or request-normalized history was available.
Other releases and workload changes remain possible causes.
No experiment was rerun against production traffic.

## Project cross-check and compute floor

| Project measure | CU-hours/day |
| --- | ---: |
| Baseline, all project branches | <!-- project_baseline_mean --> 15.7715 |
| Comparison, all branches, provisional | <!-- project_provisional_mean --> 15.2589 |

The production branch still dominates project compute.
Current endpoint range remains 0.25 to 2 CU.
Autosuspend remains disabled, value `-1`.
Continuous minimum allocation costs 6 CU-hours/day.
Current settings match the original research snapshot.
Intermediate setting changes were not independently excluded.

## Evidence and recommendation

Source: Neon's control-plane consumption API.
GET `/api/v2/consumption_history/v2/branches`, daily `compute_unit_seconds`.
Project cross-check: GET `/api/v2/consumption_history/v2/projects`.
Endpoint settings: GET `/api/v2/projects/{project}/endpoints/{endpoint}`.
Project: `raspy-sunset-94817994`.
Production branch: `br-curly-glade-ab476077`.
Endpoint: `ep-gentle-grass-abgtcv1y`.

[Daily provider counters](neon-compute-followup-yper4-235.csv).
Divide CU-seconds by 3,600 for CU-hours.
Daily duplicate period contributions are summed.
Both series cover 31 complete UTC dates.
No gaps, partial dates, or unread pages accepted.

No database connection. No settings changed.
No flags or monitoring schedules changed.
Recommendation: retain existing settings and safety checks.
Do not claim the 20% target achieved.
First measure recurring wakeups and above-floor compute.
Autosuspend alone cannot remove continuous database wakeups.
Any monitoring delay or cold-start tradeoff needs approval.
