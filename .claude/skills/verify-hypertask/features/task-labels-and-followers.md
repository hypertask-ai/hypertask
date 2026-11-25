# Task labels and followers

## Sub-features

- `labels-api` Task labels and followers surface.
- `priority-api` Task labels and followers surface.
- `follower-api` Task labels and followers surface.

## How to get to it (user POV)

Ticket metadata APIs: `src/pages/api/labels/*`, `priority/*`, `follower/*`, `favorites/*`, `assignees/assign.ts`, `section/*`, `estimate/*`, `reminders/*` (see inventory). UI uses labels on boards and task detail.

## Driving it with agent-browser

`agent-browser` or `ht-verify`, headless, `https://app.hypertask.ai/...?realtime=on`, QA state `~/.config/hypertask-videos/storageState-qa.json`.

On QA Sandbox, `GET /api/labels/getByProject?projectId=7049` and `GET /api/priority/getByTask?taskId=<fixture>` as QA 985. Confirm 200 JSON. `POST /api/favorites/addEditFavorites` only with a throwaway toggle you revert.

### Hands-free drive on production

```bash
node .claude/skills/verify-hypertask/scripts/feature-map-drive.mjs {slug} --dir /tmp/feature-map-drive
```

Prints `PASS` or `FAIL` per step, writes `result.json` and screenshots into `--dir`, and ends with
`{slug} ok`. It refuses any base except `https://app.hypertask.ai`, uses the `qa-login` identities,
creates only fixtures its own cleanup removes, and never prints a cookie, token or email address.

## Gotchas

MCP label list is `list-labels` tool (`mcp-task-lookup.md`). Do not assign labels on shared boards you do not own.

### What proof to collect

Screenshot the primary heading and one representative control at 1440x900 and 390x844 when the layout differs. Save the URL, account, and flag mode when a flag gates the control.

### Cleanup

Archive or delete only fixtures this check created. Leave production boards unchanged on read-only passes.
