# Feature-flag and UX sign-off gates

## How a customer reaches it

The feature-flag-gate and ux-signoff checks on pull requests to production use trusted production code and post commit statuses. Feature-flag PR events evaluate only their target; fleet reconciliation runs on a fifteen-minute schedule. This is infrastructure, with no app UI or account writes.

## How to drive it

After merge, observe the next production pull-request event. Require the per-PR feature-flag job to succeed and the fleet job to skip. Then observe two scheduled runs: only the fleet job should run. GitHub may delay scheduled starts; do not generate PR events to force fleet sweeps.

- The first run after a change to the status format judges every open PR once (`evaluated N, skipped 0`).
- A later run within 30 minutes skips PRs whose head, base, title and labels are unchanged (`skip #N: unchanged since its last status under 30 minutes ago`, then `evaluated N, skipped M`).
- A rate limit shows as `GitHub API rate limited; waiting Ns until reset` and then a normal result, or as `::warning::skipped: GitHub rate limited until <time>` with a green job and no error status.

The positive control is the per-PR feature-flag-gate job: it still judges and posts its own result. PR and fleet runs retain the same non-cancelling concurrency group so a sweep cannot race a PR verdict. The group uses GitHub `queue: max` to retain up to 100 pending PR runs; a burst beyond that limit cancels new arrivals until scheduled reconciliation. Inspect the production workflow for that setting and retain a queued-run example when available.

## What usually breaks

- A rate limit turning into a red check or an error status instead of a wait or a clean skip.
- A wait after the verdict letting a stale approval be posted (title, labels, shared head or ticket approval changed during the wait).
- The skip keeping a green for a fork PR, a shared head or a PR whose labels changed.
- A genuine API failure (plain 403, 404, 500) ending green.

## What proof to collect

Save a post-merge PR run showing target success and fleet skip, plus two scheduled runs showing the inverse job selection. Keep fleet logs with `evaluated N, skipped M` and any quota or infrastructure failures. A format change requires the first full judge and following skipping run; an unchanged format can skip immediately. Doctor: the merge sha on origin/production. Record run ids, never tokens.

### Automated evidence

`node --test tests/feature-flag-reconcile-workflow.test.cjs` exercises unchanged-PR skipping, metadata invalidation, rate-limit handling and genuine API failures with workflow fixtures.
`node --test tests/ux-signoff-gate.test.cjs` exercises UX verdicts and reconciliation, including rate-limit skips without stale approval and refusal of ordinary API failures.

## Imported formatter gates

The evaluator entry point is `evaluate` in `.github/scripts/feature-flag-gate.mjs`.
After deployment, read the trusted feature-flag check on a production PR that passes its ticket flag through an imported formatter (for example, https://github.com/hypertask-ai/hypertask/pull/2237).
Require the check's `ffg=` stamp to identify production containing the repair; an older passing status is not live proof.
Do not change that PR, its flag, or its ticket during verification.

Hosted `tests/feature-flag-gate.test.cjs` must prove all five formatter groups: aliased parameters, explicit live return branches, rendered consumers, return truthiness and invariant guards.
These fixtures exercise the real `evaluate` entry point with committed repositories, not copied helpers.
The allowed controls include relative and `@/` imports, top-level early returns and boolean negation.
Refused controls include ignored or overwritten parameters, nested contradictory guards, exception overrides, invariant comparisons, conditional guards, parameter defaults and discarded output.
Save the tested head SHA, hosted run URL and successful group lines.
A local AST reproduction supplements those results; it does not replace evaluator or trusted-workflow proof.
No app output changes, so theme screenshots and customer-data writes are unnecessary.

## Cleanup

None. Nothing is created.
