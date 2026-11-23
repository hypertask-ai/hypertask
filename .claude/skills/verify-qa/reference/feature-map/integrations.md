# Integrations

## Sub-features

- `integrations-page` Integrations surface.

## How to get to it (user POV)

`https://app.hypertask.ai/integrations` (`src/app/integrations/page.tsx`, `slack-app.md`). Slack is live; Discord and Microsoft Teams show **Coming Soon**.

## Driving it with agent-browser

`agent-browser` or `ht-verify`, headless, `https://app.hypertask.ai/...?realtime=on`, QA state `~/.config/hypertask-videos/storageState-qa.json`.

Open `/integrations` at desktop and 390x844. Read the Slack card; do not click **Connect Slack** on a read-only run. Confirm disabled cards for Discord and Teams.

## Gotchas

Connect Slack starts OAuth and is not read-only. `/developers` redirects to docs (`public-sites.md`).

### What proof to collect

Screenshot the primary heading and one representative control at 1440x900 and 390x844 when the layout differs. Save the URL, account, and flag mode when a flag gates the control.

### Cleanup

Archive or delete only fixtures this check created. Leave production boards unchanged on read-only passes.
