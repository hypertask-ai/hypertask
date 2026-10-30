## Vercel ignored builds

`vercel.json` runs `node scripts/vercel-ignore-build.cjs` before dependency installation.
Exit 0 cancels the build; exit 1 continues it. The comparison uses
`VERCEL_GIT_PREVIOUS_SHA`, the last successful deployment for this project and branch,
and `VERCEL_GIT_COMMIT_SHA`. It never substitutes `HEAD^`, so app changes earlier in
a batch still deploy. Vercel's [turbo-ignore implementation](https://github.com/vercel/turborepo/blob/main/packages/turbo-ignore/src/get-comparison.ts)
uses the same previous-deployment variable.

Only documentation, skills, CI and tests can skip: `docs/`, `.claude/`,
`.agents/skills/`, `skills/`, `.github/`, `tests/`, `e2e/`, and root Markdown files.
Everything else builds, including source Markdown, assets, Prisma, package files,
`vercel.json`, build scripts, packages, types and build configuration. Unknown,
missing, shallow, divergent or empty deployment comparisons build rather than skip.
Renames include the removed path, preventing a source-to-docs move from hiding app changes.

Production health and drift checks use the same command with `--between <live> <tip>`.
This mode accepts identical trees: a live build needs no replacement after an empty
commit. Canceled deployments retain the existing push-health behavior; scheduled
core-action, drift and Pusher checks keep running. The cron definitions are unchanged.
No workflow, preview or required-check gate is disabled.
