# Recorded CI evidence for the PR 1392 incident

Fetched with `gh api` from hypertask-ai/hypertask on 2026-10-11. JSON keeps only the ci-tests run and fields used by the guard; log excerpts are unchanged lines with no environment or credentials.

GitHub does not record a failed ci-tests on PR 1392's head:

- `gh pr view 1392 -R hypertask-ai/hypertask --json headRefOid,statusCheckRollup` reports head `c587e4b7a53a840eed609f371829397c71214ef7` and ci-tests success. `pr-1392-head.check-runs.json` preserves that result (job 114553656721).
- Its squash merge `ff62576c1f2812d4fcee712dd69eb3e82897c8f2` ran job 114576260180, which was cancelled before reporting the paging assertion.
- The next completed production suite, commit `a17823052892181c6d84084af1597983fc693ba3`, job 114581508375, failed with the incident's `tests/htpr-6971-chat-history-paging.test.cjs:774:1` assertion. `pr-1392-failure.check-runs.json` and `pr-1392-failure.log` are genuine excerpts from that run. The regression stub presents this recorded failing commit as PR 1392's head to prove the new guard rejects it; it does not claim the historical PR-head check was red.
- `production.check-runs.json` and `production.log` come from PR 1398's production merge `b1ce7aaecceade982b005aa6cf0dcabe8e9d5c03`, job 114565456089. This job was cancelled after emitting Compose test failures, so it is also nonpassing.

For each SHA, read `repos/hypertask-ai/hypertask/commits/<sha>/check-runs?per_page=100&filter=all` with `--paginate`. Logs come from `repos/hypertask-ai/hypertask/actions/jobs/<id>/logs`. Original job links and statuses remain in the JSON; no conclusions or SHAs were rewritten.
- `pr-1392-head.check-runs.json` with `production.check-runs.json` replays the real merge: PR 1392's head passed at 19:22, production went red at 20:19, so the guard asks for a rerun before merging.
