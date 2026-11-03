## Visual regression (informational v1)

`Visual Regression` (`.github/workflows/visual-regression.yml`) reports `visual-regression` on production pushes and on manual runs, which accept `base` and `head` refs.
Pull-request comparisons run as `visual-compare` in `.github/workflows/ci-tests.yml`, on non-draft production PRs touching screen or harness files (`.github/scripts/visual-change-scope.cjs` holds the list); HYCI-10 moved them there so the head reuses the one app build instead of building a second time; HYCI-77 made it need only that build, so it runs alongside the four page shards instead of after their summary.
Base always builds from its own checkout with a fresh disposable database and creates temporary expected PNGs; head compares against them.
HYCI-82 publishes those ten validated expected PNGs from the production capture as a `visual-baseline-<image>-<render source>-<harness hash>` artifact as well as the cache entry. The 2 MB baseline shares a 10 GB cache pool with the build caches, so recent production baselines are usually evicted before a pull request asks for them: eight of the twelve captured on 2026-11-01 and 2026-11-02 were already gone, and each miss rebuilt the base app for 333 s of a 513 s step. `visual-compare` now restores the cache entry first and falls back to the newest unexpired artifact with that exact name before it builds anything; an artifact counts only when a successful `visual-regression.yml` run on a production push at the base commit produced it (`.github/scripts/published-baseline.mjs`), because the artifact list filters by name alone and a pull request could otherwise publish the screenshots another pull request compares against. Both paths hand the existing cache-hit branch ten validated screenshots, so the base build, its Next.js cache restore and its capture are skipped together. A miss still builds the base exactly as before.
Each base build restores the production browser-smoke Next.js incremental cache using that checkout's lockfile/config hash and resolved commit, with the same compatible-hash fallback. Restore uses the producer's `.next/cache` archive path, then moves only that directory into the matching checkout before building. Visual runs never publish shared build caches; the `browser-smoke-desktop` half remains the only producer. A screenshot-cache hit skips the unused base restore, and production baseline-only runs skip the unused head restore. Cold misses still build and compare normally.
The job summary reports five phase timings and one matching log line: base build, base seed+capture, head build, head seed+capture and compare. A pull-request comparison that reuses the shared build reports four phases and says so, because it never runs `next build` for the head. Build rows measure only `next build`; seed+capture includes setup, readiness and teardown. Head capture and comparison share one Playwright command, charged to compare. Partial failures retain elapsed timings and mark unreached phases explicitly.
Base and head must install the same Playwright version, so one Chromium build draws both sides; a run stops when they differ and a Playwright bump needs fresh production baselines. Each checkout must also install exactly the version its own `package-lock.json` locks, and a cached base is compared against the base commit's locked version. Chromium captures board, task detail, the scrolled comment-box scene, Ctrl+J and inbox in Porcelain at 1440×900 and 390×844.
On failure, download `visual-regression-diffs` (7-day retention) and compare each screen's expected, actual and diff PNGs; the step summary lists failed screens or setup failures.
HYCI-99 keys a baseline on the render source it was captured from, not on the base
commit: OS/architecture, runner image version, a SHA-256 over the base commit's tracked
render files (everything outside `docs`, `tests`, `.github` and `.claude`), and the
head visual harness, seed, search stub, paired runner and workflow hashes.
Documentation, agent and CI commits cannot change a pixel, so they reuse the screens
already captured for the same app source instead of rebuilding it, while any change
under the app source, `public`, the lockfile or a config still misses and rebuilds.
An empty render source fails the job rather than keying every screen to one baseline.
The artifact name and the cache key carry the same fingerprint; the commit itself is
no longer part of either, so a production commit whose own capture was cancelled,
evicted or skipped still reuses an identical tree's screens. There are no fallback keys.
Production pushes still capture the ten base PNGs whenever the key misses. Any run
that captured and validated them saves the cache entry, which GitHub scopes to its
own branch or pull request; only a production push can publish the artifact another
pull request compares against. A hit validates all ten PNG signatures and viewport
dimensions, skips the base lifecycle, and still seeds and compares the head. A miss
retains the existing paired lifecycle. Missing or malformed cached screenshots fail
closed.
Phase timings mark skipped base work as `not reached`; summaries name cache reuse.
Only PNGs are cached, never databases, auth state or browser traces.

An intended visual change is approved by a human in the PR description with `Visual change approved: <ticket URL>`; the job still shows the diff and does not auto-approve it.
This v1 signal is not required by a ruleset and does not replace existing browser-smoke, layout locks or premerge evidence. No committed PNG baselines or storage-state artifacts are used.
