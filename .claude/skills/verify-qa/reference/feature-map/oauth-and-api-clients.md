# OAuth and API clients

## Sub-features

- `oauth-consent` OAuth and API clients surface.
- `oauth-success` OAuth and API clients surface.
- `connect-settings` OAuth and API clients surface.

## How to get to it (user POV)

OAuth: `/oauth/login`, `/oauth/consent`, `/oauth/success` (`login.md`). Connect tab: MCP, CLI, REST API, management keys, developer access (`settingsNavigation.ts:189-209`). Device login: `/cli-auth` (`desktop-login.md`).

## Driving it with agent-browser

`agent-browser` or `ht-verify`, headless, `https://app.hypertask.ai/...?realtime=on`, QA state `~/.config/hypertask-videos/storageState-qa.json`.

Signed out, `/oauth/login?returnTo=%2Finbox` must land on `/login?returnTo=%2Finbox`. Open `/oauth/consent` without token: **Connection request expired**. Open `/settings/mcp` and `/settings/api` signed in; read TOKEN and docs cards without minting or revoking tokens.

## Gotchas

Never complete a live OAuth grant or revoke production tokens. MCP revoke button had a GUI bug (HTPR-9515); prefer read-only.

### What proof to collect

Screenshot the primary heading and one representative control at 1440x900 and 390x844 when the layout differs. Save the URL, account, and flag mode when a flag gates the control.

### Cleanup

Archive or delete only fixtures this check created. Leave production boards unchanged on read-only passes.
