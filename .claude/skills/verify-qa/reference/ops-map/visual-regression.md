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

For timing-only instrumentation, one successful PR run and one successful released-code dispatch suffice; three runs remain required for flake fixes. Save the five-row phase table and its matching log line. Sum the five phase durations and compare with GitHub's `Build and capture base, then compare head` step timestamps; the gap must be at most 30 seconds. Record whether the rendered summary was actually reachable; log reconciliation and exact-output tests do not prove visual observation of GitHub's table.

For Next.js build-cache changes, collect three paired-build timing tables before and after. Inspect both restore steps for the selected production `nextjs-` key and successful extraction, then confirm both staging steps and all ten head comparisons completed. Production browser-smoke owns these archives; visual runs restore through `.next/cache` and move only that directory into each checkout. Record cold misses, fallback hits and screenshot-cache skips separately. Build caches must never skip head build/comparison or publish from a pull request. Historical runs on different commits/runners are descriptive, not a controlled speedup measurement.

## Cleanup

Nothing to clean: dispatched runs write only GitHub artifacts.

## Optional named pre-PR journey

Use `scripts/verify-qa <pushed-branch> inbox-cycle`; the helper mints a Runner App token and resolves the branch to its pushed SHA. To verify workflow changes before release, pass that branch again as the third argument. After release, omit it to use the production workflow.

Require doctor PASS with a disposable non-production identity, eight passing inbox steps, screenshots, and a successful artifact upload. Run `inbox-cycle-broken` separately: doctor must pass, the missing reminder assertion must fail, the job must fail, and evidence must still upload. Record full job and doctor/journey times separately. Verify the existing production push and PR visual routes remain enabled, while named journeys use their own non-cancelling concurrency group. Never run both controls concurrently; one hosted slot is shared globally. This proves fixture behavior, not production delivery or real AI quality.
