# Production build and deploy

## How a customer reaches it

Indirectly: every merge to `production` triggers a Vercel build of the hypertasks-prod project. When the build fails, app.hypertask.ai keeps serving the last good version and no merged change goes live. This is infrastructure, with no app UI or account writes.

## How to drive it

Merge to `production`, then read the commit's `Vercel` status (`gh api repos/hypertask-ai/hypertask/commits/<sha>/status`) until it is `success` or `failure`. Read the build log with `vercel-ht inspect <deployment url or dpl id> --logs`. Branches get no Vercel preview in this project, so the production build after merge is the proof. A failed build leaves the live site on the last good version.

## What usually breaks

- The Next.js build worker is killed (SIGKILL) and Vercel reports an Out of Memory event. The build container has 8 GB. Build memory is set in `next.config.js` (`experimental.cpus`, `webpackBuildWorker`, `webpackMemoryOptimizations`) and by the `NODE_OPTIONS=--max-old-space-size` cap on `next build` in `package.json` (YPER4-571).
- Build time creeping toward the Vercel limit after a memory setting is lowered.

## What proof to collect

- The Vercel status `success` and the deployment status Ready for the merge sha.
- The build log lines for the CPU count, compile time, static pages and `Build Completed`, with no SIGKILL or Out of Memory.
- For a fix, the matching lines from the last failing build.

## Cleanup

None.
