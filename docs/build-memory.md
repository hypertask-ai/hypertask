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

`experimental.turbopackMemoryEviction: "full"` (HTPR-8244) did not save it: the first deployment
that carried it, `16617d97e`, failed the Vercel build at 09:37 UTC. The `--webpack` pin below is
what puts production back on a build the heap cap describes.

## Builder pinned to webpack (2026-11-01)

Ticket: HYCI-61, https://app.hypertask.ai/detail/project-11514/61

HTPR-8245 dropped `--webpack` from the production build so Next picked its default builder, which in Next 16.4.2 is Turbopack. Every production deployment from the switch on was killed: ea23ee008 (09:18 UTC) and 7a0a7d7f6 (09:33 UTC) both exited 137 during "Creating an optimized production build" after about 14 minutes, and Vercel reported "At least one Out of Memory ("OOM") event was detected during the build". The last green production deployment was daa9d881b at 06:44 UTC, built with `next build --webpack`.

The 4 GB cap above bounds the V8 heap of the webpack builder. Turbopack compiles in Rust, so `--max-old-space-size` never applied to it, and no Turbopack build-mode option in Next 16.4.2 caps its allocation. The heap cap was therefore no longer describing the build: the container was killed with no heap message, exactly the signature the 4 GB note describes for a process tree that outgrows the machine rather than a V8 heap that reaches its limit.

The build script now names `--webpack` again. `next.config.js` keeps both the `webpack` hook and the `turbopack` resolveAlias block, so the Turbopack move is one flag away once it fits the machine. Two checks keep this honest: `tests/build-memory-config.test.cjs` fails when the build script stops naming a builder (an implicit builder is one Next default flip away from the same OOM), and `scripts/visual-regression-ci.mjs` mirrors the production builder from `package.json`, so the visual base build follows automatically.

CI keeps building with Turbopack in the browser-smoke shards, so the whole app still compiles under Turbopack on every pull request; only the deployment that has to fit an 8 GB container is pinned. Returning production to Turbopack needs a memory answer for the Rust side, which is a new ticket, not a flag flip.

## Webpack parallelism 4 (2026-11-03, HTPR-8342)

Ticket: https://app.hypertask.ai/detail/project-15/8342

Three production deployments died with `errorCode: out_of_memory`: cbc040ab5 (dpl_8CpuFJWk2xShpJKcvEhft83Yob56), 8946d1d84 (dpl_7CvromTmUM13WyKfnAgLmuz5QBZF) and b422a7f6a (dpl_9egRM7GKVkK3pvRFyJZTUBEdmzgR). The last green build was 6e7e854ff (dpl_HqfHnxtxWdbWXJSDD81VaovYSrFL); one retry of 8946d1d84 (dpl_CXDHvMBxjpdkB5KQDZDBf3XfVDxZ) was READY, so the build sits on the ceiling rather than over it.

The failing log names the phase and rules out the heap cap:

```
✓ Running next.config.js took 1310ms
  Creating an optimized production build ...
Next.js build worker exited with code: null and signal: SIGKILL
• At least one "Out of Memory" ("OOM") event was detected during the build.
```

The kill lands 140 seconds into the first client compile, before any compiler output, with the 4096 MB cap from the YPER4-957 note still in place and no "Reached heap limit" anywhere. So the container filled while the compiler heap was still inside its cap: the missing term is native memory, and the build script left it unbounded.

Webpack limits concurrent module builds with `parallelism`, default 100. Next only overrides it from `NEXT_WEBPACK_PARALLELISM` (`getParallelism` in `next/dist/build/webpack-config`), so the production build ran up to 100 module builds at once. Each in-flight module is an SWC transform whose AST lives in Rust memory, outside the V8 heap that `--max-old-space-size` bounds, and `experimental.cpus` does not reach it.

The build script now sets `NEXT_WEBPACK_PARALLELISM=4`, one concurrent module build per core of Vercel's standard 4 vCPU / 8 GB build machine, so the native side of the compile scales with the cores that actually run it instead of with a queue depth of 100. `tests/build-memory-config.test.cjs` fails if the cap is dropped or raised above the core count.

If the next production build still reports `out_of_memory`, the parallelism is not the binding term: the fallback is 2, then 1, and after that the compiler genuinely needs more than an 8 GB machine, which makes the paid Enhanced Build Machine Valentin's decision.

## Webpack parallelism 2 (2026-11-03, HYCI-98)

Ticket: https://app.hypertask.ai/detail/project-11514/98

The parallelism 4 cap from HTPR-8342 did not fit the graph the app compiles today. It is a real reduction (the cap is read: `getParallelism` in Next 16.4.2, `next/dist/build/webpack-config.js:712`, and it is ignored only when `experimental.slowModuleDetection` is on in dev), but the 8 GB machine still fills.

Measured from the production deployment record and the build logs, not from a local build:

| Fact | Value |
| --- | --- |
| Production builds with the 4 cap in place (01:59 to 05:10 UTC) | 19 |
| Of those OOM-killed | 2 (`6bcdd4d1` at 04:58, `4a60deed` at 05:10) |
| Green builds in the same window | 17, durations 4m 48s to 8m 36s |
| Kill point in `dpl_3fuD1HADKbaphgV2MXy2XBCh9vcS` | 87 s into "Creating an optimized production build", compiler output still empty |
| Build machine | 4 vCPU, 8192 MiB, standard |

The failing log names the phase and rules out the heap cap again:

```
✓ Running next.config.js took 973ms
  Creating an optimized production build ...
Next.js build worker exited with code: null and signal: SIGKILL
• At least one "Out of Memory" ("OOM") event was detected during the build.
```

No "Reached heap limit" anywhere, so V8 stayed inside its 4096 MB cap while the container filled: the native term is still the binding one, and it scales with concurrency. Note that `6bcdd4d1` and `4a60deed` differ from the green builds only by which module graph they compile, so the build sits on the ceiling and trips when a merge adds enough code.

The build script now sets `NEXT_WEBPACK_PARALLELISM=2`, half of the 4 vCPU / 8 GB machine's cores. `tests/build-memory-config.test.cjs` fails if the cap is raised above 2 or dropped.

The expected cost is build wall-clock only, which the 45 minute build timeout leaves room for.

If a production build still reports `out_of_memory` at 2, the next step is 1. Below that, the remaining lever without money is the heap cap: lowering `--max-old-space-size` from 4096 makes V8 collect earlier and hands the difference to native memory, and if the heap is then genuinely too small the log says "Reached heap limit" instead of dying silently. After that the compiler needs more than an 8 GB machine, which is the paid Enhanced Build Machine and Valentin's decision.

## Parallelism 1 (2026-11-03)

Ticket: https://app.hypertask.ai/detail/project-15/8458

The 2 cap (HYCI-98, merged in `319f94d7a5` at 06:07:13 UTC) held for most of the day, then stopped holding. Measured from the GitHub deployment record and the two build logs, not from a local build:

| Fact | Value |
| --- | --- |
| Production deployments created after the 2 cap landed (to 21:36 UTC) | 64 |
| Of those green | 56 |
| Of those failed | 8 (`77c07358e1` 07:21, `f79e9a2f6d` 07:28, `c85a55ac24` 07:30, `58a2d31036` 18:50, `9e5741caf7` 18:51, `add252af48` 19:14, `1ad77dab18` 19:15, `6d7f0f149d` 20:27) |
| Confirmed `out_of_memory` from the build log | `58a2d31036` (`dpl_ASKr2CGug9kgdCsZjNHKMoc7KMz2`) and `9e5741caf7` (`dpl_4QPHMwemMHgrsuQdkBZpBg4nTTvo`) |
| Kill point in `dpl_4QPHMwemMHgrsuQdkBZpBg4nTTvo` | 117 s into "Creating an optimized production build", no module output yet |
| Green build wall-clock, 20:23 and 20:36 UTC | 17 min 42 s and 11 min 40 s, against the 45 minute build timeout |
| Live build served by the app | `dc91c23a26` at 19:03 UTC (the 18:36 green, two merges behind), `084cde6df8` at 21:36 UTC (caught up) |

Both confirmed kills are the same signature as the 4 cap: `SIGKILL` with no "Reached heap limit", so the V8 heap stayed inside its 4096 MB cap and the container filled from the native side. The six failures not confirmed from the build log are not readable from this host (no Vercel token, `api.vercel.com` unreachable); they cluster at the same ceiling and each was followed by a green deployment, so the app caught up on its own rather than needing a rebuild.

`e0209bbe59` (HTPR-8377) has no deployment record at all. Its build was superseded by the two later pushes on `production` before it started, so nothing was skipped by `scripts/vercel-ignore-build.cjs`; the merge is contained in the newer commits, so it needs no rebuild of its own.

The build script now sets `NEXT_WEBPACK_PARALLELISM=1`: one module build at a time, so the native side of the compile no longer adds a second SWC transform's AST on top of the first. `tests/build-memory-config.test.cjs` fails if the cap goes above 1 or is dropped. The expected cost is build wall-clock only. The margin is real but not unlimited: green builds measured 11 min 40 s to 17 min 42 s at the 2 cap, and if serialising the compile roughly doubles its share the build lands in the low thirties, still inside the 45 minute timeout. A build that does time out fails differently from these (a cancelled or timed-out deployment, not `SIGKILL` 117 s in), so the two are told apart from the deployment status.

If one module build at a time still reports `out_of_memory`, the same ceiling is being reached from a single module and the remaining lever without money is the heap cap below. After that the compiler needs more than an 8 GB machine, which is the paid Enhanced Build Machine and Valentin's decision.

## Heap cap 3072 MB (2026-11-07, HYCI-177)

Ticket: https://app.hypertask.ai/detail/project-11514/177

Parallelism was already 1. Four production deployments in a row were still killed the same way. The last green deployment was `bfd983c551` (`dpl_47MRwndU1miPr2qUxUDRm8aPLo6h`, 8192 MiB, 6m 32s). The first red one was `62545b20f2`, the merge of pull request 3044 (`dpl_GLxbLvxn5sV2YiHX8CJoDWUw7z1x`). The same kill then hit `ad8563f804`, `c15c1aa1d7` and `4b88cc8821` (`dpl_6UGLqqvaf3r6FmYBanTMxF3RNrRC`).

The failing log names the phase and rules out a V8 heap overflow:

```
✓ webpackBuildWorker
✓ webpackMemoryOptimizations
  Creating an optimized production build ...
Next.js build worker exited with code: null and signal: SIGKILL
• At least one "Out of Memory" ("OOM") event was detected during the build.
```

The kill lands about 130 seconds into the compile. There is no "Reached heap limit". The 4096 MB cap was still in the build script, so the worker could hold a 4 GB heap on an 8 GB machine while native SWC memory sat outside that cap. Pull request 3044 added no dependency and no build setting. It is the straw. The tree diff from the last green commit is about 1555 lines.

The build script then set `--max-old-space-size=3072`. `NEXT_WEBPACK_PARALLELISM` stayed 1 and the builder stayed `--webpack`. The guard test rejected a cap above 3072. The written next step, if a build then said "Reached heap limit", was the paid Enhanced Build Machine. A silent SIGKILL at 3072 would have been the same decision.

That heap-limit case arrived the same day. HYCI-184 measured it and raised the cap to 3584 MB instead of buying a larger machine. See the next section.

## Heap cap 3584 MB (2026-11-07, HYCI-184)

Ticket: https://app.hypertask.ai/detail/project-11514/184

The last green production deployment was `87a3b06a` (deployment 7627067597). The next production deployments failed while the build script still set `--max-old-space-size=3072`:

| Commit | Deployment | Log |
| --- | --- | --- |
| `2d07cb81ac` (first bad, merge of pull request 3038) | 7627757510 | `dpl_3nFWTzD4yPtksDH8sEtT6HKY6wDe` |
| `e41b16ad95` | 7627883408 | `dpl_J6DZH8eFqGiaSUdoKRuf5dr66TzA` |
| `c33489117f` | 7627998823 | GitHub recorded failure |

The first two logs die in "Creating an optimized production build" with:

```
FATAL ERROR: Ineffective mark-compacts near heap limit Allocation failed - JavaScript heap out of memory
```

Mark-compact had reduced the live set to about 2783 MB, and the worker was still running when V8 aborted. That is the 3072 MB heap cap, not the SIGKILL from HYCI-177. The build machine is still the standard 8192 MiB machine. Pull request 3038 changed 177 lines of flag defaults and added no dependency. The tree was already on the ceiling.

The build script then set `--max-old-space-size=3584`. That is 512 MB under the 4096 MB cap that SIGKILL'd the machine, and under half of 8192 MiB. `NEXT_WEBPACK_PARALLELISM` stays 1 and the builder stays `--webpack`.

That cap was not enough. Deployment 7628217481 (`51fcc525`, `dpl_9tg62h9sytSJHF5iEJKQeftXk7o2`) died in the same phase:

```
FATAL ERROR: Ineffective mark-compacts near heap limit Allocation failed - JavaScript heap out of memory
```

Mark-compact reduced 3096.9 MB to 3080.7 MB. The worker was still running, so the 8192 MiB machine was not full. HYCI-180 stepped the cap down from 4096 MiB for native headroom (below). If a heap abort lands at the chosen cap or another SIGKILL hits half the machine, the paid Enhanced Build Machine is Valentin's decision.

## Live-within-10-min incident (2026-11-07, HYCI-180)

Ticket: https://app.hypertask.ai/detail/project-11514/180

Fleet-watch opened this when only 87 percent of 31 Hypertask merges in the last 24 hours reached production within 10 minutes of merge. The miss count was four merges stuck on failed production builds, not slow checks. The live KPI is merge time to the earliest successful Production deployment on GitHub (`ci_perf.live_samples` in poteto-2-advisor).

The stuck merges line up with the heap-cap regression in the HYCI-177 note above: `3072` MB aborted inside V8 on pull requests 3038, 3037 and 3051; `3584` MB still aborted on pull request 3063 (`dpl_9tg62h9sytSJHF5iEJKQeftXk7o2`). HYCI-184 restored `4096` MB in pull request 3065 (`76c0433c59`).

Measured from the live cache at 2026-11-08 UTC, after the `76c0433` merge:

| Fact | Value |
| --- | --- |
| Production deployments on the merge commit or later | 7 |
| Failed or errored | 1 (`a8c78f2`, superseded before the fix landed) |
| Merged app pull requests after the fix (excluding the fix commit) | 5 |
| Live within 10 minutes | 5 of 5 (100 percent) |
| Median merge to live | 6.6 minutes |
| Slowest after the fix | 7.6 minutes (pull request 3062) |
| Fix commit pull request 3065 | 10.1 minutes to live |

The fix is live on `production`. The ticket closes when the CI performance page shows at least 90 percent live-within-10-min for three consecutive London days, not on this document alone.

## Heap cap 3840 MB (2026-11-08, HYCI-180)

After HYCI-184 restored the 4096 MB cap at webpack parallelism 1, Vercel production builds still intermittently died with container OOM while V8 stayed inside the cap:

| Merge | Pull request | First deployment | Log |
| --- | --- | --- | --- |
| `0b9b7307e8` | 3045 | 7639529072 | `dpl_HrSLPn4mek9iMnGazP8HZLuiuaNq` |
| `87ee509b32` | 3084 | 7639561805 | `dpl_CJ5ddoY2GBk6Unkn2o2G3XjZS3zk` |

Both logs name the same signature as the parallelism 1 note above: about three minutes into "Creating an optimized production build", `Next.js build worker exited with code: null and signal: SIGKILL`, with no "Reached heap limit" line and Vercel's `At least one "Out of Memory" ("OOM") event` footer. Each merge went live on a later successful deployment at 19.5 and 16.2 minutes after merge, which keeps the KPI below the 10 minute bar even though the app recovers without code changes.

That pattern is the free lever named in the parallelism 1 note: with parallelism already at 1, lowering `--max-old-space-size` from 4096 hands headroom to native memory. The measured V8 live set at 3584 MB was 3080.7 MB (HYCI-184), so 3840 MB keeps 759.3 MB above that peak while leaving 4352 MiB for everything outside the V8 heap on the 8192 MiB machine. If the next production build reports "Reached heap limit", the compiler genuinely needs more than 3840 MB and the next step is still the paid Enhanced Build Machine, which is Valentin's decision.

The build script first set `--max-old-space-size=3840` in pull request 3087 (`0d635b84165`). Production deployment 7668278693 (`dpl_5G6Dae88e25UY24812esxUu2euVb`) failed on that merge while `bd6f21b8ec43` at 4096 MB still built, so 3840 was below the live compiler heap on the current tree.

The cap was 4000 MB from 2026-11-09 through the HYCI-220 merge: 192 MiB above 3840 for V8 and 4192 MiB for native memory on the 8192 MiB machine. `NEXT_WEBPACK_PARALLELISM` stays 1 and the builder stays `--webpack`.

## Production cache generations (2026-11-10, HYCI-220)

Production deployments 7670721960 (`3d601a0`), 7670916742 (`81c3458`) and 7671062041 (`7b9b66af`) failed. The last success was 7670519182 (`a40cd74`). CI Tests was green on each failed SHA. The first red commit is a hover-card change, and the next two commits are unrelated, so the failure is not one feature's code.

Next 16.3.6 sets `cache.maxMemoryGenerations` to `Infinity` for production and calls the project webpack hook after that (`node_modules/next/dist/build/webpack-config.js`). `webpackMemoryOptimizations` only toggles string interning. It does not change the cache. The production hook now sets `maxMemoryGenerations` to 0, so the filesystem cache stays and the worker does not keep every generation in RAM. At first merge the heap cap stayed 4000 MB and `NEXT_WEBPACK_PARALLELISM=1` stayed 1. Dev builds are left as the hook receives them.

## Heap cap 3840 MB after disk cache (2026-11-10, HYCI-224)

HYCI-220 stopped keeping webpack cache generations in RAM. The heap cap then stepped back from 4000 MB to 3840 MB so native memory on the 8192 MiB machine gets 4352 MiB instead of 4192 MiB.

Production deployment `df912192` (pull request 3148) was the first green build with disk cache only, still at 4000 MB. Six earlier failures in 24 hours were container `out_of_memory` with no V8 "Reached heap limit" line, all on merges before that fix.

`3840` MB failed on merge `0d635b84165` before HYCI-220 while the same tree still built at 4096 MB. That gap was the in-RAM cache peak, not the compile heap alone. With `maxMemoryGenerations=0` live, 3840 MB targets the headroom model from the HYCI-180 note without the RAM cache term that pushed 4000 MB merges into repeated container OOM.

If the next production build reports "Reached heap limit", the compiler genuinely needs more than 3840 MB V8 heap on the current tree and the next step is the paid Enhanced Build Machine, which is Valentin's decision.

## Server SDK compilation (2026-11-11, HYCI-245)

Deployment `dpl_D9bBLCjW12Kc514j3d6AsUM5yL3g`, commit `0b5475a22b`, was killed about 127 seconds into compilation. The log reports `SIGKILL` and container `out_of_memory`, not a V8 heap abort. Next's worker order is server, edge, then client. No compiler completed before this failure. The old log contains no numeric heap peak, so elapsed time or the heap cap cannot establish a before/after memory saving.

`serverExternalPackages` now also contains `stripe`, `posthog-node`, `@modelcontextprotocol/sdk`, and `mcp-handler`. Node loads their published server entry points instead of webpack compiling and minifying their dependency graphs. Next still traces their runtime files; no tracing exclusions, browser imports, SDK features, source maps, or type/style gates are removed. The 3840 MiB heap cap, single-module parallelism, compiler isolation, and filesystem cache policy remain unchanged. Hosted tests exercise Node exports with `require(esm)` disabled and trace the external entry points and SDK resource files.

Every production webpack compiler emits `[build-memory]` JSON at start, module optimization, asset optimization, completion, and every 15 seconds while compiling. Each row identifies the compiler and process. `sampledHeapPeakMiB` is the largest V8 heap sample, taken every second and at those hooks; brief peaks between samples can be missed. `processMaxRssMiB` is the process-wide operating-system RSS high-water mark, not V8 heap or aggregate container memory. Samples cannot run while JavaScript blocks the event loop. A killed worker has periodic rows but no completion row. Development builds do not install the reporter.

The change remains unproven until hosted checks and a successful production build supply measurements. HYCI-245 requires a production peak at least 500 MiB below 3840 MiB and a full 24-hour failure-free window after deployment. Neither a passing fixture nor a green PR check proves those production outcomes.
