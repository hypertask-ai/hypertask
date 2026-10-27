# Production build and deploy

## How a customer reaches it

Indirectly: every app-changing merge to `production` triggers a Vercel build of the hypertasks-prod project. When the build fails, app.hypertask.ai keeps serving the last good version and no merged change goes live. This is infrastructure, with no app UI or account writes.

## How to drive it

Merge to `production`, then read the commit's `Vercel` status (`gh api repos/hypertask-ai/hypertask/commits/<sha>/status`) until it is `success` or `failure`. Read the build log with `vercel-ht inspect <deployment url or dpl id> --logs`. Branches get no Vercel preview in this project, so the production build after merge is the proof. A failed build leaves the live site on the last good version.

## What usually breaks

- The Next.js build worker is killed (SIGKILL) and Vercel reports an Out of Memory event. The build container has 8 GB. Build memory is set in `next.config.js` (`experimental.cpus`, `webpackBuildWorker`, `webpackMemoryOptimizations`) and by the `NODE_OPTIONS=--max-old-space-size` cap on `next build` in `package.json` (YPER4-571).
- Build time creeping toward the Vercel limit after a memory setting is lowered.

## What proof to collect

- The Vercel status `success` and the deployment status Ready for the merge sha.
- The build log lines for the CPU count, compile time, static pages and `Build Completed`, with no SIGKILL or Out of Memory.
- For a fix, the matching lines from the last failing build.

### Automated evidence

`node --test tests/build-memory-config.test.cjs` checks the build worker, memory optimizations and single-CPU settings with smoke and PostHog on and off; it does not run a production build or prove deployment success.

## Cleanup

None.

## Production revert proposals

In GitHub Actions, dispatch Production Revert Proposal on production with failed CI run `40201291546`. Manual replay must identify culprit `73cc4b70870fb411935a3a169779a8fb8b49f168` and skip the publisher. Never manufacture a production break to test publication.

Automated evidence: `production-revert-check.yml` checks six real-Git fixtures and historical causal replay on relevant PRs. The fixtures prove later-work preservation, flaky/rate-limit/timeout refusals, output/hook isolation, and partial publication recovery. Only the GitHub PR transport is faked. Keep the run URL and logs. Probe worktrees clean themselves; manual replay creates no live branch or PR.

## Ignored builds

`vercel.json` runs `node scripts/vercel-ignore-build.cjs` before dependency installation.
For a merge containing only skills, documentation, CI or tests, collect the deployment
record and ignored-step log showing `Skip build` and Canceled/Skipped. Confirm that
`/api/version` still serves the last successful app deployment. For an app-changing
merge, collect Ready and its matching version SHA. A docs merge after an undeployed
app change must build: compare the last successful deployment, never just `HEAD^`.

Keep the cron list unchanged. Check the next scheduled production-health drift and
core-action runs; a tests-only gap must not cause drift alarms. Record production
build counts for each of the three UTC days after rollout from deployment records,
separating canceled/skipped rows from builds. Never infer saved cost from counts alone.

Automated evidence: `node tests/vercel-ignore-build.test.cjs` exercises the configured
command against disposable Git histories; `node tests/prod-health-workflow.test.cjs`
replays the actual health and drift shell entry points. Neither proves provider-side
skipping or future daily build totals.
