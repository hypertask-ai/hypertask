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
- Reads the PR number, branch name and comment text as data: no checkout, no
  shell step, no candidate code, and `contents: read` plus `pull-requests: read`
  only.
