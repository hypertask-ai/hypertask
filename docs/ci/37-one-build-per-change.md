## One app build per change (HYCI-10)

`browser-smoke-desktop` in `.github/workflows/ci-tests.yml` builds the candidate,
as part of a required page check. Right after `next build` it publishes that output
as the `app-build` artifact (`.next/cache` excluded, one day retained), before the
page checks run, so a failing page check still leaves the build for its consumer.
HYCI-32 added a second browser half (`browser-smoke-mobile`) that builds its own
copy in parallel, so a screen change now builds twice, once per machine, and the
visual comparison still adds no third build. The Next.js
incremental cache is restored on every run and saved only on a successful `production`
push, exactly as before.

`visual-compare` is a new job in the same workflow that holds the pull-request visual
comparison moved out of `visual-regression.yml`. It needs `browser-smoke`, downloads
the same artifact into `head/.next` and runs the comparison with
`VISUAL_HEAD_BUILD=artifact`: base still builds from its own checkout, head does not
build at all. `.github/scripts/visual-change-scope.cjs` carries the old `paths:` list,
so the comparison still runs only on screen or harness changes. It is advisory, not a
required context, and lands after the required check.

Disposable secrets (`SESSION_SECRET`, `JWT_SECRET`, `BETTER_AUTH_SECRET`) are derived
from the head commit and a per-purpose label instead of `openssl rand`, so the published
build and its consumer share one environment. They are still masked and still thrown
away with the runner.

So a change that touches screens builds the candidate app once per browser machine for
page tests instead of once per consumer, and the required check plus the comparison
still run every screen, layout and inbox check. The App Smoke container build stays separate by design: it runs the
untrusted candidate with a different baked environment (mocked fonts, container
network, `CORE_APP_SMOKE`) and no network, so this artifact cannot serve it.
`docs/ci-policy.yml` records that reuse as deferred
(`premerge_verify_qa.app_smoke_build_reuse`).

Docs-only PRs skip the build and every heavy step, as before.

The build starts its server build traces beside the client compile (HYCI-46).
`next build` used to collect them only after the client compile and page generation
had finished, which was 71-122s of dead time at the end of a 129-208s page-check build
(runs 41257231186, 41259739597, 41259981110, 41260576809, 41260664320).
`.github/workflows/ci-tests.yml` now sets `CORE_APP_SMOKE` for every job it runs;
`next.config.js` already read that value to switch `parallelServerBuildTraces` on for
the App Smoke container build. That trailing dead time is 55-78s on the two runs of
the change (runs 41259147670, 41261876740), below the fastest run without it. The
build stays on one page-generation worker (`experimental.cpus: 1`), so the trace
worker competes with the client compile and the traces still cost 46-66s, down from
49-85s. Both browser halves run this same build step, so each half gains that time.
The build output, the `app-build` artifact and the required check name are unchanged.
The build is not what holds the run: a half spends 387s of its 657s on tests and about
120s on fixed setup.
