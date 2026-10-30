## CI App API pool (YPER4-881)

Selected GitHub reads and App Smoke cancellations use the `hypertask-ci` App's
separate installation API pool in trusted production workflows. App Smoke's
trusted validation recheck requests `actions: write` and
`pull-requests: read`. Feature Flag Gate's two evaluation jobs and UX Signoff
request `contents: read`, `pull-requests: read`, and `statuses: read`.

A missing secret, failed mint, or failed App request falls back to `github.token`.
Fallback success is not proof that requests used the separate pool. CI Tests
deliberately keeps its single review precheck on `github.token`, so its
PR-controlled workflow never receives the App private key. Status writes remain
on `github.token` because required status authorship
is pinned to the GitHub Actions integration. This changes no repository
settings, runners, or required checks.
