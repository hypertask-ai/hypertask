## Feature-map coverage count (HTPR-9406, HTPR-9415)

The non-required `feature-map-coverage` job in
[feature-map-coverage.yml](../.github/workflows/feature-map-coverage.yml) runs on
manual dispatch and on production pull requests that change app pages, product
flag definitions, the feature map, or this checker. It prints `N of M`, the
unmapped names and the map rows out of sync in the job summary. `M` is every
`page.tsx` route under `src/app` plus flag definitions whose kind is `feature` or
`improvement`. `N` is how many of those names appear in a feature-map area page.
Bugfix and internal flags are repairs, not extra features.

A production pull request fails when the counter reports an unmapped feature, an
area page with no row in `rows/`, or a row with no area page (HTPR-9415). A manual
dispatch runs the same counter without `--strict`, so a maintainer can read the
list from production and the weekly feature-map jobs keep their report-only pass.
The job runs the counter only: no browser, no secrets, no database. The job is not
a required context, so a red run needs a ruleset change before it stops a merge on
its own.

The unit test fails if the counter stops telling mapped and unmapped apart, or if
strict mode stops failing on a row gap.
