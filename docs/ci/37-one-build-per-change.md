## One app build per change (HYCI-10)

`app-build` in `.github/workflows/ci-tests.yml` runs `next build --webpack` once per
change, on the same loopback services and the same disposable environment the page
checks use. It uploads the compiled `.next` as the `app-build` artifact (`.next/cache`
excluded, one day retained) and publishes the Next.js incremental cache exactly as
before: restore on every run, save only on a successful `production` push.

Two consumers download that artifact in the same run, natively, with no polling:

- `browser-smoke` keeps the required context and every existing page check. It still
  installs its own dependencies and Chromium, but it no longer runs `next build`, and
  it fails (never skips) when `app-build` did not succeed.
- `visual-compare` holds the pull-request visual comparison that used to live in
  `visual-regression.yml`. It downloads the same artifact into `head/.next` and runs
  the comparison with `VISUAL_HEAD_BUILD=artifact`, so base still builds from its own
  checkout while head reuses the one build.

Disposable secrets (`SESSION_SECRET`, `JWT_SECRET`, `BETTER_AUTH_SECRET`) are derived
from the head commit and a per-purpose label instead of `openssl rand`, so the build
and every consumer share one environment. They are still masked and still thrown away
with the runner.

A change therefore builds the candidate app once for page checks. The App Smoke
container build stays separate by design: it runs the untrusted candidate with a
different baked environment (mocked fonts, container network, `CORE_APP_SMOKE`) and no
network, so sharing this artifact would weaken that boundary. `docs/ci-policy.yml`
records that reuse as deferred (`premerge_verify_qa.app_smoke_build_reuse`).

Docs-only PRs skip the build and both consumers' heavy steps, as before.
