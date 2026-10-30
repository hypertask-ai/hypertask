## AI review verdict on the ticket (YPER4-675)

[AI review verdict to ticket](../.github/workflows/ai-review-mirror.yml) copies
the current GitHub AI Review verdict onto the ticket named by the branch, so the
review reaches the people reading the board and not only the pull request. It
runs here, not in the private reviewer repository: this repository already owns
the board token that binds titles and files tickets, while the reviewer's own
copy was rejected ("Unauthorized") and the failure was hidden by
`continue-on-error`.

- Wakes on `created` and `edited` pull request comments, and on a manual
  `workflow_dispatch` with a PR number for a missed round or a backfill.
- Mirrors only a comment written by the reviewer App account that starts with
  `APPROVE` or `CONCERNS`, on a same-repository PR to `production`. That account
  is `hypertask-ai-review[bot]` on a comment event and `hypertask-ai-review` in
  the REST payload, so both spellings match and nothing else does.
- Copies only the verdict whose `reviewed-commit` marker equals the current PR
  head, so a review of an older commit never reaches the ticket as the verdict
  for what will merge.
- The concurrency group carries the comment author and never cancels, so an
  ordinary comment on the same PR cannot cancel the reviewer's delivery.
- Posts one comment with `kind: qa`, because an agent comment without a kind is
  filed in the hidden agent log instead of the ticket thread.
- Skips a commit the ticket already carries and sends an `Idempotency-Key` of
  `ai-review-mirror-<pr>-<sha>`, so a re-run or an edited verdict never doubles
  the comment.
- A rejected read or post fails the run. A silent skip is exactly the failure
  this replaces.
- Both GitHub reads use the same reset-aware retry as the other trusted
  workflows (`retryGithubRequest` in `.github/scripts/github-rate-limit.mjs`).
  The installation shares one hourly budget with the whole fleet, and the live
  failure was a `403` with `x-ratelimit-remaining: 0` resetting 82 seconds
  later (YPER4-925). Waits are capped at 240 seconds and the budget at 420
  seconds, inside the job's 10-minute timeout; a wait past the cap fails the run
  with the GitHub rate limit named, so a lost verdict is never a silent one.
- Reads the PR number, branch name and comment text as data. The only checkout
  is the production default branch's `.github/scripts`, sparse, with
  `persist-credentials: false`, for that retry helper; no candidate code is
  fetched or run, there is no shell step, and the permissions stay
  `contents: read` plus `pull-requests: read`.
