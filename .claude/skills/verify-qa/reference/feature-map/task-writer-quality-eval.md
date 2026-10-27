# Task writer and chip evaluation

## How a customer reaches it

GitHub Actions: Task writer live eval. No app UI changes.
Sources: `scripts/task-writer-eval.cjs`, `.github/workflows/task-writer-eval.yml`.

## How to drive it

1. Confirm the merge's Production deployment succeeded.
2. Dispatch Task writer live eval on `production`.
3. Require QA identity 985 and all 22 cases.
4. Read score and cleanup artifacts, not only the job badge.
5. Replay the committed baseline with `node scripts/task-writer-eval.cjs --verify-baseline`.

## What usually breaks

- Raw writer markers are saved instead of parsed descriptions.
- A chip requests a section already present.
- Empty chip fallbacks masquerade as model success.
- Missing cases, transport errors or cleanup failures appear green.
- QA credentials reach candidate code or artifact uploads.

## What proof to collect

Save the successful production workflow run, its exact head SHA, scores and
pending-ID report. Known baseline violations are measured debt, not healthy text.
The long non-A/B control must fail; finished synthetic A/B controls must pass.
Synthetic cases contain no customer text. Historical pair provenance follows
https://app.hypertask.ai/detail/project-15/7976#comment-314535.

## Cleanup

Only run-created QA Sandbox 7049 tickets are soft-deleted and read back.
A failed cleanup leaves IDs in the status artifact for recovery.
