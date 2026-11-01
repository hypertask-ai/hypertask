## Day-one sweep (HYCI-51)

- The block decides on a pull request event, so a big change opened before blocking kept its pass.
- `pr-size-day-one.yml` runs daily and by `workflow_dispatch` on `production` and measures every open agent change through the same `pr-size.cjs` rule.
- It publishes no verdict: the workflow has no `statuses` scope, so `pr-guards-trusted.yml` stays the only writer of the required `pr-title` context.
- For a change over the cap it re-runs the `pr-guards-trusted.yml` run whose payload already carries that head. The guard re-reads the change, rechecks `size-ok` and the human reason, keeps its own per-change ordering, and publishes the result itself.
- Re-running needs `actions: write` on the run token and nothing else. The label path needed App Issues write, which the CI App is not granted, so it could never trigger the guard; a `github.token` label write starts no workflow run either.
- A head with no completed guard run cannot be re-decided, so the sweep names it and posts no counts instead of leaving the change passing.
- A change allowed by `size-ok` and a human reason is never re-triggered; a change under the cap keeps its existing verdict.
- A scheduled run before `blockFrom` reads no pull request; the first run after it sweeps, and a later scheduled run finds its own success and does nothing.
- A dispatch run always sweeps, so a rehearsal reports what would fail and asks no guard.
- A change that cannot be measured or re-asked is named on the ticket, never counted as passing, and the counts are not posted until every guard re-run succeeded.
- The counts go to HYCI-51 once, keyed on `blockFrom`, with its own key for a rehearsal.
