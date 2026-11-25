# Slack app

## Sub-features

- `slack-app` Slack app.
- `integrations-page` `/integrations` is the Integrations screen. Slack is the live card: task notifications, project updates, and sharing tasks to channels. Discord and Microsoft Teams stay disabled and say Coming Soon. `success=true` shows “Slack integration connected successfully!” Access denied, a missing code, a Slack failure, and a server error each show their own error. Connect Slack starts a connection, so a read-only check does not click it.
- `slack-account-link` `/settings/slack/link` is Connect Slack, and it requires a signed-in user. A valid link shows the Hypertask email and Slack workspace, then Connect account posts the confirmation. `status=linked` says the Slack account now uses the Hypertask identity. An already-linked account, a team the user is not in, and an invalid or used link each say why and tell the user to run `/ht connect` in Slack again. A valid confirmation shows that same command, says it expires in 10 minutes, and says it works once.
- `slack-app-parity` With `htpr-6817-slack-app` on, an ordinary task mention in Slack is handled as chat with the thread context, and the turn is saved. A mention that asks to make a task from this thread still creates the task from the thread. Assistant thread context is stored. Disconnect keeps that Slack user from being auto-linked again, and connect clears that mark. Off creates the task from a task mention directly and does not keep the disconnect.

## How to get to it (user POV)

- Open `/add-to-slack` to read the install overview and requested scopes. The `htpr-4857-add-to-slack` flag gates this page; a disabled flag returns 404.
- Open `/slack/support`, or click Slack app support on the install page. The `htpr-6921-slack-marketplace` flag gates the support page and the install page's Privacy policy, Terms, and Slack app support links. The support flag defaults to Everyone. Switching it Off returns 404, including signed-out visitors.
- Sign in and open Settings > Slack (`/settings/slack`), select an accessible Hypertask team, and choose Connect Slack. This uses `/api/slack/install?teamId=<team-id>` to redirect to Slack OAuth. The install overview also offers an Add to Slack authorization link.
- Open `/integrations` while signed in. Read the Slack card. Leave Discord and Microsoft Teams disabled. Do not press Connect Slack on a read-only run.
- Open `/settings/slack/link` while signed in and without a link token. The page says the link is invalid and tells you to run `/ht connect` in Slack. Do not submit Connect account. A `status=linked` visit is the success screen and can be closed.

## Driving it with agent-browser

1. Doctor first: verify the merge sha's Production deployment is successful and `/my-tasks` is signed in as QA user 985. Use `~/.config/hypertask-videos/storageState-qa.json`, never an admin login. If a saved state lands on `/login`, record it as expired and stop; do not refresh it during a read-only QA run.
2. Open `/add-to-slack`. Check the scopes describe `/ht`, not `/hypertask`, and the marketplace links appear for user 985. Click Privacy policy and Terms, checking final `hypertask.ai` destinations and HTTP 200. Click Slack app support and check `/slack/support` renders.
3. On support, check app capabilities, personal linking and disconnect, team disconnect versus uninstall, data retained and its expiry, uninstall behavior, and `help@hypertask.ai`. Reload to verify the server still serves the same content. Follow the Add to Slack return link without completing OAuth.
4. Set the `theme` cookie on `app.hypertask.ai` to `porcelain`, `graphite`, `amoled`, and `dia` before each load. Capture support and the changed install page at desktop 1440x900 and phone 390x844; scroll to check lower content and horizontal overflow.
5. Repeat both page routes with plain user 2343 (`storageState-qa-normal.json`) and a fresh signed-out context. Both should see the support page and marketplace links. Switching the support flag Off returns 404. Do not infer a working login from a 404 alone; confirm the plain account independently.
6. Check `/api/slack/install` with redirects disabled. Signed out redirects to `/login?returnTo=%2Fsettings%2Fslack` (the returnTo is URL-encoded). Signed in without an unambiguous accessible team redirects to Slack settings with `?slack_error=missing_team`; an inaccessible `teamId` yields `slack_error=team_access_denied`; an unconfigured install yields `slack_error=not_configured`. Record status and destination host/path only; never expose OAuth state, client identifiers, tokens, or cookies. Do not follow Slack redirects in a read-only run.
7. Inspect `origin/production:docs/slack-app-manifest.json` for `app_uninstalled` and `tokens_revoked`. This proves the declared event subscriptions, not delivery or cleanup in a real workspace.
8. Record a short WebM of `/add-to-slack`, clicking Slack app support, then scrolling the support page. Keep it under 3 MB.
9. Open `/integrations` at 1440x900 and 390x844. Confirm the Slack card is active and Discord and Microsoft Teams say Coming Soon. Do not press Connect Slack.
10. Open `/settings/slack/link` signed in, with no token. Confirm the invalid-link copy and that the address stays on this page. Signed out lands on `/login`. Do not post the form.
11. `htpr-6817-slack-app` is proved in a real Slack workspace, which this run already records as UNREACHABLE. Do not install, disconnect, or send a Slack message to manufacture it.

Worked on production, 2026-11-20, QA 985. Live modes: `htpr-4857-add-to-slack`,
`htpr-6921-slack-marketplace` and `htpr-6817-slack-app` all read EVERYONE.

```text
/add-to-slack        200  title "Add Hypertask to Slack"
/slack/support       200  title "Hypertask for Slack support", copy names /ht, bot mentions, DMs, assistant sidebar
/integrations        200  Slack card live; Discord and Microsoft Teams say "coming soon..." with a Coming Soon badge
/settings/slack      200  title Settings
/settings/slack/link 200  title "Connect Slack", body "This link is invalid, expired, or belongs to another Hypertask team. Run /ht connect in Slack for a new link."
GET /api/slack/install (signed out)  307 https://app.hypertask.ai/login?returnTo=%2Fsettings%2Fslack
```

`origin/production:docs/slack-app-manifest.json` declares `app_uninstalled` and
`tokens_revoked`. Phone: `ht-verify shot https://app.hypertask.ai/slack/support
--out support-390x844.png --viewport 390x844` renders signed in and does not
overflow. Nothing here proves live Slack parity.

## Gotchas

- Flag modes expose the new links to plain or signed-out visitors, or hide the support page from QA.
- The scope copy names the retired command, legal destinations fail, or support links lead to 404.
- Theme contrast, phone wrapping, long support content, or scrolling hides text and links.
- OAuth loses the team, accepts an inaccessible team, has missing configuration, or points to a noncanonical callback origin.
- Manifest subscriptions omit uninstall or token-revocation events; subscription presence alone does not prove handlers ran.
- `/integrations` is treated as the install overview, or Connect Slack is clicked.
- `/settings/slack/link` is opened with a real confirmation token, or Connect account is submitted.
- A headless run is recorded as proof that `htpr-6817-slack-app` saved a Slack turn or kept a disconnect.

### What proof to collect

Record merge sha, deployment success, doctor screenshot, verified account ids, route HTTP statuses, rendered content, clicked link final URLs and statuses, desktop and phone screenshots for each theme, reload observations, sanitized install redirect observations, manifest event evidence, and the short main-path video. Keep one primary evidence file per case and reference existing files from `proof.md` and the run checklist.

Live Slack parity (`/ht` commands, `@mention`, DM, and assistant panel) needs a real Slack workspace with the official app installed and a human Slack user, so it cannot be driven headless. Record this as UNREACHABLE with the missing workspace access and human-session requirement. The closest reachable path is the production install and support UI plus manifest checks; none proves live parity, event delivery, or that the Worker bot can be retired.

### Automated evidence

`node --test tests/slack-marketplace.test.cjs` renders install/support pages with mocked flags and checks server gating, /ht copy, legal/support links and retention text; it does not prove live Slack parity or event delivery.

### Cleanup

These page and redirect checks need no fixtures or board writes. Do not install or uninstall an app, connect or disconnect an account/team, send Slack messages, call Slack APIs, change flags, or retire the Worker bot. Never print storage state, env files, cookies, tokens, or OAuth state. Close browser contexts after recording. Workspace parity and destructive lifecycle checks require a separately authorized human run.
