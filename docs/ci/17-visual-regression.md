## Visual regression (informational v1)

`Visual Regression` (`.github/workflows/visual-regression.yml`) reports `visual-regression` on production pushes and on manual runs, which accept `base` and `head` refs.
Pull-request comparisons run as `visual-compare` in `.github/workflows/ci-tests.yml`, on non-draft production PRs touching screen or harness files (`.github/scripts/visual-change-scope.cjs` holds the list); HYCI-10 moved them there so the head reuses the one app build instead of building a second time; HYCI-77 made it need only that build, so it runs alongside the four page shards instead of after their summary.
Base always builds from its own checkout with a fresh disposable database and creates temporary expected PNGs; head compares against them.
Each base build restores the production browser-smoke Next.js incremental cache using that checkout's lockfile/config hash and resolved commit, with the same compatible-hash fallback. Restore uses the producer's `.next/cache` archive path, then moves only that directory into the matching checkout before building. Visual runs never publish shared build caches; the `browser-smoke-desktop` half remains the only producer. A screenshot-cache hit skips the unused base restore, and production baseline-only runs skip the unused head restore. Cold misses still build and compare normally.
The job summary reports five phase timings and one matching log line: base build, base seed+capture, head build, head seed+capture and compare. A pull-request comparison that reuses the shared build reports four phases and says so, because it never runs `next build` for the head. Build rows measure only `next build`; seed+capture includes setup, readiness and teardown. Head capture and comparison share one Playwright command, charged to compare. Partial failures retain elapsed timings and mark unreached phases explicitly.
Base and head must install the same Playwright version, so one Chromium build draws both sides; a run stops when they differ and a Playwright bump needs fresh production baselines. Each checkout must also install exactly the version its own `package-lock.json` locks, and a cached base is compared against the base commit's locked version. Chromium captures board, task detail, the scrolled comment-box scene, Ctrl+J and inbox in Porcelain at 1440×900 and 390×844.
On failure, download `visual-regression-diffs` (7-day retention) and compare each screen's expected, actual and diff PNGs; the step summary lists failed screens or setup failures.
Production pushes capture the ten base PNGs once and save them with `actions/cache`.
PRs and manual comparisons restore only the exact key: base SHA, OS/architecture,
runner image version, and the head visual harness, seed, search stub, paired runner
and workflow hashes. There are no fallback keys; changed harnesses miss the cache.
Only successful production pushes save; PR-created caches cannot supply production
baselines. A hit validates all ten PNG signatures and viewport dimensions, skips
the base lifecycle, and still seeds and compares the head. A miss retains
the existing paired lifecycle. Missing or malformed cached screenshots fail closed.
Phase timings mark skipped base work as `not reached`; summaries name cache reuse.
Only PNGs are cached, never databases, auth state or browser traces.

An intended visual change is approved by a human in the PR description with `Visual change approved: <ticket URL>`; the job still shows the diff and does not auto-approve it.
This v1 signal is not required by a ruleset and does not replace existing browser-smoke, layout locks or premerge evidence. No committed PNG baselines or storage-state artifacts are used.
