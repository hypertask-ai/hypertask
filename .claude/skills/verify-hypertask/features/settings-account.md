# Settings: account

## Sub-features

- `profile-settings` Settings: account surface.

## How to get to it (user POV)

Profile tab sections: General, Appearance, Calendar sync prefs, Inbox splits, Task page, Card settings, Notifications, AI usage, Accounts (`src/components/Modals/Settings/settingsNavigation.ts:106-128`). Paths like `/settings/general`.

## Driving it with agent-browser

`agent-browser` or `ht-verify`, headless, `https://app.hypertask.ai/...?realtime=on`, QA state `~/.config/hypertask-videos/storageState-qa.json`.

Open `/settings/general`, `/settings/appearance`, and `/settings/notifications` as QA 985. Each section renders its heading and primary controls without saving changes. Themes and notification toggles have dedicated areas (`themes.md`); here prove the sections open.

### Hands-free drive on production

```bash
node .claude/skills/verify-hypertask/scripts/feature-map-drive.mjs {slug} --dir /tmp/feature-map-drive
```

Prints `PASS` or `FAIL` per step, writes `result.json` and screenshots into `--dir`, and ends with
`{slug} ok`. It refuses any base except `https://app.hypertask.ai`, uses the `qa-login` identities,
creates only fixtures its own cleanup removes, and never prints a cookie, token or email address.

## Gotchas

Team tab sections live under pricing or team pages except profile-only items. Do not Add account (creates real users).

### What proof to collect

Screenshot the primary heading and one representative control at 1440x900 and 390x844 when the layout differs. Save the URL, account, and flag mode when a flag gates the control.

### Cleanup

Archive or delete only fixtures this check created. Leave production boards unchanged on read-only passes.
