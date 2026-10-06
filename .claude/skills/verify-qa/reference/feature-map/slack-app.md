# Slack app

## How a customer reaches it

- Open `/add-to-slack` to read the install overview and requested scopes. The `htpr-4857-add-to-slack` flag gates this page; a disabled flag returns 404.
- Open `/slack/support`, or click Slack app support on the install page. The `htpr-6921-slack-marketplace` flag gates the support page and the install page's Privacy policy, Terms, and Slack app support links. A disabled support flag returns 404, including signed-out visitors until Everyone is enabled.
- Sign in and open Settings > Slack (`/settings/slack`), select an accessible Hypertask team, and choose Connect Slack. This uses `/api/slack/install?teamId=<team-id>` to redirect to Slack OAuth. The install overview also offers an Add to Slack authorization link.

## How to drive it

1. Doctor first: verify the merge sha's Production deployment is successful and `/my-tasks` is signed in as QA user 985. Use `~/.config/hypertask-videos/storageState-qa.json`, never an admin login. If a saved state lands on `/login`, record it as expired and stop; do not refresh it during a read-only QA run.
2. Open `/add-to-slack`. Check the scopes describe `/ht`, not `/hypertask`, and the marketplace links appear for user 985. Click Privacy policy and Terms, checking final `hypertask.ai` destinations and HTTP 200. Click Slack app support and check `/slack/support` renders.
3. On support, check app capabilities, personal linking and disconnect, team disconnect versus uninstall, data retained and its expiry, uninstall behavior, and `help@hypertask.ai`. Reload to verify the server still serves the same content. Follow the Add to Slack return link without completing OAuth.
4. Set the `theme` cookie on `app.hypertask.ai` to `porcelain`, `graphite`, `amoled`, and `dia` before each load. Capture support and the changed install page at desktop 1440x900 and phone 390x844; scroll to check lower content and horizontal overflow.
5. Repeat both page routes with plain user 2343 (`storageState-qa-normal.json`) and a fresh signed-out context. Record HTTP statuses and absence of the new marketplace links. Do not infer a working login from a 404 alone; confirm the plain account independently. Flag-off accounts should not see the gated support page.
6. Check `/api/slack/install` with redirects disabled. Signed out should redirect to `/login?returnTo=/settings/slack`. Signed in without an unambiguous accessible team redirects to Slack settings with `missing_team`; an inaccessible `teamId` yields `team_access_denied`. An authorized team redirects to Slack OAuth when configured, otherwise settings with `not_configured`. Record status and destination host/path only; never expose OAuth state, client identifiers, tokens, or cookies. Do not follow Slack redirects in a read-only run.
7. Inspect `origin/production:docs/slack-app-manifest.json` for `app_uninstalled` and `tokens_revoked`. This proves the declared event subscriptions, not delivery or cleanup in a real workspace.
8. Record a short WebM of `/add-to-slack`, clicking Slack app support, then scrolling the support page. Keep it under 3 MB.

## What usually breaks

- Flag modes expose the new links to plain or signed-out visitors, or hide the support page from QA.
- The scope copy names the retired command, legal destinations fail, or support links lead to 404.
- Theme contrast, phone wrapping, long support content, or scrolling hides text and links.
- OAuth loses the team, accepts an inaccessible team, has missing configuration, or points to a noncanonical callback origin.
- Manifest subscriptions omit uninstall or token-revocation events; subscription presence alone does not prove handlers ran.

## What proof to collect

Record merge sha, deployment success, doctor screenshot, verified account ids, route HTTP statuses, rendered content, clicked link final URLs and statuses, desktop and phone screenshots for each theme, reload observations, sanitized install redirect observations, manifest event evidence, and the short main-path video. Keep one primary evidence file per case and reference existing files from `proof.md` and the run checklist.

Live Slack parity (`/ht` commands, `@mention`, DM, and assistant panel) needs a real Slack workspace with the official app installed and a human Slack user, so it cannot be driven headless. Record this as UNREACHABLE with the missing workspace access and human-session requirement. The closest reachable path is the production install and support UI plus manifest checks; none proves live parity, event delivery, or that the Worker bot can be retired.

## Cleanup and safety

These page and redirect checks need no fixtures or board writes. Do not install or uninstall an app, connect or disconnect an account/team, send Slack messages, call Slack APIs, change flags, or retire the Worker bot. Never print storage state, env files, cookies, tokens, or OAuth state. Close browser contexts after recording. Workspace parity and destructive lifecycle checks require a separately authorized human run.
