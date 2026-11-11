## Driven proof (HTPR-8938)

`driven-proof` is a pull-request check. It goes red when the diff is not docs-only, test-only, or CI-only and the head has no proof record from the seeded browser-smoke app. It is report-only: it is not in `required_checks`, and a red result does not block merge. Making it required is a later ruleset edit, after false alarms are rare.

Exempt classes, and a pull request is exempt only when every changed file is in one of them:

- Docs: `docs/**` and any Markdown file outside `src/`.
- Tests: `tests/**`.
- CI: `.github/**`, `scripts/**`, `.claude/**`, `skills/**`, `.agents/**`.

An empty or unreadable diff fails. Any other file, including `src/**`, `e2e/**`, and `package.json`, needs a record.

`browser-smoke-flags` already drives the disposable app at `http://127.0.0.1:3100` with `scripts/seed-browser-smoke.mjs` and `.github/scripts/verify-qa-premerge.mjs`. Its existing `result.json` records the PR head. The checker reuses that artifact, feature-map journey selection and loopback guard; it accepts only a passing run for the changed feature, with passing cases and PNG screenshots. Every non-exempt file must map to that feature; mixed-feature or unmapped changes stay red. It requires the same feature-map, passing-case and screenshot facts as `ship-check proof`, without converting or duplicating its post-merge record. Changes to the checker also run the real seeded inbox cycle as a positive control. Preview and production records are not accepted in this landing.

The check replays pull requests 3076, 3067, 3066, 3062, 3058, 3050, 3044, and 3042 as file lists. Each touches the app and has no record, so each is red. Pull request 3066 is the kanban cleanup.
