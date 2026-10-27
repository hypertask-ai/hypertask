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

## Short task-writer rollout

The short-style change requires separate release approval. Before merging it,
keep its PR held; do not treat the recorded baseline as candidate-model proof.
After approval and deployment:

1. Run the 22-case live eval and compare writer violations against its baseline.
2. Require ordinary descriptions below 240 visible words, without Hypothesis or
   ICE headings. Use a synthetic IGSH-914-style case, not customer ticket text.
3. Require requested A/B sections, source-grounded Control and consistent ICE
   totals when board instructions or a matching template request them.
4. Test an ordinary bug on the same A/B board: no experiment-only layout.
5. Disable the ticket flag only through the approved switch path and verify the
   previous writer behavior. Preserve board instructions and templates throughout.

## Cleanup

Only run-created QA Sandbox 7049 tickets are soft-deleted and read back.
A failed cleanup leaves IDs in the status artifact for recovery.
