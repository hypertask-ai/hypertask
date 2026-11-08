## Feature-map citation check (YPER4-610)

The non-required `feature-map-check` job in
[feature-map-weekly.yml](../.github/workflows/feature-map-weekly.yml) runs Mondays
at 03:37 UTC, on manual dispatch and on production PRs changing the maintenance
skill, feature-map or ops-map pages, or that workflow. It runs only the tiny offline fixture
test and dependency-free checker with Node 24 on free GitHub-hosted Ubuntu,
pinned actions, `contents: read`, no installs, secrets or paid AI calls.
It checks index completeness, repository-path citations and API-route resolution;
problems fail the job and appear in the step summary. It is not a required check
and does not alter the ruleset. Existing stale pages are reported, not allowlisted.

The separately installed user timer performs bounded source-only Codex reads and
files at most one drift ticket per ISO week on board 11514 (labels `CI` and
`Hypertask CI`). It never drives the app.

The non-required `visual-regression` schedule (Mondays 04:05 UTC) runs the
`inbox-cycle` journey on a disposable seeded loopback stack,
uploads evidence, and files or updates a `Weekly feature-map live YYYY-Www`
ticket on board 11514 with pass and fail counts. Not production.

A runner ships documentation repairs through `/ship` and executes only the listed
live recipes with `verify-qa` after deploy. See the
[maintenance skill](../.claude/skills/maintain-verification-skill/SKILL.md) for
installation, state, load holds, limits and offline tests. The archived Fleet
Infra board 4060 is not used for these tickets.
