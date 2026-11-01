# Production build memory

Ticket: https://app.hypertask.ai/detail/project-4060/184

## Change

`experimental.webpackBuildWorker: true` releases each compiler's heap before page collection and output file tracing. `cpus: 2` prevents page workers from scaling with the host CPU count. `webpackMemoryOptimizations: true` enables Next's string interning and avoids caching both string and buffer copies of webpack sources. Production tracing remains sequential; the existing CI smoke tracing stays parallel.

No heap cap, tracing exclusions, removed source maps, paid machine upgrade, or additional skipped checks.

## Local cold-build evidence (2026-10-04)

Base: `6539e3ccc`. Ubuntu, Node 24.21.0, Next 16.3.6, 18 logical CPUs. Dependencies installed with `npm ci --no-audit --no-fund`; each run started without `.next`.

Both runs used the unchanged package build script:

```sh
/usr/bin/time -v npm run build
# npx prisma generate && next build --webpack && node scripts/run-production-migrations.mjs
```

`vercel.json` specifies crons only, with no build-command override. No `CORE_APP_SMOKE`, `NODE_OPTIONS`, bundle analysis, font mocks, or build-directory override was set. Local-only database/session placeholders prevented access to production services. Production migrations intentionally skipped outside Vercel; no live database was touched. PostHog upload credentials were absent, so remote source-map uploading was not measured.

A separate sampler started the timed command in a new process group, then summed RSS for every process in that group from `/proc/<pid>/stat` every 200 ms. This includes npm, Prisma, Next and all child workers. GNU time's maximum RSS is the largest individual process, **not** the simultaneous process-tree total. Summed RSS conservatively counts shared pages more than once and is not a Vercel cgroup measurement.

| Measurement | Before | After |
| --- | ---: | ---: |
| Process-tree peak RSS | 10,312,110,080 bytes (9.604 GiB) | 5,738,471,424 bytes (5.344 GiB) |
| GNU time maximum RSS | 5,832,780 KiB | 5,351,232 KiB |
| Page-collection peak RSS | 9.604 GiB | 1.281 GiB |
| Finalization/tracing peak RSS | 5.141 GiB | 1.621 GiB |
| Page workers | 17 | 2 |
| Build exit status | 0 | 0 |
| Sampler elapsed time | 845.54 seconds | 722.38 seconds |

Peak RSS fell 44.4%. The final build uses 5.74 decimal GB, leaving about 2.26 GB below an 8 GB machine. Build times are single observations on a shared host, not a speed benchmark. An intermediate workers-only cold build peaked at 5.571 GiB; Next's memory optimization reduced the final peak further.

The baseline kept roughly 5.94 GB in the main Next process while 17 page workers added roughly 4.30 GB. Compilation was explicitly webpack, not Turbopack. The install occupied 2.4 GB, but pruning traced dependencies was unnecessary. Typechecking was already skipped inside Next and separately gated in CI; Next 16 does not run lint inside the build.

## Output and regression checks

- Both outputs contain 577 route trace manifests, the same 7,301 unique traced `node_modules` paths, and 429 client source maps. No dependency paths were removed.
- `npm start`, followed by curl: `/` returns the expected 307 login redirect; following it returns HTTP 200 and 40,304 bytes of HTML. `/api/version` returns HTTP 200 and the build's public ID. Server stopped after testing.
- 51 targeted tests pass, including memory config in normal/smoke modes and through the real PostHog config wrapper, webpack aliases, sanitizer runtime assets, redirects and build ID handling.
- Full repository lint passes with 21 existing warnings and no errors; final touched-file lint passes without warnings.

Vercel logs/API access was unavailable. These are local measurements, not claims that the two failed cloud builds were reproduced on identical hardware. Vercel's environment-dependent PostHog upload and production migration steps still need the owning session's deploy verification.

## Heap cap 5 GB (2026-10-24)

Ticket: https://app.hypertask.ai/detail/project-4060/650

Production builds for d92ae07cf and 3f9488694 were killed with a Vercel Out of Memory event during "Creating an optimized production build". No build settings changed after the last good build (7c5de02bf); the added code was mostly server routes.

Next passes `NODE_OPTIONS` to the webpack build worker unchanged (`isolatedMemory: false` in `next/dist/build/webpack-build`), so the 6 GB cap let the compiler heap reach 6 GB on an 8 GB machine, leaving too little for native memory and the parent process. The cap is now 5120 MB. If the heap ever needs more, the log says "Reached heap limit" instead of a silent kill, which gives the real heap size for the next step.

## Heap cap 4 GB (2026-10-30)

Ticket: https://app.hypertask.ai/detail/project-4060/957

Every production deployment from 17:14 on died the same way as the two in the 5 GB note: "Next.js build worker exited with code: null and signal: SIGKILL" two to five minutes into "Creating an optimized production build", with Vercel reporting an Out of Memory event. The last green build was 4425ce73e (HTPR-8209); the first red one was 81e7eb735 (HTPR-7582), which added an MCP tool pair, one API route, one cron and a Prisma model. That release is the straw, not the weight: it added no heavy import, and the two releases after it that touched almost nothing (db7d7b63a, ad89e20cc) failed at the same place.

The 5120 MB cap therefore no longer describes the build. Vercel's standard build machine has 8 GB, and the compiler heap is only one term in the process tree: the parent Next process, native webpack and minifier memory, and the single page worker share the rest. A silent SIGKILL rather than "JavaScript heap out of memory" says the container, not V8, hit the ceiling, so the heap was still inside its cap while the tree was not.

The cap is now 4096 MB, half the machine, so native memory and the parent process keep the other half. `tests/build-memory-config.test.cjs` fails if the cap ever rises above half the build machine again. If this build reports "Reached heap limit", the compiler genuinely needs more than 4 GB, and the next step is the paid Enhanced Build Machine, which is Valentin's decision.

## Turbopack cache eviction (2026-11-01)

Ticket: https://app.hypertask.ai/detail/project-15/8244

The build moved to Turbopack in HTPR-8245. The first Turbopack production deployment,
`ea23ee008` (deployment `dpl_92NFG73VbLGkAHiUV5b3umZVaDaB`), died with
`Command "npm run build" exited with 137` and Vercel's Out of Memory event during
"Creating an optimized production build", while the same build finished in 105 s on a
CI runner and in both browser halves.

`experimental.turbopackMemoryEviction: "full"` is the lever that fits this build. The
4096 MB cap above limits V8 in the Next process; Turbopack's own cache lives in a
separate native process that the cap does not touch, and the default `"auto"` eviction
did not release it early enough for an 8 GB machine. `"full"` evicts as the build
progresses. `tests/build-memory-config.test.cjs` fails if that setting or the heap cap
is dropped.

If a Turbopack build still dies with 137 at this setting, the next levers are turning
`productionBrowserSourceMaps` off (PostHog would lose its maps) and the paid Enhanced
Build Machine, which is Valentin's decision.
## Back to webpack after the Turbopack switch (2026-11-01, HYCI-60)

Ticket: https://app.hypertask.ai/detail/project-11514/60

HTPR-8245 moved every build to Turbopack and dropped `--webpack` from the
production build command. `experimental.webpackBuildWorker`,
`webpackMemoryOptimizations` and `cpus` are webpack-only settings, so the levers
in the notes above stopped applying, and Turbopack's own memory is native: the
`NODE_OPTIONS` heap cap cannot bound it.

Two Turbopack Production deploys were killed with exit 137 on Vercel's 8 GB
machine, both with Vercel's Out of Memory event during "Creating an optimized
production build":

| Commit | Turbopack setting | Killed at | Log |
| --- | --- | --- | --- |
| `ea23ee008` | default | 13m 57s | `hypertasks-prod-jdxosr0hq`, `dpl_92NFG73VbLGkAHiUV5b3umZVaDaB` |
| `16617d97e` | `turbopackMemoryEviction: "full"` (HTPR-8244) | 5m 32s | `dpl_E388XZ4HHbbtsXKDrGnWTERujmmG` |

Every Production deploy before the switch was Ready with the webpack build in 4
to 7 minutes, and HTPR-8244's own mock fix made `app-smoke` green again, so the
only thing still red was the shipped build itself.

The change here is one word: the production build passes `--webpack` again, so
the build that ships is the build the memory levers were measured on. The
`turbopack` block and its eviction setting stay in `next.config.js`, and the CI
jobs that build with `npx next build` keep exercising Turbopack on GitHub's
16 GB runner, so a later attempt still starts from a green compile.
`tests/build-memory-config.test.cjs` fails if the production build command drops
`--webpack` again, so returning to Turbopack needs a measured green Production
deploy instead of a one-word edit.

The same revert covers the smoke harness, which is read from `production`.
`app-smoke` builds the candidate with the builder production ships (HYCI-49), so
`scripts/run-app-smoke-isolated.sh` passes `--webpack` as well until the shipped
build is Turbopack again. `tests/app-smoke-workflow.test.cjs` fails if that flag
goes missing.
