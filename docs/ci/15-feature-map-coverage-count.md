## Feature-map coverage count (HTPR-9406)

The non-required `feature-map-coverage` job in
[feature-map-coverage.yml](../.github/workflows/feature-map-coverage.yml) runs on
manual dispatch and on production pull requests that change app pages, product
flag definitions, the feature map, or this checker. It prints `N of M` and the
unmapped names in the job summary. `M` is every `page.tsx` route under `src/app`
plus flag definitions whose kind is `feature` or `improvement`. `N` is how many
of those names appear in a feature-map area page. Bugfix and internal flags are
repairs, not extra features. A gap does not fail the job. The unit test fails
if the counter stops telling mapped and unmapped apart.
