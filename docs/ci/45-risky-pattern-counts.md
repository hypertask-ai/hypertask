## Risky pattern counts (HTPR-9384)

New code was copying effect hooks, quick timers, `as any` casts, and eslint-disable comments because those patterns were already common and nothing failed. `scripts/check-risky-patterns.mjs` counts them under `src` on the existing `ci-checks` lane `risky-patterns`. The required `ci-tests` check fails when a count goes above `scripts/risky-pattern-baseline.json`. Old uses stay. A lower count does not fail.

The failure names the shape to use instead. A real exception is one object in `scripts/risky-pattern-exceptions.json` with `pattern`, a reason, and `ticket` set to a full `https://app.hypertask.ai/detail/project-<board>/<number>` link. Raising the baseline is not the exception. Files over 1,500 lines stay on the existing file size check.
