# Feature-flag and UX sign-off gates

## How a customer reaches it

The feature-flag-gate, reconcile-feature-flag-gate and ux-signoff checks on every pull request to production. They run from production code through `pull_request_target` and post commit statuses. This is infrastructure, with no app UI or account writes.

## How to drive it

After the change is merged, wait for the next pull request event on production; any runner push is enough. Read the reconcile job log of that run and the one after it.

- The first run after a change to the status format judges every open PR once (`evaluated N, skipped 0`).
- A later run within 30 minutes skips PRs whose head, base, title and labels are unchanged (`skip #N: unchanged since its last status under 30 minutes ago`, then `evaluated N, skipped M`).
- A rate limit shows as `GitHub API rate limited; waiting Ns until reset` and then a normal result, or as `::warning::skipped: GitHub rate limited until <time>` with a green job and no error status.

The positive control is the per-PR feature-flag-gate job in the same run: it still judges and posts its own result.

## What usually breaks

- A rate limit turning into a red check or an error status instead of a wait or a clean skip.
- A wait after the verdict letting a stale approval be posted (title, labels, shared head or ticket approval changed during the wait).
- The skip keeping a green for a fork PR, a shared head or a PR whose labels changed.
- A genuine API failure (plain 403, 404, 500) ending green.

## What proof to collect

The run ids and reconcile job logs for the first full judge and the following skipping run, with the `evaluated N, skipped M` lines and a search for `::error::` and `API rate limit exceeded` in both. Doctor: the merge sha on origin/production. Record run ids, never tokens.

## Cleanup

None. Nothing is created.
