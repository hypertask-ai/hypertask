# Saved reports and velocity

## Sub-features

- `reports-home` Saved reports and velocity surface.
- `velocity-page` Saved reports and velocity surface.

## How to get to it (user POV)

`/report` lists saved reports and velocity links (`src/app/report/page.tsx`, `reports-agent-doors.md`). Velocity screen: `/report/<projectSlug>/velocity` (e.g. `project-15`).

## Driving it with agent-browser

`agent-browser` or `ht-verify`, headless, `https://app.hypertask.ai/...?realtime=on`, QA state `~/.config/hypertask-videos/storageState-qa.json`.

Open `/report`. Confirm **Reports** and velocity section rows. Open `/report/project-15/velocity` and confirm **Velocity** heading and board metrics. MCP `GET /api/mcp/reports/velocity?project_id=15` without token should 401.

### Hands-free drive on production

```bash
node .claude/skills/verify-qa/scripts/feature-map-drive.mjs {slug} --dir /tmp/feature-map-drive
```

Prints `PASS` or `FAIL` per step, writes `result.json` and screenshots into `--dir`, and ends with
`{slug} ok`. It refuses any base except `https://app.hypertask.ai`, uses the `qa-login` identities,
creates only fixtures its own cleanup removes, and never prints a cookie, token or email address.

## Gotchas

Velocity slug is not a saved report slug. Agent doors need tokens (`reports-agent-doors.md`).

### What proof to collect

Screenshot the primary heading and one representative control at 1440x900 and 390x844 when the layout differs. Save the URL, account, and flag mode when a flag gates the control.

### Cleanup

Archive or delete only fixtures this check created. Leave production boards unchanged on read-only passes.
