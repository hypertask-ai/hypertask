# Admin and owner tools

## Sub-features

- `admin-flags` Admin and owner tools surface.
- `internal-reset` Admin and owner tools surface.
- `logs-page` Admin and owner tools surface.

## How to get to it (user POV)

`/admin/flags` and `/admin/flags/<key>` are owner-only (`feature-flags-api.md`). `/reset` is password-gated internal reset (`billing-and-plans.md`). `/logs` is for user ids 4 and 6 only (`agent-runs.md`, `src/app/logs/page.tsx:25-40`). `/admin/comp` comp plan tool is owner-only.

## Driving it with agent-browser

`agent-browser` or `ht-verify`, headless, `https://app.hypertask.ai/...?realtime=on`, QA state `~/.config/hypertask-videos/storageState-qa.json`.

**Verified-unreachable** for QA 985 on owner surfaces: `/admin/flags` and `/admin/flags/htpr-7305-board-from-text` must 404; `/logs` redirects home; do not enter `/reset` password. Record UNREACHABLE with prerequisite owner or user 4/6 login.

## Gotchas

Never toggle flags or run reset transfers from QA. Flag owner UI matches not-found for outsiders.

### What proof to collect

Screenshot the primary heading and one representative control at 1440x900 and 390x844 when the layout differs. Save the URL, account, and flag mode when a flag gates the control.

### Cleanup

Archive or delete only fixtures this check created. Leave production boards unchanged on read-only passes.
