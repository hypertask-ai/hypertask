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
