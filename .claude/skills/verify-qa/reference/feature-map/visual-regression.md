# Visual Regression check

## How a customer reaches it

The Visual Regression job in a pull request's GitHub checks (`.github/workflows/visual-regression.yml`). It builds the base and the head, seeds the same disposable board, and compares Porcelain screenshots of board, task-detail, comment-box, ctrl-j and inbox on desktop and phone (`e2e/visual/visual.spec.ts`, `scripts/visual-regression-ci.mjs`). This is infrastructure, with no app UI or account writes.

## How to drive it

After the change is merged and its production deployment succeeds, dispatch the workflow on production against itself: `gh workflow run visual-regression.yml -R hypertask-ai/hypertask --ref production -f base=production -f head=production`. Run it one at a time: the workflow's concurrency group cancels an overlapping run on the same ref. A flake fix needs at least three green runs on one commit, with no retries, skips or masks added.

Read the run log for the per-screen lines (`[desktop] › ... › inbox (Ns)`). A screen that waits for an asset shows a longer base capture than before the fix.

## What usually breaks

- Settling before an image whose src is set after mount (the inbox-zero photo) has loaded, so base and head differ by timing.
- Decoding an image that failed to load, which throws instead of settling.
- Adding retries, `mask:` or `clip:` to hide a real difference.
- A test change that only lands in head: `scripts/visual-regression-ci.mjs` copies head's `e2e/visual` into the base checkout, so both sides use the same spec.

## What proof to collect

Run ids, conclusions and head SHAs of three consecutive green runs; the log lines with per-screen capture times; the downloaded `visual-regression` artifact PNG for the screen in question. Doctor: merge SHA production deployment success. Record no credentials.

## Cleanup

Nothing to clean: dispatched runs write only GitHub artifacts.
