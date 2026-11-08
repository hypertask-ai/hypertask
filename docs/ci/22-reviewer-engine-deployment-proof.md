## Reviewer engine deployment proof

For `hypertask-ai/reviewer` on `main`, with `SHIP_DEPLOY=none`, `ship-check deployed`
requires a recorded `live-proof` in the ticket's evidence folder:

```text
sha: <full merged engine commit>
source: <absolute reviewer checkout containing that commit>
check: reviewer-workflow
ci: https://github.com/hypertask-ai/reviewer/actions/runs/<CI run ID>
review: https://github.com/hypertask-ai/reviewer/actions/runs/<live review run ID>
target: https://github.com/hypertask-ai/hypertask/pull/<reviewed PR number>
head: <full reviewed PR commit>
```

Both runs must complete successfully on that exact engine commit and `main`.
CI must use `ci.yml`, a push or manual dispatch, and a successful `test` job.
The live run must use `review.yml`, a repository dispatch naming the recorded
PR and head, and a successful review step. Both published review statuses on
that head must point to the recorded live run and succeed. Missing, mismatched,
failed, skipped or unreadable evidence refuses deployment proof.

Other target reviews can return CONCERNS on the same engine commit. They are
not deployment tests for this recorded release. This narrow proof does not
change target PR approval, release containment, systemd verification, or the
no-release checks for other repositories.
